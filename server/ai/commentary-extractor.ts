/**
 * Commentary Extraction Utility for RAG Evidence Protocol
 * 
 * Extracts the best 1-2 sentences from commentary text for use as
 * extractive evidence quotes (6-18 words) in AI responses.
 */

/**
 * Extracts top evidence sentences from commentary text
 * Prefers sentences with strength/risk signals and ideal length
 * 
 * @param text - Full commentary text
 * @param maxSentences - Maximum number of sentences to return (default: 2)
 * @returns Array of best evidence sentences
 */
export function topEvidenceSentences(text: string, maxSentences = 2): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Normalize whitespace and split into sentences
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return [];
  }

  // Scoring heuristic: prefer sentences with signal words and ideal length
  const score = (s: string): number => {
    let points = 0;

    // Prefer sentences with strength/risk signal words (+1 point)
    if (/\b(strong|full|native|deep|improv|lag|lack|limited|gap|risk|roadmap|excellent|weak|robust|partial|good|comprehensive|extensive|superior|inferior)\b/i.test(s)) {
      points += 1;
    }

    // Prefer shorter sentences that fit 6-18 word quote requirement (+0.5 point)
    const wordCount = s.split(/\s+/).length;
    if (wordCount >= 6 && wordCount <= 18) {
      points += 0.5;
    }

    // Prefer sentences with contrast/nuance indicators (+0.25 point)
    if (/\bnot\b|\bhowever\b|\bbut\b|\balthough\b|\bwhile\b|\byet\b|\bthough\b/i.test(s)) {
      points += 0.25;
    }

    // Prefer sentences with specific metrics or details (+0.5 point)
    if (/\d+%|\d+ \w+|version \d+|\b(coverage|support|integration|capability|feature)\b/i.test(s)) {
      points += 0.5;
    }

    return points;
  };

  // Sort by score and return top N
  return sentences
    .sort((a, b) => score(b) - score(a))
    .slice(0, maxSentences);
}

/**
 * Extracts a single best quote from commentary (6-18 words ideal)
 * 
 * @param text - Full commentary text
 * @returns Single best evidence quote or empty string
 */
export function extractBestQuote(text: string): string {
  const sentences = topEvidenceSentences(text, 1);
  
  if (sentences.length === 0) {
    return "";
  }

  const sentence = sentences[0];
  const words = sentence.split(/\s+/);

  // If sentence is already ideal length (6-18 words), return it
  if (words.length >= 6 && words.length <= 18) {
    return sentence;
  }

  // If too short, return as-is
  if (words.length < 6) {
    return sentence;
  }

  // If too long, try to extract a meaningful phrase
  // Look for clauses separated by commas, semicolons, or conjunctions
  const clauses = sentence.split(/[,;]|(?:\b(?:and|but|however|although|while)\b)/i);
  
  for (const clause of clauses) {
    const clauseWords = clause.trim().split(/\s+/);
    if (clauseWords.length >= 6 && clauseWords.length <= 18) {
      return clause.trim();
    }
  }

  // If no good clause found, truncate to first 15 words
  return words.slice(0, 15).join(' ') + '...';
}
