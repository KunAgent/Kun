# Non-Parametric Tests (Mann-Whitney, Wilcoxon, Kruskal-Wallis, Friedman)

## Overview

Non-parametric tests do not assume normality. Use when data are skewed, ordinal, or sample size is small. **Mann-Whitney U** replaces independent t-test; **Wilcoxon signed-rank** replaces paired t-test; **Kruskal-Wallis** replaces one-way ANOVA; **Friedman** replaces repeated-measures ANOVA.

## When to Use

- Data non-normal or severely skewed (e.g., revenue, DAU often right-skewed)
- Ordinal outcomes (e.g., satisfaction ratings)
- Small samples (n < 30 per group)
- Outliers present that distort mean-based tests

**BI examples:**
- Revenue by channel (typically skewed)
- Sentiment scores across regions (ordinal or non-normal)
- Retention rates with outliers

## Data Requirements

- **Outcome**: Continuous or ordinal
- **Groups**: 2 (Mann-Whitney, Wilcoxon) or 3+ (Kruskal-Wallis, Friedman)
- **Independence**: Within and between groups (except paired: Wilcoxon, Friedman)

## Assumption Check

- Fewer assumptions than parametric tests
- **Independence** still required
- **Ordinal/continuous**: Test compares distributions/ranks, not means

## Code Example

```python
import pandas as pd
import numpy as np
import scipy.stats as stats

# Mann-Whitney U (two independent groups)
u_stat, p_val = stats.mannwhitneyu(group_a, group_b, alternative='two-sided')
print(f"Mann-Whitney U = {u_stat}, p = {p_val:.4f}")

# Rank-biserial effect size: r = 1 - 2*U/(n1*n2)
n1, n2 = len(group_a), len(group_b)
rank_biserial = 1 - 2 * u_stat / (n1 * n2)
print(f"Rank-biserial r = {rank_biserial:.3f}")

# Wilcoxon signed-rank (two paired groups)
w_stat, p_val = stats.wilcoxon(before, after)
print(f"Wilcoxon W = {w_stat}, p = {p_val:.4f}")

# Kruskal-Wallis (3+ independent groups)
groups = [df[df['group'] == g]['value'] for g in df['group'].unique()]
h_stat, p_val = stats.kruskal(*groups)
print(f"Kruskal-Wallis H = {h_stat:.2f}, p = {p_val:.4f}")

# Post-hoc: Dunn's test - use scipy pairwise Mann-Whitney with Bonferroni, or report medians
```

## Effect Size

- **Mann-Whitney**: Rank-biserial r = 1 - 2*U/(n1*n2); report medians and IQR
- **Kruskal-Wallis**: Epsilon-squared (ε²) = (H - k + 1)/(n - k) or report median differences

## Interpretation

- **p < 0.05**: Distributions differ; at least one group tends to have higher/lower values
- Non-parametric tests compare **distributions/ranks**, not means; report medians and IQR
- When parametric assumptions hold, parametric tests are more powerful; use non-parametric when in doubt about normality
