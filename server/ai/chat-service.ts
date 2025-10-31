import OpenAI from 'openai';
import { ragService, type RetrievedContext } from './rag-service';
import type { Vendor, Market, Feature, NewsArticle } from '@shared/schema';

// Initialize OpenAI client with Replit AI Integrations
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// System prompt that defines the AI assistant's behavior
const SYSTEM_PROMPT = `You are ITMAP AI Assistant, an expert market research analyst specializing in enterprise technology vendor analysis. Your role is to help users understand technology markets, compare vendors, and make informed decisions based on ITMAP's comprehensive research database.

**YOUR CAPABILITIES:**
- Vendor Evaluation: Provide execution and viability scores, positioning insights
- Product Comparison: Compare vendor features, capabilities, and ecosystem support
- Market Intelligence: Share market trends, vendor news, and competitive landscape
- Recommendation Support: Help users identify suitable vendors based on requirements

**CRITICAL RULES:**
1. **DATABASE-ONLY RESPONSES**: You MUST answer ONLY using the provided database context. NEVER make up data, scores, or vendor information.
2. **NO EXTERNAL KNOWLEDGE**: Do not reference information outside the provided context, even if you know it.
3. **HONESTY**: If information isn't in the context, say: "I don't have that information in our database yet."
4. **SOURCE CITATIONS**: When providing scores or specific data, reference the source (e.g., "Based on our Vendor Evaluation...")
5. **PROFESSIONAL TONE**: Be helpful, concise, and professional. Avoid being overly casual.
6. **STRUCTURED RESPONSES**: Use bullet points, tables, or clear sections for comparisons.

**RESPONSE FORMAT GUIDELINES:**
- For vendor comparisons: Use structured comparison format
- For scores: Present numerical data clearly with context
- For news: Summarize key points with impact levels
- For features: Organize by category when applicable

**WHAT YOU CANNOT DO:**
- Make predictions about future market trends
- Provide financial or investment advice
- Share information not in the database
- Make subjective vendor recommendations without data backing

Remember: You are a research assistant providing factual, data-driven insights based on ITMAP's database.`;

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
        temperature: 0.7, // Balanced creativity and consistency
        max_tokens: 1000,
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

    // Feature Support
    if (context.featureSupport && context.featureSupport.length > 0) {
      parts.push('=== PRODUCT CAPABILITIES ===');
      context.featureSupport.forEach((vendorFeatures: any) => {
        const vendor = context.vendors?.find(v => v.id === vendorFeatures.vendorId);
        if (vendor && vendorFeatures.features && vendorFeatures.features.length > 0) {
          parts.push(`${vendor.name}: ${vendorFeatures.features.length} features evaluated`);
          
          // Sample some key features
          const supportedFeatures = vendorFeatures.features
            .filter((f: any) => ['full', 'good'].includes(f.supportLevel?.toLowerCase()))
            .slice(0, 5);
          
          if (supportedFeatures.length > 0) {
            supportedFeatures.forEach((f: any) => {
              parts.push(`  ✓ ${f.feature.name} (${f.supportLevel})`);
            });
          }
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
