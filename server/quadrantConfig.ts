/**
 * Server-side owner of a market's published chart configuration: the saved
 * criteria weights, the three quadrant thresholds and the admin-only
 * weight-version audit trail. Every writer of saved weights (admin market
 * management, market type switches, Market Builder publish, the seed) goes
 * through saveMarketChartConfig() so no change can bypass versioning.
 *
 * The positioning maths itself lives in shared/quadrant-positioning.ts and is
 * shared verbatim with the client chart, the snapshot cron and the exports.
 */
import type { Criteria, InsertMarket, Market, MarketWeightVersion } from "@shared/schema";
import {
  DEFAULT_QUADRANT_THRESHOLDS,
  getDefaultCriterionWeight,
  normalizeThresholds,
  positionVendor,
  resolveEffectiveWeights,
  validateThresholds,
  type PublishedChartConfig,
  type PublishedChartWeightVersion,
  type QuadrantThresholds,
  type VendorPlotPosition,
} from "@shared/quadrant-positioning";
import { storage } from "./storage";
import {
  createMarketWeightVersion,
  getLatestMarketWeightVersion,
  getMarketCriteriaWeights,
  updateMarketCriteriaWeight,
  updateMarketThresholds,
  withCreatedMarket,
  withLockedMarket,
} from "./storage/criteria";
import { updateMarket } from "./storage/markets";
import type { DbExecutor } from "./db";

/** What the chart, the exports and API consumers need to reproduce a dot. */
export type MarketChartConfig = PublishedChartConfig;
export type ChartWeightVersionSummary = PublishedChartWeightVersion;

export interface ChartActor {
  userId?: string | null;
  label: string;
  note?: string;
}

export interface SaveChartConfigInput {
  /** Partial map of criteriaId → weight (0–100). Omitted criteria keep their value. */
  weights?: Record<string, number>;
  thresholds?: QuadrantThresholds;
}

export class ChartConfigError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ChartConfigError";
  }
}

export function thresholdsFromMarket(market: Pick<Market, "executionThresholdLow" | "executionThresholdHigh" | "viabilityThreshold">): QuadrantThresholds {
  return normalizeThresholds({
    executionLow: market.executionThresholdLow,
    executionHigh: market.executionThresholdHigh,
    viability: market.viabilityThreshold,
  });
}

function summarizeVersion(version: MarketWeightVersion | undefined | null): ChartWeightVersionSummary | null {
  if (!version) return null;
  return {
    version: version.version,
    createdAt: new Date(version.createdAt).toISOString(),
    createdByLabel: version.createdByLabel,
    note: version.note ?? null,
  };
}

function sameWeights(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  for (const key of keys) {
    if ((a[key] ?? null) !== (b[key] ?? null)) return false;
  }
  return true;
}

function sameThresholds(a: QuadrantThresholds, b: QuadrantThresholds): boolean {
  return a.executionLow === b.executionLow && a.executionHigh === b.executionHigh && a.viability === b.viability;
}

async function loadMarket(marketId: string): Promise<Market> {
  const market = await storage.getMarketById(marketId);
  if (!market) throw new ChartConfigError("Market not found", 404);
  return market;
}

function buildConfig(
  market: Market,
  criteria: Criteria[],
  savedWeights: { criteriaId: string; weight: number }[],
  latestVersion: MarketWeightVersion | undefined,
): MarketChartConfig {
  const weightsById = resolveEffectiveWeights(criteria, savedWeights, market.marketType);
  return {
    marketId: market.id,
    marketType: market.marketType,
    thresholds: thresholdsFromMarket(market),
    weights: criteria.map((c) => ({ criteriaId: c.id, name: c.name, category: c.category, weight: weightsById[c.id] })),
    weightsById,
    weightVersion: summarizeVersion(latestVersion),
  };
}

export async function getMarketChartConfig(marketId: string, preloadedMarket?: Market): Promise<MarketChartConfig> {
  const market = preloadedMarket ?? (await loadMarket(marketId));
  const [criteria, savedWeights, latestVersion] = await Promise.all([
    storage.getAllCriteria(),
    storage.getMarketCriteriaWeights(market.id),
    storage.getLatestMarketWeightVersion(market.id),
  ]);
  return buildConfig(market, criteria, savedWeights, latestVersion);
}

