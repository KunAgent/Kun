---
name: data-quality-assessment
description: "Assess whether datasets are trustworthy for analysis, modeling, dashboards, or pipelines; and validate finished analyses before sharing. Use for data quality checks (grain, freshness, nulls, duplicates, schema drift, joins, integrity, distributions) and analysis QA (methodology review, calculation verification, visualization checks, confidence assessment)."
---

# Data Quality Assessment & Analysis Validation

Two complementary capabilities: (1) assess whether a dataset is trustworthy enough for its intended use, and (2) validate a finished analysis before it is shared with stakeholders.

## Part A: Data Quality Assessment

Assess whether a dataset is trustworthy enough for analysis, modeling, dashboards, experiments, or downstream pipelines. Start with the intended use and grain, run the highest-value checks for the data shape, and report concrete evidence, analytical risk, likely causes, and the smallest useful remediation or automated test.

### Workflow

1. **Clarify the quality question and operating context.**

   Establish what the dataset represents, the intended unit of analysis, the downstream use, whether the user cares about raw ingestion quality, transformed-model quality, or both, and the comparison baseline. Identify expected grain, primary keys, important date columns, timezone assumptions, domain rules, allowed values, and business thresholds. If context is missing, infer cautiously and label assumptions.

2. **Choose an inspectable analysis path.**

   When checks require SQL or Python, default to a companion notebook or script so the user can inspect the exact code behind the findings. For queryable tables, confirm schema, grain, sample rows, and query rules before heavier checks.

3. **Build a compact profile.**

   Start with row count, column count, column names and types, candidate keys, duplicate rates on likely identifiers, min/max timestamps, null rates, distinct counts for categorical columns, and basic numeric summaries. Confirm grain before interpreting anomalies; many apparent quality problems are mixed-grain data, partial backfills, late-arriving data, or duplicated joins.

4. **Run core quality checks.**

   Select checks that match the dataset and task across completeness, uniqueness, validity, consistency, integrity, timeliness, volume, and shape. Compare rates, not just counts, and segment by time, source, country, platform, or other key dimensions when that helps distinguish real issues from expected variation.

5. **Run shape-specific checks.**

   Adapt the checks to the data shape:
   - **Event data**: duplicate event IDs, future timestamps, coverage gaps, abrupt event-mix changes after releases.
   - **Dimension tables**: non-unique business keys, orphan surrogate keys, status changes without timestamps, unexpected churn in reference values.
   - **Fact tables**: mixed grain, impossible measures (negative revenue/quantity), join blowups, late-arriving partitions.
   - **ML feature tables**: leakage from post-outcome fields, feature sparsity spikes, range shifts, class-label drift.
   - **Experiment data**: duplicate assignments, variant imbalance, exposure without assignment, events before assignment.

6. **Run temporal and distribution checks when history exists.**

   Prioritize temporal diagnostics when the user mentions "after X date", "suddenly", "recently". Check first-seen/last-seen dates, daily null-rate trends, duplicate-rate trends, row count trends, category-share shifts, distribution drift, and change points around launches, migrations, or incidents.

7. **Investigate analytical risks and likely causes.**

   Tie each issue to downstream risk: broken analysis, biased decisions, broken joins, stale dashboards, incorrect experiments, leakage, or misleading segments. Identify whether the issue is isolated to a source, segment, partition, time window, or pipeline change.

8. **Recommend fixes or automated tests.**

   Recommend the smallest set of fixes, monitoring, or automated tests that would materially reduce risk. Suggest automation only when the rule is stable and worth maintaining.

### Core Check Categories

- **Completeness**: null rate by column/partition/segment; unexpected empty strings or sentinel values; required-column population rate.
- **Uniqueness**: exact duplicate rows, duplicate primary keys, duplicate composite keys, proportion unique for semi-unique fields.
- **Validity**: type conformance; format checks for IDs, emails, URLs, enums, timestamps; range checks for measures and dates; allowed-values checks.
- **Consistency**: cross-field rule checks, units/currency consistency, status-timestamp alignment, agreement between duplicated fields.
- **Integrity**: parent-child key coverage, orphan records, unexpected many-to-many joins, broken SCD joins.
- **Timeliness**: freshness lag, missing recent partitions, unexplained historical rewrites or backfills.
- **Volume and shape**: row-count drift, distinct-count drift, distribution drift, share-of-total drift, new/disappeared categories.

