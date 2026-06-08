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

    // 11. Pre-create drizzle-named unique constraints so db:push never shows interactive prompts.
    //     The DB may have old _key-named constraints from before drizzle tracked them;
    //     we add the _unique-named ones drizzle expects, idempotently.
    const uniqueConstraints: Array<{ table: string; column: string; constraint: string }> = [
      { table: 'market_builder_llm_settings', column: 'provider',  constraint: 'market_builder_llm_settings_provider_unique' },
      { table: 'external_api_keys',           column: 'key_hash',  constraint: 'external_api_keys_key_hash_unique' },
      { table: 'users',                       column: 'email',     constraint: 'users_email_unique' },
      { table: 'users',                       column: 'google_id', constraint: 'users_google_id_unique' },
      { table: 'users',                       column: 'linkedin_id', constraint: 'users_linkedin_id_unique' },
    ];
    for (const { table, column, constraint } of uniqueConstraints) {
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = '${constraint}'
          ) THEN
            ALTER TABLE ${table} ADD CONSTRAINT ${constraint} UNIQUE (${column});
          END IF;
        END $$
      `);
    }

    // 12. Cast chat_messages.data_context from text → jsonb (schema expects jsonb)
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_messages'
            AND column_name = 'data_context'
            AND data_type = 'text'
        ) THEN
          ALTER TABLE chat_messages
            ALTER COLUMN data_context TYPE jsonb USING data_context::jsonb;
        END IF;
      END $$
    `);

    // 13. Fix any anthropic jobs that have invalid/deprecated model IDs
    await client.query(`
      UPDATE market_builder_jobs
      SET llm_model = 'claude-sonnet-4-6'
      WHERE llm_provider = 'anthropic'
        AND llm_model NOT IN (
          'claude-opus-4-8',
          'claude-opus-4-7',
          'claude-opus-4-6',
          'claude-sonnet-4-6',
          'claude-haiku-4-5-20251001'
        )
    `);

    // 14. Per-stage LLM overrides table (stage-llm picker feature)
    await client.query(`
      CREATE TABLE IF NOT EXISTS market_builder_job_stage_llm (
        id         varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id     varchar NOT NULL REFERENCES market_builder_jobs(id) ON DELETE CASCADE,
        stage_num  integer NOT NULL,
        provider   varchar NOT NULL,
        model      varchar NOT NULL,
        CONSTRAINT market_builder_job_stage_llm_unique UNIQUE (job_id, stage_num)
      )
    `);

    // 15. (Removed) Historical 6→9 stage remap migration.
    //     This block was a one-shot remap that shipped when the pipeline grew
    //     from 6 stages to 9. Its idempotency guard ("skip if any row already
    //     has stage 7/8/9") was fundamentally broken: any production database
    //     where no current job has reached stage 7+ would re-run the remap on
    //     every server boot, silently shifting newly-inserted stage rows
    //     (2→3, 3→4, 4→6, etc.). This caused the long-running Market Builder
    //     row-numbering bug. The historical remap completed in prod long ago,
    //     so the migration is removed entirely.

    // 16. Add missing created_at column to market_builder_job_stage_llm (omitted in migration 14)
    await client.query(`
      ALTER TABLE market_builder_job_stage_llm
        ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now()
    `);

    // 17. Add scenario_values JSONB column to forecast_cruxes (Phase 3 debate).
    //     Guarded by table-existence check: forecast_* tables are created by
    //     Replit's Publish flow (dev→prod schema diff), not by this script.
    //     If the table doesn't exist yet (e.g. fresh prod before publish-time
    //     diff applies), this is a no-op so subsequent migrations still run.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'forecast_cruxes') THEN
          ALTER TABLE forecast_cruxes ADD COLUMN IF NOT EXISTS scenario_values jsonb;
        END IF;
      END $$
    `);

    // 18. Add report_sections JSONB column to forecasts (Phase 4 report output).
    //     Same guard as #17.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'forecasts') THEN
          ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS report_sections jsonb;
        END IF;
      END $$
    `);

    // 19. RFP Builder tables (additive, IF NOT EXISTS so safe across envs).
    //     Drizzle definitions live in shared/schema.ts; this mirrors the
    //     authoritative shape so first-boot environments without a manual
    //     db:push can still serve /api/me/rfps* without relation-not-found.
    await client.query(`
      CREATE TABLE IF NOT EXISTS rfp_projects (
        id                 varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id      varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        market_id          varchar NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
        title              text NOT NULL,
        status             text NOT NULL DEFAULT 'draft',
        customer_profile   jsonb NOT NULL DEFAULT '{}'::jsonb,
        generated_markdown text,
        generated_at       timestamp,
        error              text,
        created_at         timestamp DEFAULT now(),
        updated_at         timestamp DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS rfp_projects_owner_idx ON rfp_projects(owner_user_id);
      CREATE INDEX IF NOT EXISTS rfp_projects_market_idx ON rfp_projects(market_id);

      CREATE TABLE IF NOT EXISTS rfp_interview_messages (
        id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        rfp_id      varchar NOT NULL REFERENCES rfp_projects(id) ON DELETE CASCADE,
        role        text NOT NULL,
        content     text NOT NULL,
        extracted   jsonb,
        created_at  timestamp DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS rfp_messages_rfp_idx ON rfp_interview_messages(rfp_id);

      CREATE TABLE IF NOT EXISTS rfp_requirements (
        id             varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        rfp_id         varchar NOT NULL REFERENCES rfp_projects(id) ON DELETE CASCADE,
        kind           text NOT NULL,
        feature_id     varchar,
        label          text NOT NULL,
        description    text,
        priority       text NOT NULL DEFAULT 'should',
        weight         integer NOT NULL DEFAULT 3,
        expected_value text,
        display_order  integer NOT NULL DEFAULT 0,
        created_at     timestamp DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS rfp_requirements_rfp_idx ON rfp_requirements(rfp_id);

      CREATE TABLE IF NOT EXISTS rfp_sections (
        id            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        rfp_id        varchar NOT NULL REFERENCES rfp_projects(id) ON DELETE CASCADE,
        section_key   text NOT NULL,
        title         text NOT NULL,
        body          text,
        data          jsonb,
        display_order integer NOT NULL DEFAULT 0,
        created_at    timestamp DEFAULT now(),
        updated_at    timestamp DEFAULT now(),
        CONSTRAINT rfp_sections_rfp_key_unique UNIQUE (rfp_id, section_key)
      );

      CREATE TABLE IF NOT EXISTS rfp_shortlist (
        id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        rfp_id      varchar NOT NULL REFERENCES rfp_projects(id) ON DELETE CASCADE,
        vendor_id   varchar NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
        fit_score   numeric,
        rationale   text,
        is_included boolean NOT NULL DEFAULT true,
        rank        integer NOT NULL DEFAULT 0,
        created_at  timestamp DEFAULT now(),
        CONSTRAINT rfp_shortlist_rfp_vendor_unique UNIQUE (rfp_id, vendor_id)
      );

      CREATE TABLE IF NOT EXISTS rfp_outreach (
        id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        rfp_id            varchar NOT NULL REFERENCES rfp_projects(id) ON DELETE CASCADE,
        vendor_id         varchar NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
        status            text NOT NULL DEFAULT 'not_started',
        contact_name      text,
        contact_email     text,
        notes             text,
        response_text     text,
        response_file_url text,
        invited_at        timestamp,
        responded_at      timestamp,
        created_at        timestamp DEFAULT now(),
        updated_at        timestamp DEFAULT now(),
        CONSTRAINT rfp_outreach_rfp_vendor_unique UNIQUE (rfp_id, vendor_id)
      );
    `);

    // 20. Backfill response columns on rfp_outreach if the table pre-existed
    //     from an earlier rollout that lacked these columns.
    await client.query(`
      ALTER TABLE rfp_outreach
        ADD COLUMN IF NOT EXISTS response_text text,
        ADD COLUMN IF NOT EXISTS response_file_url text
    `);

    // 21. feature_access on users (RBAC) — per-user granted lockable features.
    //     Additive + idempotent so existing/production DBs gain the column
    //     without breaking user/auth queries that select full user rows.
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS feature_access text[] NOT NULL DEFAULT '{}'::text[]
    `);

    // 21b. vendor_scope_id on users — pins a vendor-side seat to a single
    //      vendor for the Lead-Gen buyer-intent panel. Additive + idempotent.
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS vendor_scope_id varchar
          REFERENCES vendors(id) ON DELETE SET NULL
    `);

    // 22. user_events — append-only activity log powering Lead-Gen Activity
    //     Intelligence (buyer-intent scoring). Idempotent + additive.
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_events (
        id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id  text,
        event_type  text NOT NULL,
        market_id   varchar REFERENCES markets(id) ON DELETE SET NULL,
        vendor_id   varchar REFERENCES vendors(id) ON DELETE SET NULL,
        metadata    jsonb,
        duration_ms integer,
        source      text NOT NULL DEFAULT 'server',
        created_at  timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS user_events_user_idx ON user_events (user_id);
      CREATE INDEX IF NOT EXISTS user_events_vendor_idx ON user_events (vendor_id);
      CREATE INDEX IF NOT EXISTS user_events_market_idx ON user_events (market_id);
      CREATE INDEX IF NOT EXISTS user_events_type_idx ON user_events (event_type);
      CREATE INDEX IF NOT EXISTS user_events_created_idx ON user_events (created_at);
      CREATE INDEX IF NOT EXISTS user_events_user_created_idx ON user_events (user_id, created_at);
    `);

    // 23. vendor_seat_audience — admin-defined "watched audience" linking a
    //     vendor seat to a set of end users on a specific market. Idempotent.
    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_seat_audience (
        id           varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        seat_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        market_id    varchar NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
        end_user_id  varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vsa_seat_idx ON vendor_seat_audience (seat_user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS vsa_unique_idx ON vendor_seat_audience (seat_user_id, market_id, end_user_id);
    `);

    // 24. users.last_invite_sent_at — stamped on every successful resend-invite.
    //     Used for the 10-minute rate-limit guard and the admin UI "Resent X ago"
    //     display. Added as an additive column so existing rows default to NULL.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_invite_sent_at timestamp;
    `);

    // 25. users.invited_at — set when a placeholder account is created via CSV
    //     audience import; cleared when the user completes registration.
    //     NULL for all normal self-registered accounts.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at timestamp;
    `);

    console.log('[DB] Startup migrations applied successfully');
  } catch (err) {
    console.error('[DB] Startup migration error:', err);
    // Non-fatal: the app can still start; DB push should be run manually
  } finally {
    client.release();
  }
}