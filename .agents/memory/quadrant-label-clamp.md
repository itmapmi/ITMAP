---
name: Quadrant chart label clamping
description: Why vendor labels vanish when the magic-quadrant chart is resized, and the rule that keeps them visible.
---

Vendor labels in the Vendor Evaluation quadrant chart are positioned by absolute
pixel x/y — either a saved custom position (admin drag, stored in DB via the
label-positions endpoint) or the collision-detection fallback. Dots are plotted
through a d3 scale so they always stay in bounds, but labels are not.

**Rule:** Any time the chart's width/height (or margins) change, labels whose
absolute coordinates fall outside the SVG drawable box get clipped off-screen —
the dot stays but its label silently "disappears". Always clamp each label's x/y
into [margin.left, width-margin.right] x [margin.top, height-margin.bottom],
accounting for text anchor (start/end/middle) and approximate text width
(name.length*7.5). The clamp must be a no-op for in-bounds labels so existing
placements and drag/save don't shift.

**Why:** Saved label positions are absolute pixels tied to whatever chart size
was active when they were saved. Shrinking the chart (e.g. 860x640 → 600x600)
pushed bottom-right clustered labels (Object Storage market: MinIO, Cloudian,
Scality) past the right/bottom edge of the smaller viewBox.

**How to apply:** Clamp at render time right after labelPos is computed, before
appending the text. Don't mutate the saved DB value — only the rendered position.
If you ever switch saved positions to normalized (0–1) coordinates, this whole
class of bug goes away.

**Mobile-specific corollary:** the same absolute-pixel saved positions clamped
into the much narrower mobile canvas don't just clip — several different
vendors' labels (saved AND collision-auto-placed) can clamp into the same small
area and stack into unreadable overlapping text. Clamping alone doesn't fix
this; you also need a final de-overlap pass. Fix: after computing every
vendor's clamped label rect, do a mobile-only greedy pass (in vendor order)
that hides a label if its rect collides with another vendor's dot or with an
already-accepted label's rect — leave the dot visible/tappable so the name is
still reachable (e.g. via a tap-to-reveal evidence popover). Desktop renders
every candidate unconditionally, exactly as before, since its canvas is the
size positions were actually saved/computed for.
