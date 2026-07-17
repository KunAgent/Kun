# interview-assistant 数据看板生成指令

> **使用说明**：将本文件内容复制到大同平台的「智能用数」中，平台会自动解析并创建看板。

---

这个知识库里包含大同平台的埋点明细数据。请基于明细数据和以下信息，在**一个看板**中生成所有图卡，按模块分组展示。（这些埋点才刚实现，线上可能还没有正式上报数据，所以查询无数据属于正常现象。）
======
## 一、埋点方案

### 约定说明
- **事件（event_code）** 是 Beacon 上报事件名，英文小写+下划线命名。
- **Skill 通过 Beacon 协议上报**，事件数据在 `mapValue` 中，字段均为自定义 key-value。
- 公共字段（每个事件自动携带）：`skill_name`（Skill 名称）、`skill_user`（用户标识，whoami 自动采集，人维度 UV）、`skill_platform`（运行平台）、`skill_os`（操作系统）、`skill_version`（Skill 版本号，可选）。
- 设备标识 `A2` 用于设备维度 UV 去重（Beacon 协议层字段）；`skill_user` 用于人维度 UV 去重（通过 whoami 命令自动采集系统用户名）。
- **UV 统计优先使用 `skill_user`（人维度），降级使用 `A2`（设备维度）**。
- 触发时机说明：`session_start` = 会话开始，`session_end` = 会话关闭，`on_event` = 业务节点触发，`on_error` = 异常捕获。
---

### 1. 通用基础事件
| 触发时机 | 事件 event_code | 私有参数 |
|---------|----------------|---------|
| session_start | Skill调用 / `skill_invoked` | 会话ID / `session_id`；调用来源 / `source`；意图分类 / `intent_category`（可选，由模型根据用户意图自动归类，值域：todo/schedule/prepare/evaluate） |
| on_event | 任务完成 / `task_completed` | 会话ID / `session_id`；完成状态 / `status`（值域：success/fail/partial）；失败归因 / `fail_reason`（可选，值域：skill_bug/llm_limitation/user_cancel/dependency_error/timeout）；用户反馈 / `feedback`（可选，值域：positive/negative/retry/abandon） |
| on_error | 异常发生 / `error_occurred` | 错误类型 / `error_type`（值域：mcp_error/decode_error/api_timeout/script_error）；错误摘要 / `error_message`；发生阶段 / `phase`（值域：router/flow_load/mcp_call/decode/output）；错误码 / `error_code`（可选，开发者自定义） |
| session_end | 会话结束 / `session_end` | 会话ID / `session_id`；会话时长秒 / `duration_seconds`；结束原因 / `reason`；对话轮数 / `turn_count`（可选） |

### 2. 业务私有事件

| 触发时机 | 事件 event_code | 私有参数 |
|---------|----------------|---------|
| on_event | 路由分发 / `router_dispatched` | 会话ID / `session_id`；类目 / `category`（值域：todo/schedule/prepare/evaluate/redirect）；子模块 / `sub_flow`（值域：T/T2/S/M/A/B/C/D） |
| on_event | 模型路由 / `model_routed` | 会话ID / `session_id`；匹配级别 / `match_level`（值域：auto-matched/bg-fallback/type-fallback/global-fallback）；BG名称 / `bg`；岗位 / `station`；招聘类型 / `recruit_type`（值域：campus/social/intern）；模型文件名 / `model_file` |
| on_event | 流程完成 / `flow_completed` | 会话ID / `session_id`；流程类型 / `flow_type`（值域：T/T2/S/A/B/C/D）；完成状态 / `status`（值域：success/fail/partial）；执行耗时 / `duration_seconds` |

---

## 二、看板方案

> 以下所有图卡在**同一个看板**中，按三个模块分组展示。

### 模块一：Skill 总览（给老板汇报）

