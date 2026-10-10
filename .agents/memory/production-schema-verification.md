---
name: Production schema verification
description: A successful publish status does not establish that pending database schema changes were applied.
---

Verify production schema independently before declaring a schema-dependent rollout successful.

**Why:** Publishing reported success while production runtime queries still failed on a newly added column. Both the read-only production schema inspection and publishing's pending diff confirmed that the additions remained unapplied.

**How to apply:** Check the relevant production columns/tables with read-only queries and inspect the pending publish diff. If changes remain pending, use the supported publishing schema-update flow; do not invent startup DDL or production migration scripts. Do not infer why synchronization was skipped from the successful build status alone.
