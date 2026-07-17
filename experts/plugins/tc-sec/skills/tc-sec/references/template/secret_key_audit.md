---
name: secret-key-audit
description: 密钥与凭据审计报告模板，适用于 KMS 密钥管理审计、SSM 凭据安全检查、密钥轮换评估等场景
usage: 当用户需要审计密钥使用情况、检查凭据安全性、评估密钥轮换状态时使用此模板
---

# 密钥与凭据审计报告

> ⚠️ 本文件是**报告结构参考**，不是可执行模板。下文 `{total_keys}`、`{}` 等占位符仅供了解章节结构，**禁止原样输出到报告**。生成报告时用 `import report_html as H` 的组件函数（`H.cards`/`H.table`/`H.section`/`H.finding`）把真实 API 数值填进去；每个数值取自 `wf.exec`/`wf.batch` 返回 dict 的 `TotalCount` 等字段，禁止留 `{}` 占位符。

## 报告概览

| 字段 | 值 |
|------|-----|
| 审计时间 | {report_time} |
| 审计范围 | {scope} |
| 数据来源 | KMS / SSM / CAM |

## 密钥管理 (KMS) 概况

| 指标 | 数值 |
|------|------|
| 密钥总数 | {total_keys} |
| 启用状态 | {enabled_keys} |
| 已禁用 | {disabled_keys} |
| 待删除 | {pending_delete_keys} |
| 已启用轮换 | {rotation_enabled} |
| 未启用轮换 | {rotation_disabled} |

### 密钥用途分布

| 用途 | 数量 | 示例密钥 |
|------|------|----------|
| 数据加密 | {encrypt_count} | {encrypt_sample} |
| 信封加密 | {envelope_count} | {envelope_sample} |
| 签名验证 | {sign_count} | {sign_sample} |

### 密钥风险项

| 风险 | 数量 | 详情 |
|------|------|------|
| 超期未轮换（>90天） | {overdue_rotation} | {overdue_detail} |
| 无使用记录（>30天） | {unused_keys} | {unused_detail} |
| 权限过宽 | {overly_permissive} | {permissive_detail} |

## 凭据管理 (SSM) 概况

| 指标 | 数值 |
|------|------|
| 凭据总数 | {total_secrets} |
| 启用状态 | {enabled_secrets} |
| 已禁用 | {disabled_secrets} |
| 已启用轮转 | {rotation_secrets} |
| 即将过期（30天内） | {expiring_secrets} |

### 凭据类型分布

| 类型 | 数量 |
|------|------|
| 数据库凭据 | {db_secrets} |
| API 密钥 | {api_secrets} |
| SSH 密钥 | {ssh_secrets} |
| 证书 | {cert_secrets} |
| 其他 | {other_secrets} |

### 凭据风险项

| 风险 | 数量 | 详情 |
|------|------|------|
| 已过期未更新 | {expired_secrets} | {expired_detail} |
| 超期未轮转（>90天） | {overdue_secrets} | {overdue_secret_detail} |
| 访问异常 | {abnormal_access} | {abnormal_detail} |

## 访问审计

### 密钥访问 Top N

| 密钥 ID | 调用次数 | 主要调用者 | 操作类型 |
|---------|----------|-----------|----------|
| {key_id} | {call_count} | {caller} | {operations} |

### 异常访问事件

| 时间 | 密钥/凭据 | 调用者 | 操作 | 异常原因 |
|------|-----------|--------|------|----------|
| {time} | {target} | {caller} | {action} | {reason} |

## 建议

### 紧急处置

1. {urgent_1}
2. {urgent_2}

### 安全加固

1. {hardening_1}
2. {hardening_2}

### 运维优化

1. {ops_1}
