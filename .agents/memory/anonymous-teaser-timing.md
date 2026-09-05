---
name: Anonymous teaser timing and how to test it
description: Product decisions behind the anonymous free-preview clock (start trigger, soft vs forced prompt) and the fast way to verify each phase without waiting.
---

## Decision (Sept 2026, Reddit campaign follow-up)
- The free-preview clock starts ONLY the first time an anonymous visitor
  opens a market detail route (`/markets/:id`, `/mobile/markets/:id`). The
  listing, home and other pages never start it. Once started it persists in
  sessionStorage for the tab session.
- 2 minutes → soft, dismissible sign-up dialog; access stays fully unlocked
  through this phase (the old "lock after 2 dismissals" rule was removed).
- 10 minutes (from clock start) → forced dialog: no close X, Escape and
  outside clicks blocked, `teaserActive` false so market features lock.
- The buyer sign-up form always shows the value proposition line
  ("Free, forever. No card. …") — the user supplied this copy verbatim.

**Why:** ~200 paid clicks and zero registrations with the previous
90-second, company-email-only prompt; the user wanted more browsing before
the nudge and a hard gate later.

**How to apply / test:** don't wait 10 minutes — set
`sessionStorage.itmap_teaser_start_at = Date.now() - N*60000` and reload.
Dialogs carry `data-testid="dialog-registration-soft|forced"`. Any timing
change should keep the forced dialog's `onOpenChange` guard, otherwise the
Radix close paths reopen the "dismissal" counter logic.
