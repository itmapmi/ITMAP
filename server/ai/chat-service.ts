import OpenAI from 'openai';
import { ragService, type RetrievedContext } from './rag-service';
import type { Vendor, Market, Feature, NewsArticle } from '@shared/schema';

// Initialize OpenAI client with Replit AI Integrations
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// System prompt that defines the AI assistant's behavior
const SYSTEM_PROMPT = `You are "Tech Buyer Market Analyst," a conversational assistant that answers questions about technology markets using ONLY the information provided in DATA_CONTEXT.

––––– OPERATING RULES –––––
1) Grounding & Truthfulness
   • Use only DATA_CONTEXT. Do not invent vendors, features, scores, news, or dates.
   • If something is missing, say exactly what's missing and propose actionable next steps (e.g., "I have Vendor A, B for Market X but not Vendor C; would you like me to compare A vs B now?").
   • When stating facts, include vendor names, market name, and dates (YYYY‑MM‑DD) when present.
   • Prefer concise, decision‑oriented answers; provide tables for comparisons; provide one‑paragraph executive summary first.

2) Scoring & Normalization
   • Feature support scores are 0-100. Map to labels: Full/Excellent=75-100, Good=50-74, Partial=25-49, Limited=1-24, None=0.
   • Vendor Evaluation criteria are scored 0-10. Normalize to 0-100 by multiplying by 10.
   • When aggregating, use numeric scores; average on available (non‑null) items; report coverage (e.g., "18/22 features scored").
   • Ties: break by (1) higher coverage, then (2) higher Product Capabilities, then (3) higher Customer Experience.

3) Default Weights for Vendor Evaluation (sum=1.0):
   • Product Capabilities: 0.25
   • Customer Experience: 0.15
   • Innovation: 0.15
   • ISV Ecosystem: 0.10
   • Partner Ecosystem: 0.10
   • Pricing Strategy: 0.10
   • Business Model: 0.10
   • Revenue: 0.05

4) Answer Structure (default):
   A) Executive summary (2‑5 sentences, include market & vendor names, explicit dates where relevant)
   B) Key findings (bullets)
   C) Comparison table(s) or ranked list(s)
   D) Method / data coverage notes (one short paragraph)
   E) Next step suggestions (bullets)

5) Coverage‑aware behavior (avoid "no info available")
   • Partial data: answer with what's present; mark missing with "—" and a brief note.
   • Always present at least one helpful artifact (table, ranked list, or bullet insights) even with partial data.
   • If user asks about Vendor/Feature not in DATA_CONTEXT: return nearest alternatives with similar strengths.

6) Question Families & Recipes:
   • "Leaders/Challengers" → Quadrant analysis using execution/viability scores
   • "Compare vendors" → Table with scores + mini‑commentary
   • "Best overall" → Composite score using default weights, ranked
   • "Feature support" → Map levels (Full/Good/Partial/Limited/None) with commentary
   • "News" → 3 most recent items per vendor with date + takeaway
   • "Gaps analysis" → Bottom 3 deltas between vendors
   • "Custom scoring" → Apply user weights, show formula

7) Style
   • Be crisp, neutral, and analytical. No marketing fluff.
   • Use absolute dates (YYYY‑MM‑DD format) instead of "today/yesterday."
   • Include source IDs when available.

8) What you CANNOT do:
   • Make predictions about future trends
   • Provide investment advice
   • Share information not in DATA_CONTEXT
   • Use external knowledge

Remember: Provide factual, data-driven insights. When data is missing, acknowledge it clearly and offer alternatives.`;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  message: string;
  context: RetrievedContext;
  tokensUsed?: number;
}

/**
 * Chat Service - Handles AI-powered conversations using RAG
 */
