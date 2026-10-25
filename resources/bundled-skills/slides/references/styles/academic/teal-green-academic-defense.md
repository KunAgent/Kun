# Teal-Green Academic Defense · Academic STYLE DESIGN SYSTEM

## PART A — Category Baseline (Universal Minimum)

Create a rigorous, formally typeset academic presentation benchmarked against top-tier research talks and thesis defenses (at the level of the main programs of NeurIPS/CHI/SIGGRAPH), with clarity of argument taking precedence over decoration. The deck must read as a reproducible scientific argument, not as marketing collateral. Use academic language throughout: standard terminology for research questions, hypotheses, evidence, significance, contributions, and limitations, with no marketing language or corporate jargon. Shift the visual emphasis by discipline: theoretical work should devote substantial space to equations and proof steps; computer science and engineering should be structured around system diagrams, code, execution traces, and performance curves; experimental research should organize equations, charts, and images tightly around a single conclusion; humanities and social sciences should layer archival material, maps, manuscripts, and other textual evidence with narrative depth on top of academic rigor.

Content and layout:
1. Use a fixed argumentative structure: research question → gap in related work → data and methods → main results → ablation/analysis → limitations → future work. A short deck may compress this structure, but must not change the sequence.
2. Build evidence-first slides: result tables must include baseline comparison columns, comparative charts, and architecture/process diagrams; present core contributions as formally typeset equations.
3. Maintain medium information density: one claim per slide, with evidence organized around that claim. Slides should be composed, not filled—whitespace is a valid way to separate stages of the argument.

Visual style:
1. Aesthetic: restrained, precise, and scholarly. Do not use slogans, decorative photography, or clip-art icons.
2. Typography: use a clear sans serif (render with Liter / Chinese: MiSans) for body text and labels; headings may use a serif when the source style does; equations must be formally typeset (KaTeX quality), with standard equation numbering and italic variables.
3. Color: use a two-color system for each deck—one primary structural color and one accent color, with gray establishing hierarchy; use white or near-white backgrounds; use only one consistent warning color for negative findings or ablation signals.
4. Graphics: use thin, precise vector lines for diagrams; minimal horizontal rules for tables; axes, units, and sample definitions for charts; do not use 3D effects, shadows, or gradients as decoration.

Structure and discipline (distilled from work established as the benchmark):
1. Every content-slide title must state a claim (a finding, not a section label—“Attention Lapses Can Be Predicted 10 Seconds in Advance,” not “Experimental Results”), followed by evidence that supports the claim.
2. Align claims with evidence: every quantitative statement on a slide must be supported by a chart, table, or cited result on the same slide; orphan numbers are not allowed.
3. The main results table must include baseline comparison columns and identify the best value; show relative improvement alongside absolute values.
4. Method slides must include reproducibility details: dataset size, annotation protocol, inter-annotator agreement, and key hyperparameters. Show only the core idea as an equation; place derivations in appendix slides.
5. Every chart must be self-contained: include axis labels with units, a legend or direct labels, and sample size/confidence definitions in the caption area; a chart must not rely on its legend alone.
6. Ablation and limitations are mandatory slides, not optional ones: ablation isolates the contribution of each component; limitations candidly state scope of applicability, failure modes, and ethics/de-identification status.
7. Every number must include a unit, time range, dataset, and statistical definition (mean ± variance, sample size); express uncertainty through measurable quantities or confidence intervals, not vague wording.
8. Open with the problem statement and a one-sentence contribution; close with numbered conclusions (claims, not a summary) and an explicit list of open questions.
9. Place citations in a compact footnote line at the bottom of the slide where they are referenced; unless the format requires it, do not create a full slide densely packed with references.

Default baseline (distilled from the layout skill; PART B may override): organize each slide around one evidence unit (chart/table/equation); give charts complete axis labels, units, and sample definitions; represent data honestly, without truncating the y-axis to exaggerate differences; distinguish correlation from causation explicitly in the copy; ensure projection readability, with body text at ≥14 pt equivalent and chart labels at ≥10 pt equivalent on a 960×540 canvas.

