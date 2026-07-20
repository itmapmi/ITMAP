import { storage } from "../storage";
import type { MarketBuilderStage } from "@shared/schema";
import type { Stage1Result } from "./stages/stage1";

// Excel/CSV import for the AI Market Builder workflow.
// Each stage (2-9) has a simple, row-based template. Imported rows are validated,
// mapped to the internal stage result shapes, and written to market_builder_stages.
// Commentary stages (3, 6, 9) automatically backfill their scoring stage (2, 5, 8).

export interface StageImportOptions {
  jobId: string;
  stageNum: number;
  buffer: Buffer;
  fileName?: string;
}

export interface StageImportResult {
  /** Stage numbers that were updated and their results. */
  updates: Array<{ stageNum: number; result: unknown }>;
  summary: {
    rowsRead: number;
    rowsValid: number;
    errors: string[];
    warnings: string[];
  };
}

export async function parseStageImport(opts: StageImportOptions): Promise<StageImportResult> {
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(opts.buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    throw new Error("Uploaded file has no sheets");
  }
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, any>[];

  const job = await storage.getMarketBuilderJobWithStages(opts.jobId);
  if (!job) throw new Error("Job not found");
  const stage1 = (job.stages.find(s => s.stage === 1)?.result ?? { vendors: [] }) as Stage1Result;
  const vendorNames = new Set(stage1.vendors.map(v => v.name));
  const allCriteria = await storage.getAllCriteria();
  const criteriaByName = new Map(allCriteria.map(c => [c.name.toLowerCase(), c]));

  const summary = { rowsRead: rows.length, rowsValid: 0, errors: [] as string[], warnings: [] as string[] };

  const reportError = (rowIdx: number, msg: string) => summary.errors.push(`Row ${rowIdx + 2}: ${msg}`);
  const reportWarning = (rowIdx: number, msg: string) => summary.warnings.push(`Row ${rowIdx + 2}: ${msg}`);

  const updates: Array<{ stageNum: number; result: unknown }> = [];

  switch (opts.stageNum) {
    case 2: {
      updates.push({ stageNum: 2, result: parseVendorScoring(rows, vendorNames, criteriaByName, summary, reportError, reportWarning) });
      break;
    }
    case 3: {
      const full = parseVendorCommentary(rows, vendorNames, criteriaByName, summary, reportError, reportWarning);
      updates.push({ stageNum: 3, result: full });
      // Backfill stage 2 scoring-only result from the same rows.
      const scoringOnly = {
        criteriaWeights: full.criteriaWeights,
        scores: full.scores.map(({ vendorName, criterionName, score }) => ({ vendorName, criterionName, score })),
      };
      updates.push({ stageNum: 2, result: scoringOnly });
      break;
    }
    case 4: {
      updates.push({ stageNum: 4, result: parseFeatureList(rows, "Product", summary, reportError, reportWarning) });
      break;
    }
    case 5: {
      const stage4 = job.stages.find(s => s.stage === 4)?.result as any;
      updates.push({
        stageNum: 5,
        result: parseFeatureSupport(
          rows, 5, stage4?.categories ?? [], vendorNames, summary, reportError, reportWarning
        ),
      });
      break;
    }
    case 6: {
      const stage4 = job.stages.find(s => s.stage === 4)?.result as any;
      const full = parseFeatureSupport(
        rows, 6, stage4?.categories ?? [], vendorNames, summary, reportError, reportWarning
      );
      updates.push({ stageNum: 6, result: full });
      // Backfill stage 5 scoring-only result.
      updates.push({
        stageNum: 5,
        result: {
          support: full.support.map(({ vendorName, categoryName, featureName, supportLevel }) => ({
            vendorName, categoryName, featureName, supportLevel, comments: "", sources: [],
          })),
        },
      });
      break;
    }
    case 7: {
      updates.push({ stageNum: 7, result: parseFeatureList(rows, "Ecosystem", summary, reportError, reportWarning) });
      break;
    }
    case 8: {
      const stage7 = job.stages.find(s => s.stage === 7)?.result as any;
      const categories = stage7?.categories ?? extractCategoriesFromSupport(rows);
      if (!stage7?.categories && categories.length > 0) {
        summary.warnings.push("No Stage 7 categories found; categories were reconstructed from the import rows.");
      }
      updates.push({
        stageNum: 8,
        result: parseFeatureSupport(
          rows, 8, categories, vendorNames, summary, reportError, reportWarning
        ),
      });
      break;
    }
    case 9: {
      const stage7 = job.stages.find(s => s.stage === 7)?.result as any;
      const categories = stage7?.categories ?? extractCategoriesFromSupport(rows);
      if (!stage7?.categories && categories.length > 0) {
        summary.warnings.push("No Stage 7 categories found; categories were reconstructed from the import rows.");
      }
      const full = parseFeatureSupport(
        rows, 9, categories, vendorNames, summary, reportError, reportWarning
      );
      updates.push({ stageNum: 9, result: full });
      // Backfill stage 8 scoring result.
      updates.push({
        stageNum: 8,
        result: {
          categories,
          support: full.support.map(({ vendorName, categoryName, featureName, supportLevel }) => ({
            vendorName, categoryName, featureName, supportLevel, comments: "", sources: [],
          })),
        },
      });
      break;
    }
    default:
      throw new Error(`Import not supported for stage ${opts.stageNum}`);
  }

  if (summary.errors.length > 0) {
    throw new ImportValidationError(summary.errors.slice(0, 20).join("\n"), summary);
  }

  return { updates, summary };
}

