-- ============================================
-- PRODUCTION IMPORT SCRIPT
-- Market: ITMAP for Public Cloud Object Storage providers
-- ============================================
-- 
-- INSTRUCTIONS:
-- 1. First, get your market ID by running:
--    SELECT id FROM markets WHERE name LIKE '%Public%Cloud%Object%Storage%';
-- 
-- 2. Replace ALL occurrences of {MARKET_ID} with your actual market ID
-- 
-- 3. Run this script in sections:
--    - First: Create Feature Categories
--    - Second: Create Features
--    - Third: Run the import script (see note below)
-- 
-- NOTE: For vendor feature support data, use the TypeScript import script
-- as it handles the complex Excel parsing and 1,176 records automatically.
-- ============================================

-- Step 1: Create Feature Categories
-- Run this first, then get the category IDs for Step 2

INSERT INTO feature_categories (id, name, description, market_id, display_order)
VALUES 
  (gen_random_uuid(), 'Data Durability & Resilience', 'Product evaluation category for Data Durability & Resilience', '{MARKET_ID}', 1),
  (gen_random_uuid(), 'Performance & Scalability', 'Product evaluation category for Performance & Scalability', '{MARKET_ID}', 2),
  (gen_random_uuid(), 'Consistency & Data Integrity', 'Product evaluation category for Consistency & Data Integrity', '{MARKET_ID}', 3),
  (gen_random_uuid(), 'Security & Encryption', 'Product evaluation category for Security & Encryption', '{MARKET_ID}', 4),
  (gen_random_uuid(), 'Compliance & Auditing', 'Product evaluation category for Compliance & Auditing', '{MARKET_ID}', 5),
  (gen_random_uuid(), 'Storage Management', 'Product evaluation category for Storage Management', '{MARKET_ID}', 6),
  (gen_random_uuid(), 'Monitoring & Operations', 'Product evaluation category for Monitoring & Operations', '{MARKET_ID}', 7),
  (gen_random_uuid(), 'Additional Capabilities', 'Product evaluation category for Additional Capabilities', '{MARKET_ID}', 8);

-- Verify categories were created:
-- SELECT id, name FROM feature_categories WHERE market_id = '{MARKET_ID}' ORDER BY display_order;

-- Step 2: Create Features
-- These will be inserted into their respective categories

-- Data Durability & Resilience features
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'High Data Durability', NULL, fc.id, 1
FROM feature_categories fc WHERE fc.name = 'Data Durability & Resilience' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Multi-AZ Resilience', NULL, fc.id, 2
FROM feature_categories fc WHERE fc.name = 'Data Durability & Resilience' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Multi-AZ data placement', NULL, fc.id, 3
FROM feature_categories fc WHERE fc.name = 'Data Durability & Resilience' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Erasure coding scheme', NULL, fc.id, 4
FROM feature_categories fc WHERE fc.name = 'Data Durability & Resilience' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Background scrubbing', NULL, fc.id, 5
FROM feature_categories fc WHERE fc.name = 'Data Durability & Resilience' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Geo-resilient (multi-region) class', NULL, fc.id, 6
FROM feature_categories fc WHERE fc.name = 'Data Durability & Resilience' AND fc.market_id = '{MARKET_ID}';

-- Performance & Scalability features
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Availability SLA', NULL, fc.id, 1
FROM feature_categories fc WHERE fc.name = 'Performance & Scalability' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Scalability', NULL, fc.id, 2
FROM feature_categories fc WHERE fc.name = 'Performance & Scalability' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Low-Latency Access', NULL, fc.id, 3
FROM feature_categories fc WHERE fc.name = 'Performance & Scalability' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'High Throughput', NULL, fc.id, 4
FROM feature_categories fc WHERE fc.name = 'Performance & Scalability' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Concurrency', NULL, fc.id, 5
FROM feature_categories fc WHERE fc.name = 'Performance & Scalability' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Single-AZ low-latency class', NULL, fc.id, 6
FROM feature_categories fc WHERE fc.name = 'Performance & Scalability' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Large Object Support', NULL, fc.id, 7
FROM feature_categories fc WHERE fc.name = 'Performance & Scalability' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Multipart Upload', NULL, fc.id, 8
FROM feature_categories fc WHERE fc.name = 'Performance & Scalability' AND fc.market_id = '{MARKET_ID}';

-- Consistency & Data Integrity features
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Consistency', NULL, fc.id, 1
FROM feature_categories fc WHERE fc.name = 'Consistency & Data Integrity' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Strong read-after-write (new objects)', NULL, fc.id, 2
FROM feature_categories fc WHERE fc.name = 'Consistency & Data Integrity' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Overwrite/delete consistency', NULL, fc.id, 3
FROM feature_categories fc WHERE fc.name = 'Consistency & Data Integrity' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'LIST consistency', NULL, fc.id, 4
FROM feature_categories fc WHERE fc.name = 'Consistency & Data Integrity' AND fc.market_id = '{MARKET_ID}';

