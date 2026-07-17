---
name: company-tearsheet
description: |
  Create a one-page company profile/tearsheet for quick reference. Covers business overview, key financials, valuation snapshot, ownership, and recent developments.
  Triggers on "公司概况", "公司简介", "一页纸", "tearsheet", "company profile", "company overview", "target summary", "标的概况".
---

# Company Tearsheet（公司概况页）

## 功能说明

生成投行标准的单页（或两页）公司概况档案，用于快速了解标的公司/交易对手的核心信息，适用于内部决策、客户拜访准备、或交易筛选。

## 工作流

### Step 1: 基本信息

- 公司名称 / Ticker / 交易所
- 总部所在地 / 成立年份
- CEO / CFO / 董事长
- 员工人数
- 行业分类（GICS / 自定义）
- 官网

### Step 2: 业务概述

- **一句话定位**：公司做什么（30 字内）
- **商业模式**：收入来源、客户类型、交付方式
- **产品/服务矩阵**：按收入贡献排列
- **地域分布**：收入按地区拆分
- **竞争定位**：市场份额、主要竞对

### Step 3: 关键财务快照

| 指标 | LTM | FY-1 | FY-2 |
|------|-----|------|------|
| Revenue | | | |
| YoY Growth | | | |
| Gross Margin | | | |
| EBITDA | | | |
| EBITDA Margin | | | |
| Net Income | | | |
| FCF | | | |
| Net Debt | | | |
| Net Debt/EBITDA | | | |

### Step 4: 估值快照

- Market Cap / Enterprise Value
- EV/Revenue (LTM & NTM)
- EV/EBITDA (LTM & NTM)
- P/E (LTM & NTM)
- 52-Week High / Low / Current
- YTD Performance vs Index

### Step 5: 股东结构

- Top 10 Shareholders（机构 + 内部人）
- Free Float %
- 近期大宗交易 / 增减持

### Step 6: 近期事件

- 最近 1-2 个季度财报亮点
- 近期公告（M&A / 管理层变动 / 战略更新）
- 分析师评级共识
- 催化剂和风险事件

### Step 7: 投资亮点与风险

**亮点（3-5 条）：**
- 核心竞争优势
- 增长驱动力
- 财务质量指标

**风险（3-5 条）：**
- 关键不确定性
- 行业风险
- 公司特有风险

## 输出规范

- **主交付物**：1-2 页结构化公司概况
- **格式**：表格 + 要点式，信息密度高
- **数据标注**：所有财务数据标注来源和日期
- **视觉建议**：如需制作 PPT 版本，给出布局建议

## 注意事项

- 信息须为最新可得数据（标注日期）
- 财务数据须标明会计年度和截止日
- 一页纸内信息优先级：业务 > 财务 > 估值 > 股东
- 不包含主观判断（除非明确标注为"分析师观点"）
- 当数据缺失时明确标注"N/A"或"待补充"
- 区分上市公司（公开数据）和非上市公司（有限数据）的模板
