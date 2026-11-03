# Blue-Line Courseware · Academic STYLE DESIGN SYSTEM

## PART A — Category Baseline (General Minimum)

A rigorous, formally typeset academic presentation benchmarked against top-tier research talks and thesis defenses (NeurIPS/CHI/SIGGRAPH main-conference standards), with clarity of argument taking precedence over decoration. The deck must read as a reproducible scientific claim, not as marketing collateral. Use academic language throughout: standard terminology for research questions, hypotheses, evidence, significance, contributions, and limitations, without marketing or business rhetoric. Shift the visual emphasis by discipline: in theoretical work, formulas and proof steps occupy the main visual field; in computer science and engineering, system diagrams, code, execution traces, and performance curves provide the backbone; in experimental research, formulas, charts, and images cluster tightly around a single conclusion; in the humanities and social sciences, archival material, maps, manuscripts, and other textual evidence add narrative depth without compromising academic rigor.

Content and layout:
1. Use a fixed argumentative spine: research question → gap in related work → data and methods → main results → ablation/analysis → limitations → future work. A short deck may compress this sequence, but must not reorder it.
2. Build evidence-first slides: results tables must include baseline comparison columns, comparative charts, and architecture/process diagrams; present the core contribution as a formally typeset equation.
3. Maintain moderate information density: one argument per slide, with evidence organized around that argument. Slides should be composed, not merely filled—white space is a valid means of separating stages of the argument.

Visual style:
1. Aesthetic: restrained, precise, and scholarly. No promotional copy, decorative photography, or clip-art icons.
2. Typography: use a clear sans serif (render with Liter / Chinese: MiSans) for body copy and labels; when the source style uses serif typography, titles may also use serif. Equations must be formally typeset (KaTeX quality), with standard equation numbering and italic variables.
3. Color: use one two-color system per deck—one primary structural color and one accent color, with gray establishing hierarchy; use a white or near-white background; reserve one consistent warning color for negative or ablation signals.
4. Graphics: use thin, precise vector lines in diagrams; minimal horizontal rules in tables; axis labels, units, and sample definitions in charts; no decorative 3D effects, shadows, or gradients.

Structure and discipline (distilled from deliverables established as benchmarks):
1. Every content-slide title must state an argument (a finding, not a section label—“Lapses in Attention Can Be Predicted 10 Seconds in Advance,” not “Experimental Results”), followed by evidence that supports it.
2. Align claims with evidence: every quantitative conclusion on a slide must be supported on that same slide by a chart, table, or cited result; no orphaned numbers.
3. The main results table must include baseline comparison columns and identify the best value; show relative improvement alongside absolute values.
4. Method slides must include reproducibility details: dataset size, annotation protocol, inter-annotator agreement, and key hyperparameters. Show only the core idea as an equation; move derivations to appendix slides.
5. Every figure must be self-contained: include axis labels with units, a legend or direct annotations, and a caption area specifying sample size and confidence convention; a figure must not rely on its legend alone.
6. Ablations and limitations are mandatory slides, not optional ones: ablations isolate each component’s contribution; limitations accurately state scope, failure modes, and ethics/de-identification status.
7. Every number must include its unit, time range, dataset, and statistical convention (mean ± variance, sample size); express uncertainty using a measurable quantity or confidence interval, never vague language.
8. Open with the problem statement and a one-sentence contribution; close with numbered conclusions (claims, not a summary) and an explicit list of open questions.
9. Place citations in a compact footnote line at the bottom of the slide where they are used; unless the genre requires it, avoid a full-slide wall of dense references.

Default baseline (distilled from the layout skill; PART B may override): organize each slide around one evidence unit (figure/table/equation); charts must include complete axis labels, units, and sample definitions; keep charts honest—do not truncate the y-axis to exaggerate differences, and distinguish correlation from causation explicitly in the copy; ensure projection readability on a 960×540 canvas, with body text at ≥14pt equivalent and chart labels at ≥10pt equivalent.

**Title sequence test**: Reading only the slide titles in order should tell the complete story; if they do not form a coherent narrative, the structure is not working.

