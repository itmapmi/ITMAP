---
name: Quadrant chart label clamping
description: Why vendor labels vanish when the magic-quadrant chart is resized, and the rule that keeps them visible.
---

Vendor labels in the Vendor Evaluation quadrant chart are positioned by absolute
pixel x/y — either a saved custom position (admin drag, stored in DB via the
label-positions endpoint) or a small fixed default offset from the dot. Dots are
plotted through a d3 scale so they always stay in bounds, but labels are not.

**Rule:** Any time the chart's width/height (or margins) change, labels whose
absolute coordinates fall outside the SVG drawable box get clipped off-screen —
the dot stays but its label silently "disappears". Always clamp each label's x/y
into [margin.left, width-margin.right] x [margin.top, height-margin.bottom]
before rendering. The clamp must be a no-op for in-bounds labels so existing
placements and drag/save don't shift.

**Why:** Saved label positions are absolute pixels tied to whatever chart size
was active when they were saved. Shrinking the chart (e.g. 860x640 → 600x600)
pushed bottom-right clustered labels (Object Storage market: MinIO, Cloudian,
Scality) past the right/bottom edge of the smaller viewBox.

**How to apply:** Clamp at render time right after the raw x/y is computed,
before appending the text. Don't mutate the saved DB value — only the rendered
position. If you ever switch saved positions to normalized (0–1) coordinates,
this whole class of bug goes away.

**Superseded (Sep 2026):** an earlier version of this note also covered a
mobile-only de-overlap pass and a distance "tether" that discarded a dragged
position too far from its dot. Both were part of a collision-avoidance layout
that has since been removed at the user's request — see
`quadrant-label-layout.md`. Canvas-bounds clamping (this file) is the only
positioning constraint that remains.

**Absolute-positioning corollary (Sep 2026):** dots moved from roster-relative
(min/max stretched) to absolute composites, so every label position saved
before the cutover points at empty space. Saved rows older than the cutover
date are ignored (falls back to the fixed default offset) until an admin
re-drags them. If dots ever change coordinate system again, bump the cutover
date rather than deleting rows.
