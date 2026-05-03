/**
 * /api/me/* — End-user self-service routes.
 *
 * Two surfaces:
 *
 *   /api/me/llm-keys       — BYO LLM API keys (GET list, PUT/DELETE per provider)
 *                            The end-user Market Builder runs on the user's own
 *                            keys, not the platform's, so each user must save
 *                            keys for the providers they intend to use.
 *
 *   /api/me/prompts        — Personal prompt repository (CRUD)
 *                            System defaults (ownerUserId IS NULL) are returned
 *                            as read-only entries; the user can only mutate
 *                            their own prompts.
 *
 * All endpoints require authentication. Ownership is enforced at the storage
 * layer (e.g. listPrompts uses ownerScope={ kind: "user", userId }).
 */
import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { insertPromptRepositorySchema } from "@shared/schema";

/**
 * Lightweight "ping" against each LLM provider — used by the /me/llm-keys
 * "Test connection" button so users can verify a key works before saving.
 * Each call lists models (cheapest available endpoint per provider) and
 * succeeds when the API returns 2xx.
 */
async function testLlmKey(
  provider: "openai" | "anthropic" | "perplexity",
  apiKey: string,
): Promise<{ ok: boolean; error?: string; model?: string }> {
  try {
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!r.ok) return { ok: false, error: `OpenAI returned ${r.status}` };
      return { ok: true };
    }
    if (provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      });
      if (!r.ok) return { ok: false, error: `Anthropic returned ${r.status}` };
      return { ok: true };
    }
    if (provider === "perplexity") {
      // Perplexity has no list-models endpoint, so do a tiny chat completion.
      const r = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
      });
      if (!r.ok) return { ok: false, error: `Perplexity returned ${r.status}` };
      return { ok: true };
    }
    return { ok: false, error: `Unknown provider: ${provider}` };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

const ALLOWED_PROVIDERS = ["openai", "anthropic", "perplexity"] as const;
type Provider = (typeof ALLOWED_PROVIDERS)[number];

function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function registerMeRoutes(app: Express): void {

  // ── BYO LLM keys ────────────────────────────────────────────────────────

  // List my keys (masked — never return full keys to the client)
  app.get("/api/me/llm-keys", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const rows = await storage.listUserLlmApiKeys(user.id);
      const keysByProvider: Record<string, { hasKey: boolean; preview: string | null; updatedAt: Date | null }> = {};
      for (const p of ALLOWED_PROVIDERS) {
        keysByProvider[p] = { hasKey: false, preview: null, updatedAt: null };
      }
      for (const row of rows) {
        keysByProvider[row.provider] = {
          hasKey: true,
          preview: maskKey(row.apiKey),
          updatedAt: row.updatedAt,
        };
      }
      res.json(keysByProvider);
    } catch (err: any) {
      console.error("[Me] list llm keys error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Save / replace a key for a provider
  app.put("/api/me/llm-keys/:provider", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const provider = req.params.provider as Provider;
      if (!ALLOWED_PROVIDERS.includes(provider)) {
        return res.status(400).json({ error: `Unknown provider: ${provider}` });
      }
      const { apiKey } = z.object({ apiKey: z.string().min(8) }).parse(req.body);
      const saved = await storage.upsertUserLlmApiKey(user.id, provider, apiKey);
      res.json({
        provider: saved.provider,
        hasKey: true,
        preview: maskKey(saved.apiKey),
        updatedAt: saved.updatedAt,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Test connection — make a tiny "ping" call to the provider with the
  // user's saved key (or a key supplied in the request body for unsaved
  // keys during the add-key flow). Returns { ok: true } on success or 4xx
  // with the provider's error message on failure.
  app.post("/api/me/llm-keys/:provider/test", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const provider = req.params.provider as Provider;
      if (!ALLOWED_PROVIDERS.includes(provider)) {
        return res.status(400).json({ error: `Unknown provider: ${provider}` });
      }
      let apiKey: string | undefined = (req.body?.apiKey ?? "").toString().trim();
      if (!apiKey) {
        const saved = await storage.getUserLlmApiKey(user.id, provider);
        apiKey = saved?.apiKey;
      }
      if (!apiKey) return res.status(400).json({ error: "No API key to test" });
      const ok = await testLlmKey(provider, apiKey);
      if (!ok.ok) return res.status(400).json({ error: ok.error });
      res.json({ ok: true, model: ok.model ?? null });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/me/llm-keys/:provider", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const provider = req.params.provider as Provider;
      if (!ALLOWED_PROVIDERS.includes(provider)) {
        return res.status(400).json({ error: `Unknown provider: ${provider}` });
      }
      await storage.deleteUserLlmApiKey(user.id, provider);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Personal Prompt Repository ──────────────────────────────────────────

  // List = system defaults + my private prompts. System rows are flagged via
  // isSystem so the UI can render them as read-only.
  app.get("/api/me/prompts", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const stage = req.query.stage as any;
      const promptType = req.query.promptType as any;
      const prompts = await storage.listPrompts({
        stage, promptType,
        ownerScope: { kind: "user", userId: user.id },
      });
      res.json(prompts);
    } catch (err: any) {
      console.error("[Me] list prompts error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/me/prompts/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const p = await storage.getPrompt(req.params.id);
      if (!p) return res.status(404).json({ error: "Prompt not found" });
      // Allow read of system defaults or own prompts only.
      if (p.ownerUserId && p.ownerUserId !== user.id) {
        return res.status(404).json({ error: "Prompt not found" });
      }
      res.json(p);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/me/prompts", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const data = insertPromptRepositorySchema.parse({
        ...req.body,
        isSystem: false,
        ownerUserId: user.id,
      });
      const created = await storage.createPrompt(data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch("/api/me/prompts/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const existing = await storage.getPrompt(req.params.id);
      if (!existing) return res.status(404).json({ error: "Prompt not found" });
      if (existing.isSystem || existing.ownerUserId !== user.id) {
        return res.status(403).json({ error: "You cannot edit this prompt" });
      }
      const { name, description, content } = req.body ?? {};
      const updated = await storage.updatePrompt(req.params.id, { name, description, content });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/me/prompts/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const existing = await storage.getPrompt(req.params.id);
      if (!existing) return res.status(204).end();
      if (existing.isSystem || existing.ownerUserId !== user.id) {
        return res.status(403).json({ error: "You cannot delete this prompt" });
      }
      await storage.deletePrompt(req.params.id);
      res.status(204).end();
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
}
