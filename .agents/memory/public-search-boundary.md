---
name: Public search visibility and access gates
description: Public indexing scope, protected-content boundary and preview-proxy verification caveat.
---

All public pages should be searchable, while existing registration timers,
login requirements and profile gates continue to apply to the interactive app
and protected features. Private reports, personal/account information, admin
screens and private workspaces must not become public to achieve indexing.

**Why:** The user explicitly requested that people can find the pages through
search and then encounter the normal timer/login requests. Indexing eligibility
must not be confused with guaranteed Google inclusion or ranking.

**How to apply:** Serve stored, factual public discovery content to people and
crawlers alike. Keep private data out of initial HTML, metadata, structured data
and sitemaps. Preserve campaign authentication and access policy. Use Search
Console's indexed status and rendered live test to verify actual Google
behavior; a curl response or a live test alone does not prove indexing.

Development-preview proxies can inject restrictive X-Robots-Tag headers even
when the application's public-page response has no such header.

**Why:** An HTTPS preview check showed noindex/noarchive/nofollow while the same
running application's direct response had no restrictive header and an
index/follow HTML meta tag. This is a proxy/deployment distinction, not proof
that the production application blocks indexing.

**How to apply:** Validate final search eligibility on the published custom
domain. Do not remove private-page safeguards or try to defeat development
proxy headers to make the preview indexable.
