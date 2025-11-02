import OpenAI from 'openai';
import type { ImpactScore } from './scorer';

// Initialize OpenAI client with Replit AI Integrations
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// System prompt that defines the scoring methodology
const SYSTEM_PROMPT = `You are an expert market research analyst specializing in enterprise technology vendor news analysis. Your task is to analyze news articles and classify their business impact.

**IMPACT CLASSIFICATION METHODOLOGY:**

**HIGH IMPACT (Score: 80-100)**
- Mergers & Acquisitions: Company acquisitions, mergers, or strategic purchases
- Major Financial Results: Quarterly earnings, revenue milestones, ARR announcements
- Major Product Launches: New flagship products, platforms, or major feature releases
- General Availability: Enterprise product GA announcements
- Analyst Recognition: Named as Leader/Challenger in Gartner/Forrester/IDC reports

**MEDIUM IMPACT (Score: 50-79)**
- Strategic Partnerships: Significant technology partnerships or alliances
- Executive Appointments: C-suite, VP, or board member changes
- Funding Rounds: Venture capital, Series funding, major investments
- Market Expansion: Geographic expansion, new market entry
- Industry Awards: Major certifications, compliance achievements, industry recognition

**LOW IMPACT (Score: 10-49)**
- Event Announcements: Webinars, conferences, trade show participation
- Content Publications: Blog posts, whitepapers, case studies, guides
- Minor Updates: Feature updates, patches, bug fixes
- Media Appearances: Podcasts, interviews, speaking engagements
- Community Activities: Training sessions, user groups

**ANALYSIS REQUIREMENTS:**
1. Read the title and content carefully
2. Identify the primary news type
3. Assign impact level based on business significance
4. Provide a score within the range for that level
5. State confidence (0.0-1.0) based on clarity of information
6. List 2-5 specific reasons for your classification

Return ONLY valid JSON with this structure:
{
  "impactLabel": "high" | "medium" | "low",
  "impactScore": number (0-100),
  "confidence": number (0.0-1.0),
  "reasons": string[] (2-5 items),
  "category": string (brief category like "Product Launch", "Partnership", etc.)
}`;

interface AIImpactAnalysis {
  impactLabel: 'high' | 'medium' | 'low';
  impactScore: number;
  confidence: number;
  reasons: string[];
  category: string;
}

/**
 * Score article impact using AI (ChatGPT)
 */
export async function scoreImpactWithAI(
  title: string,
  content: string
): Promise<ImpactScore> {
  try {
    // Truncate content if too long (GPT-4.1 mini has 1M token context, but keep reasonable for news)
    const maxContentLength = 10000;
    const truncatedContent = content.length > maxContentLength 
      ? content.substring(0, maxContentLength) + '...' 
      : content;

    const userPrompt = `Analyze this news article and classify its business impact:

**TITLE:** ${title}

**CONTENT:**
${truncatedContent}

Respond with JSON only.`;

    console.log(`[AI Scorer] Analyzing article: "${title.substring(0, 60)}..."`);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3, // Lower temperature for more consistent results
      max_tokens: 800,
      response_format: { type: 'json_object' }
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new Error('No response from AI');
    }

    // Parse AI response
    const analysis: AIImpactAnalysis = JSON.parse(responseText);

    // Validate and normalize the response
    const impactLabel = normalizeImpactLabel(analysis.impactLabel);
    const impactScore = Math.max(0, Math.min(100, analysis.impactScore || 0));
    const confidence = Math.max(0, Math.min(1, analysis.confidence || 0.5));
    const reasons = Array.isArray(analysis.reasons) 
      ? analysis.reasons.slice(0, 5).filter(r => typeof r === 'string')
      : [];

    console.log(`[AI Scorer] Result: ${impactLabel.toUpperCase()} (score: ${impactScore}, confidence: ${confidence.toFixed(2)})`);

    return {
      label: impactLabel,
      score: impactScore,
      confidence,
      reasons
    };

  } catch (error) {
    console.error('[AI Scorer] Error:', error);
    
    // Fallback to rule-based scoring on error
    console.log('[AI Scorer] Falling back to rule-based scoring');
    const { scoreImpact } = await import('./scorer');
    return scoreImpact(title, content);
  }
}

/**
 * Normalize impact label to ensure consistency
 */
function normalizeImpactLabel(label: string): 'high' | 'medium' | 'low' {
  const normalized = label.toLowerCase().trim();
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'medium';
  if (normalized === 'low') return 'low';
  
  // Default to medium if unclear
  return 'medium';
}

/**
 * Batch score multiple articles (with rate limiting)
 */
export async function batchScoreWithAI(
  articles: Array<{ title: string; content: string }>
): Promise<ImpactScore[]> {
  const results: ImpactScore[] = [];
  
  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const score = await scoreImpactWithAI(article.title, article.content);
    results.push(score);
    
    // Rate limiting: wait 200ms between requests
    if (i < articles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  return results;
}
