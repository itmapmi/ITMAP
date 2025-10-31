import OpenAI from "openai";

// Initialize OpenAI client using Replit AI Integrations
// This uses Replit credits instead of requiring your own OpenAI API key
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

export interface ChatContext {
  marketId: string;
  marketName: string;
  vendors: any[];
  criteria: any[];
  features: any[];
  news: any[];
  quadrantData?: any;
}

export interface ChatResponse {
  content: string;
  sources: Array<{
    type: string;
    data: any;
  }>;
}

/**
 * System prompt that guides the AI to answer questions using ITMAP data
 */
const SYSTEM_PROMPT = `You are ITMAP AI, an expert market intelligence assistant for the ITMAP platform.

**Your Role:**
You help users analyze technology vendor markets by answering questions about vendor evaluations, product capabilities, ecosystem support, and market trends.

**Data You Have Access To:**
- Vendor Evaluation: 8 criteria scores (0-100) with detailed commentary and sources
- Product Features: Support levels (0-5) with commentary for each feature
- Ecosystem Integrations: ISV support levels with commentary
- Vendor News: Recent announcements with impact analysis
- Quadrant Positions: Leaders/Challengers/Visionaries/Niche classifications
- Historical Trends: Score changes over time

**CRITICAL RULES:**
1. **Only use data from the provided context** - Never make up scores, vendors, or facts
2. **Always cite sources** - Include quotes from commentary fields when explaining scores or features
3. **Be specific with numbers** - Show actual scores (e.g., "Salesforce: 85/100") not just "high"
4. **Include evidence** - For every claim, include a quote or reference from the data
5. **Acknowledge limitations** - If information isn't in the context, say "I don't have that information in our database"
6. **Format clearly** - Use tables, bullets, and sections for complex answers

**Question Types You Handle:**
Q1. Quadrant positions (Leaders/Challengers/Visionaries/Niche) with commentary quotes
Q2. Vendor comparisons across 8 criteria with commentary and sources
Q3. Best overall vendors with weighted rankings and justification quotes
Q4. Best on specific criterion with scores and commentary
Q5. Feature support checklists with levels and commentary per vendor
Q6. Ecosystem integrations with ISV support levels and commentary
Q7. Recent news (last 3 per vendor) with dates and takeaways
Q8. Quadrant placement explanations using axis labels and quotes
Q9. Custom weighted rankings with formulas and evidence quotes
Q10. Gap analysis between vendors with delta scores and quotes from both
Q11. Shortlist with filters and evidence quotes per qualifying vendor
Q12. Methodology explanations (mappings, normalization, weights)

**Response Format:**
- Use markdown for formatting (headers, tables, lists, bold)
- Include actual quotes in "quotation marks" with [source] references
- Show numerical scores and percentages
- Use tables for comparisons
- Provide date context for news (check if >180 days old = "stale")
- For rankings, show the calculation formula

**Example Response Structure:**
## Leaders in CRM Market

Based on our Vendor Evaluation analysis:

**Salesforce** (Execution: 85, Viability: 90)
- *"Industry-leading customer success programs with 98% satisfaction"* [Customer Experience]
- Position: Leader - Strong execution and vision

**Microsoft Dynamics** (Execution: 78, Viability: 88)
- *"Deep integration with Office 365 ecosystem"* [Product Innovation]
- Position: Strong Performer

Recent News (Salesforce):
- [2025-10-28] "Salesforce Einstein AI Launch" - Major AI capability expansion [HIGH impact]

Remember: You are a professional analyst. Be precise, cite evidence, and acknowledge gaps in knowledge.`;

/**
 * Main function to generate AI responses to user questions
 */
export async function generateChatResponse(
  question: string,
  context: ChatContext,
  conversationHistory: Array<{ role: string; content: string }> = []
): Promise<ChatResponse> {
  try {
    // Build context summary from provided data
    const contextSummary = buildContextSummary(context);

    // Prepare messages for OpenAI
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `Market Context:\n${contextSummary}` },
      ...conversationHistory.slice(-6).map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user", content: question },
    ];

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.3, // Low temperature for factual responses
      max_tokens: 2000,
    });

    const responseContent = completion.choices[0]?.message?.content || "I couldn't generate a response.";

    // Extract sources from the context that were likely used
    const sources = extractRelevantSources(question, context);

    return {
      content: responseContent,
      sources,
    };
  } catch (error) {
    console.error("Error generating chat response:", error);
    throw new Error("Failed to generate response. Please try again.");
  }
}

/**
 * Build a comprehensive context summary from all available data
 */
