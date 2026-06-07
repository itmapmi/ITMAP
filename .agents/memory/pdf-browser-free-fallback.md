---
name: PDF browser-free fallback
description: How rich HTML reports still produce PDFs in deployment where Chromium cannot launch.
---

# Browser-free PDF fallback

`PDFService.generatePDF` is **browser-free only** — it always renders via `renderHtmlWithPdfmake()` (pure-JS: pdfmake + html-to-pdfmake + jsdom) and never touches Chromium. `PDFService.htmlToPdf` still tries `launchBrowser()` (Puppeteer) first but falls back to `renderHtmlWithPdfmake()` on **either** launch failure **or** any mid-render error. This keeps every report route (full market report, vendor/product/ecosystem evaluation, summary, forecast, lead-gen, datasheets, RFP) working in production.

**Why:** Chromium is unreliable in deployment. The earlier "fall back only when launchBrowser() throws" design was insufficient: in prod Chromium can *launch successfully and then crash mid-render* (`page.setContent`/`page.pdf`), which bypassed the launch-only fallback and 500'd the report routes — while the news export (separate pdf-lib renderer that never touches Chromium) kept working. Lesson: a launch-only fallback is not enough; the render path itself must be browser-free or catch render errors too.

**How to apply:**
- New report features should route through `generatePDF` (now always browser-free) so they can never 500 on Chromium. `htmlToPdf` is acceptable too since it falls back on any error — do NOT write a new Puppeteer call site.
- Dev and prod now produce the SAME plainer pdfmake output for `generatePDF` (no env-dependent fidelity difference); this is an intentional reliability-over-fidelity tradeoff.
- pdfmake 0.3.x API: singleton instance from `import('pdfmake')` (`.default`); use `setFonts`, `setLocalAccessPolicy`, `setUrlAccessPolicy`, then `createPdf(def, {}).getBuffer()`. Server entry is the package root (`js/index.js`), NOT `pdfmake/src/printer`.
- Standard fonts: map Helvetica family to the standard-14 names (no TTF). The local-access policy MUST allow those 4 font name strings or rendering throws "Access to local file denied".
- Fallback sanitizes out `<style>`/`<script>`/`<img>` and the url-access policy denies remote fetches — so the plain output has no CSS-class styling and no images. If a report needs an image in the fallback, embed it as a pdfmake node, not an `<img>`.
- **pdfmake's runtime dep `pdfkit` MUST be a direct dependency.** Build is `esbuild --packages=external`, so prod resolves from node_modules; relying on `pdfkit` only transitively (via pdfmake) let it get pruned in deploy → fallback threw "Cannot find module 'pdfkit'" for every report while news export (separate pdf-lib renderer) kept working. Any pure-JS renderer's transitive native-ish deps need the same treatment.
