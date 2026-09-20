/**
 * Server-side persistence of the feature-derived criteria (Product
 * Capabilities, ISV Ecosystem). The maths lives in
 * shared/derived-feature-scores.ts; this module loads a market's feature list
 * and support matrix, runs that derivation for each vendor, and writes the
 * reconciled score plus the raw coverage roll-up onto the vendor score row.
 *
 * Call `refreshDerivedFeatureScores*` after anything that changes the inputs:
 * Market Builder publish, feature/category edits, support-matrix edits,
 * Excel import, fact-review approvals. Reads never recompute — they use the
 * persisted value.
 */
import { storage } from "./storage";
import {
  DERIVED_CRITERION_NAMES,
  DERIVED_FEATURE_SCORE_KINDS,
  deriveFeatureScore,
  type DerivedFeatureScore,
  type DerivedFeatureScoreKind,
} from "@shared/derived-feature-scores";
import type { Criteria } from "@shared/schema";

export interface DerivedVendorResult {
  vendorId: string;
  vendorName: string;
  kind: DerivedFeatureScoreKind;
  criteriaId: string;
  previousScore: number | null;
  previousCoverage: number | null;
  derived: DerivedFeatureScore;
  /** True when score, coverage or feature count differ from the stored row. */
  changed: boolean;
}

export interface DerivedRefreshSummary {
  marketId: string;
  marketName: string;
  dryRun: boolean;
  vendorsEvaluated: number;
  /** Rows whose persisted value differed and were (or would be) rewritten. */
  written: number;
  unchanged: number;
  /**
   * Stale rows deleted because the market no longer has any feature in that
   * partition (e.g. the last ecosystem feature was removed). A criterion that
   * cannot be derived is left unscored rather than frozen at its old value.
   */
  removed: number;
  skipped: { kind: DerivedFeatureScoreKind; reason: string }[];
  results: DerivedVendorResult[];
}

export interface RefreshDerivedOptions {
  /** Restrict to these vendors (default: every vendor in the market). */
  vendorIds?: string[];
  /** Restrict to these criteria (default: both). */
  kinds?: DerivedFeatureScoreKind[];
  /** Compute and report, but do not write. */
  dryRun?: boolean;
}

/**
 * Resolves the global criterion row for a derived kind. Exact name first;
 * the fallback for ISV deliberately requires "isv" so it can never pick up
 * the viability criterion "Partner Ecosystem".
 */
export function resolveDerivedCriterion(
  allCriteria: Criteria[],
  kind: DerivedFeatureScoreKind,
): Criteria | undefined {
  const canonical = DERIVED_CRITERION_NAMES[kind].toLowerCase();
  const exact = allCriteria.find((c) => c.name.trim().toLowerCase() === canonical);
  if (exact) return exact;
  return allCriteria.find((c) => {
    const name = c.name.toLowerCase();
    return kind === "productCapabilities"
      ? name.includes("product") && name.includes("capabilit")
      : name.includes("isv");
  });
}

/** Which derived criterion a criteria id belongs to, or null for the rubric-scored six. */
export async function getDerivedKindForCriterionId(
  criteriaId: string,
): Promise<DerivedFeatureScoreKind | null> {
  const allCriteria = await storage.getAllCriteria();
  for (const kind of DERIVED_FEATURE_SCORE_KINDS) {
    if (resolveDerivedCriterion(allCriteria, kind)?.id === criteriaId) return kind;
  }
  return null;
}

/**
 * Returns which derived criterion a vendor score row belongs to, or null when
 * it is one of the six rubric-scored criteria. Used to refuse direct manual
 * writes to derived scores.
 */
export async function getDerivedKindForVendorScore(
  vendorScoreId: string,
): Promise<DerivedFeatureScoreKind | null> {
  const row = await storage.getVendorScoreById(vendorScoreId);
  if (!row) return null;
  return getDerivedKindForCriterionId(row.criteriaId);
}

/**
 * Gate for every generic vendor-score writer (admin grid, chart notes editor,
 * AI suggestion approval). Derived criteria accept a write only when it leaves
 * the score exactly as persisted (a notes-only save); any attempt to set a
 * different value is refused with a message the UI can show, because the next
 * refresh would silently revert it anyway.
 */
