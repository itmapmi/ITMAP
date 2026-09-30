import { createHash } from 'node:crypto';
import type { TranslationLanguageCode } from '@shared/schema';
import { getContentTranslation, upsertContentTranslation } from '../storage/contentTranslations';

type MarketText = {
  id: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  category: string | null;
};

type MarketTranslation = Partial<Record<'name' | 'shortDescription' | 'description' | 'category', string>>;

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

// Translation Basic accepts at most 128 q strings per call. Keep the character
// count bounded as well so a long market definition cannot make a huge request.
async function googleTranslate(texts: string[], language: TranslationLanguageCode): Promise<string[]> {
  const key = process.env.GOOGLE_CLOUD_TRANSLATION_API_KEY;
  if (!key) throw new Error('Google Cloud Translation API key is not configured');
  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, source: 'en', target: language, format: 'text' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as {
      error?: { status?: string; errors?: Array<{ reason?: string }> };
    };
    // Never log the response message: Google may include credential details.
    throw new Error(`Google Cloud Translation returned HTTP ${response.status} (${failure.error?.status ?? failure.error?.errors?.[0]?.reason ?? 'unknown'})`);
  }
  const body = await response.json() as { data?: { translations?: Array<{ translatedText?: string }> } };
  const translations = body.data?.translations;
  if (!translations || translations.length !== texts.length || translations.some(t => !t.translatedText?.trim())) {
    throw new Error('Google Cloud Translation returned an incomplete response');
  }
  return translations.map(t => t.translatedText!);
}

/**
 * On-demand public market translation. English records remain canonical; a
 * per-field source hash invalidates only translations whose English text changed.
 * Private market text must never be passed to this function.
 */
export async function translatePublicMarkets(
  markets: MarketText[],
  language: TranslationLanguageCode,
): Promise<Map<string, MarketTranslation>> {
  const cached = await Promise.all(markets.map(m => getContentTranslation('market_google', m.id, language)));
  const results = new Map<string, MarketTranslation>();
  const pending: Array<{ id: string; field: keyof MarketTranslation; source: string }> = [];
  const hashes = new Map<string, Record<string, string>>();

  markets.forEach((market, index) => {
    const fields: MarketTranslation = {};
    const currentHashes: Record<string, string> = {};
    const previous = cached[index];
    for (const field of ['name', 'shortDescription', 'description', 'category'] as const) {
      const source = market[field];
      if (!source?.trim()) continue;
      currentHashes[field] = hash(source);
      const existing = previous?.translatedFields[field];
      if (previous?.sourceFieldHashes?.[field] === currentHashes[field] && existing?.trim()) {
        fields[field] = existing;
      } else {
        pending.push({ id: market.id, field, source });
      }
    }
    hashes.set(market.id, currentHashes);
    results.set(market.id, fields);
  });

  for (let offset = 0; offset < pending.length;) {
    const batch: typeof pending = [];
    let chars = 0;
    while (offset < pending.length && batch.length < 100 &&
      (batch.length === 0 || chars + pending[offset].source.length <= 12000)) {
      batch.push(pending[offset++]);
      chars += batch[batch.length - 1].source.length;
    }
    const translations = await googleTranslate(batch.map(item => item.source), language);
    batch.forEach((item, i) => { results.get(item.id)![item.field] = translations[i]; });
  }

  await Promise.all(markets.filter(m => pending.some(p => p.id === m.id)).map(async market => {
    await upsertContentTranslation({
      contentType: 'market_google',
      contentId: market.id,
      language,
      translatedFields: results.get(market.id)!,
      sourceFieldHashes: hashes.get(market.id)!,
    });
  }));
  return results;
}