interface PreparedChartConfigInput {
  criteria: Criteria[];
  weightUpdates: Array<{ criteriaId: string; weight: number }>;
  requestedThresholds?: QuadrantThresholds;
}

/** Validates a save request against the current criteria — before any lock or write. */
async function prepareChartConfigInput(input: SaveChartConfigInput): Promise<PreparedChartConfigInput> {
  const criteria = await storage.getAllCriteria();
  const criteriaById = new Map(criteria.map((c) => [c.id, c]));

  const weightUpdates: Array<{ criteriaId: string; weight: number }> = [];
  if (input.weights) {
    for (const [criteriaId, raw] of Object.entries(input.weights)) {
      if (!criteriaById.has(criteriaId)) throw new ChartConfigError(`Unknown criterion: ${criteriaId}`);
      if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
        throw new ChartConfigError(`Weight for ${criteriaById.get(criteriaId)!.name} must be between 0 and 100.`);
      }
      weightUpdates.push({ criteriaId, weight: Math.round(raw) });
    }
  }
  let requestedThresholds: QuadrantThresholds | undefined;
  if (input.thresholds) {
    // Normalised to the stored precision, so the value compared, persisted
    // and recorded in the version row is one and the same.
    requestedThresholds = normalizeThresholds(input.thresholds);
    const problem = validateThresholds(requestedThresholds);
    if (problem) throw new ChartConfigError(problem);
  }
  return { criteria, weightUpdates, requestedThresholds };
}

/**
 * The write itself. Runs inside the caller's transaction on an already
 * locked (or freshly inserted) market: upserts weights, updates thresholds,
 * and appends a version row when the effective configuration differs from
 * the latest one. Returns the resulting config and whether a version was
 * written (idempotent re-saves write nothing).
 */
async function commitChartConfig(
  tx: DbExecutor,
  market: Market,
  prepared: PreparedChartConfigInput,
  actor: ChartActor,
): Promise<{ config: MarketChartConfig; versionCreated: boolean }> {
  const { criteria, weightUpdates, requestedThresholds } = prepared;
  const savedWeights = await getMarketCriteriaWeights(market.id, tx);
  const latestVersion = await getLatestMarketWeightVersion(market.id, tx);
  const thresholds = requestedThresholds ?? thresholdsFromMarket(market);

  for (const update of weightUpdates) {
    await updateMarketCriteriaWeight(market.id, update.criteriaId, update.weight, tx);
  }
  let updatedMarket = market;
  if (requestedThresholds && !sameThresholds(thresholds, thresholdsFromMarket(market))) {
    updatedMarket = await updateMarketThresholds(market.id, {
      executionThresholdLow: thresholds.executionLow.toFixed(2),
      executionThresholdHigh: thresholds.executionHigh.toFixed(2),
      viabilityThreshold: thresholds.viability.toFixed(2),
    }, tx);
  }

  const mergedSaved = new Map(savedWeights.map((w) => [w.criteriaId, w.weight] as const));
  for (const update of weightUpdates) mergedSaved.set(update.criteriaId, update.weight);
  const mergedSavedList = Array.from(mergedSaved, ([criteriaId, weight]) => ({ criteriaId, weight }));
  const effectiveWeights = resolveEffectiveWeights(criteria, mergedSavedList, updatedMarket.marketType);

  const unchanged =
    !!latestVersion &&
    sameWeights(latestVersion.weights ?? {}, effectiveWeights) &&
    sameThresholds(normalizeThresholds(latestVersion.thresholds), thresholds);

  let version = latestVersion;
  if (!unchanged) {
    version = await createMarketWeightVersion({
      marketId: market.id,
      weights: effectiveWeights,
      criteriaNames: Object.fromEntries(criteria.map((c) => [c.id, c.name])),
      thresholds,
      createdByUserId: actor.userId ?? null,
      createdByLabel: actor.label,
      note: actor.note ?? null,
    }, tx);
  }

  return { config: buildConfig(updatedMarket, criteria, mergedSavedList, version), versionCreated: !unchanged };
}

