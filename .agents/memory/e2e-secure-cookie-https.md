---
name: E2E / curl auth must use the HTTPS dev domain
description: Why logged-in flows appear broken when driven against http://127.0.0.1:5000 and how to test header banners that depend on auth.
---
Rule: any test that needs a signed-in session (Playwright tester, curl) must target `https://$REPLIT_DEV_DOMAIN`, never `http://127.0.0.1:5000`.

**Why:** the session cookie is `secure: true` (and `sameSite: 'none'` outside production) so the Replit preview iframe can hold it. Over plain HTTP the browser silently drops it — register/login return 200 with a user body, yet the next `/api/auth/user` is 401 and the app renders the logged-out shell. This looks exactly like a broken post-signup redirect and cost a full test cycle before it was recognised.

**How to apply:** put the HTTPS domain in the tester's task text up front. Test sign-ups send real verification emails via Resend — use throwaway addresses on a clearly fake pattern and delete those rows from `users` afterwards.

Also: the desktop header is a translucent fixed stack (`Navigation`), so any banner inserted there needs a solid background or a light page top washes the text out.
