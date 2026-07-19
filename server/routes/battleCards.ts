import type { Express, Request, Response } from "express";
import { z } from "zod";
import path from "path";
import { requireAuth } from "../auth";
import { requireFeature } from "../featureAccess";
import { db } from "../db";
import {
  markets, vendors, featureCategories, features, vendorFeatureSupport,
  criteria, vendorScores, marketCriteriaWeights,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import OpenAI from "openai";
import { pdfService } from "../pdf-generator/pdf-service";
import pptxgen from "pptxgenjs";

function getOpenAI(): OpenAI {
  return new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c] ?? c));
}

function harveyBallSvg(level: number): string {
  const cx = 10, cy = 10, r = 8;
  const stroke = "#64748b";
  const fill = "#22d3ee";
  if (level <= 0) return `<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="1.5"/></svg>`;
  if (level >= 4) return `<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/></svg>`;
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (level / 4) * 2 * Math.PI;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = level > 2 ? 1 : 0;
  const path = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  return `<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="1.5"/><path d="${path}" fill="${fill}"/></svg>`;
}

function harveyBallLabel(level: number): string {
  return ["None", "Limited", "Partial", "Good", "Full"][Math.min(4, Math.max(0, level))];
}

const aiSummarySchema = z.object({
  topBullets: z.array(z.string()),
  categoryInsights: z.record(z.string()),
  criteriaInsights: z.record(z.string()),
  focalVendorName: z.string().optional(),
}).optional();

const exportPayloadSchema = z.object({
  marketName: z.string(),
  vendorNames: z.array(z.string()),
  vendorIds: z.array(z.string()),
  focalVendorName: z.string().optional(),
  aiSummary: aiSummarySchema,
  sections: z.array(z.object({
    type: z.enum(["product", "ecosystem", "criteria"]),
    title: z.string(),
    categoryName: z.string().optional(),
    rows: z.array(z.object({
      name: z.string(),
      category: z.string().optional(),
      isAi: z.boolean().optional(),
      cells: z.array(z.object({
        vendorId: z.string(),
        value: z.union([z.number(), z.string()]),
        notes: z.string().optional().nullable(),
      })),
    })),
  })),
});

