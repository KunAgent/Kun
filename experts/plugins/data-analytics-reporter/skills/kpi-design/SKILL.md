---
name: kpi-design
description: "Design KPI frameworks, set targets, develop measurement plans, and estimate market/opportunity sizes (TAM/SAM/SOM). Use when success metrics, drivers, guardrails, targets, or measurement approach need to be defined or improved, or when a market or opportunity size estimate is needed."
---

# KPI Design & Market Sizing

Two complementary capabilities: (1) design KPI frameworks, set targets, and develop measurement plans; (2) estimate market or opportunity sizes with transparent assumptions and sensitivity analysis.

## Part A: KPI Framework Design

Design KPI frameworks, set targets, and develop measurement plans that help teams make product or business decisions.

### Workflow

#### 1. Clarify The Decision And Operating Context

Understand the decision the metrics need to support, the context in which they will be reviewed, and who will act on the result. Ask the user to clarify the goal, operating cadence, or measurement constraints when missing input would change the recommendation.

#### 2. Gather Evidence Before Recommending Metrics

When the prompt does not already provide enough context to know what success means, gather that context before recommending metrics or targets. Understand the goal, current state, audience, constraints, risks, existing definitions, prior decisions, and any baseline or target context.

#### 3. Generate A Wider Candidate Set

Create candidate outcome, driver, and guardrail metrics before narrowing. Each candidate should have a clear definition and a plausible link to the decision.

#### 4. Compare And Select Metrics

Compare candidate metrics by whether they:
- **Reflect the goal**: the metric represents the intended outcome. When using a proxy, explain why and where it could mislead.
- **Inform a real decision**: movement should change what the team does.
- **Show useful signal at the decision cadence**: not too slow-moving or noisy for the decision it supports.
- **Can be influenced by the team**: plausible levers exist, or paired with drivers.
- **Can be measured operationally**: instrument, calculate, and track consistently.
- **Are hard to game**: improving the metric should not hide harm to quality, trust, or retention.

Recommend 1-3 primary KPIs, 1-2 driver metrics for each KPI, and 1-2 guardrails when tradeoffs are likely.

For each recommended metric: what it measures, why it matters, how it is calculated, where it comes from, main pros and cons, and what caveats matter.

#### 5. Set Targets When Needed

Treat target setting as separate from metric selection.

Use the target-setting approach that fits the evidence:
- **Top-down**: benchmarks, historical performance, comparable products, competitor context.
- **Bottom-up**: what the team can realistically do—what is shipping, expected adoption, available levers.

Compare aspirational targets with realistic influence. A good target should be meaningful for the decision and plausible enough to guide action.

#### 6. Deliver The Recommendation

Compact metric-design brief:
1. Initiative summary
2. Recommended metric candidates with definition and rationale
3. Target recommendation with anchor, assumptions, and methodology
4. Evidence reviewed
5. Assumptions and missing context
6. Risks and guardrails
7. Open questions

### Example Metric Shapes

- **Product launch/adoption**: outcome metric for adoption + drivers for activation/engagement + guardrails for experience quality.
- **Growth work**: business outcome (activation/retention/monetization) + drivers + guardrails.
- **Funnel work**: progression/completion outcome + stage drivers + downstream quality guardrails.
- **Operating review**: health, pacing, action-oriented metrics.
- **Experiment**: one primary success metric + diagnostics + guardrails for unintended effects.
- **Platform/reliability**: service health, throughput, quality, cost efficiency, customer impact.

---

## Part B: Market Sizing

Produce defensible estimates of a market or opportunity from available context, public sources, transparent assumptions, and auditable calculations.

### Workflow

#### 1. Frame The Market Or Opportunity

Define the boundary:
- What is being sized (product category, workflow, problem, use case)
- Where and when (geography, segment, time horizon, maturity)
- Who counts (relevant population, unit of demand, transaction type)
- How measured (spend, revenue, volume, value created)
- What answer needed (TAM/SAM/SOM, market entry, expansion upside, spend pool)

#### 2. Choose A Sizing Approach And Inputs

Pick the simplest sound approach:
- **Top-down**: reliable aggregate market data exists.
- **Bottom-up**: market can be built from observable units and assumptions.
- **Value-based**: estimate from value created rather than published market total.

Use mixed approach only when cross-checking would materially improve confidence.

#### 3. Gather Sources For The Inputs

Start with user-named sources. Then use strongest available evidence for each major input. When an input depends on the outside market, use public sources for benchmarks, population estimates, comparable markets, or proxy assumptions.

If the strongest source is unavailable, continue with a transparent proxy assumption only when the estimate is still useful. Label the gap.

#### 4. Separate Facts From Assumptions

Keep sourced facts, inferred estimates, and judgment calls distinct. When exact data is unavailable, use a defensible proxy, explain why it is reasonable, and note confidence level.

#### 5. Build The Model

Make the model easy to inspect and adjust:
- Market definition and measurement unit
- Assumptions and source context
- Calculation chain and derived values
- Base case, material ranges, and sensitivity logic
- Validation priorities

Keep derived values traceable to formulas rather than hardcoded outputs.

#### 6. Test Sensitivity

Identify assumptions that move the estimate most. Show how the estimate changes when those assumptions vary. Prefer simple, decision-useful sensitivity over exhaustive scenario sprawl.

Use ranges when uncertainty is material. Do not hide uncertainty behind a single point estimate.

#### 7. State The Estimate And Validation Priorities

Close with:
- Market definition
- Estimate or range
- Method
- Main uncertainty drivers
- Sensitivity takeaways
- Validation priorities
- Practical interpretation for the user's decision
