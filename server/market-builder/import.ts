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

/**
 * Detect whether a sheet has the styled category-band row as its first row.
 * In the new export format, row 0 is the band (A1 is empty or a placeholder);
 * the actual "Vendor Name" header is in row 1 (A2).
 * In the legacy format, A1 = "Vendor Name".
 */
function sheetHasBandRow(sheet: any): boolean {
  const a1 = sheet['A1'];
  return !a1 || (a1.v !== 'Vendor Name' && a1.v !== 'Vendor Name\r\n');
}

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
  // When the new styled format is present the first row is the category/group band.
  // Use range: 1 to treat row 1 (0-indexed) as the header row.
  const hasBand = sheetHasBandRow(sheet);
  const rows = xlsx.utils.sheet_to_json(sheet, hasBand ? { range: 1 } : {}) as Record<string, any>[];
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
  // When the new styled format is used, row 0 is the category band; actual
  // column headers are in row 1. Detect and skip accordingly.
  const hasBand = sheetHasBandRow(sheet);
  const headerRowIdx = hasBand ? 1 : 0;
  const dataStartRowIdx = hasBand ? 2 : 1;

  const rowsRaw = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
  const header = (rowsRaw[headerRowIdx] || []).filter(Boolean) as string[];
  const featureCols = header.filter(h => h && h !== "Vendor Name" && h !== "Category" && !h.endsWith(" - Comments"));

  const categoryIdx = header.indexOf("Category");
  const featureToCategory = new Map<string, string>();
  for (let i = dataStartRowIdx; i < rowsRaw.length; i++) {
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
  // Skip the band row for object-based parsing by starting at the header row.
  const rows = xlsx.utils.sheet_to_json(sheet, hasBand ? { range: 1 } : {}) as Record<string, any>[];
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

// ── Excel cell styles ─────────────────────────────────────────────────────
// xlsx-js-style is used only for export (drop-in of xlsx + `.s` cell styling).
// The import path continues to use plain `xlsx`.

const XLS_STYLE = {
  /** Read-only identity columns: Vendor Name, Category, Product */
  identity: {
    fill: { patternType: 'solid', fgColor: { rgb: 'C0C0C0' } },
    font: { bold: false, sz: 11 },
    border: { bottom: { style: 'thin', color: { rgb: 'A0A0A0' } }, right: { style: 'thin', color: { rgb: 'A0A0A0' } } },
  },
  /** Category group band header (Product / Ecosystem sheets) */
  categoryBand: {
    fill: { patternType: 'solid', fgColor: { rgb: '4472C4' } },
    font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { right: { style: 'medium', color: { rgb: 'FFFFFF' } } },
  },
  /** Execution / Viability group band header (Vendor Evaluation sheet) */
  groupBand: {
    fill: { patternType: 'solid', fgColor: { rgb: '5B9BD5' } },
    font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { right: { style: 'medium', color: { rgb: 'FFFFFF' } } },
  },
  /** Column header row (feature names / criterion names) */
  colHeader: {
    fill: { patternType: 'solid', fgColor: { rgb: 'D9E1F2' } },
    font: { bold: true, sz: 11 },
    alignment: { horizontal: 'center', wrapText: true },
    border: { bottom: { style: 'medium', color: { rgb: '4472C4' } }, right: { style: 'thin', color: { rgb: 'A0A0A0' } } },
  },
  /** Identity column header (top-left corner of header row) */
  colHeaderIdentity: {
    fill: { patternType: 'solid', fgColor: { rgb: 'A0A0A0' } },
    font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
    border: { bottom: { style: 'medium', color: { rgb: '4472C4' } }, right: { style: 'thin', color: { rgb: 'A0A0A0' } } },
  },
  /** Score / support-level cell — empty (LLM should fill) */
  fillMe: {
    fill: { patternType: 'solid', fgColor: { rgb: 'FFFF99' } },
    alignment: { horizontal: 'center' },
    border: { bottom: { style: 'thin', color: { rgb: 'CCCC00' } }, right: { style: 'thin', color: { rgb: 'CCCC00' } } },
  },
  /** Score / support-level cell — already has data */
  prefilled: {
    fill: { patternType: 'solid', fgColor: { rgb: 'C6EFCE' } },
    alignment: { horizontal: 'center' },
    border: { bottom: { style: 'thin', color: { rgb: '70AD47' } }, right: { style: 'thin', color: { rgb: '70AD47' } } },
  },
  /** Comments / Notes column — empty */
  commentsEmpty: {
    fill: { patternType: 'solid', fgColor: { rgb: 'DDEBF7' } },
    border: { bottom: { style: 'thin', color: { rgb: 'B8CCE4' } }, right: { style: 'thin', color: { rgb: 'B8CCE4' } } },
  },
  /** Comments / Notes column — has content */
  commentsFilled: {
    fill: { patternType: 'solid', fgColor: { rgb: 'BDD7EE' } },
    border: { bottom: { style: 'thin', color: { rgb: 'B8CCE4' } }, right: { style: 'thin', color: { rgb: 'B8CCE4' } } },
  },
  /** Band placeholder cells (Vendor Name / Category positions in band row) */
  bandPlaceholder: {
    fill: { patternType: 'solid', fgColor: { rgb: '808080' } },
    border: { right: { style: 'thin', color: { rgb: '606060' } } },
  },
};

/** Convert a 0-based column index to an Excel column letter (A, B, …, AA, …). */
function colLetter(col: number): string {
  let s = '';
  col++;
  while (col > 0) {
    const r = (col - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

/** Create a styled xlsx-js-style cell object. */
function sc(v: any, style: object): object {
  const t = typeof v === 'number' ? 'n' : v === '' || v === null || v === undefined ? 'z' : 's';
  return { v: v ?? '', t, s: style };
}

/**
 * Build a styled worksheet for Product Evaluation / ISV Ecosystem.
 *
 * Layout:
 *   Row 0 — Category band: gray for identity cols, colored header for each feature group
 *   Row 1 — Column headers: gray for identity, blue-tinted for features/comments
 *   Rows 2+ — Data: gray identity cols, yellow/green scores, blue comments
 *
 * The import parser detects the band row by checking whether A1 = "Vendor Name"
 * (old format) or A2 = "Vendor Name" (new format with band). It then uses
 * `{ range: 1 }` to skip the band when calling sheet_to_json().
 */
function buildStyledFeatureSheet(
  xlsxStyle: any,
  vendors: TemplateVendor[],
  categories: Array<{ name: string; features: Array<{ name: string }> }>,
  existingSupport?: Array<{ vendorName: string; categoryName: string; featureName: string; supportLevel: number; comments?: string }>,
) {
  // ── Build column metadata ────────────────────────────────────────────────
  // cols: [ { type: 'identity'|'score'|'comments', cat?, feature? }, … ]
  type ColMeta = { type: 'identity'; label: string } | { type: 'score'; cat: string; feature: string } | { type: 'comments'; cat: string; feature: string };
  const cols: ColMeta[] = [
    { type: 'identity', label: 'Vendor Name' },
    { type: 'identity', label: 'Category' },
  ];
  for (const cat of categories) {
    for (const f of cat.features) {
      cols.push({ type: 'score', cat: cat.name, feature: f.name });
      cols.push({ type: 'comments', cat: cat.name, feature: f.name });
    }
  }

  const supportMap = new Map<string, { level: number; comments: string }>();
  for (const s of existingSupport ?? []) {
    supportMap.set(`${s.vendorName}::${s.categoryName}::${s.featureName}`, {
      level: s.supportLevel,
      comments: s.comments || '',
    });
  }

  // ── Row 0: Category band ─────────────────────────────────────────────────
  const bandRow: object[] = [
    sc('', XLS_STYLE.bandPlaceholder),
    sc('', XLS_STYLE.bandPlaceholder),
  ];
  // Track merges: one merge per category spanning all its score+comment cols
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
  let colIdx = 2;
  for (const cat of categories) {
    const spanCount = cat.features.length * 2; // score + comments per feature
    bandRow.push(sc(cat.name, XLS_STYLE.categoryBand));
    for (let i = 1; i < spanCount; i++) bandRow.push(sc('', XLS_STYLE.categoryBand));
    if (spanCount > 1) {
      merges.push({ s: { r: 0, c: colIdx }, e: { r: 0, c: colIdx + spanCount - 1 } });
    }
    colIdx += spanCount;
  }

  // ── Row 1: Column header ─────────────────────────────────────────────────
  const headerRow: object[] = cols.map(col => {
    if (col.type === 'identity') return sc(col.label, XLS_STYLE.colHeaderIdentity);
    if (col.type === 'score') return sc(col.feature, XLS_STYLE.colHeader);
    return sc(`${col.feature} - Comments`, XLS_STYLE.colHeader);
  });

  // ── Data rows ────────────────────────────────────────────────────────────
  const dataRows: object[][] = [];
  for (const vendor of vendors) {
    for (const cat of categories) {
      const row: object[] = [
        sc(vendor.name, XLS_STYLE.identity),
        sc(cat.name, XLS_STYLE.identity),
      ];
      for (const f of cat.features) {
        const key = `${vendor.name}::${cat.name}::${f.name}`;
        const val = supportMap.get(key);
        const level = val?.level;
        const comments = val?.comments ?? '';
        row.push(sc(level ?? '', level !== undefined ? XLS_STYLE.prefilled : XLS_STYLE.fillMe));
        row.push(sc(comments, comments ? XLS_STYLE.commentsFilled : XLS_STYLE.commentsEmpty));
      }
      dataRows.push(row);
    }
  }

  const aoa: object[][] = [bandRow, headerRow, ...dataRows];
  const ws = xlsxStyle.utils.aoa_to_sheet(aoa);

  // Apply merges for category band
  ws['!merges'] = merges;

  // Column widths: identity cols wider, score cols narrow, comments wider
  ws['!cols'] = cols.map(col =>
    col.type === 'identity' ? { wch: 22 } :
    col.type === 'score'    ? { wch: 14 } :
                              { wch: 28 },
  );

  // Row heights: band row taller
  ws['!rows'] = [{ hpt: 30 }, { hpt: 42 }];

  return ws;
}

/**
 * Build a styled worksheet for Vendor Evaluation.
 *
 * Layout:
 *   Row 0 — Group band: "Execution Criteria" spanning exec cols, "Viability Criteria" spanning viab cols
 *   Row 1 — Column headers
 *   Rows 2+ — Data
 */
function buildStyledVendorEvalSheet(
  xlsxStyle: any,
  vendors: TemplateVendor[],
  criteria: { name: string; category: string }[],
  existingScores?: Array<{ vendorName: string; criterionName: string; score: number; commentary?: string; notes?: string }>,
) {
  const executionCriteria = criteria.filter(c => c.category === 'execution');
  const viabilityCriteria = criteria.filter(c => c.category === 'viability');

  const scoreMap = new Map<string, number>();
  const notesMap = new Map<string, string>();
  for (const s of existingScores ?? []) {
    scoreMap.set(`${s.vendorName}::${s.criterionName}`, s.score);
    notesMap.set(`${s.vendorName}::${s.criterionName}`, s.commentary || s.notes || '');
  }

  // ── Build column metadata ────────────────────────────────────────────────
  type ColMeta = { type: 'identity'; label: string } | { type: 'score'; group: string; criterion: string } | { type: 'notes'; group: string; criterion: string };
  const cols: ColMeta[] = [
    { type: 'identity', label: 'Vendor Name' },
    { type: 'identity', label: 'Product' },
  ];
  for (const c of executionCriteria) {
    cols.push({ type: 'score', group: 'execution', criterion: c.name });
    cols.push({ type: 'notes', group: 'execution', criterion: c.name });
  }
  for (const c of viabilityCriteria) {
    cols.push({ type: 'score', group: 'viability', criterion: c.name });
    cols.push({ type: 'notes', group: 'viability', criterion: c.name });
  }

  // ── Row 0: Group band ────────────────────────────────────────────────────
  const bandRow: object[] = [
    sc('', XLS_STYLE.bandPlaceholder),
    sc('', XLS_STYLE.bandPlaceholder),
  ];
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];

  const execSpan = executionCriteria.length * 2;
  const viabSpan = viabilityCriteria.length * 2;

  if (execSpan > 0) {
    bandRow.push(sc('Execution Criteria  (score 0–10)', XLS_STYLE.groupBand));
    for (let i = 1; i < execSpan; i++) bandRow.push(sc('', XLS_STYLE.groupBand));
    if (execSpan > 1) merges.push({ s: { r: 0, c: 2 }, e: { r: 0, c: 2 + execSpan - 1 } });
  }
  if (viabSpan > 0) {
    const startCol = 2 + execSpan;
    bandRow.push(sc('Viability Criteria  (score 0–10)', XLS_STYLE.groupBand));
    for (let i = 1; i < viabSpan; i++) bandRow.push(sc('', XLS_STYLE.groupBand));
    if (viabSpan > 1) merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + viabSpan - 1 } });
  }

  // ── Row 1: Column headers ────────────────────────────────────────────────
  const headerRow: object[] = cols.map(col => {
    if (col.type === 'identity') return sc(col.label, XLS_STYLE.colHeaderIdentity);
    if (col.type === 'score') return sc(col.criterion, XLS_STYLE.colHeader);
    return sc(`${col.criterion} - Notes`, XLS_STYLE.colHeader);
  });

  // ── Data rows ────────────────────────────────────────────────────────────
  const dataRows: object[][] = vendors.map(v => {
    const row: object[] = [
      sc(v.name, XLS_STYLE.identity),
      sc(v.product || '', XLS_STYLE.identity),
    ];
    for (const c of [...executionCriteria, ...viabilityCriteria]) {
      const key = `${v.name}::${c.name}`;
      const score = scoreMap.get(key);
      const notes = notesMap.get(key) ?? '';
      row.push(sc(score ?? '', score !== undefined ? XLS_STYLE.prefilled : XLS_STYLE.fillMe));
      row.push(sc(notes, notes ? XLS_STYLE.commentsFilled : XLS_STYLE.commentsEmpty));
    }
    return row;
  });

  const aoa: object[][] = [bandRow, headerRow, ...dataRows];
  const ws = xlsxStyle.utils.aoa_to_sheet(aoa);

  ws['!merges'] = merges;
  ws['!cols'] = cols.map(col =>
    col.type === 'identity' ? { wch: 22 } :
    col.type === 'score'    ? { wch: 14 } :
                              { wch: 30 },
  );
  ws['!rows'] = [{ hpt: 30 }, { hpt: 42 }];

  return ws;
}

