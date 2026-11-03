# Black Gold Ledger · finance STYLE DESIGN SYSTEM

## PART A — finance Baseline (Universal Floor)

Institutional-grade investment research presentations, benchmarked against top-tier fund research reports, due diligence, and strategy outlooks. Chart-heavy, text on the dense side, more report than consulting: Excel-style financial model tables carry the argument; every number is traceable, every assumption made explicit, every conclusion executable.

Content and layout:
1. Thesis-driven structure: deal decks run "summary → highlights → target → financial diagnosis → valuation & returns → risk mitigation → decision ask"; research decks run "stance → evidence → scenarios → allocation advice". The ending must land on an explicit decision or stance.
2. Tables are the protagonist: valuation ranges, comparable companies, the three financial statements, scenario modeling, sensitivity grids — all under strict row/column discipline (assumption columns, driver rows, check rows); charts serve the numbers, never decorate.
3. High but ordered density: multi-column layouts with clear hierarchy; each page answers one investment-committee question; density comes from evidence modules, not walls of text.

Visual style: restrained, authoritative, compliance-clean; no lifestyle photography, decorative icons, or marketing superlatives. Serif is allowed for titles when gravitas is needed; table body text, chart labels, and all figures use sans-serif, with numbers column-aligned. A conservative institutional palette: deep structural colors plus one restrained accent, reserved for key figures and recommended actions; positive/negative semantic colors fixed, expressing financial meaning only. Fine table rules, precise vector chart lines; no 3D or shadows; gradients are not part of the standard chart language.

Structure and discipline: every body-page title must be a complete investment assertion, with a one-line subtitle stating scope and how to read it; every number must carry unit, as-of date, and measurement basis — estimates must be flagged, no bare numbers; returns are given only as scenario ranges (bear/base/bull, with probabilities or assumptions), never a single-point IRR, and every valuation conclusion ships with a sensitivity table; assumptions are boxed and made explicit, placed on the page whose conclusion depends on them; risks and mitigations appear in pairs (risk → probability/impact → mitigation → owner); every valuation page must have an anchor (comparable companies, precedent transactions, or DCF cross-check); parallel evidence runs in 2–3 equal-width columns, numbered arguments carrying one bolded claim line plus one proving sentence; chart labels sit on the marks, forecast segments use dashed lines, key drivers are named inside the chart — never rely on the legend alone; the deck closes on a decision or stance, with next actions and a timeline — never end on a thank-you page.

Default baseline (PART B may override): key metrics are set in a size larger than body text, adjacent to their units and basis; at least one class of high-density financial table is kept, with right-aligned numbers, thousands separators, and a unified negative-number convention; positive/negative semantic colors fixed across the deck; forecast vs. historical visually distinguishable and labeled by basis; each page carries source, basis, and time range in small gray footer text; a single temperament per deck — choose one. Headline read-through test: reading only the page titles across the deck should tell the complete story. Density anchor: per-page minimums for evidence modules and charts follow the PART B density baseline.

Global prohibitions (mandatory): no default cards (information containers such as status lights, assumption boxes, and verdict bands do not count as cards); no unearned even splits (three/four-way splits and 2×2 grids must be justified by content); no unmotivated AI color schemes (blue-purple gradients, cyan-purple neon, glass cards, glowing borders); no elements that clash with the overall style; chart backgrounds transparent or same as the page background (except reversed-out on dark); no large empty blocks in the body area — planned regions must be filled with real content.

## PART B — Signature System

One-line style signature: financial-periodical order in black, white, and gray — white evidence pages carry verifiable numbers via axis-free charts and hairline tables, dark pages hold only judgments and decisions, a single gold anchors current values and key thresholds, and no stray hues appear anywhere in the deck.

