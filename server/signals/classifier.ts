/**
 * Sentiment classifier — GPT-4o-mini classifies each raw signal's
 * sentiment, sentiment_score, and impact_label.
 */

import OpenAI from 'openai';

export interface ClassificationResult {
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  sentimentScore: number; // -1.0 to 1.0
  impactLabel: 'HIGH' | 'MEDIUM' | 'LOW';
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

export async function classifySignal(
  sourceType: string,
  title: string,
  content: string
): Promise<ClassificationResult> {
  const prompt = `You are an enterprise technology market analyst. Classify this ${sourceType} signal about a technology vendor.

Title: ${title}
Content: ${content ? content.slice(0, 500) : '(no content excerpt)'}

Return ONLY valid JSON with no markdown:
{
  "sentiment": "positive",
  "sentiment_score": 0.75,
  "impact_label": "MEDIUM"
}

Rules:
- sentiment: "positive" (growth/praise/feature launch), "negative" (criticism/outage/layoff/churn), "neutral" (factual/informational), "mixed" (both positive and negative aspects)
- sentiment_score: -1.0 (very negative) to +1.0 (very positive), 0.0 = neutral
- impact_label:
  HIGH: Layoffs >1000 employees, major acquisitions, funding >$100M, flagship product failures, leadership crisis, critical security incidents
  MEDIUM: Layoffs <1000, product deprecations, significant customer issues, notable partnerships, moderate funding rounds, pricing changes
  LOW: Blog posts, minor features, general discussions, routine updates, single user complaints`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 100,
    });

    const raw = response.choices[0]?.message?.content ?? '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON in response');

    const parsed = JSON.parse(cleaned.slice(start, end + 1));

    const sentimentOptions = ['positive', 'negative', 'neutral', 'mixed'] as const;
    const sentiment = sentimentOptions.includes(parsed.sentiment) ? parsed.sentiment : 'neutral';
    const sentimentScore = Math.max(-1, Math.min(1, parseFloat(parsed.sentiment_score) || 0));
    const impactOptions = ['HIGH', 'MEDIUM', 'LOW'] as const;
    const impactLabel = impactOptions.includes(parsed.impact_label?.toUpperCase())
      ? parsed.impact_label.toUpperCase()
      : 'LOW';

    return { sentiment, sentimentScore, impactLabel };
  } catch (err: any) {
    console.warn(`[Classifier] Failed for "${title.slice(0, 60)}": ${err.message} — defaulting to neutral/LOW`);
    return { sentiment: 'neutral', sentimentScore: 0, impactLabel: 'LOW' };
  }
}
