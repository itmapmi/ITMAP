/**
 * Forecast Audit Log utility
 *
 * Every state-changing operation in the Forecast Builder must call
 * writeAuditEntry so the complete provenance trail is persisted.
 *
 * The audit trail is a first-class product surface — enterprise customers
 * use it for board presentations and compliance.
 */

import { appendForecastAuditEntry } from "../storage/forecasts";

export type ForecastEventType =
  | "forecast_created"
  | "forecast_metadata_updated"
  | "forecast_deleted"
  | "boundary_proposed"
  | "boundary_confirmed"
  | "boundary_edited"
  | "interview_started"
  | "interview_answer"
  | "brief_completed"
  | "debate_started"
  | "debate_phase_completed"
  | "crux_identified"
  | "crux_resolved"
  | "crux_unresolved"
  | "calculation_run"
  | "assumption_overridden"
  | "source_added"
  | "source_removed"
  | "scenario_generated"
  | "forecast_completed"
  | "export_triggered"
  | "re_debate_triggered"
  | "challenge_triggered";

/**
 * Write a single structured audit entry for a forecast.
 *
 * @param forecastId  UUID of the forecast
 * @param eventType   One of the typed event types above
 * @param actor       Model name+version (e.g. "gpt-4o") or user_id
 * @param payload     Structured detail — schema varies per event_type
 */
export async function writeAuditEntry(
  forecastId: string,
  eventType: ForecastEventType,
  actor: string,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    await appendForecastAuditEntry({
      forecastId,
      eventType,
      actor,
      payload: payload ?? null,
    });
  } catch (err) {
    console.error("[ForecastAudit] Failed to write audit entry:", err);
  }
}