【Color Palette】
All values below are approximations sampled from the reference images; a single gold anchor, grayscale steps carrying data, and two background depths with distinct duties.
- White background #FFFFFF (approx.): about 3/4 of pages, carrying verifiable data and detail.
- Dark background #151515 (approx.): charcoal, not pure black; used only for summary and closing-action pages, about 1/4.
- Ink black #0A0A0A (approx.): titles on white pages, top rule, line series, black full-width bands, and the strongest text.
- Warm dark gray #3D3C3A (approx.): body text, primary-series bars, key in-table figures.
- Secondary gray #606060 (approx.): subtitle basis line, chart captions, units.
- Supporting gray #A7A7A7 (approx.): secondary series, column labels, auxiliary text on dark.
- Footnote gray #B6B6B6 (approx.): sources, page numbers, and other weakest-tier information.
- Light gray #D6D6D6 (approx.): historical/background series, table hairlines, caption text on dark.
- Panel gray #F0F0F0 (approx.): watermark-sized type, conclusion bands, light reversed cards on dark.
- Track gray #F3F3F3 (approx.): pale track beds for progress and composition bars.
- Primary gold #D6A000 (approx.): the single strong accent anchor — KPI big numbers, current endpoints, threshold capsules, the short gold cover line, key horizontal bars; under 3% of any single page's area, one gold focus per page, no light/dark double gold.
- Copper brown #A86038 (approx.): the only auxiliary semantic color, reserved for exit/risk-related amounts, low frequency.
- Structural lines: on white pages #0A0A0A (approx.) sets page-level boundaries, #D6D6D6 / #E9E9E9 (approx.) separate rows and modules; on dark pages the divider is #302F2D (approx.).
- No red/green up-down system (overrides the PART A baseline): gold marks current and key values, copper brown marks exits/risk, and all other data recedes into neutral gray steps.

【Layout Skeleton】
Source facts: 16:9 canvas (source images 1467×825 px, generated at 960×540 pt); left/right margins about 5.5% of canvas width (~52 pt), content span about 89%. The grid resolves to 12 columns, combined per content into thirds, roughly 2:1, roughly 1:1, or five-column tables, overall asymmetric; no logo, no breadcrumbs — the English masthead on the cover carries the publication identity.
- White analysis pages: thin black top rule (about 5% from the top) → conclusory title → gray basis subtitle → light-gray divider → body (starting around 1/5 of page height) → footer with basis/source at left and "n / N" page number at right.
- Dark pages: letterspaced small English label → white conclusory title → one to two lines of explanation → numbered judgments or full-width light cards → bottom judgment/decision line.
- Cover/closing: masthead and date at top left and right → short gold line → two-line large title → abstract → KPI big-number row → oversized watermark at right → black basis band across the bottom.
- Reading path: title assertion → main chart/evidence area → explanation column or KPIs → bottom judgment and basis line; the gold focus closes the attention loop last.

【Typography】
Modern sans-serif for both CJK and Latin (Source Han Sans temperament). Title weight 700–800, section titles 600–700, body 400, footnotes lighter. Taking body text as 1x: standard page titles about 2.1–2.4x, cover title about 3x, KPI big numbers about 2.8–3.5x, chart labels about 0.8–0.9x, footnotes about 0.7x (reference at 960×540: body 9–10 pt, page titles 21 pt, cover 36 pt). Big numbers share the line with their units, units shrunk to 50%–70%, basis on the next line; numbers bolded, tight against sign and unit. Small English labels in all caps, light weight, tracking 0.20–0.28em — a financial-periodical header signature, used only on the cover and dark pages.

【Chart Language】
- ⭐ Bar–line combo (amount bars + count line): historical bars light gray, current-period bars dark charcoal, the line in ink black; bar values on top, point values above nodes; key changes called out with gold capsules.
- ⭐ Full-width time-series line: ink-black ~2 pt line with circular nodes, the current endpoint enlarged and switched to gold; only a ~1 px baseline remains — no y-axis, grid, or frame.
- ⭐ Horizontal bar groups (ranking/comparison): dark charcoal for the focus item, mid/light grays for the rest and for history; a key series may run entirely in gold; values labeled directly at bar ends, multiple bar groups sharing row baselines.
- ⭐ Grayscale composition bar (100% segments): dark → mid → light segments, reversed-white percentages inside, name and amount annotated in two lines below.
- Dot plot (aligned comparison, low frequency): shares row baselines with horizontal bars; focus-row dots in gold or dark charcoal.
- Step bars (staged progression, select cases): light → mid → dark progression, expected range values flagged in gold.
- In-table progress bars: dark charcoal bars on pale gray tracks embedded in vertical-line-free tables, expressing structural share.
- KPI big-number column: right-hand vertical rail or horizontal row on the cover; gold goes only to the one or two most critical numbers.
- Universal discipline: all data labels placed directly (bar tops / bar ends / beside nodes), never legend-dependent; tables are ruled primarily by horizontal lines — no zebra striping, no dense vertical lines; chart backgrounds match the page.

