---
name: security-inspection
description: 安全巡检报告模板，适用于日常安全巡检、定期安全检查、安全运维周报/月报等场景
usage: 当用户需要生成巡检报告、安全周报、安全月报、安全运维总结时使用此模板
---

# 安全巡检报告

## 报告概览

| 字段 | 值 |
|------|-----|
| 巡检时间 | {report_time} |
| 巡检周期 | {period_start} ~ {period_end} |
| 巡检类型 | {inspection_type} |
| 巡检人 | {inspector} |

## 安全态势评分

| 维度 | 评分 | 等级 | 较上期 |
|------|------|------|--------|
| 主机安全 | {host_score}/100 | {host_grade} | {host_trend} |
| 网络安全 | {network_score}/100 | {network_grade} | {network_trend} |
| 应用安全 | {app_score}/100 | {app_grade} | {app_trend} |
| 数据安全 | {data_score}/100 | {data_grade} | {data_trend} |
| 身份安全 | {identity_score}/100 | {identity_grade} | {identity_trend} |
| **综合评分** | **{total_score}/100** | **{total_grade}** | **{total_trend}** |

## 各产品巡检结果

### 主机安全 (CWP)

| 检查项 | 结果 | 详情 |
|--------|------|------|
| 入侵告警 | {cwp_intrusion} | {cwp_intrusion_detail} |
| 漏洞风险 | {cwp_vul} | {cwp_vul_detail} |
| 基线合规 | {cwp_baseline} | {cwp_baseline_detail} |
| 木马检测 | {cwp_malware} | {cwp_malware_detail} |
| Agent 状态 | {cwp_agent} | {cwp_agent_detail} |

### Web 应用防火墙 (WAF)

| 检查项 | 结果 | 详情 |
|--------|------|------|
| 攻击拦截 | {waf_attack} | {waf_attack_detail} |
| 域名防护 | {waf_domain} | {waf_domain_detail} |
| 规则状态 | {waf_rule} | {waf_rule_detail} |
| CC 防护 | {waf_cc} | {waf_cc_detail} |

### 云防火墙 (CFW)

| 检查项 | 结果 | 详情 |
|--------|------|------|
| 策略命中 | {cfw_policy} | {cfw_policy_detail} |
| 入侵防御 | {cfw_ids} | {cfw_ids_detail} |
| 边缘防护 | {cfw_edge} | {cfw_edge_detail} |

### 容器安全 (TCSS)

| 检查项 | 结果 | 详情 |
|--------|------|------|
| 镜像漏洞 | {tcss_image} | {tcss_image_detail} |
| 运行时安全 | {tcss_runtime} | {tcss_runtime_detail} |
| 合规检查 | {tcss_compliance} | {tcss_compliance_detail} |

### 密钥与凭据 (KMS/SSM)

| 检查项 | 结果 | 详情 |
|--------|------|------|
| 密钥轮换 | {kms_rotation} | {kms_rotation_detail} |
| 凭据过期 | {ssm_expiry} | {ssm_expiry_detail} |
| 使用审计 | {kms_audit} | {kms_audit_detail} |

## 发现的问题

| 序号 | 问题描述 | 严重程度 | 影响范围 | 建议措施 | 状态 |
|------|----------|----------|----------|----------|------|
| {idx} | {issue} | {severity} | {scope} | {action} | {status} |

## 与上期对比

| 指标 | 上期 | 本期 | 变化 |
|------|------|------|------|
| 告警数 | {prev_alerts} | {curr_alerts} | {alert_change} |
| 漏洞数 | {prev_vulns} | {curr_vulns} | {vuln_change} |
| 合规率 | {prev_compliance}% | {curr_compliance}% | {compliance_change} |
| 风险资产 | {prev_risk_assets} | {curr_risk_assets} | {risk_change} |

## 待办事项

### 本期需完成

- [ ] {todo_1}
- [ ] {todo_2}
- [ ] {todo_3}

### 遗留问题跟踪

| 问题 | 来源期次 | 责任人 | 截止日期 | 进度 |
|------|----------|--------|----------|------|
| {issue} | {from_period} | {owner} | {deadline} | {progress} |