Density anchor: The specific minimums for each style (number of evidence modules and charts per slide, annotation conventions) are defined by the 【Density Baseline】 reverse-engineered from that style’s source deck—this baseline does not impose a universal number.

### Global Prohibitions (Default AI Patterns · Mandatory)

1. **Do not use cards by default**: Unless the user explicitly requests them, never use rounded rectangles or rectangular cards to establish hierarchy or alignment—functional containers (status indicators, hypothesis boxes, quotation boxes) do not count as cards. Lines, white space, font size, and weight differences are preferable.
2. **Do not use equal-split compositions**: Unless no other viable layout exists, do not default to three equal columns, four equal columns, or a two-by-two matrix. An equal split must be justified by the content structure (three scenarios naturally warrant three columns; frameworks explicitly named in the content are exempt).
3. **Do not use unmotivated AI color schemes**: Institution-specific palettes stated in the content are exempt. Prohibited schemes are generic, familiar defaults with no rationale—blue-purple gradients, cyan-purple neon, rainbow glows, glass cards, and luminous borders.
4. **Do not use elements that conflict with the overall style**: No out-of-style treatments, such as rounded icons or rounded rectangles in a sharp-edged visual system.
5. **Keep chart backgrounds transparent**: Use transparency or the slide background color, except for reversed charts on dark backgrounds.
6. **Do not leave planned regions empty**: Do not leave an entire block of the content area blank; every planned region must be filled with real content. Failure to fill it is the most serious form of roughness.

## PART B — Signature System (Distinctive Features of This Template; Overrides PART A in Case of Conflict)

One-sentence style signature: Editorial infographic courseware with a white background and deep ink text, using electric blue as the structural anchor, gray-blue/cyan for layered hierarchy, and an alternating rhythm of photography, evidence blocks, and geometric white space.

【Color Palette】
The background is predominantly `#FFFFFF`; body text and line art use `#202124`, reserved for high-contrast text; titles, top rules, numbering, key figures, and the primary panel use `#4285F4`, with only one large primary-blue block per slide; deep blue `#0059BA` is reserved for strong-result panels; cyan `#24C2E0` is used for secondary-option panels; light blue `#ADCCFA` is used for explanatory backgrounds; gray `#D8DBE0` is used for comparison, disabled, or decorative backgrounds, while `#9AA0A6` is used for headers and low-emphasis labels; positive or intervention markers use `#34A853`; do not introduce a separate red for negative or unaffected states—continue using `#202124` or `#9AA0A6`. Charts use a fixed mapping: primary blue = primary series, light gray = no occurrence, charcoal = control, cyan = secondary series. Use no more than 4 hues per slide; decorative elements use blue, black, and gray only; never flood the entire slide with an accent color.

【Layout Skeleton】
Source-deck facts: 1190.55×1683.78pt, A4 portrait, with an aspect ratio of approximately 0.7071 and left/right margins of approximately 80pt. Content slides have an approximately 2pt blue rule across the top, gray section navigation on the left, and a gray running title on the right; below the title, use either text on the left and a visual on the right or stacked horizontal bands, often with a geometric anchor in a bottom corner. Cover only: large title at top left; at the bottom, an arched/rounded photograph layered with a striped circle and black capsule. Section divider only: oversized blue number and title, with a large image at bottom right. Agenda slides may use vertical numbering. 16:9 adaptation: retain the top rule, navigation at both ends, left-text/right-visual structure, blue/gray bands, and bottom-corner geometry; convert vertical stacking into a horizontal 2-column layout or 3:2 partition, move the photograph to the right or into a lower horizontal band, and reduce circular decoration to a corner accent. Never present adaptation rules as source-deck facts.

【Typography】
Source-deck facts: sans serif `GoogleSans-Regular/Medium/Bold` (render with {latin: Liter, ea: MiSans}); body text is approximately 20pt=1x, argument titles 46pt≈2.3x, section/cover titles 80–87pt≈4–4.4x, large figures 60–70pt≈3–3.5x, running headers 18pt≈0.9x, and footnotes 14pt≈0.7x. Use Medium for titles, Regular for body copy, and Bold for metrics/conclusions; enlarge numbers while setting units and explanations one level smaller; keywords often use a blue underline. 16:9 adaptation: recommended, not measured—on a 960×540 canvas, use body text at 18–22pt equivalent, titles at 42–54pt, and section titles at 72–84pt, preserving the original scale and weight relationships.