【Signature Components】
- Thin black top rule: fixed header fixture of white analysis pages, ~2 pt full width, the identity line of evidence pages.
- Short thick gold line: about 46×4 pt, set above the cover/closing main title, one per special page only.
- Letterspaced small English label (eyebrow): all caps, tracking 0.20–0.28em, reserved for the cover masthead and dark-page headers.
- Gold capsule: fully rounded gold chip with ink text, carrying only key changes, time cross-sections, or trigger thresholds — at most one per page.
- Right-hand KPI rail: a vertical line sets it off from the main area, big numbers alternating with gray captions; gold/white on dark pages, gold/ink on white pages.
- Oversized light-gray watermark type: panel gray, more than ten times body size, holding a year or institution initials at the right of cover/closing pages, low frequency.
- Bottom black basis band: full-width black bar at the foot of special white pages, small white text carrying fund information and risk disclosures.
- Light-gray verdict band: full-width panel-gray strip at the foot of white pages, closing the page with one bolded judgment.
- Large light-gray numerals: dark key-point pages only, numbered from 01, paired with bolded white assertions.
- Footer "basis + page number" pair: small gray basis/source at left, n / N at right — present on every page of the deck; legends use small squares only, data points small circles only, never decorative.

【Prohibited】
- No colored chart series or second accent: apart from gold (and low-frequency copper brown), all data series run in gray steps.
- No red/green up-down pairs: positive/negative semantics are not carried by red and green (overrides the PART A baseline).
- No pies, donuts, radars, stacked areas, 3D, shadows, gradients, glows, or default Office chart styles.
- No y-axes, gridlines, or chart frames — axes keep only the baseline; no chart that can only be read via its legend.
- No complex data grids on dark pages: dark pages carry only stage judgments, executive summaries, and decision asks.
- No sprinkling dark backgrounds across analysis pages: dark pages are about 1/4, fixed at the summary and closing-action pages.
- No photos, illustrations, colored icons, large textures, or logo dependence.
- No rounded-card walls or evenly split card grids: the light full-width card exists only as the dark action-page form.
- No centered layouts or symmetric display titles: everything left-aligned, asymmetric columns.
- No large-area gold fills or full pages of gold type (<3% per page, one focus per page).

【Slide Types and Layouts】
Cover snapshot | the deck's single white front page | left ~58% holds the masthead, short gold line, two-line large title, two-line abstract, and three KPIs; oversized watermark at right; black basis band at bottom | ~6 information blocks, the most whitespace in the deck | not suited to detailed data.
Dark key-points page | executive summary or next-quarter action list | small label + white conclusory title + caption line; left ~2/3 numbered judgments, right ~1/3 KPI rail; or three full-width light cards organized as "observation — gold-capsule threshold — trigger action" | 3 judgments + 3–4 KPIs, or 3 threshold cards plus default actions | full-width overall judgment / decision ask at bottom | not suited to complex charts and grids.
Trend data page | time series of totals, revenue, etc. | one main chart in the upper half (bar–line combo or full-width line), lower half in three equal explanation columns or a dual module of "composition bar + step bars" | 1 main chart + 2–4 explanation blocks | gold marks only the current bar, current endpoint, and key capsules | not suited to parallel multi-topic content.
Table matrix page | segment/portfolio breakdown | five-column, four-row vertical-line-free table: name, amount big number, embedded progress bar, representative items, through-line; light-gray hairlines between rows, ink line before the last row, total row + meaning row at bottom | highest density in the deck (~20 information units), noise-reduced via generous row height and gray steps | not suited to long-form narrative.
Comparison ranking page | region/project/approach comparison | horizontal bar groups occupy the left ~2/3, a KPI quick view or dot plot the right 1/3, sharing row baselines; two same-scale bar groups may sit side by side below, closed by a light-gray verdict band | 3–5 bar rows + ~3 KPIs | dual emphasis in gold or dark charcoal goes only to the leader | not suited to time-series narrative.

【Density Baseline】
Body pages carry 3–7 information blocks; the standard combination is "one main chart + 2–4 explanation or KPI blocks"; text blocks run 1–2 lines, roughly 20–55 words/characters equivalent, footnotes a single line. Charts directly label 3–8 data points — small samples fully labeled, long series labeled only at first/last and key points; table pages allow ~20 information units, noise-reduced with generous row height, hairlines, and gray steps. Whitespace concentrates in chart backgrounds, inter-column gutters, and the title-to-body transition band — never spread evenly. Dark pages carry fewer blocks, building authority through reversed contrast rather than volume. One gold focus per page; dark pages ~1/4 of the deck; the deck-wide rhythm is "white cover — dark summary — a run of white evidence — dark action close".
