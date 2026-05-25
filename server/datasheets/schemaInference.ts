/**
 * Schema inference for Datasheet Markets.
 *
 * Takes 1–3 sample vendor datasheet PDFs and asks GPT-4.1 to propose a
 * comparable spec schema (groups + attributes with types, units, and
 * higher-is-better flags). When multiple PDFs are provided, a second
 * merge pass unions and dedupes attributes across sources so similar
 * specs from different vendors land on one row.
 *
 * Output shape matches DatasheetSchemaDefinition so the result can be
 * stored directly on `datasheet_markets.schema_definition`.
 */
import OpenAI from "openai";
import type { DatasheetSchemaDefinition } from "@shared/schema";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    });
  }
  return _openai;
}

async function pdfBufferToText(buf: Buffer): Promise<{ text: string; pageCount: number }> {
  const { PDFParse } = await import("pdf-parse") as {
    PDFParse: new (opts: { data: Uint8Array }) => { getText: () => Promise<{ text: string; total: number }> };
  };
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const got = await parser.getText();
  return { text: got.text || "", pageCount: got.total || 0 };
}

function parseJson<T>(s: string): T {
  const trimmed = s.trim().replace(/^```json\s*|```$/g, "");
  try { return JSON.parse(trimmed) as T; } catch { return {} as T; }
}

function slugifyKey(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "attr";
}

export interface InferSchemaInput {
  pdfs: Array<{ filename: string; buffer: Buffer }>;
  /** Optional hint to bias attribute selection (e.g. "Enterprise Storage Arrays"). */
  marketHint?: string;
}

export interface InferSchemaResult {
  schema: DatasheetSchemaDefinition;
  suggestedMarketName: string | null;
  suggestedCategory: string | null;
  sourceCount: number;
  /** Names of products the AI detected in each PDF — helps the admin sanity check. */
  detectedProducts: string[];
}

function buildSinglePdfPrompt(pdfText: string, filename: string, marketHint?: string): string {
  const hint = marketHint ? `The admin says this market is roughly: "${marketHint}". Use this as a hint.` : "";
  return `You are designing a comparable hardware-spec schema for a product comparison platform.

You are given the text of ONE vendor datasheet PDF (filename: ${filename}). Your job:

1. Detect the product name and product category.
2. Propose a clean schema of attributes that buyers would compare ACROSS competing products in this category. Group related attributes (e.g. Performance, Capacity, Connectivity, Power, Physical, Software, Support).
3. For each attribute, infer:
   - key: short snake_case identifier (e.g. "max_iops")
   - label: human-readable label
   - type: "number" | "text" | "boolean" | "enum"
   - unit: canonical unit for numeric attrs (e.g. "TB", "IOPS", "W", "GB/s"); null for non-numeric
   - higherIsBetter: true/false/null — only set for numeric attrs where the buyer preference is clear
   - sampleValue: the actual value from THIS datasheet (helps admin verify; can be null if missing)

Rules:
- ONLY include attributes that are MEANINGFUL FOR CROSS-VENDOR COMPARISON. Skip vendor-specific marketing names, model numbers, and one-off features.
- Use canonical units (TB not Terabytes, GB/s not gigabytes per second, W not Watts).
- 4–8 groups, 4–10 attributes per group is a healthy target. Don't overload.
- Use the same snake_case key convention everywhere.
${hint}

Datasheet text (truncated):
"""
${pdfText.slice(0, 50000)}
"""

Return ONLY a JSON object with this shape:
{
  "productName": string | null,
  "marketCategory": string | null,
  "groups": [
    {
      "key": string,
      "label": string,
      "attributes": [
        {
          "key": string,
          "label": string,
          "type": "number" | "text" | "boolean" | "enum",
          "unit": string | null,
          "higherIsBetter": boolean | null,
          "sampleValue": string | null
        }
      ]
    }
  ]
}`;
}

function buildMergePrompt(perPdfSchemas: PerPdfResult[]): string {
  const blocks = perPdfSchemas.map((s, i) => {
    const summary = s.groups.flatMap(g =>
      g.attributes.map(a => `${g.key}.${a.key} (${a.label}, type=${a.type}${a.unit ? `, unit=${a.unit}` : ""}${a.higherIsBetter !== null ? `, higherIsBetter=${a.higherIsBetter}` : ""})`)
    ).join("\n  ");
    return `Source ${i + 1} (${s.productName ?? "unknown"}, category="${s.marketCategory ?? "unknown"}"):\n  ${summary}`;
  }).join("\n\n");

  return `You are merging multiple per-vendor draft schemas into ONE unified schema for cross-vendor comparison.

Different vendors describe the same thing with different names (e.g. Pure "Effective Capacity" ≈ NetApp "Usable Capacity"; Dell "Front-end ports" ≈ HPE "Host ports"). Your job:

1. UNION the attributes across all sources.
2. DEDUPE: when two attributes from different sources clearly describe the same physical thing, KEEP ONE — pick the clearest label and canonical unit.
3. PRESERVE groups (Performance, Capacity, etc.) but consolidate where reasonable.
4. Snap all keys to snake_case. Canonical units only.
5. ONLY include attributes meaningful for comparison. Drop any that look vendor-specific.

Source draft schemas:
${blocks}

Return ONLY a JSON object with this shape:
{
  "marketCategory": string | null,
  "groups": [
    {
      "key": string,
      "label": string,
      "attributes": [
        {
          "key": string,
          "label": string,
          "type": "number" | "text" | "boolean" | "enum",
          "unit": string | null,
          "higherIsBetter": boolean | null
        }
      ]
    }
  ]
}`;
}