function buildContextSummary(context: ChatContext): string {
  const parts: string[] = [];

  parts.push(`**Market:** ${context.marketName} (ID: ${context.marketId})`);
  parts.push(`**Total Vendors:** ${context.vendors.length}`);

  // Vendors with scores
  if (context.vendors.length > 0) {
    parts.push("\n**Vendors in this market:**");
    context.vendors.forEach((vendor: any) => {
      const execScore = vendor.executionScore || "N/A";
      const viabScore = vendor.viabilityScore || "N/A";
      parts.push(`- ${vendor.name} (Execution: ${execScore}, Viability: ${viabScore})`);
      
      // Add vendor scores with commentary if available
      if (vendor.scores && vendor.scores.length > 0) {
        vendor.scores.forEach((score: any) => {
          if (score.notes) {
            parts.push(`  • ${score.criteriaName}: ${score.score}/10 - "${score.notes}"`);
          }
        });
      }
    });
  }

  // Criteria information
  if (context.criteria.length > 0) {
    parts.push("\n**Evaluation Criteria:**");
    const execution = context.criteria.filter((c: any) => c.category === "execution");
    const viability = context.criteria.filter((c: any) => c.category === "viability");
    
    if (execution.length > 0) {
      parts.push("*Execution (X-axis):* " + execution.map((c: any) => c.name).join(", "));
    }
    if (viability.length > 0) {
      parts.push("*Viability (Y-axis):* " + viability.map((c: any) => c.name).join(", "));
    }
  }

  // Features
  if (context.features.length > 0) {
    parts.push(`\n**Product Features:** ${context.features.length} features evaluated`);
    parts.push("Features include: " + context.features.slice(0, 10).map((f: any) => f.name).join(", "));
    
    // Add feature support details with commentary
    context.features.slice(0, 5).forEach((feature: any) => {
      if (feature.vendorSupport && feature.vendorSupport.length > 0) {
        parts.push(`\n*${feature.name}:*`);
        feature.vendorSupport.forEach((support: any) => {
          const level = support.supportLevel >= 80 ? "Full" : support.supportLevel >= 60 ? "Good" : support.supportLevel >= 40 ? "Partial" : support.supportLevel >= 20 ? "Limited" : "Not Supported";
          const comment = support.comments ? ` - "${support.comments}"` : "";
          parts.push(`  • ${support.vendorName}: ${level} (${support.supportLevel}/100)${comment}`);
        });
      }
    });
  }

  // Recent news
  if (context.news.length > 0) {
    parts.push(`\n**Recent News:** ${context.news.length} articles`);
    context.news.slice(0, 10).forEach((article: any) => {
      const date = article.publishedAt ? new Date(article.publishedAt).toISOString().split("T")[0] : "Unknown date";
      const impact = article.impactLabel?.toUpperCase() || "UNKNOWN";
      const daysSince = article.publishedAt ? Math.floor((Date.now() - new Date(article.publishedAt).getTime()) / (1000 * 60 * 60 * 24)) : 999;
      const stale = daysSince > 180 ? " [STALE]" : "";
      parts.push(`  • [${date}] ${article.title} - ${impact} impact${stale}`);
      if (article.summary) {
        parts.push(`    "${article.summary}"`);
      }
    });
  }

  // Quadrant data if available
  if (context.quadrantData) {
    parts.push(`\n**Quadrant Classification Available:** Yes`);
  }

  return parts.join("\n");
}

/**
 * Extract relevant sources based on the question and context
 */
function extractRelevantSources(question: string, context: ChatContext): Array<{ type: string; data: any }> {
  const sources: Array<{ type: string; data: any }> = [];
  const questionLower = question.toLowerCase();

  // Check if question is about vendors
  if (questionLower.includes("vendor") || questionLower.includes("compare") || questionLower.includes("best")) {
    sources.push({ type: "vendors", data: context.vendors.slice(0, 5) });
  }

  // Check if question is about criteria/scores
  if (questionLower.includes("score") || questionLower.includes("criteria") || questionLower.includes("evaluation")) {
    sources.push({ type: "criteria", data: context.criteria });
  }

  // Check if question is about features
  if (questionLower.includes("feature") || questionLower.includes("capability") || questionLower.includes("support")) {
    sources.push({ type: "features", data: context.features.slice(0, 10) });
  }

  // Check if question is about news
  if (questionLower.includes("news") || questionLower.includes("recent") || questionLower.includes("announcement")) {
    sources.push({ type: "news", data: context.news.slice(0, 10) });
  }

  // Check if question is about quadrant/position
  if (questionLower.includes("quadrant") || questionLower.includes("leader") || questionLower.includes("challenger") || questionLower.includes("position")) {
    if (context.quadrantData) {
      sources.push({ type: "quadrant", data: context.quadrantData });
    }
  }

  return sources;
}
