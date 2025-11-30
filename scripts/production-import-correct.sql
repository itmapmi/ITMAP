-- ============================================
-- PRODUCTION IMPORT SCRIPT
-- Market: ITMAP for Public Cloud Object Storage providers
-- ============================================
-- 
-- INSTRUCTIONS:
-- 1. Get your production market ID:
--    SELECT id FROM markets WHERE name LIKE '%Public%Cloud%Object%Storage%';
-- 
-- 2. Replace ALL {MARKET_ID} with your actual market ID
-- 
-- 3. Run sections in order:
--    Section 1: Create Feature Categories
--    Section 2: Create Features  
--    Section 3: Use TypeScript script for vendor support data
-- ============================================

-- ============================================
-- SECTION 1: Create Feature Categories (9 categories)
-- ============================================

INSERT INTO feature_categories (id, name, description, market_id, display_order)
VALUES 
  (gen_random_uuid(), 'Data Durability and Availability', 'Features related to data durability and availability', '{MARKET_ID}', 1),
  (gen_random_uuid(), 'Performance and Scalability', 'Features related to performance and scalability', '{MARKET_ID}', 2),
  (gen_random_uuid(), 'Compliance and Governance', 'Features related to compliance and governance', '{MARKET_ID}', 3),
  (gen_random_uuid(), 'Security and Access Control', 'Features related to security and access control', '{MARKET_ID}', 4),
  (gen_random_uuid(), 'Storage Management Features', 'Features related to storage management', '{MARKET_ID}', 5),
  (gen_random_uuid(), 'Consistency & Semantics', 'Features related to consistency and semantics', '{MARKET_ID}', 6),
  (gen_random_uuid(), 'Monitoring and Observability', 'Features related to monitoring and observability', '{MARKET_ID}', 7),
  (gen_random_uuid(), 'Migration & Mobility', 'Features related to migration and mobility', '{MARKET_ID}', 8),
  (gen_random_uuid(), 'Data Protection', 'Features related to data protection', '{MARKET_ID}', 9);

-- Verify: SELECT id, name FROM feature_categories WHERE market_id = '{MARKET_ID}' ORDER BY display_order;

-- ============================================
-- SECTION 2: Create Features (98 features)
-- ============================================

-- Data Durability and Availability (9 features)
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), unnest(ARRAY[
  'High Data Durability',
  'Multi-AZ Resilience',
  'Availability SLA',
  'Multi-AZ data placement',
  'Erasure coding scheme',
  'Background scrubbing',
  'Geo-resilient (multi-region) class',
  'Single-AZ "low-latency" class',
  'Regional isolation controls'
]), NULL, fc.id, generate_series(1, 9)
FROM feature_categories fc 
WHERE fc.name = 'Data Durability and Availability' AND fc.market_id = '{MARKET_ID}';

-- Performance and Scalability (18 features)
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), unnest(ARRAY[
  'Scalability',
  'Low-Latency Access',
  'High Throughput',
  'Concurrency',
  'Consistency',
  'Single-object throughput ceiling',
  'Aggregate bucket/account throughput',
  'Request-rate scaling (no prefix sharding)',
  'P50/P95/P99 latency visibility',
  'Small-object optimization',
  'Ultra-low-latency object class',
  'Multipart upload efficiency',
  'GPU-adjacent high-IO paths',
  'Edge/accelerated ingest',
  'Object compute on-read',
  'Parallel connection limits',
  'Range GET performance',
  'Throughput near GPUs/HPC'
]), NULL, fc.id, generate_series(1, 18)
FROM feature_categories fc 
WHERE fc.name = 'Performance and Scalability' AND fc.market_id = '{MARKET_ID}';

-- Compliance and Governance (11 features)
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), unnest(ARRAY[
  'Certifications & Compliance',
  'Audit Logging',
  'Data residency guarantees',
  'Sovereign cloud options',
  'Object Lock – Governance mode',
  'Object Lock – Compliance mode',
  'Legal holds',
  'Min/max retention controls',
  'Immutable audit logs',
  'eDiscovery export',
  'PII scanning/classification hooks'
]), NULL, fc.id, generate_series(1, 11)
FROM feature_categories fc 
WHERE fc.name = 'Compliance and Governance' AND fc.market_id = '{MARKET_ID}';