**Title sequence test**: Read only the slide titles from beginning to end; they should tell the complete story. If the sequence is incoherent, the structure has not been established.

Density anchor: The specific minimum for each style (number of evidence modules and charts per slide, annotation conventions) is defined by the 【Density Baseline】 reverse-engineered from that style’s source deck—this baseline does not impose a universal number.

### Global Prohibitions (Default AI Patterns · Mandatory)

1. **Do not default to cards**: Unless explicitly requested by the user, do not use rounded rectangles or rectangular cards to establish hierarchy or alignment—containers with a clear information function (status indicators, hypothesis boxes, quotation frames) are not considered cards. Lines, whitespace, font-size differences, and weight differences are preferred.
2. **Do not use equal-part layouts by default**: Unless no other viable layout exists, do not default to three equal columns, four equal columns, or a two-by-two matrix—equal division must be justified by the content structure (three scenarios naturally support three columns; frameworks explicitly named in the content are exempt).
3. **Do not use ungrounded AI color schemes**: Institution-specific palettes defined in the content are exempt; what is prohibited is a bland, common, unjustified default palette—blue-purple gradients, cyan-purple neon, rainbow flares, glass cards, and glowing borders.
4. **Do not use elements that conflict with the overall style**: No out-of-style elements, such as rounded icons or rounded rectangles in an angular visual system.
5. **Keep chart backgrounds transparent**: Use transparency or the slide background color, except for reversed charts on dark backgrounds.
6. **Do not leave planned regions empty**: Do not leave an entire planned region of the content area blank; every planned region must contain real content. Failure to fill one is the most serious form of roughness.

## PART B — Signature System (Template-Specific Signature; This Section Prevails over PART A in Case of Conflict)

One-sentence style signature: Academic diagrams with black text on white, using teal green as the structural color, sky blue as the framework color, and yellow-orange as a single-point marker, balanced by medium-density whitespace.

【Color Palette】

Background #FFFFFF; use near-white #F7F7F4 only inside chapter-title frames. Primary text and headings #000000. Primary accent #009682 for square bullets, key connectors, checkmarks, and small labels, covering no more than 10% of any slide. Supporting colors: #68BCE0 only for goal banners/column headers, #939FB5 only for sidebars/inactive states, #868686 only for neutral lines, #70D6A6 for evidence labels, and #F4FAFD for goal-cell backgrounds. Focal marker #F0A81D may circle only one dimension or parameter. Chart series use #1F77B4, #FF7F0E, #2CA02C, #D62728, and #9467BD. Positive #009682; error/risk approximately #B51E00. Use 3–4 structural hues per slide; never flood a slide with an accent color.

【Layout Skeleton】

The source canvas is 483.874×272.126 pt, with a 1.778 (16:9) aspect ratio. On standard slides, place the title at the upper left, approximately 4% from the left and 12% from the top, in bold black; begin the body at approximately 26% of the slide height, using “left list + one chart/table/process diagram on the right,” with 38–45% for the left and 45–52% for the right. On process slides, center the main diagram horizontally; on chart slides, let one evidence object occupy the primary area. Standard slides include bottom navigation: section name + dot progress, with the current section bold black; on the next line, use a thin gray rule, page number/date/short title. Chapter slides contain only a centered rectangle with a thin teal-green outline and near-white interior, with no body copy. Title → key points → evidence → annotation.

【Typography】

The source deck’s primary typeface is the sans serif NimbusSanL-Regu/Bold (render with Liter / Chinese: MiSans); use mathematical/monospaced faces for equations and code (render with JetBrains Mono, via customFonts). Measured body text is 8.52 pt=1x, slide titles 13.63 pt≈1.60x, chapter titles 23.55 pt≈2.76x, footnotes/footers 5.68 pt≈0.67x; subsection bold text is 9.46 pt, banner text 11.36 pt. At 960×540, the proportional equivalents are approximately 17/27/47/11 pt. Slide titles commonly follow “Primary Class - Subclass”; use sentence case for body copy, uppercase for proper names/acronyms, and keep numbers, Greek letters, superscripts, subscripts, and equations aligned on the same line. Use bold or a word-level background highlight for emphasis.

