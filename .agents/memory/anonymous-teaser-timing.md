---
name: Anonymous teaser timing and how to test it
description: Product decisions behind the anonymous free-preview clock (start trigger, soft vs forced prompt) and the fast way to verify each phase without waiting.
---

## Decision (Sept 2026, Reddit campaign follow-up)
- The free-preview clock starts ONLY the first time an anonymous visitor
  opens a market detail route (`/markets/:id`, `/market/:id`, and their
  `/mobile/` variants). The listing (`/markets`), home and other pages never
  start it. The user subsequently asked for progress to persist across tabs
  and browser restarts, rather than reset for each tab session.
- 45 seconds (TEASER_DURATION_MS; was 2 minutes until 2026-09-15) → soft, dismissible sign-up dialog; access stays fully unlocked. Tests must anchor on the constant, not a literal.
- The earlier ten-minute absolute forced cutoff is superseded. Production
  behavior verified on 2026-10-09 uses two soft prompts, with the forced
  phase tied to dismissing both; elapsed visit duration alone does not
  force registration. A popup left open can therefore outlast the timer.
- The forced dialog has no close X; Escape and outside clicks are blocked,
  and market features lock.
- The buyer sign-up form always shows the value proposition line
  ("Free, forever. No card. …") — the user supplied this copy verbatim.

**Why:** ~200 paid clicks and zero registrations with the previous
90-second, company-email-only prompt; the user wanted more browsing before
the nudge and a hard gate later.

**How to apply / test:** Use the current schedule and simulate both elapsed
time and dismissal history; elapsed time alone no longer tests the forced
phase. Do not infer registration-gate bypass from Operations dwell totals:
they include visible time with a popup or signup form open, not just
unrestricted market reading. Preserve the forced dialog's dismissal guard.

## Browser-wide persistence
Keep the timer, dismissal count, and forced-registration state across tabs
and browser restarts. Do not reset an existing visitor's progress during a
release or change the prompt intervals as part of persistence work.

**Why:** The user approved closing the new-tab/browser-restart loophole, while
accepting that a different browser, private browsing, or cleared site data
can still begin a fresh anonymous preview.

**How to apply:** Treat this as a registration/conversion gate, not proof of
identity or a security boundary. Do not identify or block people by shared IP.
Preserve normal signed-in access and the auth/legal-page exemptions.
