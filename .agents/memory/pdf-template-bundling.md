---
name: PDF template must be bundled, not read off disk
description: Why PDFService reads its HTML template from a bundled TS constant with a disk override, not directly from the .html file.
---
PDF generation (`server/pdf-generator/pdf-service.ts`) renders an HTML
template through Puppeteer. The template lives in `report-template.html`, but
esbuild does NOT copy `.html` files into `dist/`, so in production reading the
file off disk fails (`EIO: i/o error, read`, sometimes `ENOENT`) and every PDF
export 500s.

**Rule:** keep a bundled copy of the template in `report-template.ts`
(exported constant). Load via a cached `getTemplate()` that tries the on-disk
`.html` first (dev hot-edit override) and falls back to the bundled constant on
ANY read error. Never `readFile` a template/asset as a hard dependency in a
code path that runs in production.

**Why:** the prod build only ships the bundled JS; non-bundled source assets
are not guaranteed present/readable. A direct `readFile` of the template is a
latent production 500.

**How to apply:** any new runtime-needed static asset (HTML templates, etc.)
should be inlined/bundled into the TS source, or made fall-back-safe the same
way. If you edit `report-template.html`, mirror the change into
`report-template.ts` (they can drift).