export class ImportValidationError extends Error {
  constructor(message: string, public readonly summary: StageImportResult["summary"]) {
    super(message);
    this.name = "ImportValidationError";
  }
}

// ── Stage 2 / 3: Vendor scoring & commentary ───────────────────────────────

interface VendorScoreRow {
  vendorName: string;
  criterionName: string;
  criterionCategory?: string;
  weight?: number;
  scoringRationale?: string;
  score: number;
  commentary?: string;
  sources?: string[];
}

function parseVendorScoring(
  rows: Record<string, any>[],
  vendorNames: Set<string>,
  criteriaByName: Map<string, { id: string; name: string; category: string; description: string | null }>,
  summary: StageImportResult["summary"],
  reportError: (rowIdx: number, msg: string) => void,
  reportWarning: (rowIdx: number, msg: string) => void,
) {
  const parsedRows = parseVendorScoreRows(rows, vendorNames, criteriaByName, summary, reportError, reportWarning, false);
  return buildVendorResult(parsedRows, criteriaByName, summary);
}

function parseVendorCommentary(
  rows: Record<string, any>[],
  vendorNames: Set<string>,
  criteriaByName: Map<string, { id: string; name: string; category: string; description: string | null }>,
  summary: StageImportResult["summary"],
  reportError: (rowIdx: number, msg: string) => void,
  reportWarning: (rowIdx: number, msg: string) => void,
) {
  const parsedRows = parseVendorScoreRows(rows, vendorNames, criteriaByName, summary, reportError, reportWarning, true);
  return buildVendorResult(parsedRows, criteriaByName, summary);
}

function parseVendorScoreRows(
  rows: Record<string, any>[],
  vendorNames: Set<string>,
  criteriaByName: Map<string, { id: string; name: string; category: string; description: string | null }>,
  summary: StageImportResult["summary"],
  reportError: (rowIdx: number, msg: string) => void,
  reportWarning: (rowIdx: number, msg: string) => void,
  requireCommentary: boolean,
): VendorScoreRow[] {
  const out: VendorScoreRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const vendorName = cleanString(row["Vendor Name"] ?? row["Vendor"] ?? row["vendorName"])
      || cleanString(row["VendorName"]);
    const criterionName = cleanString(row["Criterion Name"] ?? row["Criterion"] ?? row["criterionName"])
      || cleanString(row["CriterionName"]);
    const rawScore = row["Score"] ?? row["score"];

    if (!vendorName) { reportError(i, "Missing Vendor Name"); continue; }
    if (!criterionName) { reportError(i, "Missing Criterion Name"); continue; }
    if (!vendorNames.has(vendorName)) { reportError(i, `Vendor "${vendorName}" not found in Stage 1 vendor list`); continue; }

    const score = parseNumber(rawScore);
    if (score === null || score < 0 || score > 10) {
      reportError(i, `Score must be a number between 0 and 10 (got "${rawScore}")`);
      continue;
    }

    const commentary = cleanString(row["Commentary"] ?? row["Comment"] ?? row["commentary"]);
    if (requireCommentary && !commentary) {
      reportError(i, "Missing Commentary");
      continue;
    }

    const criterion = criteriaByName.get(criterionName.toLowerCase());
    const category = cleanString(row["Criterion Category"] ?? row["Category"] ?? row["criterionCategory"] ?? row["category"])
      || (criterion?.category ?? "execution");
    const weight = parseNumber(row["Weight"] ?? row["weight"]) ?? 10;
    const scoringRationale = cleanString(row["Scoring Rationale"] ?? row["Rationale"] ?? row["scoringRationale"] ?? row["rationale"]);
    const sources = parseSources(row["Sources"] ?? row["sources"] ?? row["Source"]);

    out.push({
      vendorName,
      criterionName,
      criterionCategory: category,
      weight,
      scoringRationale,
      score,
      commentary,
      sources,
    });
    summary.rowsValid++;
  }

  return out;
}