export function registerBattleCardRoutes(app: Express): void {

  app.use("/api/battle-cards", requireFeature("battle_cards"));

  // ── GET market data payload ──────────────────────────────────────────────
  app.get("/api/battle-cards/:marketId", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const { marketId } = req.params;

      const [market] = await db.select().from(markets).where(eq(markets.id, marketId)).limit(1);
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (market.visibility !== "public" && market.ownerUserId !== user?.id && user?.role !== "admin") {
        return res.status(404).json({ error: "Market not found" });
      }

      const [vendorRows, catRows, featureRows, supportRows, weightRows, scoreRows] = await Promise.all([
        db.select().from(vendors).where(eq(vendors.marketId, marketId)).orderBy(vendors.name),

        db.select().from(featureCategories)
          .where(eq(featureCategories.marketId, marketId))
          .orderBy(featureCategories.displayOrder, featureCategories.name),

        db.select({ feature: features, category: featureCategories })
          .from(features)
          .innerJoin(featureCategories, eq(features.categoryId, featureCategories.id))
          .where(eq(featureCategories.marketId, marketId))
          .orderBy(featureCategories.displayOrder, features.displayOrder, features.name),

        db.select({ support: vendorFeatureSupport, vendor: vendors })
          .from(vendorFeatureSupport)
          .innerJoin(vendors, eq(vendorFeatureSupport.vendorId, vendors.id))
          .where(eq(vendors.marketId, marketId)),

        db.select({
          criteriaId: marketCriteriaWeights.criteriaId,
          weight: marketCriteriaWeights.weight,
          criteriaName: criteria.name,
          criteriaCategory: criteria.category,
          criteriaDescription: criteria.description,
        })
          .from(marketCriteriaWeights)
          .innerJoin(criteria, eq(marketCriteriaWeights.criteriaId, criteria.id))
          .where(eq(marketCriteriaWeights.marketId, marketId)),

        db.select({ score: vendorScores, vendor: vendors })
          .from(vendorScores)
          .innerJoin(vendors, eq(vendorScores.vendorId, vendors.id))
          .where(eq(vendors.marketId, marketId)),
      ]);

      const supportMap: Record<string, Record<string, { supportLevel: number; comments: string | null }>> = {};
      for (const row of supportRows) {
        const s = row.support;
        if (!supportMap[s.featureId]) supportMap[s.featureId] = {};
        supportMap[s.featureId][s.vendorId] = { supportLevel: s.supportLevel, comments: s.comments ?? null };
      }

      const scoreMap: Record<string, Record<string, { score: string; notes: string | null }>> = {};
      for (const row of scoreRows) {
        const s = row.score;
        if (!scoreMap[s.criteriaId]) scoreMap[s.criteriaId] = {};
        scoreMap[s.criteriaId][s.vendorId] = { score: s.score, notes: s.notes ?? null };
      }

      const featuresByCat: Record<string, Array<{ id: string; name: string; description: string | null; displayOrder: number | null }>> = {};
      for (const row of featureRows) {
        const catId = row.category.id;
        if (!featuresByCat[catId]) featuresByCat[catId] = [];
        if (!featuresByCat[catId].find(f => f.id === row.feature.id)) {
          featuresByCat[catId].push({ id: row.feature.id, name: row.feature.name, description: row.feature.description ?? null, displayOrder: row.feature.displayOrder ?? null });
        }
      }

      const buildCategories = (cats: typeof catRows) =>
        cats.map(c => ({
          id: c.id,
          name: c.name,
          description: c.description ?? null,
          features: (featuresByCat[c.id] ?? []).map(f => ({
            id: f.id,
            name: f.name,
            description: f.description,
            vendorSupport: supportMap[f.id] ?? {},
          })),
        }));

      res.json({
        market: { id: market.id, name: market.name, description: market.description },
        vendors: vendorRows.map(v => ({ id: v.id, name: v.name, description: v.description })),
        productCategories: buildCategories(catRows.filter(c => !c.isEcosystem)),
        ecosystemCategories: buildCategories(catRows.filter(c => c.isEcosystem)),
        criteriaRows: weightRows.map(w => ({
          criteriaId: w.criteriaId,
          criteriaName: w.criteriaName,
          criteriaCategory: w.criteriaCategory,
          criteriaDescription: w.criteriaDescription ?? null,
          weight: w.weight,
          vendorScores: scoreMap[w.criteriaId] ?? {},
        })),
      });
    } catch (err: any) {
      console.error("[BattleCards] GET error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST AI win summary ──────────────────────────────────────────────────
  const aiSummaryRequestSchema = z.object({
    focalVendorId: z.string(),
    competitorIds: z.array(z.string()).min(1).max(8),
    productCategoryNames: z.array(z.string()).optional(),
    ecosystemCategoryNames: z.array(z.string()).optional(),
  });

  app.post("/api/battle-cards/:marketId/ai-summary", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const { marketId } = req.params;
      const body = aiSummaryRequestSchema.parse(req.body);

      const [market] = await db.select().from(markets).where(eq(markets.id, marketId)).limit(1);
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (market.visibility !== "public" && market.ownerUserId !== user?.id && user?.role !== "admin") {
        return res.status(404).json({ error: "Market not found" });
      }

      const allVendorIds = [body.focalVendorId, ...body.competitorIds];
      const cleanMarketName = market.name.replace(/^ITMAP for /i, "");

      const [vendorRows, scoreRows, featureSupportRows, catRows, weightRows] = await Promise.all([
        db.select().from(vendors).where(and(eq(vendors.marketId, marketId), inArray(vendors.id, allVendorIds))),
        db.select({ score: vendorScores, vendor: vendors })
          .from(vendorScores).innerJoin(vendors, eq(vendorScores.vendorId, vendors.id))
          .where(and(eq(vendors.marketId, marketId), inArray(vendorScores.vendorId, allVendorIds))),
        db.select({ support: vendorFeatureSupport, vendor: vendors, feature: features, category: featureCategories })
          .from(vendorFeatureSupport)
          .innerJoin(vendors, eq(vendorFeatureSupport.vendorId, vendors.id))
          .innerJoin(features, eq(vendorFeatureSupport.featureId, features.id))
          .innerJoin(featureCategories, eq(features.categoryId, featureCategories.id))
          .where(and(eq(vendors.marketId, marketId), inArray(vendorFeatureSupport.vendorId, allVendorIds))),
        db.select().from(featureCategories).where(eq(featureCategories.marketId, marketId)),
        db.select({ criteriaId: marketCriteriaWeights.criteriaId, weight: marketCriteriaWeights.weight, criteriaName: criteria.name })
          .from(marketCriteriaWeights).innerJoin(criteria, eq(marketCriteriaWeights.criteriaId, criteria.id))
          .where(eq(marketCriteriaWeights.marketId, marketId)),
      ]);

      const focalVendor = vendorRows.find(v => v.id === body.focalVendorId);
      if (!focalVendor) return res.status(400).json({ error: "Focal vendor not found in market" });
      const competitors = vendorRows.filter(v => body.competitorIds.includes(v.id));

      // Build per-vendor score summary
      const buildVendorScoreSummary = (vendorId: string) => {
        return scoreRows
          .filter(r => r.vendor.id === vendorId)
          .map(r => {
            const w = weightRows.find(w => w.criteriaId === r.score.criteriaId);
            return `  ${w?.criteriaName ?? r.score.criteriaId} (weight ${w?.weight ?? "?"}%): ${r.score.score}/10${r.score.notes ? ` — "${r.score.notes}"` : ""}`;
          }).join("\n");
      };

      // Build per-category feature summary for focal vendor
      const selectedProductCats = body.productCategoryNames ?? catRows.filter(c => !c.isEcosystem).map(c => c.name);
      const selectedEcoCats = body.ecosystemCategoryNames ?? catRows.filter(c => c.isEcosystem).map(c => c.name);
      const allSelectedCatNames = [...selectedProductCats, ...selectedEcoCats];

      const categoryContext = allSelectedCatNames.map(catName => {
        const cat = catRows.find(c => c.name === catName);
        if (!cat) return null;
        const rows = featureSupportRows.filter(r => r.category.id === cat.id);
        const focalRows = rows.filter(r => r.vendor.id === body.focalVendorId);
        const focalAvg = focalRows.length > 0 ? (focalRows.reduce((s, r) => s + r.support.supportLevel, 0) / focalRows.length).toFixed(1) : "N/A";
        const competitorAvgs = competitors.map(comp => {
          const compRows = rows.filter(r => r.vendor.id === comp.id);
          const avg = compRows.length > 0 ? (compRows.reduce((s, r) => s + r.support.supportLevel, 0) / compRows.length).toFixed(1) : "N/A";
          return `${comp.name}: ${avg}/4`;
        }).join(", ");
        const topFeatures = focalRows
          .filter(r => r.support.supportLevel >= 3)
          .slice(0, 3)
          .map(r => `${r.feature.name} (${harveyBallLabel(r.support.supportLevel)})`)
          .join(", ");
        return `Category: ${catName}\n  ${focalVendor.name} avg: ${focalAvg}/4 | Competitors: ${competitorAvgs}\n  ${focalVendor.name} strengths: ${topFeatures || "none standout"}`;
      }).filter(Boolean).join("\n\n");

      const focalScores = buildVendorScoreSummary(body.focalVendorId);
      const competitorScores = competitors.map(c => `${c.name}:\n${buildVendorScoreSummary(c.id)}`).join("\n\n");

      const systemPrompt = `You are a technology analyst writing a battle card for ${focalVendor.name} in the "${cleanMarketName}" market.
Your job is to analyze the data provided and generate a structured win summary that a sales rep can use.

Respond ONLY with valid JSON in this exact shape:
{
  "topBullets": ["string", ...],
  "categoryInsights": { "<category name>": "string", ... },
  "criteriaInsights": { "<criterion name>": "string", ... }
}

Rules:
- topBullets: 3-5 concise bullets explaining why ${focalVendor.name} leads overall. Start each with an action/strength word. Be specific with numbers/scores where possible.
- categoryInsights: one sentence per category (from the list given) explaining ${focalVendor.name}'s strength or gap in that area vs competitors. Use ONLY the category names provided.
- criteriaInsights: for criteria where ${focalVendor.name} scores highest, one sentence explaining the advantage. Only include criteria where ${focalVendor.name} leads.
- Be factual, grounded in the data, and concise. Do not invent capabilities.`;

      const userPrompt = `MARKET: ${cleanMarketName}
FOCAL VENDOR: ${focalVendor.name}
COMPETITORS: ${competitors.map(c => c.name).join(", ")}

CRITERIA SCORES — ${focalVendor.name}:
${focalScores || "(none)"}

CRITERIA SCORES — Competitors:
${competitorScores || "(none)"}

FEATURE CATEGORY SUMMARIES:
${categoryContext || "(none)"}

Generate the win summary JSON.`;

      const completion = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 1500,
      });

      let raw = (completion.choices[0]?.message?.content ?? "{}").trim();
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
      if (jsonMatch) raw = jsonMatch[1].trim();

      let summary: any = { topBullets: [], categoryInsights: {}, criteriaInsights: {} };
      try {
        const parsed = JSON.parse(raw);
        summary = {
          topBullets: Array.isArray(parsed.topBullets) ? parsed.topBullets : [],
          categoryInsights: typeof parsed.categoryInsights === "object" ? parsed.categoryInsights : {},
          criteriaInsights: typeof parsed.criteriaInsights === "object" ? parsed.criteriaInsights : {},
          focalVendorName: focalVendor.name,
        };
      } catch {
        summary.focalVendorName = focalVendor.name;
      }

      res.json(summary);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ error: err.message });
      console.error("[BattleCards] AI summary error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST AI suggest feature rows ─────────────────────────────────────────
  const aiSuggestSchema = z.object({
    vendorIds: z.array(z.string()).min(1).max(10),
    prompt: z.string().min(1).max(500),
    focalVendorId: z.string().nullable().optional(),
    existingRows: z.array(z.object({ featureName: z.string() })).optional(),
  });

  app.post("/api/battle-cards/:marketId/ai-suggest", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const { marketId } = req.params;
      const body = aiSuggestSchema.parse(req.body);

      const [market] = await db.select().from(markets).where(eq(markets.id, marketId)).limit(1);
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (market.visibility !== "public" && market.ownerUserId !== user?.id && user?.role !== "admin") {
        return res.status(404).json({ error: "Market not found" });
      }

      const vendorRows = body.vendorIds.length > 0
        ? await db.select().from(vendors).where(and(eq(vendors.marketId, marketId), inArray(vendors.id, body.vendorIds)))
        : [];

      const [scoreRows, featureSupportRows] = vendorRows.length > 0
        ? await Promise.all([
            db.select({ score: vendorScores, vendor: vendors })
              .from(vendorScores)
              .innerJoin(vendors, eq(vendorScores.vendorId, vendors.id))
              .where(and(eq(vendors.marketId, marketId), inArray(vendorScores.vendorId, body.vendorIds))),
            db.select({ support: vendorFeatureSupport, vendor: vendors, feature: features })
              .from(vendorFeatureSupport)
              .innerJoin(vendors, eq(vendorFeatureSupport.vendorId, vendors.id))
              .innerJoin(features, eq(vendorFeatureSupport.featureId, features.id))
              .where(and(eq(vendors.marketId, marketId), inArray(vendorFeatureSupport.vendorId, body.vendorIds))),
          ])
        : [[], []];

      const vendorContext = vendorRows.map(v => {
        const scoreFacts = scoreRows
          .filter(r => r.vendor.id === v.id && r.score.notes)
          .map(r => `  [criteria] ${r.score.notes}`)
          .slice(0, 5);
        const featureFacts = featureSupportRows
          .filter(r => r.vendor.id === v.id && r.support.comments)
          .map(r => `  [${r.feature.name}] ${r.support.comments}`)
          .slice(0, 8);
        const commentary = [...scoreFacts, ...featureFacts].join("\n");
        return `Vendor: ${v.name}\nDescription: ${v.description || "N/A"}\nCommentary:\n${commentary || "  (none)"}`;
      }).join("\n\n");

      const existingNames = (body.existingRows ?? []).map(r => r.featureName).join(", ");
      const cleanMarketName = market.name.replace(/^ITMAP for /i, "");
      const focalVendorId = body.focalVendorId ?? null;
      const focalVendor = focalVendorId ? vendorRows.find(v => v.id === focalVendorId) : null;

      const salesBiasInstruction = focalVendor
        ? `\nSALES MODE: This card is for ${focalVendor.name}'s sales team. ONLY suggest rows where ${focalVendor.name} scores 3 or 4. Competitors may score lower.`
        : "";

      const systemPrompt = `You are a technology analyst building a vendor comparison battle card for the "${cleanMarketName}" market.
Suggest comparison feature rows that would be valuable. Respond ONLY with a JSON array (no wrapper object):
[{ "featureName": string, "category": string, "perVendor": { "<vendorId>": <0-4> } }]
Support levels: 0=none, 1=limited, 2=partial, 3=good, 4=full.
Use only these vendorIds: ${body.vendorIds.join(", ")}.
Do NOT repeat these existing features: ${existingNames || "none"}.${salesBiasInstruction}`;

      const userPrompt = `${vendorContext}\n\nUser request: ${body.prompt}\n\nSuggest 3-6 relevant comparison rows.`;

      const completion = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });

      let raw = (completion.choices[0]?.message?.content ?? "[]").trim();
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\[[\s\S]*\])/);
      if (jsonMatch) raw = jsonMatch[1].trim();

      let rows: any[] = [];
      try {
        const parsed = JSON.parse(raw);
        rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? parsed.features ?? []);
      } catch {
        rows = [];
      }

      const valid = rows.filter((r: any) => r.featureName && r.category && r.perVendor && typeof r.perVendor === "object");
      res.json({ rows: valid });
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ error: err.message });
      console.error("[BattleCards] AI suggest error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST export PDF ──────────────────────────────────────────────────────
  app.post("/api/battle-cards/:marketId/export/pdf", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = exportPayloadSchema.parse(req.body);
      const marketName = body.marketName.replace(/^ITMAP for /i, "");
      const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      const focalName = body.focalVendorName ?? body.vendorNames[0];

      let html = `<h1 style="color:#0ea5e9;font-size:22px;margin:0 0 4px;">${escapeHtml(focalName)} Battle Card</h1>`;
      html += `<p style="color:#475569;font-size:12px;margin:0 0 4px;">${escapeHtml(marketName)}</p>`;
      html += `<p style="color:#718096;font-size:11px;margin:0 0 12px;">Generated ${today} &nbsp;·&nbsp; Vendors: ${body.vendorNames.map(escapeHtml).join(", ")}</p>`;

      // AI summary section
      if (body.aiSummary && body.aiSummary.topBullets.length > 0) {
        html += `<div style="background:#f0f9ff;border-left:4px solid #0ea5e9;padding:12px 16px;margin:0 0 20px;border-radius:0 6px 6px 0;">`;
        html += `<p style="font-size:13px;font-weight:700;color:#0369a1;margin:0 0 8px;">Why ${escapeHtml(focalName)} Leads</p>`;
        html += `<ul style="margin:0;padding-left:18px;">`;
        for (const bullet of body.aiSummary.topBullets) {
          html += `<li style="font-size:11px;color:#1e293b;margin-bottom:4px;">${escapeHtml(bullet)}</li>`;
        }
        html += `</ul></div>`;
      }

      for (const section of body.sections) {
        html += `<h2 style="font-size:15px;font-weight:700;color:#2d3748;margin:24px 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">${escapeHtml(section.title)}</h2>`;

        // Category insight
        const categoryInsight = body.aiSummary?.categoryInsights?.[section.categoryName ?? ""] ?? body.aiSummary?.categoryInsights?.[section.title] ?? null;
        if (categoryInsight) {
          html += `<p style="font-size:10px;color:#475569;font-style:italic;margin:0 0 8px;padding:6px 10px;background:#f8fafc;border-radius:4px;">${escapeHtml(categoryInsight)}</p>`;
        }

        const colPct = Math.max(20, 45 - body.vendorIds.length * 4);
        html += `<table style="width:100%;border-collapse:collapse;font-size:10px;">`;
        html += `<thead><tr><th style="text-align:left;padding:6px 8px;background:#f7fafc;border:1px solid #e2e8f0;width:${colPct}%;">Feature</th>`;
        for (const vn of body.vendorNames) {
          const isFocal = vn === focalName;
          html += `<th style="text-align:center;padding:6px 8px;background:${isFocal ? "#eff6ff" : "#f7fafc"};border:1px solid #e2e8f0;${isFocal ? "color:#1d4ed8;font-weight:700;" : ""}">${escapeHtml(vn)}</th>`;
        }
        html += `</tr></thead><tbody>`;

        for (const row of section.rows) {
          html += `<tr>`;
          html += `<td style="padding:5px 8px;border:1px solid #e2e8f0;font-weight:${row.isAi ? "normal" : "500"};font-style:${row.isAi ? "italic" : "normal"};">`;
          html += escapeHtml(row.name);
          if (row.isAi) html += ` <span style="font-size:9px;color:#7c3aed;">[AI]</span>`;
          html += `</td>`;
          for (const vendorId of body.vendorIds) {
            const cell = row.cells.find(c => c.vendorId === vendorId);
            const val = cell?.value ?? 0;
            const vendorName = body.vendorNames[body.vendorIds.indexOf(vendorId)] ?? "";
            const isFocal = vendorName === focalName;
            const bgStyle = isFocal ? "background:#eff6ff;" : "";
            if (section.type === "criteria") {
              const score = parseFloat(String(val)) || 0;
              const pct = Math.round((score / 10) * 100);
              html += `<td style="padding:5px 8px;border:1px solid #e2e8f0;text-align:center;${bgStyle}">${score.toFixed(1)}/10<br/><div style="background:#e2e8f0;border-radius:2px;height:4px;margin-top:3px;"><div style="background:${isFocal ? "#2563eb" : "#0ea5e9"};height:4px;width:${pct}%;border-radius:2px;"></div></div>${cell?.notes ? `<p style="font-size:8px;color:#64748b;margin:2px 0 0;text-align:left;word-wrap:break-word;white-space:pre-wrap;">${escapeHtml(cell.notes)}</p>` : ""}</td>`;
            } else {
              const level = Math.min(4, Math.max(0, typeof val === "number" ? val : parseInt(String(val)) || 0));
              html += `<td style="padding:5px 8px;border:1px solid #e2e8f0;text-align:center;${bgStyle}">${harveyBallSvg(level)} <span style="font-size:9px;color:#718096;">${harveyBallLabel(level)}</span>${cell?.notes ? `<p style="font-size:8px;color:#64748b;margin:2px 0 0;text-align:left;word-wrap:break-word;white-space:pre-wrap;">${escapeHtml(cell.notes)}</p>` : ""}</td>`;
            }
          }
          html += `</tr>`;
        }
        html += `</tbody></table>`;
      }

      const pdfBuf = await pdfService.renderHtmlWithPdfmake(html);
      const fileName = `battle-card-${focalName.replace(/\s+/g, "-").toLowerCase()}-vs-competition.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(pdfBuf);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ error: err.message });
      console.error("[BattleCards] PDF export error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST export PPTX ─────────────────────────────────────────────────────
  app.post("/api/battle-cards/:marketId/export/pptx", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = exportPayloadSchema.parse(req.body);
      const marketName = body.marketName.replace(/^ITMAP for /i, "");
      const today = new Date().toLocaleDateString("en-GB");
      const focalName = body.focalVendorName ?? body.vendorNames[0];

      const NAVY = "020617";
      const CYAN = "22D3EE";
      const WHITE = "FFFFFF";
      const MUTED = "94A3B8";
      const SLATE = "1E293B";
      const EMERALD = "10B981";

      // Harvey ball SVG → base64 data URL for pptxgenjs addImage
      function harveyBallDataUrl(level: number): string {
        const cx = 10, cy = 10, r = 8;
        const stroke = "#64748b";
        const fill = "#22d3ee";
        let inner = "";
        if (level <= 0) {
          inner = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`;
        } else if (level >= 4) {
          inner = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
        } else {
          const startAngle = -Math.PI / 2;
          const endAngle = startAngle + (level / 4) * 2 * Math.PI;
          const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle);
          const la = level > 2 ? 1 : 0;
          const path = `M${cx} ${cy} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${la} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z`;
          inner = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="1.5"/><path d="${path}" fill="${fill}"/>`;
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 20 20">${inner}</svg>`;
        return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
      }

      const prs = new pptxgen();
      prs.layout = "LAYOUT_WIDE";
      prs.title = `${focalName} Battle Card — ${marketName}`;

      // ── Title slide ──────────────────────────────────────────────────────
      const titleSlide = prs.addSlide();
      titleSlide.background = { fill: NAVY };
      const logoPath = path.join(process.cwd(), "attached_assets/DCIG-Logo-WHITE_1781593294046.png");
      try {
        titleSlide.addImage({ path: logoPath, x: 5.15, y: 0.25, w: 3.0, h: 0.9 });
      } catch {
        titleSlide.addText("ITMAP", { x: 5.5, y: 0.3, w: 2.5, h: 0.6, fontSize: 20, bold: true, color: CYAN, align: "center" });
      }
      titleSlide.addText("Battle Card", { x: 0.5, y: 1.2, w: 12, h: 0.5, fontSize: 14, color: MUTED, align: "center" });
      titleSlide.addText(focalName, { x: 0.5, y: 1.7, w: 12, h: 1.0, fontSize: 40, bold: true, color: WHITE, align: "center" });
      titleSlide.addText(`vs  ${body.vendorNames.filter(n => n !== focalName).join("  ·  ")}`, { x: 0.5, y: 2.75, w: 12, h: 0.5, fontSize: 16, color: CYAN, align: "center" });
      titleSlide.addText(marketName, { x: 0.5, y: 3.3, w: 12, h: 0.4, fontSize: 12, color: MUTED, align: "center" });
      titleSlide.addText(`itmap.ai  ·  ${today}`, { x: 0.5, y: 3.8, w: 12, h: 0.35, fontSize: 11, color: MUTED, align: "center" });
      titleSlide.addShape(prs.ShapeType.line, { x: 2, y: 4.25, w: 9, h: 0, line: { color: CYAN, width: 2 } });

      // ── Win summary slide ────────────────────────────────────────────────
      if (body.aiSummary && body.aiSummary.topBullets.length > 0) {
        const summarySlide = prs.addSlide();
        summarySlide.background = { fill: NAVY };
        summarySlide.addText(`Why ${focalName} Leads`, { x: 0.4, y: 0.2, w: 12, h: 0.6, fontSize: 24, bold: true, color: CYAN });
        summarySlide.addText(`${marketName}  ·  vs ${body.vendorNames.filter(n => n !== focalName).join(", ")}`, { x: 0.4, y: 0.8, w: 12, h: 0.3, fontSize: 10, color: MUTED });
        summarySlide.addShape(prs.ShapeType.line, { x: 0.4, y: 1.15, w: 12.5, h: 0, line: { color: SLATE, width: 1 } });
        const bulletRows: pptxgen.TextProps[] = body.aiSummary.topBullets.map(b => ({
          text: `▶  ${b}`,
          options: { fontSize: 16, color: WHITE, bullet: false, paraSpaceAfter: 10 },
        }));
        summarySlide.addText(bulletRows, { x: 0.6, y: 1.4, w: 11.8, h: 4.8, valign: "top" });
      }

      // ── One slide per section ────────────────────────────────────────────
      for (const section of body.sections) {
        const slide = prs.addSlide();
        slide.background = { fill: NAVY };

        slide.addText(section.title, { x: 0.3, y: 0.15, w: 12, h: 0.55, fontSize: 20, bold: true, color: CYAN });
        slide.addText(body.vendorNames.join("  ·  "), { x: 0.3, y: 0.68, w: 12, h: 0.28, fontSize: 9, color: MUTED });
        slide.addShape(prs.ShapeType.line, { x: 0.3, y: 1.0, w: 12.7, h: 0, line: { color: SLATE, width: 1 } });

        const insight = body.aiSummary?.categoryInsights?.[section.categoryName ?? ""] ?? body.aiSummary?.categoryInsights?.[section.title];
        let tableStartY = 1.05;
        if (insight) {
          slide.addText(insight, { x: 0.3, y: 1.05, w: 12.7, h: 0.4, fontSize: 9, color: MUTED, italic: true });
          tableStartY = 1.5;
        }

        const featureColW = Math.min(3.5, 12.7 - body.vendorIds.length * 1.5);
        const vendorColW = (12.7 - featureColW) / body.vendorIds.length;
        const colW: number[] = [featureColW, ...body.vendorIds.map(() => vendorColW)];

        const headerRow: pptxgen.TableRow = [
          { text: "Feature / Criterion", options: { bold: true, color: WHITE, fill: { color: SLATE }, fontSize: 8, align: "left" } },
          ...body.vendorNames.map(vn => ({
            text: vn,
            options: {
              bold: true,
              color: vn === focalName ? EMERALD : CYAN,
              fill: { color: vn === focalName ? "0F2F23" : SLATE },
              fontSize: 8,
              align: "center" as const,
            },
          })),
        ];

        const tableRows: pptxgen.TableRow[] = [headerRow];
        const maxDataRows = Math.min(section.rows.length, 16);
        const totalTableRows = 1 + maxDataRows + (section.rows.length > 16 ? 1 : 0);
        const tableHeight = insight ? 4.8 : 5.3;
        // Fixed row height so we can calculate Harvey ball overlay positions precisely
        const rowH = Math.min(0.45, tableHeight / totalTableRows);

        for (const row of section.rows.slice(0, 16)) {
          const nameCell: pptxgen.TableCell = {
            text: (row.isAi ? "✦ " : "") + row.name,
            options: { fontSize: 7.5, color: row.isAi ? "A78BFA" : WHITE, italic: !!row.isAi },
          };
          const valueCells: pptxgen.TableCell[] = body.vendorIds.map(vid => {
            const cell = row.cells.find(c => c.vendorId === vid);
            const val = cell?.value ?? 0;
            const vendorName = body.vendorNames[body.vendorIds.indexOf(vid)] ?? "";
            const isFocal = vendorName === focalName;
            if (section.type === "criteria") {
              const score = parseFloat(String(val)) || 0;
              return {
                text: `${score.toFixed(1)}/10`,
                options: { fontSize: 8.5, color: isFocal ? EMERALD : CYAN, align: "center" as const, bold: isFocal },
              };
            } else {
              // Empty text — Harvey ball SVG image is overlaid after the table
              return {
                text: "",
                options: { align: "center" as const },
              };
            }
          });
          tableRows.push([nameCell, ...valueCells]);
        }

        if (section.rows.length > 16) {
          tableRows.push([
            { text: `… and ${section.rows.length - 16} more rows`, options: { color: MUTED, fontSize: 7, italic: true } },
            ...body.vendorIds.map(() => ({ text: "", options: {} as pptxgen.TableCellProps })),
          ]);
        }

        slide.addTable(tableRows, {
          x: 0.3, y: tableStartY, w: 12.7, h: tableHeight,
          colW,
          rowH,
          border: { type: "solid", color: SLATE, pt: 0.5 },
          fill: { color: NAVY },
          fontSize: 7.5,
        });

        // ── Harvey ball SVG overlays (product/ecosystem sections only) ────
        if (section.type !== "criteria") {
          const imgSize = Math.min(0.28, rowH * 0.72); // Harvey ball image sized to fit row
          const imgOffset = (rowH - imgSize) / 2;
          for (let rowIdx = 0; rowIdx < section.rows.slice(0, 16).length; rowIdx++) {
            const row = section.rows[rowIdx];
            // y: skip header row (rowH * 1) then each data row
            const imgY = tableStartY + rowH * (rowIdx + 1) + imgOffset;
            for (let vidIdx = 0; vidIdx < body.vendorIds.length; vidIdx++) {
              const vid = body.vendorIds[vidIdx];
              const cell = row.cells.find(c => c.vendorId === vid);
              const val = cell?.value ?? 0;
              const level = Math.min(4, Math.max(0, typeof val === "number" ? val : parseInt(String(val)) || 0));
              const cellLeft = 0.3 + featureColW + vidIdx * vendorColW;
              const imgX = cellLeft + vendorColW / 2 - imgSize / 2;
              slide.addImage({ data: harveyBallDataUrl(level), x: imgX, y: imgY, w: imgSize, h: imgSize });
            }
          }
        }

        // ── Slide notes: every feature with Harvey ball levels + commentary ─
        const HARVEY_LABELS = ["None", "Limited", "Partial", "Good", "Full"];
        const notesLines: string[] = [
          `${section.title}`,
          "=".repeat(section.title.length),
          "",
        ];
        for (const row of section.rows) {
          // Header line: feature name + each vendor's level in brackets
          if (section.type === "criteria") {
            const vendorScores = body.vendorIds.map(vid => {
              const cell = row.cells.find(c => c.vendorId === vid);
              const score = parseFloat(String(cell?.value ?? 0)) || 0;
              const vn = body.vendorNames[body.vendorIds.indexOf(vid)] ?? vid;
              return `${vn}: ${score.toFixed(1)}/10`;
            }).join(" | ");
            notesLines.push(`${row.name}  [${vendorScores}]`);
          } else {
            const vendorLevels = body.vendorIds.map(vid => {
              const cell = row.cells.find(c => c.vendorId === vid);
              const val = cell?.value ?? 0;
              const level = Math.min(4, Math.max(0, typeof val === "number" ? val : parseInt(String(val)) || 0));
              const vn = body.vendorNames[body.vendorIds.indexOf(vid)] ?? vid;
              return `${vn}: ${HARVEY_LABELS[level]}`;
            }).join(" | ");
            notesLines.push(`${row.name}  [${vendorLevels}]`);
          }
          // Commentary lines indented below
          for (const vid of body.vendorIds) {
            const cell = row.cells.find(c => c.vendorId === vid);
            if (cell?.notes) {
              const vn = body.vendorNames[body.vendorIds.indexOf(vid)] ?? vid;
              notesLines.push(`  ${vn}: ${cell.notes}`);
            }
          }
          notesLines.push("");
        }
        slide.addNotes(notesLines.join("\n"));
      }

      // ── Write and send ───────────────────────────────────────────────────
      const buf = await prs.write("nodebuffer") as Buffer;
      const fileName = `battle-card-${focalName.replace(/\s+/g, "-").toLowerCase()}-vs-competition.pptx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(buf);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ error: err.message });
      console.error("[BattleCards] PPTX export error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
