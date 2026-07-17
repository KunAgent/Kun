# Chi-Square and Fisher's Exact Test

## Overview

Chi-square test of independence evaluates whether two categorical variables are associated. Use for contingency tables (e.g., region × sentiment, treatment × conversion). **Fisher's exact test** is used when expected counts are small (< 5) or for 2×2 tables.

## When to Use

- Testing independence of two categorical variables
- Comparing proportions across groups (e.g., conversion rate by channel)
- A/B experiments with binary outcome (converted vs not)
- Regional sentiment: sentiment (positive/negative) by region
- Benchmarking: proportion comparisons (e.g., market share vs benchmark)

**BI examples:**
- Sentiment distribution (positive/neutral/negative) differs by region?
- Conversion rate differs between treatment and control?
- Category mix differs across platforms?

## Data Requirements

- **Variables**: Both categorical (nominal or ordinal)
- **Table**: Contingency table (cross-tabulation)
- **Expected counts**: Each cell expected count ≥ 5 for chi-square; otherwise use Fisher's exact

## Assumption Check

1. **Expected counts**: Chi-square requires expected count ≥ 5 per cell. If any < 5, use Fisher's exact.
2. **Independence**: Each observation belongs to one cell only; observations are independent.

## Code Example

```python
import pandas as pd
import scipy.stats as stats
import numpy as np

# Contingency table: rows = region, cols = sentiment (positive/negative)
# Example: 3 regions × 2 sentiment levels
table = pd.crosstab(df['region'], df['sentiment'])
print(table)

# Chi-square test
chi2, p_value, dof, expected = stats.chi2_contingency(table)
print(f"Chi-square = {chi2:.2f}, df = {dof}, p = {p_value:.4f}")
print("Expected counts:\n", expected)

# Cramér's V (effect size)
n = table.sum().sum()
min_dim = min(table.shape) - 1
cramers_v = np.sqrt(chi2 / (n * min_dim))
print(f"Cramér's V = {cramers_v:.3f}")

# Fisher's exact (for 2×2 tables when expected < 5)
if table.shape == (2, 2):
    odds_ratio, p_fisher = stats.fisher_exact(table)
    print(f"Fisher's exact p = {p_fisher:.4f}, odds ratio = {odds_ratio:.3f}")

# From raw DataFrame
contingency = pd.crosstab(df['group'], df['outcome'])
chi2, p, dof, exp = stats.chi2_contingency(contingency)
```

## Effect Size

**Cramér's V:**
- 2×2 table: use phi (same as Cramér's V)
- Interpretation: Small 0.07, Medium 0.21, Large 0.35
- Formula: √(χ² / (n × min(r-1, c-1)))

**Odds ratio** (2×2, Fisher): Interpret as odds of outcome in one group vs another.

## Interpretation

- **p < 0.05**: Reject independence; variables are associated.
- **p ≥ 0.05**: No evidence of association.
- Report Cramér's V for strength of association; chi-square alone does not indicate magnitude.