export async function checkDerivedScoreWrite(input: {
  vendorId: string;
  criteriaId: string;
  score: number;
}): Promise<{ allowed: true } | { allowed: false; kind: DerivedFeatureScoreKind; message: string }> {
  const kind = await getDerivedKindForCriterionId(input.criteriaId);
  if (!kind) return { allowed: true };
  const existing = (await storage.getVendorScores(input.vendorId)).find((s) => s.criteriaId === input.criteriaId);
  if (existing && Number(existing.score) === Number(input.score)) return { allowed: true };
  return {
    allowed: false,
    kind,
    message: `${DERIVED_CRITERION_NAMES[kind]} is derived from the feature support matrix and cannot be set directly — edit the underlying feature support instead`,
  };
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function refreshDerivedFeatureScores(
  marketId: string,
  options: RefreshDerivedOptions = {},
): Promise<DerivedRefreshSummary> {
  const market = await storage.getMarketById(marketId);
  if (!market) throw new Error(`Market ${marketId} not found`);

  const kinds = options.kinds ?? [...DERIVED_FEATURE_SCORE_KINDS];
  const dryRun = options.dryRun === true;

  const [allVendors, features, supportMatrix, allCriteria, existingScores] = await Promise.all([
    storage.getVendorsByMarket(marketId),
    storage.getMarketFeatures(marketId),
    storage.getVendorFeatureSupport(marketId),
    storage.getAllCriteria(),
    storage.getMarketVendorScores(marketId),
  ]);

  const vendorFilter = options.vendorIds ? new Set(options.vendorIds) : null;
  const vendors = vendorFilter ? allVendors.filter((v) => vendorFilter.has(v.id)) : allVendors;

  const existingByKey = new Map(
    existingScores.map((s) => [`${s.vendorId}:${s.criteriaId}`, s] as const),
  );

  const summary: DerivedRefreshSummary = {
    marketId,
    marketName: market.name,
    dryRun,
    vendorsEvaluated: vendors.length,
    written: 0,
    unchanged: 0,
    removed: 0,
    skipped: [],
    results: [],
  };

  for (const kind of kinds) {
    const criterion = resolveDerivedCriterion(allCriteria, kind);
    if (!criterion) {
      summary.skipped.push({ kind, reason: `criterion "${DERIVED_CRITERION_NAMES[kind]}" not found` });
      continue;
    }

    let partitionEmpty = false;
    for (const vendor of vendors) {
      const derived = deriveFeatureScore(vendor.id, features, supportMatrix, kind);
      if (!derived) {
        partitionEmpty = true;
        break;
      }

      const existing = existingByKey.get(`${vendor.id}:${criterion.id}`);
      const previousScore = toNumberOrNull(existing?.score);
      const previousCoverage = toNumberOrNull(existing?.derivedCoverage);
      const previousCount = existing?.derivedFeatureCount ?? null;
      const changed =
        previousScore !== derived.score
        || previousCoverage !== derived.coverage
        || previousCount !== derived.featureCount;

      summary.results.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        kind,
        criteriaId: criterion.id,
        previousScore,
        previousCoverage,
        derived,
        changed,
      });

      if (!changed) {
        summary.unchanged++;
        continue;
      }
      summary.written++;
      if (dryRun) continue;

      // Notes are left untouched: for these criteria they hold analyst /
      // commentary-stage prose, and the audit numbers now have their own columns.
      await storage.createOrUpdateVendorScore({
        vendorId: vendor.id,
        criteriaId: criterion.id,
        score: derived.score,
        derivedCoverage: derived.coverage,
        derivedFeatureCount: derived.featureCount,
      });
    }

    if (partitionEmpty) {
      // Nothing can be derived, so nothing may remain persisted either:
      // otherwise the chart, comparison and exports would keep trusting a
      // value whose inputs no longer exist (or a Stage 2 placeholder).
      const staleVendorIds = vendors
        .filter((v) => existingByKey.has(`${v.id}:${criterion.id}`))
        .map((v) => v.id);
      if (staleVendorIds.length > 0) {
        summary.removed += dryRun
          ? staleVendorIds.length
          : await storage.deleteVendorScoresForCriterion(staleVendorIds, criterion.id);
      }
      summary.skipped.push({
        kind,
        reason: `market has no ${kind === "isvEcosystem" ? "ecosystem" : "product"} features; nothing derived`
          + (staleVendorIds.length ? ` (${staleVendorIds.length} stale row(s) removed)` : ""),
      });
    }
  }

  return summary;
}

/** Refreshes both derived criteria for the market a vendor belongs to. */
export async function refreshDerivedFeatureScoresForVendor(
  vendorId: string,
  options: Omit<RefreshDerivedOptions, "vendorIds"> = {},
): Promise<DerivedRefreshSummary | null> {
  const vendor = await storage.getVendorById(vendorId);
  if (!vendor) return null;
  return refreshDerivedFeatureScores(vendor.marketId, { ...options, vendorIds: [vendorId] });
}

