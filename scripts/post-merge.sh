#!/bin/bash
set -e
npm install
# Pre-create tables that drizzle-kit would otherwise prompt about interactively
psql "$DATABASE_URL" -c "CREATE TABLE IF NOT EXISTS canonical_vendors (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, website text, newsroom_url text, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now())" 2>/dev/null || true
npx drizzle-kit push --force
