-- Production migration script for news module rewrite
-- Run this against your production database before deploying

-- 1. Add newsroom_url to vendors
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS newsroom_url text;

-- 2. Add new AI analysis columns to news_articles
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS opinion text;
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS vendor_context text;
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS key_takeaway text;

-- 3. Make source_id nullable (was NOT NULL before)
ALTER TABLE news_articles ALTER COLUMN source_id DROP NOT NULL;

-- 4. Drop stale tables no longer used by the app
DROP TABLE IF EXISTS vendor_news CASCADE;
DROP TABLE IF EXISTS vendor_news_sources CASCADE;
DROP TABLE IF EXISTS news_sources CASCADE;
DROP TABLE IF EXISTS session CASCADE;

-- 5. Drop stale source_id columns from scoring tables (if present)
ALTER TABLE vendor_feature_support DROP COLUMN IF EXISTS source_id;
ALTER TABLE vendor_scores DROP COLUMN IF EXISTS source_id;

-- Done!
