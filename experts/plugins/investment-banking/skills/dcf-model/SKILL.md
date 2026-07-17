---
name: dcf-model
description: |
  Build discounted cash flow (DCF) valuation models. Projects free cash flows, determines WACC, calculates terminal value, and derives implied equity value per share.
  Triggers on "DCF", "discounted cash flow", "intrinsic value", "现金流折现", "DCF模型", "内在价值估值".
---

# DCF Model（现金流折现模型）

## 功能说明

构建 DCF（Discounted Cash Flow）估值模型，通过预测未来自由现金流并折现到当前，计算标的公司内在价值。

## 工作流

### Step 1: 确认建模参数

- 标的公司及基础财务数据
- 预测期限（通常 5-10 年）
- 终值方法：永续增长法（Gordon Growth）/ 退出倍数法（Exit Multiple）
- FCF 类型：FCFF（Unlevered）/ FCFE（Levered）
- 折现率方法：WACC / Cost of Equity

### Step 2: 历史财务分析

- 收集 3-5 年历史财务数据
- 计算历史增长率、利润率趋势
- 识别周期性模式和一次性项目
- 确定正常化（Normalized）运营水平

### Step 3: 收入预测

- Top-down：市场规模 × 市占率
- Bottom-up：产品线 / 客户群 / 区域分拆
- 驱动因子：Volume × Price / 用户数 × ARPU / 合同数 × 合同价值
- 分阶段增长假设（高增长期 → 稳定期 → 终值期）

### Step 4: 成本与资本支出预测

- COGS：基于毛利率趋势或单位经济
- OpEx：按功能分拆（R&D / S&M / G&A），含杠杆效应
- D&A：基于资本支出和资产寿命
- CapEx：维护性 vs 增长性分离
- Working Capital：应收/应付/存货周转天数

### Step 5: 自由现金流计算

```
FCFF = EBIT × (1 - Tax Rate) + D&A - CapEx - ΔWorking Capital
```

或

```
FCFE = Net Income + D&A - CapEx - ΔWorking Capital - Net Debt Repayment
```

### Step 6: 折现率（WACC）

```
WACC = E/(E+D) × Ke + D/(E+D) × Kd × (1-T)

Ke = Rf + β × (Rm - Rf) + Size Premium + Country Risk Premium
Kd = Risk-free Rate + Credit Spread
```

- Rf：无风险利率（10Y国债）
- β：Levered Beta（从可比公司 Unlevered Beta 重新杠杆化）
- ERP：股权风险溢价
- Size Premium：小公司溢价（如适用）

### Step 7: 终值计算

**永续增长法：**
```
Terminal Value = FCF(n+1) / (WACC - g)
```
- g：永续增长率（通常 2-3%，不超过 GDP 长期增长率）

**退出倍数法：**
```
Terminal Value = EBITDA(n) × Exit Multiple
```
- Exit Multiple：基于 Comps 或行业标准

### Step 8: 估值汇总

- 折现 FCF 合计（Explicit Period）
- 折现终值
- Enterprise Value = 折现 FCF + 折现终值
- Equity Value = Enterprise Value - Net Debt - Minority Interest - Preferred + Associates
- Per Share Value = Equity Value / Diluted Shares

### Step 9: 敏感性分析

- WACC vs Terminal Growth Rate 矩阵
- WACC vs Exit Multiple 矩阵
- Revenue Growth vs EBITDA Margin 矩阵
- 输出隐含估值区间

## 输出规范

- **主交付物**：完整 DCF 模型（含假设、预测、估值汇总）
- **敏感性表**：2D 矩阵展示关键变量对估值的影响
- **假设页**：所有关键假设集中列示，便于调整
- **数据来源**：每个关键输入标注来源

## 注意事项

- 永续增长率不应超过经济长期增长率
- Beta 选择须说明来源和调整方法（Raw vs Adjusted, Levering/Unlevering）
- CapEx 须区分维护性和增长性
- Working Capital 异常波动须调查原因
- 终值占比通常 60-80%，过高需检查预测期假设
- 所有假设须标注为"管理层指引""分析师共识"或"自主判断"