function buildVendorResult(
  rows: VendorScoreRow[],
  criteriaByName: Map<string, { id: string; name: string; category: string; description: string | null }>,
  summary: StageImportResult["summary"],
) {
  // Build criteria weights from distinct criteria in the import.
  const weightMap = new Map<string, VendorScoreRow>();
  for (const row of rows) {
    if (!weightMap.has(row.criterionName)) {
      weightMap.set(row.criterionName, row);
    }
  }
  const criteriaWeights = Array.from(weightMap.values()).map(row => ({
    criterionId: criteriaByName.get(row.criterionName.toLowerCase())?.id ?? row.criterionName,
    criterionName: row.criterionName,
    criterionCategory: row.criterionCategory ?? "execution",
    weight: row.weight ?? 10,
    scoringRationale: row.scoringRationale ?? "",
  }));

  const scores = rows.map(row => ({
    vendorName: row.vendorName,
    criterionName: row.criterionName,
    score: row.score,
    commentary: row.commentary ?? "",
    sources: row.sources ?? [],
  }));

  if (criteriaWeights.length === 0) summary.warnings.push("No criteria weights were found in the import.");
  return { criteriaWeights, scores };
}

// ── Stage 4 / 7: Category + feature list ───────────────────────────────────

interface FeatureListRow {
  categoryName: string;
  categoryDescription: string;
  featureName: string;
  featureDescription: string;
}

function parseFeatureList(
  rows: Record<string, any>[],
  kind: "Product" | "Ecosystem",
  summary: StageImportResult["summary"],
  reportError: (rowIdx: number, msg: string) => void,
  _reportWarning: (rowIdx: number, msg: string) => void,
) {
  const categoryMap = new Map<string, { name: string; description: string; features: FeatureListRow[] }>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const categoryName = cleanString(row["Category Name"] ?? row["Category"] ?? row["categoryName"] ?? row["category"]);
    const featureName = cleanString(row["Feature Name"] ?? row["Feature"] ?? row["featureName"] ?? row["feature"]);

    if (!categoryName) { reportError(i, "Missing Category Name"); continue; }
    if (!featureName) { reportError(i, "Missing Feature Name"); continue; }

    const categoryDescription = cleanString(row["Category Description"] ?? row["CategoryDescription"] ?? row["categoryDescription"]);
    const featureDescription = cleanString(row["Feature Description"] ?? row["FeatureDescription"] ?? row["featureDescription"]);

    const existing = categoryMap.get(categoryName);
    if (existing) {
      existing.features.push({ categoryName, categoryDescription, featureName, featureDescription });
    } else {
      categoryMap.set(categoryName, {
        name: categoryName,
        description: categoryDescription,
        features: [{ categoryName, categoryDescription, featureName, featureDescription }],
      });
    }
    summary.rowsValid++;
  }

  const categories = Array.from(categoryMap.values()).map(c => ({
    name: c.name,
    description: c.description,
    features: c.features.map(f => ({ name: f.featureName, description: f.featureDescription })),
  }));

  if (categories.length === 0) summary.warnings.push(`No ${kind} categories were found in the import.`);
  return { categories };
}

// ── Stage 5 / 6 / 8 / 9: Feature support scoring & commentary ──────────────

interface FeatureSupportRow {
  vendorName: string;
  categoryName: string;
  featureName: string;
  supportLevel: 0 | 1 | 2 | 3 | 4;
  comments: string;
  sources: string[];
}

