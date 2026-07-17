---
name: restructuring
description: |
  Distressed debt analysis, recovery waterfall modeling, and restructuring advisory. Calculates creditor recoveries under various scenarios (going concern, liquidation, plan of reorganization).
  Triggers on "重组", "困境", "破产", "债务重组", "回收瀑布", "清算分析", "restructuring", "distressed", "recovery waterfall", "bankruptcy", "chapter 11", "creditor recovery", "liquidation analysis".
---

# Restructuring（重组与回收瀑布分析）

## 功能说明

为困境企业进行重组分析，构建回收瀑布（Recovery Waterfall）模型，计算各层级债权人的预期回收率，支持重组方案设计和债权人谈判。

## 工作流

### Step 1: 困境诊断

- 陷入困境的根因分析：
  - 运营困境（收入下降/成本失控）
  - 资本结构困境（过度杠杆）
  - 流动性危机（短期偿付不能）
  - 外部冲击（行业衰退/监管/诉讼）
- 当前流动性状况和 Runway
- 到期债务时间线
- 是否已违约/交叉违约触发

### Step 2: 资本结构梳理

完整债务堆叠（Capital Structure Stack）：

| 层级 | 工具 | 金额 | 利率 | 到期日 | 担保 |
|------|------|------|------|--------|------|
| Super Senior | DIP / Revolver | | | | 1st Lien |
| Senior Secured | Term Loan | | | | 1st Lien |
| 2nd Lien | Secured Notes | | | | 2nd Lien |
| Senior Unsecured | Bonds | | | | None |
| Subordinated | Sub Notes | | | | None |
| Mezzanine | Mezz | | | | None |
| Preferred | Pref Equity | | | | None |
| Common Equity | Shares | | | | None |

### Step 3: 企业价值评估

**Going Concern Value：**
- 正常化 EBITDA（剔除一次性困境相关费用）
- 重组后可持续 EBITDA
- 适用 Exit Multiple（困境折扣）
- Enterprise Value = Adjusted EBITDA × Multiple

**Liquidation Value：**
- 逐项资产清算价值估算
- 应收账款：60-80% of Book
- 存货：40-70% of Book（视行业）
- PP&E：20-50% of Book
- 无形资产/商誉：通常为 0
- 减：清算成本（3-5% of Gross Proceeds）
- 减：行政/专业费用

### Step 4: 回收瀑布计算

按绝对优先权规则（Absolute Priority Rule）：

```
1. Administrative Claims (DIP, Professional Fees)
2. Priority Claims (Taxes, Employee Wages)
3. Secured Claims (按抵押品价值，不足部分转为 Unsecured)
4. Senior Unsecured Claims
5. Subordinated Claims
6. Preferred Equity
7. Common Equity
```

每一层级计算：
- Allowed Claim（含 PIK 利息、Make-Whole 等）
- Available Value（上一层分配后的剩余）
- Recovery Amount
- Recovery Rate (%)
- Fulcrum Security（价值断裂点所在层级）

### Step 5: 情景分析

| 情景 | EV 假设 | 对应结果 |
|------|---------|---------|
| Upside | High EBITDA × High Multiple | 谁全额回收 |
| Base | Base EBITDA × Base Multiple | Fulcrum 在哪 |
| Downside | Low EBITDA × Low Multiple | 最差回收 |
| Liquidation | Asset-by-asset | 清算底线 |

### Step 6: 重组方案设计

**可选路径：**
- **庭外重组（Out-of-Court）**：Amend & Extend / Exchange Offer / Consent Solicitation
- **预重整（Pre-packaged）**：投票在前，法庭确认在后
- **正式破产（Chapter 11 / 管理人制度）**：法庭监督全面重组
- **清算（Chapter 7 / Liquidation）**：如 Going Concern 不可行

**重组方案要素：**
- 新资本结构设计（去杠杆目标）
- 债转股比例（Debt-to-Equity Conversion）
- 现有股东稀释/清零
- DIP Financing 安排
- 退出融资（Exit Facility）
- 管理层留任/替换和激励重置
- 运营重组计划（成本削减/资产出售）

### Step 7: 债权人博弈分析

- 各层级债权人的谈判筹码
- 谁是 Fulcrum Creditor（掌握最大话语权）
- Hold-out 风险和 Cram-down 可能性
- 信用违约互换（CDS）持有者的动机
- 控制权之争（Loan-to-Own 策略）

## 输出规范

- **主交付物**：回收瀑布分析报告
  - Executive Summary（一段话结论）
  - 资本结构全景图
  - Recovery Waterfall 表（按情景）
  - Fulcrum Security 识别
  - 重组方案建议（1-2 个可行路径）
- **附带**：清算分析、情景敏感性矩阵

## 注意事项

- 绝对优先权规则在实务中常有偏离（谈判让步），须标注
- Secured Creditor 的回收不一定 100%（抵押品不足时 Deficiency Claim 转 Unsecured）
- Make-Whole / Default Interest 是否纳入 Allowed Claim 须看合同和法域
- 不同法域（美国 Ch.11 / 英国 Scheme / 中国破产法）规则差异大
- Fulcrum Security 是重组谈判的核心——谁在断裂点谁说了算
- 所有估值假设须有情景区间，不给单一点估计
