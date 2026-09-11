---
name: vitest .tsx import failures
description: Why a vitest test that imports a .tsx file fails with "invalid JS syntax" even after adding @vitejs/plugin-react, and the workaround.
---

In this project, vitest (v4.x) bundles its own internal Vite (major version far ahead of the
project's top-level `vite` dependency and of `@vitejs/plugin-react`'s supported peer range).
Adding `plugins: [react()]` to `vitest.config.ts` does not fix `.tsx` parsing — the plugin
silently fails to hook into vitest's bundled Vite, and the transform falls through to raw
esbuild honoring `tsconfig.json`'s `"jsx": "preserve"`, which esbuild cannot handle, producing
"Failed to parse source... make sure to not set jsx to preserve" pointing at unrelated lines.

**Why:** version skew between the top-level `vite`/`@vitejs/plugin-react` and vitest's
vendored Vite; this project doesn't have React Testing Library or a working jsdom+React
component-test setup.

**How to apply:** don't try to test a `.tsx` file directly (even just importing it for its
non-JSX exports triggers the same failure). Extract pure, framework-free logic you want unit
tested into a plain `.ts` module and have the `.tsx` component import from it. All working
tests in this repo already follow this pattern (plain `.ts` test files importing plain `.ts`
modules). If real component rendering tests are ever needed, expect to first add
`@testing-library/react` and resolve the vitest/vite version mismatch.
