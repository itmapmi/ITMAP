---
name: Markets fixed-data UI boundary
description: Defines the non-negotiable data boundary for redesigning Markets experiences.
---

Markets pages may visually reorganize only the stored quadrant, persisted criteria weights, vendor criterion scores/commentary, product and ecosystem support levels/commentary, Vendor Intelligence records, and Reports.

**Why:** The backend data model is fixed. The product is an evidence presentation system, not a generated buyer journey; synthetic takeaways, recommendations, rankings, aggregates, or newly inferred facts misrepresent what the product can provide.

**How to apply:** Improve hierarchy, navigation, disclosure, filtering, comparison, and mobile readability using existing fields. Keep the quadrant’s score mapping and vendor coordinates intact. Vendor Evaluation must lead from the graph into a comparison of at least two vendor products. Product and Ecosystem Evaluation must compare exactly two products. Commentary is typically 100–250 words, so never expand it inside score rows; every criterion or feature score needs a View notes action opening a scrollable popup with vendor, product, subject, score/support level, and full stored commentary. Show explicit unavailable states when stored data is absent.