---
name: Anonymous user feature-gating nuance
description: Vendor-tier feature-access checks can report "unlocked" for anonymous users; don't rely on them alone to gate anonymous-only UI.
---
A feature-access check designed for vendor-tier paywalls (free vs. paid
vendor plans) can evaluate as "unlocked" for any user who isn't
vendor-scoped — which includes unauthenticated visitors. It was never
designed to answer "is this visitor allowed at all," only "which vendor tier
is this."

**Why:** using it as the sole gate for an authenticated-vs-anonymous
distinction silently under-locks a feature for anonymous visitors.

**How to apply:** when a UI element must be locked specifically for
anonymous visitors, add an explicit authentication check and OR it into the
lock condition — never rely on a vendor-tier feature check alone. Backend
route-level auth middleware is a separate, usually-correct safety net, but
don't assume it means the client-side lock logic is also correct.
