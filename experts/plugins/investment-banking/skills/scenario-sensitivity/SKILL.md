---
name: scenario-sensitivity
description: |
  Generate scenario analyses, sensitivity tables, and stress tests for financial models. Builds 2D data tables, tornado charts, and Monte Carlo-style output ranges.
  Triggers on "敏感性分析", "情景分析", "压力测试", "scenario analysis", "sensitivity table", "stress test", "data table", "what-if analysis", "tornado chart".
---

# Scenario & Sensitivity（情景与敏感性分析）

## 功能说明

为财务模型生成情景分析、敏感性表（Data Table）和压力测试，帮助决策者理解关键变量对结果的影响范围。

## 工作流

### Step 1: 明确分析目标

- 目标输出变量（被解释变量）：
  - 估值类：Enterprise Value / Equity Value / Per Share Value
  - 回报类：IRR / MOIC / NPV
  - 信贷类：Leverage / Coverage / Recovery Rate
  - 运营类：EBITDA Margin / FCF / Revenue
- 关键输入变量（解释变量）选择

### Step 2: 情景定义

**标准三情景：**

| 情景 | 定义 | 概率权重（参考） |
|------|------|----------------|
| Bull Case | 多数假设向好 | 20-25% |
| Base Case | 最可能情景 | 50-60% |
| Bear Case | 多数假设走弱 | 20-25% |

**扩展情景（如适用）：**
- Management Case（管理层预测）
- Street Case（市场共识）
- Downside Case（严重不利）
- Stress/Doomsday Case（极端压力）

**每个情景须定义：**
- Revenue Growth 假设
- Margin 假设
- CapEx 假设
- Working Capital 假设
- Exit Multiple / Terminal 假设
- 其他关键变量

### Step 3: 一维敏感性（Tornado Chart）

选择 Top 5-8 个影响最大的变量：
- 每个变量设定 ±区间（如 EBITDA ±20%）
- 固定其他变量为 Base Case
- 计算目标输出变化幅度
- 按影响大小排列（最大影响在上）

### Step 4: 二维敏感性表（Data Table）

**常见组合：**

| 行变量 | 列变量 | 输出 | 适用场景 |
|--------|--------|------|---------|
| WACC | Terminal Growth | EV | DCF 估值 |
| Entry Multiple | Exit Multiple | IRR | LBO |
| Revenue Growth | EBITDA Margin | EBITDA | 运营预测 |
| Leverage | Interest Rate | Coverage | 信贷 |
| Recovery Rate | EV Multiple | Creditor Recovery | 重组 |

**表格规范：**
- 行列各 5-7 个值（覆盖合理区间）
- 中心值 = Base Case（用加粗/底色标注）
- 数值精度适当（不要过多小数位）

### Step 5: 压力测试

**目的**：验证在极端不利条件下的最坏结果

**方法：**
- 定义压力情景（Revenue -30%, Margin -500bps, 信贷收紧）
- 多变量同时恶化（不是逐个）
- 计算关键门槛：
  - 何时触发 Covenant 违约
  - 何时 FCF 转负
  - 何时流动性耗尽
  - 何时估值跌破债务

**Break-even 分析：**
- Revenue 下降多少 IRR 降到 0
- EBITDA 下降多少触发 Covenant
- 出口估值多少能保本

### Step 6: 概率加权估值（如适用）

```
Expected Value = Σ (Probability_i × Value_i)
```

- 为每个情景赋予概率权重
- 计算概率加权估值区间
- 标注概率分配的主观性

## 输出规范

- **主交付物**：
  - 情景汇总表（3-5 情景的关键输出对比）
  - 二维 Data Table（至少 1 张核心表）
  - Tornado Chart 描述（影响排序）
- **格式**：表格为主，便于粘贴到 Deck/Memo
- **标注**：Base Case 高亮，不可承受结果用红色标注

## 注意事项

- 情景不是随意编的——须有逻辑支撑（为什么会发生）
- 敏感性变量选择基于 Tornado 分析结果（影响大的才做 2D 表）
- 压力测试须足够极端——不是"略微下调"
- 概率权重是主观的，须明确标注
- 不同受众需要不同呈现：
  - 内部决策：完整 Data Table
  - 客户汇报：可视化 Football Field
  - 董事会：3 情景汇总表
- 所有假设变动须有一致的逻辑方向（如衰退情景不应假设 Margin 扩张）
