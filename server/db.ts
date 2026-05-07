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

    // 15. Remap market_builder_stages stage numbers from 6-stage to 9-stage pipeline.
    // Old: 2=VendorEval, 3=ProductFeatures, 4=ProductScoring, 5=Ecosystem, 6=EcoScoring
    // New: 3=VendorCommentary, 4=ProductFeatures, 6=ProductCommentary, 7=Ecosystem, 9=EcoCommentary
    // Remap in descending order to avoid collisions: 6→9, 5→7, 4→6, 3→4, 2→3
    await client.query(`
      DO $$
      BEGIN
        -- Only remap if the old 6-stage data still exists (no stage 7,8,9 yet)
        IF NOT EXISTS (
          SELECT 1 FROM market_builder_stages WHERE stage IN (7,8,9) LIMIT 1
        ) THEN
          UPDATE market_builder_stages SET stage = 9  WHERE stage = 6;
          UPDATE market_builder_stages SET stage = 7  WHERE stage = 5;
          UPDATE market_builder_stages SET stage = 6  WHERE stage = 4;
          UPDATE market_builder_stages SET stage = 4  WHERE stage = 3;
          UPDATE market_builder_stages SET stage = 3  WHERE stage = 2;
        END IF;
      END $$
    `);

    // 16. Add missing created_at column to market_builder_job_stage_llm (omitted in migration 14)
    await client.query(`
      ALTER TABLE market_builder_job_stage_llm
        ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now()
    `);

    // 17. Add scenario_values JSONB column to forecast_cruxes (Phase 3 debate)
    //     Stores deterministic bull/base/bear/final values from Phase 3.4 resolver.
    await client.query(`
      ALTER TABLE forecast_cruxes
        ADD COLUMN IF NOT EXISTS scenario_values jsonb
    `);

    // 18. Add report_sections JSONB column to forecasts (Phase 4 report output)
    //     Stores 8-section AI-written report + engine summary + QC status.
    await client.query(`
      ALTER TABLE forecasts
        ADD COLUMN IF NOT EXISTS report_sections jsonb
    `);

    // ── Forecast Builder schema (Phases 1–5) ──────────────────────────────
    // All idempotent CREATE TABLE IF NOT EXISTS so they apply cleanly on
    // first deploy to production (where these tables don't exist yet) and
    // are no-ops on environments where db:push has already been run.

    // 19. forecasts — top-level forecast record
    await client.query(`
      CREATE TABLE IF NOT EXISTS forecasts (
        id                       varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        created_by               varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title                    text NOT NULL,
        status                   text NOT NULL DEFAULT 'draft',
        base_year                integer,
        forecast_horizon_years   integer,
        currency                 text DEFAULT 'USD',
        currency_basis           text DEFAULT 'nominal',
        confidence_band          text,
        schema_version           text NOT NULL DEFAULT '1.0',
        report_sections          jsonb,
        error                    text,
        created_at               timestamp DEFAULT now(),
        updated_at               timestamp DEFAULT now()
      )
    `);

    // 20. forecast_boundaries — Phase 1 boundary definition
    await client.query(`
      CREATE TABLE IF NOT EXISTS forecast_boundaries (
        id                    varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        forecast_id           varchar NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
        included_categories   jsonb DEFAULT '[]'::jsonb,
        excluded_categories   jsonb DEFAULT '[]'::jsonb,
        geographic_scope      text,
        unit_of_measurement   text,
        time_horizon          text,
        custom_scope          boolean NOT NULL DEFAULT true,
        proposed_by_system    jsonb,
        confirmed_by_user     boolean NOT NULL DEFAULT false,
        user_edits            jsonb,
        created_at            timestamp DEFAULT now(),
        updated_at            timestamp DEFAULT now()
      )
    `);

    // 21. forecast_briefs — Phase 2 Socratic interview output
    await client.query(`
      CREATE TABLE IF NOT EXISTS forecast_briefs (
        id                       varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        forecast_id              varchar NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
        interview_mode           text NOT NULL DEFAULT 'express',
        purpose                  text,
        confidence_level         text,
        audience                 text,
        methodology_preference   text,
        base_year_anchor         text,
        drivers                  jsonb DEFAULT '[]'::jsonb,
        discontinuities          jsonb DEFAULT '[]'::jsonb,
        adjacent_markets         jsonb DEFAULT '[]'::jsonb,
        output_format            text,
        source_requirements      text,
        interview_transcript     jsonb DEFAULT '[]'::jsonb,
        created_at               timestamp DEFAULT now()
      )
    `);

    // 22. forecast_segments — MECE-validated market segments
    await client.query(`
      CREATE TABLE IF NOT EXISTS forecast_segments (
        id                            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        forecast_id                   varchar NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
        parent_segment_id             varchar,
        name                          text NOT NULL,
        description                   text,
        base_year_value               numeric(20,4),
        base_year_value_construction  jsonb,
        growth_assumption_ids         jsonb DEFAULT '[]'::jsonb,
        forecast_path                 jsonb,
        mece_validated                boolean NOT NULL DEFAULT false,
        sort_order                    integer NOT NULL DEFAULT 0,
        created_at                    timestamp DEFAULT now()
      )
    `);

    // 23. forecast_assumptions — versioned, editable assumption objects
    await client.query(`
      CREATE TABLE IF NOT EXISTS forecast_assumptions (
        id                     varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        forecast_id            varchar NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
        description            text NOT NULL,
        value                  numeric(20,6),
        unit                   text,
        proposed_by_models     jsonb DEFAULT '[]'::jsonb,
        current_value_source   text NOT NULL DEFAULT 'debate_consensus',
        sensitivity_rank       integer,
        editable_by_user       boolean NOT NULL DEFAULT true,
        original_ai_value      numeric(20,6),
        current_value          numeric(20,6),
        edit_history           jsonb DEFAULT '[]'::jsonb,
        created_at             timestamp DEFAULT now(),
        updated_at             timestamp DEFAULT now()
      )
    `);

    // 24. forecast_cruxes — contested assumption debates with scenario values
    await client.query(`
      CREATE TABLE IF NOT EXISTS forecast_cruxes (
        id                              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        forecast_id                     varchar NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
        contested_assumption_id         varchar,
        positions                       jsonb DEFAULT '[]'::jsonb,
        evidence_required_to_resolve    text,
        resolution_status               text NOT NULL DEFAULT 'unresolved',
        resolution_path                 text,
        estimated_impact                text,
        scenario_values                 jsonb,
        created_at                      timestamp DEFAULT now(),
        updated_at                      timestamp DEFAULT now()
      )
    `);

    // 25. forecast_scenarios — base/bull/bear computed paths
    await client.query(`
      CREATE TABLE IF NOT EXISTS forecast_scenarios (
        id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        forecast_id       varchar NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
        name              text NOT NULL,
        narrative         text,
        crux_resolutions  jsonb DEFAULT '{}'::jsonb,
        forecast_path     jsonb,
        created_at        timestamp DEFAULT now()
      )
    `);

    // 26. forecast_sources — citations / supporting documents
    await client.query(`
      CREATE TABLE IF NOT EXISTS forecast_sources (
        id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        forecast_id       varchar NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
        assumption_id     varchar,
        source_type       text NOT NULL,
        url               text,
        accessed_date     timestamp,
        verbatim_quote    text,
        reliability_tier  integer NOT NULL DEFAULT 2,
        title             text,
        created_at        timestamp DEFAULT now()
      )
    `);

    // 27. forecast_sources.assumption_id — Phase 5 addition
    //     Idempotent for environments where the table existed pre-Phase 5.
    await client.query(`
      ALTER TABLE forecast_sources
        ADD COLUMN IF NOT EXISTS assumption_id varchar
    `);

    // 28. forecast_audit_log — append-only audit trail
    await client.query(`
      CREATE TABLE IF NOT EXISTS forecast_audit_log (
        id           varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        forecast_id  varchar NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
        event_type   text NOT NULL,
        actor        text NOT NULL,
        payload      jsonb,
        created_at   timestamp DEFAULT now()
      )
    `);

    // 29. Helpful indexes for the most common forecast lookups
    await client.query(`CREATE INDEX IF NOT EXISTS forecasts_created_by_idx        ON forecasts(created_by)`);
    await client.query(`CREATE INDEX IF NOT EXISTS forecast_boundaries_forecast_idx ON forecast_boundaries(forecast_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS forecast_briefs_forecast_idx     ON forecast_briefs(forecast_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS forecast_segments_forecast_idx   ON forecast_segments(forecast_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS forecast_assumptions_forecast_idx ON forecast_assumptions(forecast_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS forecast_cruxes_forecast_idx     ON forecast_cruxes(forecast_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS forecast_scenarios_forecast_idx  ON forecast_scenarios(forecast_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS forecast_sources_forecast_idx    ON forecast_sources(forecast_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS forecast_sources_assumption_idx  ON forecast_sources(assumption_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS forecast_audit_log_forecast_idx  ON forecast_audit_log(forecast_id, created_at)`);

    console.log('[DB] Startup migrations applied successfully');
  } catch (err) {
    console.error('[DB] Startup migration error:', err);
    // Non-fatal: the app can still start; DB push should be run manually
  } finally {
    client.release();
  }
}