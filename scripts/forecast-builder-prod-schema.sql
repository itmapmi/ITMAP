-- ─────────────────────────────────────────────────────────────────────────────
-- Forecast Builder schema — production bootstrap
-- ─────────────────────────────────────────────────────────────────────────────
-- Safe to run multiple times. Every statement uses IF NOT EXISTS so it will
-- only create what's missing. Run this once in the prod SQL studio to bring
-- production in sync with the Drizzle schema in shared/schema.ts.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. forecasts — top-level forecast record
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
);

-- 2. forecast_boundaries — Phase 1 boundary definition
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
);

-- 3. forecast_briefs — Phase 2 Socratic interview output
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
);

-- 4. forecast_segments — MECE-validated market segments
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
);

-- 5. forecast_assumptions — versioned, editable assumption objects
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
);

-- 6. forecast_cruxes — contested assumption debates with scenario values
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
);

-- 7. forecast_scenarios — base/bull/bear computed paths
CREATE TABLE IF NOT EXISTS forecast_scenarios (
  id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id       varchar NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
  name              text NOT NULL,
  narrative         text,
  crux_resolutions  jsonb DEFAULT '{}'::jsonb,
  forecast_path     jsonb,
  created_at        timestamp DEFAULT now()
);

-- 8. forecast_sources — citations / supporting documents
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
);

-- 8b. forecast_sources.assumption_id — Phase 5 addition
--     Idempotent: only added if column doesn't already exist.
ALTER TABLE forecast_sources
  ADD COLUMN IF NOT EXISTS assumption_id varchar;

-- 9. forecast_audit_log — append-only audit trail
CREATE TABLE IF NOT EXISTS forecast_audit_log (
  id           varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id  varchar NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
  event_type   text NOT NULL,
  actor        text NOT NULL,
  payload      jsonb,
  created_at   timestamp DEFAULT now()
);

-- 10. Helpful indexes for common forecast lookups
CREATE INDEX IF NOT EXISTS forecasts_created_by_idx          ON forecasts(created_by);
CREATE INDEX IF NOT EXISTS forecast_boundaries_forecast_idx  ON forecast_boundaries(forecast_id);
CREATE INDEX IF NOT EXISTS forecast_briefs_forecast_idx      ON forecast_briefs(forecast_id);
CREATE INDEX IF NOT EXISTS forecast_segments_forecast_idx    ON forecast_segments(forecast_id);
CREATE INDEX IF NOT EXISTS forecast_assumptions_forecast_idx ON forecast_assumptions(forecast_id);
CREATE INDEX IF NOT EXISTS forecast_cruxes_forecast_idx      ON forecast_cruxes(forecast_id);
CREATE INDEX IF NOT EXISTS forecast_scenarios_forecast_idx   ON forecast_scenarios(forecast_id);
CREATE INDEX IF NOT EXISTS forecast_sources_forecast_idx     ON forecast_sources(forecast_id);
CREATE INDEX IF NOT EXISTS forecast_sources_assumption_idx   ON forecast_sources(assumption_id);
CREATE INDEX IF NOT EXISTS forecast_audit_log_forecast_idx   ON forecast_audit_log(forecast_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify: should return 9 rows
-- ─────────────────────────────────────────────────────────────────────────────
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'forecast%'
ORDER BY table_name;