export class ChatService {
  /**
   * Generate AI response to user query
   */
  async generateResponse(
    userQuery: string,
    conversationHistory: ChatMessage[] = []
  ): Promise<ChatResponse> {
    try {
      console.log(`[Chat Service] Processing query: "${userQuery.substring(0, 60)}..."`);

      // Step 1: Retrieve relevant context from database
      const context = await ragService.retrieveContext(userQuery);
      console.log(`[Chat Service] Context retrieved: ${context.summary}`);

      // Step 2: Build context string for AI
      const contextString = this.buildContextString(context);

      // Step 3: Create messages for OpenAI
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { 
          role: 'system', 
          content: `DATABASE CONTEXT:\n${contextString}\n\nUSE ONLY THE ABOVE CONTEXT TO ANSWER. If information is missing, acknowledge it.` 
        },
        ...conversationHistory.slice(-6), // Include last 3 exchanges for context
        { role: 'user', content: userQuery }
      ];

      // Step 4: Call OpenAI
      console.log(`[Chat Service] Calling OpenAI with ${messages.length} messages`);
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages as any,
        temperature: 0.3, // Lower temperature for analytical, factual responses
        max_tokens: 2000, // Increased for detailed tables and structured responses
      });

      const responseMessage = completion.choices[0]?.message?.content;
      if (!responseMessage) {
        throw new Error('No response from AI');
      }

      console.log(`[Chat Service] Response generated (${completion.usage?.total_tokens || 0} tokens)`);

      return {
        message: responseMessage,
        context,
        tokensUsed: completion.usage?.total_tokens
      };

    } catch (error) {
      console.error('[Chat Service] Error:', error);
      
      // Fallback response on error
      return {
        message: "I'm sorry, I encountered an error processing your request. Please try rephrasing your question or try again later.",
        context: { summary: 'Error occurred' },
        tokensUsed: 0
      };
    }
  }

  /**
   * Build context string from retrieved database data
   */
  private buildContextString(context: RetrievedContext): string {
    const parts: string[] = [];

    // Markets
    if (context.markets && context.markets.length > 0) {
      parts.push('=== MARKETS ===');
      context.markets.forEach(market => {
        parts.push(`- ${market.name}: ${market.description || 'N/A'}`);
        if (market.category) parts.push(`  Category: ${market.category}`);
      });
      parts.push('');
    }

    // Vendors
    if (context.vendors && context.vendors.length > 0) {
      parts.push('=== VENDORS ===');
      context.vendors.forEach(vendor => {
        parts.push(`- ${vendor.name}`);
        if (vendor.description) parts.push(`  Description: ${vendor.description}`);
        if (vendor.product) parts.push(`  Product: ${vendor.product}`);
        if (vendor.revenue) parts.push(`  Revenue: $${vendor.revenue}`);
        if (vendor.website) parts.push(`  Website: ${vendor.website}`);
      });
      parts.push('');
    }

    // Vendor Scores
    if (context.vendorScores && context.vendorScores.length > 0) {
      parts.push('=== VENDOR EVALUATION SCORES ===');
      context.vendorScores.forEach((vendorScore: any) => {
        const vendor = context.vendors?.find(v => v.id === vendorScore.vendorId);
        if (vendor && vendorScore.scores && vendorScore.scores.length > 0) {
          parts.push(`${vendor.name}:`);
          
          // Group by category
          const execution = vendorScore.scores.filter((s: any) => s.category === 'execution');
          const viability = vendorScore.scores.filter((s: any) => s.category === 'viability');
          
          if (execution.length > 0) {
            const avgExecution = execution.reduce((sum: number, s: any) => sum + (s.score || 0), 0) / execution.length;
            parts.push(`  Execution Score: ${avgExecution.toFixed(1)}/100`);
          }
          
          if (viability.length > 0) {
            const avgViability = viability.reduce((sum: number, s: any) => sum + (s.score || 0), 0) / viability.length;
            parts.push(`  Viability Score: ${avgViability.toFixed(1)}/100`);
          }
        }
      });
      parts.push('');
    }

    // Feature Support - Enhanced for comparisons
    if (context.featureSupport && context.featureSupport.length > 0) {
      parts.push('=== PRODUCT FEATURE SUPPORT (0-100 scale) ===');
      
      // Group features by vendor for better comparison
      const featuresByVendor = new Map<string, any[]>();
      context.featureSupport.forEach((fs: any) => {
        if (!featuresByVendor.has(fs.vendor.id)) {
          featuresByVendor.set(fs.vendor.id, []);
        }
        featuresByVendor.get(fs.vendor.id)!.push(fs);
      });
      
      featuresByVendor.forEach((features, vendorId) => {
        const vendor = context.vendors?.find(v => v.id === vendorId);
        if (vendor) {
          parts.push(`\n${vendor.name} - ${features.length} features evaluated:`);
          
          // Sort by support level (highest first) and show top features
          const topFeatures = features
            .sort((a: any, b: any) => (b.supportLevel || 0) - (a.supportLevel || 0))
            .slice(0, 15); // Show more features for better comparison
          
          topFeatures.forEach((f: any) => {
            const supportLevel = f.supportLevel || 0;
            const supportLabel = supportLevel >= 75 ? '✓✓✓' : supportLevel >= 50 ? '✓✓' : supportLevel >= 25 ? '✓' : '○';
            parts.push(`  ${supportLabel} ${f.feature.name}: ${supportLevel}/100`);
            
            // Include detailed comments for context
            if (f.comments && f.comments.length > 0) {
              const shortComment = f.comments.length > 150 
                ? f.comments.substring(0, 150) + '...' 
                : f.comments;
              parts.push(`     → ${shortComment}`);
            }
          });
        }
      });
      parts.push('');
    }

    // Recent News
    if (context.news && context.news.length > 0) {
      parts.push('=== RECENT NEWS & UPDATES ===');
      context.news.slice(0, 10).forEach((article: NewsArticle) => {
        const vendor = context.vendors?.find(v => v.id === article.vendorId);
        const vendorName = vendor?.name || 'Unknown Vendor';
        const impactBadge = article.impactLabel ? `[${article.impactLabel.toUpperCase()}]` : '';
        const date = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : 'N/A';
        
        parts.push(`${impactBadge} ${vendorName} - ${article.title} (${date})`);
        if (article.summary) {
          parts.push(`  ${article.summary.substring(0, 150)}${article.summary.length > 150 ? '...' : ''}`);
        }
      });
      parts.push('');
    }

    if (parts.length === 0) {
      return 'No specific data found in database for this query.';
    }

    return parts.join('\n');
  }
}

// Export singleton instance
export const chatService = new ChatService();
