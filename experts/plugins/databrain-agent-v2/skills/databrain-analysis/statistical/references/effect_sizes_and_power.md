# Effect Sizes and Power Analysis

Guidance on effect sizes and power. For t-test/ANOVA: use scipy + pandas (or stat-* references). Power analysis uses statsmodels.stats.power; for regression + power, load **stat-regression** or **stat-diagnostics** reference.

## Why Effect Sizes Matter

1. **Statistical significance ≠ practical significance**: p-values only tell if an effect exists, not how large it is
2. **Sample size dependent**: With large BI samples, trivial effects become "significant" — focus on effect size
3. **Interpretation**: Effect sizes provide magnitude; in A/B tests, even d = 0.2 can be business-relevant for conversion
4. **Power analysis**: Use for A/B planning (required n for desired detectable effect)

**Golden rule**: ALWAYS report effect sizes alongside p-values.

## BI Context

For A/B tests, benchmarking, channel comparison: report Cohen's d (or η² for ANOVA) with 95% CI. Benchmarks (small 0.2, medium 0.5, large 0.8) are guidelines; business impact depends on metric (e.g., 2% conversion lift may be meaningful).

---

## Effect Sizes by Analysis Type

### T-Tests and Mean Differences

#### Cohen's d (Standardized Mean Difference)

**Formula**:
- Independent groups: d = (M₁ - M₂) / SD_pooled
- Paired groups: d = M_diff / SD_diff

**Interpretation** (Cohen, 1988):
- Small: |d| = 0.20
- Medium: |d| = 0.50
- Large: |d| = 0.80

**Context-dependent interpretation**:
- In education: d = 0.40 is typical for successful interventions
- In psychology: d = 0.40 is considered meaningful
- In medicine: Small effect sizes can be clinically important

**Python calculation**:
```python
import numpy as np
import scipy.stats as stats

# Independent: Cohen's d (manual)
mean_diff = np.mean(group1) - np.mean(group2)
pooled_std = np.sqrt((np.var(group1, ddof=1) + np.var(group2, ddof=1)) / 2)
cohens_d = mean_diff / pooled_std

# Paired: d = M_diff / SD_diff
cohens_d_paired = np.mean(pre - post) / np.std(pre - post, ddof=1)
```

**Confidence intervals for d**:
```python
n1, n2 = len(group1), len(group2)
se_d = np.sqrt((n1 + n2) / (n1 * n2) + cohens_d**2 / (2 * (n1 + n2)))
ci = (cohens_d - 1.96 * se_d, cohens_d + 1.96 * se_d)
```

---

#### Hedges' g (Bias-Corrected d)

**Why use it**: Cohen's d has slight upward bias with small samples (n < 20)

**Formula**: g = d × correction_factor, where correction_factor = 1 - 3/(4df - 1)

**Python calculation**:
```python
import numpy as np
df = len(group1) + len(group2) - 2
correction = 1 - 3 / (4 * df - 1)
hedges_g = cohens_d * correction
```

**Use Hedges' g when**:
- Sample sizes are small (n < 20 per group)
- Conducting meta-analyses (standard in meta-analysis)

---

#### Glass's Δ (Delta)

**When to use**: When one group is a control with known variability

**Formula**: Δ = (M₁ - M₂) / SD_control

**Use cases**:
- Clinical trials (use control group SD)
- When treatment affects variability

---

### ANOVA

#### Eta-squared (η²)

**What it measures**: Proportion of total variance explained by factor

**Formula**: η² = SS_effect / SS_total

**Interpretation**:
- Small: η² = 0.01 (1% of variance)
- Medium: η² = 0.06 (6% of variance)
- Large: η² = 0.14 (14% of variance)

**Limitation**: Biased with multiple factors (sums to > 1.0)

**Python calculation**:
```python
import pandas as pd
import numpy as np

# Eta-squared = SS_between / SS_total
grand_mean = df['value'].mean()
ss_total = ((df['value'] - grand_mean) ** 2).sum()
ss_between = df.groupby('group')['value'].apply(lambda x: len(x) * (x.mean() - grand_mean)**2).sum()
eta_squared = ss_between / ss_total
# Partial eta-squared = SS_effect / (SS_effect + SS_error); for one-way ANOVA same as eta²
```

---

#### Partial Eta-squared (η²_p)

**What it measures**: Proportion of variance explained by factor, excluding other factors

