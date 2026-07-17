---
name: memo-builder
description: |
  Draft investment banking memos for deal committees, board presentations, fairness opinions, and internal decision-making. Synthesizes analysis into structured, senior-ready documents.
  Triggers on "备忘录", "memo", "委员会报告", "董事会材料", "投资建议书", "deal memo", "committee memo", "board memo", "fairness opinion", "investment memo", "IC memo".
---

# Memo Builder（备忘录构建）

## 功能说明

将各类分析结果综合为结构化的投行备忘录，用于内部决策委员会、董事会汇报、公允意见支持等正式场景。

## 工作流

### Step 1: 明确备忘录类型

| 类型 | 受众 | 核心目的 |
|------|------|---------|
| Deal Committee Memo | 内部投委会 | 审批交易参与/承诺 |
| Board Memo | 董事会 | 战略决策/交易批准 |
| Fairness Opinion Support | 独立委员会 | 价格公允性论证 |
| Investment Memo | 投资委员会 | 投资决策建议 |
| Credit Committee Memo | 信贷委员会 | 贷款审批 |
| Client Advisory Memo | 外部客户 | 交易建议/方案 |

### Step 2: 信息收集

- 交易背景和战略逻辑
- 标的公司 / 交易对手概况
- 财务分析和估值结论
- 交易结构和条款
- 风险评估
- 竞争动态/市场环境
- 时间线和下一步

### Step 3: 标准结构

**Deal Committee Memo 标准结构：**

1. **Executive Summary**（1 页）
   - 交易概述（一段话）
   - 推荐意见（Approve / Approve with conditions / Decline）
   - 关键数据：估值、结构、时间

2. **Transaction Overview**
   - 各方介绍
   - 交易背景和历程
   - 交易结构（图示）
   - 关键条款摘要

3. **Strategic Rationale**
   - 买方 / 卖方逻辑
   - Synergy 分析
   - 战略适配度

4. **Financial Analysis**
   - 历史财务概况
   - 管理层预测
   - 估值分析（Comps / DCF / LBO）
   - 估值区间汇总（Football Field）

5. **Risk Factors**
   - 交易风险
   - 运营风险
   - 市场/竞争风险
   - 合规/法律风险
   - 缓释措施

6. **Process & Competition**
   - 竞争动态
   - 替代方案
   - 时间压力

7. **Recommendation & Conditions**
   - 明确推荐
   - 附加条件
   - 下一步行动

### Step 4: 写作标准

**语言风格：**
- 简洁直接，每句话传递信息
- 结论先行（Conclusion-first）
- 用数据说话，避免空泛描述
- 明确表达立场，不模棱两可

**格式标准：**
- Executive Summary 不超过 1 页
- 全文 10-20 页（视复杂度）
- 关键数据用表格/图表展示
- 每节有小标题结构
- 脚注标注数据来源

**质量标准（Senior-Ready）：**
- 所有数据有来源
- 估值有区间（不是单一数字）
- 风险有缓释措施对应
- 推荐有明确理由
- 无拼写/格式错误

### Step 5: 公允意见特殊要求

如为 Fairness Opinion Support：
- 必须包含多种独立估值方法
- 必须有估值区间而非点估计
- 必须声明不构成推荐
- 必须披露利益冲突
- 必须有正式免责声明

## 输出规范

- **主交付物**：完整备忘录（结构化 Markdown，适合转 Word/PDF）
- **格式**：标题层级分明、表格丰富、结论突出
- **附件**：估值汇总表、风险矩阵、时间线（如适用）

## 注意事项

- Executive Summary 必须能独立阅读（决策者可能只看这一页）
- 推荐意见必须明确——不允许"视情况而定"式结论
- 所有估值须标注方法和假设
- 敏感信息按合规要求标注密级
- 区分"事实"和"判断"——判断须标注来源（管理层/分析师/自主判断）
- 备忘录是决策工具，不是百科全书——聚焦决策相关信息
