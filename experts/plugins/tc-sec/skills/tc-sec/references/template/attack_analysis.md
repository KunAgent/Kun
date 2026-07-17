---
name: attack-analysis
description: 攻击事件分析报告模板，适用于 WAF 攻击日志分析、入侵事件溯源、攻击态势分析等场景
usage: 当用户需要分析攻击事件、溯源攻击链路、生成攻击态势报告时使用此模板
---

# 攻击事件分析报告

## 报告概览

| 字段 | 值 |
|------|-----|
| 分析时间 | {report_time} |
| 分析周期 | {period_start} ~ {period_end} |
| 数据来源 | {data_sources} |
| 受攻击资产 | {target_assets} |

## 攻击态势概览

| 指标 | 数值 |
|------|------|
| 攻击总次数 | {total_attacks} |
| 攻击源 IP 数 | {unique_sources} |
| 受攻击目标数 | {unique_targets} |
| 拦截次数 | {blocked} |
| 放行/绕过次数 | {passed} |
| 拦截率 | {block_rate}% |

## 攻击类型分布

| 攻击类型 | 次数 | 占比 | 拦截率 |
|----------|------|------|--------|
| SQL 注入 | {sqli_count} | {sqli_pct}% | {sqli_block}% |
| XSS | {xss_count} | {xss_pct}% | {xss_block}% |
| 命令注入 | {cmdi_count} | {cmdi_pct}% | {cmdi_block}% |
| 路径遍历 | {path_count} | {path_pct}% | {path_block}% |
| 暴力破解 | {brute_count} | {brute_pct}% | {brute_block}% |
| CC 攻击 | {cc_count} | {cc_pct}% | {cc_block}% |
| 其他 | {other_count} | {other_pct}% | {other_block}% |

## 攻击源分析

### Top 攻击源 IP

| 排名 | 源 IP | 攻击次数 | 攻击类型 | 地理位置 | 威胁情报 |
|------|-------|----------|----------|----------|----------|
| {rank} | {src_ip} | {count} | {types} | {geo} | {threat_intel} |

### 攻击源地域分布

| 地域 | 攻击次数 | 占比 |
|------|----------|------|
| {region} | {count} | {pct}% |

## 受攻击目标分析

### Top 受攻击域名/资产

| 目标 | 攻击次数 | 主要攻击类型 | 拦截率 |
|------|----------|-------------|--------|
| {target} | {count} | {main_type} | {block_rate}% |

### Top 受攻击路径

| URL 路径 | 攻击次数 | 攻击类型 |
|----------|----------|----------|
| {path} | {count} | {type} |

## 攻击时序分析

- **攻击高峰时段**: {peak_hours}
- **攻击持续时间**: {duration}
- **攻击频率趋势**: {frequency_trend}

## 重点攻击事件

### {event_index}. {event_title}

| 字段 | 说明 |
|------|------|
| 事件时间 | {event_time} |
| 攻击源 | {source} |
| 攻击目标 | {target} |
| 攻击类型 | {attack_type} |
| 攻击载荷 | {payload_summary} |
| 处置结果 | {action_result} |
| 影响评估 | {impact} |

<!-- 重复上述块 -->

## 防护建议

### 规则优化

1. {rule_action_1}
2. {rule_action_2}

### IP 封禁建议

1. {block_action_1}

### 架构加固

1. {arch_action_1}
