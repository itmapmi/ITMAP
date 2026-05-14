import OpenAI from "openai";
import type {
  DatasheetSchemaDefinition, InsertDatasheetSpec,
} from "@shared/schema";
import { normalizeValue } from "./normalizer";

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

export interface ExtractedRawSpec {
  categoryKey: string;
  attributeKey: string;
  value: string | null;
  unit: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  confidence: number;
}

export interface ExtractionResult {
  specs: InsertDatasheetSpec[];
  rawText: string;
  pageCount: number;
}

async function pdfBufferToText(buf: Buffer): Promise<{ text: string; pageCount: number }> {
  // pdf-parse v1 exposes a `default` callable. Dynamic-imported to avoid its
  // CJS side-effects at module load.
  const { PDFParse } = await import("pdf-parse") as { PDFParse: new (opts: { data: Uint8Array }) => { getText: () => Promise<{ text: string; total: number }> } };
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const got = await parser.getText();
  const result = { text: got.text, numpages: got.total };
  return { text: result.text || "", pageCount: result.numpages || 0 };
}

function buildExtractionPrompt(schema: DatasheetSchemaDefinition, pdfText: string, productName: string): string {
  const attrList = schema.groups.flatMap(g =>
    g.attributes.map(a => `- [${g.key}.${a.key}] "${a.label}" (type=${a.type}${a.unit ? `, unit=${a.unit}` : ""})`)
  ).join("\n");

  return `You are extracting hardware specifications from a vendor datasheet for the product "${productName}".

For each attribute below, find its value in the datasheet text and return:
- value: the value as it appears (number with unit suffix or plain text)
- unit: explicit unit if any
- sourcePage: page number where you found it (best effort; null if unknown)
- sourceQuote: short verbatim quote (<= 200 chars) from the datasheet that proves the value
- confidence: 0.0–1.0 (1.0 = exact match in spec table, 0.6 = paraphrased, 0.3 = inferred, 0.0 = not found — leave value null in that case)

If an attribute is not in the datasheet, set value=null, confidence=0, sourceQuote=null.

Attributes to extract:
${attrList}

Datasheet text:
"""
${pdfText.slice(0, 60000)}
"""

Return a JSON object with shape: { "specs": [{ "categoryKey": string, "attributeKey": string, "value": string | null, "unit": string | null, "sourcePage": number | null, "sourceQuote": string | null, "confidence": number }] }`;
}

function buildSanityCheckPrompt(schema: DatasheetSchemaDefinition, specs: ExtractedRawSpec[], productName: string): string {
  const lines = specs.filter(s => s.value !== null).map(s =>
    `- ${s.categoryKey}.${s.attributeKey}: "${s.value}" ${s.unit ? `(${s.unit})` : ""}`
  ).join("\n");
  const ranges = schema.groups.flatMap(g => g.attributes.map(a =>
    `- ${g.key}.${a.key} (${a.label}, type=${a.type}${a.unit ? `, unit=${a.unit}` : ""})`
  )).join("\n");
  return `Sanity-check these extracted specs for "${productName}". Flag any value that is implausible — wrong order of magnitude, wrong unit family, or unit mismatch.

Attributes definition:
${ranges}

Extracted values:
${lines}

Return JSON: { "flags": [{ "categoryKey": string, "attributeKey": string, "reason": string }] }`;
}

interface ExtractRawJson { specs?: Array<Partial<ExtractedRawSpec>> }
interface FlagsJson { flags?: Array<{ categoryKey: string; attributeKey: string; reason: string }> }

function parseJson<T>(s: string): T {
  const trimmed = s.trim().replace(/^```json\s*|```$/g, "");
  try { return JSON.parse(trimmed) as T; } catch { return {} as T; }
}

export async function extractDatasheet(opts: {
  fileBuffer: Buffer;
  schema: DatasheetSchemaDefinition;
  productName: string;
  datasheetId: string;
}): Promise<ExtractionResult> {
  const { fileBuffer, schema, productName, datasheetId } = opts;
  const { text, pageCount } = await pdfBufferToText(fileBuffer);

  const openai = getOpenAI();
  const extractCompletion = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [
      { role: "system", content: "You extract structured hardware specifications from datasheets. Return JSON only." },
      { role: "user", content: buildExtractionPrompt(schema, text, productName) },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  });
  const extracted = parseJson<ExtractRawJson>(extractCompletion.choices[0]?.message?.content ?? "{}");
  const rawSpecs: ExtractedRawSpec[] = (extracted.specs ?? []).map(s => ({
    categoryKey: String(s.categoryKey ?? ""),
    attributeKey: String(s.attributeKey ?? ""),
    value: s.value ?? null,
    unit: s.unit ?? null,
    sourcePage: typeof s.sourcePage === "number" ? s.sourcePage : null,
    sourceQuote: s.sourceQuote ?? null,
    confidence: typeof s.confidence === "number" ? s.confidence : 0,
  })).filter(s => s.categoryKey && s.attributeKey);

  // Sanity-check with mini model.
  let flagged = new Set<string>();
  try {
    const sanityCompletion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "You sanity-check extracted specs. Return JSON only." },
        { role: "user", content: buildSanityCheckPrompt(schema, rawSpecs, productName) },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const sanity = parseJson<FlagsJson>(sanityCompletion.choices[0]?.message?.content ?? "{}");
    flagged = new Set((sanity.flags ?? []).map(f => `${f.categoryKey}.${f.attributeKey}`));
  } catch (err) {
    console.warn("[Datasheet Extractor] Sanity check failed:", err);
  }

  // Ensure every schema attribute has a row; build maps for deduplication.
  const bySchemaKey = new Map<string, ExtractedRawSpec>();
  for (const s of rawSpecs) bySchemaKey.set(`${s.categoryKey}.${s.attributeKey}`, s);

  const specs: InsertDatasheetSpec[] = [];
  for (const g of schema.groups) {
    for (const a of g.attributes) {
      const key = `${g.key}.${a.key}`;
      const raw = bySchemaKey.get(key);
      const norm = raw?.value ? normalizeValue(raw.value, raw.unit ?? a.unit ?? null) : { normalized: null, unit: null };
      const lowConf = !raw || raw.confidence < 0.6;
      const sanityFlag = flagged.has(key);
      specs.push({
        datasheetId,
        categoryKey: g.key,
        attributeKey: a.key,
        rawValue: raw?.value ?? null,
        normalizedValue: norm.normalized !== null ? String(norm.normalized) : null,
        unit: norm.unit ?? raw?.unit ?? a.unit ?? null,
        sourcePage: raw?.sourcePage ?? null,
        sourceQuote: raw?.sourceQuote ?? null,
        confidence: String(raw?.confidence ?? 0),
        needsReview: lowConf || sanityFlag,
      });
    }
  }
  return { specs, rawText: text, pageCount };
}
