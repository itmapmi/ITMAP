---
name: Geo language vs manual choice
description: Why automatic language detection must not share persistence with explicit visitor selection.
---

**Rule:** Never persist a geo- or browser-detected language as though the visitor explicitly selected it. Refresh the automatic suggestion on new visits or when the network changes, but keep a manually selected language sticky.

**Why:** Previously the language detector cached its browser default before the geo check; that made even first-time visitors look like they had a stored preference. It also meant switching to a German VPN could not update the language. The old saved value cannot reveal whether it came from the visitor or the detector, so it cannot be reliably migrated as an explicit choice.

**How to apply:** Keep manual selection separate from automatic detection, and do not cache automatic changes in the manual preference. Geo IP resolution can fail or return an unmapped country; use the browser language in that case. A VPN only affects detection if the actual IP reaching the app resolves to that VPN country.