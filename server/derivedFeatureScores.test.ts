/**
 * Persistence-level tests for the derived criteria refresh: rows are written
 * with their coverage audit columns, re-runs are idempotent, an emptied
 * partition removes its stale rows instead of freezing them, and the generic
 * writer gate refuses direct score changes while allowing notes-only saves.
 *
 * Storage is an in-memory stub so the tests run without a database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  vendorId: string;
  criteriaId: string;
  score: string;
  notes: string | null;
  derivedCoverage: string | null;
  derivedFeatureCount: number | null;
};

const MARKET = { id: "m1", name: "Test Market" };
const VENDORS = [
  { id: "v1", name: "Alpha", marketId: MARKET.id },
  { id: "v2", name: "Beta", marketId: MARKET.id },
];
const CRITERIA = [
  { id: "c-pc", name: "Product Capabilities", category: "execution" },
  { id: "c-isv", name: "ISV Ecosystem", category: "execution" },
  { id: "c-rev", name: "Revenue", category: "viability" },
];

const state = {
  features: [] as any[],
  support: [] as any[],
  scores: [] as Row[],
};

let nextId = 1;
const storageStub = {
  getMarketById: vi.fn(async (id: string) => (id === MARKET.id ? MARKET : undefined)),
  getVendorsByMarket: vi.fn(async () => VENDORS),
  getMarketFeatures: vi.fn(async () => state.features),
  getVendorFeatureSupport: vi.fn(async () => state.support),
  getAllCriteria: vi.fn(async () => CRITERIA),
  getMarketVendorScores: vi.fn(async () => state.scores),
  getVendorScores: vi.fn(async (vendorId: string) => state.scores.filter((s) => s.vendorId === vendorId)),
  createOrUpdateVendorScore: vi.fn(async (input: any) => {
    const existing = state.scores.find((s) => s.vendorId === input.vendorId && s.criteriaId === input.criteriaId);
    const patch = {
      score: String(input.score),
      derivedCoverage: input.derivedCoverage === undefined ? null : String(input.derivedCoverage),
      derivedFeatureCount: input.derivedFeatureCount ?? null,
    };
    if (existing) {
      Object.assign(existing, patch, input.notes !== undefined ? { notes: input.notes } : {});
      return existing;
    }
    const row: Row = { id: `s${nextId++}`, vendorId: input.vendorId, criteriaId: input.criteriaId, notes: input.notes ?? null, ...patch };
    state.scores.push(row);
    return row;
  }),
  deleteVendorScoresForCriterion: vi.fn(async (vendorIds: string[], criteriaId: string) => {
    const before = state.scores.length;
    state.scores = state.scores.filter((s) => !(vendorIds.includes(s.vendorId) && s.criteriaId === criteriaId));
    return before - state.scores.length;
  }),
};

vi.mock("./storage", () => ({ storage: storageStub }));

const { refreshDerivedFeatureScores, checkDerivedScoreWrite } = await import("./derivedFeatureScores");

function feature(id: string, categoryId: string, isEcosystem: boolean) {
  return { id, name: id, categoryId, category: { id: categoryId, name: categoryId, isEcosystem, marketId: MARKET.id } };
}

function support(vendorId: string, featureId: string, supportLevel: number) {
  return { vendorId, featureId, supportLevel };
}

beforeEach(() => {
  state.features = [
    feature("p1", "cat-product", false),
    feature("p2", "cat-product", false),
    feature("e1", "cat-eco", true),
  ];
  // Alpha: full product support, half ecosystem. Beta: nothing recorded.
  state.support = [support("v1", "p1", 4), support("v1", "p2", 4), support("v1", "e1", 2)];
  state.scores = [
    { id: "s-rev", vendorId: "v1", criteriaId: "c-rev", score: "7.5", notes: "rubric", derivedCoverage: null, derivedFeatureCount: null },
  ];
  vi.clearAllMocks();
});

describe("refreshDerivedFeatureScores persistence", () => {
  it("writes the reconciled score with its coverage audit columns and is idempotent", async () => {
    const first = await refreshDerivedFeatureScores(MARKET.id);
    expect(first.written).toBe(4); // 2 vendors × 2 derived criteria
    expect(first.removed).toBe(0);
    expect(first.skipped).toEqual([]);

    const alphaPc = state.scores.find((s) => s.vendorId === "v1" && s.criteriaId === "c-pc")!;
    expect(alphaPc.score).toBe("10");
    expect(alphaPc.derivedCoverage).toBe("1");
    expect(alphaPc.derivedFeatureCount).toBe(2);

    const alphaIsv = state.scores.find((s) => s.vendorId === "v1" && s.criteriaId === "c-isv")!;
    expect(alphaIsv.score).toBe("4.5"); // coverage 0.5 → 5 × (0.5 / 0.55) = 4.5
    expect(alphaIsv.derivedCoverage).toBe("0.5");

    const betaPc = state.scores.find((s) => s.vendorId === "v2" && s.criteriaId === "c-pc")!;
    expect(betaPc.score).toBe("0");
    expect(betaPc.derivedCoverage).toBe("0");

    // The rubric-scored row is never touched.
    expect(state.scores.find((s) => s.id === "s-rev")!.score).toBe("7.5");

    const second = await refreshDerivedFeatureScores(MARKET.id);
    expect(second.written).toBe(0);
    expect(second.unchanged).toBe(4);
    expect(storageStub.createOrUpdateVendorScore).toHaveBeenCalledTimes(4);
  });

  it("leaves a placeholder-free market unscored, then removes stale rows once a partition empties", async () => {
    await refreshDerivedFeatureScores(MARKET.id);
    expect(state.scores.filter((s) => s.criteriaId === "c-isv")).toHaveLength(2);

    // The last ecosystem feature is deleted: ISV Ecosystem can no longer be derived.
    state.features = state.features.filter((f) => !f.category.isEcosystem);
    state.support = state.support.filter((s) => s.featureId !== "e1");

    const after = await refreshDerivedFeatureScores(MARKET.id);
    expect(after.removed).toBe(2);
    expect(after.skipped).toHaveLength(1);
    expect(after.skipped[0].kind).toBe("isvEcosystem");
    expect(after.skipped[0].reason).toContain("2 stale row(s) removed");
    expect(state.scores.filter((s) => s.criteriaId === "c-isv")).toHaveLength(0);
    // Product Capabilities is unaffected by the ecosystem partition emptying.
    expect(state.scores.filter((s) => s.criteriaId === "c-pc")).toHaveLength(2);

    // Nothing left to remove on the next run.
    const again = await refreshDerivedFeatureScores(MARKET.id);
    expect(again.removed).toBe(0);
  });

  it("does not write or delete anything in dry-run mode", async () => {
    state.features = state.features.filter((f) => !f.category.isEcosystem);
    state.scores.push({ id: "stale", vendorId: "v1", criteriaId: "c-isv", score: "3", notes: null, derivedCoverage: "0.3", derivedFeatureCount: 4 });

    const summary = await refreshDerivedFeatureScores(MARKET.id, { dryRun: true });
    expect(summary.written).toBe(2);
    expect(summary.removed).toBe(1);
    expect(storageStub.createOrUpdateVendorScore).not.toHaveBeenCalled();
    expect(storageStub.deleteVendorScoresForCriterion).not.toHaveBeenCalled();
    expect(state.scores.find((s) => s.id === "stale")).toBeDefined();
  });

  it("scopes a single-vendor refresh (and its cleanup) to that vendor", async () => {
    await refreshDerivedFeatureScores(MARKET.id);
    state.features = state.features.filter((f) => !f.category.isEcosystem);

    const summary = await refreshDerivedFeatureScores(MARKET.id, { vendorIds: ["v1"] });
    expect(summary.removed).toBe(1);
    expect(state.scores.some((s) => s.vendorId === "v1" && s.criteriaId === "c-isv")).toBe(false);
    expect(state.scores.some((s) => s.vendorId === "v2" && s.criteriaId === "c-isv")).toBe(true);
  });
});

describe("checkDerivedScoreWrite", () => {
  it("allows any write to a rubric-scored criterion", async () => {
    await expect(checkDerivedScoreWrite({ vendorId: "v1", criteriaId: "c-rev", score: 2 })).resolves.toEqual({ allowed: true });
  });

  it("allows a notes-only save that keeps the persisted derived score", async () => {
    await refreshDerivedFeatureScores(MARKET.id);
    await expect(checkDerivedScoreWrite({ vendorId: "v1", criteriaId: "c-isv", score: 4.5 })).resolves.toEqual({ allowed: true });
  });

  it("refuses a changed derived score, and any derived write when no row exists yet", async () => {
    await refreshDerivedFeatureScores(MARKET.id);
    const changed = await checkDerivedScoreWrite({ vendorId: "v1", criteriaId: "c-isv", score: 9 });
    expect(changed.allowed).toBe(false);
    if (!changed.allowed) {
      expect(changed.kind).toBe("isvEcosystem");
      expect(changed.message).toContain("ISV Ecosystem is derived from the feature support matrix");
    }

    state.scores = state.scores.filter((s) => s.criteriaId !== "c-pc");
    const missing = await checkDerivedScoreWrite({ vendorId: "v2", criteriaId: "c-pc", score: 0 });
    expect(missing.allowed).toBe(false);
  });
});
