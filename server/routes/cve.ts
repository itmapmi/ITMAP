import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireFeature } from "../featureAccess";
import OpenAI from "openai";
import {
  getCveSummary,
  getCvesByVendor,
  getCveById,
  getCveComparison,
  getVendorsWithCveData,
} from "../storage/cve";

function getOpenAI(): OpenAI {
  return new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
}

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE", "UNSCORED"];

export function registerCveRoutes(app: Express) {
  // GET /api/cve/vendors — list vendors with confirmed crosswalk mappings
  app.get(
    "/api/cve/vendors",
    requireFeature("cve_intelligence"),
    async (_req: Request, res: Response) => {
      try {
        const vendors = await getVendorsWithCveData();
        res.json({ vendors });
      } catch (err) {
        console.error("[CVE] /api/cve/vendors error:", err);
        res.status(500).json({ error: "Failed to fetch CVE vendors" });
      }
    },
  );

  // GET /api/cve/vendors/:vendorId/summary
  app.get(
    "/api/cve/vendors/:vendorId/summary",
    requireFeature("cve_intelligence"),
    async (req: Request, res: Response) => {
      try {
        const { vendorId } = req.params;
        const summary = await getCveSummary(vendorId);
        if (!summary) return res.status(404).json({ error: "Vendor not found" });
        res.json(summary);
      } catch (err) {
        console.error("[CVE] summary error:", err);
        res.status(500).json({ error: "Failed to fetch CVE summary" });
      }
    },
  );

  // GET /api/cve/vendors/:vendorId/cves — paginated CVE list
  const cveQuerySchema = z.object({
    severity: z.string().optional(),
    kev: z.enum(["true", "false"]).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    product: z.string().optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    sort: z.enum(["published", "severity", "epss"]).optional().default("published"),
    order: z.enum(["asc", "desc"]).optional().default("desc"),
  });

  app.get(
    "/api/cve/vendors/:vendorId/cves",
    requireFeature("cve_intelligence"),
    async (req: Request, res: Response) => {
      const parse = cveQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return res.status(400).json({ error: "Invalid query params", details: parse.error.flatten() });
      }
      const q = parse.data;
      try {
        const result = await getCvesByVendor(req.params.vendorId, {
          severity: q.severity,
          kevOnly: q.kev === "true",
          dateFrom: q.dateFrom,
          dateTo: q.dateTo,
          product: q.product,
          page: q.page,
          limit: q.limit,
          sort: q.sort,
          order: q.order,
        });
        res.json(result);
      } catch (err) {
        console.error("[CVE] cves list error:", err);
        res.status(500).json({ error: "Failed to fetch CVEs" });
      }
    },
  );

  // GET /api/cve/compare?vendorIds=id1,id2,...
  app.get(
    "/api/cve/compare",
    requireFeature("cve_intelligence"),
    async (req: Request, res: Response) => {
      const raw = String(req.query.vendorIds ?? "");
      const vendorIds = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8);
      if (!vendorIds.length) {
        return res.status(400).json({ error: "At least one vendorId required" });
      }
      try {
        const result = await getCveComparison(vendorIds);
        res.json(result);
      } catch (err) {
        console.error("[CVE] compare error:", err);
        res.status(500).json({ error: "Failed to compare CVEs" });
      }
    },
  );

  // POST /api/cve/:cveId/explain — LLM explanation
  app.post(
    "/api/cve/:cveId/explain",
    requireFeature("cve_intelligence"),
    async (req: Request, res: Response) => {
      const { cveId } = req.params;
      try {
        const cveData = await getCveById(cveId);
        if (!cveData) {
          return res.status(404).json({ error: "CVE not found" });
        }

        const severityLine = cveData.cvssSeverity
          ? `Severity: ${cveData.cvssSeverity} (CVSS ${cveData.cvssBaseScore ?? "N/A"})`
          : "Severity: Unknown";
        const kevLine = cveData.isKev
          ? "Known Exploited Vulnerability (CISA KEV): Yes"
          : "Known Exploited Vulnerability (CISA KEV): No";
        const epssLine = cveData.epssScore
          ? `EPSS Score: ${(parseFloat(cveData.epssScore) * 100).toFixed(1)}% probability of exploitation in next 30 days`
          : "EPSS Score: Unavailable";
        const productsLine = cveData.products.length
          ? `Affected products: ${cveData.products.join(", ")}`
          : "";
        const cweLine = cveData.cweIds?.length
          ? `CWE: ${cveData.cweIds.join(", ")}`
          : "";

        const prompt = [
          `You are a cybersecurity analyst. Explain the following CVE for an enterprise IT buyer in 3-4 sentences.`,
          `Focus on: what system is affected, how serious it is, whether it is being actively exploited, and what the recommended action is.`,
          ``,
          `CVE ID: ${cveId}`,
          severityLine,
          kevLine,
          epssLine,
          productsLine,
          cweLine,
          `Description: ${cveData.description ?? "No description available"}`,
          ``,
          `Keep the explanation concise, jargon-free, and actionable. Do not repeat the CVE ID in the response.`,
        ]
          .filter(Boolean)
          .join("\n");

        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 300,
          temperature: 0.3,
        });

        const explanation =
          completion.choices[0]?.message?.content?.trim() ??
          "Unable to generate explanation.";

        res.json({ explanation, cveId, generatedAt: new Date().toISOString() });
      } catch (err) {
        console.error("[CVE] explain error:", err);
        res.status(500).json({ error: "Failed to generate explanation" });
      }
    },
  );
}