### Severity Classification

- **Critical**: breaks trusted analysis, core joins, production dashboards, or key decisions.
- **High**: materially biases downstream decisions (large null spikes, category drift, leakage).
- **Medium**: localized or explainable issues needing documentation or monitoring.
- **Low**: cosmetic inconsistencies, expected sparsity, or known edge cases.

### Automated Test Guidance

Good candidates: primary key uniqueness, not-null checks on required columns, accepted values for stable enums, referential integrity, freshness thresholds, seasonality-aware row-count bounds.

Use caution with: hard-coded distribution thresholds on volatile metrics, strict uniqueness in messy entity-resolution cases, recent partitions when late-arriving data is normal.

### Output Structure

1. Dataset and grain summary
2. Checks performed
3. Findings (with evidence: counts, rates, segments, dates)
4. Temporal or trend anomalies
5. Likely causes and impacted use cases
6. Recommended fixes or automated tests
7. Assumptions and open questions

---

## Part B: Analysis Validation (QA)

Validate an analysis before sharing with stakeholders. Focus on whether the question, data, methodology, calculations, visuals, claims, caveats, and recommendations are trustworthy enough for the stated audience and decision.

### Workflow

1. **Inventory the artifact and claims.**

   Identify the report, notebook, spreadsheet, SQL, dashboard, or recommendation being validated. Extract the main question, audience, decision, key claims, headline numbers, data sources, time windows, populations, filters, and stated caveats.

2. **Validate question, methodology, and assumptions.**

   Confirm the analysis answers the stated question (not a nearby easier one). Check population, eligibility rules, exclusions, sampling, metric definitions, formulas, units, denominators, timezones, cohorts, comparison periods, and baselines.

3. **Validate data selection and quality risks.**

   Confirm that chosen tables/files are appropriate and current. Check freshness, partitions, segment coverage, completeness, null handling, deduplication, filter logic, and join coverage.

4. **Verify calculations and aggregations.**

   Recompute highest-impact numbers independently. Check grain, subtotals, denominators, rate bases, period-over-period bases, weighted averages, units, and whether categories add to totals. For SQL, inspect join types, group-by grain, filters, distinct counts.

5. **Test reasonableness and common traps.**

   Compare magnitudes against known baselines. Investigate trend jumps, flatlines, exact round numbers, 0%/100% rates. Check edge cases.

6. **Review visuals and presentation integrity.**

   Confirm charts use appropriate types, scales, axes, titles, labels, ordering, and color. Check whether a quick reader could get a misleading interpretation.

7. **Evaluate narrative, conclusions, and recommendations.**

   Confirm conclusions are supported by evidence. Separate findings from interpretation. Identify alternative explanations and unsupported causal language.

8. **Produce confidence assessment and required fixes.**

   Prioritize issues by decision impact.

### Common Pitfalls

- **Join explosion**: many-to-many joins silently multiply rows.
- **Survivorship bias**: only includes entities that exist today.
- **Incomplete period comparison**: partial vs. complete period.
- **Denominator shifting**: eligible population changes between compared groups.
- **Average of averages**: pre-computed averages averaged without weighting.
- **Timezone mismatch**: different timestamp conventions or cutoffs.
- **Selection bias**: segments defined by the outcome being measured.
- **Simpson's paradox**: aggregate and segment-level trends conflict.

### Confidence Ratings

- **Ready to share**: Methodologically sound, key calculations verified, caveats clear.
- **Share with caveats**: Directionally usable but specific limitations must be communicated.
- **Needs revision**: Material errors, unsupported claims, or methodological issues.

### Validation Report Template

```markdown
## Validation Report

### Overall Assessment: [Ready to share | Share with caveats | Needs revision]

### Methodology Review
[Findings about question framing, data selection, population, definitions, comparisons.]

### Issues Found
1. [Severity: High/Medium/Low] [Issue, evidence, and impact]

### Calculation Spot-Checks
- [Metric]: [Verified / Discrepancy found / Not verified] - [evidence]

### Visualization Review
[Chart or presentation issues, if applicable.]

### Suggested Improvements
1. [Improvement and why it matters]

### Required Caveats for Stakeholders
- [Caveat that must be communicated]
```
