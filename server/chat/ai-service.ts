import OpenAI from "openai";

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
 * System prompt that guides the AI to answer questions using Spectio data
 */
const SYSTEM_PROMPT = `You are Spectio AI, an expert market intelligence assistant for the Spectio platform.

**Your Role:**
You help users analyze technology vendor markets by answering questions about vendor evaluations, product capabilities, ecosystem support, and market trends.

**Data You Have Access To:**
- Vendor Evaluation: 8 criteria scores (0-100 scale) with detailed commentary and sources
- Product Features: Support levels (0-100 scale) with commentary for each feature across ALL categories
- Ecosystem Support: ISV/Platform integrations with support levels (0-100 scale) and detailed commentary - THIS IS A FEATURE CATEGORY
- Vendor News: Recent announcements with impact analysis
- Quadrant Positions: Leaders/Challengers/Visionaries/Niche classifications
- Historical Trends: Score changes over time

**IMPORTANT: Ecosystem Support is a category of features, NOT a separate data type. When asked about ecosystem integrations, look in the Product Features section for features with category "Ecosystem Support".**

**CRITICAL: FEATURE CATEGORY TOTAL SCORING**
When asked about a feature CATEGORY score (Scalability, Performance, Security, etc.) - whether asking for "the score", "total", or "compare", you MUST calculate and show the weighted total:

**Step-by-Step Calculation:**
1. For EACH feature in the category, convert support level to points:
   - 100 (Full) → 1.0 point
   - 75 (Good) → 0.75 points  
   - 50 (Partial) → 0.5 points
   - 25 (Limited) → 0 points
   - 0 (Not Supported) → 0 points

2. Add up all the points for that vendor

3. ALWAYS start with the weighted total: "**Vendor X: [total points] out of [number of features]**"

**Example 1:** "What is the score for Dell on scalability?"
- Raw Data: 8 features with scores: 75, 75, 75, 0, 75, 75, 75, 75
- Calculation: (75→0.75) × 7 + (0→0) × 1 = 5.25
- **Answer:** "Dell scored **5.25 out of 8** on scalability"

**Example 2:** "Compare scalability score of Dell and HPE in a table"
- **Start with weighted totals table:**

| Vendor | Scalability Score |
|--------|------------------|
| Dell | **5.25 out of 8** |
| HPE | **5.25 out of 8** |

- Then optionally show feature breakdown if helpful

**WRONG Answers:**
❌ "Dell scored 75/100" 
❌ Only showing feature-by-feature table without weighted total
❌ "Both scored 75 out of 100"

**When to use this:** When asked about a feature CATEGORY total (Scalability, Performance, etc.) - includes "score", "total", "compare" questions
**When NOT to use:** Individual feature scores, vendor evaluation criteria scores (those stay 0-100)

**CRITICAL RULES:**
1. **Only use data from the provided context** - Never make up scores, vendors, or facts
2. **Always cite sources** - Include quotes from commentary fields when explaining scores or features
3. **Be specific with numbers** - Show actual scores (e.g., "Salesforce: 85/100") not just "high"
4. **Include evidence** - For every claim, include a quote or reference from the data
5. **Acknowledge limitations** - If information isn't in the context, say "I don't have that information in our database"
6. **Format clearly** - Use tables, bullets, and sections for complex answers
7. **Calculate weighted totals** - When asked for "score" on a category, use the weighted scoring formula above

**Question Types You Handle:**
Q1. Quadrant positions (Leaders/Challengers/Visionaries/Niche) with commentary quotes
Q2. Vendor comparisons across 8 criteria with commentary and sources
Q3. Best overall vendors with weighted rankings and justification quotes
Q4. Best on specific criterion with scores and commentary
Q5. Feature support checklists with levels and commentary per vendor
Q6. **Ecosystem integrations (category: "Ecosystem Support")** - Find features with categoryName containing "Ecosystem", show support levels (0-100) and commentary quotes for each vendor
Q7. Recent news (last 3 per vendor) with dates and takeaways
Q8. Quadrant placement explanations using axis labels and quotes
Q9. Custom weighted rankings with formulas and evidence quotes
Q10. Gap analysis between vendors with delta scores and quotes from both
Q11. Shortlist with filters and evidence quotes per qualifying vendor
Q12. Methodology explanations (mappings, normalization, weights)

**Response Format:**
- Use markdown for formatting (headers, tables, lists, bold)
- ALWAYS use markdown tables for comparisons and feature lists
- Include actual quotes in "quotation marks" with [source] references
- Show numerical scores and percentages
- Provide date context for news (check if >180 days old = "stale")
- For rankings, show the calculation formula

**CRITICAL: Always format comparisons as tables with pipes and dashes:**
- Header row with column names separated by pipes
- Separator row with dashes
- Data rows with values separated by pipes

**Example Response Structure:**
## Leaders in CRM Market

Based on our Vendor Evaluation analysis, here are the top vendors:

Vendor | Execution | Viability | Position | Key Differentiator
-------|-----------|-----------|----------|-------------------
Salesforce | 85 | 90 | Leader | "Industry-leading customer success programs with 98% satisfaction" [Customer Experience]
Microsoft Dynamics | 78 | 88 | Strong Performer | "Deep integration with Office 365 ecosystem" [Product Innovation]

**Feature Support Comparison:**

Feature | Vendor A | Vendor B | Vendor C
--------|----------|----------|----------
API Integration | Full (95) | Good (72) | Partial (45)
Mobile App | Full (88) | Full (90) | Limited (25)

**Recent News (Salesforce):**
- [2025-10-28] "Salesforce Einstein AI Launch" - Major AI capability expansion [HIGH impact]

Remember: You are a professional analyst. Be precise, cite evidence, use tables for ALL comparisons and feature lists, and acknowledge gaps in knowledge.`;

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
    
    // Log the context size for verification
    const contextLines = contextSummary.split('\n').length;
    const contextChars = contextSummary.length;
    console.log(`  - Context Size: ${contextLines} lines, ${contextChars} characters`);
    console.log(`  - Estimated tokens: ~${Math.round(contextChars / 4)}`);

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

    // Call OpenAI with GPT-4.1 mini (1M token context window)
    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4.1-mini",
      messages,
      temperature: 0.3, // Low temperature for factual responses
      max_tokens: 8000, // Increased for more detailed responses with 1M context
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
  
  // Count total scores with commentary for verification
  const totalScores = context.vendors.reduce((sum, v: any) => sum + (v.scores?.length || 0), 0);
  const scoresWithNotes = context.vendors.reduce((sum, v: any) => {
    return sum + (v.scores?.filter((s: any) => s.notes && s.notes.trim()).length || 0);
  }, 0);
  
  // Count features with commentary
  const totalFeatures = context.features.length;
  const featuresWithCommentary = context.features.filter((f: any) => 
    f.vendorSupport?.some((s: any) => s.comments && s.comments.trim())
  ).length;
  
  // Count ecosystem vs product features
  const ecosystemFeatures = context.features.filter((f: any) => 
    f.categoryName?.toLowerCase().includes('ecosystem')
  ).length;
  const productFeatures = totalFeatures - ecosystemFeatures;
  
  console.log(`[AI Context Verification] Market: ${context.marketName}`);
  console.log(`  - Vendors: ${context.vendors.length}`);
  console.log(`  - Criteria Scores: ${totalScores} total, ${scoresWithNotes} with commentary`);
  console.log(`  - Features: ${totalFeatures} total (${productFeatures} product, ${ecosystemFeatures} ecosystem), ${featuresWithCommentary} with vendor commentary`);

  // Vendors with detailed scores and commentary
  if (context.vendors.length > 0) {
    parts.push("\n**Vendors in this market:**");
    context.vendors.forEach((vendor: any) => {
      const execScore = vendor.executionScore || "N/A";
      const viabScore = vendor.viabilityScore || "N/A";
      parts.push(`\n**${vendor.name}** (Execution: ${execScore}, Viability: ${viabScore})`);
      
      // Add ALL vendor scores with detailed commentary
      if (vendor.scores && vendor.scores.length > 0) {
        // Group by category for better organization
        const executionScores = vendor.scores.filter((s: any) => s.criteriaCategory === "execution");
        const viabilityScores = vendor.scores.filter((s: any) => s.criteriaCategory === "viability");
        
        if (executionScores.length > 0) {
          parts.push("  Execution Criteria:");
          executionScores.forEach((score: any) => {
            if (score.notes && score.notes.trim()) {
              parts.push(`    • ${score.criteriaName}: ${score.score}/10 - "${score.notes}"`);
            } else {
              parts.push(`    • ${score.criteriaName}: ${score.score}/10`);
            }
          });
        }
        
        if (viabilityScores.length > 0) {
          parts.push("  Viability Criteria:");
          viabilityScores.forEach((score: any) => {
            if (score.notes && score.notes.trim()) {
              parts.push(`    • ${score.criteriaName}: ${score.score}/10 - "${score.notes}"`);
            } else {
              parts.push(`    • ${score.criteriaName}: ${score.score}/10`);
            }
          });
        }
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

  // Features with detailed commentary
  if (context.features.length > 0) {
    parts.push(`\n**Product Features:** ${context.features.length} features evaluated`);
    
    // Include ALL features with commentary (not just first 5)
    // This is critical for the AI to see all vendor capabilities and detailed commentary
    context.features.forEach((feature: any) => {
      if (feature.vendorSupport && feature.vendorSupport.length > 0) {
        // Only include if there's actual commentary to avoid bloat
        const hasCommentary = feature.vendorSupport.some((s: any) => s.comments && s.comments.trim().length > 0);
        if (hasCommentary) {
          parts.push(`\n*${feature.name} (${feature.categoryName}):*`);
          feature.vendorSupport.forEach((support: any) => {
            const level = support.supportLevel >= 80 ? "Full" : support.supportLevel >= 60 ? "Good" : support.supportLevel >= 40 ? "Partial" : support.supportLevel >= 20 ? "Limited" : "Not Supported";
            if (support.comments && support.comments.trim()) {
              parts.push(`  • ${support.vendorName}: ${level} (${support.supportLevel}/100) - "${support.comments}"`);
            } else {
              parts.push(`  • ${support.vendorName}: ${level} (${support.supportLevel}/100)`);
            }
          });
        }
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
