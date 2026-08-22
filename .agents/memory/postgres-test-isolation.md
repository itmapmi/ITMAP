---
name: PostgreSQL test isolation
description: Safe approach for database-backed integration tests when the workspace database is shared with the application.
---

Database-backed integration tests must create a uniquely named temporary PostgreSQL schema, use a pool whose `search_path` is restricted to it, and drop that schema in teardown. Authentication tests should use an in-memory session store rather than the application session table.

**Why:** The workspace `DATABASE_URL` is also used by the running application. Test fixtures in the public schema can pollute real analytics data or be affected by it, even with careful row cleanup.

**How to apply:** Clone only the required public table definitions into the temporary schema, inject the scoped pool before importing storage/routes under test, assert the active schema, and ensure teardown closes the pool after dropping the schema.