# Statistical Analysis Code Examples

Quick snippets. For full implementation `read_file` `/skills/databrain-analysis/statistical/references/stat-t-test.md` (or stat-anova, stat-regression, data_cleaning, etc.).

## Data Cleaning (run before analysis)

```python
import pandas as pd
import numpy as np

# 1. Inspect
print(df.columns.tolist())
print(df.isnull().sum())

# 2. Drop missing in analysis columns
df_clean = df.dropna(subset=['revenue', 'channel'])

# 3. Remove invalid (e.g. negative revenue)
df_clean = df_clean[df_clean['revenue'] >= 0]

# 4. Optional: remove duplicates
df_clean = df_clean.drop_duplicates()

# 5. Ensure numeric
df_clean['revenue'] = pd.to_numeric(df_clean['revenue'], errors='coerce')
df_clean = df_clean.dropna(subset=['revenue'])
```

Load **data_cleaning** reference for full workflow (outliers, winsorize, reporting).

## T-Test from DataFrame (BI: e.g. revenue by channel)

**Always output 实验设计 before running the test.** Load **experimental_design** reference for the full template.

```python
import pandas as pd
import numpy as np
import scipy.stats as stats

# df has columns: revenue, channel (or value, group)
g1 = df[df['channel'] == 'A']['revenue'].dropna()
g2 = df[df['channel'] == 'B']['revenue'].dropna()
n1, n2 = len(g1), len(g2)

# OUTPUT EXPERIMENTAL DESIGN FIRST (before test)
print("=== 实验设计 / Experimental Design ===")
print("1. 研究问题: 比较 Channel A 与 Channel B 的收入是否有显著差异")
print("2. 变量: DV=revenue, IV=channel (A vs B)")
print("3. 假设: H0: μ_A=μ_B, H1: μ_A≠μ_B (two-tailed)")
print("4. 设计类型: Independent-samples t-test (Welch)")
print("5. 选型依据: 2组独立样本、连续型DV、方差不齐用Welch")
print("6. 前提假设: 正态性(n>30可放宽)、独立性 — 已满足")
print("7. α = 0.05")
print(f"8. 样本量: A={n1}, B={n2}")
print("=== 分析结果 / Results ===")

t_stat, p_val = stats.ttest_ind(g1, g2, equal_var=False)  # Welch when unequal variance

# Cohen's d (pooled SD)
pooled_std = np.sqrt((g1.var(ddof=1) + g2.var(ddof=1)) / 2)
cohens_d = (g1.mean() - g2.mean()) / pooled_std
se_d = np.sqrt((n1 + n2) / (n1 * n2) + cohens_d**2 / (2 * (n1 + n2)))
ci95 = (cohens_d - 1.96 * se_d, cohens_d + 1.96 * se_d)

print(f"Welch t = {t_stat:.2f}, p = {p_val:.4f}")
print(f"Cohen's d = {cohens_d:.2f}, 95% CI [{ci95[0]:.2f}, {ci95[1]:.2f}]")
```

## Chi-Square from DataFrame (BI: e.g. sentiment by region)

**Output 实验设计 before running.** Example: research question, variables, H0 (no association), H1 (association), chi-square rationale.

```python
import pandas as pd
import scipy.stats as stats
import numpy as np

# Contingency table: region x sentiment
table = pd.crosstab(df['region'], df['sentiment'])
chi2, p, dof, expected = stats.chi2_contingency(table)
n = table.sum().sum()
cramers_v = np.sqrt(chi2 / (n * (min(table.shape) - 1)))
print(f"Chi-square = {chi2:.2f}, p = {p:.4f}, Cramér's V = {cramers_v:.3f}")
```

## ANOVA from DataFrame (BI: e.g. retention by channel)

**Output 实验设计 before running.** Example: research question, DV=retention, IV=channel, H0: μ₁=μ₂=...=μₖ, H1: at least one differs, ANOVA rationale, sample sizes.

