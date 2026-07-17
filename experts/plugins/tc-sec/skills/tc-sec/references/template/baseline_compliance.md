---
name: baseline-compliance
description: 基线合规检查报告模板，适用于安全基线检查、等保合规评估、CIS 基准检查等场景
usage: 当用户需要生成合规报告、基线检查结果、安全配置审计报告时使用此模板
---

# 基线合规检查报告

## 报告概览

| 字段 | 值 |
|------|-----|
| 检查时间 | {check_time} |
| 检查范围 | {scope} |
| 基线标准 | {standard} |
| 检查资产数 | {total_assets} |

## 合规概况

| 指标 | 数值 |
|------|------|
| 检查项总数 | {total_items} |
| 通过项 | {passed_items} |
| 未通过项 | {failed_items} |
| 合规率 | {compliance_rate}% |
| 较上次变化 | {trend} |

## 按检查类别分布

| 类别 | 检查项 | 通过 | 未通过 | 合规率 |
|------|--------|------|--------|--------|
| 账户安全 | {account_total} | {account_pass} | {account_fail} | {account_rate}% |
| 口令策略 | {password_total} | {password_pass} | {password_fail} | {password_rate}% |
| 网络配置 | {network_total} | {network_pass} | {network_fail} | {network_rate}% |
| 文件权限 | {file_total} | {file_pass} | {file_fail} | {file_rate}% |
| 服务配置 | {service_total} | {service_pass} | {service_fail} | {service_rate}% |
| 日志审计 | {log_total} | {log_pass} | {log_fail} | {log_rate}% |

## 按资产合规情况

| 资产 | 检查项 | 通过 | 未通过 | 合规率 | 风险等级 |
|------|--------|------|--------|--------|----------|
| {asset} | {total} | {pass} | {fail} | {rate}% | {risk} |

## 未通过项详情

> 以下列出未通过的检查项，按风险等级排序。

### {item_index}. {item_title}

| 字段 | 说明 |
|------|------|
| 检查项 ID | {item_id} |
| 所属类别 | {category} |
| 风险等级 | {level} |
| 基线标准 | {standard_ref} |
| 当前配置 | {current_value} |
| 期望配置 | {expected_value} |
| 影响资产 | {affected_assets} |
| 修复方法 | {fix_method} |

<!-- 重复上述块 -->

## 合规趋势

| 检查批次 | 日期 | 合规率 | 变化 |
|----------|------|--------|------|
| {batch} | {date} | {rate}% | {change} |

## 整改建议

### 高优先级

1. {high_priority_1}
2. {high_priority_2}

### 中优先级

1. {medium_priority_1}

### 低优先级

1. {low_priority_1}
