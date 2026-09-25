---
name: Duplicate support-level scoring logic across components
description: Multiple UI components had their own local copy of the Harvey-ball support-level → score mapping instead of importing the shared one, causing displayed totals to silently drift out of sync.
---

`shared/derived-feature-scores.ts` exports `SUPPORT_LEVEL_CONTRIBUTION` /
`supportLevelContribution()` as the authoritative mapping from a vendor
feature's support level (0-4) to its scoring contribution (currently
0, 0.25, 0.5, 0.75, 1). It backs the persisted Product Capabilities and
ISV Ecosystem criterion scores.

Before this fix, at least two other components had pasted-in local copies of
the same switch statement for their own on-the-fly "Total Score" displays:
`client/src/components/support-matrix.tsx` (`getSupportScore`, used by
`calculateCategoryTotals`/`calculateOverallTotals`) and
`client/src/components/admin/support-matrix-admin.tsx`
(`getVendorCategoryScore`'s inline switch). When the shared module's Limited
(level 1) contribution was changed from 0 to 0.25, only the shared module was
updated — both local copies kept using the old value, so per-category totals
on those screens silently disagreed with the persisted/authoritative score
shown elsewhere in the same app.

**Why:** copy-pasted business logic (especially small numeric lookup tables)
has no compiler or test signal when the source of truth changes elsewhere;
it only surfaces when a user notices two numbers that should match don't.

**How to apply:** when asked to change a scoring/weighting constant, grep the
whole repo for the old literal values or the concept name (e.g. "Limited
support", "getSupportScore") before declaring the change done — don't assume
one shared module has only one call site. Prefer refactoring local copies to
import the shared function rather than re-deriving the same rule.
