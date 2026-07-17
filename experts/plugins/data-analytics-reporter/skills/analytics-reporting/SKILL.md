---
name: analytics-reporting
description: "Build polished analytical reports, dashboards, and product/business analyses. Use when the user needs a durable report (executive or technical), an analytical dashboard with clear metrics, or a data-backed product/business analysis to inform decisions. Covers report building, dashboard construction, and decision-oriented quantitative analysis."
---

# Analytics Reporting & Dashboard Building

Three complementary capabilities: (1) build polished analytical reports, (2) construct source-backed dashboards, and (3) perform decision-oriented product/business analysis.

## Part A: Report Building

Build polished analytical reports for executive, product, business, and technical audiences. The report owns the reader-facing narrative, audience shape, evidence placement, visual/table placement, caveats, source metadata, and handoff.

### Workflow

#### 1. Define The Reporting Job

State the user question, decision the report should support, primary audience, scope, time frame, comparison baseline, and what would make the report decision-useful.

Choose exactly one audience:
- **Product stakeholders**: default for product, business, leadership, strategy, diagnostics, KPI readouts.
- **Technical**: only when user asks for technical/methods-first report.

#### 2. Gather And Bound The Evidence

Inventory source data, metric definitions, denominators, assumptions, caveats, notebooks, SQL, and scripts needed. Resolve ambiguities before drafting claims. If a metric cannot be supported, record why.

#### 3. Distill The Report Spine

Write a compact answer-first report spine:
- Question
- Decision-useful answer
- Metric, cohort, denominator, time window, comparison basis
- Findings by segment or driver with evidence
- Sensitivity or validation checks
- Caveats that could change interpretation
- Recommended next step or open question

#### 4. Plan Reader-Facing Structure

Draft ordered major segments, visible titles, and intended evidence format. Use visuals by default for quantitative findings; tables for exact lookup.

Apply the report depth gate:
- Executive summary does not count as evidence section.
- Comparative reports need segment-level interpretation.
- Claims need at least one validation note near the finding.

#### 5. Design Visuals And Tables

Route every report visualization through the data-visualization skill for chart selection and QA. Every visual/table should support a specific claim. Plan an adjacent explanatory paragraph for every visualization.

#### 6. Build The Delivery Surface

Choose delivery mode:
- **HTML report**: portable static HTML with embedded chart images. Self-contained, can be opened directly in browser.
- **Markdown report**: structured markdown suitable for documentation or further processing.

#### 7. Validate The Finished Report

Confirm:
- Top of report answers the user directly
- Every major segment has a visible title
- Claims, visuals, tables, caveats appear in intended reading order
- Evidence and source notes are sufficient for auditability

### Report Standards

#### Narrative
- Open stakeholder reports with executive summary that answers the question directly (2-4 bullets with bold topic sentences).
- Open technical reports with main result, then definitions, methods, uncertainty, limitations.
- Start major segments with the takeaway, not setup prose.
- Keep report reading path top-to-bottom, single-column by default.
- Pair each important number or visual with plain-English interpretation.
- Include recommended next steps when evidence supports action.

#### Evidence And Sources
- Base every claim on saved data, code, query results, or rendered charts.
- Tie important numbers to readable source metadata near relevant content.
- Preserve source references for audit without cluttering the visible report.

#### Visuals And Tables
- Report visual headers should be neutral (chart name + short description). Put insights in adjacent narrative.
- Every visualization needs an adjacent explanatory paragraph.
- Report trend charts need enough data to make shape worth reading.
- Tables default to spacious density for narrative reports.

#### Metrics And Language
- Describe metrics in plain English before implementation details.
- Clarify definitions, cohorts, denominators before relying on a metric.
- Put raw numbers in context: percent of base, comparison to baseline, or historical range.
- Use shorthand large numbers in narrative (`899k`, `10.9k`, `1.2M`).

---

## Part B: Dashboard Building

Build source-backed analytical dashboards that help teams monitor performance, explore drivers, and act on metrics.

### Workflow

#### 1. Define The Dashboard Brief

Understand who will use the dashboard, what they need to measure, which metrics matter, what surface it should live in, and constraints. Decide whether the dashboard is for status monitoring, recurring review, or analytical exploration.

