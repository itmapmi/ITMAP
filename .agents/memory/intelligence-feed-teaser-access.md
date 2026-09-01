---
name: Making a requireFeature-gated route anonymous-readable
description: How to let anonymous/teaser visitors read a route without breaking the RBAC check for logged-in users, and the requireFeature gotcha that breaks the naive fix.
---

`requireFeature(key)` (server/featureAccess.ts) unconditionally returns 401 when `!req.isAuthenticated()`, before ever evaluating the feature flag. This means an inline `if (!req.isAuthenticated()) return res.status(401)` inside a route handler *after* `requireFeature(...)` in the middleware chain is dead code — the middleware already blocked anonymous requests earlier. Deleting only that inline check does nothing; the route stays 401 for anon.

To make such a route anonymous-readable (e.g. so it can populate during the client's registration teaser window) while still enforcing the feature flag for authenticated users, replace the unconditional `requireFeature(key)` in the middleware chain with a wrapper that skips it for anonymous requests:

```js
(req, res, next) => {
  if (!req.isAuthenticated?.()) return next(); // anon: fall through to requireMarketAccess
  return requireFeature("intelligence_feed")(req, res, next); // authed: normal RBAC gate
},
requireMarketAccess,
```

Applied to `/api/markets/:id/vendor-signals` so the Intelligence Feed tab can populate for anonymous visitors during `teaserActive`, matching how `/vendors` and `/feature-support` were already publicly readable. The matching client fix is rendering the `TabsContent` on `(isAuthenticated || teaserActive)` instead of `isAuthenticated` alone — a dropdown/tab *item* can be visible during the teaser while its `TabsContent` is still hard-gated to `isAuthenticated` only, which silently renders an empty tab instead of an error.

**Why:** First fix attempt (removing the redundant inline check) looked complete via code review but changed nothing, because the real block was one middleware earlier in the chain. Confirmed via anonymous curl before/after — always verify server auth changes by testing the actual HTTP response, not just reading the handler body.

**How to apply:** Before "unlocking" any route for anonymous/teaser access, trace every middleware in its `app.get(...)` argument list for auth checks, not just the handler body. After the fix, curl the route with no cookies and confirm 200 (or the intended anonymous shape), then curl a comparably-locked route (e.g. `/reports`) to confirm it's still 401 and wasn't accidentally loosened too.
