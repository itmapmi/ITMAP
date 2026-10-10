---
name: Production schema verification
description: A successful publish status does not establish that pending database schema changes were applied.
---

Verify production schema independently before declaring a schema-dependent rollout successful.

The user states that production schema updates do not happen automatically when they republish this project. Do not repeat republishing alone as a sufficient fix.

**Why:** The user repeated this correction. Publishing also reported success while production runtime queries still failed on a newly added column; read-only schema inspection confirmed that the additions remained unapplied.

**How to apply:** Check the relevant production columns/tables with read-only queries and inspect the pending publish diff. Distinguish the platform-generated SQL from custom migration scripts. Never execute production DDL or invent startup DDL or production migration scripts. Do not infer why synchronization was skipped from the successful build status alone.
