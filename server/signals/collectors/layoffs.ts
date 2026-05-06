/**
 * Layoffs collector — uses OpenAI web_search_preview to find layoff events
 * at the vendor from layoffs.fyi and mainstream news sources.
 */

import OpenAI from 'openai';

export interface LayoffsRawSignal {
  title: string;
  url: string;
  content: string;
  signalDate: Date;
  rawData: Record<string, unknown>;
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

interface LayoffEvent {
  title: string;
  url: string;
  date: string;
  employees_affected: string;
  percentage_affected: string;
  excerpt: string;
}

export async function collectLayoffsSignals(vendorName: string): Promise<LayoffsRawSignal[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const prompt = `Search the web for layoff events at "${vendorName}" since ${ninetyDaysAgo}. Check sources including layoffs.fyi, TechCrunch, Bloomberg, Reuters, The Verge, and major business news outlets.

Return ONLY valid JSON with no markdown fences:
{
  "events": [
    {
      "title": "Descriptive headline about the layoff event",
      "url": "Source URL",
      "date": "YYYY-MM-DD",
      "employees_affected": "3900",
      "percentage_affected": "4%",
      "excerpt": "Brief factual summary of what happened"
    }
  ]
}

Only include confirmed layoffs or significant headcount reductions. Return up to 5 events. If no layoffs occurred at ${vendorName} in the last 90 days, return {"events": []}.`;

  try {
    const responseApi = (getOpenAI() as any).responses;
    if (!responseApi) {
      console.warn('[Layoffs] Responses API not available');
      return [];
    }

    const response = await responseApi.create({
      model: 'gpt-4o-mini',
      tools: [{ type: 'web_search_preview' }],
      input: prompt,
    });

    let rawText = '';
    if (typeof response.output_text === 'string') {
      rawText = response.output_text;
    } else if (Array.isArray(response.output)) {
      for (const item of response.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === 'output_text' || c.type === 'text') rawText += c.text ?? '';
          }
        }
      }
    }

    if (!rawText.trim()) return [];

    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return [];

    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { events?: LayoffEvent[] };
    const events = parsed.events ?? [];

    return events
      .filter(e => e.title && e.url?.startsWith('http'))
      .map(e => ({
        title: e.title,
        url: e.url,
        content: e.excerpt ?? '',
        signalDate: e.date ? new Date(e.date) : new Date(),
        rawData: {
          employeesAffected: e.employees_affected,
          percentageAffected: e.percentage_affected,
        },
      }));
  } catch (err: any) {
    console.warn(`[Layoffs] Collection failed for ${vendorName}: ${err.message}`);
    return [];
  }
}