/**
 * Persists weights and/or thresholds and records a new version when the
 * effective configuration actually changed.
 *
 * Runs in one transaction under a row lock on the market, so two admins (or
 * an admin and a Market Builder republish) saving the same market serialise:
 * the version row always snapshots exactly the weights and thresholds that
 * were committed with it, and version numbers never collide.
 */
export async function saveMarketChartConfig(
  marketId: string,
  input: SaveChartConfigInput,
  actor: ChartActor,
): Promise<{ config: MarketChartConfig; versionCreated: boolean }> {
  const prepared = await prepareChartConfigInput(input);
  return await withLockedMarket(marketId, async (tx, market) => {
    if (!market) throw new ChartConfigError("Market not found", 404);
    return await commitChartConfig(tx, market, prepared, actor);
  });
}

/** Saved weights that make a market's effective weights equal its type defaults. */
function typeDefaultWeights(criteria: Criteria[], marketType: string): Record<string, number> {
  return Object.fromEntries(criteria.map((c) => [c.id, getDefaultCriterionWeight(c.name, marketType)]));
}

/**
 * Creates a market together with its first chart-config version in a single
 * transaction: a market can never exist unversioned, and a failed version
 * write rolls the market back instead of leaving a half-created record.
 * Weights not supplied by the caller start at the market type's defaults.
 */
export async function createMarketWithChartConfig(
  marketData: InsertMarket,
  input: SaveChartConfigInput,
  actor: ChartActor,
): Promise<{ market: Market; config: MarketChartConfig }> {
  const prepared = await prepareChartConfigInput(input);
  return await withCreatedMarket(marketData, async (tx, market) => {
    const { config } = await commitChartConfig(tx, market, prepared, actor);
    return { market: { ...market, ...thresholdColumns(config.thresholds) }, config };
  });
}

/**
 * Updates a market's own fields and its chart configuration atomically. When
 * the market type changes and the caller sent no weights, the saved weights
 * are reset to the new type's defaults so the chart follows the type switch
 * (a saved value always wins over a default, so this must be explicit).
 */
export async function updateMarketWithChartConfig(
  marketId: string,
  marketData: Partial<InsertMarket>,
  input: SaveChartConfigInput,
  actor: ChartActor,
): Promise<{ market: Market; config: MarketChartConfig; versionCreated: boolean }> {
  const prepared = await prepareChartConfigInput(input);
  return await withLockedMarket(marketId, async (tx, previous) => {
    if (!previous) throw new ChartConfigError("Market not found", 404);
    const market = Object.keys(marketData).length ? await updateMarket(marketId, marketData, tx) : previous;
    const typeChanged = !!marketData.marketType && marketData.marketType !== previous.marketType;
    if (typeChanged && !input.weights) {
      const defaults = typeDefaultWeights(prepared.criteria, market.marketType);
      prepared.weightUpdates = Object.entries(defaults).map(([criteriaId, weight]) => ({ criteriaId, weight }));
    }
    const effectiveActor = typeChanged && !actor.note
      ? { ...actor, note: `Market type changed to ${market.marketType}` }
      : actor;
    const result = await commitChartConfig(tx, market, prepared, effectiveActor);
    return { market: { ...market, ...thresholdColumns(result.config.thresholds) }, ...result };
  });
}

function thresholdColumns(t: QuadrantThresholds) {
  return {
    executionThresholdLow: t.executionLow.toFixed(2),
    executionThresholdHigh: t.executionHigh.toFixed(2),
    viabilityThreshold: t.viability.toFixed(2),
  };
}

export async function listMarketWeightVersions(marketId: string): Promise<Array<ChartWeightVersionSummary & {
  weights: Array<{ criteriaId: string; name: string; weight: number }>;
  thresholds: QuadrantThresholds;
}>> {
  const [versions, criteria] = await Promise.all([storage.getMarketWeightVersions(marketId), storage.getAllCriteria()]);
  const currentNames = new Map(criteria.map((c) => [c.id, c.name]));
  return versions.map((v) => ({
    ...(summarizeVersion(v) as ChartWeightVersionSummary),
    thresholds: normalizeThresholds(v.thresholds),
    weights: Object.entries(v.weights ?? {}).map(([criteriaId, weight]) => ({
      criteriaId,
      name: v.criteriaNames?.[criteriaId] ?? currentNames.get(criteriaId) ?? criteriaId,
      weight,
    })),
  }));
}

