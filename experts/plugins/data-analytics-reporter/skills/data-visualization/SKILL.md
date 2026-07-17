---
name: data-visualization
description: "Design, specify, implement, revise, and QA quantitative visuals and chart choices. Use when an analytical answer needs visual judgment—comparing values, showing composition, reading concentration, understanding movement over time, or building chart specifications for reports and dashboards."
---

# Data Visualization

Create quantitative visuals that are analytically sound, immediately readable, and polished enough to ship in a report, memo, slide, dashboard, notebook, or HTML artifact. Treat charts as evidence for a takeaway. Redesign charts that are visually attractive but analytically weak, and revise charts that are technically correct but hard to interpret.

## Chart Selection Guide

| Data relationship | Best chart | Use it well |
|---|---|---|
| Trend over time | `line` | Show enough points to reveal shape; use `area` only when filled magnitude helps; `sparkline` for dense KPI cards |
| Composition over time | `stackedArea` | Use when parts should read as one total; switch to `line` when comparing trajectories matters more |
| Comparison across categories | `bar` | Sort when order is not semantic; horizontal bars for long labels; avoid redundant legends |
| Ranking or top-N | `leaderboard` | Compact, single-measure; switch to ranked `bar` for more context |
| Part-to-whole composition | stacked `bar` | Keep denominator explicit; use `pie` only for rough read with few slices |
| Distribution or spread | `histogram` | Numeric bins that reveal shape; `boxPlot` when comparing groups is the point |
| Distribution across groups | `boxPlot` | Median and spread over full shape; switch to `histogram` when shape needs space |
| Relationship between variables | `scatter` | Numeric x and y, enough distinct points to show pattern; retain labels and one grouping candidate |
| Dense 2D pattern or cohort matrix | `heatmap` | Matrix shape or intensity; switch to `scatter` for point-level variation |
| Additive bridge start to end | `waterfall` | Only when drivers sum cleanly to end value; otherwise ranked `bar` |
| Ordered stage progression | `funnel` | Only for ordered single-series stages; prefer stage `bar` when geometry distorts |

## Workflow

1. **Define the analytical question and takeaway** before choosing a chart. Identify the intended comparison and context needed to make the visual honest.

2. **Choose the simplest defensible chart family** from the Chart Selection Guide. Keep the top-level families small: Tables & Scorecards, Trend, Comparison & Ranking, Composition, Distribution, Relationship, Uncertainty & Benchmark, Matrix & Cohort, Decomposition & Progression.

3. **Write a compact chart contract** before implementation:
   - Analytical question and takeaway
   - Chart family and concrete variant
   - Data sufficiency for the chosen visual
   - Palette policy and non-color distinction plan
   - Output footprint and delivery target

4. **Select the delivery path** matching the final surface:
   - Static HTML/PNG for reports and portable files
   - Python (Matplotlib/Seaborn) for notebooks and static exports
   - JavaScript (ECharts, Chart.js, D3) for interactive web dashboards
   - BI-native widgets when a governed BI tool owns rendering

5. **Build in order**: format → structure → color → QA.

6. **Render or export** the chart in its real context. Save the image format the delivery surface expects.

7. **Inspect in final context**. Revise before delivery when the chart, labels, color, or container fails QA.

## Selection Rules

- Start from the analytical question, not a favorite chart type.
- Use charts for shape and comparison; tables for exact lookup.
- Do not choose `line` merely because "trend" appears—decide whether the reader needs status, movement, variance, mix, or distribution.
- Do not ship underpowered trend charts. Aim for at least 8-12 temporal points. Use KPI cards, grouped bars, or narrative for fewer points.
- Do not ship underpowered scatter charts. Aim for at least 12-20 meaningful points.
- Use horizontal bars for long labels; sorted bars when order has no semantic meaning.
- Prefer variant escalation within a family before inventing new chart types.
- Keep pie, Pareto, waterfall, Likert as variants, not defaults.
- Include volume/denominator/sample-size context when omission could mislead.

## Visual Design Standards

### Typography & Color
- Single font family across charts. Prefer white/near-white backgrounds, quiet grey grid lines, deep charcoal text, restrained palette.
- Do not rely on color alone. Use tone, open fill, marker fill, line style, direct labels, ordering, or faceting.
- Choose one palette policy before plotting:
  - **Single-root preferred**: one non-neutral root plus shades for simple charts.
  - **Hard two-root cap**: at most two non-neutral roots for binary, signed, or comparison charts.
  - **Relaxed multi-category**: up to five approved roots when category identity is the point.

### Layout & Labels
- Chart titles: neutral and descriptive for reports/dashboards; takeaway-led for standalone charts.
- Put metric details (units, denominator, date range, cohort, filters) in the subtitle.
- Prefer direct labels when they reduce legend lookups; use compact legend when direct labels create clutter.
- Reserve space for horizontal bars with long labels or negative values.
- Do not use gradients inside marks, colored backgrounds, or inconsistent corner radii.

### Signed Values
- Avoid green/red by default. Use dark vs. open/light fills, direct signed labels, and clear zero-line context.
- Waterfall: matched neutral anchors + exactly two non-neutral delta colors.

## Quality Bar

Before delivery, confirm:
- Chart choice follows the analytical question, not visual preference.
- Form matches the comparison; scales stay honest and consistent.
- Data grain, filters, date range, denominator, and units match the supported claim.
- Every shipped chart has a visible title and subtitle with needed context.
- Labels, ticks, legends, annotations must not collide or clip.
- Multi-series marks have distinct tones/fills/styles legible in grayscale.
- Positive/negative states use tone + signed labels, not just color.
- Inspect the visual in the final layout before handoff.
