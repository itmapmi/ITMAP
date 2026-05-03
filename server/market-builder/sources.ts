/**
 * Handles fetching and extracting content from user-provided sources
 * (public URLs and uploaded file text) to inject into LLM prompts.
 *
 * When sources are present the LLM is instructed to use ONLY those sources.
 * When no sources are present the LLM falls back to its general knowledge.
 */

const MAX_CHARS_PER_SOURCE = 10_000;
const MAX_TOTAL_CHARS = 40_000;

// ── URL fetching ──────────────────────────────────────────────────────────

export async function fetchUrlContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ITMAP Market Research Agent/1.0 (market analysis bot)",
        "Accept": "text/html,text/plain,application/json,*/*",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();

    if (contentType.includes("application/json")) {
      return text.slice(0, MAX_CHARS_PER_SOURCE);
    }

    // Strip HTML tags and collapse whitespace
    const stripped = text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    return stripped.slice(0, MAX_CHARS_PER_SOURCE);
  } catch (err: any) {
    throw new Error(`Failed to fetch URL (${url}): ${err.message}`);
  }
}

// ── Source context builder ────────────────────────────────────────────────

export interface SourceRecord {
  id: string;
  name: string;
  type: string;
  url?: string | null;
  content: string;
  stage?: number | null;
}

/**
 * Builds the source context string to inject into LLM prompts.
 * Includes global sources (stage = null) + stage-specific sources.
 *
 * IMPORTANT: When sources are present, the returned string instructs the LLM
 * to use ONLY those sources — not its training knowledge.
 */
export function buildSourceContext(
  allSources: SourceRecord[],
  currentStage: number
): string {
  const relevant = allSources.filter(
    s => s.stage == null || s.stage === currentStage
  );

  if (relevant.length === 0) return "";

  let totalChars = 0;
  const sections: string[] = [];

  for (const source of relevant) {
    if (totalChars >= MAX_TOTAL_CHARS) break;

    const content = source.content.slice(0, MAX_CHARS_PER_SOURCE);
    totalChars += content.length;

    const label = source.type === "url"
      ? `Source: ${source.name} (${source.url})`
      : `Source: ${source.name} (uploaded file)`;

    sections.push(`--- ${label} ---\n${content}`);
  }

  if (sections.length === 0) return "";

  return (
    "\n\n" +
    "╔══════════════════════════════════════════════════════════════╗\n" +
    "║  MANDATORY INSTRUCTION — READ CAREFULLY BEFORE RESPONDING  ║\n" +
    "║                                                              ║\n" +
    "║  The user has provided specific research sources below.      ║\n" +
    "║  You MUST base your ENTIRE response ONLY on the content     ║\n" +
    "║  of those sources. Do NOT use general knowledge, training   ║\n" +
    "║  data, or any information not explicitly stated in the      ║\n" +
    "║  sources. If a vendor or feature is not mentioned in the    ║\n" +
    "║  sources, state that it is 'not covered in provided         ║\n" +
    "║  sources' rather than guessing.                             ║\n" +
    "╚══════════════════════════════════════════════════════════════╝\n\n" +
    "=== PROVIDED RESEARCH SOURCES ===\n\n" +
    sections.join("\n\n") +
    "\n\n=== END OF PROVIDED SOURCES ===\n"
  );
}
