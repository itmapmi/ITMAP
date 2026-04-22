import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });

/**
 * Run lightweight additive migrations for new schema additions.
 * Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so it is safe to run on any
 * environment regardless of whether `db:push` has been executed.
 */
export async function runStartupMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. admin_alert_settings table (new in task-14)
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_alert_settings (
        id       varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        email_alerts_enabled boolean NOT NULL DEFAULT true,
        recipient_emails     text,
        updated_at           timestamp DEFAULT now()
      )
    `);

    // 2. newsroom_alert_disabled column on vendors (new in task-14)
    await client.query(`
      ALTER TABLE vendors
        ADD COLUMN IF NOT EXISTS newsroom_alert_disabled boolean NOT NULL DEFAULT false
    `);

    console.log('[DB] Startup migrations applied successfully');
  } catch (err) {
    console.error('[DB] Startup migration error:', err);
    // Non-fatal: the app can still start; DB push should be run manually
  } finally {
    client.release();
  }
}