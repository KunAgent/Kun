---
name: asset-inventory
description: 资产盘点报告模板，适用于安全资产清单、资产暴露面分析、资产合规检查等场景
usage: 当用户需要盘点资产、查看资产清单、分析资产暴露面时使用此模板
---

# 资产盘点报告

## 报告概览

| 字段 | 值 |
|------|-----|
| 盘点时间 | {report_time} |
| 盘点范围 | {scope} |
| 数据来源 | {data_sources} |

## 资产总览

| 资产类型 | 数量 | 在线 | 离线 | 风险资产 |
|----------|------|------|------|----------|
| 云服务器 CVM | {cvm_count} | {cvm_online} | {cvm_offline} | {cvm_risk} |
| 轻量服务器 | {lh_count} | {lh_online} | {lh_offline} | {lh_risk} |
| 容器/Pod | {container_count} | {container_online} | {container_offline} | {container_risk} |
| 数据库实例 | {db_count} | {db_online} | {db_offline} | {db_risk} |
| 域名 | {domain_count} | - | - | {domain_risk} |
| 公网 IP | {ip_count} | - | - | {ip_risk} |

**资产总数**: {total_assets}
**风险资产占比**: {risk_pct}%

## 暴露面分析

### 公网暴露

| 资产 | 暴露端口 | 服务类型 | 风险等级 |
|------|----------|----------|----------|
| {asset_ip} | {ports} | {service} | {risk_level} |

### 未纳管资产

| 资产 | 类型 | 发现来源 | 建议操作 |
|------|------|----------|----------|
| {asset} | {type} | {source} | {action} |

## 安全防护覆盖

| 安全产品 | 应覆盖 | 已覆盖 | 覆盖率 | 未覆盖资产 |
|----------|--------|--------|--------|------------|
| 主机安全 CWP | {cwp_should} | {cwp_covered} | {cwp_pct}% | {cwp_uncovered} |
| WAF | {waf_should} | {waf_covered} | {waf_pct}% | {waf_uncovered} |
| 云防火墙 CFW | {cfw_should} | {cfw_covered} | {cfw_pct}% | {cfw_uncovered} |
| 容器安全 TCSS | {tcss_should} | {tcss_covered} | {tcss_pct}% | {tcss_uncovered} |

## 资产变动

### 新增资产

| 资产 | 类型 | 创建时间 | 责任人 |
|------|------|----------|--------|
| {asset} | {type} | {create_time} | {owner} |

### 已下线资产

| 资产 | 类型 | 下线时间 | 原因 |
|------|------|----------|------|
| {asset} | {type} | {offline_time} | {reason} |

## 建议

### 安全加固

1. {hardening_action_1}
2. {hardening_action_2}

### 资产治理

1. {governance_action_1}
2. {governance_action_2}
