---
name: Absolute quadrant positioning decisions
description: Non-obvious rules behind the Vendor Evaluation dot engine (shared/quadrant-positioning.ts), thresholds, versioning and exports.
---

**Rule:** a dot depends only on the vendor's own scores + the market's published
weights + the market's three thresholds. Never reintroduce roster-relative
scaling (min/max stretch, rank, percentile) anywhere — chart, cron snapshots,
exports and the AI-chat context must all call the shared engine.

**Why:** the user wanted reproducible positions ("adding a vendor must not move
the others") and exports that let a reader rebuild every dot from the file.

**How to apply:**
- Thresholds are rubric units (0–10) mapped piecewise-linearly onto fixed
  canvas dividers 33/67/50; box assignment compares raw composites with the
  same thresholds so box and pixel side can never disagree. Leaders are NOT
  required to score 8–10 (user confirmed lower leaders are fine).
- Unscored criteria are excluded and the axis weights renormalised; they are
  not zeros. Three markets have structurally low ISV Ecosystem scores, so
  changing this would drag them into Custodians wholesale.
- Weight/threshold changes are versioned (immutable rows, note, who/when);
  the UI never shows version timestamps to buyers — it is admin-only history.
- Past cron snapshots were stored with equal-50 fallback weights and cannot be
  recomputed; out-of-scale synthetic history rows are filtered server-side,
  not deleted. The history slider cannot re-weight history.
- Excel keeps full-precision numbers so the round-trip test is exact; PDF text
  prints 2 dp composites / 1 dp canvas coordinates — tests compare at printed
  precision.
- Verify chart rendering with a puppeteer script against the HTTPS dev domain
  (login by POSTing /auth/login from page context); the screenshot tool's
  viewport clips the chart. Mobile parity check: circle.vendor-dot cx/cy on
  /mobile/markets/:id equal the desktop values (same viewBox).
