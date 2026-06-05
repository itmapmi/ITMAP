---
name: PDF browser-free fallback
description: How rich HTML reports still produce PDFs in deployment where Chromium cannot launch.
---

# Browser-free PDF fallback

`PDFService.generatePDF` and `PDFService.htmlToPdf` both try `launchBrowser()` (Puppeteer) first, then on launch failure fall back to `renderHtmlWithPdfmake()` — a pure-JS pipeline (pdfmake + html-to-pdfmake + jsdom). This means every Puppeteer-based report route (full market report, vendor/product/ecosystem evaluation, forecast, lead-gen, datasheets, RFP) keeps working in production without touching each route.

**Why:** Chromium is unreliable in the deployment (nix binary `spawn EIO`; puppeteer-managed Chrome not present at runtime). pdf-lib/pdfmake are pure JS and always work. Dev keeps full-fidelity Chromium output; prod silently degrades to plainer-but-complete PDFs.

**How to apply:**
- New report features should route through `generatePDF`/`htmlToPdf` so they inherit the fallback automatically — do NOT write a new Puppeteer call site.
- pdfmake 0.3.x API: singleton instance from `import('pdfmake')` (`.default`); use `setFonts`, `setLocalAccessPolicy`, `setUrlAccessPolicy`, then `createPdf(def, {}).getBuffer()`. Server entry is the package root (`js/index.js`), NOT `pdfmake/src/printer`.
- Standard fonts: map Helvetica family to the standard-14 names (no TTF). The local-access policy MUST allow those 4 font name strings or rendering throws "Access to local file denied".
- Fallback sanitizes out `<style>`/`<script>`/`<img>` and the url-access policy denies remote fetches — so the plain output has no CSS-class styling and no images. If a report needs an image in the fallback, embed it as a pdfmake node, not an `<img>`.
