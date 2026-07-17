# 校招保温工作台 数据看板生成指令

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
| session_start | Skill调用 / `skill_invoked` | 会话ID / `session_id`；调用来源 / `invoke_source`（command/keyword/automation）；招聘经理 / `user_login_name`；意图分类 / `intent_category`（可选，query/script/reminder/push/automation/notify） |
| on_event | 任务完成 / `task_completed` | Skill名称 / `skill_name`；场景 / `scene`（A_query/B_script/C_reminder/D_wechat/E_automation/F_hrclaw）；耗时 / `duration_ms`；会话ID / `session_id`；失败归因 / `fail_reason`（可选） |
| on_error | 异常发生 / `error_occurred` | Skill名称 / `skill_name`；异常场景 / `error_scene`（data_source/identity/query/hrclaw_send/wechat_send/automation/org_resolve/other）；会话ID / `session_id`；错误码 / `error_code`（可选）；错误摘要 / `error_message`（可选） |
| session_end | 会话结束 / `session_end` | Skill名称 / `skill_name`；会话ID / `session_id`；使用场景 / `scenes_used`；总耗时 / `total_duration_ms`；触发事件总数 / `total_events_fired` |

### 2. 业务私有事件

| 触发时机 | 事件 event_code | 私有参数 |
|---------|----------------|---------|
| on_event | 场景A数据查询 / `scene_a_query` | 查询范围 / `query_scope`；是否全组织视角 / `is_full_org_view`；组织过滤类型 / `org_filter_type`（可选）；结果总人数 / `result_total`；已签人数 / `result_signed`；毁约人数 / `result_broken`；高风险数 / `risk_high_count`；中风险数 / `risk_medium_count`；导师未填数 / `no_mentor_count`；上级未填数 / `no_leader_count`；30天内入职数 / `pre_entry_30d_count`；请求链接 / `link_requested`；补充数据源 / `zhaopin_mcp_used`；是否启用V4 / `deep_analysis_used`；V4重点关注人数 / `focus_p1_p2_count`；V4稳定签约识别人数 / `stable_candidate_count`；招聘经理 / `user_login_name`；会话ID / `session_id` |
| on_event | 场景B话术生成 / `scene_b_script` | 话术模板 / `template_id`（S1_welcome~S7_risk_check）；风险等级 / `candidate_risk_level`（low/medium/high/lost）；简历Hook / `has_resume_hook`；面评Hook / `has_interview_hook`；多版本 / `multi_version`；补充数据源 / `zhaopin_mcp_used`；是否启用V4 / `deep_analysis_used`；关注优先级 / `attention_priority`（P1/P2/P3/P4，可选）；稳定签约等级 / `stability_level`（高/中/低，可选）；招聘经理 / `user_login_name`；会话ID / `session_id` |
| on_event | 场景C保温提醒 / `scene_c_reminder` | 触发方式 / `trigger_type`（auto/explicit/skipped）；L1紧急数 / `l1_count`；L2重要数 / `l2_count`；L3常规数 / `l3_count`；L1导师未填数 / `no_mentor_in_l1`；L1临近入职数 / `pre_entry_in_l1`；招聘经理 / `user_login_name`；会话ID / `session_id` |
| on_event | 场景D企微推送 / `scene_d_wechat` | 动作 / `action`（push_instant/schedule_created/schedule_updated）；推送结果 / `push_result`（success/failed/mcp_unavailable）；频率 / `frequency`；查询范围 / `query_scope`；招聘经理 / `user_login_name`；会话ID / `session_id` |
| on_event | 场景E自动化任务 / `scene_e_automation` | 动作 / `action`（created/updated/deleted）；频率类型 / `frequency_type`；查询范围 / `query_scope`；叠加企微 / `with_wechat_push`；招聘经理 / `user_login_name`；会话ID / `session_id` |
| on_event | 场景F HRClaw通知 / `scene_f_hrclaw` | 通知渠道 / `channel`（mail/workchat_tips）；通知对象 / `notify_target`（tutor/leader/both）；模板类型 / `template_type`（single/multi）；OA登录结果 / `oa_login_result`；发送结果 / `send_result`；收件人数 / `receiver_count`；候选人数 / `candidate_count`；简历链接 / `has_resume_link`；员工子类型 / `has_employee_subtype`；浏览器自动化 / `use_browser_automation`；回退原因 / `fallback_reason`（可选）；招聘经理 / `user_login_name`；会话ID / `session_id` |

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
| 错误类型分布 | `SELECT error_scene, COUNT(*) AS cnt FROM events WHERE event_code = 'error_occurred' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY error_scene ORDER BY cnt DESC` |
| 任务完成状态分布 | `SELECT SUBSTR(ds, 1, 8) AS dt, status, COUNT(*) AS cnt FROM events WHERE event_code = 'task_completed' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY SUBSTR(ds, 1, 8), status ORDER BY dt` |
| 会话时长分布 | `SELECT CASE WHEN CAST(duration_seconds AS BIGINT) < 30 THEN '<30s' WHEN CAST(duration_seconds AS BIGINT) < 120 THEN '30s-2m' WHEN CAST(duration_seconds AS BIGINT) < 300 THEN '2m-5m' WHEN CAST(duration_seconds AS BIGINT) < 600 THEN '5m-10m' ELSE '>10m' END AS duration_bucket, COUNT(*) AS cnt FROM events WHERE event_code = 'session_end' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY duration_bucket ORDER BY cnt DESC` |

