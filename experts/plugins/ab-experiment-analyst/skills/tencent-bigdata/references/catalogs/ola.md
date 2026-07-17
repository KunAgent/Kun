# OLA（欧拉数据平台）子系统 Skill 明细

> [WARN] **使用本 catalog 内任何子 skill 前，必须先读取该子 skill 的 `SKILL.md`**
>
> 本文档仅用于 **路由发现**：根据触发场景 / 关键词定位到目标子 skill 后，**必须再加载** `sub-skills/<子系统>/<skill-name>/SKILL.md`，了解完整的执行步骤、参数约束、两阶段流程与边界条件，再调用 CLI 命令或脚本。
>
> [FAIL] 严禁仅凭本文档列出的命令清单直接执行；catalog 描述通常省略关键参数与前置依赖，跳读会导致执行路径不准确。

> 本子系统当前包含 **DQC（数据质量引擎）** 模块，基于 `dqc-mcp` MCP Server 提供能力，**无 CLI 依赖**，所有工具通过 MCP 协议调用。Skill 目录为 `OLA/DQC/`，内部按业务域拆分为 6 个子 Skill（体现在 `references/*.md`），共 **27 个 MCP 工具**。
>
> 平台入口：https://ola.woa.com/ola-quality/quality/data-quality/quality-overview

## 前置条件

使用本子系统前必须完成 `dqc-mcp` MCP Server 接入（详见 `sub-skills/OLA/DQC/SKILL.md` 的"MCP 接入配置"章节）：
- 方式一：太湖统一认证（BOX / CodeBuddy 推荐）
- 方式二：手动配置太湖令牌（Bearer TAI_IT_TOKEN）
- 方式三：质量引擎个人令牌（X-Agent-Token，云端 agent 推荐）

## 核心概念：四层级联关系

```
空间(workbenchId) → 监控(monitorId) → 规则(itemId) → 运行结果
```

若用户只提供了 **库名+表名**，优先使用表质量快捷路径（无需空间权限）。

---

### oladqc-space — 空间查询

- **目录**: `OLA/DQC/`（文档：`OLA/DQC/references/space-tools.md`）
- **触发场景**: 用户询问"我有哪些空间"、"可以操作哪些链路"，或其他操作前需先获取 workbenchId。
- **触发关键词**: 授权空间、workbench、workbenchId、我的空间、空间列表
- **核心能力**:
  - 列出当前令牌授权的所有空间
  - 返回每个空间的规则数、监控数、活跃告警数
- **MCP 工具（1 个）**:
  - `list_spaces` — 列出授权空间及摘要

---

### oladqc-rule — 规则管理

- **目录**: `OLA/DQC/`（文档：`OLA/DQC/references/rule-tools.md`）
- **触发场景**: 查询规则列表/详情、创建或修改规则、批量操作、开关规则、排查基线关键运行链路。
- **触发关键词**: 规则列表、我的规则、规则详情、创建规则、修改规则、create_rule、modify_rule、开启规则、关闭规则、enable_rule、disable_rule、基线链路、基线关键路径、ruleCode
- **核心能力**:
  - 读：按空间/用户查询规则列表，查询单条规则完整详情，查询基线关键运行链路
  - 写：创建规则（支持 12 类 ruleCode 模板）、修改规则、批量创建/修改、开关规则
  - 支持数据源：`THIVE` / `HIVE` / `ICEBERG` / `MYSQL` / `CLICKHOUSE` / `STARROCKS`（后 3 类必须指定 `jobPlatform`）
  - 支持规则类型：`timeliness` / `baseline` / `tbl_rowCnt` / `field_empty` / `field_illegal` / `field_repeat` / `field_rowCnt` / `field_rowCntDistinct` / `field_sum` / `field_avg` / `consistency_*`（5 种）/ `user_custom`
- **写操作强制规范**: 必须先展示配置预览/变更对比，用户确认后再执行；`modify_rule` 不可修改 `ruleCode` / `monitorType` / `dataSource`
- **MCP 工具（10 个）**:
  - `list_rules` / `list_user_rules` / `get_rule_detail` / `get_baseline_problem_route`
  - `create_rule` / `modify_rule` / `create_monitor_with_rules` / `batch_modify_rules`
  - `enable_rule` / `disable_rule`

---

### oladqc-monitor — 监控管理

- **目录**: `OLA/DQC/`（文档：`OLA/DQC/references/monitor-tools.md`）
- **触发场景**: 查看某空间/某表整体监控情况，获取一张表下所有规则的摘要。
- **触发关键词**: 监控列表、监控详情、表的监控情况、monitorId、list_monitors
- **核心能力**:
  - 按空间或负责人查询监控列表（一张表对应一个监控）
  - 查询监控详情（含该监控下所有规则摘要）
- **MCP 工具（3 个）**:
  - `list_monitors` / `list_user_monitors` / `get_monitor_detail`

---

### oladqc-alert — 告警事件

- **目录**: `OLA/DQC/`（文档：`OLA/DQC/references/alert-tools.md`）
- **触发场景**: 用户询问最近的告警事件，或排查某告警的上下文（规则配置、推送渠道、调度任务关联）。
- **触发关键词**: 告警、事件、最近告警、告警渠道、RTX 告警、电话告警、push_types、baseline_event、dqc_event、timeless_event
- **核心能力**:
  - 按空间查询告警事件（支持时间、渠道筛选）
  - 按负责人查询告警事件（**无需空间权限**，支持批量用户）
  - 告警渠道筛选：`rtx` / `phone` / `rtxg` / `webhook` / `sre`
  - 返回事件详情含 `msg`、`dqcTaskConfig`、`ruleDataSet`、`verifyConfig`、`pushConfig`、`monitorTaskRelation` 等