```
┌─────────────────────┬─────────────────────┬─────────────────────┬─────────────────────┐
│ 📈 今日调用量 (PV)    │ 📈 今日用户数 (UV)    │ 📈 任务成功率         │ 📈 本周活跃用户 (WAU) │
│                     │                     │                     │                     │
│ 今日 skill_invoked  │ 今日去重用户数        │ success / 总完成数    │ 近7天去重用户数       │
│ 总次数              │                     │                     │                     │
├─────────────────────┴─────────────────────┴─────────────────────┴─────────────────────┤
│                                                                                       │
│  📉 DAU 趋势（最近30天折线图）                                                           │
│                                                                                       │
├───────────────────────────────────┬───────────────────────────────────────────────────┤
│ 🥧 平台分布                       │ 📊 每日 PV/UV 对比（最近7天柱状图）                   │
│ (CodeBuddy vs OpenClaw vs BoxAI)  │                                                   │
└───────────────────────────────────┴───────────────────────────────────────────────────┘
```

**图卡计算逻辑：**
| 图卡 | 计算逻辑 (伪SQL) |
|------|-----------------|
| 今日调用量 (PV) | `SELECT COUNT(*) FROM events WHERE event_code = 'skill_invoked' AND ds >= CONCAT(TODAY(), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 今日用户数 (UV) | `SELECT COUNT(DISTINCT COALESCE(skill_user, A2)) FROM events WHERE event_code = 'skill_invoked' AND ds >= CONCAT(TODAY(), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 任务成功率 | `SELECT ROUND(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS success_rate FROM events WHERE event_code = 'task_completed' AND ds >= CONCAT(TODAY(), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 本周活跃用户 (WAU) | `SELECT COUNT(DISTINCT COALESCE(skill_user, A2)) FROM events WHERE event_code = 'skill_invoked' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23')` |
| DAU 趋势 | `SELECT SUBSTR(ds, 1, 8) AS dt, COUNT(DISTINCT COALESCE(skill_user, A2)) AS dau FROM events WHERE event_code = 'skill_invoked' AND ds >= CONCAT(DATE_SUB(TODAY(), 30), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY SUBSTR(ds, 1, 8) ORDER BY dt DESC LIMIT 30` |
| 平台分布 | `SELECT skill_platform, COUNT(DISTINCT COALESCE(skill_user, A2)) AS users FROM events WHERE event_code = 'skill_invoked' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY skill_platform` |
| 每日 PV/UV 对比 | `SELECT SUBSTR(ds, 1, 8) AS dt, COUNT(*) AS pv, COUNT(DISTINCT COALESCE(skill_user, A2)) AS uv FROM events WHERE event_code = 'skill_invoked' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY SUBSTR(ds, 1, 8) ORDER BY dt` |

---

### 模块二：Skill 监控（给开发者）

```
┌─────────────────────┬─────────────────────┬─────────────────────┬─────────────────────┐
│ 📈 今日异常数         │ 📈 异常率            │ 📈 平均会话时长       │ 📈 今日失败任务数     │
│                     │                     │                     │                     │
│ 今日 error_occurred │ 异常数 / 调用数       │ AVG(duration)       │ status=fail 数       │
│ 总次数              │                     │                     │                     │
├─────────────────────┴─────────────────────┴─────────────────────┴─────────────────────┤
│                                                                                       │
│  📉 异常率趋势（最近14天折线图）                                                          │
│                                                                                       │
├───────────────────────────────────┬───────────────────────────────────────────────────┤
│ 🥧 错误类型分布                    │ 📊 任务完成状态分布（最近7天堆叠柱状图）               │
├───────────────────────────────────┴───────────────────────────────────────────────────┤
│                                                                                       │
│  📊 会话时长分布（柱状图，按 <30s / 30s-2m / 2m-5m / 5m-10m / >10m 分桶）               │
│                                                                                       │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**图卡计算逻辑：**
| 图卡 | 计算逻辑 (伪SQL) |
|------|-----------------|
| 今日异常数 | `SELECT COUNT(*) FROM events WHERE event_code = 'error_occurred' AND ds >= CONCAT(TODAY(), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 异常率 | `SELECT ROUND(err.cnt * 100.0 / inv.cnt, 2) AS error_rate FROM (SELECT COUNT(*) AS cnt FROM events WHERE event_code = 'error_occurred' AND ds >= CONCAT(TODAY(), '00') AND ds <= CONCAT(TODAY(), '23')) err, (SELECT COUNT(*) AS cnt FROM events WHERE event_code = 'skill_invoked' AND ds >= CONCAT(TODAY(), '00') AND ds <= CONCAT(TODAY(), '23')) inv` |
| 平均会话时长 | `SELECT AVG(CAST(duration_seconds AS BIGINT)) FROM events WHERE event_code = 'session_end' AND ds >= CONCAT(TODAY(), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 今日失败任务数 | `SELECT COUNT(*) FROM events WHERE event_code = 'task_completed' AND status = 'fail' AND ds >= CONCAT(TODAY(), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 异常率趋势 | `SELECT SUBSTR(ds, 1, 8) AS dt, ROUND(SUM(CASE WHEN event_code = 'error_occurred' THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN event_code = 'skill_invoked' THEN 1 ELSE 0 END), 0), 2) AS error_rate FROM events WHERE event_code IN ('error_occurred', 'skill_invoked') AND ds >= CONCAT(DATE_SUB(TODAY(), 14), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY SUBSTR(ds, 1, 8) ORDER BY dt DESC LIMIT 14` |
| 错误类型分布 | `SELECT error_type, COUNT(*) AS cnt FROM events WHERE event_code = 'error_occurred' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY error_type ORDER BY cnt DESC` |
| 任务完成状态分布 | `SELECT SUBSTR(ds, 1, 8) AS dt, status, COUNT(*) AS cnt FROM events WHERE event_code = 'task_completed' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY SUBSTR(ds, 1, 8), status ORDER BY dt` |
| 会话时长分布 | `SELECT CASE WHEN CAST(duration_seconds AS BIGINT) < 30 THEN '<30s' WHEN CAST(duration_seconds AS BIGINT) < 120 THEN '30s-2m' WHEN CAST(duration_seconds AS BIGINT) < 300 THEN '2m-5m' WHEN CAST(duration_seconds AS BIGINT) < 600 THEN '5m-10m' ELSE '>10m' END AS duration_bucket, COUNT(*) AS cnt FROM events WHERE event_code = 'session_end' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY duration_bucket ORDER BY cnt DESC` |

---

### 模块三：业务分析（面试助手专属）

```
┌─────────────────────┬─────────────────────┬─────────────────────┬─────────────────────┐
│ 📈 M-Auto 模型命中率  │ 📈 今日路由分发次数    │ 📈 核心流程完成率     │ 📈 出题/面评完成率    │
│                     │                     │                     │                     │
│ auto-matched占比     │ router_dispatched数  │ flow总成功率         │ C/D flow成功率       │
├─────────────────────┴─────────────────────┴─────────────────────┴─────────────────────┤
│                                                                                       │
│  📉 类目分布趋势（最近7天堆叠面积图：todo/schedule/prepare/evaluate）                      │
│                                                                                       │
├───────────────────────────────────┬───────────────────────────────────────────────────┤
│ 🥧 BG 分布（面试官来源）            │ 📊 模型匹配级别分布                                  │
└───────────────────────────────────┴───────────────────────────────────────────────────┘
```

**图卡计算逻辑：**
| 图卡 | 计算逻辑 (伪SQL) |
|------|-----------------|
| M-Auto 模型命中率 | `SELECT ROUND(SUM(CASE WHEN match_level = 'auto-matched' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS hit_rate FROM events WHERE event_code = 'model_routed' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 今日路由分发次数 | `SELECT COUNT(*) FROM events WHERE event_code = 'router_dispatched' AND ds >= CONCAT(TODAY(), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 核心流程完成率 | `SELECT ROUND(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS complete_rate FROM events WHERE event_code = 'flow_completed' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 出题/面评完成率 | `SELECT ROUND(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS complete_rate FROM events WHERE event_code = 'flow_completed' AND flow_type IN ('C', 'D') AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 类目分布趋势 | `SELECT SUBSTR(ds, 1, 8) AS dt, category, COUNT(*) AS cnt FROM events WHERE event_code = 'router_dispatched' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY SUBSTR(ds, 1, 8), category ORDER BY dt` |
| BG 分布 | `SELECT bg, COUNT(DISTINCT COALESCE(skill_user, A2)) AS users FROM events WHERE event_code = 'model_routed' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY bg ORDER BY users DESC` |
| 模型匹配级别分布 | `SELECT match_level, COUNT(*) AS cnt FROM events WHERE event_code = 'model_routed' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY match_level ORDER BY cnt DESC` |