---

### 模块三：业务分析

```
┌─────────────────────┬─────────────────────┬─────────────────────┬─────────────────────┐
│ 📈 今日数据查询次数    │ 📈 今日话术生成次数    │ 📈 企微推送成功率      │ 📈 自动化渗透率       │
│                     │                     │                     │                     │
│ scene_a_query 计数  │ scene_b_script 计数  │ D场景success占比     │ 创建过automation用户/DAU│
├─────────────────────┴─────────────────────┴─────────────────────┴─────────────────────┤
│                                                                                       │
│  📉 六大场景使用趋势（最近14天折线图，按场景分色）                                          │
│                                                                                       │
├───────────────────────────────────┬───────────────────────────────────────────────────┤
│ 🥧 查询范围分布                    │ 📊 话术模板使用分布                                   │
├───────────────────────────────────┼───────────────────────────────────────────────────┤
│ 🥧 HRClaw通知渠道分布              │ 📊 OA浏览器自动化成功率                               │
├───────────────────────────────────┼───────────────────────────────────────────────────┤
│ 📊 导师/上级未填率趋势              │ 📊 自动化+企微叠加率                                   │
├───────────────────────────────────┼───────────────────────────────────────────────────┤
│ 📈 V4深度分析覆盖率                 │ 🥧 V4关注优先级分布                                    │
├───────────────────────────────────┼───────────────────────────────────────────────────┤
│ 🥧 V4稳定签约等级分布               │ 📊 重点关注/稳定签约识别人数趋势                        │
└───────────────────────────────────┴───────────────────────────────────────────────────┘
```

**图卡计算逻辑：**

