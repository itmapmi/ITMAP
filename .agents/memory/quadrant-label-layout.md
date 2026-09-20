---
name: Quadrant chart label positioning — free-drag, no collision avoidance
description: Vendor label placement in the magic-quadrant chart is intentionally simple free-form dragging; do not reintroduce spiral collision-avoidance or a connector line.
---

**Current rule (Sep 2026):** all three canvases (desktop chart, dedicated
mobile-app canvas, and the narrow "responsive web" `compactChart` view) share
one simple label-placement path: a label with no saved position renders at a
small fixed offset from its dot; a label with a saved position renders exactly
there, unconditionally, with no distance limit from the dot and no check
against other labels or dots. There is no connector line, ever.

**Why:** a prior collision-avoidance spiral-search layout (ring search outward
from each dot, connector line for labels pushed past the first ring, and a
90px "tether" that discarded a dragged position and fell back to
auto-placement if it landed too far from the dot) made manual dragging feel
broken — a label dropped near its dot could still visually jump elsewhere on
the next render because the algorithm forced `text-anchor: start` onto every
custom position regardless of the anchor it was originally rendered with. The
user explicitly asked to revert to plain, always-honored free-form dragging
and to remove the dashed connector line entirely, trading automatic
overlap-avoidance for predictable manual control.

**How to apply:** if labels overlap in a dense cluster, that is expected and
left to the admin to fix by dragging — do not silently reintroduce
auto-placement logic to "solve" it. If asked to add collision avoidance back,
confirm with the user first since it was deliberately removed for UX reasons,
not as an oversight.
