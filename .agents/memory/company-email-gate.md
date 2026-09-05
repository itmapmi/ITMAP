---
name: Company-email profile gate
description: Design decisions behind the Reports/News/Intelligence Feed lock for consumer-domain sign-ups and the traps that bit during review.
---
Rule: the gate is a second check *inside* `requireFeature`, after the RBAC grant passes, driven by one shared predicate used by server and client. Verification is a single conditional UPDATE bound to token + address, backed by a partial unique index on verified company emails.

**Why:** every gated route already passes through `requireFeature`, so the anonymous teaser exceptions (which sit before it) stay untouched. A read-then-update verify let a stale link verify a *changed* address and two accounts claim one email concurrently — the DB constraint, not application checks, is what makes "verified on one account" hold.

**How to apply:**
- Login email is immutable from self-service; letting users edit it silently defeats the gate (swap Gmail → business domain).
- Any route echoing a user row must go through the shared public-user serializer — token columns leak the moment a handler strips only `password`.
- Client lock detection is by the error string `company_email_required`; components with their own `fetch` must surface the body's `error` in the thrown message.
- The vendor mini-news popover endpoint is deliberately ungated (anonymous-readable evidence popover), not an oversight.
