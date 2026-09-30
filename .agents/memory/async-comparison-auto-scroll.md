---
name: Async comparison auto-scroll
description: Why mobile comparison pages may stop short when scrolling to evidence after the second product is selected.
---

On mobile comparison pages, a second product selection may occur while feature-support data is still loading. Scrolling immediately can hit the short loading page's maximum scroll position; when the full evidence expands later, the browser does not automatically finish the scroll.

**Why:** A phone-sized interaction check showed the target heading left far below the sticky navigation despite scrollIntoView firing. The support rows arrived after the initial scroll, changing the page height.

**How to apply:** On the transition to two selected products, scroll toward the evidence and remember if data is still loading. If so, scroll again after the evidence renders; clear the pending scroll when selection falls below two. Allow for the sticky header and honor reduced-motion settings.