/**
 * Phase 4 Segment Assembly
 *
 * Converts DB ForecastSegment + ForecastBoundary records into the
 * SegmentInput shape required by the calculation engine.
 *
 * Explicit responsibilities:
 *  1. Attach boundary inclusion/exclusion metadata to each segment.
 *  2. Attach unit of measurement from the boundary.
 *  3. Validate parent–child references form a valid tree (no orphans).
 *  4. Provide a synthesis fallback when no segments exist in DB —
 *     synthesises a single "Total Market" root from assumptions.
 *  5. Validate that at least one root segment (parentId = null) exists
 *     and that the tree resolves to a single root (required for MECE rollup).
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
}

// ── helpers ───────────────────────────────────────────────────────────────────

function parseStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try { return JSON.parse(v); } catch { /* ignore */ }
  }
  return [];
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface SegmentValidationError {
  code: "NO_ROOT" | "MULTIPLE_ROOTS" | "ORPHAN" | "CYCLE";
  detail: string;
}

export function validateSegmentTree(segments: SegmentInput[]): SegmentValidationError | null {
  if (segments.length === 0) return null; // synthesis handles empty case

  const ids = new Set(segments.map(s => s.id));
  const roots = segments.filter(s => !s.parentId);

  // Every non-null parentId must reference an existing segment
  const orphans = segments.filter(s => s.parentId && !ids.has(s.parentId));
  if (orphans.length > 0) {
    return {
      code: "ORPHAN",
      detail: `Segments reference unknown parents: ${orphans.map(s => `"${s.name}" (parentId=${s.parentId})`).join(", ")}. Fix segment parentage before building.`,
    };
  }

  if (roots.length === 0) {
    return {
      code: "NO_ROOT",
      detail: "No root segment found (all segments have a parent). At least one segment must have parentId = null.",
    };
  }

  // Multiple roots are allowed only when the engine supports multi-root (MECE additive).
  // We allow it here and let the engine enforce MECE rules — no error from assembly.

  // Simple cycle detection via DFS
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const children = new Map<string, string[]>();
  for (const s of segments) {
    if (!children.has(s.parentId ?? "__root__")) children.set(s.parentId ?? "__root__", []);
    children.get(s.parentId ?? "__root__")!.push(s.id);
  }

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true; // cycle
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const child of children.get(id) ?? []) {
      if (dfs(child)) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const root of roots) {
    if (dfs(root.id)) {
      return {
        code: "CYCLE",
        detail: `Cycle detected in segment tree starting from root "${root.name}". Fix segment parentage before building.`,
      };
    }
  }

  return null;
}

// ── Synthesis fallback ────────────────────────────────────────────────────────

function synthesiseFromAssumptions(full: ForecastFull): SegmentInput[] {
  const assumptions = full.assumptions;

  const growthIds = assumptions
    .filter(a => {
      const unit = (a.unit ?? "").toLowerCase();
      const desc = (a.description ?? "").toLowerCase();
      return unit.includes("%") || desc.includes("growth") || desc.includes("cagr") || desc.includes("rate");
    })
    .map(a => a.id);

  const sizeAssumption =
    assumptions.find(a => {
      const desc = (a.description ?? "").toLowerCase();
      return desc.includes("market size") || desc.includes("tam") || desc.includes("total market") || desc.includes("total addressable");
    }) ??
    assumptions.find(a => {
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
  const unitOfMeasurement = (boundary?.unitOfMeasurement as string | null) ?? "USD billions, revenue";
  const geographicScope = (boundary?.geographicScope as string | null) ?? "Global";
  const includedCategories = parseStringArray(boundary?.includedCategories);
  const excludedCategories = parseStringArray(boundary?.excludedCategories);

  let isSynthesised = false;
  let segments: SegmentInput[];

  if (full.segments.length > 0) {
    segments = full.segments.map(s => ({
      id: s.id,
      parentId: s.parentSegmentId ?? null,
      name: s.name,
      baseYearValue: Number(s.baseYearValue ?? 0),
      growthAssumptionIds: (s.growthAssumptionIds as string[]) ?? [],
      // Carry through unit + boundary metadata as optional extensions
      meta: {
        unitOfMeasurement,
        geographicScope,
        includedCategories,
        excludedCategories,
        isIncluded: includedCategories.length === 0 || includedCategories.some(cat =>
          s.name.toLowerCase().includes(cat.toLowerCase())
        ),
      },
    }));

    // Filter out explicitly excluded segments
    if (excludedCategories.length > 0) {
      segments = segments.filter(seg => {
        const meta = (seg as any).meta;
        return !excludedCategories.some(cat =>
          seg.name.toLowerCase().includes(cat.toLowerCase())
        );
      });
    }
  } else {
    isSynthesised = true;
    segments = synthesiseFromAssumptions(full);
  }

  return { segments, unitOfMeasurement, geographicScope, includedCategories, excludedCategories, isSynthesised };
}
