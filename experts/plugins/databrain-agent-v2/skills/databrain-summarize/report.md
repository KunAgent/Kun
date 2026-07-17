# Report presentation (analysis evidence in final Markdown)

Path: /skills/databrain-summarize/report.md

When: formal report or deep analysis (read `complete.md`) and context has sandbox statistical output, attribution tables, or drill-down prints. Does not replace SKILL.md layout rules.

## Role

Turn existing analysis evidence (tool numbers, execute_sandbox_code stdout, attribution prints) into user-readable prose. Do not invent p-values, effect sizes, or contribution shares.

## BI quick report (statistical tests)

When upstream has t-test, ANOVA, chi-square, regression, etc., the final answer must include (exact values from stdout; do not alter intervals):

1. Descriptives: mean/median per group (median if skewed), SD, n
2. Test: test name, statistic, df if any, exact p
3. Effect size: Cohen’s d, η², Cramér’s V, R², etc., plus 95% CI if printed
4. One line on method if relevant (e.g. Welch for unequal variance, Kruskal-Wallis if non-normal)
5. One conclusion line: significance plus business meaning—not only “p < .05”

Example (t-test): “Channel A revenue M=1250 (SD=320, n=50), B M=1080 (SD=290, n=48). Welch t(95.2)=2.78, p=.006, d=0.56 [0.15, 0.96]. A significantly higher than B.”

Example (ANOVA): “F(2,147)=6.2, p=.003, η²_p=.08; post-hoc: high-value > low-value (p=.001).”

- Opening may summarize core p/effect size (SKILL.md § General format bold rule).
- If chart-render finalized `<dbd>` for the same data_id: place per **SKILL.md § Chart placement**; do not duplicate the dataset in a large pipe table.

## Attribution summary (drill-down / drivers)

When upstream has attribution, contribution shares, joint drill, ATTRIBUTION_TABLE, or equivalent prints:

1. Numbers: contribution % or attribution_share / directional_share per named segment; joint dimensions as clear tuples (e.g. country × channel).
2. Top drivers: 3–5 largest segments with % and direction (up/down).
3. Optional reconcile: child φ sum aligns with parent Δ when additive.
4. Section title in user language: 「归因结论」 or "Attribution summary"—short prose or bullets, not a raw dump table alone.

Do not replace concrete % with “analysis completed.”

## Relation to simple / complete

- simple: if only a short test or attribution snippet, put core p or top contribution % in the opening; full report.md optional.
- complete: read this file when statistical or attribution evidence is present.

## Out of scope here

- Choosing tests or writing sandbox code (databrain-analysis).
- Long academic Methods sections (full reporting_standards stay in analysis references).
- Emphasizing failed or underpowered analysis modules (same as complete.md).
