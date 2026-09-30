---
name: Translation import validation
description: Safeguards for offline market translation workbooks.
---

**Rule:** A translation import with zero applicable notes/comments is not a successful import. Reject it with a reason that distinguishes missing language columns, blank translations, and rows not matching the selected market. Reject an unsupported language before the English import path.

**Why:** An admin uploaded a German workbook in production and got a success message reporting zero updates; production had no German translation rows for that market, so the page continued falling back to English. Silently treating a bad language parameter as an English import can mutate source market data.

**How to apply:** Validate the workbook and collect proposed translations before writing. The offline workbook translates score notes and feature-support comments only; it does not localize every label or market name. For a specific failed upload, request the actual workbook to distinguish a blank target column from a mismatched export.

**Rule for recovering fully localized workbooks:** Never infer field identities from translated headings. If a matching workbook with original English headings exists, pair text by column position only after checking sheet dimensions, vendor row order, normalized cell correspondence, and live vendor/criterion/feature identities. Generate a translation-only workbook with explicit target-language headers; leave English source data untouched.

**Why:** A workbook named as German can still be an ordinary English-layout export with German commentary and no language-target columns. The filename and comment language do not make it a translation import. A second copy preserving English headings can provide a safe mapping, but blindly treating every `- Notes`/`- Comments` cell as German risks importing English text as a translation.

**How to apply:** For future incidents, compare the two files and the intended market before converting. Do not add automatic legacy-format guessing to the importer.