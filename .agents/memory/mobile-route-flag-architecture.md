---
name: Mobile route-flag architecture (/mobile/... prefix)
description: How the dedicated mobile experience is gated — explicit route flag vs viewport hook — and related pitfalls hit while building it.
---

## Decision: `mobileMode` route flag, not `useIsMobile()`, for structural mobile UI
The app has two ways to detect "mobile":
- `useIsMobile()` — a viewport-width (768px) hook, used pervasively across the codebase already.
- `mobileMode` — an explicit boolean derived from the URL (`location.startsWith("/mobile/")`), threaded down as a prop through page → component.

**Rule:** any *structural* mobile change (hiding a whole feature/tab, replacing a modal/dialog pattern, changing navigation, capping a list to N items) must gate on `mobileMode`, not `useIsMobile()`. Purely cosmetic/responsive adaptations (stacking a grid, shrinking a select, switching a table to cards) are fine on `useIsMobile()` since they degrade gracefully at any width.

**Why:** `useIsMobile()` fires on desktop browsers with a narrow window too — gating structural changes on it would silently break desktop users who resize, and conversely wouldn't let a `/mobile/...` page look distinct from desktop at the same width. Centralizing the mobile *product surface* on an explicit route makes the two experiences independently evolvable, per the original ask.

**How to apply:** Server-side UA sniffing + a `view_mode` cookie (no `cookie-parser` dep — parsed manually in `server/`) redirect phone visitors into `/mobile/...`; a manual toggle lets users cross either way, cookie persists the choice. Path-scope/translation logic for what counts as an in-scope route lives in `shared/mobile-paths.ts`. Pages compute `mobileMode` from `location` (wouter) and pass it down as a prop; leaf components that need it declare `mobileMode?: boolean` in props and **must actually destructure it** in the function signature — a prop declared in the interface but missing from the destructured parameters compiles fine at the call site but throws `Cannot find name` at every use inside the component (hit this in `magic-quadrant.tsx`; caught only by `tsc --noEmit`, not Vite HMR).

## Pitfall: HMR does not catch scope/type errors
Vite's dev server will happily hot-reload a component that references an undefined identifier used only inside JSX conditionals not hit by the current render path — the browser stays clean until that branch renders. Always run `tsc --noEmit` (or equivalent) across touched files before declaring a session done; don't rely solely on "no HMR/browser console errors so far."

## Reused patterns worth knowing about
- Double `<Navigation />` render (global `App.tsx` shell + a page's own inline one) is a pre-existing desktop quirk in at least `my-rfps.tsx`/`my-rfp-detail.tsx`; fixed for mobile by conditionally suppressing the page's own `<Navigation />` when `mobileMode`, since it would stack with the global mobile nav.
- Cheap vertical stacking for a dense `grid-cols-12` row on mobile: wrap it in a `mobileMode ? "grid-cols-1" : "grid-cols-12"` container — the inner `col-span-N` utilities become harmless when the grid only has 1 column, so children stack without duplicating markup.
- A guided step wizard was built on top of an existing shadcn `Tabs`/`TabsContent` (value-driven visibility) by hiding `TabsList` on mobile and adding a sticky bottom Back/Next footer that calls the same `setTab` — no content duplication needed.
