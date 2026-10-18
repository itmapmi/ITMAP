# Google indexing health (admin only)

Open **Admin → Google Indexing**. The inventory comes from the exact same
canonical URL entries as `server/publicSitemap.ts`, including only public,
visible market and datasheet landing pages and public static pages. It does not
include report documents, datasheet files, private/hidden markets, account
details or admin pages. URLs cannot be supplied to the inspection endpoint.

## Connect Google Search Console

No supported Search Console connector was returned by the Replit integration
catalog during implementation. This feature therefore supports an explicit,
dedicated Google service account; it does not reuse Google login OAuth, change
login scopes, or assume the app's storage identity has Search Console access.

1. In a Google Cloud project you control, enable **Google Search Console API**.
2. Create a dedicated service account. Grant its email access to the verified
   ITMAP property in Search Console (use Full user permission for URL Inspection).
   Verify the canonical site's property first if you have not already done so.
3. Store the service account's JSON key securely as the server secret
   `GOOGLE_SEARCH_CONSOLE_CREDENTIALS`. Never paste keys into chat, commit them,
   upload them to the admin UI, or use the existing Google login client secret.
4. Set the non-secret `GOOGLE_SEARCH_CONSOLE_PROPERTY` to your verified property:
   `sc-domain:itmap.ai` (default) or `https://itmap.ai/` (trailing slash required).
   Other properties are refused. Configure credentials separately in each
   environment that needs inspections. Restart the app after configuration.
5. Click **Inspect next batch**. “Credentials configured” means only that
   configuration exists. A successful inspection establishes that access works.
   401 means credentials need attention; 403 can mean permissions, API enablement
   or quota. No tokens or provider error objects are returned to the browser.

The server requests only `webmasters.readonly`, calls only Google's indexed-version
URL Inspection endpoint, and stores selected status fields, not raw responses
or credentials. Rotate/revoke service-account keys using your normal security
process. No new public endpoints or authentication flows are added.

## What the statuses mean

- **Not inspected:** no evidence has been collected; this does not mean unindexed.
- **Indexed:** Google returned PASS and did not select a different canonical URL.
- **Discovered / crawled, not indexed:** Google's coverage message explicitly
  reports that state. Review discovery/internal links for discovered URLs and
  content quality, duplication and crawl details for crawled URLs.
- **Alternate canonical:** Google selected a different URL or reported a
  duplicate/canonical exclusion. Compare Google's canonical to your intended
  canonical before changing anything.
- **Not indexed:** other explicit excluded/failing statuses. Check Google's
  coverage, robots, indexing and fetch details.
- **Unknown:** Google did not provide a conclusive verdict. Review in Search Console.
- **Inspection error:** an API/configuration/timeout/response error, not evidence
  that a page is unindexed. Previous successful fields and their timestamp remain
  available, clearly separate from the latest failed attempt.

## Cache and quotas

Loading the view reads only cached data and the current public URL inventory.
An explicit admin refresh inspects up to 10 oldest eligible URLs, prioritizing
never-inspected URLs. Successful results are fresh for 24 hours; errors are
eligible after one hour. Last attempt, last successful inspection, and Google's
last crawl time are distinct. Hidden/removed URLs are not returned and visibility
is checked again before every Google request.

PostgreSQL persists cache, a cross-process batch lease, cooldown and conservative
call reservations. Domain/prefix configuration changes share one local budget.
The app caps reservations at 500 per rolling 24 hours, with a 60-second cooldown
after each batch, below Google's documented 2,000/day and 600/minute per-site
limits. Reservations count even if a batch fails or stops early. Leases expire
after 10 minutes on crashes; results already saved remain available. Provider
retries are disabled. 403/429 halt the batch and pause refreshes for 24 hours.
Other tools or environments with separate databases can consume the same Google
quota: the displayed count is this app database's budget, not Google's remaining
quota. Use Google Cloud quota monitoring for total usage.

The three additive tables are created by the existing startup migration and
represented in the shared Drizzle schema; no manual edits to existing data are
needed. Database setup failures are reported explicitly instead of using fake
empty or in-memory results.

## Limits of this view

This is Google's **indexed-version** inspection, not a live fetch. A successful
HTTP fetch, JavaScript rendering check or sitemap submission is not proof of
indexing. Results can lag Google's current state. Index inclusion does not
guarantee ranking or traffic. Manual inspection and any eligible indexing
requests belong in [Search Console](https://search.google.com/search-console/).
This app does not submit sitemaps, request immediate indexing, or call Google's
Indexing API; ordinary market pages are not its supported content type.

API references:
- https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
- https://developers.google.com/webmaster-tools/limits
