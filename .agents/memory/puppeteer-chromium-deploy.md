---
name: Puppeteer Chromium in Replit deployment
description: How to make Puppeteer reliably find and launch Chromium in Replit deployments (PDF export, page rendering)
---

# Puppeteer Chromium in Replit deployment

The nix-store Chromium wrapper can pass an `access()`/exists check but still fail
to launch in the deployment with `spawn EIO` — its nix closure (interpreter +
shared libs) is not fully materialized in the deploy image. **A path existing is
not the same as it being launchable.**

The reliable approach:
1. Pin Puppeteer's browser download into the **project tree** via
   `.puppeteerrc.cjs` (`cacheDirectory: ./.cache/puppeteer`). It then ships with
   the deploy image like `node_modules` (gitignored files still deploy), and
   Puppeteer's `postinstall` re-downloads it on the deploy build (works unless
   `PUPPETEER_SKIP_DOWNLOAD` is set).
2. Declare Chromium's ~29 shared libs (glib, nss, nspr, atk, at-spi2, cups,
   dbus, gtk3, pango, cairo, mesa, alsa-lib, fontconfig, freetype, xorg.* …) as
   nix system deps in `replit.nix`. Once declared, Replit's runtime loader finds
   them — the downloaded Chrome launches with the **default env**, no custom
   `LD_LIBRARY_PATH` needed.

**Why:** `findChromiumPath()`-style logic that trusts the first path passing
`access()` returns a broken nix wrapper in prod. Building `LD_LIBRARY_PATH` by
globbing `/nix/store` at runtime is too slow (full-store readdir per package
times out) and version-ambiguous — don't do it.

**How to apply:** Resolve Chromium through a `launchBrowser()` helper that tries
candidates in order (Puppeteer-managed Chrome first, then env overrides, fixed
paths, nix discovery, then undefined) and **actually calls `puppeteer.launch()`
on each, falling through on failure**. All Puppeteer callers (PDF generation,
datasheet page rendering) should go through it. See
`server/pdf-generator/pdf-service.ts`. Tradeoff: adds ~360MB Chrome to the
deploy image — acceptable for reliability.
