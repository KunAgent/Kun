---
name: alert-analysis
description: 告警情况分析报告模板，适用于安全告警汇总、告警趋势分析、告警处置跟踪等场景
usage: 当用户需要分析告警情况、生成告警报告、查看告警趋势时使用此模板
---

# 告警情况分析报告

## 报告概览

| 字段 | 值 |
|------|-----|
| 报告时间 | {report_time} |
| 分析周期 | {period_start} ~ {period_end} |
| 数据来源 | {data_sources} |
| 涉及产品 | {products} |

## 告警统计

### 总体概况

| 指标 | 数值 |
|------|------|
| 告警总数 | {total_alerts} |
| 新增告警 | {new_alerts} |
| 已处置 | {resolved_alerts} |
| 待处置 | {pending_alerts} |
| 误报数 | {false_positive} |

### 按严重等级分布

| 等级 | 数量 | 占比 | 较上期 |
|------|------|------|--------|
| 严重 | {critical} | {critical_pct}% | {critical_trend} |
| 高危 | {high} | {high_pct}% | {high_trend} |
| 中危 | {medium} | {medium_pct}% | {medium_trend} |
| 低危 | {low} | {low_pct}% | {low_trend} |

### 按告警类型分布

| 告警类型 | 数量 | 典型示例 |
|----------|------|----------|
| {alert_type} | {count} | {example} |

## 重点告警详情

> 以下列出需要优先关注的告警事件。

### {alert_index}. {alert_title}

| 字段 | 说明 |
|------|------|
| 告警 ID | {alert_id} |
| 严重等级 | {severity} |
| 告警类型 | {type} |
| 触发时间 | {trigger_time} |
| 影响资产 | {affected_assets} |
| 告警详情 | {detail} |
| 当前状态 | {status} |
| 处置建议 | {action} |

<!-- 重复上述块，每个重点告警一个 -->

## 趋势分析

### 时间维度

- **告警高峰时段**: {peak_hours}
- **告警增长趋势**: {growth_trend}
- **周环比变化**: {week_over_week}

### 关联分析

- **关联攻击源**: {attack_sources}
- **关联漏洞**: {related_vulns}
- **跨产品关联**: {cross_product_correlation}

## 处置建议

### 立即处置

1. {immediate_action_1}
2. {immediate_action_2}

### 策略优化

1. {policy_action_1}
2. {policy_action_2}

### 监控加强

1. {monitor_action_1}