```python
import pandas as pd
import numpy as np
import scipy.stats as stats
from statsmodels.stats.multicomp import pairwise_tukeyhsd

# df has columns: retention, channel (or value, group)
print("=== 实验设计 / Experimental Design ===")
print("1. 研究问题: 比较多渠道的留存率是否有显著差异")
print("2. 变量: DV=retention, IV=channel")
print("3. 假设: H0: μ₁=μ₂=...=μₖ, H1: 至少一组不同")
print("4. 设计类型: One-way ANOVA")
print("5. 选型依据: 3+组、连续型DV")
print("6. 前提假设: 正态性、方差齐性 — 已检查")
print("7. α = 0.05")
print(f"8. 样本量: {df.groupby('channel').size().to_dict()}")
print("=== 分析结果 / Results ===")

groups = [df[df['channel'] == g]['retention'].values for g in df['channel'].unique()]
f_stat, p_val = stats.f_oneway(*groups)
print(f"F = {f_stat:.2f}, p = {p_val:.4f}")

# Partial eta-squared: SS_between / SS_total
grand_mean = df['retention'].mean()
ss_total = ((df['retention'] - grand_mean) ** 2).sum()
ss_between = df.groupby('channel')['retention'].apply(lambda x: len(x) * (x.mean() - grand_mean)**2).sum()
partial_eta2 = ss_between / ss_total
print(f"Partial η² = {partial_eta2:.3f}")

if p_val < 0.05:
    tukey = pairwise_tukeyhsd(df['retention'], df['channel'], alpha=0.05)
    print(tukey)
```

For skewed data or unequal variance, use Kruskal-Wallis (stat-nonparametric).

## Linear Regression with Diagnostics

**→ Load stat-regression or stat-diagnostics reference** for OLS, VIF, diagnostics.

```python
import statsmodels.api as sm
from statsmodels.stats.outliers_influence import variance_inflation_factor
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

X = sm.add_constant(X_predictors)
model = sm.OLS(y, X).fit()
print(model.summary())

# VIF
vif_data = pd.DataFrame()
vif_data["Variable"] = X.columns
vif_data["VIF"] = [variance_inflation_factor(X.values, i) for i in range(X.shape[1])]
print(vif_data)

# Residual plots
residuals = model.resid
fitted = model.fittedvalues
fig, axes = plt.subplots(2, 2, figsize=(12, 10))
axes[0, 0].scatter(fitted, residuals, alpha=0.6)
axes[0, 0].axhline(y=0, color='r', linestyle='--')
axes[0, 0].set_xlabel('Fitted values')
axes[0, 0].set_ylabel('Residuals')
from scipy import stats
stats.probplot(residuals, dist="norm", plot=axes[0, 1])
axes[1, 0].scatter(fitted, np.sqrt(np.abs(residuals / residuals.std())), alpha=0.6)
axes[1, 1].hist(residuals, bins=20, edgecolor='black', alpha=0.7)
plt.tight_layout()
plt.show()
```

## Power Analysis (A Priori and Sensitivity)

Uses statsmodels.stats.power. Load **effect_sizes_and_power** reference for more.

```python
from statsmodels.stats.power import tt_ind_solve_power, FTestAnovaPower

# T-test: n needed for d = 0.5, power = 0.80
n_required = tt_ind_solve_power(effect_size=0.5, alpha=0.05, power=0.80, ratio=1.0, alternative='two-sided')
print(f"Required n per group: {n_required:.0f}")

# Sensitivity: with n=50, what d can we detect?
detectable_d = tt_ind_solve_power(effect_size=None, nobs1=50, alpha=0.05, power=0.80, ratio=1.0, alternative='two-sided')
print(f"Study could detect d ≥ {detectable_d:.2f}")

# ANOVA: n per group for f = 0.25
anova_power = FTestAnovaPower()
n_per_group = anova_power.solve_power(effect_size=0.25, ngroups=3, alpha=0.05, power=0.80)
print(f"Required n per group: {n_per_group:.0f}")
```

Load **effect_sizes_and_power** reference for effect sizes. Load stat-* references for implementation.
