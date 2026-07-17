# Experimental Design Output (实验设计逻辑)

## Overview

**Always output the experimental design logic BEFORE running the test.** This enables users to evaluate correctness of the design and test selection.

## Required Output Template

Print the following structure before analysis results:

```
=== 实验设计 / Experimental Design ===
1. 研究问题 (Research Question): [What are we testing?]
2. 变量 (Variables):
   - 因变量 (DV): [e.g. revenue, retention]
   - 自变量/分组 (IV/Group): [e.g. channel, region]
3. 假设 (Hypotheses):
   - H0 (零假设): [e.g. μ_A = μ_B]
   - H1 (备择假设): [e.g. μ_A ≠ μ_B, two-tailed]
4. 设计类型 (Design): [e.g. Independent t-test, One-way ANOVA]
5. 选型依据 (Test Selection Rationale): [Why this test? e.g. 2 groups, continuous DV, Welch for unequal variance]
6. 前提假设 (Assumptions): [Normality, homogeneity of variance, etc.] — [Checked / Assumed]
7. 显著性水平 (α): 0.05
8. 样本量 (n): Group A = n1, Group B = n2
=== 分析结果 / Results ===
...
```

## Python Implementation

```python
# OUTPUT EXPERIMENTAL DESIGN LOGIC FIRST (before running test)
print("=== 实验设计 / Experimental Design ===")
print("1. 研究问题: 比较 Channel A 与 Channel B 的收入是否有显著差异")
print("2. 变量: DV=revenue, IV=channel (A vs B)")
print("3. 假设: H0: μ_A=μ_B, H1: μ_A≠μ_B (two-tailed)")
print("4. 设计类型: Independent-samples t-test (Welch)")
print("5. 选型依据: 2组独立样本、连续型DV、方差不齐用Welch")
print("6. 前提假设: 正态性(n>30可放宽)、独立性 — 已满足")
print("7. α = 0.05")
print(f"8. 样本量: A={len(g1)}, B={len(g2)}")
print("=== 分析结果 / Results ===")
# Then run t-test and print results...
```

## Design Logic by Test Type

### T-Test
- Design: Independent (two unrelated groups) or Paired (before/after, matched)
- H0: μ₁ = μ₂
- Rationale: 2 groups, continuous DV; Welch if unequal variance

### ANOVA
- Design: One-way (one factor, 3+ levels) or Factorial
- H0: μ₁ = μ₂ = ... = μₖ
- Rationale: 3+ groups, continuous DV; Tukey for post-hoc

### Chi-Square
- Design: Categorical association (2×2 or r×c table)
- H0: No association between variables
- Rationale: Both IV and DV categorical

### Non-Parametric
- Design: Same as t-test/ANOVA but no normality assumption
- Rationale: Data skewed or ordinal; use Mann-Whitney, Kruskal-Wallis

## Correctness Checklist (评估依据)

When reviewing the output, verify:
1. **Research question** matches user's intent
2. **Variables** correctly identified (DV, IV)
3. **H0/H1** appropriate for the question
4. **Test choice** matches design (2 groups→t-test, 3+→ANOVA, categorical→chi-square)
5. **Assumptions** checked or stated
6. **Sample size** sufficient (n>30 per group for t-test robustness)
