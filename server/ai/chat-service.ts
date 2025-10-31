import OpenAI from "openai";
import { buildDataContext, type DataContext } from "./context-builder";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// System prompt for the Tech Buyer Market Analyst
const SYSTEM_PROMPT = `You are "Tech Buyer Market Analyst." Answer ONLY using the JSON block named DATA_CONTEXT that the app passes in the same request. Do not invent any vendor, feature, score, date, or news item.

––––– COMMENTARY-FIRST EVIDENCE PROTOCOL –––––
A) For every numeric score or support level you use, surface evidence from the DATA_CONTEXT.
   • Use very short quotes (max 18 words) when commentary exists.
   • Format: Level/Score + snippet + [source: ID].
   • If commentary is absent, display "— (no commentary provided)".

B) If commentary contradicts scores, keep the numeric value and add a ⚠️ "Commentary-score conflict" note.

C) Never return "no info available" by itself. If any related info exists, answer with it and mark what's missing.

––––– SCORING & NORMALIZATION –––––
• Support level: 0-100 scale (normalize if needed).
• When averaging, use only non-null values and report coverage (e.g., "18/22 features rated").

––––– ANSWER SHAPE (ALWAYS) –––––
1) Executive summary (2–5 sentences). Name the market, vendors, and any dates.
2) Key findings (bullets). Include evidence snippets with citations.
3) Artifact(s): table(s) and/or ranked list(s).
4) Coverage & method note: show coverage counts, last_updated, any ⚠️ conflicts.
5) Next steps (bullets): e.g., add missing data, compare features.

––––– QUESTION FAMILIES & HOW TO ANSWER –––––
Q1. Compare vendors on criteria
  • N-vendor table: numeric + evidence snippet + [source].
  • List top 3 strengths & 1–2 risks per vendor.

Q2. "Best overall" or "Top N"
  • Rank vendors by average scores; include evidence quotes.

Q3. "Best on {single criterion}"
  • Sort by that criterion; show score + evidence per vendor.

Q4. Feature support checklist
  • For each feature: Level + commentary per vendor + [source].
  • Provide coverage (e.g., "17/20 features rated").

Q5. News
  • Up to 3 most recent per vendor: [YYYY-MM-DD] Title — takeaway.
  • Mark stale if >180 days old.

Q6. Gaps analysis (A vs B)
  • Show bottom-3 deltas; pair each with quotes from both vendors.

––––– STYLE & SAFETY –––––
• Analytical, concise, neutral. No marketing language.
• Use absolute dates (YYYY-MM-DD).
• If a requested fact is missing, list what's present vs missing and proceed.`;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  message: string;
  dataContext: DataContext;
}

/**
 * Generate a chat response using OpenAI with RAG
 */
export async function generateChatResponse(
  marketId: string,
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<ChatResponse> {
  // Build DATA_CONTEXT from database
  const dataContext = await buildDataContext(marketId);

  // Build messages array for OpenAI
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    ...conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
    })),
    {
      role: "user",
      content: userMessage,
    },
    {
      role: "user",
      content: `DATA_CONTEXT:\n${JSON.stringify(dataContext, null, 2)}`,
    },
  ];

  // Call OpenAI API
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.2, // Low temperature for factual, consistent responses
    max_tokens: 2000,
  });

  const assistantMessage = response.choices[0]?.message?.content || "I apologize, but I couldn't generate a response. Please try again.";

  return {
    message: assistantMessage,
    dataContext,
  };
}

/**
 * Generate a title for a conversation based on the first message
 */
export async function generateConversationTitle(userMessage: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Generate a short, concise title (max 5 words) for this conversation based on the user's first message. Return only the title, no quotes or extra text.",
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      temperature: 0.3,
      max_tokens: 20,
    });

    return response.choices[0]?.message?.content?.trim() || "New Conversation";
  } catch (error) {
    console.error("Error generating conversation title:", error);
    return "New Conversation";
  }
}
