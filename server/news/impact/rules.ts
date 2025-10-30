// Impact scoring rules for news articles
// Based on exact specification for High/Medium/Low classification

export interface ImpactRule {
  pattern: RegExp;
  weight: number;
  description: string;
}

export interface ImpactRuleSet {
  HIGH: ImpactRule[];
  MEDIUM: ImpactRule[];
  LOW: ImpactRule[];
}

// Rule definitions with weights
export const IMPACT_RULES: ImpactRuleSet = {
  HIGH: [
    {
      pattern: /\b(announces?|unveils|introduces|launch(es|ed)|general availability|GA)\b/i,
      weight: 30,
      description: "Product/Feature Launch Announcement"
    },
    {
      pattern: /\b(acquires?|acquisition|merger|merges with)\b/i,
      weight: 35,
      description: "Acquisition or Merger"
    },
    {
      pattern: /\b(revenue|earnings|ARR|quarter(ly)? results|guidance)\b/i,
      weight: 35,
      description: "Financial Results/Revenue Announcement"
    },
    {
      pattern: /\b(major (update|release)|platform|suite)\b/i,
      weight: 30,
      description: "Major Platform/Suite Update"
    },
    {
      pattern: /\b(feature|adds support for|capability)\b.*\b(major|platform|overhaul|suite|v2\.0|GA|generally available)\b/i,
      weight: 30,
      description: "Major Feature Announcement"
    }
  ],
  
  MEDIUM: [
    {
      pattern: /\b(minor|incremental|patch|maintenance) (update|release|enhancement)s?\b/i,
      weight: 20,
      description: "Minor Update/Enhancement"
    },
    {
      pattern: /\b(partners? with|partnership|integration with)\b/i,
      weight: 20,
      description: "Partnership Announcement"
    },
    {
      pattern: /\b(feature|adds support for|capability)\b.*\b(improvement|beta|preview|minor updates?)\b/i,
      weight: 15,
      description: "Minor Feature Enhancement"
    }
  ],
  
  LOW: [
    {
      pattern: /\b(appoints?|names?) (CEO|CFO|CTO|COO|executive|board)\b/i,
      weight: 15,
      description: "Executive Appointment"
    },
    {
      pattern: /\b(enters?|expands? to|launches in) (the )?(market|region|country)\b/i,
      weight: 15,
      description: "Market Expansion"
    }
  ]
};

// Base scores for each impact level
export const BASE_SCORES = {
  HIGH: 90,
  MEDIUM: 60,
  LOW: 25
};

// Export as JSON-serializable object for API endpoint
export function getRulesAsJSON() {
  return {
    HIGH: IMPACT_RULES.HIGH.map(r => ({
      pattern: r.pattern.source,
      weight: r.weight,
      description: r.description
    })),
    MEDIUM: IMPACT_RULES.MEDIUM.map(r => ({
      pattern: r.pattern.source,
      weight: r.weight,
      description: r.description
    })),
    LOW: IMPACT_RULES.LOW.map(r => ({
      pattern: r.pattern.source,
      weight: r.weight,
      description: r.description
    }))
  };
}
