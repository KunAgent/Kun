# Statistical Analysis (Workflow & Test Selection)

**Path:** `/skills/databrain-analysis/statistical/SKILL.md`

对齐 host `statistical-analysis`。在 sandbox 内用 `execute_sandbox_code` 实现；用 `read_file` 加载 references。

## Workflow

1. **已读** [`../SKILL.md`](../SKILL.md) 与本文件
2. **Data cleaning**: `read_file` → [`references/data_cleaning.md`](references/data_cleaning.md)；清洗后再检验
3. **选型** — 下表选定 reference 文件名
4. **Load reference**: `read_file` → `statistical/references/<name>.md`（如 `stat-t-test.md`）
5. **实验设计**: `read_file` → [`references/experimental_design.md`](references/experimental_design.md)；**先** `print` 研究问题、DV/IV、H0/H1、设计类型、选型依据、假设、α、样本量
6. **Implement** in `execute_sandbox_code`（遵循 reference 代码模式）
7. **Report in stdout**: 检验统计量、精确 p、效应量、CI（格式见 [`../../databrain-summarize/report.md`](../../databrain-summarize/report.md) BI Quick Report）

## 选型 (Test Selection)

### By question / data type

| Question | Data | Reference file |
|----------|------|----------------|
| Compare 2 groups (continuous) | 2 groups, normal or n>30 | `stat-t-test.md` |
| Compare 2 groups (continuous) | skewed / small n | `stat-nonparametric.md` |
| Compare 3+ groups | 3+ groups, continuous | `stat-anova.md` or `stat-nonparametric.md` |
| Categorical × categorical | 2 categorical | `stat-chi-square.md` |
| Y continuous, X predictors | Continuous outcome | `stat-regression.md` |
| Y binary | Binary outcome | `stat-logistic.md` |
| Y count | Count outcome | `stat-glm.md` |
| Time series / forecast | Time-ordered | `stat-time-series.md` |
| Regression diagnostics | Residuals / VIF | `stat-diagnostics.md` |

### Quick decision tree

- **2 groups, continuous** → `stat-t-test.md` (or `stat-nonparametric.md` if skewed)
- **3+ groups, continuous** → `stat-anova.md` or `stat-nonparametric.md`
- **Categorical × categorical** → `stat-chi-square.md`
- **Y continuous, X** → `stat-regression.md`
- **Y binary** → `stat-logistic.md`
- **Y count** → `stat-glm.md`
- **Time series** → `stat-time-series.md`

## Available references

| File | Content |
|------|---------|
| `data_cleaning.md` | Missing, duplicates, invalid values |
| `stat-t-test.md` | Independent/paired t-test, Welch |
| `stat-anova.md` | One-way ANOVA, Welch, Tukey |
| `stat-chi-square.md` | Chi-square, Fisher |
| `stat-nonparametric.md` | Mann-Whitney, Wilcoxon, Kruskal-Wallis |
| `stat-regression.md` | OLS, VIF (statsmodels) |
| `stat-logistic.md` | Logit, Probit |
| `stat-glm.md` | Poisson, NB |
| `stat-time-series.md` | ARIMA, stationarity |
| `stat-diagnostics.md` | Breusch-Pagan, DW, VIF |
| `assumptions_and_diagnostics.md` | Normality, homogeneity |
| `effect_sizes_and_power.md` | Effect sizes, power |
| `experimental_design.md` | 实验设计输出模板 |
| `reporting_standards.md` | 完整报告规范（终稿优先用 summarize `report.md`） |
| `bayesian_statistics.md` | Bayesian (optional) |
| `code_examples.md` | 示例 |

## Assumption checking

BI 指标常右偏。可参考 `scripts/assumption_checks.py` 逻辑在 sandbox 中实现，或各 `stat-*` reference 内检查。

## Effect sizes

须报告：Cohen's d (t-test)、η² (ANOVA)、Cramér's V (chi-square)、R² (regression)。见 `effect_sizes_and_power.md`。

## Best practices

- **先** 实验设计 **再** 跑检验
- **先** 清洗 **再** 选型
- 区分统计显著 vs 业务意义；偏态优先 Welch / 非参
- 与 **drilldown** 配合：下钻定位切片后，再对子集做 formal test