// ── Initial version seed (idempotent one-off maintenance) ──────────────────

export interface SeedWeightVersionsResult {
  seeded: Array<{ marketId: string; name: string }>;
  alreadyVersioned: number;
  dryRun: boolean;
}

/**
 * Records version 1 for every market that has none yet, from its current
 * effective weights (saved rows, defaults for the rest) and its stored
 * thresholds (the defaults unless an admin already changed them). Safe to run
 * any number of times: markets with a version are skipped. Runs automatically
 * on server boot and can be invoked explicitly (script / admin endpoint).
 */
export async function seedInitialWeightVersions(options: { dryRun?: boolean; marketId?: string } = {}): Promise<SeedWeightVersionsResult> {
  const dryRun = options.dryRun ?? false;
  const [markets, versioned, criteria] = await Promise.all([
    storage.getAllMarkets(),
    storage.getMarketIdsWithWeightVersions(),
    storage.getAllCriteria(),
  ]);
  const candidates = markets.filter((m) => !options.marketId || m.id === options.marketId);
  const targets = candidates.filter((m) => !versioned.has(m.id));
  const seeded: SeedWeightVersionsResult["seeded"] = [];
  for (const market of targets) {
    const savedWeights = await storage.getMarketCriteriaWeights(market.id);
    const weights = resolveEffectiveWeights(criteria, savedWeights, market.marketType);
    if (!dryRun) {
      await storage.createMarketWeightVersion({
        marketId: market.id,
        weights,
        criteriaNames: Object.fromEntries(criteria.map((c) => [c.id, c.name])),
        thresholds: thresholdsFromMarket(market),
        createdByUserId: null,
        createdByLabel: "system",
        note: `Initial version seeded from ${savedWeights.length ? "saved" : "default"} weights`,
      });
    }
    seeded.push({ marketId: market.id, name: market.name });
  }
  return { seeded, alreadyVersioned: candidates.length - targets.length, dryRun };
}

// ── Provenance block (exports + market API) ────────────────────────────────

export interface VendorProvenanceRow extends VendorPlotPosition {
  vendorId: string;
  name: string;
  product: string | null;
  /** The vendor's persisted criterion scores, keyed by criteriaId. */
  scores: Record<string, number>;
}

export interface MarketChartProvenance extends MarketChartConfig {
  marketName: string;
  generatedAt: string;
  scoreScale: { min: number; max: number };
  defaults: { thresholds: QuadrantThresholds };
  vendors: VendorProvenanceRow[];
}

/**
 * Everything needed to rebuild every dot of the published chart from data
 * alone: config + each vendor's own criterion scores and resulting composites,
 * canvas coordinates and box. The Excel export, the vendor-evaluation PDF and
 * the market API all serve this same block.
 */
export async function buildMarketChartProvenance(marketId: string, preloadedMarket?: Market): Promise<MarketChartProvenance> {
  const market = preloadedMarket ?? (await loadMarket(marketId));
  const [config, vendors, scores] = await Promise.all([
    getMarketChartConfig(market.id, market),
    storage.getVendorsByMarket(market.id),
    storage.getMarketVendorScores(market.id),
  ]);
  const criteria = config.weights.map((w) => ({ id: w.criteriaId, name: w.name, category: w.category }));
  const rows: VendorProvenanceRow[] = vendors.map((vendor) => {
    const vendorScores: Record<string, number> = {};
    for (const s of scores) {
      if (s.vendorId !== vendor.id) continue;
      const value = Number(s.score);
      if (Number.isFinite(value)) vendorScores[s.criteriaId] = value;
    }
    return {
      vendorId: vendor.id,
      name: vendor.name,
      product: vendor.product ?? null,
      scores: vendorScores,
      ...positionVendor(criteria, config.weightsById, vendorScores, config.thresholds),
    };
  });
  return {
    ...config,
    marketName: market.name,
    generatedAt: new Date().toISOString(),
    scoreScale: { min: 0, max: 10 },
    defaults: { thresholds: { ...DEFAULT_QUADRANT_THRESHOLDS } },
    vendors: rows,
  };
}
