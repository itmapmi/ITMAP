---
name: Quadrant chart label collision-avoidance layout
description: How vendor labels avoid overlapping each other in the magic-quadrant chart, and subtle bug classes to avoid reintroducing.
---

**Rule:** all three canvases (desktop chart, dedicated mobile-app canvas, and
the narrow "responsive web" `compactChart` view) share one spiral-search label
layout — there is no separate hide-on-collision path anymore. Labels are
placed with a spiral search outward from each dot (ring-based candidate
positions at increasing radius); a label pushed past the first ring gets a
thin dashed connector line back to its dot. Manually dragged positions are
always treated as fixed obstacles that other labels must avoid, never the
other way around.

**Why:** with absolute (non-roster-relative) dot positioning, several vendors
can legitimately score within a few pixels of each other, so a fixed
right/left/top/bottom slot per label is not enough — the old algorithm rendered
every candidate unconditionally on desktop and produced literally overlapping
text (e.g. Pure Storage vs NetApp in High-End General Purpose Storage Arrays).
`compactChart` used to fall back to hiding a label outright on collision
instead; it now reuses the exact same spiral+connector code path.

**Bug class — dot-collision check:** when checking whether a candidate label
position "hits" a dot, do NOT test distance from the label's anchor point to
the dot — test distance from the dot to the *nearest point of the label's
rectangle*. A long vendor name's rectangle can extend well past its own anchor
and land on a completely different, nearby dot that's nowhere near the anchor
itself; anchor-to-dot distance alone misses that collision. Use a rect-vs-circle
nearest-point check (clamp the dot's x/y into the rect's bounds, then measure
distance) everywhere a label rect is tested against a dot.

**Bug class — label-width estimate must scale with font size:** the collision
math approximates each label's pixel width as `name.length * charW` rather
than measuring rendered text. `compactChart` renders labels at 9px vs 11px
elsewhere; using the same `charW` constant for both overstates the compact
canvas's label footprint by ~35%, which starves the spiral search of slots it
would otherwise find on that canvas's much smaller drawable area (this alone
produced visible overlapping text in a dense cluster — MinIO/Cloudian/Scality/
IBM/Dell Technologies in the Object Storage Platforms market — before it was
scaled down). Keep `charW` keyed off which canvas is rendering.

**Bug class — pathological-density fallback:** when every ring is exhausted
for a vendor (an extremely dense cluster with more labels than the canvas has
room for), don't fall back to a single fixed obstacle-blind slot next to the
dot — multiple exhausted vendors near each other all land on the same relative
offset and stack directly on top of each other. Instead track the best
(lowest label/dot overlap) candidate seen across the whole ring search as a
graceful-degradation fallback. This matters most on the narrowest canvas
(`compactChart`), where exhaustion is far more common than on the wide desktop
canvas.
