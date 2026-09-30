---
name: Translation import validation
description: Safeguards for offline market translation workbooks.
---

**Rule:** A translation import with zero applicable notes/comments is not a successful import. Reject it with a reason that distinguishes missing language columns, blank translations, and rows not matching the selected market. Reject an unsupported language before the English import path.

**Why:** An admin uploaded a German workbook in production and got a success message reporting zero updates; production had no German translation rows for that market, so the page continued falling back to English. Silently treating a bad language parameter as an English import can mutate source market data.

**How to apply:** Validate the workbook and collect proposed translations before writing. The offline workbook translates score notes and feature-support comments only; it does not localize every label or market name. For a specific failed upload, request the actual workbook to distinguish a blank target column from a mismatched export.