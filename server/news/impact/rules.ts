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
      pattern: /\b(acquires?|acquisition|merger|merges with|intent to acquire)\b/i,
      weight: 40,
      description: "Acquisition or Merger"
    },
    {
      pattern: /\b(revenue|earnings|ARR|quarter(ly)? results|financial results|fiscal)\b/i,
      weight: 40,
      description: "Financial Results/Revenue Announcement"
    },
    {
      pattern: /\b(announces?|unveils|introduces|launch(es|ed))\b.*\b(product|platform|solution|suite|service)\b/i,
      weight: 35,
      description: "Product Launch Announcement"
    },
    {
      pattern: /\b(general availability|GA|now available)\b.*\b(product|platform|solution|feature)\b/i,
      weight: 35,
      description: "Product General Availability"
    },
    {
      pattern: /\b(positioned as|named|recognized as)\b.*\b(leader|challenger)\b.*\b(gartner|forrester|idc|marketscape|quadrant)\b/i,
      weight: 30,
      description: "Analyst Recognition (Leader/Challenger)"
    }
  ],
  
  MEDIUM: [
    {
      pattern: /\b(partners? with|partnership|strategic alliance|collaboration with)\b/i,
      weight: 22,
      description: "Partnership Announcement"
    },
    {
      pattern: /\b(appoints?|names?|promotes|hires)\b.*\b(CEO|CFO|CTO|COO|president|VP|executive|director|board)\b/i,
      weight: 20,
      description: "Executive Appointment"
    },
    {
      pattern: /\b(funding|investment|raises|series [A-Z]|venture capital)\b/i,
      weight: 22,
      description: "Funding/Investment Round"
    },
    {
      pattern: /\b(expands?|expansion|enters?|launches in)\b.*\b(market|region|country|geographic)\b/i,
      weight: 18,
      description: "Market/Geographic Expansion"
    },
    {
      pattern: /\b(award|wins?|recognition|achieves?|certification|compliant)\b/i,
      weight: 15,
      description: "Award or Certification"
    }
  ],
  
  LOW: [
    {
      pattern: /\b(join us|register|attend|save the date|invitation|invite|upcoming)\b.*\b(event|webinar|conference|summit|session)\b/i,
      weight: 25,
      description: "Event/Webinar Invitation"
    },
    {
      pattern: /\b(event|conference|summit|webinar|workshop|session|training)\b.*\b(registration|attendees|join|participate)\b/i,
      weight: 25,
      description: "Event Announcement"
    },
    {
      pattern: /\b(blog post|article|guide|whitepaper|case study|ebook|report)\b/i,
      weight: 20,
      description: "Content Publication"
    },
    {
      pattern: /\b(update|patch|maintenance|bug fix|improvement)s?\b/i,
      weight: 15,
      description: "Minor Update or Bug Fix"
    },
    {
      pattern: /\b(podcast|interview|speaking|presenting at)\b/i,
      weight: 15,
      description: "Media Appearance"
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
