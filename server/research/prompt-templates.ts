/**
 * Default prompt templates for automated research
 * These can be overridden by user-created templates
 */

export const DEFAULT_PROMPTS = {
  // GPT-4o Deep Research for generating feature categories and features
  FEATURE_GENERATION: {
    name: "Default Feature Generation (GPT-4o Deep Research)",
    description: "Generates comprehensive feature categories and individual features for a market",
    category: "feature_generation",
    aiProvider: "openai",
    model: "gpt-4o",
    variables: ["market_name", "market_description"],
    promptTemplate: `You are a market research expert analyzing the {{market_name}} market.

**Market Context:**
{{market_description}}

**Your Task:**
Generate a comprehensive list of feature categories and specific features that should be evaluated when comparing vendors in this market.

**Output Format (JSON):**
Return ONLY a valid JSON object with this exact structure:
{
  "categories": [
    {
      "name": "Category Name",
      "description": "Brief description of this category",
      "features": [
        {
          "name": "Feature Name",
          "description": "What this feature does and why it matters"
        }
      ]
    }
  ]
}

**Guidelines:**
- Include 5-8 major feature categories
- Each category should have 5-10 specific, measurable features
- Focus on capabilities that differentiate vendors
- Include both core functionality and advanced capabilities
- Consider: Performance, Scalability, Security, Integration, Management, Analytics, Support
- Be specific - "Multi-region deployment" not just "Deployment"
- Each feature should be evaluatable (can assign a support level)

Return ONLY the JSON object, no additional text.`,
  },

  // Perplexity Deep Research for generating detailed commentary
  COMMENTARY_GENERATION: {
    name: "Default Commentary Generation (Perplexity Deep Research)",
    description: "Generates detailed, research-backed commentary for vendor criteria scores using deep research",
    category: "commentary_generation",
    aiProvider: "perplexity",
    model: "sonar-pro", // Perplexity Deep Research model
    variables: ["market_name", "vendor_name", "criteria_name", "criteria_description"],
    promptTemplate: `Conduct deep research and provide detailed commentary about {{vendor_name}}'s performance in {{criteria_name}} for the {{market_name}} market.

**Criteria Context:**
{{criteria_description}}

**Your Task:**
Provide a comprehensive 2-3 paragraph analysis covering:
1. Current capabilities and strengths in this area
2. Specific examples, metrics, or evidence of performance
3. Any notable weaknesses or limitations
4. Recent developments or improvements (if any)

**Requirements:**
- Use deep research to gather recent, factual information from multiple sources
- Include specific examples, numbers, case studies, and customer feedback where possible
- Cite authoritative sources for claims (use your web access extensively)
- Be objective and balanced - cover both strengths and weaknesses
- Focus on verifiable facts, not marketing claims
- Keep it concise but informative (200-300 words)
- Include relevant metrics and comparisons to competitors where available

Provide the commentary directly without preamble.`,
  },

  // GPT-4o for scoring criteria
  SCORING_GENERATION: {
    name: "Default Scoring Generation (GPT-4o)",
    description: "Assigns numerical scores (0-10) to vendor criteria based on commentary",
    category: "scoring",
    aiProvider: "openai",
    model: "gpt-4o",
    variables: ["market_name", "vendor_name", "criteria_name", "criteria_description", "commentary"],
    promptTemplate: `You are evaluating {{vendor_name}} in the {{market_name}} market.

**Criteria:** {{criteria_name}}
{{criteria_description}}

**Available Commentary:**
{{commentary}}

**Your Task:**
Assign a numerical score from 0 to 10 for this criterion.

**Scoring Scale:**
- 9-10: Industry leading, best-in-class capabilities
- 7-8: Strong capabilities, competitive advantage
- 5-6: Adequate capabilities, meets requirements
- 3-4: Limited capabilities, some gaps
- 1-2: Weak capabilities, significant gaps
- 0: Not available or extremely poor

**Output Format (JSON):**
Return ONLY a valid JSON object:
{
  "score": 7.5,
  "justification": "Brief 1-2 sentence explanation of why this score was assigned"
}

Base the score on the evidence in the commentary. Be realistic and objective.
Return ONLY the JSON object, no additional text.`,
  },
};

/**
 * Replace template variables with actual values
 */
export function fillPromptTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let filled = template;
  
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    filled = filled.replaceAll(placeholder, value || "");
  }
  
  return filled;
}

/**
 * Extract variables from a template string
 */
export function extractTemplateVariables(template: string): string[] {
  const matches = template.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  
  return matches.map(m => m.replace(/\{\{|\}\}/g, "").trim());
}
