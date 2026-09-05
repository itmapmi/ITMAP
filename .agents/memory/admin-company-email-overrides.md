---
name: Admin company-email overrides
description: Why the admin "mark verified / clear / resend" support actions bypass the token+cooldown self-service path, and the invariants they must still honor.
---
Rule: admin overrides of company-email verification are separate storage functions (no token, no cooldown), but they still rely on the same partial unique index as the self-service link — never bypass or pre-empt that constraint in application code.

**Why:** `verifyCompanyEmail` is deliberately token-bound (stale-link safety), so an admin cannot "reuse" it without minting a fake token; the correct move was a dedicated `markCompanyEmailVerifiedByAdmin`. The 23505 catch + pre-check for another verified holder is what keeps "verified on one account only" true even when support clicks the button.

**How to apply:**
- Admin "clear" removes only the address + verification state; company name/designation stay (support scenario is "wrong email", not "wrong company").
- Admin resend deliberately skips the 60s cooldown, matching the existing bulk account-verification reminder policy.
- Admin session cookies are `Secure`, so curl-testing admin routes must go through `https://$REPLIT_DEV_DOMAIN`, not localhost (cookie silently dropped otherwise).
- Every admin user-row response must go through the same public-user serializer + derived flags as the list endpoint so the client can merge rows in place.
