---
name: Feature-derived criteria persistence rules
description: Invariants for the persisted Product Capabilities / ISV Ecosystem scores that are not obvious from the code (why they exist, what breaks if violated).
---
# Feature-derived criteria persistence rules

**Rule 1 — a notes-only save must not erase provenance.**
Re-posting an unchanged derived score keeps its coverage audit columns; only a real score change without
coverage clears them (a stale coverage must never sit beside a score it did not produce).
**Why:** the first version nulled the columns on every non-derived write, so saving a note silently erased
the coverage caption in the evaluation tabs.

**Rule 2 — the ecosystem partition is "flag true OR legacy name", never "flag wins".**
Older markets have categories literally named "ISV Ecosystem" / "Ecosystem Support" with is_ecosystem=false
(column is NOT NULL DEFAULT false). Letting an explicit false override the name match would move those
features into Product Capabilities and change the visible Total/Maximum rows. The tabs and the shared
derivation must always use the identical rule; changing it means re-running the backfill.

**Rule 3 — derived scores are never set by hand; refuse, don't silently revert.**
Every generic score writer refuses a *changed* value on the two derived criteria (notes-only saves pass).
A manual override would only survive until the next refresh, so an explicit 400 beats a silent revert.
User decision: lower-than-expected leader scores are acceptable; do not "fix" the distribution by hand.

**Rule 4 — an empty partition means "unscored", so the refresh deletes that criterion's rows.**
Market Builder Stage 2 emits score-0 placeholders for these criteria; publish must not persist them.
**Why:** the chart already treats a missing row as 0, so deleting changes nothing positionally but stops
comparison/exports from showing a frozen or fake value once the last feature in a partition is removed.
