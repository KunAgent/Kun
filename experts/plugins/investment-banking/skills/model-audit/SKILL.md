---
name: model-audit
description: |
  Audit and tie-out financial models for accuracy, consistency, and best practices. Checks formula integrity, circular references, hardcodes, balance sheet balance, and cross-statement linkages.
  Triggers on "模型审计", "模型检查", "model audit", "model review", "tie-out", "模型核对", "公式检查", "model QA", "spreadsheet audit".
---

# Model Audit（模型审计）

## 功能说明

对财务模型进行系统性审计和检查，确保公式正确性、跨表一致性、假设合理性，输出问题清单和修改建议。

## 工作流

### Step 1: 模型概览

- 模型类型（三表 / DCF / LBO / Merger / Comps）
- 模型结构（Tab 布局、信息流向）
- 输入假设位置
- 输出/结论位置
- 模型作者和版本历史

### Step 2: 结构性检查

| 检查项 | 标准 | 严重度 |
|--------|------|--------|
| Tab 组织 | 逻辑清晰、命名规范 | Medium |
| 信息流向 | 左→右、上→下，无反向引用 | High |
| 颜色惯例 | 蓝=输入、黑=公式、绿=链接 | Low |
| 行列一致性 | 同类数据在同行/列，时间轴统一 | Medium |
| 命名规范 | Named Ranges 合理使用 | Low |

### Step 3: 公式完整性检查

**逐列一致性（Column Consistency）：**
- 同一行公式是否一致地向右复制
- 是否有断裂（某列突然变成不同公式）

**硬编码检测（Hardcode Detection）：**
- 公式中嵌入的数字常量
- 应从假设页引用的值被硬编码
- 标注所有 Hardcode 并评估是否合理

**循环引用（Circular Reference）：**
- 是否存在循环引用
- 如有，是否有 Iteration 设置或 Circuit Breaker
- 循环引用是否可控

**错误值（Error Values）：**
- #REF!, #DIV/0!, #N/A, #VALUE! 检测
- 错误传播路径追踪

### Step 4: 平衡与勾稽检查

**资产负债表平衡：**
- Assets = Liabilities + Equity（每期检查）
- 偏差金额和原因

**现金流桥接：**
- 期初现金 + CF = 期末现金 = BS 上现金
- 间接法 CF 是否正确推导

**科目勾稽：**
- D&A（IS）= D&A（CF）= ΔAccumulated D&A（BS）
- CapEx（CF）= ΔPP&E + D&A
- Interest Expense（IS）vs Debt × Rate

### Step 5: 假设合理性

- 增长率是否在合理区间
- Margin 是否符合行业标准
- Working Capital 假设是否与历史一致
- 终值假设是否过于乐观
- 预测期与终值的衔接是否平滑

### Step 6: 敏感性验证

- 极端输入测试（Revenue = 0, Growth = 50%）
- 模型是否在极端假设下仍然"运转"（不报错）
- 输出是否随输入单调变化（无逻辑跳变）

### Step 7: 问题汇总与建议

按严重度分类：

| 严重度 | 定义 | 举例 |
|--------|------|------|
| 🔴 Critical | 影响结论正确性 | BS 不平衡、公式错误 |
| 🟡 Major | 可能影响判断 | 不合理假设、Hardcode |
| 🟢 Minor | 不影响结论但不规范 | 颜色不一致、命名不清 |

## 输出规范

- **主交付物**：模型审计报告
  - Summary Score（通过/有条件通过/未通过）
  - 问题清单（按严重度排列）
  - 每个问题：位置 + 描述 + 影响 + 建议修复
- **附带**：Check 清单打勾表

## 注意事项

- 审计是检查不是重建——指出问题而非重写模型
- 区分"错误"和"不同的合理假设"
- Critical 问题须提供具体修复建议
- 对循环引用的态度：不是禁止，而是要求可控
- 审计范围须事先明确（全面审计 vs 重点检查）
- 输出须可操作——问题描述要精确到 Tab / Row / Column
