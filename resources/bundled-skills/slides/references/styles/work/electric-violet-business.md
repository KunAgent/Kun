# Electric Violet Business · WORK REPORT STYLE DESIGN SYSTEM

## PART A — Category Baseline (Universal Floor)

A conclusion-first business review benchmarked against top-tier operating reviews and project progress briefings. Every slide in this deck must be scannable within 30 seconds, and every figure must withstand drill-down questioning: status is backed by evidence, variances are attributed, and requests are stated explicitly.

Content and layout:
1. Executive structure: conclusion overview (a one-slide performance verdict) → core metrics vs targets → revenue/mix analysis → variance attribution → project status (red/amber/green) → cost and efficiency → next-period actions → decisions and support required.
2. Status visualization is a signature: red/amber/green indicators, target vs actual tables, progress bars with numeric labels, variance waterfalls, and milestone timelines.
3. Medium-to-high density with strict grid discipline: pages are built from aligned status modules and tables; zero decoration; every module answers “So what?” in place.

Visual style:
1. Aesthetic: crisp, corporate, and utilitarian; the reader should be able to audit the entire period from the pages alone.
2. Typography: use one sans-serif family throughout; establish hierarchy through weight and size, never decorative type; always align numbers in columns, and never set numbers in serif display type.
3. Color: use a neutral structural palette (dark slate/graphite + gray). Reserve status colors strictly for meaning—green/amber/red communicate status only. Use one accent color (as defined by the style) for emphasis and current-period highlights; never use status colors decoratively.
4. Graphics: use simple charts (bar comparisons, line trends, variance waterfalls); use fine rules in tables and right-align numbers; no 3D, no pictograms as data, and no gradient fills.

Structure and discipline (distilled from work we recognize as best-in-class):
1. The first slide is always the verdict: one sentence on overall attainment + target vs actual values for 3–5 headline metrics; never pad the deck with a generic cover.
2. Every metric must show target, actual, and attainment rate together; a metric with an actual but no target is a defect.
3. Variance slides must provide quantitative attribution: break the gap into named causes whose amounts sum to the total gap; no unexplained remainder is allowed.
4. Project status requires a complete triad: status indicator + evidence (progress %, milestone) + corrective action (with owner and date); a red item without a recovery plan is a defect.
5. Next-period actions are commitments, not wishes: each must include an owner, timing, and expected quantified impact.
6. Trend slides must mark the reporting-period boundary and annotate the causes of inflection points within the chart; render forecast segments with dashed lines and label them as planned/estimated.
7. Align parallel modules rigorously to the grid: modules in the same row share height and baseline; group mixed content by meaning rather than scattering it.
8. Every number must include its unit, period, and definition (GMV or revenue, order volume or sales value); label estimated values as internally defined examples.
9. The deck must end with items requiring management decisions and support—list each separately with the consequence of delay; never close with a thank-you slide.

Default baseline (distilled from the layout skill; PART B may override): use one consistent lightweight component system throughout for progress, attainment rates, and red/amber/green status; each slide contains 1 topic + 2–4 supporting points, with the conclusion graspable within 5 seconds; every metric must be paired with a “So what?”—cause, impact, or next action—rather than presented as a bare number.

**Title read-through test**: reading only the slide titles should tell the complete story; if they do not read coherently in sequence, the structure has not been established.

Density anchor: the specific floor for each style (evidence modules per slide, chart count, and annotation conventions) is defined by the 【Density Baseline】 reverse-engineered from that style’s source deck—the baseline here imposes no universal number.

### Global Prohibitions (Default AI Patterns · Mandatory)

1. **No default card-based layouts**: unless explicitly requested by the user, do not use rounded rectangles or rectangular cards to create hierarchy or alignment—functional containers (status indicators, assumption boxes, quote frames) are not cards. Lines, whitespace, and differences in type size and weight are preferred.
2. **No equal-split compositions**: unless no other layout is viable, do not default to three equal columns, four equal columns, or a two-by-two matrix—equal division must be justified by the content structure (three scenarios naturally support three columns; frameworks explicitly named in the brief are exempt).
3. **No arbitrary AI color palettes**: institution-specific palettes stated in the body are exempt. Prohibited treatments are generic, familiar, and unjustified defaults—blue-purple gradients, cyan-purple neon, rainbow glows, glass cards, and glowing borders.
4. **No elements that conflict with the overall style**: do not introduce out-of-style treatments, such as rounded icons or rounded rectangles in a sharp-edged visual system.
5. **Keep chart backgrounds transparent**: use transparency or the slide background color, except for reversed charts on dark backgrounds.
6. **No unfilled regions**: do not leave large blank areas in the body content zone; every planned region must be filled with real content. Failure to fill a region is the most serious form of roughness.

## PART B — Signature System (Template-Specific Signatures; Overrides PART A in Case of Conflict)

One-line style signature: editorial corporate documentary, using a single Electric Violet focal accent on white/near-black backgrounds, alternating large authentic photographs with medium-to-high-density data slides.

【Color Palette】
Background: #FFFFFF for body slides; #121212 only for the cover/image-led openers, and #000000 only for the closing slide. Primary text and headings on white: #121212; headings on dark backgrounds: #FFFFFF. Primary accent: #5114F6, used for section backgrounds, key figures, bars/strips/bubbles, and fine outlines—not as decorative blocks in body content. Supporting colors: #9E9E9E only for secondary annotations; #CCCCCC only for gridlines. Charts: #5114F6 for the primary series, #9E9E9E for the baseline, and #000000 occasionally for a priority star marker. Positive/negative colors inherit PART A; the source deck provides no stable hex values. Apart from neutrals, allow only one hue per slide. Full-bleed Electric Violet is reserved for section slides; it may occupy approximately 44%–56% of a body slide only when the content has a genuine binary relationship.

