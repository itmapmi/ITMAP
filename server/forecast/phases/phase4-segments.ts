/**
 * Phase 4 Segment Assembly
 *
 * Converts DB ForecastSegment + ForecastBoundary records into the
 * SegmentInput shape required by the calculation engine.
 *
 * Explicit responsibilities:
 *  1. Attach boundary inclusion/exclusion metadata to segments (filter excluded).
 *  2. Record unit of measurement and geographic scope from the boundary.
 *  3. Validate parent–child references form a valid tree (no orphans, no cycles).
 *  4. Synthesise a single-root fallback from assumptions when no segments exist in DB.
 *  5. Surface actionable errors for each structural violation rather than silently
 *     continuing — all failures propagate to the Phase 4 pipeline for hard-stop handling.
 */

import type { SegmentInput } from "../engine";
import type { ForecastFull } from "../../storage/forecasts";

export interface SegmentAssemblyResult {
  segments: SegmentInput[];
  unitOfMeasurement: string;
  geographicScope: string;
  includedCategories: string[];
  excludedCategories: string[];
  isSynthesised: boolean;
  rootCount: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function parseStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try { return JSON.parse(v); } catch { /* ignore */ }
  }
  return [];
}

function parseStringArrayField(v: unknown): string[] {
  return parseStringArray(v);
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface SegmentValidationError {
  code: "ORPHAN" | "CYCLE";
  detail: string;
}

export function validateSegmentTree(segments: SegmentInput[]): SegmentValidationError | null {
  if (segments.length === 0) return null;

  const ids = new Set(segments.map(s => s.id));

  // Every non-null parentId must reference an existing segment
  const orphans = segments.filter(s => s.parentId !== null && !ids.has(s.parentId));
  if (orphans.length > 0) {
    return {
      code: "ORPHAN",
      detail:
        `${orphans.length} segment(s) reference unknown parents: ` +
        orphans.slice(0, 3).map(s => `"${s.name}" (parentId=${s.parentId})`).join(", ") +
        (orphans.length > 3 ? "…" : "") +
        ". Fix segment parentage before building.",
    };
  }

  // Cycle detection via DFS
  const childrenMap = new Map<string, string[]>();
  const rootKey = "__root__";
  for (const s of segments) {
    const key = s.parentId ?? rootKey;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(s.id);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const child of childrenMap.get(id) ?? []) {
      if (dfs(child)) return true;
    }
    inStack.delete(id);
    return false;
  }

  // Traverse ALL nodes — not just roots — so disconnected cycles (all nodes
  // have parents that form a cycle with no root) are also detected.
  for (const segment of segments) {
    if (!visited.has(segment.id)) {
      if (dfs(segment.id)) {
        return {
          code: "CYCLE",
          detail: `Cycle detected in segment tree (disconnected component containing "${segment.name}"). Fix segment parentage before building.`,
        };
      }
    }
  }

  return null;
}

// ── Synthesis fallback ────────────────────────────────────────────────────────

function synthesiseFromAssumptions(full: ForecastFull): SegmentInput[] {
  const growthIds = full.assumptions
    .filter(a => {
      const unit = (a.unit ?? "").toLowerCase();
      const desc = (a.description ?? "").toLowerCase();
      return unit.includes("%") || desc.includes("growth") || desc.includes("cagr") || desc.includes("rate");
    })
    .map(a => a.id);

  const sizeAssumption =
    full.assumptions.find(a => {
      const desc = (a.description ?? "").toLowerCase();
      return (
        desc.includes("market size") ||
        desc.includes("tam") ||
        desc.includes("total market") ||
        desc.includes("total addressable")
      );
    }) ??
    full.assumptions.find(a => {
      const unit = (a.unit ?? "").toLowerCase();
      return unit.includes("$") || unit.includes("b") || unit.includes("usd");
    });

  const baseValue = sizeAssumption
    ? Math.abs(Number(sizeAssumption.currentValue ?? sizeAssumption.value ?? 0))
    : 0;

  return [
    {
      id: `synth-root-${full.id}`,
      parentId: null,
      name: "Total Market",
      baseYearValue: baseValue,
      growthAssumptionIds: growthIds,
    },
  ];
}