function parseFeatureSupport(
  rows: Record<string, any>[],
  stage: 5 | 6 | 8 | 9,
  categories: { name: string; description: string; features: { name: string; description?: string }[] }[],
  vendorNames: Set<string>,
  summary: StageImportResult["summary"],
  reportError: (rowIdx: number, msg: string) => void,
  _reportWarning: (rowIdx: number, msg: string) => void,
) {
  const validFeatures = new Set<string>();
  for (const cat of categories) {
    for (const f of cat.features) {
      validFeatures.add(`${cat.name}::${f.name}`);
    }
  }
  const isScoring = stage === 5 || stage === 8;

  const support: FeatureSupportRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const vendorName = cleanString(row["Vendor Name"] ?? row["Vendor"] ?? row["vendorName"] ?? row["vendor"]);
    const categoryName = cleanString(row["Category Name"] ?? row["Category"] ?? row["categoryName"] ?? row["category"]);
    const featureName = cleanString(row["Feature Name"] ?? row["Feature"] ?? row["featureName"] ?? row["feature"]);
    const rawLevel = row["Support Level"] ?? row["Support"] ?? row["supportLevel"] ?? row["support"] ?? row["Level"] ?? row["level"];

    if (!vendorName) { reportError(i, "Missing Vendor Name"); continue; }
    if (!categoryName) { reportError(i, "Missing Category Name"); continue; }
    if (!featureName) { reportError(i, "Missing Feature Name"); continue; }
    if (!vendorNames.has(vendorName)) { reportError(i, `Vendor "${vendorName}" not found in Stage 1 vendor list`); continue; }

    const supportLevel = parseHarveyBall(rawLevel);
    if (supportLevel === null) {
      reportError(i, `Support Level must be 0-4 or ✕/◔/◑/◕/● (got "${rawLevel}")`);
      continue;
    }

    const featureKey = `${categoryName}::${featureName}`;
    if (validFeatures.size > 0 && !validFeatures.has(featureKey)) {
      reportError(i, `Feature "${featureName}" in category "${categoryName}" is not defined in the feature list`);
      continue;
    }

    const comments = cleanString(row["Comments"] ?? row["Comment"] ?? row["comments"] ?? row["comment"]);
    if (!isScoring && !comments) {
      reportError(i, "Missing Comments");
      continue;
    }
    const sources = parseSources(row["Sources"] ?? row["sources"] ?? row["Source"]);

    support.push({ vendorName, categoryName, featureName, supportLevel, comments: comments ?? "", sources });
    summary.rowsValid++;
  }

  return stage === 5 || stage === 6
    ? { support }
    : { categories, support };
}

function extractCategoriesFromSupport(rows: Record<string, any>[]) {
  const catMap = new Map<string, { name: string; description: string; features: { name: string; description: string }[] }>();
  for (const row of rows) {
    const categoryName = cleanString(row["Category Name"] ?? row["Category"] ?? row["categoryName"] ?? row["category"]);
    const featureName = cleanString(row["Feature Name"] ?? row["Feature"] ?? row["featureName"] ?? row["feature"]);
    if (!categoryName || !featureName) continue;
    const cat = catMap.get(categoryName) ?? { name: categoryName, description: "", features: [] };
    if (!cat.features.find(f => f.name === featureName)) {
      cat.features.push({ name: featureName, description: "" });
    }
    catMap.set(categoryName, cat);
  }
  return Array.from(catMap.values());
}

// ── Utilities ─────────────────────────────────────────────────────────────

function cleanString(value: any): string | undefined {
  if (value === null || value === undefined) return undefined;
  const str = String(value).trim();
  return str.length > 0 ? str : undefined;
}

function parseNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function parseHarveyBall(value: any): 0 | 1 | 2 | 3 | 4 | null {
  const n = parseNumber(value);
  if (n !== null && n >= 0 && n <= 4 && Number.isInteger(n)) return n as 0 | 1 | 2 | 3 | 4;
  const str = String(value).trim();
  const map: Record<string, 0 | 1 | 2 | 3 | 4> = {
    "✕": 0, "none": 0, "0": 0, "no": 0,
    "◔": 1, "limited": 1, "1": 1,
    "◑": 2, "partial": 2, "2": 2,
    "◕": 3, "good": 3, "3": 3,
    "●": 4, "full": 4, "4": 4,
  };
  return map[str.toLowerCase()] ?? null;
}

function parseSources(value: any): string[] {
  if (value === null || value === undefined || value === "") return [];
  const str = String(value);
  // Split on newlines or pipe characters; keep non-empty URLs.
  return str
    .split(/\r?\n|\|/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ── Template generation ───────────────────────────────────────────────────

export async function generateStageTemplate(stageNum: number): Promise<Buffer> {
  const xlsx = await import("xlsx");
  const headers = templateHeaders(stageNum);
  const ws = xlsx.utils.aoa_to_sheet([headers]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Template");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
}

function templateHeaders(stageNum: number): string[] {
  switch (stageNum) {
    case 2: return ["Vendor Name", "Criterion Name", "Criterion Category", "Weight", "Scoring Rationale", "Score"];
    case 3: return ["Vendor Name", "Criterion Name", "Criterion Category", "Weight", "Scoring Rationale", "Score", "Commentary", "Sources"];
    case 4: return ["Category Name", "Category Description", "Feature Name", "Feature Description"];
    case 5: return ["Vendor Name", "Category Name", "Feature Name", "Support Level"];
    case 6: return ["Vendor Name", "Category Name", "Feature Name", "Support Level", "Comments", "Sources"];
    case 7: return ["Category Name", "Category Description", "Feature Name", "Feature Description"];
    case 8: return ["Vendor Name", "Category Name", "Feature Name", "Support Level"];
    case 9: return ["Vendor Name", "Category Name", "Feature Name", "Support Level", "Comments", "Sources"];
    default: throw new Error(`No template for stage ${stageNum}`);
  }
}
