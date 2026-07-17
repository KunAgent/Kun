---
name: metric-diagnostics
description: "Diagnose why a metric changed or differs from expectation, and produce leadership-ready KPI updates. Use when the user needs to understand what drove a metric movement, anomaly, or discrepancy, or when producing WBR/MBR/QBR summaries, scorecards, target pacing readouts, or performance updates."
---

# Metric Diagnostics & KPI Reporting

Two complementary capabilities: (1) diagnose why a metric changed or differs from expectation, and (2) produce leadership-ready KPI updates and scorecards.

## Part A: Metric Diagnostics

Diagnose why a metric changed or differs from expectation. Reproduce the metric, define the comparison, quantify the movement, validate likely drivers, and state what is verified, likely, unresolved, and useful to do next.

### Workflow

#### 1. Define The Diagnostic Question

Frame the diagnostic so it is clear what changed and what comparison would prove it.

Define:
- What the metric means in business terms
- The time window and comparison that make the change measurable
- The population and grain that determine what counts
- The source that owns the metric definition
- The diagnostic question (movement, concentration, or reconciliation)

#### 2. Validate The Metric Definition And Source

Before explaining the movement, confirm that the metric is defined correctly and that the source data can measure it reliably. Confirm definition, grain, aggregation logic, filters, joins, exclusions, freshness, and lineage.

Treat saved context and familiar table names as source candidates, not source selection. Inspect at least one business-facing surface and one lower-level source, then state why the selected source owns the answer.

#### 3. Establish The Metric Pattern

Before looking for drivers, establish the metric pattern the diagnostic needs to explain. Quantify the metric over the relevant period and scope. If the question includes a comparison, reproduce that comparison.

Do not search for causes until the size, timing, and scope of the pattern are verified.

#### 4. Choose The Diagnostic Plan

Choose the smallest set of cuts and checks likely to explain the pattern. Choose driver dimensions from the metric's operating logic, business context, and source shape. Prioritize drivers the business usually monitors or can act on.

Use the explanation mode that fits the question:
- **Metric change**: compare focal window with baseline, rank segment contributions, check mix shift vs. within-segment movement.
- **Spike/regression/incident**: pin down onset, peak, recovery, distribution shape, affected slices, broad vs. localized degradation.
- **Largest contributors**: define "largest", rank entities, compare total share and change, look for major movers, entrants, and exits.
- **Reconciliation**: align definitions, filters, grain, numerator, denominator; quantify components explaining the gap.

#### 5. Decompose And Validate Drivers

Quantify the main drivers and validate whether they explain the pattern.

- Size each major driver with the strongest available evidence.
- Show whether it explains the pattern, how large it is relative to the base.
- For rates, check whether the numerator, denominator, or both explain the change.
- For additive metrics, calculate contribution share when it sharpens the story.
- Separate composition effects from within-segment performance effects.
- Treat measurement issues as possible explanations (logging changes, incomplete data, duplicated rows, shifted denominator).
- Calibrate the explanation to the evidence; make important uncertainty visible.

#### 6. State Implications And Follow-Up

Lead with the answer to the diagnostic question, then state practical implications:
- The pattern being explained
- The strongest driver explanation and supporting evidence
- Why it matters for the business
- How much confidence to place in the explanation
- The implication, next action, or follow-up that matters most

---

## Part B: KPI Reporting

Turn business or product metrics into decision-ready operating readouts for leaders and teams. Define the KPI contract, report status against the right comparison and target, include validated driver context, and state the operating implication clearly.

### Workflow

#### 1. Clarify The Readout Purpose

Understand who the readout is for, what conversation it supports, and what is being reported. Anchor the update in the period being evaluated, the comparison or target, and the freshness cutoff.

#### 2. Define The Metric Framework

Decide which metrics belong in the readout and what role each plays. Start with the primary KPI, then add the smallest set of supporting metrics to explain status.

Lead with the metric that matters most to the audience. Include the metrics and slices decision-makers actually use, plus any that materially explain this update.

#### 3. Lock Metric Definitions And Sources

Confirm the KPI definition, source, time window, reporting cutoff, comparison period, and target or pacing expectation before interpreting performance.

If a definition changed, show comparable restated history or call out the break clearly.

#### 4. Pull The Topline Actuals

Query or inspect data sources for core actuals. Reproduce the topline actual before explaining movement.

For each headline KPI, include the current value, absolute and relative change vs. the comparison period, and short interpretation. Call out anything that makes the current value hard to compare.

#### 5. Put The Numbers In Context

Compare actuals against the context that makes performance interpretable: target, plan, pacing model, benchmark, historical range, or relevant peer group.

If the goal has a deadline, show whether it is on pace. Include absolute and percent variance to target and a status indicator.

#### 6. Explain Validated Drivers

Driver claims must be validated before presented as explanations. Use Part A (Metric Diagnostics) to identify and validate drivers when fresh investigation is needed.

#### 7. Add Business Context And Operating Implications

Translate evidence, driver analysis, and business context into the operating implication. State whether the movement is concerning, what next step is warranted, and whether the KPI is on track, at risk, or ahead of plan.

#### 8. Shape The Readout

Common shapes: inline written update, document/report, slide, or deck. Adapt to the audience, evidence, and artifact.

### KPI Reporting Standards

#### Metric Standards
- Never present a KPI as precise when its definition, source, or comparison basis is unclear.
- Make calculation logic, inclusion rules, grain, and time treatment explicit.
- Reconcile totals and compare against prior reporting when possible.
- Do not compare periods that are not definitionally compatible.

#### Status And Pacing Standards
- Include headline takeaway, current actual, comparison, target/pacing context, driver summary, and implication.
- Put actuals next to target so the reader can judge performance immediately.
- If a target is time-bound, show whether current performance is on pace.
- Use traffic-signal status only when it helps prioritize action.

#### Driver Standards
- Quantify drivers whenever evidence supports it.
- Report the few drivers that matter for interpreting the movement.
- Separate validated drivers from business context or hypotheses.
- Do not elevate business events into causes unless timing and measured change support the link.
- State whether movement is broad-based or concentrated.

#### Presentation Standards
- Write for executives who skim: lead with the answer, then evidence.
- Use business-readable numbers: `123k (+8% w/w, +19% m/m)`.
- Replace generic adjectives ("strong", "healthy") with metric evidence.
- Keep caveats close to the claim they affect.
