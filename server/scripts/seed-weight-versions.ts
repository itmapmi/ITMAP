/**
 * Idempotent one-off seed of the quadrant weight-version audit trail: records
 * version 1 for every market that has no version yet, from its current
 * effective criteria weights and its stored thresholds. Markets that already
 * have a version are left untouched, so it is safe to re-run.
 *
 *   npm run weights:seed-versions                # write
 *   npm run weights:seed-versions -- --dry-run   # report only
 *   npm run weights:seed-versions -- --market <marketId>
 *
 * Runs against DATABASE_URL, i.e. the development database from the
 * workspace. The server also runs this automatically on boot; in production
 * use the equivalent admin endpoint (POST /api/admin/weight-versions/seed)
 * if you need to run it by hand — see replit.md.
 */
import { pool } from "../db";
import { seedInitialWeightVersions } from "../quadrantConfig";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const marketFlag = argv.indexOf("--market");
  const marketId = marketFlag >= 0 ? argv[marketFlag + 1] : undefined;
  if (marketFlag >= 0 && !marketId) throw new Error("--market requires a market id");
  return { dryRun, marketId };
}

async function run() {
  const { dryRun, marketId } = parseArgs(process.argv.slice(2));
  const result = await seedInitialWeightVersions({ dryRun, marketId });
  if (result.seeded.length > 0) {
    console.log(`${dryRun ? "Would seed" : "Seeded"} version 1 for ${result.seeded.length} market(s):`);
    console.table(result.seeded);
  }
  console.log(
    `${dryRun ? "[dry-run] " : ""}${result.seeded.length} seeded, ${result.alreadyVersioned} already versioned.`,
  );
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