**Formula**: η²_p = SS_effect / (SS_effect + SS_error)

**Interpretation**: Same benchmarks as η²

**When to use**: Multi-factor ANOVA (standard in factorial designs)

**Python calculation**:
```python
# For factorial ANOVA: partial η² = SS_effect / (SS_effect + SS_error)
# Use statsmodels or manually compute from ANOVA table
```

---

#### Omega-squared (ω²)

**What it measures**: Less biased estimate of population variance explained

**Why use it**: η² overestimates effect size; ω² provides better population estimate

**Formula**: ω² = (SS_effect - df_effect × MS_error) / (SS_total + MS_error)

**Interpretation**: Same benchmarks as η², but typically smaller values

**Python calculation**:
```python
def omega_squared(aov_table):
    ss_effect = aov_table.loc[0, 'SS']
    ss_total = aov_table['SS'].sum()
    ms_error = aov_table.loc[aov_table.index[-1], 'MS']  # Residual MS
    df_effect = aov_table.loc[0, 'DF']

    omega_sq = (ss_effect - df_effect * ms_error) / (ss_total + ms_error)
    return omega_sq
```

---

#### Cohen's f

**What it measures**: Effect size for ANOVA (analogous to Cohen's d)

**Formula**: f = √(η² / (1 - η²))

**Interpretation**:
- Small: f = 0.10
- Medium: f = 0.25
- Large: f = 0.40

**Python calculation**:
```python
eta_squared = 0.06  # From ANOVA
cohens_f = np.sqrt(eta_squared / (1 - eta_squared))
```

**Use in power analysis**: Required for ANOVA power calculations

---

### Correlation

#### Pearson's r / Spearman's ρ

**Interpretation**:
- Small: |r| = 0.10
- Medium: |r| = 0.30
- Large: |r| = 0.50

**Important notes**:
- r² = coefficient of determination (proportion of variance explained)
- r = 0.30 means 9% shared variance (0.30² = 0.09)
- Consider direction (positive/negative) and context

**Python calculation**:
```python
import numpy as np
import scipy.stats as stats

# Pearson
r, p = stats.pearsonr(x, y)
# 95% CI for r via Fisher z-transform
n = len(x)
z = np.arctanh(r)
se_z = 1 / np.sqrt(n - 3)
ci_z = (z - 1.96 * se_z, z + 1.96 * se_z)
ci_r = (np.tanh(ci_z[0]), np.tanh(ci_z[1]))

# Spearman
rho, p = stats.spearmanr(x, y)
```

---

### Regression

#### R² (Coefficient of Determination)

**What it measures**: Proportion of variance in Y explained by model

**Interpretation**:
- Small: R² = 0.02
- Medium: R² = 0.13
- Large: R² = 0.26

**Context-dependent**:
- Physical sciences: R² > 0.90 expected
- Social sciences: R² > 0.30 considered good
- Behavior prediction: R² > 0.10 may be meaningful

**Python calculation**:
```python
from sklearn.metrics import r2_score
from statsmodels.api import OLS

# Using statsmodels
model = OLS(y, X).fit()
r_squared = model.rsquared
adjusted_r_squared = model.rsquared_adj

# Manual
r_squared = 1 - (SS_residual / SS_total)
```

---

#### Adjusted R²

**Why use it**: R² artificially increases when adding predictors; adjusted R² penalizes model complexity

**Formula**: R²_adj = 1 - (1 - R²) × (n - 1) / (n - k - 1)

**When to use**: Always report alongside R² for multiple regression

---

#### Standardized Regression Coefficients (β)

**What it measures**: Effect of one-SD change in predictor on outcome (in SD units)

**Interpretation**: Similar to Cohen's d
- Small: |β| = 0.10
- Medium: |β| = 0.30
- Large: |β| = 0.50

**Python calculation**:
```python
from scipy import stats

# Standardize variables first
X_std = (X - X.mean()) / X.std()
y_std = (y - y.mean()) / y.std()

model = OLS(y_std, X_std).fit()
beta = model.params
```

---

#### f² (Cohen's f-squared for Regression)

**What it measures**: Effect size for individual predictors or model comparison

**Formula**: f² = R²_AB - R²_A / (1 - R²_AB)

Where:
- R²_AB = R² for full model with predictor
- R²_A = R² for reduced model without predictor

**Interpretation**:
- Small: f² = 0.02
- Medium: f² = 0.15
- Large: f² = 0.35

**Python calculation**:
```python
# Compare two nested models
model_full = OLS(y, X_full).fit()
model_reduced = OLS(y, X_reduced).fit()

r2_full = model_full.rsquared
r2_reduced = model_reduced.rsquared

f_squared = (r2_full - r2_reduced) / (1 - r2_full)
```

---

### Categorical Data Analysis

#### Cramér's V

**What it measures**: Association strength for χ² test (works for any table size)

**Formula**: V = √(χ² / (n × (k - 1)))

Where k = min(rows, columns)

**Interpretation** (for k > 2):
- Small: V = 0.07
- Medium: V = 0.21
- Large: V = 0.35

**For 2×2 tables**: Use phi coefficient (φ)

**Python calculation**:
```python
from scipy.stats.contingency import association

# Cramér's V
cramers_v = association(contingency_table, method='cramer')

# Phi coefficient (for 2x2)
phi = association(contingency_table, method='pearson')
```

---

#### Odds Ratio (OR) and Risk Ratio (RR)

**For 2×2 contingency tables**:

|           | Outcome + | Outcome - |
|-----------|-----------|-----------|
| Exposed   | a         | b         |
| Unexposed | c         | d         |

**Odds Ratio**: OR = (a/b) / (c/d) = ad / bc

**Interpretation**:
- OR = 1: No association
- OR > 1: Positive association (increased odds)
- OR < 1: Negative association (decreased odds)
- OR = 2: Twice the odds
- OR = 0.5: Half the odds

**Risk Ratio**: RR = (a/(a+b)) / (c/(c+d))

**When to use**:
- Cohort studies: Use RR (more interpretable)
- Case-control studies: Use OR (RR not available)
- Logistic regression: OR is natural output

**Python calculation**:
```python
import statsmodels.api as sm

# From contingency table
odds_ratio = (a * d) / (b * c)

# Confidence interval
table = np.array([[a, b], [c, d]])
oddsratio, pvalue = stats.fisher_exact(table)

# From logistic regression
model = sm.Logit(y, X).fit()
odds_ratios = np.exp(model.params)  # Exponentiate coefficients
ci = np.exp(model.conf_int())  # Exponentiate CIs
```

---

### Bayesian Effect Sizes

#### Bayes Factor (BF)

**What it measures**: Ratio of evidence for alternative vs. null hypothesis

**Interpretation**:
- BF₁₀ = 1: Equal evidence for H₁ and H₀
- BF₁₀ = 3: H₁ is 3× more likely than H₀ (moderate evidence)
- BF₁₀ = 10: H₁ is 10× more likely than H₀ (strong evidence)
- BF₁₀ = 100: H₁ is 100× more likely than H₀ (decisive evidence)
- BF₁₀ = 0.33: H₀ is 3× more likely than H₁
- BF₁₀ = 0.10: H₀ is 10× more likely than H₁

**Classification** (Jeffreys, 1961):
- 1-3: Anecdotal evidence
- 3-10: Moderate evidence
- 10-30: Strong evidence
- 30-100: Very strong evidence
- >100: Decisive evidence

**Python calculation**:
```python
# scipy provides frequentist t-test; for Bayes Factor use JASP, R BayesFactor, or rpy2
import scipy.stats as stats
t_stat, p_val = stats.ttest_ind(group1, group2, equal_var=False)
# BF requires numerical integration; see dedicated Bayesian packages
```

---

## Power Analysis

### Concepts

**Statistical power**: Probability of detecting an effect if it exists (1 - β)

**Conventional standards**:
- Power = 0.80 (80% chance of detecting effect)
- α = 0.05 (5% Type I error rate)

**Four interconnected parameters** (given 3, can solve for 4th):
1. Sample size (n)
2. Effect size (d, f, etc.)
3. Significance level (α)
4. Power (1 - β)

---

### A Priori Power Analysis (Planning)

**Purpose**: Determine required sample size before study

**Steps**:
1. Specify expected effect size (from literature, pilot data, or minimum meaningful effect)
2. Set α level (typically 0.05)
3. Set desired power (typically 0.80)
4. Calculate required n

**Python implementation**:
```python
from statsmodels.stats.power import (
    tt_ind_solve_power,
    zt_ind_solve_power,
    FTestAnovaPower,
    NormalIndPower
)

# T-test power analysis
n_required = tt_ind_solve_power(
    effect_size=0.5,  # Cohen's d
    alpha=0.05,
    power=0.80,
    ratio=1.0,  # Equal group sizes
    alternative='two-sided'
)

# ANOVA power analysis
anova_power = FTestAnovaPower()
n_per_group = anova_power.solve_power(
    effect_size=0.25,  # Cohen's f
    ngroups=3,
    alpha=0.05,
    power=0.80
)

# Correlation power: use statsmodels FTestPower with r→f transform, or formula
# f² = r²/(1-r²); then FTestPower.solve_power(effect_size=f, ...)
```

---

### Post Hoc Power Analysis (After Study)

**⚠️ CAUTION**: Post hoc power is controversial and often not recommended

**Why it's problematic**:
- Observed power is a direct function of p-value
- If p > 0.05, power is always low
- Provides no additional information beyond p-value
- Can be misleading

**When it might be acceptable**:
- Study planning for future research
- Using effect size from multiple studies (not just your own)
- Explicit goal is sample size for replication

**Better alternatives**:
- Report confidence intervals for effect sizes
- Conduct sensitivity analysis
- Report minimum detectable effect size

---

### Sensitivity Analysis

**Purpose**: Determine minimum detectable effect size given study parameters

**When to use**: After study is complete, to understand study's capability

**Python implementation**:
```python
# What effect size could we detect with n=50 per group?
detectable_effect = tt_ind_solve_power(
    effect_size=None,  # Solve for this
    nobs1=50,
    alpha=0.05,
    power=0.80,
    ratio=1.0,
    alternative='two-sided'
)

print(f"With n=50 per group, we could detect d ≥ {detectable_effect:.2f}")
```

---

## Reporting Effect Sizes

### APA Style Guidelines

**T-test example**:
> "Group A (M = 75.2, SD = 8.5) scored significantly higher than Group B (M = 68.3, SD = 9.2), t(98) = 3.82, p < .001, d = 0.77, 95% CI [0.36, 1.18]."

**ANOVA example**:
> "There was a significant main effect of treatment condition on test scores, F(2, 87) = 8.45, p < .001, η²p = .16. Post hoc comparisons using Tukey's HSD revealed..."

**Correlation example**:
> "There was a moderate positive correlation between study time and exam scores, r(148) = .42, p < .001, 95% CI [.27, .55]."

**Regression example**:
> "The regression model significantly predicted exam scores, F(3, 146) = 45.2, p < .001, R² = .48. Study hours (β = .52, p < .001) and prior GPA (β = .31, p < .001) were significant predictors."

**Bayesian example**:
> "A Bayesian independent samples t-test provided strong evidence for a difference between groups, BF₁₀ = 23.5, indicating the data are 23.5 times more likely under H₁ than H₀."

---

## Effect Size Pitfalls

1. **Don't only rely on benchmarks**: Context matters; small effects can be meaningful
2. **Report confidence intervals**: CIs show precision of effect size estimate
3. **Distinguish statistical vs. practical significance**: Large n can make trivial effects "significant"
4. **Consider cost-benefit**: Even small effects may be valuable if intervention is low-cost
5. **Multiple outcomes**: Effect sizes vary across outcomes; report all
6. **Don't cherry-pick**: Report effects for all planned analyses
7. **Publication bias**: Published effects are often overestimated

---

## Quick Reference Table

| Analysis | Effect Size | Small | Medium | Large |
|----------|-------------|-------|--------|-------|
| T-test | Cohen's d | 0.20 | 0.50 | 0.80 |
| ANOVA | η², ω² | 0.01 | 0.06 | 0.14 |
| ANOVA | Cohen's f | 0.10 | 0.25 | 0.40 |
| Correlation | r, ρ | 0.10 | 0.30 | 0.50 |
| Regression | R² | 0.02 | 0.13 | 0.26 |
| Regression | f² | 0.02 | 0.15 | 0.35 |
| Chi-square | Cramér's V | 0.07 | 0.21 | 0.35 |
| Chi-square (2×2) | φ | 0.10 | 0.30 | 0.50 |

---

## Resources

- Cohen, J. (1988). *Statistical Power Analysis for the Behavioral Sciences* (2nd ed.)
- Lakens, D. (2013). Calculating and reporting effect sizes
- Ellis, P. D. (2010). *The Essential Guide to Effect Sizes*
