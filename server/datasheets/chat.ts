import OpenAI from "openai";
import type {
  Datasheet, DatasheetCitation, DatasheetMarket, DatasheetSchemaDefinition,
  DatasheetSpec,
} from "@shared/schema";
import type { ProductWithVendor } from "../storage/datasheets";

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

export interface DatasheetChatInput {
  market: DatasheetMarket;
  products: ProductWithVendor[];
  datasheets: Datasheet[];
  specs: DatasheetSpec[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  question: string;
}

export interface DatasheetChatResult {
  content: string;
  citations: DatasheetCitation[];
}

const SYSTEM_PROMPT = `You are an expert hardware analyst answering questions strictly from the provided datasheet excerpts.

RULES:
1. Only use facts present in the provided datasheets. If a value is not present, say "The provided datasheets do not specify this."
2. Cite every numeric or factual claim with the vendor name and page number, e.g. "Dell (p. 4): 12 TB raw capacity".
3. Never invent or estimate values.
4. Prefer markdown tables for side-by-side comparisons.
5. When asked which is "better", use the schema's higherIsBetter hint; if absent, present the values without a verdict.`;

function buildContextSummary(input: DatasheetChatInput, schema: DatasheetSchemaDefinition): string {
  const productById = new Map(input.products.map(p => [p.id, p]));
  const datasheetByProduct = new Map(input.datasheets.map(d => [d.productId, d]));
  const specsByDs = new Map<string, DatasheetSpec[]>();
  for (const s of input.specs) {
    const arr = specsByDs.get(s.datasheetId) ?? [];
    arr.push(s);
    specsByDs.set(s.datasheetId, arr);
  }

  const lines: string[] = [`# Market: ${input.market.name}`];
  for (const p of input.products) {
    const ds = datasheetByProduct.get(p.id);
    lines.push(`\n## ${p.vendor.name} — ${p.name}`);
    if (!ds) { lines.push("(no datasheet uploaded yet)"); continue; }
    const specs = specsByDs.get(ds.id) ?? [];
    const byKey = new Map(specs.map(s => [`${s.categoryKey}.${s.attributeKey}`, s]));
    for (const g of schema.groups) {
      const groupLines: string[] = [];
      for (const a of g.attributes) {
        const sp = byKey.get(`${g.key}.${a.key}`);
        if (!sp || !sp.rawValue) continue;
        const page = sp.sourcePage !== null ? ` [p. ${sp.sourcePage}]` : "";
        groupLines.push(`- ${a.label}: ${sp.rawValue}${page}`);
      }
      if (groupLines.length) {
        lines.push(`### ${g.label}`);
        lines.push(groupLines.join("\n"));
      }
    }
    // Bound raw-text inclusion per product to ~6000 chars so total context
    // stays under model limits even with up to 5 pinned products.
    if (ds.rawText) {
      lines.push(`### Raw excerpt`);
      lines.push(ds.rawText.slice(0, 6000));
    }
  }
  return lines.join("\n");
}

function pickCitations(input: DatasheetChatInput): DatasheetCitation[] {
  const datasheetByProduct = new Map(input.datasheets.map(d => [d.productId, d]));
  const out: DatasheetCitation[] = [];
  for (const s of input.specs) {
    if (!s.sourceQuote) continue;
    const ds = input.datasheets.find(d => d.id === s.datasheetId);
    if (!ds) continue;
    const product = input.products.find(p => p.id === ds.productId);
    if (!product) continue;
    out.push({
      productId: product.id,
      productName: product.name,
      vendorName: product.vendor.name,
      page: s.sourcePage ?? null,
      quote: s.sourceQuote.slice(0, 240),
    });
    if (out.length >= 8) break;
  }
  return out;
}

export async function generateDatasheetChatResponse(input: DatasheetChatInput): Promise<DatasheetChatResult> {
  const schema = (input.market.schemaDefinition as DatasheetSchemaDefinition) ?? { groups: [] };
  const contextSummary = buildContextSummary(input, schema);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Datasheet context:\n${contextSummary}` },
    ...input.history.slice(-8).map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: input.question },
  ];

  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-4.1",
    messages,
    temperature: 0.2,
    max_tokens: 1800,
  });
  const content = completion.choices[0]?.message?.content ?? "I couldn't generate a response.";
  return { content, citations: pickCitations(input) };
}