【Chart Language】
Observed types: rows of person icons, layered tree/process diagrams, central-node loop diagrams, two-row treatment/control comparisons, small “pre–intervention–post” line charts, four-step numbered processes, and paired-metric case-study blocks. Dense conventional tables are not a stable signature; axis labels, units, and measurement conventions inherit PART A.

⭐Signature techniques:
1. Use gray/blue/black person icons with a matching legend to communicate group attribution.
2. Use light blue → cyan → deep blue → gray nodes, thin black outlines, and orthogonal connectors to show a four-level hierarchy.
3. Link line-art icons with a black loop line and place a primary-blue circle at the center to express system relationships.
4. Inside a white rounded panel, use blue/gray line charts; use a green dashed line only to mark the intervention point.
5. Arrange treatment/control as horizontal rows, with a device screenshot beside a thin divider to explain between-group differences.

【Signature Components】
Top rule + gray navigation: 1 instance on every content slide, fixed to the top edge. Geometric anchor cluster (striped circle, quarter circle, gray circle/square, black capsule/triangle): no more than 1 cluster per slide, attached only to an edge or corner. Blue quotation panel: no more than 1 per slide, with a large white quotation mark and a short quotation. Blue/gray case-study band: no more than 1 group per slide, layered with a device screenshot/photograph/large metric. Rounded action capsule: no more than 1 per slide and only for an explicit action. Line-art icons use black outlines plus only one blue/cyan accent. Photography is mandatory on narrative/case-study slides: use 1 hero image, cropped as a circle/arch/rounded shape/diagonal cut; never use a photo wall or replace it with an icon wall.

【Prohibited】
No gradients, neon, luminous borders, 3D charts, or diffuse shadows; no continuous sequence of rounded cards for ordinary paragraphs; do not tile striped circles/quarter circles as a background; no rainbow icons or multicolor gradient charts; no full-slide photographs or photo collages; oversized blue numbers are reserved for sections, steps, or key metrics; serif typography must not serve as the primary typeface.

【Slide Types and Layouts】
Section/Cover｜Opening transition｜Title 45% + photograph/geometry 55%｜2–4 blocks｜Large number, photograph, geometric cluster｜Do not include a complete evidence chain.
Argument + Image/Quotation｜Claim with explanation/citation｜Left text 42–48% + right image/blue panel 52–58%｜4–7 blocks｜Photograph, quotation, key figure｜Do not include a multi-series statistical chart.
Method/Process Diagram｜Steps, hierarchy, system relationships｜Diagram 45–55%, explanation 25–35%｜4–8 blocks｜Line art, colored nodes, numbering｜Do not include long-form narrative.
Comparison/Two-Column Case Study｜Treatment/control or two cases side by side｜Blue/gray approximately 50% each｜6–10 blocks｜Device screenshot, paired metrics, action capsule｜Do not present a single continuous argument.
Checklist/Do–Avoid｜Standards and review items｜Left/right approximately 45/45%, optional photograph along the bottom｜6–9 blocks｜Check/cross line art, gray background blocks｜Do not include a high-dimensional data table.

【Density Baseline】
Most content slides contain 1 main title and 4–8 independent blocks; two-column case studies contain 6–10 blocks; process slides contain 1 primary diagram + 3–5 explanatory elements. A slide usually contains 0–1 chart; complex slides may add at most 1–2 microcharts. Label only key figures and legends; do not crowd every bar or point with labels. Use 2–4 explanatory paragraphs, each approximately 40–90 words/characters equivalent; present metrics as a large number + unit/short conclusion. Concentrate white space in the header, between the title and primary visual, and around geometric elements in the bottom corners; the content area must still be fully occupied by substantive text, diagrams, or photography.
