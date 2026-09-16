---
name: Identified visitor Leadgen attribution
description: How Leadgen should treat traffic from a browser explicitly linked to a user.
---

Leadgen may attribute client-beacon activity to a user only through an explicit `traffic_visitors.user_id` link. Authenticated events are stored normally; older linked traffic is read through a deduplicated union, while page views and login events remain outside Leadgen scoring.

**Why:** A returning browser can retain a trusted visitor link while its auth cookie is unavailable to an individual beacon request. IP, user-agent, email, and other inferred matching are not safe identity boundaries.

**How to apply:** Keep `traffic_events.user_id` populated for future events from an explicitly linked visitor, include only null-user client events from linked visitors when reading historical Leadgen activity, and keep login counts sourced from authentication activity logs.