interface PerPdfResult {
  productName: string | null;
  marketCategory: string | null;
  groups: Array<{
    key: string;
    label: string;
    attributes: Array<{
      key: string;
      label: string;
      type: "number" | "text" | "boolean" | "enum";
      unit: string | null;
      higherIsBetter: boolean | null;
      sampleValue: string | null;
    }>;
  }>;
}

interface MergedResult {
  marketCategory: string | null;
  groups: Array<{
    key: string;
    label: string;
    attributes: Array<{
      key: string;
      label: string;
      type: "number" | "text" | "boolean" | "enum";
      unit: string | null;
      higherIsBetter: boolean | null;
    }>;
  }>;
}

function sanitizeType(t: unknown): "number" | "text" | "boolean" | "enum" {
  return t === "number" || t === "text" || t === "boolean" || t === "enum" ? t : "text";
}

function sanitizeSchemaDef(input: MergedResult): DatasheetSchemaDefinition {
  const usedGroupKeys = new Set<string>();
  const groups = (input.groups ?? []).map(g => {
    const base = slugifyKey(g.key || g.label || "group");
    let key = base;
    let i = 2;
    while (usedGroupKeys.has(key)) key = `${base}_${i++}`;
    usedGroupKeys.add(key);

    const usedAttrKeys = new Set<string>();
    const attributes = (g.attributes ?? []).map(a => {
      const baseA = slugifyKey(a.key || a.label || "attr");
      let aKey = baseA;
      let j = 2;
      while (usedAttrKeys.has(aKey)) aKey = `${baseA}_${j++}`;
      usedAttrKeys.add(aKey);
      const type = sanitizeType(a.type);
      return {
        key: aKey,
        label: String(a.label || aKey).slice(0, 120),
        type,
        unit: type === "number" && a.unit ? String(a.unit).slice(0, 40) : undefined,
        higherIsBetter: type === "number" && typeof a.higherIsBetter === "boolean" ? a.higherIsBetter : undefined,
      };
    }).filter(a => a.key && a.label);

    return { key, label: String(g.label || key).slice(0, 120), attributes };
  }).filter(g => g.attributes.length > 0);

  return { groups };
}

export async function inferSchemaFromPdfs(input: InferSchemaInput): Promise<InferSchemaResult> {
  const { pdfs, marketHint } = input;
  if (!pdfs.length) throw new Error("At least one PDF is required");
  if (pdfs.length > 3) throw new Error("At most 3 PDFs supported per inference run");

  const openai = getOpenAI();

  // Phase 1 — per-PDF inference, in parallel.
  const perPdfResults = await Promise.all(pdfs.map(async ({ filename, buffer }) => {
    const { text } = await pdfBufferToText(buffer);
    if (!text || text.length < 200) {
      throw new Error(`Could not extract text from ${filename} (PDF may be image-only or corrupt)`);
    }
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: "You design comparable hardware-spec schemas. Return JSON only." },
        { role: "user", content: buildSinglePdfPrompt(text, filename, marketHint) },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });
    const raw = parseJson<PerPdfResult>(completion.choices[0]?.message?.content ?? "{}");
    return {
      productName: raw.productName ?? null,
      marketCategory: raw.marketCategory ?? null,
      groups: Array.isArray(raw.groups) ? raw.groups : [],
    };
  }));

  // Phase 2 — merge step only when we have >1 source. Otherwise the single
  // result is already canonical enough; just sanitize it.
  let merged: MergedResult;
  if (perPdfResults.length === 1) {
    merged = {
      marketCategory: perPdfResults[0].marketCategory,
      groups: perPdfResults[0].groups.map(g => ({
        key: g.key,
        label: g.label,
        attributes: g.attributes.map(a => ({
          key: a.key, label: a.label, type: a.type, unit: a.unit, higherIsBetter: a.higherIsBetter,
        })),
      })),
    };
  } else {
    const mergeCompletion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: "You merge schema drafts. Return JSON only." },
        { role: "user", content: buildMergePrompt(perPdfResults) },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });
    merged = parseJson<MergedResult>(mergeCompletion.choices[0]?.message?.content ?? "{}");
    if (!Array.isArray(merged.groups)) merged.groups = [];
    if (!merged.marketCategory) {
      merged.marketCategory = perPdfResults.find(r => r.marketCategory)?.marketCategory ?? null;
    }
  }

  const schema = sanitizeSchemaDef(merged);
  return {
    schema,
    suggestedMarketName: merged.marketCategory,
    suggestedCategory: merged.marketCategory,
    sourceCount: pdfs.length,
    detectedProducts: perPdfResults.map(r => r.productName ?? "").filter(Boolean),
  };
}
