---
name: Traffic visitor row ownership
description: Why the Operations visitor table is one row per browser cookie, and how account switches on a shared browser are handled.
---

**Rule:** A `traffic_visitors` row belongs to the first account that claims it and is never reassigned. When a browser already linked to account A signs in as account B, the login path mints a new visitor cookie so B gets its own row.

**Why:** September 2026 — the admin tested "Continue with Google" from their everyday browser, then signed back in as admin. The visitor row flipped to admin and the Google account vanished from the Operations visitor table even though its login was recorded everywhere else. Looked like "Google logins aren't logged"; it was a same-browser attribution artefact.

**How to apply:** The visitor table shows browsers-with-owners, not logins — for a per-login audit use the activity-log endpoint/table. When debugging "user X doesn't appear", check whether X shares a browser with another account before suspecting the login path. Pre-login anonymous browsing stays with the first account's row on a switch; that is intentional (no cross-account attribution).
