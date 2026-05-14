import type { DatasheetChangedField, DatasheetSpec } from "@shared/schema";

export interface SpecDiff {
  changedFields: DatasheetChangedField[];
  severity: "low" | "medium" | "high";
  changeType: "added" | "removed" | "changed";
}

// Diff two spec lists from the same product across two datasheet versions.
// Severity is computed deterministically from percentage delta of normalized
// values; non-numeric changes are always "medium".
export function diffSpecs(previous: DatasheetSpec[], next: DatasheetSpec[]): SpecDiff | null {
  const prevMap = new Map(previous.map(s => [`${s.categoryKey}.${s.attributeKey}`, s]));
  const nextMap = new Map(next.map(s => [`${s.categoryKey}.${s.attributeKey}`, s]));
  const changed: DatasheetChangedField[] = [];

  const keys = new Set([...Array.from(prevMap.keys()), ...Array.from(nextMap.keys())]);
  let maxPct = 0;
  let anyTextChange = false;

  for (const key of Array.from(keys)) {
    const a = prevMap.get(key);
    const b = nextMap.get(key);
    const aRaw = a?.rawValue ?? null;
    const bRaw = b?.rawValue ?? null;
    if (aRaw === bRaw) continue;
    const [categoryKey, attributeKey] = key.split(".");
    const aNorm = a?.normalizedValue !== null && a?.normalizedValue !== undefined ? Number(a.normalizedValue) : null;
    const bNorm = b?.normalizedValue !== null && b?.normalizedValue !== undefined ? Number(b.normalizedValue) : null;
    changed.push({
      categoryKey,
      attributeKey,
      before: aRaw,
      after: bRaw,
      beforeNormalized: aNorm,
      afterNormalized: bNorm,
    });
    if (aNorm !== null && bNorm !== null && aNorm !== 0) {
      const pct = Math.abs((bNorm - aNorm) / aNorm);
      if (pct > maxPct) maxPct = pct;
    } else {
      anyTextChange = true;
    }
  }
  if (changed.length === 0) return null;

  let severity: "low" | "medium" | "high" = "low";
  if (maxPct >= 0.25 || anyTextChange) severity = "medium";
  if (maxPct >= 1) severity = "high";

  return { changedFields: changed, severity, changeType: "changed" };
}
