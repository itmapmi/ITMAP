---
name: News → AI suggestion trigger paths
description: Why AI suggestions must be triggered from BOTH the scraper and the impact analyzer (disjoint article sets).
---

# News → AI suggestions: two disjoint trigger paths

AI market suggestions (`generateSuggestionsForVendorById`) must be fired from **two**
places, because new articles arrive via two paths that produce **disjoint** sets:

1. **Scraper path** — the vendor newsroom scraper analyzes inline and saves articles
   with a **non-null** `impactLabel` (plus opinion/vendorContext/keyTakeaway). These
   rows must get suggestions triggered **at scrape time** in the scraper.
2. **Analyzer path** — articles that enter with `impactLabel = NULL` (imported / feed /
   other sources). The deep impact analyzer (`analyzeAllPending` / `analyzeSingleArticle`)
   labels them, and must trigger suggestions **after analysis**.

**Key constraint:** `getUnanalyzedArticles` selects only `WHERE impactLabel IS NULL`.
So scraped (already-labeled) rows are **never re-picked-up by the analyzer**. If you
move suggestion generation to the analyzer *only*, scraped articles silently stop
producing suggestions — a regression.

**Why disjoint = no double cost:** scraped = non-null label = not re-analyzed;
analyzer-handled = null label = not from the scrape trigger. The two sets don't
overlap, so keeping both triggers does not double LLM calls. The generator also
dedupes (HIGH/MEDIUM filter + pending-duplicate + 14-day-recent), so even an
accidental overlap is safe.

**How to apply:** if asked to make suggestions "also come from the news feed",
the fix is **additive** — keep the scrape-time trigger, ADD an analyzer-time trigger.
Do not replace one with the other.
