---
name: incident-response
description: 安全事件响应报告模板，适用于安全事件应急响应、事件调查分析、事后复盘等场景
usage: 当用户需要记录安全事件处置过程、生成应急响应报告、进行事件复盘时使用此模板
---

# 安全事件响应报告

## 事件概要

| 字段 | 值 |
|------|-----|
| 事件编号 | {incident_id} |
| 事件名称 | {incident_title} |
| 严重等级 | {severity} |
| 发现时间 | {detect_time} |
| 响应时间 | {response_time} |
| 恢复时间 | {recovery_time} |
| 事件状态 | {status} |
| 响应负责人 | {responder} |

## 事件描述

{incident_description}

## 影响范围

| 维度 | 详情 |
|------|------|
| 受影响资产 | {affected_assets} |
| 受影响业务 | {affected_services} |
| 数据影响 | {data_impact} |
| 影响时长 | {impact_duration} |
| 影响用户数 | {affected_users} |

## 时间线

| 时间 | 事件 | 操作人 |
|------|------|--------|
| {time_1} | {event_1} | {actor_1} |
| {time_2} | {event_2} | {actor_2} |
| {time_3} | {event_3} | {actor_3} |

## 攻击链分析

### 攻击路径

1. **初始访问**: {initial_access}
2. **权限提升**: {privilege_escalation}
3. **横向移动**: {lateral_movement}
4. **数据窃取/破坏**: {impact_action}

### 攻击指标 (IoC)

| 类型 | 值 | 说明 |
|------|-----|------|
| IP | {ioc_ip} | {ip_desc} |
| 域名 | {ioc_domain} | {domain_desc} |
| 文件哈希 | {ioc_hash} | {hash_desc} |
| 文件路径 | {ioc_path} | {path_desc} |

## 处置措施

### 遏制措施

1. {containment_1}
2. {containment_2}

### 根除措施

1. {eradication_1}
2. {eradication_2}

### 恢复措施

1. {recovery_1}
2. {recovery_2}

## 根因分析

- **直接原因**: {direct_cause}
- **根本原因**: {root_cause}
- **防护缺口**: {security_gap}

## 改进措施

### 短期（1周内）

1. {short_term_1}
2. {short_term_2}

### 中期（1月内）

1. {medium_term_1}
2. {medium_term_2}

### 长期

1. {long_term_1}

## 经验教训

- {lesson_1}
- {lesson_2}
- {lesson_3}
