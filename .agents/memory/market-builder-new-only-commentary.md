---
name: Market Builder "new vendors only" commentary scoping
description: Why commentary stages need explicit new-vendor scoping while scoring stages don't.
---

# "Update new vendors only" must scope commentary by vendor presence, not completeness

Market Builder per-vendor stages come in two flavors with very different reliability for "new vendors only":

- **Scoring stages (2 / 5 / 8)** skip an existing vendor when a *score record exists*. After any full build every existing vendor has complete scores, so checkpoint-resume reliably skips them and new-only "just works" without honoring the `newOnly` flag.
- **Commentary stages (3 / 6 / 9)** previously skipped a vendor only when *every feature already had non-empty comments*. Comment completeness is imperfect (LLM returns empty for some features, partial prior runs), so existing vendors with even one missing comment get fully re-run — making new-only appear to "run all vendors."

**Rule:** commentary stages must scope by **vendor presence in the saved checkpoint**, not by comment completeness. In `runner.ts` cases 6 and 9, when `newOnly`, reuse `scopeNewVendors(stage1, checkpointN, newOnly)` to pass only vendors absent from the checkpoint into the runner, while still passing the full checkpoint so existing vendors are seeded/preserved in `updatedSupport`. Stage 3 already did this (completion-aware filter in the runner). The non-newOnly "Re-run all" path is left unchanged.

**Why:** see prod job for "Object Storage Platforms" — adding one vendor (Huawei) re-ran Dell/NetApp commentary because the checkpoint only had 581 of the expected comments. Scoring for the same job worked perfectly.

**How to apply:** any future per-vendor commentary stage must drive vendor selection in the runner for new-only; never rely on the internal completion-based skip to implement new-only.

## Post-merge is mandatory — scoping alone is not enough (recurrence fix)

Scoping `stage1ForRun6/9` to new vendors is necessary but **not sufficient**. When `stageWasCompleted = true`, `resumeCheckpoint6/9` is set to `undefined` (to prevent re-using the checkpoint on a deliberate re-run). The commentary runner therefore starts fresh, produces a result containing **only** the new vendor's rows, and `markComplete(result)` saves that — wiping all existing vendor commentary.

**Rule:** For stages 6 and 9 in `newOnly` mode:
1. Before running, compute `existingSupport6/9` = all support rows from `checkpoint6/9` whose `vendorName` is NOT in `scope6/9.vendors`.
2. Pass the merge into `onVendorComplete` so intermediate checkpoints are also correct (crash-safe).
3. After the runner returns, merge: `result = { ...result, support: [...existingSupport6/9, ...(result.support ?? [])] }` before `markComplete`.

**Why:** Scope narrows the vendor list fed to the runner; the post-merge reunites new output with preserved existing rows before saving. Without step 3, `markComplete` stores a truncated result every time.

**How to apply:** Every time this fix is revisited, check that both the `onVendorComplete` closure AND the post-runner merge are present for stages 6 and 9 when `newOnly`. Stage 3 uses `seedScores` inside the runner instead; its approach is different and does not need the post-merge pattern.

## UI: the "Update new vendors only" buttons must show in the ready phase too

The wizard's dual run buttons ("Update new vendors only" / "Re-run all vendors") originally rendered only when `currentPhase === "done"`. When refreshing a **published** market, an admin can land on a per-vendor stage in the `ready` phase (e.g. Stage 9 after approving Stage 8), and the done-only gate hid the incremental option, leaving just a single "Run Stage X".

**Rule:** the new-vendors-only choice must be available whenever the market already has existing data, regardless of phase. Gate it on `offerNewVendorsOnly = isPerVendorStage([2,3,5,6,8,9]) && (activeJob.status === "published" || currentResult has scores/support)` and render the dual buttons in the ready-state action row, not only in the done state.

**Why:** `handleResume` sends admin published jobs to the publish panel (stage 10); navigating back into stages sets the next stage to `ready`, so per-vendor stages on a published refresh are frequently `ready`, not `done`.
