---
name: risk-report
description: 风险评估报告模板，适用于安全风险汇总、资产风险盘点、合规风险评估等场景
usage: 当用户需要生成风险报告、风险评估摘要、安全态势报告时使用此模板
---

# 风险评估报告

## 报告概览

| 字段 | 值 |
|------|-----|
| 报告时间 | {report_time} |
| 评估范围 | {scope} |
| 数据来源 | {data_sources} |
| 评估周期 | {period_start} ~ {period_end} |

## 风险摘要

| 风险等级 | 数量 | 占比 |
|----------|------|------|
| 严重 | {critical_count} | {critical_pct}% |
| 高危 | {high_count} | {high_pct}% |
| 中危 | {medium_count} | {medium_pct}% |
| 低危 | {low_count} | {low_pct}% |

**总风险数**: {total_count}
**较上期变化**: {trend_description}

## 风险分布

### 按产品分布

| 产品 | 严重 | 高危 | 中危 | 低危 | 合计 |
|------|------|------|------|------|------|
| {product_name} | {c} | {h} | {m} | {l} | {sum} |

### 按资产分布

| 资产类型 | 风险数 | 高危占比 | 代表资产 |
|----------|--------|----------|----------|
| {asset_type} | {count} | {high_pct}% | {sample_assets} |

## 重点风险详情

> 以下列出严重和高危风险 Top N，按风险等级和影响范围排序。

### {risk_index}. {risk_title}

| 字段 | 说明 |
|------|------|
| 风险等级 | {level} |
| 影响资产 | {affected_assets} |
| 发现时间 | {found_time} |
| 风险描述 | {description} |
| 处置建议 | {remediation} |
| 当前状态 | {status} |

<!-- 重复上述块，每个重点风险一个 -->

## 趋势分析

- **新增风险**: {new_risks_description}
- **已修复风险**: {fixed_risks_description}
- **长期未修复**: {overdue_risks_description}

## 处置建议

### 优先处置（严重/高危）

1. {priority_action_1}
2. {priority_action_2}

### 中期改进

1. {medium_action_1}
2. {medium_action_2}

### 长期规划

1. {long_term_action_1}
