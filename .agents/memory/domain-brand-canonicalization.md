---
name: Domain/brand canonicalization for spectio.ai → dcig.ai
description: How the app's primary public domain and brand name is wired, in case the canonical domain changes again
---

The primary public domain/brand is not centralized in one config value — it's duplicated across:
`client/index.html` (title/meta/canonical/OG/Twitter/JSON-LD), `public/robots.txt`, `public/sitemap.xml`, `public/llms.txt`, `server/index.ts` (`PRIMARY_DOMAIN` redirect default), plus assorted server-side email/PDF/export/User-Agent strings (emailService, datasheets, forecast pptx, rfpDiagram export, signal collectors, admin/leadGen copy).

**Why:** No single source of truth exists for "the brand domain," so a domain rename requires a project-wide grep-and-replace, not a config edit.

**How to apply:** When the canonical domain changes again, grep the whole repo (excluding `dist/` build output and `.local/tasks/` history) for the old domain string and replace it everywhere, then update `PRIMARY_DOMAIN`'s default in `server/index.ts`. Verify via `curl localhost:5000/` for title/canonical/OG tags and `/robots.txt` + `/sitemap.xml`.
