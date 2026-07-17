---
name: private-credit
description: |
  Private credit underwriting and lender-side analysis. Builds credit memos, debt capacity analysis, covenant assessment, and lending recommendations.
  Triggers on "私募信贷", "贷方分析", "信贷承销", "债务容量", "贷款审批", "credit memo", "private credit", "direct lending", "debt capacity", "credit underwriting", "lender memo".
---

# Private Credit（私募信贷承销）

## 功能说明

从贷方视角进行信贷分析和承销决策，构建信贷备忘录、评估债务容量、分析条款保护、输出贷款推荐意见。

## 工作流

### Step 1: 借款人画像

- 公司概况和商业模式稳定性
- 行业周期性和抗衰退能力
- 管理层经验和 Track Record
- Sponsor 背景（如为 PE 旗下）
- 历史信贷表现

### Step 2: 信贷基础分析

**EBITDA 基础确定：**
- Reported EBITDA
- 加回项审查（哪些认可、哪些不认可）
- Run-rate 调整合理性
- Adjusted EBITDA（贷方口径）
- Pro Forma 调整（如有收购）

**现金流分析：**
- EBITDA → FCF 转化率
- CapEx 需求（维护性 vs 可延缓性）
- Working Capital 周期性
- 现金流可预测性评分

### Step 3: 债务容量分析

| 指标 | 保守 | 基础 | 乐观 |
|------|------|------|------|
| Total Leverage (Debt/EBITDA) | | | |
| Senior Leverage | | | |
| Interest Coverage (EBITDA/Interest) | | | |
| FCCR (Fixed Charge Coverage) | | | |
| Debt/FCF | | | |
| Debt Service Coverage | | | |

**Debt Capacity 计算方法：**
- Coverage-based：基于最低 DSCR 反算最大债务
- Leverage-based：基于最大倍数确定债务上限
- Collateral-based：基于抵押品价值（Asset-based）
- 取三者最低值

### Step 4: 条款评估

**Financial Covenants：**
- Maintenance vs Incurrence 区别
- Leverage Covenant（Max Net Debt/EBITDA）
- Coverage Covenant（Min EBITDA/Interest）
- CapEx Limit
- Minimum Liquidity

**Restrictive Covenants：**
- Restricted Payments（分红、回购限制）
- Permitted Indebtedness（增量债务空间）
- Asset Sale Provisions
- Change of Control
- Affiliate Transactions

**Cushion 分析：**
- Covenant Headroom（当前值 vs 触发值）
- Downside Scenario 下的缓冲空间
- EBITDA 下降多少触发违约

### Step 5: 情景压力测试

**Base Case：** 管理层预算/共识预期
**Downside Case：** Revenue -15-20%，Margin compression
**Stress Case：** 行业衰退级别打击

每个情景下计算：
- 杠杆指标演进
- 现金流是否覆盖偿债
- 何时触发 Covenant
- 流动性耗尽时间（Liquidity Runway）

### Step 6: 回收分析

如违约发生：
- 抵押品价值（Going Concern vs Liquidation）
- 优先权排序
- 预期回收率
- Loss Given Default (LGD)

### Step 7: 信贷决策

**推荐框架：**
- ✅ Approve（附条件/无条件）
- ⚠️ Approve with Enhanced Monitoring
- ❌ Decline（附原因）

**关键决策因素：**
- Risk/Reward 是否匹配定价
- Downside Protection 是否充分
- Sponsor Support 可靠性
- 退出路径清晰度

## 输出规范

- **主交付物**：信贷备忘录（Credit Memo）
  - Executive Summary / Recommendation
  - Borrower Overview
  - Credit Highlights & Risks
  - Financial Analysis（历史 + 预测）
  - Debt Capacity & Structure
  - Covenant Package
  - Stress Test Results
  - Recommendation & Conditions
- **附带**：Debt Capacity 模型、Covenant Compliance 表

## 注意事项

- 所有 EBITDA 加回须逐项评估合理性（不盲目接受卖方数字）
- Stress Test 须足够严苛（不是轻微下调）
- 条款设计须平衡借款人运营灵活性和贷方保护
- 明确区分 Sponsor-backed（有 Equity Cure 权）和 Non-sponsored
- 关注现金流而非利润——偿债能力看 FCF 不看 Net Income
- 跨期比较须统一口径（LTM / Annualized / Pro Forma）
