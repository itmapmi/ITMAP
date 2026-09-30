---
name: Exclusive category scroll anchoring
description: Why one-open-at-a-time feature accordions need explicit scroll positioning after a switch.
---

When switching between long feature categories, keep the newly opened heading visible after the previous panel closes. Account for both the fixed navigation and the sticky tab strip, not just the viewport edge.

**Why:** In a phone-sized tap path, collapsing the panel above the clicked heading moved that heading completely offscreen. An initial scroll correction put it behind the sticky tab strip, making it appear visible geometrically but impossible to tap again.

**How to apply:** For future mutually exclusive accordion lists, position the clicked heading after the state change renders, leave enough scroll margin for the full sticky stack, and verify that the heading is actually clickable after opening a lower category.