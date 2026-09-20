---
name: Absolute quadrant positioning decisions
description: Non-obvious rules behind the Vendor Evaluation dot engine, thresholds, weight versioning and exports.
---

**Rule:** a dot depends only on the vendor's own scores + the market's published
weights + the market's three thresholds. Never reintroduce roster-relative
scaling (min/max stretch, rank, percentile) anywhere — chart, cron snapshots,
exports and the AI-chat context must all call the shared engine.

**Why:** the user wanted reproducible positions ("adding a vendor must not move
the others") and exports that let a reader rebuild every dot from the file.

**How to apply:**
- Thresholds are rubric units (0–10) mapped piecewise-linearly onto fixed
  canvas dividers; box assignment compares raw composites with the same
  thresholds so box and pixel side can never disagree. Leaders are NOT
  required to score 8–10 (user confirmed lower leaders are fine), and the
  thresholds are a per-market admin choice — do not "fix" an empty Leaders
  box by changing the engine.
- Unscored criteria are excluded and the axis weights renormalised; they are
  not zeros. Several markets have structurally low ISV Ecosystem scores, so
  treating gaps as zeros would drag them into Custodians wholesale.
- Weights and thresholds change only through the versioned chart-config
  service (market create/update embed it and commit atomically); the generic
  market payload must not gain the threshold columns back. Version rows are
  immutable and admin-only — buyers never see version timestamps.
- Thresholds are normalised to the stored 2-dp precision *before* comparing,
  persisting and versioning, otherwise an unrounded request writes a version
  whose thresholds differ from the row it describes.
- Past cron snapshots were stored with equal-50 fallback weights and cannot be
  recomputed; out-of-scale synthetic history rows are filtered, not deleted.
  The history slider cannot re-weight history.
- Verify chart rendering with a temporary puppeteer script against the HTTPS
  dev domain (login by POSTing /auth/login from page context); the screenshot
  tool's viewport clips the chart.
