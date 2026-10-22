---
name: Intelligence collection reliability
description: Source identity and retry fairness constraints for external intelligence collectors.
---

Source identity parameters must survive duplicate detection. A discussion item
ID and a dated activity snapshot distinguish evidence; they are not tracking
parameters. Repeated generic titles cannot replace those identities.

**Why:** Generic query stripping collapsed distinct Hacker News discussions
onto one `/item` identity and suppressed newer GitHub snapshots. Both problems
looked like sources had stopped collecting.

**How to apply:** Keep source-specific identity rules ahead of generic
article URL/title deduplication. Test distinct items/days and same-item/day
repeats together whenever changing deduplication.

Retry fairness must account for failed and empty attempts, not just saved
evidence. Keep scheduling state separate from buyer-visible signals.

**Why:** Prioritizing vendors with no saved evidence repeatedly selected the
same unsuccessful accounts, starving the rest of the roster.

**How to apply:** Persist attempts across restarts, rotate by last touch, and
bound external API use. Do not create fake feed entries to record failed pulls,
or turn unavailable activity data into a zero-activity claim.
