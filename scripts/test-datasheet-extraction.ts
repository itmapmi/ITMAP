/**
 * Golden PDF regression harness for datasheet extraction.
 *
 * Reads fixtures/datasheets/manifest.json:
 *   [
 *     {
 *       "name": "acme-switch-x100",
 *       "pdf": "acme-switch-x100.pdf",
 *       "marketSchema": { "groups": [...] },
 *       "expected": {
 *         "minSpecs": 6,
 *         "specs": [
 *           { "categoryKey": "perf", "attributeKey": "throughput", "rawValueIncludes": "10 Gbps" }
 *         ]
 *       }
 *     }
 *   ]
 *
 * Runs extractor.extractDatasheet for each fixture, compares against expected
 * values, and prints a PASS/FAIL summary. Exits non-zero if any fixture fails.
 *
 * Usage: tsx scripts/test-datasheet-extraction.ts
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { extractDatasheet } from "../server/datasheets/extractor";
import type { DatasheetSchemaDefinition } from "../shared/schema";

interface ExpectedSpec {
  categoryKey: string;
  attributeKey: string;
  rawValueIncludes?: string;
  normalizedMin?: number;
  normalizedMax?: number;
  unit?: string;
}
interface Fixture {
  name: string;
  pdf: string;
  marketSchema: DatasheetSchemaDefinition;
  expected: { minSpecs?: number; specs?: ExpectedSpec[] };
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const fixturesDir = path.resolve(__dirname, "..", "fixtures", "datasheets");
  let manifest: Fixture[];
  try {
    const raw = await fs.readFile(path.join(fixturesDir, "manifest.json"), "utf8");
    manifest = JSON.parse(raw);
  } catch {
    console.log("[golden] No fixtures/datasheets/manifest.json found. Create one to enable regression tests.");
    return;
  }
  let passed = 0, failed = 0;
  for (const fx of manifest) {
    process.stdout.write(`[golden] ${fx.name} ... `);
    try {
      const buf = await fs.readFile(path.join(fixturesDir, fx.pdf));
      const result = await extractDatasheet({
        fileBuffer: buf,
        schema: fx.marketSchema,
        productName: fx.name,
        datasheetId: fx.name,
      });
      const failures: string[] = [];
      if (fx.expected.minSpecs && result.specs.length < fx.expected.minSpecs) {
        failures.push(`Expected at least ${fx.expected.minSpecs} specs, got ${result.specs.length}`);
      }
      for (const e of fx.expected.specs ?? []) {
        const s = result.specs.find(x => x.categoryKey === e.categoryKey && x.attributeKey === e.attributeKey);
        if (!s) { failures.push(`Missing spec ${e.categoryKey}/${e.attributeKey}`); continue; }
        if (e.rawValueIncludes && !(s.rawValue ?? "").toLowerCase().includes(e.rawValueIncludes.toLowerCase())) {
          failures.push(`${e.categoryKey}/${e.attributeKey} rawValue '${s.rawValue}' missing '${e.rawValueIncludes}'`);
        }
        if (e.unit && s.unit !== e.unit) {
          failures.push(`${e.categoryKey}/${e.attributeKey} unit '${s.unit}' != '${e.unit}'`);
        }
        const n = s.normalizedValue == null ? null : Number(s.normalizedValue);
        if (e.normalizedMin != null && (n == null || n < e.normalizedMin)) failures.push(`${e.categoryKey}/${e.attributeKey} normalized ${n} < ${e.normalizedMin}`);
        if (e.normalizedMax != null && (n == null || n > e.normalizedMax)) failures.push(`${e.categoryKey}/${e.attributeKey} normalized ${n} > ${e.normalizedMax}`);
      }
      if (failures.length === 0) { console.log("PASS"); passed++; }
      else { console.log("FAIL\n  - " + failures.join("\n  - ")); failed++; }
    } catch (err) {
      console.log(`ERROR ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }
  console.log(`\n[golden] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(2); });
