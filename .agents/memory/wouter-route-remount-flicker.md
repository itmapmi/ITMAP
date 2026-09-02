---
name: wouter inline component prop causes periodic full remounts
description: Why a page can appear to "reload itself" every few seconds with zero user interaction, no auth issue, and no repeating network errors.
---

## The bug
`<Route path="/x" component={() => <Wrapper><Page/></Wrapper>} />` looks harmless
but wouter renders `component` via `createElement(component, params)`. An inline
arrow function is a **new function reference every render** of whatever ancestor
re-renders — React then sees a different component *type* at that tree position
and fully unmounts + remounts it (replaying mount animations, resetting local
state), even though nothing about the route or auth actually changed.

**Why:** Any ancestor re-render is enough to trigger it — including one caused by
something totally unrelated to the affected page (in this case a 1x/5s
`setInterval` tick inside a hook called directly in the top-level `Router()`
component, kept ticking even for authenticated users who didn't need it).
Symptoms: content area flickers/"reloads" every few seconds with no clicks, no
new console errors (requests mostly succeed silently), while sibling elements
outside the routed subtree (e.g. a top nav bar using a stable component
reference) stay visually stable.

**How to apply:** When a route needs to render a wrapped/composed element
(`ProtectedRoute`, a context provider, etc.), never pass it via the `component`
prop as an inline function. Use wouter's children-function form instead:
`<Route path="/x">{() => <Wrapper><Page/></Wrapper>}</Route>` — wouter just
*calls* `children(params)` to get JSX rather than using it as a component type,
so the rendered element's own stable type is what gets reconciled, immune to how
often the parent re-renders. Also audit any hook that ticks a timer
unconditionally at the top of a router/layout component — gate it to only run
when its result can actually matter (e.g. only while logged out).
