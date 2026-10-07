---
name: Quadrant chart label positioning — free-drag, no collision avoidance
description: Vendor label placement in the magic-quadrant chart is intentionally simple free-form dragging; do not reintroduce spiral collision-avoidance or a connector line.
---

**Current rule:** desktop (including zoom-narrowed desktop viewports) and the
dedicated mobile-app canvas share one simple label-placement path:
a label with no saved position renders at a
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

**Desktop coordinate convention:** preserve the original full-size drawing
convention when fitting a desktop chart. Browser zoom must scale the entire
graphic, not reinterpret saved labels against newly computed dot geometry.
Do not migrate or reset manually saved placements to fix display fitting.

**Why:** the user identified the manually arranged 67% desktop view as the
intended layout; higher zoom must preserve that same arrangement, not create
a new one. Dedicated mobile interaction is a separate product boundary.

**How to apply:** changes to available display space (banners, menus, weights,
or viewport size) may change the display scale, never the desktop coordinates
or free-drag semantics. Keep the explicit mobile path separate.