【Chart Language】

The actual chart and diagram types include horizontal process diagrams, document/database pipelines, line charts, same-scale small multiples, horizontal bars, scatter plots + error bars, heatmaps, ablation tables, and comparison tables. Signature feature 1: Split the main visual into 2–6 same-scale panels with shared coordinates. Signature feature 2: Use top and bottom horizontal rules in tables, bold the best value, and place footnotes close to the bottom. Signature feature 3: Use thin black outlines, gray numbered bands, and one-way arrows in process diagrams. Signature feature 4: Direct-label series/key points within trend charts; retain axes, units, and sample definitions.

【Signature Components】

1. Document-to-output mapping diagram: folded-corner paper with black outlines, gray text lines, and sparse color highlights, with 1–3 light-gray curved lines connecting output icons; at most one set per slide. One purple-gray outlined callout bubble may explain a single piece of evidence.
2. Goal banner/matrix: a sky-blue rounded banner with a line-art diamond at the left; below it, add a gray baseline/gap band and four columns of pale-blue cells, with a blue-gray vertical sidebar and checkmarks/plus signs where needed. Use only for goals, stage checks, and completion status.
3. Evidence labels: thin-outlined teal-green rounded labels beneath the chart, with a document icon on the left and a short bold name/number on the right; at most two per slide.
4. Navigation footer: section names, dot progress, page number, and date; show the current section in black and the rest in light gray.
5. Bullets: use solid teal-green squares in different sizes for the first and second levels, with bold group headings; do not mix them with circles or checkmarks.

【Prohibited】

1. Do not use large teal-green/sky-blue backgrounds, gradients, shadows, or glass effects; sky blue is reserved for goal banners/column headers.
2. Do not use rounded cards without an information purpose, four-way card walls, or heavy borders; reserve rounded corners for the three functional component types.
3. Do not use solid-color chapter slides; chapter transitions must use a thin teal-green outlined rectangle, while content-slide titles remain at the upper left.
4. Do not omit the navigation footer from standard content slides; chapter covers, matrix openers, and acknowledgments are exceptions.
5. Do not place multiple high-saturation accent colors side by side; yellow marks only one focal point, red marks only errors/risks, and line art must not become skeuomorphic illustration.

【Slide Types and Layouts】

Narrative summary slide | problem/method/result highlights | 42% list on the left, 48% chart/screenshot on the right | 2–4 blocks | square bullets, document diagram | unsuitable for long tables.
Process method slide | reproducible processing pipeline | horizontal 3–6 nodes across the center, with a numbered band along the top edge | 1 main diagram + 3–6 nodes | gray numbered band, line art | unsuitable for stacking conclusions.
Results chart slide | trends, comparisons, ablations | one chart/table occupies 45–60%, with 2–3 interpretation points on the left | 1 primary evidence object | fixed series colors, best value in bold | unsuitable for a second large chart.
Goal matrix slide | multidimensional goals and stage acceptance | banner at approximately 10% across the top, four-column grid + left vertical sidebar | 4 columns, 4–5 status rows | sky-blue banner, blue-gray sidebar | unsuitable for free-form narrative.
Chapter transition slide | start of a new section | only a centered outlined title frame with generous whitespace on all sides | 1 title block | teal-green outlined rectangle | unsuitable for body evidence.

【Density Baseline】

A standard “list + visual” slide contains 2–4 blocks: 2–3 groups of key points on the left and 1 chart/table on the right; each group contains 2–4 bullets, each approximately 8–22 words/characters equivalent. A process slide contains 1 main flow, 3–6 nodes, and 0–1 callout. A chart slide typically contains 1 chart/table; same-scale small multiples contain 2–6 panels, with labels only on key bars/points. A matrix slide uses a fixed four-column grid, with 1–2 short statements or 1 status symbol per cell and no more than 5 rows. Explanatory blocks span 2–4 lines, each approximately 12–28 words/characters equivalent; place 1–2 lines of footnotes close to the chart or slide bottom. Preserve whitespace between the title and body, around the main visual on the right, and throughout chapter transition slides.
