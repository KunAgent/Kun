---
name: lbo-model
description: |
  Build leveraged buyout (LBO) models for PE/sponsor acquisitions. Calculates Sources & Uses, debt schedules, cash flow sweeps, and sponsor returns (IRR/MOIC).
  Triggers on "LBO", "leveraged buyout", "PE收购", "杠杆收购", "sponsor returns", "IRR", "MOIC", "债务结构", "收购模型".
---

# LBO Model（杠杆收购模型）

## 功能说明

构建 LBO（Leveraged Buyout）杠杆收购模型，为私募股权（PE）收购交易计算融资结构、债务偿还计划和投资回报。

## 工作流

### Step 1: 交易参数设定

- 标的公司财务概况（Revenue / EBITDA / FCF）
- 收购价格 / Entry Multiple（EV/EBITDA）
- 交易日期和退出时间假设（通常 5 年）
- 管理层参与（Management Rollover %）

### Step 2: Sources & Uses

**Uses（资金用途）：**
- Enterprise Value（收购价格）
- Transaction Fees（顾问费、律师费、融资费）
- Debt Issuance Costs（融资安排费）
- Refinancing of Existing Debt

**Sources（资金来源）：**
- Senior Secured Debt（Term Loan A / B）
- Second Lien / Mezzanine
- High Yield Bonds / Notes
- Seller Note
- Sponsor Equity（PE 出资）
- Management Rollover

### Step 3: 债务结构设计

| 层级 | 典型倍数 | 利率 | 摊还 |
|------|---------|------|------|
| Revolver | 1.0-1.5x | SOFR + 200-350bps | Bullet |
| Term Loan A | 1.5-2.5x | SOFR + 250-400bps | 10-15% p.a. |
| Term Loan B | 2.0-3.5x | SOFR + 300-500bps | 1% p.a. |
| Second Lien | 0.5-1.5x | SOFR + 600-900bps | Bullet |
| Mezzanine | 0.5-1.0x | 12-16% (PIK可选) | Bullet |
| High Yield | 1.0-2.0x | 7-12% Fixed | Bullet |

- Total Leverage: 4.0-7.0x EBITDA（视行业和市场环境）
- Senior Leverage: 3.0-5.0x EBITDA

### Step 4: 运营预测（5年）

- Revenue Growth 假设
- EBITDA Margin 演进
- CapEx（维护性 + 增长性）
- Working Capital 变动
- 计算 Free Cash Flow Available for Debt Service

### Step 5: 债务偿还计划

- Mandatory Amortization（合同强制偿还）
- Cash Flow Sweep（超额现金流强制还款，通常 50-75%）
- Optional Prepayment（自愿提前偿还）
- 每年计算 Net Debt / EBITDA 去杠杆进度
- Interest Coverage Ratio 监控

### Step 6: 退出分析

**退出方式：**
- 战略出售（Trade Sale）
- 二次收购（Secondary Buyout）
- IPO
- Dividend Recapitalization

**退出估值：**
- Exit Multiple（通常 = Entry Multiple 或有 expansion/compression）
- Exit Enterprise Value = Exit EBITDA × Exit Multiple
- Exit Equity Value = Exit EV - Net Debt at Exit

### Step 7: 回报计算

```
MOIC = Exit Equity / Entry Equity
IRR = (MOIC)^(1/Years) - 1（简化）
```

- 分拆回报来源：
  - EBITDA Growth（运营增长）
  - Multiple Expansion（估值扩张）
  - Debt Paydown（杠杆去化）
  - Dividend Recaps（分红回流）

### Step 8: 敏感性分析

- Entry Multiple vs Exit Multiple
- EBITDA Growth vs Exit Multiple
- Leverage vs IRR
- Hold Period vs IRR/MOIC

## 输出规范

- **主交付物**：完整 LBO 模型（Sources & Uses + 运营预测 + 债务计划 + 回报分析）
- **回报汇总**：IRR / MOIC / Cash-on-Cash，含回报归因分解
- **敏感性表**：关键变量矩阵
- **信贷指标监控**：Leverage / Coverage / FCF Yield 逐年变化

## 注意事项

- Total Leverage 须符合当前信贷市场环境
- Debt Capacity 须经得起 Downside Case 压力测试
- Cash Flow Sweep 条款须明确触发条件
- 管理层激励（MIP）通常 10-20% 稀释须体现在回报计算中
- 区分 Gross IRR vs Net IRR（扣除 GP 费用）
- 不同退出假设下的回报区间须同时呈现
