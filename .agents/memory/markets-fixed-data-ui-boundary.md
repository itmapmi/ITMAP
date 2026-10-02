---
name: Markets fixed-data UI boundary
description: Defines the non-negotiable data boundary for redesigning Markets experiences.
---

Markets pages may visually reorganize only the stored quadrant, persisted criteria weights, vendor criterion scores/commentary, product and ecosystem support levels/commentary, Vendor Intelligence records, and Reports.

**Why:** The backend data model is fixed. The product is an evidence presentation system, not a generated buyer journey; synthetic takeaways, recommendations, rankings, aggregates, or newly inferred facts misrepresent what the product can provide.

**How to apply:** Improve hierarchy, navigation, disclosure, filtering, comparison, and mobile readability using existing fields. Keep the quadrant’s score mapping and vendor coordinates intact. Vendor Evaluation must lead from the graph into a comparison of at least two vendor products. Product and Ecosystem Evaluation must compare exactly two products. Commentary is typically 100–250 words, so never expand it inside score rows; every criterion or feature score needs a View notes action opening a scrollable popup with vendor, product, subject, score/support level, and full stored commentary. Show explicit unavailable states when stored data is absent.

**Market entry priority:** Keep technical product comparison as the initial tab, with feature rankings and ecosystem support before vendor comparison. The quadrant is shared context above all tabs; criteria weights are shown only when Vendor Map is selected.

**Why:** Campaign visitors who click Compare Products expect feature-by-feature evidence by default. The user subsequently requested a consistent quadrant across every tab on both desktop and mobile.

**How to apply:** On mobile, start with the quadrant; its “IT Map for [market name]” heading expands the stored definition, with an arrow-only Back link in a small blue box at the top right. Do not duplicate the market title or definition above the chart. Keep the desktop definition collapsed by default above the quadrant. Keep the criteria-weights disclosure next to/below the quadrant, but hide it outside Vendor Map on both desktop and mobile. Vendor Map contains the vendor comparison experience without a duplicate graphic. Preserve direct section links. The user explicitly requested placement changes without changes to the graphic's drawing or positioning logic.

**Explicit category-ranking exception:** The user requested a Feature rankings tab beside Compare Products. Ranking vendors by their existing product-feature support totals is allowed; it is a view of stored evidence, not a new inferred recommendation.

**Why:** The prior no-rankings rule prevented invented buyer takeaways, but would incorrectly exclude this directly requested presentation of the same category totals already shown in Compare Products.

**How to apply:** Place Feature rankings directly after Compare Products, before ecosystem support, in both tab layouts. Use only the product-capability feature partition and the shared support-level contribution mapping. Keep maximum equal to the number of features; sort scored vendors highest first, disclose missing support records instead of presenting unscored vendors as zero, and point readers to Compare Products commentary for rationale.