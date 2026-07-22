#!/bin/bash
set -e
npm install
# Pre-create tables/constraints that drizzle-kit would otherwise prompt about interactively.
# drizzle-kit --force does NOT suppress unique-constraint truncation prompts; pre-applying them
# makes drizzle-kit a no-op for those constraints.
psql "$DATABASE_URL" -c "CREATE TABLE IF NOT EXISTS canonical_vendors (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, website text, newsroom_url text, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now())" 2>/dev/null || true
psql "$DATABASE_URL" -c "ALTER TABLE datasheet_vendors ADD COLUMN IF NOT EXISTS slug text" 2>/dev/null || true
psql "$DATABASE_URL" -c "CREATE UNIQUE INDEX IF NOT EXISTS datasheet_vendors_slug_unique ON datasheet_vendors (slug)" 2>/dev/null || true
npx drizzle-kit push --force
