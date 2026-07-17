# ANOVA (One-Way and Welch)

## Overview

One-way ANOVA tests whether means of three or more independent groups differ. Use when comparing continuous outcomes across multiple categories (e.g., channels, regions, segments). **Welch ANOVA** relaxes equal-variance assumption. Follow with **post-hoc** tests (e.g., Tukey HSD) to identify which pairs differ when overall test is significant.

## When to Use

- Comparing means of 3+ independent groups on a continuous outcome
- Channel Effectiveness: compare CAC, LTV, retention across channels
- Regional Sentiment Gap: compare sentiment scores across regions
- Segmentation: compare metrics across user segments
- Cohort Analysis: compare retention/engagement across cohorts

**BI examples:**
- Revenue by platform (Steam, iOS, Android)
- Retention rate by acquisition channel
- DAU by region (US, EU, APAC)

## Data Requirements

- **Outcome**: Continuous
- **Factor**: Categorical with 3+ levels
- **Independence**: Observations independent; one per group
- **Normality**: Approximately normal per group (or n > 30 per group)
- **Equal variance**: For standard ANOVA; use Welch if violated

## Assumption Check

1. **Normality**: Shapiro-Wilk per group or Q-Q. If violated, use stat-nonparametric (Kruskal-Wallis).
2. **Homogeneity of variance**: Levene's test. If violated, use Welch ANOVA.
3. **Outliers**: Check for extreme values that could inflate variance.

## Code Example

```python
import pandas as pd
import numpy as np
import scipy.stats as stats
from statsmodels.stats.multicomp import pairwise_tukeyhsd

# One-way ANOVA (scipy)
groups = [df[df['group'] == g]['value'].values for g in df['group'].unique()]
f_stat, p_val = stats.f_oneway(*groups)
print(f"F = {f_stat:.2f}, p = {p_val:.4f}")

# Partial eta-squared: SS_between / SS_total
grand_mean = df['value'].mean()
ss_total = ((df['value'] - grand_mean) ** 2).sum()
ss_between = df.groupby('group')['value'].apply(lambda x: len(x) * (x.mean() - grand_mean)**2).sum()
partial_eta2 = ss_between / ss_total
print(f"Partial η² = {partial_eta2:.3f}")

# Post-hoc: Tukey HSD (when ANOVA is significant)
if p_val < 0.05:
    tukey = pairwise_tukeyhsd(df['value'], df['group'], alpha=0.05)
    print(tukey)

# If homogeneity of variance violated: use Kruskal-Wallis (stat-nonparametric)
# stats.levene(*groups)  # check first
```

## Effect Size

**Partial η² (eta-squared):**
- Small: 0.01, Medium: 0.06, Large: 0.14
- Interpret as proportion of variance explained by group

**Post-hoc**: Report pairwise differences with confidence intervals; correct for multiple comparisons (Tukey, Games-Howell).

## Interpretation

- **p < 0.05**: At least one group differs. Use post-hoc to identify which pairs.
- **p ≥ 0.05**: No evidence of differences. Do not run post-hoc.
- Report descriptive stats (M, SD, n) per group and effect size.
