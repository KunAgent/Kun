# 工具总览

dqc-mcp 共提供 **27 个 MCP 工具**，按业务域分为 **6 个模块**，对应 6 个子 Skill。

## 核心查询层级

```
空间(workbenchId) → 监控(monitorId) → 规则(itemId) → 运行结果
```

## 模块概览

### 1. 空间查询（1 个工具）

| 工具 | 类型 | 说明 |
|------|------|------|
| `list_spaces` | 读 | 列出当前令牌授权的所有空间及摘要信息 |

详见 [space-tools.md](space-tools.md)。

### 2. 规则管理（10 个工具）

| 工具 | 类型 | 说明 |
|------|------|------|
| `list_rules` | 读 | 查询空间下的规则列表 |
| `list_user_rules` | 读 | 查询用户负责的所有规则 |
| `get_rule_detail` | 读 | 查询单条规则完整详情 |
| `get_baseline_problem_route` | 读 | 查询基线关键运行链路 |
| `create_rule` | 写 | 创建新的监控规则 |
| `modify_rule` | 写 | 修改已有规则配置 |
| `create_monitor_with_rules` | 写 | 批量创建多规则 |
| `batch_modify_rules` | 写 | 批量修改监控规则 |
| `enable_rule` | 写 | 开启规则 |
| `disable_rule` | 写 | 关闭规则 |

详见 [rule-tools.md](rule-tools.md)。

### 3. 监控管理（3 个工具）

| 工具 | 类型 | 说明 |
|------|------|------|
| `list_monitors` | 读 | 查询空间下的监控列表 |
| `list_user_monitors` | 读 | 查询用户负责的所有监控 |
| `get_monitor_detail` | 读 | 查询监控详情（含规则摘要） |

详见 [monitor-tools.md](monitor-tools.md)。

### 4. 告警事件（2 个工具）

| 工具 | 类型 | 说明 |
|------|------|------|
| `list_alert_events` | 读 | 查询空间下的告警事件 |
| `list_user_alert_events` | 读 | 查询用户负责的告警事件（无需空间权限） |

详见 [alert-tools.md](alert-tools.md)。

### 5. 运行结果（4 个工具）

| 工具 | 类型 | 说明 |
|------|------|------|
| `list_workbench_rule_results` | 读 | 查询空间下所有规则运行结果 |
| `list_user_rule_results` | 读 | 查询用户负责的规则运行结果 |
| `list_monitor_all_rule_results` | 读 | 查询监控下所有规则运行结果 |
| `list_rule_results` | 读 | 查询单条规则历史运行结果 |

详见 [result-tools.md](result-tools.md)。

### 6. 表元数据 & 表质量（7 个工具）

| 工具 | 类型 | 说明 |
|------|------|------|
| `get_table_meta` | 读 | 获取表元数据（字段、分区、负责人等） |
| `get_table_output` | 读 | 获取表分区产出信息 |
| `get_table_task` | 读 | 查询表的生产任务 |
| `get_table_rule_configs` | 读 | 查询表的规则配置（无需空间权限） |
| `get_table_rule_results` | 读 | 查询表的规则运行结果（无需空间权限） |
| `get_table_baseline_configs` | 读 | 查询表的基线配置（无需空间权限） |
| `get_table_baseline_status` | 读 | 查询表的基线运行状态（无需空间权限） |

详见 [table-tools.md](table-tools.md)。

---

## 权限说明

- **需要空间权限**：空间查询 / 监控管理 / 规则管理 / 告警事件（空间级）/ 运行结果（空间级、监控级、规则级）— 当前令牌需归属对应空间。
- **无需空间权限**：
  - 表质量查询：`get_table_rule_configs` / `get_table_rule_results` / `get_table_baseline_configs` / `get_table_baseline_status`
  - 用户级查询：`list_user_rules` / `list_user_monitors` / `list_user_alert_events` / `list_user_rule_results`

## 时间格式差异（重要）

| 接口类型 | 格式 | 示例 |
|---------|------|------|
| 告警事件 | `yyyy-MM-dd HH:mm:ss` | `2026-04-01 08:00:00` |
| 运行结果 / 表质量 | `yyyyMMddHHmmss` | `20260401080000` |
| 基线实例 | `yyyyMMdd` | `20260401` |
