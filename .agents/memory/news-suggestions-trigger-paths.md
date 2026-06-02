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

## Real root cause of "feed news not reaching suggestions": mixed-case impact labels

There is only ONE writer to `news_articles` (the scraper's `createArticle`); there is
no separate scraper. The actual reason feed articles weren't producing AI suggestions
was a **case-sensitivity bug**: `impactLabel` is stored in **mixed case** — current
scraper writes uppercase `HIGH`/`MEDIUM`/`LOW`, but legacy rows are lowercase
`high`/`medium`/`low`. The suggestion generator filtered with `a.impact === 'HIGH' ||
a.impact === 'MEDIUM'` (exact uppercase), silently dropping ~all lowercase
high/medium articles even though the feed displayed them.

**Fix:** compare case-insensitively (`(a.impact ?? '').toUpperCase()`). Did NOT mutate
the stored labels (keeps the news feed untouched) — fixed the consumer instead.

**Why:** the feed display is case-tolerant but the suggestion filter was not, so the
two diverged. Any new consumer of `impactLabel` must normalize case.

