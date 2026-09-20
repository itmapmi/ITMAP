/**
 * Idempotent backfill for the feature-derived criteria (Product Capabilities,
 * ISV Ecosystem). Re-derives both from the stored support matrix for every
 * market using the single shared calibration and persists score + coverage.
 *
 *   npm run derive:backfill                # write
 *   npm run derive:backfill -- --dry-run   # report only
 *   npm run derive:backfill -- --market <marketId>
 *
 * Runs against DATABASE_URL, i.e. the development database from the
 * workspace. In production use the equivalent admin endpoint instead
 * (POST /api/admin/derived-scores/rederive) — see replit.md.
 */
import { pool } from "../db";
import { backfillDerivedFeatureScores } from "../derivedFeatureScores";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const marketFlag = argv.indexOf("--market");
  const marketId = marketFlag >= 0 ? argv[marketFlag + 1] : undefined;
  if (marketFlag >= 0 && !marketId) throw new Error("--market requires a market id");
  return { dryRun, marketId };
}

async function run() {
  const { dryRun, marketId } = parseArgs(process.argv.slice(2));
  const report = await backfillDerivedFeatureScores({
    dryRun,
    marketIds: marketId ? [marketId] : undefined,
    log: (line) => console.log(line),
  });

  const changes = report.markets.flatMap((m) =>
    m.results.filter((r) => r.changed).map((r) => ({
      market: m.marketName,
      vendor: r.vendorName,
      criterion: r.kind,
      from: r.previousScore,
      to: r.derived.score,
      coverage: r.derived.coverage,
      features: r.derived.featureCount,
    })),
  );
  if (changes.length > 0) {
    console.log(`\n${dryRun ? "Would change" : "Changed"} ${changes.length} score rows:`);
    console.table(changes);
  }
  console.log(
    `\n${dryRun ? "[dry-run] " : ""}${report.totals.markets} markets, `
    + `${report.totals.written} rows rewritten, ${report.totals.unchanged} already current.`,
  );
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
