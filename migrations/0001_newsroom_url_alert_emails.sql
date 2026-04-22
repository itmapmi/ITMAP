-- Migration: newsroom URL alert emails (task-14)
-- Additive changes only — safe to apply on any environment.

-- 1. Global alert settings table
CREATE TABLE IF NOT EXISTS "admin_alert_settings" (
  "id"                   varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email_alerts_enabled" boolean NOT NULL DEFAULT true,
  "recipient_emails"     text,
  "updated_at"           timestamp DEFAULT now()
);

-- 2. Per-vendor opt-out flag
ALTER TABLE "vendors"
  ADD COLUMN IF NOT EXISTS "newsroom_alert_disabled" boolean NOT NULL DEFAULT false;
