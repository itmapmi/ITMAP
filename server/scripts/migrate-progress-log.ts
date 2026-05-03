import { db } from "../db";
import { sql } from "drizzle-orm";

async function run() {
  await db.execute(sql`ALTER TABLE market_builder_stages ADD COLUMN IF NOT EXISTS progress_log text`);
  console.log("progress_log column added");
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
