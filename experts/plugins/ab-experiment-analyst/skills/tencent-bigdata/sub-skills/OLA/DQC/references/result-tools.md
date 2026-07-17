# 运行结果查询工具

共 4 个只读工具，按不同层级查询规则运行结果。

## 层级关系

```
空间(workbenchId) → 监控(monitorId) → 规则(itemId) → 运行结果
```

对应 4 个层级的查询工具。

---

## list_workbench_rule_results

查询空间下所有规则的运行结果（分页）。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| workbench_id | int | 是 | - | 空间ID |
| start_time | str | 否 | "" | 开始实例时间，格式 yyyyMMddHHmmss |
| end_time | str | 否 | "" | 结束实例时间，格式 yyyyMMddHHmmss |
| page_no | int | 否 | 1 | 页码 |
| page_size | int | 否 | 20 | 每页大小 |

**使用场景**：用户问"这个空间最近的运行情况"、"空间xx的规则结果"

---

## list_user_rule_results

查询用户负责的所有规则的运行结果（分页）。不传 owner 则使用当前认证用户。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| owner | str | 否 | "" | 负责人RTX，不传则使用当前认证用户 |
| start_time | str | 否 | "" | 开始实例时间，格式 yyyyMMddHHmmss |
| end_time | str | 否 | "" | 结束实例时间，格式 yyyyMMddHHmmss |
| page_no | int | 否 | 1 | 页码 |
| page_size | int | 否 | 20 | 每页大小 |

**使用场景**：用户问"我的规则最近运行情况"、"xx用户负责的规则结果"

> [TIP] 无需空间权限，可查询当前用户负责的所有空间的规则结果。

---

## list_monitor_all_rule_results

查询指定监控下所有规则的运行结果（分页）。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| monitor_id | int | 是 | - | 监控ID |
| start_time | str | 否 | "" | 开始实例时间，格式 yyyyMMddHHmmss |
| end_time | str | 否 | "" | 结束实例时间，格式 yyyyMMddHHmmss |
| page_no | int | 否 | 1 | 页码 |
| page_size | int | 否 | 20 | 每页大小 |

**使用场景**：用户问"这个监控的运行情况"、"监控xx最近的结果"

---

## list_rule_results

查询指定规则的历史运行结果详情。需要先通过 `list_rules` 获取 item_id。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| item_id | int | 是 | - | 规则ID（从 list_rules 返回的 itemId 获取） |
| start_time | str | 否 | "" | 起始时间，格式：yyyyMMddHHmmss |
| end_time | str | 否 | "" | 结束时间，格式：yyyyMMddHHmmss |
| page_no | int | 否 | 1 | 页码 |
| page_size | int | 否 | 20 | 每页大小 |

**使用场景**：用户问"这条规则最近运行情况"、"规则xx的执行结果"

---

## 时间格式说明

运行结果查询使用的时间格式为 `yyyyMMddHHmmss`，例如：
- `20260301000000` — 2026年3月1日 00:00:00
- `20260414235959` — 2026年4月14日 23:59:59

> [WARN] 注意：这与告警事件查询的时间格式（`yyyy-MM-dd HH:mm:ss`）不同。
