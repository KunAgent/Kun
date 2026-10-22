# Rice Paper Annual · Finance STYLE DESIGN SYSTEM

## PART A — Category Baseline (universal floor)

Institutional-grade investment research presentations, benchmarked against top-tier fund research reports, due diligence, and strategy outlooks (bulge-bracket bank and sovereign wealth fund standards). Chart-heavy, text-dense, more report-like than consulting decks: arguments are carried by Excel-style financial model tables (three-statement models, scenario analyses, sensitivity grids). Every number traceable, every assumption explicit, every conclusion actionable.

Content and layout:
1. Thesis-driven structure: deal decks run "Summary → Investment highlights → Target/Market → Business plan/Financial diagnostics → Valuation and returns → Risks and mitigants → Decision request"; research outlooks run "Core stance → Evidence → Scenario analysis → Allocation recommendation". The ending must land on an explicit decision or stance.
2. Tables are the protagonist: valuation ranges, comparable companies, three financial statements, scenario analyses, sensitivity grids, with Excel financial-model row/column discipline (assumption columns, driver rows, and check rows clearly distinguished); charts serve the numbers (football-field valuation charts, IRR bridges, waterfall attributions, scenario fan charts) and are never decorative.
3. High but ordered density: multi-column layouts with clear information hierarchy; each page answers one investment-committee question; density comes from evidence modules, not walls of text.

Visual style:
1. Aesthetic: restrained, authoritative, compliance-clean. No lifestyle photography, no decorative icons, no marketing superlatives.
2. Typography: use serif for titles when institutional gravitas is needed; sans serif for table body text, chart labels, and all numerals; numbers are always column-aligned.
3. Color: a conservative institutional palette — navy/charcoal structural colors, one restrained accent (e.g., gold or signal blue) reserved for key figures and recommended actions; positive/negative signs use one consistent red-green pair, expressing financial meaning only.
4. Graphics: thin table rules, precise vector chart lines, fine connector lines on bridge charts; no 3D, no shadows, and gradient fills are not a routine chart language.

Structure and discipline (distilled from the artifacts we consider benchmarks):
1. Every body-page title must be a complete investment assertion (e.g., "This asset will reprice on capacity scarcity" — not "Market overview"), with a one-line subtitle stating scope and how to read the page.
2. Every number carries unit, as-of date, and basis; estimates must be labeled (illustrative / internal estimate); no bare numbers.
3. Returns are given only as scenario ranges (bear/base/bull, with probabilities or driving assumptions) — never a single-point IRR; any valuation conclusion must be paired with a sensitivity table.
4. Assumptions must be made explicit in boxes, placed on the page where the conclusion depends on them; hidden assumptions are treated as defects.
5. Risks and mitigants appear in pairs (risk → probability/impact → mitigant → owner/status); a page with risks but no mitigants is a defect.
6. Valuation pages must be anchored: comparable companies, precedent transactions, or a DCF cross-check — a multiple without a reference set is not evidence.
7. Parallel evidence runs in 2–3 equal-width columns; numbered arguments each carry a one-line bolded claim plus one short proof sentence.
8. Chart annotation discipline: data labels attached to marks, bridge-chart connector blocks labeled block by block, forecast segments dashed, key drivers named inside the chart; charts may not rely on legends alone.
9. The ending must land on a decision or stance: items submitted for decision (approve / reject / conditionally approve) or an explicit allocation stance (overweight / underweight / range), with a to-do list and timeline — never close with a thank-you page.

Default baseline (distilled from the layout skill; PART B may override): numbers first — key metrics (amounts / growth rates / multiples) must be set larger than body text and presented standalone, immediately adjacent to unit and basis; keep at least one class of high-density financial table (three statements / comps / sensitivity), with right-aligned numbers, thousands separators, and negative-number conventions unified deck-wide; positive/negative semantic colors fixed — up/positive and down/negative each use one fixed color that never changes across the deck; forecast and history must be visually distinguishable (dashes / light tints / hatched bands) and labeled with the basis; every page carries source, basis, and time range in small gray type at the page bottom — numbers without sources are not allowed in the main visual area; a single temperament per deck (dark navy/charcoal with metallic accents OR traditional white ground with blue-gray) — pick one per deck.

**Title read-through test**: reading only the page titles across the deck should tell the complete story; if the titles do not read through, the structure has not been established.

Density anchor: each style's specific floor (evidence modules per page, chart count, annotation habits) follows the 【Density Baseline】 reverse-engineered from that style's source material — this baseline imposes no uniform numbers.

### Global Prohibitions (AI default routines · mandatory)