-- Security and Access Control (13 features)
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), unnest(ARRAY[
  'Encryption at Rest',
  'Encryption in Transit',
  'Identity & Access Management',
  'Bucket/Object Policies',
  'Network Isolation',
  'External Key Management',
  'TLS version/cipher policy',
  'mTLS/private link options',
  'Public access block controls',
  'Bucket policies (condition keys)',
  'Confidential computing endpoints',
  'Post-quantum TLS options',
  'Malware/WAF on PUT'
]), NULL, fc.id, generate_series(1, 13)
FROM feature_categories fc 
WHERE fc.name = 'Security and Access Control' AND fc.market_id = '{MARKET_ID}';

-- Storage Management Features (14 features)
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), unnest(ARRAY[
  'Storage Tiering',
  'Lifecycle Management',
  'Large Object Support',
  'Multipart Upload',
  'Object Metadata & Tagging',
  'Hierarchical Namespace (HNS)',
  'Lifecycle filters (tag/prefix/size/age)',
  'Expiration & delete markers',
  'Abort incomplete MPU',
  'Object tags (high cardinality)',
  'Custom metadata limits',
  'Batch operations',
  'Fine-grained replica placement',
  'Data clean-room integrations'
]), NULL, fc.id, generate_series(1, 14)
FROM feature_categories fc 
WHERE fc.name = 'Storage Management Features' AND fc.market_id = '{MARKET_ID}';

-- Consistency & Semantics (6 features)
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), unnest(ARRAY[
  'Strong read-after-write (new objects)',
  'Overwrite/delete consistency',
  'LIST consistency',
  'Conditional requests (ETag/If-Match)',
  'Atomic directory operations (HNS)',
  'Idempotent PUT semantics'
]), NULL, fc.id, generate_series(1, 6)
FROM feature_categories fc 
WHERE fc.name = 'Consistency & Semantics' AND fc.market_id = '{MARKET_ID}';

-- Monitoring and Observability (10 features)
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), unnest(ARRAY[
  'Usage Metrics',
  'Audit & Access Logs',
  'Alerts and Monitoring Integration',
  'Storage usage/time-series',
  'Management Console & APIs',
  'IaC support (Terraform/Cloud SDKs)',
  'Quotas/limits visibility',
  'Event replay & DLQs',
  'Sustainability metrics',
  'Lifecycle "what-if" simulator'
]), NULL, fc.id, generate_series(1, 10)
FROM feature_categories fc 
WHERE fc.name = 'Monitoring and Observability' AND fc.market_id = '{MARKET_ID}';

-- Migration & Mobility (7 features)
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), unnest(ARRAY[
  'Online transfer accelerators',
  'Offline transfer appliances',
  'Checksum preservation',
  'Multi-cloud sync/replication',
  'Namespace virtualization',
  'Native import from other clouds',
  'Policy-aware migration tools'
]), NULL, fc.id, generate_series(1, 7)
FROM feature_categories fc 
WHERE fc.name = 'Migration & Mobility' AND fc.market_id = '{MARKET_ID}';

-- Data Protection (10 features)
INSERT INTO features (id, name, description, category_id, display_order)
SELECT gen_random_uuid(), unnest(ARRAY[
  'Versioning',
  'Same-region replication (SRR)',
  'Cross-region replication (CRR)',
  'Replication RPO/SLA (RTC)',
  'Replication of deletes/ACLs/tags',
  'Backfill replication',
  'Multi-destination replication',
  'Cross-account replication',
  'MFA-Delete (where available)',
  'Archive restore SLA'
]), NULL, fc.id, generate_series(1, 10)
FROM feature_categories fc 
WHERE fc.name = 'Data Protection' AND fc.market_id = '{MARKET_ID}';

-- Verify: SELECT fc.name, COUNT(f.id) FROM feature_categories fc 
--         LEFT JOIN features f ON f.category_id = fc.id 
--         WHERE fc.market_id = '{MARKET_ID}' 
--         GROUP BY fc.name, fc.display_order ORDER BY fc.display_order;

-- ============================================
-- SECTION 3: Vendor Feature Support (1,176 records)
-- ============================================
-- 
-- For the vendor support data (scores + comments), use the TypeScript script:
-- 
-- File: scripts/import-vendor-support.ts
-- 
-- 1. Update MARKET_ID in the script to your production market ID
-- 2. Set DATABASE_URL to your production database
-- 3. Run: npx tsx scripts/import-vendor-support.ts
-- 
-- This imports all 1,176 records (12 vendors × 98 features) with:
-- - Harvey Ball scores (0-4 scale)
-- - Detailed comments for each feature
-- ============================================
