---
name: LLM per-item report summaries
description: Making multi-section LLM JSON summaries (per category/feature) complete and untruncated
---

# LLM per-item report summaries

When an LLM must emit one summary per N input items (e.g. per product category, per ecosystem feature) as a single JSON object, two failure modes matter:

1. **Truncation** — a fixed per-item word target × many items can blow past `max_tokens`, producing invalid/partial JSON and silently dropped sections. Fix: scale the per-item word target down as item count grows, and size `max_tokens` from the estimated total words (~1.8 tokens/word) capped at the model's output limit (gpt-4.1-mini ~16k).

2. **Omission** — the model may skip some requested items even when JSON is valid. Fix: **reconcile** — iterate the original input list and backfill any item the model omitted with a neutral note (match by case-insensitive name). Never trust the model to echo every item.

**Why:** A market PDF summarizer (`server/agents/report-summarizer.ts`) had 41 ecosystem features × 150 words → truncation risk and silently empty arrays. Adaptive sizing + reconcile + a single repair retry (on parse-fail or any backfilled item) made it reliably complete.

**How to apply:** Any new "summarize N things into N paragraphs via one LLM call" path — don't hardcode word counts, always reconcile against the input list, and add one retry before accepting an incomplete result.
