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
