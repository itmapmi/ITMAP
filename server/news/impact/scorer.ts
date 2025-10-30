import { IMPACT_RULES, BASE_SCORES, type ImpactRule } from './rules';

export interface ImpactScore {
  label: 'high' | 'medium' | 'low';
  score: number;
  confidence: number;
  reasons: string[];
}

interface RuleMatch {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  rule: ImpactRule;
  matches: RegExpMatchArray[];
}

/**
 * Score an article's impact based on title and content using deterministic rules
 */
export function scoreImpact(title: string, content: string): ImpactScore {
  const text = `${title} ${content}`.toLowerCase();
  const matches: RuleMatch[] = [];
  
  // Test all rules and collect matches
  for (const level of ['HIGH', 'MEDIUM', 'LOW'] as const) {
    for (const rule of IMPACT_RULES[level]) {
      const ruleMatches = Array.from(text.matchAll(new RegExp(rule.pattern, 'gi')));
      if (ruleMatches.length > 0) {
        matches.push({ level, rule, matches: ruleMatches });
      }
    }
  }
  
  // If no matches, default to low impact
  if (matches.length === 0) {
    return {
      label: 'low',
      score: 10,
      confidence: 0.3,
      reasons: ['No specific impact indicators found']
    };
  }
  
  // Calculate weighted scores for each level
  const levelScores = {
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0
  };
  
  for (const match of matches) {
    levelScores[match.level] += match.rule.weight * match.matches.length;
  }
  
  // Determine winning level
  const totalScore = levelScores.HIGH + levelScores.MEDIUM + levelScores.LOW;
  let winningLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  let maxScore = 0;
  
  if (levelScores.HIGH > maxScore) {
    maxScore = levelScores.HIGH;
    winningLevel = 'HIGH';
  }
  if (levelScores.MEDIUM > maxScore) {
    maxScore = levelScores.MEDIUM;
    winningLevel = 'MEDIUM';
  }
  if (levelScores.LOW > maxScore) {
    maxScore = levelScores.LOW;
    winningLevel = 'LOW';
  }
  
  // Start with base score
  let finalScore = BASE_SCORES[winningLevel!];
  
  // Add bonus if multiple distinct rules matched in same class
  const distinctRulesMatched = matches.filter(m => m.level === winningLevel).length;
  if (distinctRulesMatched > 1) {
    finalScore += 5;
  }
  
  // Reduce score if conflicting classes with similar weight
  const sortedLevels = Object.entries(levelScores)
    .sort(([, a], [, b]) => (b as number) - (a as number));
  
  if (sortedLevels.length >= 2) {
    const [first, second] = sortedLevels;
    const firstScore = first[1] as number;
    const secondScore = second[1] as number;
    
    // If second place is close (within 20% of first)
    if (secondScore > 0 && secondScore / firstScore > 0.8) {
      finalScore -= 5;
    }
  }
  
  // Clamp to [10, 100]
  finalScore = Math.max(10, Math.min(100, finalScore));
  
  // Calculate confidence
  const confidence = Math.min(1, maxScore / (totalScore || 1));
  
  // Collect reasons
  const reasons = matches
    .filter(m => m.level === winningLevel)
    .map(m => m.rule.description);
  
  return {
    label: winningLevel!.toLowerCase() as 'high' | 'medium' | 'low',
    score: finalScore,
    confidence: parseFloat(confidence.toFixed(2)),
    reasons: Array.from(new Set(reasons)) // Deduplicate
  };
}
