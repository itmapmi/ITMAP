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
   `.puppeteerrc.cjs` (`cacheDirectory: ./.cache/puppeteer`).
2. **Install Chrome explicitly in the deployment BUILD command** — do NOT rely on
   Puppeteer's `postinstall` to re-download it. In practice the deploy build did
   NOT have Chrome in `.cache/puppeteer` at runtime (prod error: `Could not find
   Chrome (ver. 140.x)` + the gitignored dev `.cache/` does not reliably ship).
   Fix: set the deploy build to
   `["sh","-c","npx puppeteer browsers install chrome && npm run build"]` via the
   deployment skill's `deployConfig` (you CANNOT edit `.replit` directly — it is
   tool-owned; `deployConfig({deploymentTarget:"vm", build:[...], run:["npm","run","start"]})`).
   On VM/gce deploys the build writes to the same persistent disk the run uses, so
   the downloaded Chrome (matching the puppeteer pkg version) is present at runtime.
3. Declare Chromium's ~29 shared libs (glib, nss, nspr, atk, at-spi2, cups,
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

**UPDATE — Chromium still did not launch in this deployment even after the build
installs Chrome (nix chromium times out waiting for WS endpoint; puppeteer Chrome
still reported missing in `.cache/puppeteer` at runtime). The build-step download
did NOT reliably persist into the running VM image.** The durable fix that worked:
**avoid the browser entirely for PDFs when possible.** `pdf-lib` is already a dep
and renders pure-JS PDFs with no Chromium — the market "generate report" path
(`/api/markets/:id/generate-report`) uses it and works in prod while every
Puppeteer/`generatePDF()` path fails. Prefer a `pdf-lib` generator (manual
pagination + text wrapping + WinAnsi `sanitize()` to strip non-ASCII + per-token
char-breaking for long URLs) for tabular/text exports. News export now uses
`PDFService.generateNewsExportPdf()` (pdf-lib). Only keep Puppeteer for PDFs that
genuinely need full HTML/CSS fidelity.
