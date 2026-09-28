// On-demand AI translation for continuously-ingested, immutable content
// (Intelligence Feed vendor signals and News articles). Unlike the offline
// Excel translation workflow for market commentary, there's no admin curation
// step here — the first buyer to view an item in a given language triggers a
// translation, which is cached in `content_translations` and reused.
//
// "Immutable once published" only holds for the English text of a FIELD, not
// for which fields exist yet: news articles are inserted by the scraper with
// several fields null (keyTakeaway/opinion/vendorContext) and enriched later
// by analysis, which can also re-run and change text. So a cache row is not
// trusted just because it exists — each read recomputes a hash of the current
// English text per field and only reuses translations whose hash still
// matches, translating just the fields that are new or changed.
import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import type { ContentTranslationType, TranslationLanguageCode } from '@shared/schema';
import { getContentTranslation, upsertContentTranslation } from '../storage/contentTranslations';

const LANGUAGE_NAMES: Record<TranslationLanguageCode, string> = {
  fr: 'French',
  de: 'German',
  'pt-BR': 'Brazilian Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
};

// Defensive ceiling on how many items one request will translate. Feed/news
// pages are already paginated well under this, so in practice it only bites
// an abusive request with an inflated `limit`; anything beyond the cap simply
// falls back to English rather than fanning out unbounded model calls.
const MAX_ITEMS_PER_BATCH = 25;
// How many items' translations run concurrently within one batch, to avoid
// bursting dozens of simultaneous OpenAI requests even when under the cap above.
const BATCH_CONCURRENCY = 5;

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _openai;
}

async function callTranslationModel(
  language: TranslationLanguageCode,
  fields: Record<string, string>,
): Promise<Record<string, string>> {
  const systemPrompt = `You translate B2B technology market-intelligence content into ${LANGUAGE_NAMES[language]} for enterprise software buyers.
Rules:
- Translate naturally and idiomatically; keep the professional, analytical tone of the source.
- NEVER translate or alter: company/vendor/product names, CVE identifiers, other technical identifiers (IDs, version numbers, acronyms like API, SaaS, KEV, EPSS), URLs, or numbers.
- Preserve existing markdown formatting (headings, lists, bold/italic, links) exactly.
- Input is a JSON object mapping field names to English text. Respond with ONLY a JSON object using the exact same field names, each value replaced by its ${LANGUAGE_NAMES[language]} translation. Do not add, remove, or rename keys.`;

  const resp = await getOpenAI().chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(fields) },
    ],
    temperature: 0.2,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  });

  const raw = resp.choices[0]?.message?.content;
  if (!raw) throw new Error('Translation model returned empty response');
  const parsed = JSON.parse(raw);

  // Reconcile against the input field set: never trust the model to return
  // every key, or only string values. Any missing/invalid field falls back
  // to the original English text rather than failing the whole item.
  const result: Record<string, string> = {};
  for (const key of Object.keys(fields)) {
    const value = parsed?.[key];
    result[key] = typeof value === 'string' && value.trim() ? value : fields[key];
  }
  return result;
}

/**
 * Translate a set of named text fields for one content item into `language`,
 * using a cached result when available. Re-translates only fields whose
 * source text hash differs from what's cached (covers fields populated after
 * the first cache write, and text changed by re-analysis) — a merely-present
 * cache row is never trusted as complete. On any failure (missing
 * credentials, API error, malformed JSON), logs and falls back to whatever
 * was already cached (possibly partial/stale) so callers degrade to English
 * only for fields that were never successfully translated.
 */
export async function translateContentFields(
  contentType: ContentTranslationType,
  contentId: string,
  language: TranslationLanguageCode,
  fields: Record<string, string | null | undefined>,
): Promise<Record<string, string>> {
  const nonEmptyFields = Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
  );
  if (Object.keys(nonEmptyFields).length === 0) return {};

  const currentHashes = Object.fromEntries(
    Object.entries(nonEmptyFields).map(([key, value]) => [key, hashText(value)])
  );

  const cached = await getContentTranslation(contentType, contentId, language);
  const cachedTranslated = cached?.translatedFields ?? {};
  const cachedHashes = cached?.sourceFieldHashes ?? {};

  const staleKeys = Object.keys(nonEmptyFields).filter(key => cachedHashes[key] !== currentHashes[key]);
  if (staleKeys.length === 0) {
    return cachedTranslated;
  }

  const fieldsToTranslate = Object.fromEntries(staleKeys.map(key => [key, nonEmptyFields[key]]));

  let freshlyTranslated: Record<string, string>;
  try {
    freshlyTranslated = await callTranslationModel(language, fieldsToTranslate);
  } catch (err) {
    console.error(`[translateContent] failed for ${contentType}:${contentId} (${language}):`, err instanceof Error ? err.message : err);
    // Degrade to whatever was already cached; fields that were never
    // translated are simply absent, so the caller's ?? fallback shows
    // English for those specific fields instead of failing the request.
    return cachedTranslated;
  }

  const mergedTranslated = { ...cachedTranslated, ...freshlyTranslated };
  const mergedHashes = { ...cachedHashes, ...Object.fromEntries(staleKeys.map(key => [key, currentHashes[key]])) };

  try {
    await upsertContentTranslation({ contentType, contentId, language, translatedFields: mergedTranslated, sourceFieldHashes: mergedHashes });
  } catch (err) {
    // Cache write failing shouldn't break the response — the translation is
    // still returned for this request, just re-computed next time.
    console.error(`[translateContent] cache write failed for ${contentType}:${contentId} (${language}):`, err instanceof Error ? err.message : err);
  }
  return mergedTranslated;
}

/**
 * Translate the same field set for many items of one content type, returning
 * a Map from contentId to its translated-fields overlay (only containing keys
 * that were actually translated/cached; missing keys mean "use the original
 * English value"). Bounded to MAX_ITEMS_PER_BATCH items and BATCH_CONCURRENCY
 * concurrent model calls so a single request (especially on an
 * anonymous-readable listing endpoint) can't fan out unbounded paid API calls.
 */
export async function translateContentFieldsBatch(
  contentType: ContentTranslationType,
  language: TranslationLanguageCode,
  items: Array<{ id: string; fields: Record<string, string | null | undefined> }>,
): Promise<Map<string, Record<string, string>>> {
  const bounded = items.slice(0, MAX_ITEMS_PER_BATCH);
  const results = new Map<string, Record<string, string>>();

  let cursor = 0;
  async function worker() {
    while (cursor < bounded.length) {
      const item = bounded[cursor++];
      const translated = await translateContentFields(contentType, item.id, language, item.fields);
      results.set(item.id, translated);
    }
  }
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, bounded.length) }, worker));

  return results;
}