-- Security & Encryption features
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Encryption at Rest', NULL, fc.id, 1
FROM feature_categories fc WHERE fc.name = 'Security & Encryption' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Encryption in Transit', NULL, fc.id, 2
FROM feature_categories fc WHERE fc.name = 'Security & Encryption' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'External Key Management', NULL, fc.id, 3
FROM feature_categories fc WHERE fc.name = 'Security & Encryption' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Identity & Access Management', NULL, fc.id, 4
FROM feature_categories fc WHERE fc.name = 'Security & Encryption' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Bucket/Object Policies', NULL, fc.id, 5
FROM feature_categories fc WHERE fc.name = 'Security & Encryption' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Network Isolation', NULL, fc.id, 6
FROM feature_categories fc WHERE fc.name = 'Security & Encryption' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Regional isolation controls', NULL, fc.id, 7
FROM feature_categories fc WHERE fc.name = 'Security & Encryption' AND fc.market_id = '{MARKET_ID}';

-- Compliance & Auditing features
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Certifications & Compliance', NULL, fc.id, 1
FROM feature_categories fc WHERE fc.name = 'Compliance & Auditing' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Audit Logging', NULL, fc.id, 2
FROM feature_categories fc WHERE fc.name = 'Compliance & Auditing' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Audit & Access Logs', NULL, fc.id, 3
FROM feature_categories fc WHERE fc.name = 'Compliance & Auditing' AND fc.market_id = '{MARKET_ID}';

-- Storage Management features
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Storage Tiering', NULL, fc.id, 1
FROM feature_categories fc WHERE fc.name = 'Storage Management' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Lifecycle Management', NULL, fc.id, 2
FROM feature_categories fc WHERE fc.name = 'Storage Management' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Object Metadata & Tagging', NULL, fc.id, 3
FROM feature_categories fc WHERE fc.name = 'Storage Management' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Hierarchical Namespace (HNS)', NULL, fc.id, 4
FROM feature_categories fc WHERE fc.name = 'Storage Management' AND fc.market_id = '{MARKET_ID}';

-- Monitoring & Operations features
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Usage Metrics', NULL, fc.id, 1
FROM feature_categories fc WHERE fc.name = 'Monitoring & Operations' AND fc.market_id = '{MARKET_ID}';

INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), 'Alerts and Monitoring Integration', NULL, fc.id, 2
FROM feature_categories fc WHERE fc.name = 'Monitoring & Operations' AND fc.market_id = '{MARKET_ID}';

-- Additional Capabilities features (65 features)
-- These are grouped into the "Additional Capabilities" category
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), unnest(ARRAY[
  'Single-AZ "low-latency" class',
  'Conditional requests (ETag/If-Match)',
  'TLS version/cipher policy',
  'mTLS/private link options',
  'Data residency guarantees',
  'Lifecycle filters (tag/prefix/size/age)',
  'Storage usage/time-series',
  'Online transfer accelerators',
  'Management Console & APIs',
  'Atomic directory operations (HNS)',
  'Public access block controls',
  'Bucket policies (condition keys)',
  'Sovereign cloud options',
  'Object Lock – Governance mode',
  'Expiration & delete markers',
  'IaC support (Terraform/Cloud SDKs)',
  'Offline transfer appliances',
  'Idempotent PUT semantics',
  'Object Lock – Compliance mode',
  'Abort incomplete MPU',
  'Quotas/limits visibility',
  'Checksum preservation',
  'Single-object throughput ceilin',
  'Legal holds',
  'Object tags (high cardinality)',
  'Multi-cloud sync/replication',
  'Aggregate bucket/account throughput',
  'Min/max retention controls',
  'Custom metadata limits',
  'Namespace virtualization',
  'Request-rate scaling (no prefix sharding)',
  'Immutable audit logs',
  'Batch operations',
  'Native import from other clouds',
  'P50/P95/P99 latency visibility',
  'eDiscovery export',
  'Policy-aware migration tools',
  'Small-object optimization',
  'PII scanning/classification hooks',
  'Ultra-low-latency object class',
  'Multipart upload efficiency',
  'Versioning',
  'GPU-adjacent high-IO paths',
  'Edge/accelerated ingest',
  'Same-region replication (SRR)',
  'Object compute on-read',
  'Parallel connection limits',
  'Cross-region replication (CRR)',
  'Fine-grained replica placement',
  'Range GET performance',
  'Replication RPO/SLA (RTC)',
  'Confidential computing endpoints',
  'Throughput near GPUs/HPC',
  'Replication of deletes/ACLs/tags',
  'Post-quantum TLS options',
  'Backfill replication',
  'Data clean-room integrations',
  'Multi-destination replication',
  'Malware/WAF on PUT',
  'Cross-account replication',
  'Event replay & DLQs',
  'MFA-Delete (where available)',
  'Sustainability metrics',
  'Archive restore SLA',
  'Lifecycle "what-if" simulator'
]), NULL, fc.id, generate_series(101, 165)
FROM feature_categories fc WHERE fc.name = 'Additional Capabilities' AND fc.market_id = '{MARKET_ID}';

-- ============================================
-- IMPORTANT: For vendor feature support data
-- ============================================
-- 
-- The vendor feature support records (1,176 records with scores and comments)
-- are too complex to handle via SQL due to:
-- 1. Long comment fields (up to 5,000 characters each)
-- 2. Complex data parsing from Excel
-- 
-- RECOMMENDED: Use the TypeScript import script
-- File: scripts/import-all-features.ts
-- 
-- This script:
-- 1. Parses the Excel file directly
-- 2. Rounds decimal scores to integers (Harvey Ball 0-4 scale)
-- 3. Handles all 98 features × 12 vendors = 1,176 records
-- 4. Includes detailed comments for each support level
-- 
-- To run against production, update the MARKET_ID in the script
-- and point DATABASE_URL to your production database.
-- ============================================