#### 2. Select The Delivery Surface

- **BI tool**: default when connected BI is available (Tableau, Looker, Power BI, etc.)
- **HTML dashboard**: portable static dashboard for sharing
- **Streamlit**: when user explicitly asks or existing Streamlit app needs changes
- **Interactive web**: JavaScript-based with ECharts/Chart.js for custom needs

#### 3. Gather And Validate The Data

- Find the source path before rendering.
- Validate data trust (source, grain, freshness, reconciliation).
- Resolve time and context anchors.
- Stop if source-backed data is unavailable (no mock dashboards unless explicitly requested).

#### 4. Define The Metric Model

Select metrics and classify the measurement object:
- **Reach**: who/what is using the product, penetration, activation, coverage.
- **Volume**: events, usage, transactions, sessions, throughput, frequency.
- **Value**: revenue, cost, margin, savings, conversion, retention value.
- **Quality**: success/failure rates, reliability, latency, satisfaction.
- **Depth**: repeat usage, intensity, feature mix, workflow completion.
- **Mix**: segment, geography, channel, product/version, plan, cohort.
- **Movement**: trend, growth, seasonality, pre/post, benchmark, forecast.
- **Risk**: data coverage, freshness, known blind spots, capacity.

Map into dashboard roles: hero metrics (default view), diagnostic metrics (movement/breakdowns), guardrails, and detail metrics (lookup).

#### 5. Design The Dashboard Layout

Arrange summary to detail: key status/KPI first → movement over time → breakdowns → detail tables. Use global filters only when they materially update the view. Keep dashboards visual-heavy and neutral.

#### 6. Choose The Right Charts

Use the data-visualization skill for chart selection and encoding. Choose the simplest visual that answers the viewer's question.

#### 7. Build And Validate

Build in the selected surface. Before handoff check: opens cleanly, filters work, charts render, numbers reconcile, performance acceptable.

### Dashboard Quality Bar

- Default view answers the primary audience question before interaction.
- Filters are few, meaningful, and work correctly.
- Cards, charts, and tables reconcile.
- Metric set covers relevant families with primary outcomes, drivers, guardrails.
- Source freshness and caveats are visible where they matter.

---

## Part C: Product & Business Analysis

Answer product or business questions with data-backed evidence, context, and a recommendation.

### Workflow

#### 1. Start From The Decision

Identify the decision, audience, and action the analysis should inform:
- The question and decision to inform
- Who will use the answer and what they can act on
- The scope and comparison that define a useful answer
- The outcome or behavior that matters
- Any assumptions needed to proceed

#### 2. Gather Decision-Relevant Context

Before deeper analysis, clarify:
- **Intent**: what the work was meant to accomplish
- **Definitions**: how the metric/source is defined and measured
- **Timing**: what changed around the analysis period
- **Constraints**: decisions or limitations affecting realistic action

#### 3. Frame The Analysis

Turn the question into a focused analytical framework:
- Specific data questions that would support or change the recommendation
- Comparisons and dimensions to inspect
- Unit of analysis matching the decision
- Metric definitions and caveats

#### 4. Run Focused Quantitative Analysis

- Follow the framework. Run analyses that could change the recommendation first.
- Use the right comparison. Do not conclude a group is best just because it has the most total usage—normalize, check growth, check behavior.
- Size the opportunities. Estimate magnitude of impact.
- Keep work inspectable. Record queries and analysis.
- Validate before concluding.

#### 5. Translate Evidence Into Decision Implications

Interpret evidence through decision lenses (choose relevant ones):
- **Current scale**: large enough to matter?
- **Momentum**: growing, shrinking, accelerating?
- **Breadth**: broad-based or narrow?
- **Concentration**: depends on few large entities?
- **Intensity**: deep enough per unit?
- **Efficiency**: better output for input required?
- **Addressability**: can the team act on this?
- **Differentiation**: requires distinct motion?
- **Risk/dependency**: constraints that change recommendation?

#### 6. Hand Off The Recommendation

Make the recommendation explicit:
- What they should believe or do next
- Why the evidence supports that
- Which caveats or dependencies matter
- What follow-up would improve confidence
