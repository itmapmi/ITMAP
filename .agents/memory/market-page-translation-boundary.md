---
name: Market page translation boundary
description: Why public market translations overlay canonical English records rather than replace them.
---

**Rule:** Treat translated market names, descriptions, market categories, and feature-category names as display-only overlays. Keep canonical English data for URL slugs, search identity, grouping, Excel matching, analytics, and downstream actions. Do not send private user-built market definitions or categories to an external translation service without separate authorization.

**Why:** Market routes derive stable slugs from English names, while evaluation matrices group features by English category identity and translation workbooks match names. Replacing source names with machine translations can break existing links or imports; translating private definitions externally is a different privacy decision from localizing public listings.

**How to apply:** Localize public records after access filtering, cache by language and English source version, and preserve the original fields in API responses. Display localized category labels in evaluation views, but group and match by canonical IDs/English fields. If the provider fails, identify that the translation is unavailable instead of implying an English fallback is a completed translation.