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
2. EVERY factual or numeric claim in "answer" MUST be backed by a citation in the citations array (vendorName, productName, page, quote). The quote must be a verbatim snippet present in the provided context.
3. Never invent or estimate values.
4. Use markdown tables for side-by-side comparisons.
5. When asked which is "better", use the schema's higherIsBetter hint; if absent, present the values without a verdict.

Respond with strict JSON of shape:
{ "answer": string, "citations": [ { "vendorName": string, "productName": string, "page": number|null, "quote": string } ] }`;

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

function bindCitations(
  raw: Array<{ vendorName?: string; productName?: string; page?: number | null; quote?: string }>,
  input: DatasheetChatInput,
): DatasheetCitation[] {
  const out: DatasheetCitation[] = [];
  for (const c of raw) {
    if (!c.vendorName || !c.productName || !c.quote) continue;
    const product = input.products.find(
      p => p.vendor.name === c.vendorName && p.name === c.productName,
    );
    if (!product) continue;
    out.push({
      productId: product.id,
      productName: product.name,
      vendorName: product.vendor.name,
      page: typeof c.page === "number" ? c.page : null,
      quote: c.quote.slice(0, 240),
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

  const call = async () =>
    getOpenAI().chat.completions.create({
      model: "gpt-4.1",
      messages,
      temperature: 0.2,
      max_tokens: 1800,
      response_format: { type: "json_object" },
    });

  let completion = await call();
  let raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: { answer?: string; citations?: Array<{ vendorName?: string; productName?: string; page?: number | null; quote?: string }> } = {};
  try { parsed = JSON.parse(raw); } catch { parsed = { answer: raw, citations: [] }; }
  let answer = (parsed.answer || "").trim();
  let citations = bindCitations(parsed.citations ?? [], input);

  // Citation contract: every factual answer must carry at least one
  // vendor + page citation. Treat known "no data available" answers as
  // an acceptable no-citation case; otherwise retry once asking the model
  // to add citations, and if it still fails refuse to surface the answer.
  const looksLikeNoData = /do not specify|not available|not present|no data|cannot answer/i.test(answer);
  if (answer && citations.length === 0 && !looksLikeNoData) {
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content:
        "Your previous JSON answer contained factual claims but no citations. Resend the SAME answer as JSON, but include at least one citation per factual claim, each with vendorName, productName, page, and a verbatim quote from the provided context. Only return JSON.",
    });
    completion = await call();
    raw = completion.choices[0]?.message?.content ?? "{}";
    try { parsed = JSON.parse(raw); } catch { /* keep previous parsed */ }
    answer = (parsed.answer || answer).trim();
    citations = bindCitations(parsed.citations ?? [], input);
  }

  if (!answer) {
    return { content: "I couldn't generate a response.", citations: [] };
  }
  if (citations.length === 0 && !looksLikeNoData) {
    return {
      content:
        "I couldn't ground that answer in the provided datasheets with a verifiable citation. Try rephrasing or asking about a specific spec.",
      citations: [],
    };
  }
  return { content: answer, citations };
}
