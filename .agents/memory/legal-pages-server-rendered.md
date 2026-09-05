---
name: Legal pages must be server-rendered
description: Why the Privacy Policy / Terms pages are served as static HTML on a plain load, and the esbuild JSX gotcha that comes with it.
---

**Rule:** Public legal pages (and anything a third-party verifier or non-JS crawler must read) must return their full text in the raw HTML response — never only via the client-rendered SPA.

**Why:** Google's OAuth brand verification fetched the privacy-policy URL, got the empty SPA shell, and rejected the app with "does not have sufficient content" (September 2026).

**How to apply:**
- Keep the legal bodies in the shared, hook-free React modules that both the client page and the server route render, so the two can't drift.
- The server bundle uses esbuild's *classic* JSX runtime: any `.tsx` the server imports needs an explicit `import React` or production crashes with `React is not defined` while dev (tsx) works fine.
- The Terms URL with `?returnTo=` intentionally falls through to the SPA — the Agree/Disagree buttons need the router.
- After republishing, verify by fetching the production URL without cookies and checking the word count of the HTML.