1. **No default cards**: unless the user explicitly requests it, never use rounded rectangles or rectangular cards to build hierarchy or alignment — containers that serve an information function (status lights, assumption boxes, quote frames) do not count as cards. Rules, whitespace, and differences in type size and weight are the better tools.
2. **No evenly split compositions**: unless no other layout is truly available, do not default to three-way splits, four-way splits, or 2×2 matrices — even splits must be justified by content structure (three scenarios naturally take three columns; frameworks explicitly named by the content are exempt).
3. **No unjustified AI color schemes**: institutional palettes specified in the content are exempt; what is banned are bland, common, unjustified default colors — blue-purple gradients, cyan-purple neon, rainbow flares, glass cards, glowing borders.
4. **No elements that clash with the overall style**: nothing outside the style system may appear — for example, rounded icons or rounded rectangles in a sharp style.
5. **Transparent chart backgrounds**: transparent or the page background color, except reverse-white treatments on dark grounds.
6. **No regional blank space**: the body content area keeps no swaths of blank space; any planned region must be filled with real content — failing to fill it is the most severe form of sloppiness.

## PART B — Signature System (this template's signature; where it conflicts with PART A, this section governs)

One-line style signature: a report-serious chassis overlaid with magazine-style highlight notes — warm paper white, ultra-bold black type, per-section color rotation, evidence dense but orderly.

【Color Palette】 Background #F2EFE6; primary text/titles #000000; section accents rotate through orange #F9961F, pink peach #FFC1A8, bright green #08BC51, purple #D772FF, indigo #4C36FD — used only for highlights, key numbers, and a few series; section background colors #05225A/#4C1431/#05201B/#A4C9FF, special pages only; series colors #0B1636/#1058E2/#A4C9FF/#F6A031/#08BC51/#7421F7, fixed as solid fills; positive/negative inherit PART A. Body pages: 1 primary accent + ≤3 series per page; accents never blanket the page.

【Layout Skeleton】 Source facts: 960×540, 16:9; roughly 40 pages carry a "color square + short label" at upper-left; titles are 1–2 line left-aligned assertions, with keywords set off by trailing rectangular highlights. Default: left 30–35% conclusion, right 65–70% main chart; complex pages use dual charts, chart + table, or three columns. Chart titles often carry a thin black horizontal rule; source/basis/time are pressed to the bottom; reading path: upper-left → main chart → footer. The cover and 9 section pages are solid dark or light blue, with a giant title at lower-left and a stepped stack of blocks + oversized numeral at upper-right — special pages only.

【Typography】 Sans serif, family unverifiable; wide-set heavy letterforms, regular body, heavy titles, a little italic. Render: titles and giant numerals in Archivo Black (via customFonts) or MiSans Bold; body in {latin: Liter, ea: MiSans}. Body 1x, subheads 1.2–1.4x, assertions 2.2–2.8x, giant numerals 7–10x, footnotes 0.6–0.7x. Sections often in all caps; numbers carry units/thousands separators; highlighted phrases may share the same frame.

【Chart Language】 Types: line charts, columns/stacked columns, stacked areas, horizontal bars, dual axes, bubbles, donuts, matrix tables, timelines. ⭐ Stacked charts use fixed solid colors with small legend swatches; ⭐ tables have dark full-row headers, with key rows fully saturated end to end; ⭐ dual axes pair light-tint columns/areas with a thin line; ⭐ common-baseline bubble comparisons (occasional) write values inside the bubbles; timelines run a horizontal axis with nodes alternating above and below (occasional).

【Signature Components】 Title highlight blocks: 1–3 per page, may span lines without covering text. Section labels: once, at upper-left. Conclusion bubbles / number boxes: inside or beside charts, ≤2 per page, holding a single conclusion/number only. Stepped stacked blocks + giant numerals for section pages only; orange arrow capsules docked to chart titles, occasional.

【Prohibited】 Body pages: no full dark/high-saturation grounds, no centered big titles, no sinking section stacked blocks into body pages; no gradients/glows/thick shadows; rounded corners only for conclusion boxes or functional entries; use photos, complex illustrations, and large screenshots cautiously.

【Slide Types and Layouts】 Conclusion + main chart ｜ single primary evidence ｜ left 30–35% / right 65–70% ｜ 1 chart + 1–3 annotations ｜ highlights/number boxes ｜ not suited to multi-evidence. Full-width assertion + dual charts/table ｜ cross-validating comparisons ｜ two columns below ｜ 2–4 blocks ｜ highlights/solid table headers ｜ not suited to a single conclusion. Three-column evidence ｜ parallel facts ｜ three columns ｜ 3–9 short blocks ｜ labels/highlights ｜ not suited to long narrative. Timeline / process ｜ sequential relations ｜ horizontal axis with alternating nodes ｜ 8–12 nodes ｜ colored dots and dashes ｜ occasional use.

【Density Baseline】 Default: 1 assertion + 1 main chart + 1–3 annotation boxes; explanations in 1–3 blocks of 20–60 words/characters equivalent each, with whitespace in the left column, above the title, and around charts. Dual-chart/table pages: 2 charts or 1 chart + 1 table, 2–4 blocks, labeling only key column points; three-column pages: 2–4 short facts per column. Timelines may be dense but the axis keeps whitespace; source/basis are fixed at the bottom — never fill space with decoration.