- **时间格式**: `yyyy-MM-dd HH:mm:ss`（与运行结果的 `yyyyMMddHHmmss` 不同）
- **MCP 工具（2 个）**:
  - `list_alert_events` / `list_user_alert_events`

---

### oladqc-result — 运行结果

- **目录**: `OLA/DQC/`（文档：`OLA/DQC/references/result-tools.md`）
- **触发场景**: 按空间/用户/监控/规则四个维度查看规则历史运行结果。
- **触发关键词**: 运行情况、执行结果、规则结果、历史运行、通过/失败、list_rule_results
- **核心能力**:
  - 空间级：`list_workbench_rule_results`
  - 用户级：`list_user_rule_results`（**无需空间权限**）
  - 监控级：`list_monitor_all_rule_results`
  - 规则级：`list_rule_results`
- **时间格式**: `yyyyMMddHHmmss`（如 `20260414235959`）
- **MCP 工具（4 个）**:
  - `list_workbench_rule_results` / `list_user_rule_results`
  - `list_monitor_all_rule_results` / `list_rule_results`

---

### oladqc-table — 表元数据 & 表质量

- **目录**: `OLA/DQC/`（文档：`OLA/DQC/references/table-tools.md`）
- **触发场景**: 用户提供 **库名+表名**，希望直接查询表结构、分区产出、表的规则配置或基线状态，**无需逐级获取 workbenchId**（快捷路径）。
- **触发关键词**: 表字段、表结构、分区产出、生产任务、表质量、表规则、基线配置、基线状态、get_table_meta、get_table_rule_configs
- **核心能力**:
  - 元数据：表字段/分区/负责人、表分区产出、表的生产任务
  - 表质量（**无需空间权限**）：表的规则配置、规则运行结果、基线配置、基线运行状态
  - 支持数据源类型（`datasource_type`）：`HIVE`（默认）/ `THIVE` / `MYSQL` / `STARROCKS` / `CLICKHOUSE` / `ICEBERG`
- **MCP 工具（7 个）**:
  - 元数据：`get_table_meta` / `get_table_output` / `get_table_task`
  - 表质量（快捷）：`get_table_rule_configs` / `get_table_rule_results` / `get_table_baseline_configs` / `get_table_baseline_status`

---

## 包含资源

| 文件 | 说明 |
|------|------|
| `OLA/DQC/SKILL.md` | DQC Skills 总览文档（含 MCP 接入配置、全局调用规则、联动关系等） |
| `OLA/DQC/version` | 当前版本号 |
| `OLA/DQC/references/tools-overview.md` | 27 个 MCP 工具总览（按模块分类） |
| `OLA/DQC/references/space-tools.md` | 空间查询子 Skill 详细文档 |
| `OLA/DQC/references/rule-tools.md` | 规则管理子 Skill 详细文档（含 12 类规则模板） |
| `OLA/DQC/references/monitor-tools.md` | 监控管理子 Skill 详细文档 |
| `OLA/DQC/references/alert-tools.md` | 告警事件子 Skill 详细文档 |
| `OLA/DQC/references/result-tools.md` | 运行结果子 Skill 详细文档 |
| `OLA/DQC/references/table-tools.md` | 表元数据 & 表质量子 Skill 详细文档 |

## 全局调用规则

1. **先确认空间**：大多数操作需要 `workbench_id`，先调用 `list_spaces` 获取；若用户只提供表名，优先使用 `oladqc-table` 快捷路径。
2. **写操作必须预览确认**：`create_rule` / `modify_rule` / `create_monitor_with_rules` / `batch_modify_rules` / `enable_rule` / `disable_rule` 等写操作，必须先展示配置预览或变更对比，用户明确确认后再执行。
3. **分页注意**：列表查询接口默认 `page_size=20`。
4. **时间格式差异（重要）**：

   | 接口类型 | 格式 | 示例 |
   |---------|------|------|
   | 告警事件 | `yyyy-MM-dd HH:mm:ss` | `2026-04-01 08:00:00` |
   | 运行结果 / 表质量 | `yyyyMMddHHmmss` | `20260401080000` |
   | 基线实例（`get_baseline_problem_route`） | `yyyyMMdd` | `20260401` |

5. **失败重试上限**：同一次用户问答中，MCP 工具累计失败不超过 3 次（跨子 Skill 累计），达到上限立即停止并输出已收集信息与失败摘要。

## 典型联动

| 场景 | 涉及子 Skill | 流程 |
|------|-------------|------|
| 我今天的告警排查 | alert → rule → result | `list_user_alert_events` → `get_rule_detail` → `list_rule_results` |
| 给某表新建质量监控 | table → rule | `get_table_meta` 确认字段 → `create_rule`（带预览确认） |
| 某表最近跑的怎么样 | table | `get_table_rule_results` + `get_table_baseline_status`（无需空间权限） |
| 空间巡检 | space → monitor → result | `list_spaces` → `list_monitors` → `list_workbench_rule_results` |
| 基线延迟排查 | alert → rule | `list_user_alert_events` 筛 `baseline_event` → `get_baseline_problem_route` 定位关键链路 |
| 批量开关规则 | rule | `list_rules` 筛目标 → 预览清单 → 用户确认 → `enable_rule` / `disable_rule` |
