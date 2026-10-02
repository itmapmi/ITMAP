---
name: Markets fixed-data UI boundary
description: Defines the non-negotiable data boundary for redesigning Markets experiences.
---

Markets pages may visually reorganize only the stored quadrant, persisted criteria weights, vendor criterion scores/commentary, product and ecosystem support levels/commentary, Vendor Intelligence records, and Reports.

**Why:** The backend data model is fixed. The product is an evidence presentation system, not a generated buyer journey; synthetic takeaways, recommendations, rankings, aggregates, or newly inferred facts misrepresent what the product can provide.

**How to apply:** Improve hierarchy, navigation, disclosure, filtering, comparison, and mobile readability using existing fields. Keep the quadrant’s score mapping and vendor coordinates intact. Vendor Evaluation must lead from the graph into a comparison of at least two vendor products. Product and Ecosystem Evaluation must compare exactly two products. Every criterion or feature score needs access to full stored commentary, with vendor, product, subject, and score/support level. Mobile commentary and product/ecosystem commentary use scrollable popups. Desktop Vendor Map commentary is the explicit exception: View notes expands a collapsible section directly below its criterion within the comparison card, not a popup. Show explicit unavailable states when stored data is absent.

**Why desktop Vendor Map is different:** The user explicitly requested restoring the earlier inline, collapsible commentary presentation on desktop while leaving mobile popup behavior unchanged.

**Mobile notes popup consistency:** Every mobile comparison notes popup uses the same visible “Close Notes” action.

**Why:** The user requested identical closing controls across Compare, Interop, and Vendor Map.

**How to apply:** Preserve the shared footer action and translated label when changing mobile notes popups; desktop Vendor Map remains inline and collapsible.

**Market entry priority:** Keep technical product comparison as the initial tab, with feature rankings and ecosystem support before vendor comparison. The quadrant is shared context above all tabs; criteria weights are shown only when Vendor Map is selected.

**Why:** Campaign visitors who click Compare Products expect feature-by-feature evidence by default. The user subsequently requested a consistent quadrant across every tab on both desktop and mobile.

**How to apply:** On mobile, start with the quadrant; its market-name heading expands the stored definition, with an arrow-only Back link in a small blue box at the top right. Do not duplicate the market title or definition above the chart. On desktop, put Read full definition beside the market title and hide all definition text until expanded. Center the standalone quadrant; selecting Vendor Map shows automatically expanded Criteria Weights beside it. Keep the chart width stable while repositioning it. Hide Criteria Weights outside Vendor Map on both desktop and mobile; mobile weights remain collapsed by default. Vendor Map contains the vendor comparison experience without a duplicate graphic. Preserve direct section links. The user explicitly requested placement changes without changes to the graphic's drawing or positioning logic.

**Desktop weights compactness:** Omit the introductory explanation and place the controls directly beneath Criteria Weights. Compact the weight rows so the complete panel fits without an internal scrollbar.

**Why:** The user explicitly requested removing the explanation, moving the weights up, and reducing their size to fit without a scrollbar, overriding the earlier scrollable-panel approach.

**How to apply:** Preserve every criterion, its percentage, slider interaction, and reset-to-published action. Keep mobile weights unchanged and avoid making the desktop panel taller than the chart.

**Market heading source of truth:** The mobile graphic heading, desktop heading above the graphic, and exported graphic title use the exact market name stored in Admin → Markets. Do not repeat the market name inside the desktop graphic card.

**Why:** The user requested identical wording to the admin market name, overriding the earlier mobile “IT Map for” prefix and display-name transformations. They subsequently requested removing the duplicate desktop chart title while retaining it in exports.

**How to apply:** Preserve the saved name verbatim for these headings, including any prefix already in the saved name. Do not add or strip prefixes or substitute a localized name; keep definition text localization and existing URLs unchanged.

**Desktop first-view compactness:** Restore the graph's original full desktop size, adapting down only when necessary to keep the chart and section tabs visible on initial entry, including when account banners appear.

**Why:** The user reversed the 75% reduction, requesting 100% again while retaining all other compact-layout changes and ensuring the page still fits.

**How to apply:** Prefer the original full-size desktop canvas; fit its container to available viewport height only when needed, accounting for headers, controls, and the tab list. Do not shrink label fonts or change drawing/scoring algorithms. Preserve mobile layout, stored definitions, timeline controls, and market titles in exports.

**Explicit category-ranking exception:** The user requested a Feature rankings tab beside Compare Products. Ranking vendors by their existing product-feature support totals is allowed; it is a view of stored evidence, not a new inferred recommendation.

**Why:** The prior no-rankings rule prevented invented buyer takeaways, but would incorrectly exclude this directly requested presentation of the same category totals already shown in Compare Products.

**How to apply:** Place Feature rankings directly after Compare Products, before ecosystem support, in both tab layouts. Use only the product-capability feature partition and the shared support-level contribution mapping. Keep maximum equal to the number of features; sort scored vendors highest first, disclose missing support records instead of presenting unscored vendors as zero, and point readers to Compare Products commentary for rationale.

**Desktop heading consistency:** Use the approved Product Evaluation heading style for desktop section headings. Intelligence is intentionally excluded from this standardization.

**Why:** The user requested matching the other desktop tabs to the existing Product Evaluation, Support Matrix, and Methodology headings, while explicitly leaving Intelligence as is.

**How to apply:** Keep consistent light-gradient, icon, title, and subtitle formatting, but give each desktop tab its own distinct color theme. Do not change the distinct Intelligence presentation or the mobile headers.

**Desktop card consistency:** Vendor cards and feature-category containers should have curved corners matching Compare Products and Support Matrix, including selected and expanded states.

**Why:** The user requested consistent curved edges across the desktop tabs rather than square boundaries in Feature rankings and Vendor Map.

**How to apply:** Match the existing comparison-card corner treatment when adding or changing desktop vendor and category containers.