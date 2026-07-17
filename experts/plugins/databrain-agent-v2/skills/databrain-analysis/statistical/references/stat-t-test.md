# T-Test (Independent and Paired)

## Overview

T-tests compare means of two groups. Use **independent t-test** when groups are unrelated (e.g., treatment vs control); use **paired t-test** when observations are matched (e.g., before vs after). **Welch's t-test** relaxes equal-variance assumption and is preferred by default.

## When to Use

- Comparing means of two groups on a continuous outcome
- A/B experiments: treatment vs control (ARPU, retention, conversion)
- Benchmarking: product vs industry/competitor benchmark
- Pricing/Offer analysis: pre vs post campaign metrics
- Launch/Event impact: before vs after metrics (with appropriate design)

**BI examples:**
- Channel A vs Channel B DAU
- Treatment vs control conversion rate (per-user)
- Revenue before vs after pricing change

## Data Requirements

- **Outcome**: Continuous (revenue, DAU, retention rate, etc.)
- **Groups**: Two levels (binary factor)
- **Sample size**: n > 30 per group for robustness to non-normality; smaller n requires normality check
- **Independence**: Observations independent within and between groups (paired: matched pairs)

## Assumption Check

1. **Normality**: Shapiro-Wilk or Q-Q plot. If violated and n < 30 per group, consider Mann-Whitney or Wilcoxon.
2. **Equal variance** (independent t-test): Levene's test. If violated, use Welch's t-test (`equal_var=False` in scipy).
3. **Paired t-test**: Same subjects measured twice; check for outliers in differences.

**When assumptions fail:** Use Welch's t-test (unequal variance) or stat-nonparametric.

## Code Example

```python
import pandas as pd
import numpy as np
import scipy.stats as stats

# Independent t-test (Welch - relaxes equal-variance assumption)
t_stat, p_value = stats.ttest_ind(group_a, group_b, equal_var=False)
print(f"Welch t = {t_stat:.2f}, p = {p_value:.4f}")

# Cohen's d and 95% CI
pooled_std = np.sqrt((np.var(group_a, ddof=1) + np.var(group_b, ddof=1)) / 2)
cohens_d = (np.mean(group_a) - np.mean(group_b)) / pooled_std
n1, n2 = len(group_a), len(group_b)
se_d = np.sqrt((n1 + n2) / (n1 * n2) + cohens_d**2 / (2 * (n1 + n2)))
ci = (cohens_d - 1.96 * se_d, cohens_d + 1.96 * se_d)
print(f"Cohen's d = {cohens_d:.2f}, 95% CI [{ci[0]:.2f}, {ci[1]:.2f}]")

# From DataFrame (long format)
g1 = df[df['group'] == 'A']['value']
g2 = df[df['group'] == 'B']['value']
t_stat, p_value = stats.ttest_ind(g1, g2, equal_var=False)

# Paired t-test (before vs after)
t_stat_paired, p_paired = stats.ttest_rel(before, after)
cohens_d_paired = np.mean(before - after) / np.std(before - after, ddof=1)
print(f"Paired t = {t_stat_paired:.2f}, p = {p_paired:.4f}, d = {cohens_d_paired:.2f}")
```

## Effect Size

**Cohen's d:**
- Small: 0.20, Medium: 0.50, Large: 0.80
- Always report 95% CI for d
- Use pooled SD: d = (M₁ - M₂) / SD_pooled; CI via SE_d = sqrt((n1+n2)/(n1*n2) + d²/(2*(n1+n2)))

## Interpretation

- **p < 0.05**: Reject null; groups differ. Report mean difference and CI.
- **p ≥ 0.05**: No evidence of difference. Do not claim "no difference"; report CI width.
- **Practical significance**: Large samples can yield significant but trivial effects. Use effect size.
