---
name: cim-teardown
description: |
  Tear down and analyze sell-side materials (CIMs, teasers, management presentations). Extracts key claims, identifies gaps, flags red flags, and builds a diligence question list.
  Triggers on "拆解CIM", "分析卖方材料", "CIM尽调", "材料分析", "红旗", "尽调问题", "cim teardown", "analyze CIM", "diligence questions", "red flags", "seller materials review".
---

# CIM Teardown（卖方材料拆解）

## 功能说明

系统性拆解和分析卖方提供的 CIM（Confidential Information Memorandum）及其他交易材料，提取关键声明、识别信息缺口、标注红旗（Red Flags），输出买方尽调问题清单。

## 工作流

### Step 1: 材料摄入

- 识别材料类型：CIM / Teaser / Management Presentation / Information Pack
- 提取文档结构和目录
- 标注页码和章节索引
- 识别材料版本和日期

### Step 2: 关键声明提取

逐章节提取以下类别信息：

**业务概况：**
- 商业模式描述
- 竞争定位声明
- 客户/市场规模声称

**财务数据：**
- 历史和预测收入/EBITDA/FCF
- 增长率声明
- 利润率趋势
- Adjusted EBITDA 加回项

**增长策略：**
- 有机增长计划
- M&A 路线图
- 新产品/新市场计划
- 资本支出计划

**管理层/团队：**
- 关键人物依赖
- 团队稳定性
- 激励结构

### Step 3: 红旗识别

| 红旗类别 | 具体信号 |
|---------|---------|
| 财务质量 | 大额 EBITDA 加回、收入确认激进、Working Capital 异常 |
| 增长可持续性 | 增长依赖单一客户/产品、市场见顶信号 |
| 客户集中 | Top 5 客户占比 > 50%、合同到期风险 |
| 管理层依赖 | 创始人单点依赖、竞业限制不足 |
| 竞争威胁 | 护城河薄弱、替代品出现、价格战 |
| 法律/合规 | 诉讼披露不充分、监管风险 |
| 数据不一致 | 前后矛盾的数字、缺失的年份、口径变化 |
| 卖方动机 | 为何现在卖？业绩巅峰出售？ |

### Step 4: 信息缺口分析

标注 CIM 中**缺失但买方决策必需**的信息：

- 客户合同详情（期限、自动续约、终止条款）
- 单位经济模型（CAC / LTV / Payback）
- 技术栈和技术债务
- 人员结构和薪酬细节
- 详细 CapEx 计划和历史
- 税务结构和历史税务争议
- 环境/ESG 合规状态
- 关联交易详情

### Step 5: 尽调问题清单

按优先级输出结构化问题清单：

**P1 - 估值关键（Must-have before valuation）：**
- 影响 EBITDA 真实性的问题
- 影响增长可持续性的问题
- 影响交易结构的问题

**P2 - 风险评估（Important for risk assessment）：**
- 客户/供应商依赖
- 竞争格局变化
- 管理层留任

**P3 - 确认性（Confirmatory）：**
- 验证 CIM 声明的细节问题
- 运营细节补充

### Step 6: 初步估值校验

- 基于 CIM 数据的快速 Comps 估值
- 卖方暗示的估值预期合理性
- 买方应支付价格区间的初步判断

## 输出规范

- **主交付物**：CIM 分析报告
  - Executive Summary（一页纸结论）
  - 关键声明表（按章节）
  - Red Flags 清单（按严重程度）
  - 信息缺口矩阵
  - 尽调问题清单（分 P1/P2/P3）
- **附带**：快速估值校验

## 注意事项

- 所有红旗须标注影响程度（High / Medium / Low）和潜在估值影响
- 尽调问题须具体可执行，不要泛泛而问
- 区分"CIM 说了什么"和"CIM 没说什么"
- 保持客观——红旗不等于 Deal Breaker，需要验证
- 标注哪些问题可通过 VDR 解决、哪些需要 Management Meeting
- 注意识别"管理层预测 vs 历史实际"的差距模式
