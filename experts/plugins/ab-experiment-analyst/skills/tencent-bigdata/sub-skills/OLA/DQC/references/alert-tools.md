# 告警事件查询工具

共 2 个只读工具，用于查询数据质量告警事件。

## 通用返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| msgId | String | 事件消息ID（唯一标识） |
| itemId | String | 规则ID |
| sourceType | String | 事件源类型：dqc_event / baseline_event / timeless_event 等 |
| eventType | String | 事件类型：dqc_failure / timeliness_failure 等 |
| status | String | 消费状态：init / success / failure |
| instanceTime | String | 实例时间（yyyyMMddHHmmss） |
| createdOn | Date | 创建时间 |
| msg | String | 事件详情（JSON原文，含告警标题、内容、告警等级等） |
| itemOwner | String | 规则负责人（逗号分隔） |
| dqcTaskConfig | String | DQC任务配置（JSON字符串，来自 t_dqc_item.dqc_task_config） |
| ruleDataSet | String | 规则数据集（JSON字符串，来自 t_dqc_item.rule_data_set） |
| verifyConfig | String | 校验配置（JSON字符串，来自 t_dqc_item.verify_config） |
| pushConfig | String | 推送配置（JSON数组，来自 t_dqc_alarm_push_config，含 pushType 和 receiver） |
| monitorTaskRelation | String | 调度任务关系（JSON数组，来自 t_monitor_task_relation，含 taskId 和 taskPlatform） |

**pushConfig 示例**：
```json
[{"pushType":"rtx","receiver":["user1","user2"]},{"pushType":"phone","receiver":["user3"]}]
```

**monitorTaskRelation 示例**：
```json
[{"taskId":"task_001","taskPlatform":"powerjob"},{"taskId":"task_002","taskPlatform":"tdp"}]
```

> [TIP] dqcTaskConfig、ruleDataSet、verifyConfig 为 JSON 字符串，需解析后使用。pushConfig 和 monitorTaskRelation 为 JSON 数组字符串，无关联数据时为 null。

---

## list_alert_events

查询空间下的告警事件列表。支持按时间范围和告警渠道筛选。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| workbench_id | int | 是 | - | 空间ID |
| start_time | str | 否 | "" | 起始时间，格式：yyyy-MM-dd HH:mm:ss |
| end_time | str | 否 | "" | 结束时间，格式：yyyy-MM-dd HH:mm:ss |
| push_types | str | 否 | "" | 告警渠道列表，逗号分隔，可选值：rtx/phone/rtxg/webhook/sre |
| page_no | int | 否 | 1 | 页码 |
| page_size | int | 否 | 20 | 每页条数 |

**使用场景**：用户问"最近有什么告警"、"今天的告警事件"、"RTX渠道的告警"

**时间格式示例**：`2026-03-01 00:00:00`

**渠道筛选示例**：`push_types="rtx,phone"` 筛选配置了RTX或电话渠道的告警事件

---

## list_user_alert_events

查询用户负责的规则的告警事件，支持批量用户查询。

**无需空间权限**，查询全部相关告警事件。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| start_time | str | 否 | "" | 开始时间，格式：yyyy-MM-dd HH:mm:ss |
| end_time | str | 否 | "" | 结束时间，格式：yyyy-MM-dd HH:mm:ss |
| owners | str | 否 | "" | 用户列表，逗号分隔，如"user1,user2" |
| push_types | str | 否 | "" | 告警渠道列表，逗号分隔，可选值：rtx/phone/rtxg/webhook/sre |
| page_no | int | 否 | 1 | 页码 |
| page_size | int | 否 | 20 | 每页条数 |

**使用场景**：用户问"我有哪些告警"、"xxx用户的告警"、"我的电话告警"

> [TIP] 不传 owners 时自动使用当前认证用户。不传 push_types 时返回所有渠道的告警。
