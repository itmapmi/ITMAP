# Intelligence collector reliability

The Intelligence UI, access gates, AI relevance classification and suggestion
rules are unchanged. No historical evidence is deleted or rewritten.

## Hacker News

- Search by date, not relevance, over the last 30 days.
- Search the quoted vendor name. Market context remains in the relevance
  classifier rather than being mandatory words in every search result.
- Scan at most two pages of 25 results and send at most 20 candidates per vendor
  to the existing classifier. This is bounded discovery, not exhaustive coverage.
- Retain the minimum story-points threshold and canonical HN discussion links.
- Deduplicate by HN item ID, not the common `/item` path or comment title.
- Log scanned/candidate counts and HTTP/network failures distinctly.

## GitHub

- Persist attempted pulls separately from collected evidence. Failed, empty,
  duplicate and irrelevant pulls all advance the retry queue.
- Vendors with recent successes wait five days. Attempts have a one-day retry
  cooldown. Oldest last touch first; untouched vendors precede previously
  attempted vendors. State survives restarts.
- A scheduled run still selects at most 20 vendor rows. Full-roster recovery is
  progressive, not immediate. The current process has a shared 55-request/hour
  cap and honors GitHub rate-limit reset/Retry-After headers.
- Explicit GitHub website URLs take precedence; exact official brand aliases
  cover common naming mismatches. Remaining vendors retain the legacy
  name-derived fallback. Alias coverage is not a verified full vendor directory.
- A 404 permits org-to-user lookup; 403/429/5xx/network errors are failures, not
  "organization not found." Failed commit fetches never become zero-activity
  snapshots.
- Sample up to ten recently pushed public repositories using supported sorting.
  Label aggregate statistics as a sample, and the capped 100-commit count as
  "at least 100."
- Deduplicate snapshots by account and UTC collection date. Same-day repeats
  are suppressed; a prior day or pre-existing undated URL cannot suppress a
  fresh snapshot.

## Schema and release

New additive scheduling table declared in `shared/schema.ts`:
`vendor_signal_collection_attempts`, with `vendor_id` (vendor FK with cascade),
`source_type`, `attempted_at` (timestamptz) and primary key
`(vendor_id, source_type)`. It stores no credentials or personal data.

Development schema has been updated. Production must contain this table before
the revised scheduler runs; do not assume republishing alone applied it.
There is no deploy-build or startup-time migration added by this change.
Production data was inspected read-only, not modified.
If the scheduling table is unavailable, an explicit scheduling failure is logged
and GitHub is skipped for that run; other collectors still run.

After release, confirm production source-count logs and new collected timestamps
in `vendor_signals`. An API candidate count is not proof that evidence was
inserted: the existing relevance classifier and duplicate checks still apply.

## Checks

`npx vitest run server/signals/collectors/collectors.test.ts server/signals/github-refresh.test.ts server/storage/signals.integration.test.ts`

The storage tests use a disposable isolated schema. They never seed or delete
shared application data and never invoke paid classification APIs.
