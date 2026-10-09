---
name: Anonymous teaser timing and how to test it
description: Product decisions behind the anonymous free-preview clock (start trigger, soft vs forced prompt) and the fast way to verify each phase without waiting.
---

## Decision (Sept 2026, Reddit campaign follow-up)
- The free-preview clock starts ONLY the first time an anonymous visitor
  opens a market detail route (`/markets/:id`, `/market/:id`, and their
  `/mobile/` variants). The listing (`/markets`), home and other pages never
  start it. Once started it persists in sessionStorage for the tab session.
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
