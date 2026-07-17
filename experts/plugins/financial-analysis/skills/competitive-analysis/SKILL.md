---
name: competitive-analysis
description: Framework for competitive landscape analysis across any industry. Use when creating competitor analysis, market positioning assessments, investment memos, strategic reviews, or any analysis requiring systematic evaluation of competitive dynamics. Triggers include requests for competitive landscape decks, peer comparisons, market structure analysis, strategic positioning assessments, and investment recommendations.
---

# Competitive Landscape Mapping

---

## CRITICAL STANDARDS - APPLY TO EVERY ANALYSIS

### Source File Primacy

When source files (Excel/CSV) are provided:
* **Extract values DIRECTLY** — Do not perform your own calculations; use the numbers as they appear
* **Maintain consistency** — When the same metric appears in multiple places, ensure identical values throughout
* **Verify calculations** — If the prompt asks you to calculate something, verify your result matches related data in the source
* **Round only as shown** — Use the same decimal precision as the source file

### Prompt Fidelity

When the prompt specifies exact requirements, follow them verbatim:

**Slide Titles & Section Names:**
* If prompt says `"Overview and Competitive Scope" slide` — use EXACTLY that title, not a paraphrase
* If prompt says `within the "Segment Mix" section` — use EXACTLY "Segment Mix" as the section header
* Never substitute with creative alternatives (e.g., don't use "FY2024 Segment Contribution Analysis" when "Overview and Competitive Scope" was specified)

**Chart vs Table:**
* If prompt says `embedded chart` — create an actual PowerPoint chart object, NOT a table
* If prompt says `data labels must display` — these go on chart elements (bars, slices, lines), not table cells
* Tables and charts are NOT interchangeable — use exactly what's specified

**Complete Data Series:**
* If prompt lists 7 competitors, include ALL 7 — not 5 or 6
* If prompt shows data for years 2015-2025, include ALL years — not a subset
* If prompt specifies 6 series in a chart (Uber, Lyft, DiDi, Bolt, Grab, Gojek), include ALL 6 — not 4

**Exact Values & Phrasing:**
* If prompt says `Revenue: $43.98B (+18% YoY)` — display exactly that format
* If prompt says `surpasses DoorDash 4:1, Lyft 8:1` — use those exact ratios, not "7.6x Lyft"
* If prompt gives specific percentages (e.g., "Uber 30%, DiDi 35%"), use exactly those numbers

**When in doubt:** Re-read the prompt. If it specifies something explicitly, that's not a suggestion — it's a requirement.

### Reference Files

This skill includes reference files in the `references/` folder. Use them as follows:
* **`references/schemas.md`** — Table templates for M&A transactions, scenario analysis, and slide structure. Reference when building financial tables or investment scenarios.
* **`references/frameworks.md`** — 2x2 matrix axis pairs by industry. Reference when choosing positioning visualization dimensions.

### Source Quality Hierarchy

When sources conflict, prioritize in this order:
1. **10-Ks / Annual Reports** — Audited, highest reliability
2. **Earnings Calls / Investor Presentations** — Management commentary, forward guidance
3. **Sell-Side Research** — Analyst estimates, useful for private company sizing
4. **Industry Reports** (McKinsey, Gartner, etc.) — Market sizing, trends
5. **News Articles** — Use only for recent developments, verify against primary sources

### Data Comparability
* **Time periods must match** — All competitor metrics from same fiscal year. Flag exceptions: "(FY24)" vs "(H1 2024)"
* **Metric definitions must match** — Same calculation methodology across competitors
* **Currency normalization** — Convert all figures to USD for international comparisons; note exchange rate and date used
* **Use "-" for missing data** — Never leave cells blank; for private companies, use "N/A" or estimates with "[E]" flag
* **Cite every number** — Format: "[Company] [Document] ([Date])"
* **Source file fidelity** — When Excel/CSV files are provided, use values exactly as given; do not recalculate or round differently than shown

### Design & Formatting
* **Slide titles = insights** — "Scale leaders pulling away from niche players" not "Competitive Analysis"
* **Slide titles must fit** — One or two lines fine, but no overflow; reduce font size if needed (min 24pt)
* **Signposts = quantified** — "margin below 40%" not "margins decline"
* **Ratings include actuals** — "●●● $160B" not just "●●●"
* **Slide numbers required** — Every slide must have a page number

### Presentation-Specific Requirements
* **Actual embedded charts required** — Pie charts, bar charts, and line graphs must be real PowerPoint chart objects (created via pptx skill), NOT text/ASCII representations
* **Match prompt structure** — If prompt specifies slide structure, follow it
* **Competitor tables** — For comprehensive analysis: metrics table + qualitative table per competitor. For rapid assessments: single combined table is acceptable.
* **Segment financials** — Include both Revenue AND EBITDA when available. For private competitors or limited disclosure, revenue-only tables are acceptable; note "[EBITDA not disclosed]"

### Visual Reference

**Review `examples/Toast_Embedded_Payments_Competitive_Landscape_v3.pptx` and match its professional quality:**

**Spacing & Overflow Prevention:**
- **Title-to-content gap** — Minimum 0.4" between slide title bottom and first content element
- **Section header gaps** — Minimum 0.25" between section headers and content below
- **Element buffers** — Minimum 0.2" between any two elements (tables, text boxes, charts)
- **Margin safety** — Keep all content at least 0.5" from slide edges
- **Text overflow** — If text doesn't fit, reduce font size or split across slides; never let text clip or overlap

**Slide Titles:**
- **Must fit within slide width** — One or two lines is fine, but text must not overflow or clip
- **If title is too long** — Shorten wording or reduce font size (minimum 24pt)
- **Front-load the insight** — Put the key point first, details second

**Chart Formatting:**
- **Legend inside layout** — Always set `include_in_layout=True` so legends don't overlap chart area
- **Legend position** — Use RIGHT for pie charts (≤6 items), BOTTOM for line/bar charts (≤4 series)
- **Too many series** — If >6 series, consider splitting into multiple charts or using a table instead
- **Data labels** — For pie charts, show percentages on slices rather than relying solely on legend

**Typography (set explicitly, never use defaults):**
- Slide title: 28-32pt bold
- Section headers: 16-20pt bold
- Body text: 11-14pt regular
- Table text: 10-12pt regular
- Sources/footnotes: 8-10pt, gray
- **Consistency rule**: Same element type = same font size throughout deck

**Layout:**
- Clean grid alignment — tables and text blocks align to consistent margins
- Generous whitespace — don't crowd slides; let content breathe
- Visual hierarchy — most important insight is largest/most prominent
- One key message per slide — supporting detail below

**Color:**
- Limited palette — 2-3 colors max (one accent color for emphasis)
- Muted tones — avoid bright/saturated colors; use navy, gray, muted blue
- Consistent application — same color meanings throughout (e.g., accent for key metrics)

**Tables:**
- Light gray header row with bold text
- Alternating row shading (subtle) or clean white with thin borders
- Right-align numbers, left-align text
- Adequate cell padding — text shouldn't touch borders

**Rating visuals:**
- ●●● / ●●○ / ●○○ system with actual metric alongside
- Consistent placement in comparative tables

Adapt structure and metrics to fit your industry — but maintain this level of polish.

### What's STRICT vs FLEXIBLE

| STRICT (Every Time) | FLEXIBLE (Case-by-Case) |
|---------------------|------------------------|
| Exact titles/sections when prompt specifies | Creative titles when prompt doesn't specify |
| Chart when prompt says chart; table when prompt says table | Visualization type when prompt doesn't specify |
| All data points/competitors listed in prompt | Number of competitors when prompt doesn't specify |
| Exact values/ratios when prompt specifies them | Rounding when prompt doesn't specify precision |
| Titles fit without overflow | Number of competitor categories |
| Minimum spacing between elements | Which dimensions to compare |
| Chart legends inside layout | Number of competitors profiled |
| No overlapping text/elements | Visualization type (2x2, radar, tier) |

---

## WORKFLOW PHASES

### Phase 1: Clarify Requirements
Before starting, confirm:
* **Scope**: Single company deep-dive or multi-company comparison?
* **Output**: Presentation or written memo?
* **Focus areas**: Specific competitors, dimensions, or strategic questions?
* **Investment context**: Need scenarios/signposts?
* **Source files**: What data files are provided and what values should be extracted?

### Phase 2: Research → Outline → Review → Create
**Do NOT create final output until outline is reviewed.**

The 10-step Analysis Workflow below (Steps 0-9) is executed during Phase 2. Complete research and outlining before creating final slides or documents.

---

## ANALYSIS WORKFLOW

### Step 0: Identify Industry-Defining Metrics
Before diving into analysis, identify 3-5 metrics that matter most for this industry:

| Industry | Key Metrics |
|----------|-------------|
| SaaS | ARR, NRR, CAC payback, LTV/CAC, Rule of 40 |
| Payments | GPV, take rate, attach rate, transaction margin |
| Marketplaces | GMV, take rate, buyer/seller ratio, repeat rate |
| Retail | Same-store sales, inventory turns, sales per sq ft |
| Logistics | Volume, cost per unit, on-time delivery %, capacity utilization |

For industries not listed, identify the 3-5 metrics that investors and operators use to benchmark performance.

Use these metrics consistently across all competitor comparisons.

### Step 1: Market Context
- Market size (current and projected) with source
- Growth drivers and headwinds
- Key trends reshaping the industry

**CORRECT:** "The embedded payments market is $80-100B in 2024, growing at 20-25% CAGR (McKinsey 2024)"
**WRONG:** "The market is large and growing rapidly"

### Step 2: Industry Economics

Map value flows. Approach varies by industry type:
* **Vertically-structured** — Value chain layers with typical margin at each
* **Platform/network** — Ecosystem participants and value flows between them
* **Fragmented** — Consolidation dynamics and margin differences by scale

### Step 3: Target Company Profile

```
| Metric | Value |
|--------|-------|
| Revenue | $4.96B |
| Growth | +26% YoY |
| Gross Margin | 45% |
| Profitability | $373M Adj. EBITDA |
| Customers | 134K |
| Retention | 92% |
| Market Share | ~15% |
```

**For multi-segment companies, add segment breakdown:**
```
| Segment | Revenue | Rev YoY | Rev % | EBITDA | EBITDA YoY | Margin |
|---------|---------|---------|-------|--------|------------|--------|
| Seg A   | $25.1B  | +26%    | 57%   | $6.5B  | +31%       | 26%    |
| Seg B   | $13.8B  | +31%    | 31%   | $2.5B  | +64%       | 18%    |
| Seg C   | $5.1B   | -2%     | 12%   | -$74M  | -16%       | -1%    |
| Total   | $44.0B  | +18%    | 100%  | $6.5B* | -          | 15%    |
```
*Note corporate costs if applicable

### Step 4: Competitor Mapping

Group competitors using the framework that fits:
* **By business model** — Platform vs. vertical vs. horizontal
* **By segment** — Enterprise vs. SMB vs. consumer  
* **By posture** — Direct vs. adjacent vs. emerging
* **By origin** — Incumbents vs. disruptors vs. new entrants

### Step 5: Positioning Visualization

| Visualization | Best For |
|--------------|----------|
| 2x2 Matrix | Two dominant competitive factors |
| Radar/Spider | Multi-factor comparison |
| Tier Diagram | Natural clustering/strategic groups |
| Value Chain Map | Vertical industries |
| Ecosystem Map | Platform markets |

### Step 6: Competitor Deep Dives

**Table 1 — Metrics:**
```
| Metric | Value |
|--------|-------|
| Revenue | $X.XB |
| Growth | +XX% YoY |
| Gross Margin | XX% |
| Market Cap | $X.XB |
| Profitability | $XXXM EBITDA |
| Customers | XXK |
| Retention | XX% |
| Market Share | ~XX% |
```

**Table 2 — Qualitative:**
```
| Category | Assessment |
|----------|------------|
| Business | What they do (1 sentence) |
| Strengths | 2-3 bullets |
| Weaknesses | 2-3 bullets |
| Strategy | Current priorities |
```

### Step 7: Comparative Analysis

```
| Dimension | Company A | Company B | Company C |
|-----------|-----------|-----------|-----------|
| Scale | ●●● $160B | ●●○ $45B | ●○○ $8B |
| Growth | ●●○ +26% | ●●● +35% | ●●○ +22% |
| Margins | ●●○ 7.5% | ●○○ 3.2% | ●●● 15% |
```

### Step 8: Strategic Context
- M&A transactions (multiples, strategic rationale)
- Partnership and integration trends
- Capital raising patterns
- Regulatory developments

### Step 9: Synthesis

**Competitive Moat Assessment:**
Evaluate each competitor's durable advantages using these categories:

| Moat Type | What to Assess |
|-----------|----------------|
| Network Effects | Strength of user/supplier flywheel; cross-side vs. same-side effects |
| Switching Costs | Technical integration depth, contractual lock-in, behavioral habits |
| Scale Economies | Unit cost advantages at volume; minimum efficient scale |
| Intangible Assets | Brand value, proprietary data, regulatory licenses, patents |

Rate each as Strong / Moderate / Weak with supporting evidence.

**Required Synthesis Elements:**
- Durable advantages (hard to replicate) — map to moat categories above
- Structural vulnerabilities (hard to fix)
- Current state vs. trajectory

**For investment contexts:**
```
| Scenario | Probability | Key Driver |
|----------|-------------|------------|
| Bull | 30% | Market share gains, margin expansion |
| Base | 50% | Current trajectory continues |
| Bear | 20% | Competitive pressure, margin compression |
```

---

## QUALITY CHECKLIST

Before finalizing, verify:

**Prompt Fidelity:**
- ✅ Slide titles match prompt exactly (not paraphrased)
- ✅ Section names match prompt exactly
- ✅ Charts used where prompt says "chart"; tables where prompt says "table"
- ✅ All competitors/data points included (if prompt lists 7, include 7)
- ✅ All years/periods included (if prompt shows 2015-2025, include all)
- ✅ Exact values and formats used as specified in prompt
- ✅ Commentary uses exact phrasing when prompt specifies it

**Source File & Data Consistency:**
- ✅ All values from source files extracted directly (not recalculated)
- ✅ Same metric shows identical value across all slides
- ✅ Calculated percentages match source data or related figures
- ✅ Numbers use same decimal precision as source

**Layout & Spacing:**
- ✅ Minimum 0.4" gap between slide title and first content element
- ✅ No text or elements overlapping
- ✅ All content within 0.5" margin from slide edges
- ✅ Text fits within containers (no clipping or overflow)
- ✅ Slide titles fit within slide width (1-2 lines, no overflow)

**Charts:**
- ✅ Legends set to include_in_layout=True (no overlap with chart)
- ✅ Legend position appropriate (RIGHT for pie, BOTTOM for line/bar)
- ✅ No more than 6 series per chart; if more, split or use table

**Typography:**
- ✅ Font sizes explicitly set (not default)
- ✅ Same element type uses same font size across all slides
- ✅ Titles 28-32pt, headers 16-20pt, body 11-14pt, sources 8-10pt

**Data & Sources:**
- ✅ Every number has a source citation
- ✅ All competitor metrics from same fiscal period (flag exceptions)
- ✅ Same metric definitions across all competitors

**Presentation Format:**
- ✅ Slide titles state insights, not topics
- ✅ All slides have page numbers
- ✅ Charts are actual embedded PowerPoint objects (not ASCII/text)
- ✅ Segment tables include EBITDA where available; revenue-only acceptable for private companies
