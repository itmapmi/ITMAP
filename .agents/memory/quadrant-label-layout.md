---
name: Quadrant chart label collision-avoidance layout
description: How vendor labels avoid overlapping each other in the magic-quadrant chart, and a subtle dot-collision bug class to avoid reintroducing.
---

**Rule:** the desktop chart and the dedicated mobile-app canvas (everything
except the narrow "responsive web" `compactChart` path) place labels with a
spiral search outward from each dot (ring-based candidate positions at
increasing radius) rather than a single fixed adjacent slot. A label pushed
past the first ring gets a thin dashed connector line back to its dot. Manually
dragged positions are always treated as fixed obstacles that other labels must
avoid, never the other way around.

**Why:** with absolute (non-roster-relative) dot positioning, several vendors
can legitimately score within a few pixels of each other, so a fixed
right/left/top/bottom slot per label is not enough — the old algorithm rendered
every candidate unconditionally on desktop and produced literally overlapping
text (e.g. Pure Storage vs NetApp in High-End General Purpose Storage Arrays).

**Bug class to avoid reintroducing:** when checking whether a candidate label
position "hits" a dot, do NOT test distance from the label's anchor point to
the dot — test distance from the dot to the *nearest point of the label's
rectangle*. A long vendor name's rectangle can extend well past its own anchor
and land on a completely different, nearby dot that's nowhere near the anchor
itself; anchor-to-dot distance alone misses that collision and silently
renders a dot underneath someone else's label text. Use a rect-vs-circle
nearest-point check (clamp the dot's x/y into the rect's bounds, then measure
distance) everywhere a label rect is tested against a dot.

**How to apply:** the narrow mobile-web view (`compactChart`) intentionally
keeps its own older hide-on-collision pass (drop the label, dot stays tappable)
rather than adopting the spiral+connector layout — see task #101 for extending
it. Both paths must use the same rect-vs-circle dot check.