| 图卡 | 计算逻辑 (伪SQL) |
|------|-----------------|
| 今日数据查询次数 | `SELECT COUNT(*) FROM events WHERE event_code = 'scene_a_query' AND ds >= CONCAT(TODAY(), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 今日话术生成次数 | `SELECT COUNT(*) FROM events WHERE event_code = 'scene_b_script' AND ds >= CONCAT(TODAY(), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 企微推送成功率 | `SELECT ROUND(SUM(CASE WHEN push_result = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS push_rate FROM events WHERE event_code = 'scene_d_wechat' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 自动化渗透率 | `SELECT ROUND(COUNT(DISTINCT a.skill_user) * 100.0 / NULLIF(COUNT(DISTINCT i.skill_user), 0), 1) AS automation_rate FROM (SELECT skill_user FROM events WHERE event_code = 'skill_invoked' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23')) i LEFT JOIN (SELECT DISTINCT skill_user FROM events WHERE event_code = 'scene_e_automation' AND action = 'created' AND ds >= CONCAT(DATE_SUB(TODAY(), 30), '00') AND ds <= CONCAT(TODAY(), '23')) a ON i.skill_user = a.skill_user` |
| 六大场景使用趋势 | `SELECT SUBSTR(ds, 1, 8) AS dt, scene, COUNT(*) AS cnt FROM (SELECT ds, 'A_query' AS scene FROM events WHERE event_code = 'scene_a_query' UNION ALL SELECT ds, 'B_script' FROM events WHERE event_code = 'scene_b_script' UNION ALL SELECT ds, 'C_reminder' FROM events WHERE event_code = 'scene_c_reminder' UNION ALL SELECT ds, 'D_wechat' FROM events WHERE event_code = 'scene_d_wechat' UNION ALL SELECT ds, 'E_automation' FROM events WHERE event_code = 'scene_e_automation' UNION ALL SELECT ds, 'F_hrclaw' FROM events WHERE event_code = 'scene_f_hrclaw') t WHERE ds >= CONCAT(DATE_SUB(TODAY(), 14), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY SUBSTR(ds, 1, 8), scene ORDER BY dt` |
| 查询范围分布 | `SELECT query_scope, COUNT(*) AS cnt FROM events WHERE event_code = 'scene_a_query' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY query_scope ORDER BY cnt DESC` |
| 话术模板使用分布 | `SELECT template_id, COUNT(*) AS cnt FROM events WHERE event_code = 'scene_b_script' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY template_id ORDER BY cnt DESC` |
| HRClaw通知渠道分布 | `SELECT channel, COUNT(*) AS cnt FROM events WHERE event_code = 'scene_f_hrclaw' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY channel ORDER BY cnt DESC` |
| OA浏览器自动化成功率 | `SELECT ROUND(SUM(CASE WHEN use_browser_automation = 'yes' AND send_result = 'success' THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN use_browser_automation = 'yes' THEN 1 ELSE 0 END), 0), 1) AS auto_rate FROM events WHERE event_code = 'scene_f_hrclaw' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23')` |
| 导师/上级未填率趋势 | `SELECT SUBSTR(ds, 1, 8) AS dt, ROUND(AVG(CAST(no_mentor_count AS FLOAT) + CAST(no_leader_count AS FLOAT)) / NULLIF(AVG(CAST(result_total AS FLOAT)), 0) * 100, 1) AS vacancy_rate FROM events WHERE event_code = 'scene_a_query' AND ds >= CONCAT(DATE_SUB(TODAY(), 14), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY SUBSTR(ds, 1, 8) ORDER BY dt` |
| 自动化+企微叠加率 | `SELECT with_wechat_push, COUNT(*) AS cnt FROM events WHERE event_code = 'scene_e_automation' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY with_wechat_push` |
| V4深度分析覆盖率 | `SELECT ROUND(SUM(CASE WHEN deep_analysis_used = 'yes' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS deep_analysis_rate FROM (SELECT deep_analysis_used FROM events WHERE event_code = 'scene_a_query' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23') UNION ALL SELECT deep_analysis_used FROM events WHERE event_code = 'scene_b_script' AND ds >= CONCAT(DATE_SUB(TODAY(), 7), '00') AND ds <= CONCAT(TODAY(), '23')) t` |
| V4关注优先级分布 | `SELECT attention_priority, COUNT(*) AS cnt FROM events WHERE event_code = 'scene_b_script' AND deep_analysis_used = 'yes' AND attention_priority IS NOT NULL AND attention_priority <> '' AND ds >= CONCAT(DATE_SUB(TODAY(), 14), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY attention_priority ORDER BY attention_priority` |
| V4稳定签约等级分布 | `SELECT stability_level, COUNT(*) AS cnt FROM events WHERE event_code = 'scene_b_script' AND deep_analysis_used = 'yes' AND stability_level IS NOT NULL AND stability_level <> '' AND ds >= CONCAT(DATE_SUB(TODAY(), 14), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY stability_level ORDER BY cnt DESC` |
| 重点关注/稳定签约识别人数趋势 | `SELECT SUBSTR(ds, 1, 8) AS dt, SUM(CAST(COALESCE(focus_p1_p2_count, '0') AS BIGINT)) AS focus_cnt, SUM(CAST(COALESCE(stable_candidate_count, '0') AS BIGINT)) AS stable_cnt FROM events WHERE event_code = 'scene_a_query' AND deep_analysis_used = 'yes' AND ds >= CONCAT(DATE_SUB(TODAY(), 14), '00') AND ds <= CONCAT(TODAY(), '23') GROUP BY SUBSTR(ds, 1, 8) ORDER BY dt` |
