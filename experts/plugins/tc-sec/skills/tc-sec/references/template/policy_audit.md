---
name: policy-audit
description: 策略配置审计报告模板，适用于防火墙规则审计、WAF 策略审计、访问控制策略检查等场景
usage: 当用户需要审计安全策略、检查防火墙规则、评估访问控制配置时使用此模板
---

# 策略配置审计报告

## 报告概览

| 字段 | 值 |
|------|-----|
| 审计时间 | {report_time} |
| 审计范围 | {scope} |
| 审计产品 | {products} |
| 策略总数 | {total_policies} |

## 策略概况

| 产品 | 策略数 | 启用 | 禁用 | 冗余 | 冲突 |
|------|--------|------|------|------|------|
| WAF | {waf_total} | {waf_enabled} | {waf_disabled} | {waf_redundant} | {waf_conflict} |
| CFW | {cfw_total} | {cfw_enabled} | {cfw_disabled} | {cfw_redundant} | {cfw_conflict} |
| 安全组 | {sg_total} | {sg_enabled} | {sg_disabled} | {sg_redundant} | {sg_conflict} |
| BH ACL | {bh_total} | {bh_enabled} | {bh_disabled} | {bh_redundant} | {bh_conflict} |

## 策略健康度

| 指标 | 数值 | 建议阈值 | 状态 |
|------|------|----------|------|
| 过宽策略（any/any） | {overly_permissive} | 0 | {op_status} |
| 长期未命中策略 | {unused_policies} | <10% | {unused_status} |
| 过期策略 | {expired_policies} | 0 | {expired_status} |
| 冗余策略 | {redundant_policies} | 0 | {redundant_status} |
| 冲突策略 | {conflict_policies} | 0 | {conflict_status} |

## 问题策略详情

### 过宽策略

| 策略 ID | 产品 | 规则描述 | 影响 | 建议 |
|---------|------|----------|------|------|
| {policy_id} | {product} | {description} | {impact} | {recommendation} |

### 长期未命中策略

| 策略 ID | 产品 | 规则描述 | 最后命中 | 建议 |
|---------|------|----------|----------|------|
| {policy_id} | {product} | {description} | {last_hit} | {recommendation} |

### 冲突策略

| 策略对 | 产品 | 冲突描述 | 建议 |
|--------|------|----------|------|
| {policy_pair} | {product} | {conflict_desc} | {recommendation} |

## 最佳实践对照

| 实践项 | 当前状态 | 建议状态 | 差距 |
|--------|----------|----------|------|
| 最小权限原则 | {least_priv_current} | {least_priv_target} | {least_priv_gap} |
| 默认拒绝 | {default_deny_current} | {default_deny_target} | {default_deny_gap} |
| 策略注释 | {comment_current} | {comment_target} | {comment_gap} |
| 定期审查 | {review_current} | {review_target} | {review_gap} |

## 优化建议

### 立即清理

1. {cleanup_1}
2. {cleanup_2}

### 策略优化

1. {optimize_1}
2. {optimize_2}

### 流程改进

1. {process_1}
