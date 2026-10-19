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

Normal visitors should not see a flash of the plain discovery page before the
interactive application appears. Preserve a readable no-JavaScript/error
fallback rather than permanently hiding or removing the public content.

**Why:** The user reported the initial text-page flash and explicitly asked to
hide it, while retaining the earlier public-search requirements.

**How to apply:** Treat this as a loading-transition concern, not a reason to
remove initial HTML or serve different content to search crawlers.

Development-preview proxies can inject restrictive X-Robots-Tag headers even
when the application's public-page response has no such header.

**Why:** An HTTPS preview check showed noindex/noarchive/nofollow while the same
running application's direct response had no restrictive header and an
index/follow HTML meta tag. This is a proxy/deployment distinction, not proof
that the production application blocks indexing.

**How to apply:** Validate final search eligibility on the published custom
domain. Do not remove private-page safeguards or try to defeat development
proxy headers to make the preview indexable.

Search Console authorization must stay separate from buyer Google sign-in.
Ordinary market pages must not use Google's Indexing API.

**Why:** The user requires indexing monitoring without changing authentication,
campaign, registration-timer or profile gates. A login OAuth grant is not
Search Console property access, and ordinary market pages are not a supported
Indexing API content type.

**How to apply:** Keep inspection credentials and read-only API calls server-side
under existing admin authorization. Obtain a dedicated property-access grant;
do not expand buyer login scopes. Treat missing access, inspection errors and
never-inspected URLs as distinct from Google's not-indexed verdicts.
