---
name: comps-valuation
description: |
  Trading comps and transaction comps valuation analysis. Builds comparable company tables and precedent transaction tables with key multiples (EV/EBITDA, EV/Revenue, P/E, etc.). 
  Triggers on "comps", "comparable companies", "trading multiples", "precedent transactions", "valuation comps", "可比估值", "交易可比", "估值倍数".
---

# Comps Valuation（可比估值分析）

## 功能说明

构建上市可比公司（Trading Comps）和交易先例（Transaction Comps / Precedent Transactions）估值分析表，输出标准投行格式的 Comps Table。

## 工作流

### Step 1: 明确估值参数

- 标的公司：名称、行业、规模、商业模式
- 估值模式选择：
  - **Trading Comps**：上市可比公司交易倍数
  - **Transaction Comps**：历史并购交易先例
  - **Hybrid**：两者结合
- 关键财务指标：Revenue / EBITDA / EBIT / Net Income / FCF
- 时间维度：LTM（过去12个月）/ NTM（未来12个月）/ CY（日历年）

### Step 2: 筛选可比标的

**Trading Comps 筛选标准：**
- 行业分类（GICS / SIC / 自定义）
- 规模区间（Revenue / Market Cap）
- 增长特征（Revenue Growth / EBITDA Margin）
- 地域市场
- 商业模式相似度

**Transaction Comps 筛选标准：**
- 交易类型（M&A / LBO / Minority）
- 交易规模（Enterprise Value 区间）
- 行业一致性
- 时间窗口（通常 3-5 年内）
- 交易背景相似度

### Step 3: 数据收集与标准化

- 统一会计口径（GAAP vs IFRS 调整）
- 计算 Adjusted EBITDA（加回一次性费用、股权激励等）
- 计算 Enterprise Value = Market Cap + Net Debt + Minority Interest + Preferred - Associates
- 计算 Equity Value（稀释后）
- Calendarize 非标准财年

### Step 4: 倍数计算

**常用倍数：**

| 类别 | 倍数 | 适用场景 |
|------|------|---------|
| Enterprise | EV/Revenue | 高增长/无盈利公司 |
| Enterprise | EV/EBITDA | 成熟盈利公司（最常用） |
| Enterprise | EV/EBIT | 资本密集型行业 |
| Equity | P/E | 盈利稳定公司 |
| Equity | P/B | 金融/重资产行业 |
| Growth-adjusted | EV/EBITDA/Growth (PEG-like) | 增长差异大的同行 |
| Sector-specific | EV/GMV, EV/Subscriber, EV/Bed | 特定行业 |

### Step 5: 统计分析与估值区间

- 计算 Mean / Median / 25th / 75th percentile
- 识别 Outliers 并标注原因
- 应用选定倍数到标的财务数据
- 输出 Implied Valuation Range（Enterprise Value / Equity Value / Per Share）

### Step 6: 输出 Comps Table

标准格式包含：
- Company Name / Ticker
- Market Cap / Enterprise Value
- Revenue / EBITDA / EBIT / Net Income（LTM & NTM）
- Growth Rates（Revenue / EBITDA）
- Margins（Gross / EBITDA / Net）
- Multiples（EV/Revenue, EV/EBITDA, P/E 等）
- Implied Valuation Summary

## 输出规范

- **主交付物**：结构化 Comps Table（Markdown 表格或建议用户导出 Excel）
- **附带**：估值区间汇总（Football Field 格式描述）
- **标注**：数据来源、时间点、调整假设

## 注意事项

- 所有财务数据须标注来源和时间截面
- Adjusted EBITDA 的加回项须逐一列明
- 交易先例须注明控制权溢价（Control Premium）是否包含
- 不同行业使用不同核心倍数，不一刀切
- 明确区分 LTM vs NTM vs Consensus Estimates
- 当数据不足时明确告知用户，不编造数据