/**
 * Best-effort refresh for request handlers whose primary write has already
 * succeeded: failures are logged loudly but do not turn a saved edit into a
 * 500. Use the direct functions when the caller needs the summary.
 */
export async function refreshDerivedFeatureScoresSafely(
  target: { marketId: string; vendorId?: string } | { vendorId: string; marketId?: undefined },
  context: string,
): Promise<void> {
  try {
    if (target.marketId) {
      await refreshDerivedFeatureScores(target.marketId, target.vendorId ? { vendorIds: [target.vendorId] } : {});
    } else if (target.vendorId) {
      await refreshDerivedFeatureScoresForVendor(target.vendorId);
    }
  } catch (error) {
    console.error(`[derived-scores] refresh after ${context} failed:`, error);
  }
}

export interface DerivedBackfillReport {
  dryRun: boolean;
  markets: DerivedRefreshSummary[];
  totals: { markets: number; written: number; unchanged: number; removed: number };
}

/**
 * Idempotent backfill: re-derives both criteria for every market from the
 * stored support matrix. Running it twice is a no-op the second time.
 */
export async function backfillDerivedFeatureScores(
  options: { dryRun?: boolean; marketIds?: string[]; log?: (line: string) => void } = {},
): Promise<DerivedBackfillReport> {
  const log = options.log ?? (() => {});
  const allMarkets = await storage.getAllMarkets();
  const filter = options.marketIds ? new Set(options.marketIds) : null;
  const markets = filter ? allMarkets.filter((m) => filter.has(m.id)) : allMarkets;

  const report: DerivedBackfillReport = {
    dryRun: options.dryRun === true,
    markets: [],
    totals: { markets: 0, written: 0, unchanged: 0, removed: 0 },
  };

  for (const market of markets) {
    const summary = await refreshDerivedFeatureScores(market.id, { dryRun: options.dryRun });
    report.markets.push(summary);
    report.totals.markets++;
    report.totals.written += summary.written;
    report.totals.unchanged += summary.unchanged;
    report.totals.removed += summary.removed;
    const skipped = summary.skipped.length ? ` skipped: ${summary.skipped.map((s) => s.reason).join("; ")}` : "";
    log(
      `${options.dryRun ? "[dry-run] " : ""}${market.name}: ${summary.vendorsEvaluated} vendors, `
      + `${summary.written} rewritten, ${summary.unchanged} unchanged`
      + (summary.removed ? `, ${summary.removed} stale removed` : "") + `.${skipped}`,
    );
  }

  return report;
}

export interface CriterionDistributionRow {
  marketId: string;
  marketName: string;
  isVisible: boolean;
  criterion: string;
  category: string;
  derived: boolean;
  count: number;
  min: number;
  avg: number;
  max: number;
}

/**
 * Read-only distribution check: per-market min/avg/max of every criterion,
 * so the derived pair can be compared with the six rubric-scored criteria in
 * the same roster.
 */
export async function getCriteriaDistribution(
  options: { visibleOnly?: boolean } = {},
): Promise<CriterionDistributionRow[]> {
  const [markets, allCriteria] = await Promise.all([storage.getAllMarkets(), storage.getAllCriteria()]);
  const derivedIds = new Set(
    DERIVED_FEATURE_SCORE_KINDS
      .map((kind) => resolveDerivedCriterion(allCriteria, kind)?.id)
      .filter((id): id is string => !!id),
  );

  const rows: CriterionDistributionRow[] = [];
  for (const market of markets) {
    if (options.visibleOnly && !market.isVisible) continue;
    const scores = await storage.getMarketVendorScores(market.id);
    for (const criterion of allCriteria) {
      const values = scores
        .filter((s) => s.criteriaId === criterion.id)
        .map((s) => Number(s.score))
        .filter((n) => Number.isFinite(n));
      if (values.length === 0) continue;
      const sum = values.reduce((a, b) => a + b, 0);
      rows.push({
        marketId: market.id,
        marketName: market.name,
        isVisible: market.isVisible === true,
        criterion: criterion.name,
        category: criterion.category,
        derived: derivedIds.has(criterion.id),
        count: values.length,
        min: Math.min(...values),
        avg: Math.round((sum / values.length) * 100) / 100,
        max: Math.max(...values),
      });
    }
  }
  return rows;
}
