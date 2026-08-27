---
name: Magic Quadrant weight semantics
description: The agreed interpretation of Criteria Weights for live chart positioning and graphic export.
---

Treat a market's Criteria Weights as direct relative contributions within their own chart axis. Normalize each criterion's non-negative configured percentage by the total for that axis; a missing value defaults to 100%, while an explicit 0% contributes nothing.

**Why:** The Criteria Weights panel must truthfully explain dot placement. Bucketed multipliers made different saved percentages collapse into arbitrary bands and caused exported graphics to disagree with the panel.

**How to apply:** Use the same axis-normalized shares for every current/live Magic Quadrant render and its client-side graphic export. Keep saved historical positions independent; they represent past snapshots, not a recomputation under the current configuration.