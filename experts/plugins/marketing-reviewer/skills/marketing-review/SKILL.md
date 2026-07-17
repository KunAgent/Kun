---
name: marketing-review
description: |
  营销文案合规审查工具集。提供 9 维度 34 条合规审查规则 Playbook 与 HTML 报告模板。
  触发词：营销文案审查、合规审查、广告法、反垄断、个人信息保护、风险审查、文案合规
---

# 营销文案审查技能

为营销文案审查官提供审查规则库与报告模板两类参考资产。

## 参考资料

### 审查 Playbook
执行审查前，读取 `@references/marketing-copy-playbook.md` 获取 9 维度共 34 条审查规则。
每条规则包含：审查点、默认风险等级、审查规则、审查依据（法条）。

### HTML 报告模板
生成可视化报告时，读取 `@references/marketing-report-template.html` 作为基础模板，
将审查数据填入占位符（`{{REPORT_TITLE}}`、`{{REVIEW_DATE}}`、`{{HIGH_COUNT}}`、
`{{MEDIUM_COUNT}}`、`{{LOW_COUNT}}`、`{{HIGH_SECTION}}`、`{{MEDIUM_SECTION}}`、
`{{LOW_SECTION}}`）生成最终自包含 HTML 文件。

## 使用方式
- 审查规则查阅：`@references/marketing-copy-playbook.md`
- 报告模板套用：`@references/marketing-report-template.html`
