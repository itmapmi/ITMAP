/**
 * Buyer-Intent Scoring Engine
 *
 * Deterministic TypeScript — NO LLM calls. Mirrors the Forecast Builder
 * engine pattern: all numbers are produced here, never by a model.
 *
 * An intent score (0–100) is derived from three components, each normalised
 * to 0–100 and then combined with fixed weights:
 *
 *   • Frequency (35%) — login/session cadence over a trailing window
 *                       (reuses user_activity_logs).
 *   • Recency   (30%) — exponential decay since the last activity.
 *   • Depth     (35%) — weighted count of high-value actions (comparisons,
 *                       downloads, RFPs, chat) using per-event-type weights.
 *
 * The engine returns a transparent factor breakdown so the UI can explain
 * exactly why a lead is hot.
 */

import { LEAD_GEN_EVENT_DEFS, type LeadGenEventType } from "@shared/schema";

export const FREQUENCY_WEIGHT = 0.35;
export const RECENCY_WEIGHT = 0.3;
export const DEPTH_WEIGHT = 0.35;

// Recency decays with a half-life of 7 days — a lead untouched for a week is
// worth half as much on the recency axis.
export const RECENCY_HALF_LIFE_DAYS = 7;

// Frequency saturates: this many active days in the window scores 100.
export const FREQUENCY_SATURATION_DAYS = 12;

// Depth saturates: this weighted-action total scores 100.
export const DEPTH_SATURATION = 60;

export interface LeadActivityInput {
  userId: string;
  // Weighted/raw counts per event type over the window.
  eventCounts: Partial<Record<LeadGenEventType, number>>;
  // Number of distinct days the user logged in during the window.
  loginActiveDays: number;
  // Most recent activity timestamp (event or login), or null if none.
  lastActivityAt: Date | null;
}

export interface IntentFactor {
  key: "frequency" | "recency" | "depth";
  label: string;
  score: number; // 0–100 normalised component
  weight: number; // contribution weight
  contribution: number; // score * weight (points toward final 0–100)
  detail: string; // human-readable explanation
}

export interface IntentResult {
  userId: string;
  score: number; // final 0–100
  band: "hot" | "warm" | "cool" | "cold";
  factors: IntentFactor[];
  weightedDepth: number;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function bandForScore(score: number): IntentResult["band"] {
  if (score >= 70) return "hot";
  if (score >= 45) return "warm";
  if (score >= 20) return "cool";
  return "cold";
}

/** Normalised frequency component (0–100) from distinct active login days. */
export function frequencyScore(loginActiveDays: number): number {
  return clamp((loginActiveDays / FREQUENCY_SATURATION_DAYS) * 100);
}

/** Normalised recency component (0–100) using exponential half-life decay. */
export function recencyScore(lastActivityAt: Date | null, now: Date = new Date()): number {
  if (!lastActivityAt) return 0;
  const days = (now.getTime() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 0) return 100;
  const decay = Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
  return clamp(decay * 100);
}

/** Weighted depth total from per-type counts (uses LEAD_GEN_EVENT_DEFS weights). */
export function weightedDepth(eventCounts: Partial<Record<LeadGenEventType, number>>): number {
  let total = 0;
  for (const [type, count] of Object.entries(eventCounts)) {
    const def = LEAD_GEN_EVENT_DEFS[type as LeadGenEventType];
    if (def && count) total += def.weight * count;
  }
  return total;
}

/** Normalised depth component (0–100) from the weighted depth total. */
export function depthScore(weighted: number): number {
  return clamp((weighted / DEPTH_SATURATION) * 100);
}

function describeRecency(lastActivityAt: Date | null, now: Date): string {
  if (!lastActivityAt) return "No recorded activity yet";
  const days = (now.getTime() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24);
  if (days < 1) return "Active within the last day";
  if (days < 2) return "Active yesterday";
  return `Last active ${Math.round(days)} days ago`;
}

/** Score a single lead deterministically and return a full factor breakdown. */
export function scoreLead(input: LeadActivityInput, now: Date = new Date()): IntentResult {
  const wDepth = weightedDepth(input.eventCounts);

  const freq = frequencyScore(input.loginActiveDays);
  const rec = recencyScore(input.lastActivityAt, now);
  const dep = depthScore(wDepth);

  const factors: IntentFactor[] = [
    {
      key: "frequency",
      label: "Frequency",
      score: round1(freq),
      weight: FREQUENCY_WEIGHT,
      contribution: round1(freq * FREQUENCY_WEIGHT),
      detail: `${input.loginActiveDays} active login day${input.loginActiveDays === 1 ? "" : "s"} in window`,
    },
    {
      key: "recency",
      label: "Recency",
      score: round1(rec),
      weight: RECENCY_WEIGHT,
      contribution: round1(rec * RECENCY_WEIGHT),
      detail: describeRecency(input.lastActivityAt, now),
    },
    {
      key: "depth",
      label: "Engagement depth",
      score: round1(dep),
      weight: DEPTH_WEIGHT,
      contribution: round1(dep * DEPTH_WEIGHT),
      detail: `Weighted activity value: ${Math.round(wDepth)}`,
    },
  ];

  const score = round1(
    freq * FREQUENCY_WEIGHT + rec * RECENCY_WEIGHT + dep * DEPTH_WEIGHT,
  );

  return {
    userId: input.userId,
    score,
    band: bandForScore(score),
    factors,
    weightedDepth: Math.round(wDepth),
  };
}

// ── Smoke test (called at startup in dev) ─────────────────────────────────

export function smokeTest(): void {
  const now = new Date("2026-05-29T12:00:00Z");
  const hot = scoreLead(
    {
      userId: "u-hot",
      eventCounts: { comparison_run: 4, report_downloaded: 2, chat_question_asked: 6, rfp_generated: 1 },
      loginActiveDays: 10,
      lastActivityAt: new Date("2026-05-29T08:00:00Z"),
    },
    now,
  );
  const cold = scoreLead(
    {
      userId: "u-cold",
      eventCounts: { market_viewed: 1 },
      loginActiveDays: 1,
      lastActivityAt: new Date("2026-04-01T00:00:00Z"),
    },
    now,
  );
  console.log(`[IntentEngine] Smoke test: hot=${hot.score} (${hot.band}), cold=${cold.score} (${cold.band})`);
  if (hot.score <= cold.score) {
    console.error("[IntentEngine] WARNING: hot lead did not outscore cold lead!");
  }
}
