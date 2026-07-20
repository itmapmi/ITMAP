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

  const hasExportSheets =
    workbook.SheetNames.includes("Vendor Evaluation") &&
    workbook.SheetNames.includes("Product Evaluation") &&
    workbook.SheetNames.includes("ISV Ecosystem");

  const job = await storage.getMarketBuilderJobWithStages(opts.jobId);
  if (!job) throw new Error("Job not found");
  const stage1 = (job.stages.find(s => s.stage === 1)?.result ?? { vendors: [] }) as Stage1Result;
  const vendorNames = new Set(stage1.vendors.map(v => v.name));
  const allCriteria = await storage.getAllCriteria();
  const criteriaByName = new Map(allCriteria.map(c => [c.name.toLowerCase(), c]));

  const summary = { rowsRead: 0, rowsValid: 0, errors: [] as string[], warnings: [] as string[] };
  const reportError = (rowIdx: number, msg: string) => summary.errors.push(`Row ${rowIdx + 2}: ${msg}`);
  const reportWarning = (rowIdx: number, msg: string) => summary.warnings.push(`Row ${rowIdx + 2}: ${msg}`);

  const updates: Array<{ stageNum: number; result: unknown }> = [];

  if (hasExportSheets) {
    // New three-tab market-export format.
    switch (opts.stageNum) {
      case 2: {
        const sheet = workbook.Sheets["Vendor Evaluation"];
        const rows = xlsx.utils.sheet_to_json(sheet) as Record<string, any>[];
        summary.rowsRead = rows.length;
        updates.push({ stageNum: 2, result: parseExportVendorEvalSheet(xlsx, sheet, vendorNames, criteriaByName, summary, reportError, reportWarning, false) });
        break;
      }
      case 3: {
        const sheet = workbook.Sheets["Vendor Evaluation"];
        const rows = xlsx.utils.sheet_to_json(sheet) as Record<string, any>[];
        summary.rowsRead = rows.length;
        const full = parseExportVendorEvalSheet(xlsx, sheet, vendorNames, criteriaByName, summary, reportError, reportWarning, true);
        updates.push({ stageNum: 3, result: full });
        updates.push({
          stageNum: 2,
          result: {
            criteriaWeights: full.criteriaWeights,
            scores: full.scores.map(({ vendorName, criterionName, score }: any) => ({ vendorName, criterionName, score })),
          },
        });
        break;
      }
      case 4: {
        const sheet = workbook.Sheets["Product Evaluation"];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        summary.rowsRead = Math.max(0, rows.length - 1);
        updates.push({ stageNum: 4, result: parseExportFeatureSheet(xlsx, sheet, 4, vendorNames, summary, reportError, reportWarning) });
        break;
      }
      case 5: {
        const sheet = workbook.Sheets["Product Evaluation"];
        const rows = xlsx.utils.sheet_to_json(sheet) as Record<string, any>[];
        summary.rowsRead = rows.length;
        updates.push({ stageNum: 5, result: parseExportFeatureSheet(xlsx, sheet, 5, vendorNames, summary, reportError, reportWarning) });
        break;
      }
      case 6: {
        const sheet = workbook.Sheets["Product Evaluation"];
        const rows = xlsx.utils.sheet_to_json(sheet) as Record<string, any>[];
        summary.rowsRead = rows.length;
        const full = parseExportFeatureSheet(xlsx, sheet, 6, vendorNames, summary, reportError, reportWarning);
        updates.push({ stageNum: 6, result: full });
        updates.push({
          stageNum: 5,
          result: {
            support: full.support.map(({ vendorName, categoryName, featureName, supportLevel }: any) => ({
              vendorName, categoryName, featureName, supportLevel, comments: "", sources: [],
            })),
          },
        });
        break;
      }
      case 7: {
        const sheet = workbook.Sheets["ISV Ecosystem"];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        summary.rowsRead = Math.max(0, rows.length - 1);
        updates.push({ stageNum: 7, result: parseExportFeatureSheet(xlsx, sheet, 7, vendorNames, summary, reportError, reportWarning) });
        break;
      }
      case 8: {
        const sheet = workbook.Sheets["ISV Ecosystem"];
        const rows = xlsx.utils.sheet_to_json(sheet) as Record<string, any>[];
        summary.rowsRead = rows.length;
        updates.push({ stageNum: 8, result: parseExportFeatureSheet(xlsx, sheet, 8, vendorNames, summary, reportError, reportWarning) });
        break;
      }
      case 9: {
        const sheet = workbook.Sheets["ISV Ecosystem"];
        const rows = xlsx.utils.sheet_to_json(sheet) as Record<string, any>[];
        summary.rowsRead = rows.length;
        const full = parseExportFeatureSheet(xlsx, sheet, 9, vendorNames, summary, reportError, reportWarning);
        updates.push({ stageNum: 9, result: full });
        updates.push({
          stageNum: 8,
          result: {
            categories: full.categories,
            support: full.support.map(({ vendorName, categoryName, featureName, supportLevel }: any) => ({
              vendorName, categoryName, featureName, supportLevel, comments: "", sources: [],
            })),
          },
        });
        break;
      }
      default:
        throw new Error(`Import not supported for stage ${opts.stageNum}`);
    }
  } else {
    // Legacy single-sheet "Template" format (kept for backward compatibility).
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      throw new Error("Uploaded file has no sheets");
    }
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, any>[];
    summary.rowsRead = rows.length;

    switch (opts.stageNum) {
      case 2: {
        updates.push({ stageNum: 2, result: parseVendorScoring(rows, vendorNames, criteriaByName, summary, reportError, reportWarning) });
        break;
      }
      case 3: {
        const full = parseVendorCommentary(rows, vendorNames, criteriaByName, summary, reportError, reportWarning);
        updates.push({ stageNum: 3, result: full });
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

// ── Export-format import helpers ────────────────────────────────────────────

function parseExportVendorEvalSheet(
  xlsx: any,
  sheet: any,
  vendorNames: Set<string>,
  criteriaByName: Map<string, { id: string; name: string; category: string; description: string | null }>,
  summary: StageImportResult["summary"],
  reportError: (rowIdx: number, msg: string) => void,
  reportWarning: (rowIdx: number, msg: string) => void,
  requireNotes: boolean,
) {
  const rows = xlsx.utils.sheet_to_json(sheet) as Record<string, any>[];
  const out: VendorScoreRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const vendorName = cleanString(row["Vendor Name"]);
    if (!vendorName) { reportError(i, "Missing Vendor Name"); continue; }
    if (!vendorNames.has(vendorName)) { reportError(i, `Vendor "${vendorName}" not found in Stage 1 vendor list`); continue; }

    for (const colName of Object.keys(row)) {
      if (colName === "Vendor Name" || colName === "Product" || colName.endsWith(" - Notes")) continue;
      const criterionName = colName;
      const criterion = criteriaByName.get(criterionName.toLowerCase());
      if (!criterion) { reportWarning(i, `Unknown criterion "${criterionName}"`); continue; }
      const rawScore = row[colName];
      if (rawScore === "" || rawScore === undefined || rawScore === null) continue;
      const score = parseNumber(rawScore);
      if (score === null || score < 0 || score > 10) {
        reportError(i, `Score for "${criterionName}" must be a number between 0 and 10 (got "${rawScore}")`);
        continue;
      }
      const notes = cleanString(row[`${colName} - Notes`]);
      if (requireNotes && !notes) {
        reportError(i, `Missing notes for "${criterionName}"`);
        continue;
      }
      out.push({
        vendorName,
        criterionName,
        criterionCategory: criterion.category,
        weight: 10,
        scoringRationale: "",
        score,
        commentary: notes,
        sources: [],
      });
      summary.rowsValid++;
    }
  }

  return buildVendorResult(out, criteriaByName, summary);
}

function extractCategoriesFromFeatureCols(
  featureCols: string[],
  featureToCategory: Map<string, string>,
) {
  const catMap = new Map<string, { name: string; description: string; features: { name: string; description: string }[] }>();
  for (const featureName of featureCols) {
    const categoryName = featureToCategory.get(featureName) || "Uncategorized";
    const cat = catMap.get(categoryName) || { name: categoryName, description: "", features: [] };
    if (!cat.features.find(f => f.name === featureName)) {
      cat.features.push({ name: featureName, description: "" });
    }
    catMap.set(categoryName, cat);
  }
  return Array.from(catMap.values());
}

function parseExportFeatureSheet(
  xlsx: any,
  sheet: any,
  stage: 4 | 5 | 6 | 7 | 8 | 9,
  vendorNames: Set<string>,
  summary: StageImportResult["summary"],
  reportError: (rowIdx: number, msg: string) => void,
  reportWarning: (rowIdx: number, msg: string) => void,
) {
  const rowsRaw = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
  const header = (rowsRaw[0] || []).filter(Boolean) as string[];
  const featureCols = header.filter(h => h && h !== "Vendor Name" && h !== "Category" && !h.endsWith(" - Comments"));

  const categoryIdx = header.indexOf("Category");
  const featureToCategory = new Map<string, string>();
  for (let i = 1; i < rowsRaw.length; i++) {
    const row = rowsRaw[i];
    if (!row || categoryIdx < 0 || !row[categoryIdx]) continue;
    const categoryName = String(row[categoryIdx]).trim();
    for (let j = 0; j < header.length; j++) {
      const h = header[j];
      if (!h || h === "Vendor Name" || h === "Category" || h.endsWith(" - Comments")) continue;
      if (row[j] !== "" && row[j] !== undefined && row[j] !== null) {
        featureToCategory.set(h, categoryName);
      }
    }
  }

  if (stage === 4 || stage === 7) {
    const categories = extractCategoriesFromFeatureCols(featureCols, featureToCategory);
    if (categories.length === 0) summary.warnings.push(`No ${stage === 4 ? "Product" : "Ecosystem"} categories found in the sheet.`);
    return { categories };
  }

  const isScoring = stage === 5 || stage === 8;
  const rows = xlsx.utils.sheet_to_json(sheet) as Record<string, any>[];
  const support: FeatureSupportRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const vendorName = cleanString(row["Vendor Name"]);
    const categoryName = cleanString(row["Category"]);
    if (!vendorName) { reportError(i, "Missing Vendor Name"); continue; }
    if (!categoryName) { reportError(i, "Missing Category"); continue; }
    if (!vendorNames.has(vendorName)) { reportError(i, `Vendor "${vendorName}" not found in Stage 1 vendor list`); continue; }

    for (const colName of Object.keys(row)) {
      if (colName === "Vendor Name" || colName === "Category" || colName.endsWith(" - Comments")) continue;
      const featureName = colName;
      const rawLevel = row[colName];
      if (rawLevel === "" || rawLevel === undefined || rawLevel === null) continue;
      const supportLevel = parseHarveyBall(rawLevel);
      if (supportLevel === null) {
        reportError(i, `Support level for "${featureName}" must be 0-4 or ✕/◔/◑/◕/● (got "${rawLevel}")`);
        continue;
      }
      const comments = cleanString(row[`${colName} - Comments`]);
      if (!isScoring && !comments) {
        reportError(i, `Missing comments for "${featureName}"`);
        continue;
      }
      support.push({ vendorName, categoryName, featureName, supportLevel, comments: comments || "", sources: [] });
      summary.rowsValid++;
    }
  }

  if (stage === 5 || stage === 6) return { support };

  const categories = extractCategoriesFromFeatureCols(featureCols, featureToCategory);
  return { categories, support };
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

// ── Export-format template helpers ────────────────────────────────────────

interface TemplateVendor { name: string; product?: string; }

function buildVendorEvalSheet(
  vendors: TemplateVendor[],
  criteria: { name: string; category: string }[],
  existingScores?: Array<{ vendorName: string; criterionName: string; score: number; commentary?: string; notes?: string }>,
) {
  const executionCriteria = criteria.filter(c => c.category === 'execution');
  const viabilityCriteria = criteria.filter(c => c.category === 'viability');
  const headers = ['Vendor Name', 'Product'];
  executionCriteria.forEach(c => { headers.push(c.name); headers.push(`${c.name} - Notes`); });
  viabilityCriteria.forEach(c => { headers.push(c.name); headers.push(`${c.name} - Notes`); });

  const scoreMap = new Map<string, number>();
  const notesMap = new Map<string, string>();
  for (const s of existingScores ?? []) {
    scoreMap.set(`${s.vendorName}::${s.criterionName}`, s.score);
    notesMap.set(`${s.vendorName}::${s.criterionName}`, s.commentary || s.notes || '');
  }

  const rows = vendors.map(v => {
    const row: any = { 'Vendor Name': v.name, 'Product': v.product || '' };
    for (const c of executionCriteria) {
      row[c.name] = scoreMap.get(`${v.name}::${c.name}`) ?? '';
      row[`${c.name} - Notes`] = notesMap.get(`${v.name}::${c.name}`) ?? '';
    }
    for (const c of viabilityCriteria) {
      row[c.name] = scoreMap.get(`${v.name}::${c.name}`) ?? '';
      row[`${c.name} - Notes`] = notesMap.get(`${v.name}::${c.name}`) ?? '';
    }
    return row;
  });

  return { headers, rows };
}

function buildFeatureSheet(
  vendors: TemplateVendor[],
  categories: Array<{ name: string; features: Array<{ name: string }> }>,
  existingSupport?: Array<{ vendorName: string; categoryName: string; featureName: string; supportLevel: number; comments?: string }>,
) {
  const headers = ['Vendor Name', 'Category'];
  for (const cat of categories) {
    for (const f of cat.features) {
      headers.push(f.name);
      headers.push(`${f.name} - Comments`);
    }
  }

  const supportMap = new Map<string, { level: number; comments: string }>();
  for (const s of existingSupport ?? []) {
    supportMap.set(`${s.vendorName}::${s.categoryName}::${s.featureName}`, {
      level: s.supportLevel,
      comments: s.comments || '',
    });
  }

  const rows = [];
  for (const vendor of vendors) {
    for (const cat of categories) {
      const row: any = { 'Vendor Name': vendor.name, 'Category': cat.name };
      for (const f of cat.features) {
        const key = `${vendor.name}::${cat.name}::${f.name}`;
        const val = supportMap.get(key);
        row[f.name] = val?.level ?? '';
        row[`${f.name} - Comments`] = val?.comments ?? '';
      }
      rows.push(row);
    }
  }

  return { headers, rows };
}

// ── Template generation ───────────────────────────────────────────────────

export async function generateStageTemplate(stageNum: number, jobId: string): Promise<Buffer> {
  const xlsx = await import("xlsx");
  const job = await storage.getMarketBuilderJobWithStages(jobId);
  if (!job) throw new Error("Job not found");
  const stage1 = (job.stages.find(s => s.stage === 1)?.result ?? { vendors: [] }) as Stage1Result;
  const vendors = stage1.vendors.map(v => ({ name: v.name, product: v.product }));
  const allCriteria = await storage.getAllCriteria();

  // Prior stage results used to populate the other sheets when available.
  const stage2Result = job.stages.find(s => s.stage === 2)?.result as any;
  const stage3Result = job.stages.find(s => s.stage === 3)?.result as any;
  const stage4Result = job.stages.find(s => s.stage === 4)?.result as any;
  const stage5Result = job.stages.find(s => s.stage === 5)?.result as any;
  const stage6Result = job.stages.find(s => s.stage === 6)?.result as any;
  const stage7Result = job.stages.find(s => s.stage === 7)?.result as any;
  const stage8Result = job.stages.find(s => s.stage === 8)?.result as any;
  const stage9Result = job.stages.find(s => s.stage === 9)?.result as any;

  const existingVendorScores =
    stage3Result?.scores ?? stage2Result?.scores ?? [];

  const workbook = xlsx.utils.book_new();

  // ── Vendor Evaluation sheet ───────────────────────────────────────────────
  const { headers: vendorHeaders, rows: vendorRows } = buildVendorEvalSheet(
    vendors,
    allCriteria,
    existingVendorScores,
  );
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(vendorRows, { header: vendorHeaders }), 'Vendor Evaluation');

  // ── Product Evaluation sheet ────────────────────────────────────────────
  const productCategories = stage4Result?.categories ?? stage5Result?.categories ?? stage6Result?.categories ?? [];
  const productSupport = stage5Result?.support ?? stage6Result?.support ?? [];
  if (productCategories.length > 0) {
    const { headers: productHeaders, rows: productRows } = buildFeatureSheet(vendors, productCategories, productSupport);
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(productRows, { header: productHeaders }), 'Product Evaluation');
  } else {
    // Preserve the three-tab shape with an empty sheet so it still matches the export format.
    const ws = xlsx.utils.aoa_to_sheet([['Vendor Name', 'Category']]);
    xlsx.utils.book_append_sheet(workbook, ws, 'Product Evaluation');
  }

  // ── ISV Ecosystem sheet ─────────────────────────────────────────────────
  const ecosystemCategories = stage7Result?.categories ?? stage8Result?.categories ?? stage9Result?.categories ?? [];
  const ecosystemSupport = stage8Result?.support ?? stage9Result?.support ?? [];
  if (ecosystemCategories.length > 0) {
    const { headers: ecosystemHeaders, rows: ecosystemRows } = buildFeatureSheet(vendors, ecosystemCategories, ecosystemSupport);
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(ecosystemRows, { header: ecosystemHeaders }), 'ISV Ecosystem');
  } else {
    const ws = xlsx.utils.aoa_to_sheet([['Vendor Name', 'Category']]);
    xlsx.utils.book_append_sheet(workbook, ws, 'ISV Ecosystem');
  }

  return xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
}
