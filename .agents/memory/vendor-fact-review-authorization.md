---
name: Vendor fact-review authorization
description: Authorization rule for vendor-scoped Fact Review data and flag submissions.
---

Use only the vendor IDs explicitly assigned to a vendor seat when loading or
submitting Fact Review data. Never broaden that authorization by matching vendor
names across markets.

**Why:** Vendor names are not a unique authorization boundary. A name-based
fallback can expose another organization's write-ups or let a user submit flags
against its evaluation records.

**How to apply:** Keep read and write routes on the same explicit server-side
vendor scope. Multi-market access must be assigned through the vendor scope list,
not inferred from display data.