---
name: Dev DB row recovery path
description: Environment quirk — backups are unreadable from the workspace; the prod read replica is the only way to restore a clobbered dev row.
---
# Dev DB row recovery path

**Rule:** before exercising a write endpoint against a real dev row, save the whole row first (or use a
scratch row). The private backup bucket returns 403 to the workspace service account, so pg_dump backups
are not a fallback.
**Recovery that works:** dev is a copy of production with identical primary keys — read the original from
the production read replica and UPDATE dev with a parameterized query guarded by the clobbered value.
Only copy the column you destroyed; derived numeric columns may legitimately differ between the two.
