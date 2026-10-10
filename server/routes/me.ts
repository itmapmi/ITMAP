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
import { optionalIndustrySchema } from "@shared/company-profile";
import bcrypt from "bcryptjs";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { insertPromptRepositorySchema } from "@shared/schema";
import { isConsumerEmailDomain, needsCompanyEmailVerification } from "@shared/company-email";
import { issueAndSendCompanyVerification, VERIFICATION_RESEND_COOLDOWN_MS } from "./auth";
import { toPublicUser } from "../lib/publicUser";

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

  // ── Profile ─────────────────────────────────────────────────────────────

  app.patch("/api/me/profile", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { firstName, lastName, email } = z.object({
        firstName: z.string().min(1).optional(),
        lastName:  z.string().min(1).optional(),
        email:     z.string().email().optional(),
      }).parse(req.body);

      // The sign-in email is immutable from self-service: it is the account's
      // identity for passwordless login and drives the company-email profile
      // gate (shared/company-email.ts), so letting a user swap a consumer
      // address for a business one here would bypass verification entirely.
      if (email && email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
        return res.status(400).json({ error: "Your sign-in email can't be changed. Add a company email in the Company profile section instead." });
      }

      const updated = await storage.updateUser(user.id, {
        ...(firstName !== undefined && { firstName }),
        ...(lastName  !== undefined && { lastName }),
      });

      // Refresh the passport session object so the client sees the new name.
      (req as any).user = updated;

      res.json(toPublicUser(updated));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Password ─────────────────────────────────────────────────────────────

  // ── Company profile (shared/company-email.ts) ──────────────────────────
  //
  // Buyers on a consumer-domain login email complete this to unlock Reports /
  // News / Intelligence Feed. The company email is verified by an emailed
  // link and never replaces the login email.

  const companyProfileView = (user: any) => ({
    companyName: user.companyName ?? null,
    designation: user.designation ?? null,
    industry: user.industry ?? null,
    companyEmail: user.companyEmail ?? null,
    companyEmailVerified: !!user.companyEmailVerified,
    companyEmailVerificationSentAt: user.companyEmailVerificationSentAt ?? null,
    needsCompanyEmailVerification: needsCompanyEmailVerification(user),
  });

  const resendCooldownRemainingMs = (sentAt: Date | string | null | undefined) => {
    if (!sentAt) return 0;
    const elapsed = Date.now() - new Date(sentAt).getTime();
    return Math.max(0, VERIFICATION_RESEND_COOLDOWN_MS - elapsed);
  };

  app.get("/api/me/company-profile", requireAuth, async (req, res) => {
    res.json(companyProfileView(req.user as any));
  });

  const companyProfileSchema = z.object({
    companyName: z.string().trim().min(2, "Company name is required").max(120),
    designation: z.string().trim().min(2, "Designation is required").max(120),
    industry: optionalIndustrySchema,
    companyEmail: z.string().trim().toLowerCase().email("Enter a valid company email").max(254),
  });

  app.put("/api/me/company-profile", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const parsed = companyProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" });
      }
      const { companyName, designation, companyEmail, industry } = parsed.data;

      if (isConsumerEmailDomain(companyEmail)) {
        return res.status(400).json({
          error: "Please use your work email address — personal mailboxes (Gmail, Yahoo, Outlook, …) can't be used as a company email.",
          code: "CONSUMER_DOMAIN",
        });
      }

      const holder = await storage.getUserWithVerifiedCompanyEmail(companyEmail);
      if (holder && holder.id !== user.id) {
        return res.status(409).json({
          error: "This company email is already verified on another account.",
          code: "COMPANY_EMAIL_TAKEN",
        });
      }

      const sameEmail = (user.companyEmail ?? "").toLowerCase() === companyEmail;
      const previouslyVerified = !!user.companyEmailVerified && sameEmail;
      // Re-saving the same unverified address (e.g. fixing a typo in the
      // job title) must not bypass the resend cooldown.
      const withinCooldown = sameEmail && !previouslyVerified &&
        resendCooldownRemainingMs(user.companyEmailVerificationSentAt) > 0;

      const updated = await storage.updateCompanyProfile(user.id, { companyName, designation, companyEmail, industry });
      (req as any).user = updated;

      // Saving an already-verified address (e.g. editing only the job title)
      // keeps it verified; otherwise a fresh link goes out immediately.
      let emailSent = false;
      if (!previouslyVerified && !withinCooldown) {
        emailSent = await issueAndSendCompanyVerification(user.id, companyEmail, companyName);
        if (!emailSent) {
          const current = await storage.getUser(user.id);
          return res.status(502).json({
            error: "Your profile was saved, but the verification email could not be sent. Please use “Resend verification link” in a moment.",
            code: "EMAIL_SEND_FAILED",
            profile: companyProfileView(current ?? updated),
          });
        }
      }

      const current = await storage.getUser(user.id);
      res.json({ ...companyProfileView(current ?? updated), emailSent });
    } catch (err: any) {
      console.error("[Me] Failed to save company profile:", err);
      res.status(500).json({ error: "Failed to save company profile" });
    }
  });

  app.post("/api/me/company-profile/resend", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      if (!user.companyEmail) {
        return res.status(400).json({ error: "Add your company email first." });
      }
      if (user.companyEmailVerified) {
        return res.status(400).json({ error: "Your company email is already verified." });
      }
      const remaining = resendCooldownRemainingMs(user.companyEmailVerificationSentAt);
      if (remaining > 0) {
        return res.status(429).json({
          error: `Please wait ${Math.ceil(remaining / 1000)}s before requesting another email.`,
          retryAfterMs: remaining,
        });
      }
      const sent = await issueAndSendCompanyVerification(user.id, user.companyEmail, user.companyName ?? null);
      if (!sent) {
        return res.status(502).json({ error: "Could not send the verification email. Please try again shortly." });
      }
      const current = await storage.getUser(user.id);
      res.json({ sent: true, ...companyProfileView(current ?? user) });
    } catch (err: any) {
      console.error("[Me] Failed to resend company verification:", err);
      res.status(500).json({ error: "Failed to resend verification email" });
    }
  });

  app.patch("/api/me/password", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { currentPassword, newPassword } = z.object({
        currentPassword: z.string().min(1),
        newPassword:     z.string().min(8),
      }).parse(req.body);

      const dbUser = await storage.getUser(user.id);
      if (!dbUser?.password) {
        return res.status(400).json({ error: "No password set on this account (OAuth login)" });
      }
      const match = await bcrypt.compare(currentPassword, dbUser.password);
      if (!match) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }

      const hashed = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(user.id, { password: hashed });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

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
