---
name: Market Builder republish gate
description: Why an already-published market job can be re-published, and the status/gate invariant that must stay in sync.
---
# Market Builder publish gate vs. complete status

A Market Builder job that has already been published has status `"published"` (not `"completed"`) and carries a `marketId`.

**Rule:** the publish gate in `publishJob()` must accept BOTH `"completed"` and `"published"`. The `/complete` route intentionally does NOT downgrade a published job back to `"completed"` (`nextStatus = job.status === "published" ? "published" : "completed"`). If the publish gate only accepts `"completed"`, a published job can never be re-published → permanent 400 "Job must be completed before publishing".

**Why:** this caused a real deadlock for admin-built markets. The original gate split on `jobIsEndUser`: end-user jobs accepted `completed|published`, but admin jobs accepted only `completed`. Admins (and the admin UI) hit the end-user route `/api/market-builder/jobs/:id/publish`, `jobIsEndUser` returned false for admin creators, so re-publishing to add vendors always 400'd even though `/complete` returned 200. Fix: single gate accepting `completed|published` for everyone.

**How to apply:** re-publish is a real, supported flow (refresh phases / add vendors). `publishJobInner` reuses the existing `marketId` in place, so re-publishing refreshes rather than duplicating. Don't reintroduce a "strict single-publish for admins" branch. Visibility/ownership is decided inside `publishJobInner` via the creator's role, independent of the gate.
