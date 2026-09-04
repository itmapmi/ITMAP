---
name: Mobile mockup graduation fidelity
description: Defines the fidelity expected when approved Canvas mobile designs are integrated into production.
---

Approved mobile mockups must be graduated as complete, route-gated production experiences. Do not treat an existing desktop component as equivalent after adding a few responsive classes or controls.

**Why:** A partial Markets graduation left several sections on their old desktop information architecture and made the approved design appear only inconsistently. The user expects every approved section, navigation pattern, loading/empty state, and refresh behavior to be implemented end to end.

**How to apply:** Compare every approved screen against the production mobile branch, wire it to live data, expose every approved section through production navigation, preserve section state through refresh, test empty/loading/locked states, and verify desktop routes remain unchanged.