// ── Main assembly ─────────────────────────────────────────────────────────────

export function assembleSegments(full: ForecastFull): SegmentAssemblyResult {
  const boundary = full.boundary;
  const unitOfMeasurement =
    typeof boundary?.unitOfMeasurement === "string"
      ? boundary.unitOfMeasurement
      : "USD billions, revenue";
  const geographicScope =
    typeof boundary?.geographicScope === "string" ? boundary.geographicScope : "Global";
  const includedCategories = parseStringArrayField(boundary?.includedCategories);
  const excludedCategories = parseStringArrayField(boundary?.excludedCategories);

  let isSynthesised = false;
  let segments: SegmentInput[];

  if (full.segments.length > 0) {
    // Build typed SegmentInput list — no any casts on individual records
    const allSegments: SegmentInput[] = full.segments.map(s => ({
      id: s.id,
      parentId: s.parentSegmentId ?? null,
      name: s.name,
      baseYearValue: Number(s.baseYearValue ?? 0),
      growthAssumptionIds: Array.isArray(s.growthAssumptionIds)
        ? (s.growthAssumptionIds as string[]).filter(id => typeof id === "string")
        : [],
    }));

    if (excludedCategories.length === 0) {
      segments = allSegments;
    } else {
      // Step 1: identify all segment IDs whose name matches an exclusion
      const childrenMap = new Map<string, string[]>();
      for (const s of allSegments) {
        if (s.parentId) {
          if (!childrenMap.has(s.parentId)) childrenMap.set(s.parentId, []);
          childrenMap.get(s.parentId)!.push(s.id);
        }
      }

      const excludedIds = new Set<string>();

      function markExcludedSubtree(id: string) {
        excludedIds.add(id);
        for (const childId of (childrenMap.get(id) ?? [])) {
          markExcludedSubtree(childId); // recurse to exclude full sub-tree
        }
      }

      for (const seg of allSegments) {
        if (excludedCategories.some(cat => seg.name.toLowerCase().includes(cat.toLowerCase()))) {
          markExcludedSubtree(seg.id);
        }
      }

      segments = allSegments.filter(s => !excludedIds.has(s.id));
    }

    // Deterministic parent rollup: parent's baseYearValue = sum of its children.
    // This ensures MECE consistency regardless of what was stored in the DB.
    // Computed bottom-up (post-order traversal) so multi-level trees work correctly.
    const segById = new Map(segments.map(s => [s.id, { ...s }]));
    const segChildrenMap = new Map<string, string[]>();
    for (const s of segments) {
      if (s.parentId && segById.has(s.parentId)) {
        if (!segChildrenMap.has(s.parentId)) segChildrenMap.set(s.parentId, []);
        segChildrenMap.get(s.parentId)!.push(s.id);
      }
    }

    function rollupBaseValue(id: string): number {
      const children = segChildrenMap.get(id) ?? [];
      if (children.length === 0) {
        return segById.get(id)?.baseYearValue ?? 0; // leaf: use DB value
      }
      const childSum = children.reduce((sum, cid) => sum + rollupBaseValue(cid), 0);
      segById.get(id)!.baseYearValue = childSum; // parent: override with child sum
      return childSum;
    }

    for (const s of segments.filter(seg => !seg.parentId)) {
      rollupBaseValue(s.id); // post-order from each root
    }
    segments = [...segById.values()];
  } else {
    isSynthesised = true;
    segments = synthesiseFromAssumptions(full);
  }

  const rootCount = segments.filter(s => !s.parentId).length;

  return {
    segments,
    unitOfMeasurement,
    geographicScope,
    includedCategories,
    excludedCategories,
    isSynthesised,
    rootCount,
  };
}
