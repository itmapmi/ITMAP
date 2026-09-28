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
 * Either the shared database handle or a transaction created from it. Storage
 * functions that must take part in a caller's transaction accept this as an
 * optional last argument and default to `db`.
 */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

class FactReviewMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactReviewMigrationError";
  }
}

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

    // 6b. proposed_commentary_rewrite column on ai_suggestions (full AI rewrite, on-demand)
    await client.query(`
      ALTER TABLE ai_suggestions
        ADD COLUMN IF NOT EXISTS proposed_commentary_rewrite text
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

    // 23. vendor_seat_audience — removed. The "watched audience" feature was
    //     dropped in favor of vendor seats seeing full market visitor pools.
    //     Drop the table if it exists from an earlier deploy.
    await client.query(`
      DROP TABLE IF EXISTS vendor_seat_audience;
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

    // 26. RFP Responder tables — vendor-side pipeline for responding to client
    //     RFPs. Three tables: sessions (one per RFP upload), requirements
    //     (decomposed from the RFP doc), answers (one per requirement, enforced
    //     by a unique index so generation is idempotent).
    //     Guarded with IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS so safe
    //     across all environments without a preceding db:push.
    await client.query(`
      CREATE TABLE IF NOT EXISTS rfp_response_sessions (
        id                  varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id           varchar NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
        uploaded_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_org_name     text,
        rfp_file_name       text,
        rfp_text            text,
        market_id           varchar REFERENCES markets(id) ON DELETE SET NULL,
        status              text NOT NULL DEFAULT 'uploading',
        error_message       text,
        requirements_count  integer NOT NULL DEFAULT 0,
        green_count         integer NOT NULL DEFAULT 0,
        amber_count         integer NOT NULL DEFAULT 0,
        red_count           integer NOT NULL DEFAULT 0,
        confirmed_count     integer NOT NULL DEFAULT 0,
        reviewed_at         timestamp,
        generation_started_at timestamp,
        completed_at        timestamp,
        created_at          timestamp DEFAULT now(),
        updated_at          timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS rfp_response_reqs (
        id               varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id       varchar NOT NULL REFERENCES rfp_response_sessions(id) ON DELETE CASCADE,
        vendor_id        varchar NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
        section          text,
        requirement_text text NOT NULL,
        category         text NOT NULL DEFAULT 'other',
        mandatory        boolean NOT NULL DEFAULT false,
        response_type    text NOT NULL DEFAULT 'descriptive',
        display_order    integer NOT NULL DEFAULT 0,
        created_at       timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS rfp_response_answers (
        id                  varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        requirement_id      varchar NOT NULL REFERENCES rfp_response_reqs(id) ON DELETE CASCADE,
        session_id          varchar NOT NULL REFERENCES rfp_response_sessions(id) ON DELETE CASCADE,
        vendor_id           varchar NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
        generated_text      text,
        coverage_flag       text NOT NULL DEFAULT 'pending',
        sources             jsonb,
        competitive_claims  jsonb,
        sme_note            text,
        confirmed           boolean NOT NULL DEFAULT false,
        citations_visible   boolean NOT NULL DEFAULT true,
        created_at          timestamp DEFAULT now(),
        updated_at          timestamp DEFAULT now()
      );
    `);

    // 26b. Unique index on rfp_response_answers(requirement_id) — one answer per
    //      requirement, makes generation idempotent via ON CONFLICT upsert.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS rfp_answer_req_uniq
        ON rfp_response_answers (requirement_id)
    `);

    // 27. RFP Architecture Diagrams (Task #120 — Diagram Engine)
    await client.query(`
      CREATE TABLE IF NOT EXISTS rfp_diagrams (
        id               varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id       varchar NOT NULL REFERENCES rfp_response_sessions(id) ON DELETE CASCADE,
        req_id           varchar REFERENCES rfp_response_reqs(id) ON DELETE SET NULL,
        diagram_intent   text NOT NULL,
        title            text NOT NULL,
        topology_spec    jsonb NOT NULL,
        svg_content      text NOT NULL,
        node_positions   jsonb NOT NULL DEFAULT '{}',
        icon_manifest    jsonb NOT NULL DEFAULT '[]',
        has_tier4_pending boolean NOT NULL DEFAULT false,
        created_at       timestamp DEFAULT now(),
        updated_at       timestamp DEFAULT now()
      );
    `);

    // 28. RFP Export History (Task #130 — persist exports to GCS for re-download)
    await client.query(`
      CREATE TABLE IF NOT EXISTS rfp_export_history (
        id                    varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id            varchar NOT NULL REFERENCES rfp_response_sessions(id) ON DELETE CASCADE,
        vendor_id             varchar NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
        exported_by_user_id   varchar REFERENCES users(id) ON DELETE SET NULL,
        format                text NOT NULL,
        file_name             text NOT NULL,
        storage_key           text NOT NULL,
        file_size_bytes       integer,
        created_at            timestamp DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS rfp_export_history_session_id_created_at_idx
        ON rfp_export_history (session_id, created_at DESC)
    `);

    // 29. Public contact-form submissions and admin Messages inbox.
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name  text NOT NULL,
        last_name   text NOT NULL,
        email       text NOT NULL,
        company     text NOT NULL,
        subject     text NOT NULL,
        message     text NOT NULL,
        source      text NOT NULL,
        vendor_id   varchar REFERENCES vendors(id) ON DELETE SET NULL,
        vendor_name text,
        is_read     boolean NOT NULL DEFAULT false,
        read_at     timestamp,
        created_at  timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS contact_messages_unread_created_idx
        ON contact_messages (is_read, created_at);
    `);

    // 30. Vendor Evaluation Fact Review flags. Preserve existing feature
    // flags while allowing a flag to target either a feature-support row or a
    // vendor-score write-up. This transaction never rewrites or deletes vendor
    // feedback; audit failures roll back every schema change and stop startup.
    await client.query("BEGIN");
    try {
      await client.query(`
        ALTER TABLE vendor_fact_check_flags
          ADD COLUMN IF NOT EXISTS vendor_score_id varchar;
        ALTER TABLE vendor_fact_check_flags
          ALTER COLUMN feature_support_id DROP NOT NULL;
      `);
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'vendor_fact_check_flags_vendor_score_id_vendor_scores_id_fk'
              AND conrelid = 'vendor_fact_check_flags'::regclass
          ) THEN
          IF EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'vendor_fact_check_flags_vendor_score_id_fkey'
              AND conrelid = 'vendor_fact_check_flags'::regclass
          ) THEN
            ALTER TABLE vendor_fact_check_flags
              RENAME CONSTRAINT vendor_fact_check_flags_vendor_score_id_fkey
              TO vendor_fact_check_flags_vendor_score_id_vendor_scores_id_fk;
          ELSE
            ALTER TABLE vendor_fact_check_flags
              ADD CONSTRAINT vendor_fact_check_flags_vendor_score_id_vendor_scores_id_fk
              FOREIGN KEY (vendor_score_id) REFERENCES vendor_scores(id) ON DELETE CASCADE;
          END IF;
          END IF;
        END $$;
      `);

      const [invalidTargets, duplicatePendingFeatureFlags, duplicatePendingVendorScoreFlags] =
        await Promise.all([
          client.query(`
            SELECT COUNT(*)::int AS count
            FROM vendor_fact_check_flags
            WHERE (feature_support_id IS NULL AND vendor_score_id IS NULL)
               OR (feature_support_id IS NOT NULL AND vendor_score_id IS NOT NULL)
          `),
          client.query(`
            SELECT COUNT(*)::int AS count
            FROM (
              SELECT 1
              FROM vendor_fact_check_flags
              WHERE status = 'pending' AND feature_support_id IS NOT NULL
              GROUP BY vendor_id, reported_by_user_id, feature_support_id
              HAVING COUNT(*) > 1
            ) AS duplicates
          `),
          client.query(`
            SELECT COUNT(*)::int AS count
            FROM (
              SELECT 1
              FROM vendor_fact_check_flags
              WHERE status = 'pending' AND vendor_score_id IS NOT NULL
              GROUP BY vendor_id, reported_by_user_id, vendor_score_id
              HAVING COUNT(*) > 1
            ) AS duplicates
          `),
        ]);
      const auditFailures = [
        ["invalid targets", invalidTargets.rows[0]?.count ?? 0],
        ["duplicate pending feature flags", duplicatePendingFeatureFlags.rows[0]?.count ?? 0],
        ["duplicate pending vendor evaluation flags", duplicatePendingVendorScoreFlags.rows[0]?.count ?? 0],
      ].filter(([, count]) => Number(count) > 0);
      if (auditFailures.length > 0) {
        throw new Error(
          `Fact Review migration needs manual data cleanup: ${
            auditFailures.map(([kind, count]) => `${count} ${kind}`).join(", ")
          }`,
        );
      }

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'vendor_fact_check_flags_exactly_one_target'
              AND conrelid = 'vendor_fact_check_flags'::regclass
          ) THEN
            ALTER TABLE vendor_fact_check_flags
              ADD CONSTRAINT vendor_fact_check_flags_exactly_one_target
              CHECK (
                ((feature_support_id IS NOT NULL)::int + (vendor_score_id IS NOT NULL)::int) = 1
              );
          END IF;
        END $$;
        CREATE UNIQUE INDEX IF NOT EXISTS vendor_fact_check_flags_pending_feature_unique
          ON vendor_fact_check_flags (vendor_id, reported_by_user_id, feature_support_id)
          WHERE status = 'pending' AND feature_support_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS vendor_fact_check_flags_pending_vendor_score_unique
          ON vendor_fact_check_flags (vendor_id, reported_by_user_id, vendor_score_id)
          WHERE status = 'pending' AND vendor_score_id IS NOT NULL;
      `);
      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original migration failure is the useful error for the caller.
      }
      throw new FactReviewMigrationError(
        `Fact Review schema migration failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // 27. Passwordless signup + email verification. New self-registered
    //     accounts start unverified (email_verified defaults to true so
    //     existing/admin-created accounts are unaffected) and carry a
    //     one-time verification token plus a timestamp used to rate-limit
    //     "resend verification email".
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_sent_at timestamp;
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_verification_token_unique
        ON users (email_verification_token) WHERE email_verification_token IS NOT NULL;
    `);

    // 31. Unverified accounts are allowed a fixed number of independent
    //     sign-in sessions (MAX_UNVERIFIED_SESSIONS in shared/verification.ts)
    //     instead of a wall-clock grace period. Counter is incremented at
    //     login/register only.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS unverified_session_count integer NOT NULL DEFAULT 0;
    `);

    // 32. "Continue with Google": Google account subject id linked to a user.
    //     Nullable (email-only accounts never set it); unique so one Google
    //     account can only ever map to one user.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id text;
      CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique
        ON users (google_id) WHERE google_id IS NOT NULL;
    `);

    // 33. Company profile + separately verified company email. Buyers on a
    //     consumer-domain login email must verify a company address before
    //     Reports / News / Intelligence Feed unlock (shared/company-email.ts).
    //     Token is one-time and unique like the account-verification token.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS designation text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS company_email text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS company_email_verified boolean NOT NULL DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS company_email_verification_token text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS company_email_verification_sent_at timestamp;
      CREATE UNIQUE INDEX IF NOT EXISTS users_company_email_verification_token_unique
        ON users (company_email_verification_token) WHERE company_email_verification_token IS NOT NULL;
      -- A company email may be *verified* on one account only (unverified claims are free).
      CREATE UNIQUE INDEX IF NOT EXISTS users_company_email_verified_unique
        ON users (lower(company_email)) WHERE company_email_verified = true AND company_email IS NOT NULL;
    `);

    // 34. Landing attribution on traffic_visitors (Task #81 — Operations
    //     conversion funnel + ad registration conversion). Set once, never
    //     overwritten, so every downstream funnel step (including server-only
    //     signup/verification/login events that carry no marketId) can be
    //     grouped by where the visitor first landed and which campaign sent them.
    await client.query(`
      ALTER TABLE traffic_visitors ADD COLUMN IF NOT EXISTS landing_path text;
      ALTER TABLE traffic_visitors ADD COLUMN IF NOT EXISTS landing_market_id varchar
        REFERENCES markets(id) ON DELETE SET NULL;
      ALTER TABLE traffic_visitors ADD COLUMN IF NOT EXISTS landing_utm_source text;
      ALTER TABLE traffic_visitors ADD COLUMN IF NOT EXISTS landing_utm_medium text;
      ALTER TABLE traffic_visitors ADD COLUMN IF NOT EXISTS landing_utm_campaign text;
      ALTER TABLE traffic_visitors ADD COLUMN IF NOT EXISTS landing_utm_term text;
      ALTER TABLE traffic_visitors ADD COLUMN IF NOT EXISTS landing_utm_content text;
    `);

    // 35. Atomicity guard for landing attribution (Task #81 follow-up fix).
    //     Previously each landing_* column was COALESCEd independently, so a
    //     visitor landing on a non-market page could still have
    //     landing_market_id backfilled from a later, unrelated market visit.
    //     landing_captured_at gates ALL landing_* columns together in one
    //     UPDATE so they are set exactly once, atomically, from the same event.
    await client.query(`
      ALTER TABLE traffic_visitors ADD COLUMN IF NOT EXISTS landing_captured_at timestamp;
      UPDATE traffic_visitors SET landing_captured_at = first_seen_at
        WHERE landing_captured_at IS NULL
          AND (landing_path IS NOT NULL OR landing_market_id IS NOT NULL OR landing_utm_source IS NOT NULL
               OR landing_utm_medium IS NOT NULL OR landing_utm_campaign IS NOT NULL
               OR landing_utm_term IS NOT NULL OR landing_utm_content IS NOT NULL);
    `);

    // 36. Audit columns for the feature-derived criteria (Product
    //     Capabilities, ISV Ecosystem): raw weighted-coverage roll-up and the
    //     feature count it was computed over, alongside the calibrated score.
    //     Nullable, additive. Values are populated by the idempotent backfill
    //     (npm run derive:backfill / POST /api/admin/derived-scores/rederive)
    //     and kept current by server/derivedFeatureScores.ts.
    await client.query(`
      ALTER TABLE vendor_scores ADD COLUMN IF NOT EXISTS derived_coverage numeric(5,4);
      ALTER TABLE vendor_scores ADD COLUMN IF NOT EXISTS derived_feature_count integer;
    `);

    // 37. Absolute quadrant positioning: per-market box thresholds (rubric
    //     score units) and the admin-only weight-version audit trail. The three
    //     legacy two-band columns (divider Y / top label / colour theme) were
    //     never read anywhere and are dropped. Initial versions are seeded
    //     idempotently by seedInitialWeightVersions() right after this runs.
    await client.query(`
      ALTER TABLE markets ADD COLUMN IF NOT EXISTS execution_threshold_low numeric(4,2) NOT NULL DEFAULT 4.50;
      ALTER TABLE markets ADD COLUMN IF NOT EXISTS execution_threshold_high numeric(4,2) NOT NULL DEFAULT 5.50;
      ALTER TABLE markets ADD COLUMN IF NOT EXISTS viability_threshold numeric(4,2) NOT NULL DEFAULT 5.00;
      ALTER TABLE markets DROP COLUMN IF EXISTS quadrant_divider_y;
      ALTER TABLE markets DROP COLUMN IF EXISTS quadrant_top_label;
      ALTER TABLE markets DROP COLUMN IF EXISTS quadrant_color_theme;
      CREATE TABLE IF NOT EXISTS market_weight_versions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        market_id varchar NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
        version integer NOT NULL,
        weights jsonb NOT NULL,
        criteria_names jsonb NOT NULL DEFAULT '{}'::jsonb,
        thresholds jsonb NOT NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
        created_by_label text NOT NULL,
        note text
      );
      CREATE UNIQUE INDEX IF NOT EXISTS market_weight_versions_market_version_idx
        ON market_weight_versions (market_id, version);
      DELETE FROM market_criteria_weights a
        USING market_criteria_weights b
        WHERE a.market_id = b.market_id AND a.criteria_id = b.criteria_id AND a.ctid < b.ctid;
      CREATE UNIQUE INDEX IF NOT EXISTS market_criteria_weights_market_criteria_idx
        ON market_criteria_weights (market_id, criteria_id);
    `);

    // 38. Offline Excel translation workflow: per-language overlays for vendor
    //     score notes and feature-support comments. English text always stays
    //     on vendor_scores / vendor_feature_support; these tables only ever
    //     hold translated text plus a staleness snapshot (source_updated_at).
    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_score_translations (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_score_id varchar NOT NULL REFERENCES vendor_scores(id) ON DELETE CASCADE,
        language text NOT NULL,
        notes text,
        source_updated_at timestamp,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS vendor_score_translations_score_lang_uniq
        ON vendor_score_translations (vendor_score_id, language);
      CREATE TABLE IF NOT EXISTS vendor_feature_support_translations (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_feature_support_id varchar NOT NULL REFERENCES vendor_feature_support(id) ON DELETE CASCADE,
        language text NOT NULL,
        comments text,
        source_updated_at timestamp,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS vendor_feature_support_translations_support_lang_uniq
        ON vendor_feature_support_translations (vendor_feature_support_id, language);
    `);

    // 39. On-demand AI translation cache for continuously-ingested Intelligence
    //     Feed signals and News articles. These items are immutable once
    //     published, so unlike the two translation tables above there is no
    //     staleness snapshot — a cached translation is reused indefinitely.
    await client.query(`
      CREATE TABLE IF NOT EXISTS content_translations (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        content_type text NOT NULL,
        content_id varchar NOT NULL,
        language text NOT NULL,
        translated_fields jsonb NOT NULL,
        source_field_hashes jsonb,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS content_translations_type_id_lang_uniq
        ON content_translations (content_type, content_id, language);
      ALTER TABLE content_translations ADD COLUMN IF NOT EXISTS source_field_hashes jsonb;
    `);

    console.log('[DB] Startup migrations applied successfully');
  } catch (err) {
    console.error('[DB] Startup migration error:', err);
    if (err instanceof FactReviewMigrationError) throw err;
    // Non-fatal: the app can still start; DB push should be run manually
  } finally {
    client.release();
  }
}