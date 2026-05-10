/**
 * Unit Parser — classifies a boundary's `unit_of_measurement` string.
 *
 * Three unit kinds:
 *   - "market"    : the unit IS a market size, e.g. "$B revenue", "USD millions ARR".
 *                   Engine values are total-market dollars; no volume multiplier needed.
 *   - "price"     : the unit is a per-X price, e.g. "$ per user per year", "$/TB/month".
 *                   Engine values are PRICE per denominator; a paired volume assumption is
 *                   required to compute total market = price × volume × periodMultiplier.
 *   - "absolute"  : unit-less or non-currency volume, e.g. "units shipped", "MW capacity".
 *                   Treated as today (the value IS the market quantity, no multiplier).
 *
 * The parser is deterministic, regex-driven, and never throws — it falls back to
 * "market" for anything it cannot classify so legacy forecasts keep their behaviour.
 */

export type UnitKind = "price" | "market" | "absolute";

export interface ParsedUnit {
  kind: UnitKind;
  raw: string;
  /** For price units: what the price is "per" (e.g. "user", "TB", "vCPU"). */
  denominator: string | null;
  /** For price units: time period (e.g. "year", "month", "hour"). null if one-shot. */
  period: "year" | "month" | "week" | "day" | "hour" | null;
  /**
   * Multiplier to convert a per-period spend into an annual TAM.
   * Examples: month → 12, hour → 8760, year → 1, null → 1.
   */
  periodMultiplier: number;
}

const PERIOD_MULTIPLIERS: Record<string, { period: ParsedUnit["period"]; multiplier: number }> = {
  year:  { period: "year",  multiplier: 1 },
  yr:    { period: "year",  multiplier: 1 },
  annum: { period: "year",  multiplier: 1 },
  month: { period: "month", multiplier: 12 },
  mo:    { period: "month", multiplier: 12 },
  week:  { period: "week",  multiplier: 52 },
  wk:    { period: "week",  multiplier: 52 },
  day:   { period: "day",   multiplier: 365 },
  hour:  { period: "hour",  multiplier: 8760 },
  hr:    { period: "hour",  multiplier: 8760 },
};

function detectPeriod(s: string): { period: ParsedUnit["period"]; multiplier: number; matched: string | null } {
  const lower = s.toLowerCase();
  // First pass: explicit "per X" or "/X" markers (highest signal).
  for (const key of Object.keys(PERIOD_MULTIPLIERS)) {
    const re = new RegExp(`(?:per\\s+|/|\\-)\\s*${key}\\b`, "i");
    if (re.test(lower)) {
      return { ...PERIOD_MULTIPLIERS[key], matched: key };
    }
  }
  // Second pass: trailing period word with no marker, e.g. "$ per vCPU hour".
  for (const key of Object.keys(PERIOD_MULTIPLIERS)) {
    const re = new RegExp(`\\b${key}\\b\\s*$`, "i");
    if (re.test(lower)) {
      return { ...PERIOD_MULTIPLIERS[key], matched: key };
    }
  }
  return { period: null, multiplier: 1, matched: null };
}

function isMarketUnit(s: string): boolean {
  const lower = s.toLowerCase().trim();
  // Money-magnitude patterns: $B, $M, USD billions, EUR millions, £m revenue, etc.
  if (/(^|\s|\$|€|£|¥)\s*(b\b|m\b|bn\b|mn\b|billion|million|trillion|thousand)\b/.test(lower)) return true;
  if (/(usd|eur|gbp|jpy|cny)\s+(billion|million|trillion|thousand|bn|mn)/.test(lower)) return true;
  if (/\b(revenue|arr|gmv|tam|spend|sales)\b/.test(lower) && !/(per|\/)/i.test(lower)) return true;
  return false;
}

export function parseUnit(raw: string | null | undefined): ParsedUnit {
  const safe = (raw ?? "").trim();
  if (!safe) {
    return { kind: "market", raw: "", denominator: null, period: null, periodMultiplier: 1 };
  }

  const lower = safe.toLowerCase();

  // Price-unit detection: must contain a per-X marker AND a currency-ish prefix or "$".
  // Patterns we accept:
  //   "$ per user per year"   "$/TB/month"   "USD per identity per month"
  //   "$ per vCPU hour"        "EUR/Mbps"     "$/1k calls"
  const hasCurrency = /[\$€£¥]|\b(usd|eur|gbp|jpy|cny|aud|cad)\b/.test(lower);
  const perMatch = lower.match(/(?:per|\/)\s*([a-z0-9_\-]+(?:\s+[a-z0-9_\-]+){0,2})/i);

  if (hasCurrency && perMatch) {
    const period = detectPeriod(safe);
    // Strip the period token from the denominator capture if it was matched as the per-X.
    let denomRaw = perMatch[1].trim();
    if (period.matched && new RegExp(`\\b${period.matched}\\b`, "i").test(denomRaw)) {
      // The first /per X/ matched a period (e.g. "$ per year"). Look for an earlier per-X.
      const allPers = [...lower.matchAll(/(?:per|\/)\s*([a-z0-9_\-]+(?:\s+[a-z0-9_\-]+){0,2})/gi)];
      const nonPeriod = allPers
        .map(m => m[1].trim())
        .find(d => !PERIOD_MULTIPLIERS[d.toLowerCase().split(/\s+/)[0]]);
      denomRaw = nonPeriod ?? denomRaw;
    }
    // Final cleanup: drop trailing period words AND stray "per" tokens inside
    // multi-token denominators (e.g. "user per" → "user", "identity per" → "identity").
    denomRaw = denomRaw
      .split(/\s+/)
      .filter(tok => {
        const lc = tok.toLowerCase();
        return lc !== "per" && lc !== "/" && !PERIOD_MULTIPLIERS[lc];
      })
      .join(" ")
      .trim();

    // If after stripping nothing remains, this is a flat "$ per year" style — treat as market.
    if (!denomRaw) {
      return { kind: "market", raw: safe, denominator: null, period: null, periodMultiplier: 1 };
    }

    return {
      kind: "price",
      raw: safe,
      denominator: denomRaw,
      period: period.period,
      periodMultiplier: period.multiplier,
    };
  }

  if (isMarketUnit(safe)) {
    return { kind: "market", raw: safe, denominator: null, period: null, periodMultiplier: 1 };
  }

  return { kind: "absolute", raw: safe, denominator: null, period: null, periodMultiplier: 1 };
}

/**
 * True if this assumption looks like the auto-volume assumption that pairs with a price unit.
 * We tag those at creation time with currentValueSource = "auto_volume_agent".
 */
export function isVolumeAssumption(currentValueSource: string | null | undefined): boolean {
  return currentValueSource === "auto_volume_agent";
}
