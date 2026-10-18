/** Also run at startup; idempotent and additive, no existing app data is touched. */
export const SEARCH_CONSOLE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS search_console_inspections (
    property text NOT NULL,
    url text NOT NULL,
    attempted_at timestamptz NOT NULL,
    success_at timestamptz,
    result jsonb,
    error text,
    PRIMARY KEY (property, url)
  );
  CREATE TABLE IF NOT EXISTS search_console_refresh_state (
    property text PRIMARY KEY,
    next_refresh_at timestamptz,
    lease_until timestamptz,
    lease_token text
  );
  CREATE TABLE IF NOT EXISTS search_console_reservations (
    id varchar PRIMARY KEY,
    property text NOT NULL,
    reserved_at timestamptz NOT NULL DEFAULT now(),
    calls integer NOT NULL
  );
  CREATE INDEX IF NOT EXISTS search_console_reservations_window
    ON search_console_reservations (property, reserved_at);
`;
