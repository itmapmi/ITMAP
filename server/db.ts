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

    // 3. external_api_keys — partner API key management
    await client.query(`
      CREATE TABLE IF NOT EXISTS external_api_keys (
        id         varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name       text NOT NULL,
        key_hash   text NOT NULL UNIQUE,
        key_prefix text NOT NULL,
        allowed_market_ids text[],
        is_active  boolean NOT NULL DEFAULT true,
        last_used_at timestamp,
        created_at timestamp DEFAULT now()
      )
    `);

    // 4. external_chat_sessions — one row per partner session (keyed by their own ID e.g. Slack thread)
    await client.query(`
      CREATE TABLE IF NOT EXISTS external_chat_sessions (
        id                  varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        api_key_id          varchar NOT NULL REFERENCES external_api_keys(id) ON DELETE CASCADE,
        external_session_id text NOT NULL,
        market_id           varchar NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
        created_at          timestamp DEFAULT now(),
        updated_at          timestamp DEFAULT now()
      )
    `);

    // 5. external_chat_messages — conversation history per session
    await client.query(`
      CREATE TABLE IF NOT EXISTS external_chat_messages (
        id         varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id varchar NOT NULL REFERENCES external_chat_sessions(id) ON DELETE CASCADE,
        role       text NOT NULL,
        content    text NOT NULL,
        created_at timestamp DEFAULT now()
      )
    `);

    // 6. ai_suggestions — AI-generated market update suggestions pending admin review
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_suggestions (
        id                       varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id                varchar NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
        market_id                varchar NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
        status                   text NOT NULL DEFAULT 'pending',
        suggestion_type          text NOT NULL,
        subject_id               varchar NOT NULL,
        subject_name             text NOT NULL,
        subject_category         text,
        current_value            numeric(5,2),
        suggested_value          numeric(5,2),
        current_commentary       text,
        suggested_commentary     text,
        reasoning                text NOT NULL,
        confidence               text NOT NULL DEFAULT 'MEDIUM',
        triggered_by_article_ids text[],
        created_at               timestamp DEFAULT now(),
        reviewed_at              timestamp
      )
    `);

    // 7. user_llm_api_keys — per-user BYO LLM API keys for Market Builder
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_llm_api_keys (
        id         varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider   text NOT NULL,
        api_key    text NOT NULL,
        updated_at timestamp DEFAULT now(),
        UNIQUE(user_id, provider)
      )
    `);

    // 8. is_ecosystem column on feature_categories (missed in original schema push)
    await client.query(`
      ALTER TABLE feature_categories
        ADD COLUMN IF NOT EXISTS is_ecosystem boolean NOT NULL DEFAULT false
    `);

    // 9. vendor_signals — unified multi-source intelligence feed
    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_signals (
        id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id         varchar NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
        market_id         varchar NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
        source_type       text NOT NULL,
        title             text NOT NULL,
        content           text,
        url               text,
        sentiment         text,
        sentiment_score   decimal(4,3),
        impact_label      text,
        fed_into_suggestion boolean NOT NULL DEFAULT false,
        ai_suggestion_id  varchar REFERENCES ai_suggestions(id) ON DELETE SET NULL,
        signal_date       timestamp,
        collected_at      timestamp DEFAULT now(),
        raw_data          jsonb
      )
    `);

    // 10. Unique index on vendor_signals(vendor_id, url) to prevent concurrent duplicates
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS vendor_signals_vendor_url_uidx
      ON vendor_signals (vendor_id, url)
      WHERE url IS NOT NULL
    `);

    // 11. Fix any anthropic jobs that have invalid/deprecated model IDs
    await client.query(`
      UPDATE market_builder_jobs
      SET llm_model = 'claude-3-7-sonnet-20250219'
      WHERE llm_provider = 'anthropic'
        AND llm_model NOT IN (
          'claude-3-7-sonnet-20250219',
          'claude-3-5-sonnet-20241022',
          'claude-3-opus-20240229'
        )
    `);

    console.log('[DB] Startup migrations applied successfully');
  } catch (err) {
    console.error('[DB] Startup migration error:', err);
    // Non-fatal: the app can still start; DB push should be run manually
  } finally {
    client.release();
  }
}