【Layout Skeleton】
Source canvas: 10×5.625 inches, 16:9. Standard slides have no full-width header; primary content begins at approximately 12% from the left, ends at 94.5% on the right, starts 10%–20% from the top, and leaves an approximately 10% footer band at the bottom. The footer has no divider: place one short category/period label at bottom left and one page number at bottom right. The stable grid uses a 44/56 image-text split, a 38/62 information split, or a three-column narrative; the default reading path is judgment on the left → evidence on the right. Cover only: near-black upper 49% and photograph lower 51%, with the title left-aligned on the black field. Section slide only: full-bleed #5114F6, with “two-digit index—section title” positioned around 12% from the left and 34% from the top.

【Typography】
The source PPTX explicitly uses Tahoma as the primary typeface, a neutral sans serif; Roboto appears sparingly in a few section titles/table labels and must not be elevated to primary status. Body text 1x=7pt; standard titles approximately 3.1x=22pt; section titles approximately 3.7x=26pt; covers occasionally use 5.1x=36pt; large figures approximately 2.4–3.7x=17–26pt; footnotes approximately 0.86–0.93x=6–6.5pt. Titles, KPI figures, and section bands use bold; body copy stays regular, with hierarchy built through weight, scale, and space. Use sentence case for titles; section numbers always use a two-digit index followed by an em dash; large figures may be followed immediately by “+” or a unit. For new non-English content, retain a comparable sans serif and the same scale ratios; render with QuattrocentoSans (Latin text/numerals) and MiSans (Chinese).

【Chart Language】
The source deck uses single-series vertical bars, horizontal progress/comparison bars, dot-matrix ratings, number bubbles, bubble matrices, and tables; maps and radial charts appear only occasionally. ⭐Dot-matrix rating: in a row of outlined Electric Violet circles, fill only one circle and place the value at the end of the row; use for a 10-point scale or stage position. ⭐Progress bar: fine Electric Violet outline, solid fill from the left, with the percentage right-aligned inside the frame. ⭐Number bubble: equal-size solid circles as numeric containers; never use area to imply quantity; no more than 4 within one group. ⭐Vertical bar chart: use #5114F6 for every bar with fine light-gray gridlines; do not recolor individual bars; use a #000000 star only occasionally for a small number of focus items. ⭐Bubble matrix, occasional use only: a 44/56 split between an Electric Violet index area on the left and a white coordinate area on the right.

【Signature Components】
1. Section index title: use “NN—” to establish rhythm; appears only on full-bleed Electric Violet section slides, once per slide.
2. Near-black statement field + photograph: the left approximately 44% contains one large statement only; the right approximately 56% is a full-height photograph with no additional body copy overlaid.
3. Photography is a hard requirement: approximately half of the slides use documentary photographs of people/work environments, cropped large with square corners and separated from text; never substitute abstract illustrations, colorful icons, or blurred imagery. If no suitable photograph is available, use a pure-white data slide instead.
4. Fine footer: information label at bottom left, page number at bottom right, with no color block or horizontal rule; one footer set on every body slide.

【Prohibited】
Do not use a second decorative accent color or multicolored series; charts may introduce PART A status colors only when genuine status semantics exist. Do not place text over photographic texture; do not replace large documentary images with circular headshots, color-tinted photographs, or abstract illustrations. Do not use heavy black, all caps, or decorative type to establish title hierarchy. Do not fill half a slide with Electric Violet unless the content has a clear binary structure; standard data slides retain only lines, bars, figures, and circular accents.

【Slide Types and Layouts】
Image-text narrative slide｜Best for one conclusion plus context/testimony｜Photograph 44%–56% or 28% sidebar, with 1–3 text blocks in the remaining area｜2–4 blocks｜Large documentary image + fine footer｜Not suitable for comparing many metrics.
Data overview slide｜Best for parallel outcomes/composition｜Title area approximately 20% on the left, two data columns approximately 65% across the center and right｜4–8 blocks｜Large figures, dot matrices, progress bars, bubbles｜Not suitable for long causal chains.
Chart evidence slide｜Best for grouped comparisons addressing one question｜Conclusion and annotations in the upper/left 20%–35%, one primary chart in the lower right 55%–65%｜2–3 blocks｜Single-violet series + priority star marker｜Not suitable for a multi-topic collage.
Multi-case gallery slide｜Best for 2–3 parallel cases｜Image above text in each column, with photographs occupying the upper half of the slide｜2 blocks per case｜Square-corner photographs + left-aligned titles｜Not suitable when the three items have unequal importance.
Black-field image opener｜Best for a section transition or single-sentence viewpoint｜Black field 44% + photograph 56%｜1 sentence + 1 image｜Large reversed title｜Not suitable for evidence or action lists.

【Density Baseline】
Long-form pages in the source deck typically contain 2–5 text blocks totaling approximately 900–1800 Latin characters. To preserve PART A scanability in a new business report, retain columns but compress the content to 2–3 blocks, each with an 80–160 words/characters equivalent. Image-text slides should use 1 large image + 1–3 explanatory blocks; data overview slides should contain 4–8 evidence modules; chart slides should contain 1 primary chart or 2–4 microcharts. Label progress bars, bubbles, and horizontal bars in place; vertical bars rely on the y-axis and should not label every bar, highlighting only 1–2 priorities. Keep whitespace at the left entry margin, between columns, and in the bottom footer band. Image-led openers and data slides should differ clearly in density; do not impose a hard deck-wide floor.
