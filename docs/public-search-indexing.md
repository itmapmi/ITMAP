# Public search indexing

Public pages return meaningful HTML before JavaScript: public marketing copy,
the market catalog, full stored public market definitions and the actual
vendor/product roster. Public datasheet pages contain discovery introductions,
not protected specifications or documents. Existing legal pages retain their
server-rendered policies.

The same HTML is sent to people and crawlers; there is no user-agent-specific
rendering or hidden SEO block. The existing React app replaces the initial
content on mount. Its design, anonymous registration timer, Google/LinkedIn
campaign handling, profile gates and backend authorization are unchanged.

Private/hidden markets, account/admin pages, reports, comparison shares and
system/auth routes are not added to public discovery HTML or the sitemap.
Private workspaces still mount the existing application for authorized users;
their public shell has noindex and contains no private titles or data.
Nonexistent pages return 404. Temporary rendering/data failures return 503 and
Retry-After instead of an empty successful page or an incomplete sitemap.

## Production rollout

No database migration or new environment variables are required. Publish the
code changes, then:

Development-preview proxies may add restrictive indexing headers. Check final
indexability on the published custom domain, not the workspace preview URL.

1. Fetch `/`, `/markets` and one `/markets/<slug>` without JavaScript. Confirm
   that headings, definitions and market/vendor names appear in the HTML.
2. Confirm `/sitemap.xml` lists only visible, public canonical URLs, including
   marketing pages and public datasheet introductions. Mobile aliases and
   campaign parameters consolidate onto clean canonical URLs.
3. In the verified **https://itmap.ai** Search Console property, submit
   **https://itmap.ai/sitemap.xml**.
4. Inspect the homepage, listing and representative market URLs. Check the
   indexed version and run **Test live URL → View tested page**. Confirm both
   the HTML and rendered screenshot show useful content. A successful live
   test is not proof the URL is already indexed.
5. Request indexing for key public pages, then monitor Page indexing reports
   for excluded URLs, alternate canonicals and crawl errors. Google decides
   when/if to index and rank each page; neither publishing nor submitting a
   sitemap guarantees immediate inclusion.

Reports, intelligence and other protected content are not made public merely
to achieve indexing. Search visibility must not bypass authentication.