// ── Instructions sheet ────────────────────────────────────────────────────

/**
 * Build a self-contained "Instructions" worksheet that explains the color
 * legend, scoring rules, Harvey-ball equivalents, and each sheet's purpose.
 * The sheet has NO fillable cells; it is pure reference.
 */
function buildInstructionsSheet(xlsxStyle: any): any {
  // Shared styles for the instructions sheet
  const TITLE: object = {
    fill: { patternType: 'solid', fgColor: { rgb: '1F3864' } },
    font: { bold: true, sz: 16, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'left', vertical: 'center' },
  };
  const SUBTITLE: object = {
    fill: { patternType: 'solid', fgColor: { rgb: '2F5496' } },
    font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
  const SECTION_HEADER: object = {
    fill: { patternType: 'solid', fgColor: { rgb: '4472C4' } },
    font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'left', vertical: 'center' },
  };
  const LABEL: object = {
    fill: { patternType: 'solid', fgColor: { rgb: 'D9E1F2' } },
    font: { bold: true, sz: 11 },
    alignment: { horizontal: 'left', vertical: 'center' },
  };
  const BODY: object = {
    fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
    font: { bold: false, sz: 11 },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
  };
  const EMPTY: object = {
    fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
    font: { sz: 11 },
  };

  // Color-legend swatch styles (match the data sheets exactly)
  const SWATCH_GRAY: object = {
    fill: { patternType: 'solid', fgColor: { rgb: 'C0C0C0' } },
    font: { sz: 11 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { bottom: { style: 'thin', color: { rgb: 'A0A0A0' } }, right: { style: 'thin', color: { rgb: 'A0A0A0' } } },
  };
  const SWATCH_YELLOW: object = {
    fill: { patternType: 'solid', fgColor: { rgb: 'FFFF99' } },
    font: { sz: 11 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { bottom: { style: 'thin', color: { rgb: 'CCCC00' } }, right: { style: 'thin', color: { rgb: 'CCCC00' } } },
  };
  const SWATCH_GREEN: object = {
    fill: { patternType: 'solid', fgColor: { rgb: 'C6EFCE' } },
    font: { sz: 11 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { bottom: { style: 'thin', color: { rgb: '70AD47' } }, right: { style: 'thin', color: { rgb: '70AD47' } } },
  };
  const SWATCH_BLUE_EMPTY: object = {
    fill: { patternType: 'solid', fgColor: { rgb: 'DDEBF7' } },
    font: { sz: 11 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { bottom: { style: 'thin', color: { rgb: 'B8CCE4' } }, right: { style: 'thin', color: { rgb: 'B8CCE4' } } },
  };
  const SWATCH_BLUE_FILLED: object = {
    fill: { patternType: 'solid', fgColor: { rgb: 'BDD7EE' } },
    font: { sz: 11 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { bottom: { style: 'thin', color: { rgb: 'B8CCE4' } }, right: { style: 'thin', color: { rgb: 'B8CCE4' } } },
  };

  // Harvey-ball table header style
  const HB_HEADER: object = {
    fill: { patternType: 'solid', fgColor: { rgb: '5B9BD5' } },
    font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { bottom: { style: 'medium', color: { rgb: '2F5496' } }, right: { style: 'thin', color: { rgb: 'FFFFFF' } } },
  };
  const HB_CELL: object = {
    fill: { patternType: 'solid', fgColor: { rgb: 'EBF3FB' } },
    font: { sz: 12 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { bottom: { style: 'thin', color: { rgb: 'B8CCE4' } }, right: { style: 'thin', color: { rgb: 'B8CCE4' } } },
  };
  const HB_LABEL_CELL: object = {
    fill: { patternType: 'solid', fgColor: { rgb: 'EBF3FB' } },
    font: { sz: 11 },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: { bottom: { style: 'thin', color: { rgb: 'B8CCE4' } }, right: { style: 'thin', color: { rgb: 'B8CCE4' } } },
  };

  const e = (v: any = '') => sc(v, EMPTY);
  const b = (v: string) => sc(v, BODY);
  const lb = (v: string) => sc(v, LABEL);

  // Build the sheet as an array-of-arrays
  const aoa: object[][] = [
    // Row 0: Title
    [sc('AI Market Builder — Workbook Instructions', TITLE), e(), e(), e(), e()],
    // Row 1: Read-only notice
    [sc('READ ONLY / REFERENCE — Do not edit this sheet', SUBTITLE), e(), e(), e(), e()],
    // Row 2: Blank
    [e(), e(), e(), e(), e()],

    // ── Color Legend ──────────────────────────────────────────────────────
    // Row 3: Section header
    [sc('Color Legend', SECTION_HEADER), e(), e(), e(), e()],
    // Row 4: Column headers for legend table
    [lb('Swatch'), lb('Color Name'), lb('Meaning'), e(), e()],
    // Row 5
    [sc('', SWATCH_GRAY),         b('Gray'),              b('Read-only — identity / vendor name. Do not change.'), e(), e()],
    // Row 6
    [sc('', SWATCH_YELLOW),       b('Yellow'),            b('Fill in — this cell needs a score or support level from you.'), e(), e()],
    // Row 7
    [sc('', SWATCH_GREEN),        b('Green'),             b('Already filled — the system pre-populated this value.'), e(), e()],
    // Row 8
    [sc('', SWATCH_BLUE_EMPTY),   b('Light blue'),        b('Optional — comments / notes column, currently empty.'), e(), e()],
    // Row 9
    [sc('', SWATCH_BLUE_FILLED),  b('Medium blue'),       b('Optional — comments / notes column, already has content.'), e(), e()],
    // Row 10: Blank
    [e(), e(), e(), e(), e()],

    // ── Scoring Rules ─────────────────────────────────────────────────────
    // Row 11: Section header
    [sc('Scoring Rules', SECTION_HEADER), e(), e(), e(), e()],
    // Row 12
    [lb('Sheet'), lb('Column type'), lb('Valid values'), lb('Notes'), e()],
    // Row 13
    [b('Vendor Evaluation'), b('Score (yellow/green)'), b('Integer 0 – 10'), b('0 = worst, 10 = best. Decimals are not accepted by the importer.'), e()],
    // Row 14
    [b('Vendor Evaluation'), b('Notes (light/medium blue)'), b('Free text'), b('Required for Stage 3 commentary. Optional for Stage 2.'), e()],
    // Row 15
    [b('Product Evaluation'), b('Support level (yellow/green)'), b('Integer 0 – 4  OR  Harvey-ball symbol'), b('See Harvey-ball table below.'), e()],
    // Row 16
    [b('Product Evaluation'), b('Comments (light/medium blue)'), b('Free text'), b('Optional context on the support level.'), e()],
    // Row 17
    [b('ISV Ecosystem'), b('Support level (yellow/green)'), b('Integer 0 – 4  OR  Harvey-ball symbol'), b('Same scale as Product Evaluation.'), e()],
    // Row 18
    [b('ISV Ecosystem'), b('Comments (light/medium blue)'), b('Free text'), b('Optional context on the support level.'), e()],
    // Row 19: Blank
    [e(), e(), e(), e(), e()],

    // ── Harvey-ball equivalents ───────────────────────────────────────────
    // Row 20: Section header
    [sc('Support Level / Harvey-Ball Equivalents  (Product Evaluation & ISV Ecosystem)', SECTION_HEADER), e(), e(), e(), e()],
    // Row 21: Table header
    [sc('Numeric', HB_HEADER), sc('Symbol', HB_HEADER), sc('Label', HB_HEADER), sc('Meaning', HB_HEADER), e()],
    // Row 22
    [sc('0', HB_CELL), sc('✕', HB_CELL), sc('Not supported', HB_LABEL_CELL), sc('The vendor does not offer this feature at all.', HB_LABEL_CELL), e()],
    // Row 23
    [sc('1', HB_CELL), sc('◔', HB_CELL), sc('Partial / Roadmap', HB_LABEL_CELL), sc('Limited support or planned but not yet available.', HB_LABEL_CELL), e()],
    // Row 24
    [sc('2', HB_CELL), sc('◑', HB_CELL), sc('Half support', HB_LABEL_CELL), sc('Core capability exists but significant gaps remain.', HB_LABEL_CELL), e()],
    // Row 25
    [sc('3', HB_CELL), sc('◕', HB_CELL), sc('Mostly supported', HB_LABEL_CELL), sc('Strong support with only minor limitations.', HB_LABEL_CELL), e()],
    // Row 26
    [sc('4', HB_CELL), sc('●', HB_CELL), sc('Fully supported', HB_LABEL_CELL), sc('Complete, production-ready support for this feature.', HB_LABEL_CELL), e()],
    // Row 27: Blank
    [e(), e(), e(), e(), e()],

    // ── Sheet Descriptions ────────────────────────────────────────────────
    // Row 28: Section header
    [sc('Sheet Descriptions', SECTION_HEADER), e(), e(), e(), e()],
    // Row 29: Header
    [lb('Sheet name'), lb('Purpose'), e(), e(), e()],
    // Row 30
    [b('Instructions'),       b('This sheet. Read-only reference — explains the workbook structure and rules.'), e(), e(), e()],
    // Row 31
    [b('Vendor Evaluation'),  b('Score each vendor against execution and viability criteria (0–10). Add analyst notes in the blue columns. Used in Stages 2 and 3.'), e(), e(), e()],
    // Row 32
    [b('Product Evaluation'), b('Rate each vendor\'s product feature support (0–4). Add comments in the blue columns. Used in Stages 4, 5, and 6.'), e(), e(), e()],
    // Row 33
    [b('ISV Ecosystem'),      b('Rate each vendor\'s ISV / partner ecosystem support (0–4). Add comments in the blue columns. Used in Stages 7, 8, and 9.'), e(), e(), e()],
    // Row 34: Blank
    [e(), e(), e(), e(), e()],

    // ── Import Tips ───────────────────────────────────────────────────────
    // Row 35: Section header
    [sc('Import Tips', SECTION_HEADER), e(), e(), e(), e()],
    // Row 36–41: Tips as plain body text
    [b('1.  Save the file as .xlsx before uploading — the importer only accepts Excel format.'), e(), e(), e(), e()],
    [b('2.  Do not rename or reorder the data sheets (Vendor Evaluation, Product Evaluation, ISV Ecosystem).'), e(), e(), e(), e()],
    [b('3.  Do not add, remove, or rename vendor rows — the importer matches rows by the vendor name in column A.'), e(), e(), e(), e()],
    [b('4.  The Instructions sheet is skipped automatically by the importer.'), e(), e(), e(), e()],
    [b('5.  Use integers for numeric scores. Harvey-ball symbols are also accepted for support levels.'), e(), e(), e(), e()],
    [b('6.  Stage 3 notes are required for each vendor/criterion pair — blank notes will be flagged as warnings.'), e(), e(), e(), e()],
  ];

  const ws = xlsxStyle.utils.aoa_to_sheet(aoa);

  // Merges: title, read-only notice, section headers, sheet-description body cells span 4 cols
  ws['!merges'] = [
    // Title row (A1:E1)
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    // Subtitle (A2:E2)
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    // Section headers (col A spans all 5 cols)
    { s: { r: 3, c: 0 }, e: { r: 3, c: 4 } },
    { s: { r: 11, c: 0 }, e: { r: 11, c: 4 } },
    { s: { r: 20, c: 0 }, e: { r: 20, c: 4 } },
    { s: { r: 28, c: 0 }, e: { r: 28, c: 4 } },
    { s: { r: 35, c: 0 }, e: { r: 35, c: 4 } },
    // Import tip rows span all 5 cols
    { s: { r: 36, c: 0 }, e: { r: 36, c: 4 } },
    { s: { r: 37, c: 0 }, e: { r: 37, c: 4 } },
    { s: { r: 38, c: 0 }, e: { r: 38, c: 4 } },
    { s: { r: 39, c: 0 }, e: { r: 39, c: 4 } },
    { s: { r: 40, c: 0 }, e: { r: 40, c: 4 } },
    { s: { r: 41, c: 0 }, e: { r: 41, c: 4 } },
    // Color legend meaning col spans C:E
    { s: { r: 5, c: 2 }, e: { r: 5, c: 4 } },
    { s: { r: 6, c: 2 }, e: { r: 6, c: 4 } },
    { s: { r: 7, c: 2 }, e: { r: 7, c: 4 } },
    { s: { r: 8, c: 2 }, e: { r: 8, c: 4 } },
    { s: { r: 9, c: 2 }, e: { r: 9, c: 4 } },
    // Sheet description purpose col spans B:E
    { s: { r: 30, c: 1 }, e: { r: 30, c: 4 } },
    { s: { r: 31, c: 1 }, e: { r: 31, c: 4 } },
    { s: { r: 32, c: 1 }, e: { r: 32, c: 4 } },
    { s: { r: 33, c: 1 }, e: { r: 33, c: 4 } },
  ];

  // Column widths
  ws['!cols'] = [
    { wch: 28 }, // A: swatch / numeric / sheet name / tip text
    { wch: 22 }, // B: color name / column type / purpose
    { wch: 20 }, // C: meaning / valid values / label
    { wch: 52 }, // D: notes / meaning
    { wch: 4  }, // E: spacer
  ];

  // Row heights
  ws['!rows'] = [
    { hpt: 36 }, // Title
    { hpt: 24 }, // Subtitle
  ];

  return ws;
}

// ── Template generation ───────────────────────────────────────────────────

export async function generateStageTemplate(stageNum: number, jobId: string): Promise<Buffer> {
  // xlsx-js-style is a drop-in of xlsx that adds `.s` cell-style support.
  // We use it only here (export). The import path uses plain `xlsx`.
  // Dynamic import() wraps CJS modules under `.default`; unwrap for either shape.
  const xlsxStyleRaw = await import("xlsx-js-style" as any);
  const xlsxStyle = (xlsxStyleRaw as any).default ?? xlsxStyleRaw;
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

  const workbook = xlsxStyle.utils.book_new();

  // ── Instructions sheet (first tab) ───────────────────────────────────────
  const instructionsWs = buildInstructionsSheet(xlsxStyle);
  xlsxStyle.utils.book_append_sheet(workbook, instructionsWs, 'Instructions');

  // ── Vendor Evaluation sheet ───────────────────────────────────────────────
  const vendorWs = buildStyledVendorEvalSheet(xlsxStyle, vendors, allCriteria, existingVendorScores);
  xlsxStyle.utils.book_append_sheet(workbook, vendorWs, 'Vendor Evaluation');

  // ── Product Evaluation sheet ────────────────────────────────────────────
  const productCategories = stage4Result?.categories ?? stage5Result?.categories ?? stage6Result?.categories ?? [];
  const productSupport = stage5Result?.support ?? stage6Result?.support ?? [];
  if (productCategories.length > 0) {
    const productWs = buildStyledFeatureSheet(xlsxStyle, vendors, productCategories, productSupport);
    xlsxStyle.utils.book_append_sheet(workbook, productWs, 'Product Evaluation');
  } else {
    // Preserve the three-tab shape with an empty sheet so it still matches the export format.
    const ws = xlsxStyle.utils.aoa_to_sheet([['Vendor Name', 'Category']]);
    xlsxStyle.utils.book_append_sheet(workbook, ws, 'Product Evaluation');
  }

  // ── ISV Ecosystem sheet ─────────────────────────────────────────────────
  const ecosystemCategories = stage7Result?.categories ?? stage8Result?.categories ?? stage9Result?.categories ?? [];
  const ecosystemSupport = stage8Result?.support ?? stage9Result?.support ?? [];
  if (ecosystemCategories.length > 0) {
    const ecosystemWs = buildStyledFeatureSheet(xlsxStyle, vendors, ecosystemCategories, ecosystemSupport);
    xlsxStyle.utils.book_append_sheet(workbook, ecosystemWs, 'ISV Ecosystem');
  } else {
    const ws = xlsxStyle.utils.aoa_to_sheet([['Vendor Name', 'Category']]);
    xlsxStyle.utils.book_append_sheet(workbook, ws, 'ISV Ecosystem');
  }

  return xlsxStyle.write(workbook, { type: "buffer", bookType: "xlsx" });
}
