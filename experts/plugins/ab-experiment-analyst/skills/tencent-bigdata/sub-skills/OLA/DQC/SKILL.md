---
name: oladqc-skills
description: >
  欧拉数据质量引擎（OLA DQC）Skills 集合，通过 dqc-mcp MCP Server 提供一站式数据质量
  规则配置、管理与告警排查能力。涵盖空间查询、规则管理、监控管理、告警事件、运行结果、
  表元数据与表质量六大子 Skill。当用户问题涉及数据质量规则、DQC、欧拉质量引擎、基线告警、
  规则运行结果、表质量、监控配置、告警事件等场景时，路由到本 Skill 的对应子 Skill。
  触发关键词：OLA DQC、数据质量、质量规则、质量监控、基线、告警事件、告警查询、规则运行结果、
  表质量、表规则、create_rule、list_rules、list_monitors、list_alert_events、list_spaces、workbenchId、monitorId、itemId、dqc-mcp
---

# 欧拉数据质量引擎（OLA DQC）Skills 总览

> 本文档汇总 `sub-skills/OLADQC` 目录下所有欧拉数据质量引擎相关子 Skill，基于 **dqc-mcp** MCP Server 提供能力，**无 CLI 依赖**，所有工具均通过 MCP 协议调用。

> [TIP] **热更新由会话级热加载统一接管**：本 Skill 不自行执行版本检查和自动更新，统一由根目录 `hot_reload.py` 在会话首次加载时完成。本地版本号存于同目录 `version` 纯文本文件（与 HDFS/OLAP/Flink 等其他 Skill 一致）。

**平台入口**：https://ola.woa.com/ola-quality/quality/data-quality/quality-overview

---

## 核心能力

OLA DQC Skills 基于 **dqc-mcp** MCP Server，提供覆盖数据质量全生命周期的 **27 个 MCP 工具**，分为以下六大核心能力：

| # | 能力域 | 核心能力 | 代表工具 |
|---|--------|---------|---------|
| 1 | **空间管理** | 查询当前令牌授权的所有质量空间，获取空间级摘要（规则数、监控数、活跃告警数），为后续操作提供 `workbenchId` 入口 | `list_spaces` |
| 2 | **规则全生命周期管理** | 支持 12 种规则类型（及时性、基线、准确性、一致性、自定义 SQL）的查询、创建、修改、批量操作与开关控制；支持 6 种数据源（THIVE / HIVE / ICEBERG / MYSQL / CLICKHOUSE / STARROCKS）；基线关键链路排查 | `list_rules` `create_rule` `modify_rule` `batch_modify_rules` `enable_rule` `disable_rule` `get_baseline_problem_route` 等 |
| 3 | **监控管理** | 按空间或负责人维度查询监控列表，获取监控详情及其下所有规则摘要（一张表对应一个监控） | `list_monitors` `list_user_monitors` `get_monitor_detail` |
| 4 | **告警事件排查** | 按空间或负责人维度查询告警事件，支持时间范围与告警渠道（企业微信 / 电话 / 群 / Webhook / SRE）筛选，关联规则配置与推送渠道上下文 | `list_alert_events` `list_user_alert_events` |
| 5 | **运行结果分析** | 分层查询规则执行历史——空间级、用户级、监控级、规则级四个维度，快速定位通过/失败趋势 | `list_workbench_rule_results` `list_user_rule_results` `list_monitor_all_rule_results` `list_rule_results` |
| 6 | **表元数据 & 表质量快捷查询** | 通过 **库名+表名** 直接查询表结构（字段、分区、负责人）、分区产出、生产任务、规则配置、规则运行结果、基线配置与基线状态，**无需空间权限** | `get_table_meta` `get_table_rule_configs` `get_table_rule_results` `get_table_baseline_configs` `get_table_baseline_status` 等 |

### 能力亮点

- [KEY] **零空间权限快捷路径**：表质量查询与用户级查询（`list_user_*`）无需空间权限，直接通过库表名或用户名即可操作
- [SHIELD]️ **写操作安全保障**：所有写操作（创建/修改/开关规则）强制预览确认，杜绝误操作
- [LINK] **四层级联贯通**：空间 → 监控 → 规则 → 运行结果，支持从任意层级切入，灵活组合排查链路
- [CHART] **多数据源覆盖**：THIVE / HIVE / ICEBERG / MYSQL / CLICKHOUSE / STARROCKS 六大数据源统一接入
- [ALERT] **告警闭环排查**：告警事件 → 规则详情 → 运行结果 → 基线链路，一站式定位数据质量问题根因

---

## MCP 接入配置（最高优先级，使用本 Skill 前必须完成）

**在执行任何 OLA DQC 查询、规则配置、告警排查操作之前，Agent 必须首先确认已接入 `dqc-mcp` MCP Server。** 支持三种接入方式，按推荐顺序排列：

### 方式一：太湖统一认证【BOX、CodeBuddy 等平台推荐】

```json
{
  "mcpServers": {
    "dqc-mcp": {
      "url": "https://dqc.mcp.it.woa.com"
    }
  }
}
```

### 方式二：手动配置太湖令牌【推荐】

太湖令牌申请：https://tai.it.woa.com/user/pat（**注意保留 `Bearer ` 前缀**）

```json
{
  "mcpServers": {
    "dqc-mcp": {
      "url": "https://dqc.mcp.it.woa.com",
      "timeout": 20000,
      "headers": {
        "Authorization": "Bearer {TAI_IT_TOKEN}"
      },
      "transportType": "streamable-http"
    }
  }
}
```

令牌存储：`~/.oladqc/session.json`

```json
{ "TAI_IT_TOKEN": "你的个人令牌" }
```

### 方式三：质量引擎个人令牌【云端 agent 推荐】

令牌申请：https://ola.woa.com/ola-quality/quality/skill-app/token-manage → 创建个人令牌

```json
{
  "mcpServers": {
    "dqc-mcp": {
      "url": "http://dqc.woa.com/api-mcp/mcp",
      "timeout": 20000,
      "headers": {
        "X-Agent-Token": "你的个人令牌"
      },
      "transportType": "streamable-http"
    }
  }
}
```

令牌存储：`~/.oladqc/session.json`

```json
{ "X-Agent-Token": "你的个人令牌" }
```

### 令牌自动配置

当用户提供 TAI 令牌或质量引擎个人令牌时：
1. 自动识别令牌类型（`Bearer xxx` → TAI_IT_TOKEN；其他 → X-Agent-Token）
2. 静默写入 `~/.oladqc/session.json`
3. 仅告知用户「令牌配置成功」后继续处理原始问题

> [TIP] 若环境变量中已存在 `TAI_IT_TOKEN` 或 `X-Agent-Token`，优先从环境变量读取。

---

## 核心概念：四层级联关系

```
空间(workbenchId) → 监控(monitorId) → 规则(itemId) → 运行结果
```

| 层级 | 入口工具 | 说明 |
|------|---------|------|
| 空间 | `list_spaces` | 当前令牌授权的所有空间 |
| 监控 | `list_monitors(workbenchId)` | 空间下的监控（一张表对应一个监控） |
| 规则 | `list_rules(workbenchId)` / `get_monitor_detail(monitorId)` | 监控下的具体规则 |
| 运行结果 | `list_rule_results(itemId)` | 规则的历史运行结果 |

> [TIP] **快捷路径**：表质量查询（`get_table_rule_configs`、`get_table_rule_results`、`get_table_baseline_configs`、`get_table_baseline_status`）可直接通过 **库名+表名** 查询，**无需空间权限**。

---

## 子 Skill 路由表

本 Skill 共提供 **27 个 MCP 工具**，按业务域分为 **6 个子 Skill**：

| # | 子 Skill | 工具数 | 触发关键词 | 详细文档 |
|---|----------|-------|-----------|---------|
| 1 | [空间查询](#1-空间查询--space-tools) | 1 | 授权空间、workbench、我的空间 | [references/space-tools.md](references/space-tools.md) |
| 2 | [规则管理](#2-规则管理--rule-tools) | 10 | 规则列表、创建规则、修改规则、开启/关闭规则、基线链路 | [references/rule-tools.md](references/rule-tools.md) |
| 3 | [监控管理](#3-监控管理--monitor-tools) | 3 | 监控列表、监控详情、表的监控情况 | [references/monitor-tools.md](references/monitor-tools.md) |
| 4 | [告警事件](#4-告警事件--alert-tools) | 2 | 告警、事件、告警渠道、最近告警 | [references/alert-tools.md](references/alert-tools.md) |
| 5 | [运行结果](#5-运行结果--result-tools) | 4 | 规则运行结果、执行情况、通过/失败 | [references/result-tools.md](references/result-tools.md) |
| 6 | [表元数据 & 表质量](#6-表元数据--表质量--table-tools) | 7 | 表元数据、字段、分区、表质量、基线配置、基线状态 | [references/table-tools.md](references/table-tools.md) |

> 工具总览详见 [references/tools-overview.md](references/tools-overview.md)。

---

## 全局工具调用规则（强制）

> [WARN] 所有子 Skill 共同遵守：

1. **先确认空间**：大多数操作需要 `workbench_id`，先调用 `list_spaces` 获取；若用户只提供表名，优先使用 **表质量快捷路径**（无需 workbench_id）。
2. **写操作必须预览确认**：`create_rule`、`modify_rule`、`create_monitor_with_rules`、`batch_modify_rules`、`enable_rule`、`disable_rule` 等写操作，**必须先展示配置预览或变更对比，用户明确确认后再执行**。
3. **分页注意**：列表查询接口默认 `page_size=20`，如用户需更多结果再调整。
4. **时间格式差异（重要）**：

   | 接口类型 | 格式 | 示例 |
   |---------|------|------|
   | 告警事件（`list_alert_events` / `list_user_alert_events`） | `yyyy-MM-dd HH:mm:ss` | `2026-04-01 08:00:00` |
   | 运行结果（`list_*_rule_results`、`get_table_*`） | `yyyyMMddHHmmss` | `20260401080000` |
   | 基线实例（`get_baseline_problem_route`） | `yyyyMMdd` | `20260401` |

5. **失败重试上限**：同一次用户问答中，**MCP 工具累计失败不超过 3 次**（跨工具累计），达到上限立即停止并输出已收集信息 + 失败摘要。

---

## 1. 空间查询 — space-tools

**触发场景**：用户询问「我有哪些空间」「可以操作哪些链路」，或在其他操作前需获取 `workbenchId`。

### 核心工具

| 工具 | 类型 | 说明 |
|------|------|------|
| `list_spaces` | 读 | 列出当前令牌授权的所有空间及规则数、监控数、活跃告警数 |

### 使用指引

- 单一空间：可直接使用返回的 `workbenchId`
- 多个空间：必须列出让用户选择
- 后续操作（`list_monitors`、`list_rules`、`list_alert_events` 等）依赖返回的 `workbenchId`

### 参考文档

详见 [references/space-tools.md](references/space-tools.md)。

---

## 2. 规则管理 — rule-tools

**触发场景**：用户需要查询、创建、修改、开关规则，或排查基线的关键运行链路。

**触发关键词**：规则列表、我的规则、规则详情、创建规则、修改规则、开启规则、关闭规则、基线链路、基线关键路径。

### 核心工具（10 个）

| 工具 | 类型 | 说明 |
|------|------|------|
| `list_rules` | 读 | 按空间查询规则列表（支持关键词搜索） |
| `list_user_rules` | 读 | 按负责人查询规则（无需空间权限） |
| `get_rule_detail` | 读 | 查询单条规则完整详情（阈值、调度、告警、历史趋势） |
| `get_baseline_problem_route` | 读 | 查询基线关键运行链路（定位延迟原因） |
| `create_rule` | **写** | 创建新规则（支持 12 种 ruleCode 模板） |
| `modify_rule` | **写** | 修改规则配置（部分更新） |
| `create_monitor_with_rules` | **写** | 批量创建多规则 / 追加到已有监控 |
| `batch_modify_rules` | **写** | 批量修改规则 |
| `enable_rule` | **写** | 开启规则 |
| `disable_rule` | **写** | 关闭规则（不删除配置） |

### 支持的规则类型（ruleCode）

| 分类 | ruleCode | 说明 |
|------|----------|------|
| 及时性 | `timeliness` | 数据产出及时性 |
| 基线 | `baseline` | 基线承诺时间 |
| 准确性（表级） | `tbl_rowCnt` | 表总行数 |
| 准确性（字段） | `field_empty` / `field_illegal` / `field_repeat` / `field_rowCnt` / `field_rowCntDistinct` / `field_sum` / `field_avg` | 字段空值/非法值/重复/计数/求和/均值 |
| 一致性 | `consistency_tblRowCnt` / `consistency_rowCnt` / `consistency_rowCntDistinct` / `consistency_sum` / `consistency_avg` | 源表目标表数据比对 |
| 自定义 | `user_custom` | 自定义 SQL 质量校验 |

### 写操作流程（强制）

```
用户请求 → 收集配置 → 展示 JSON 预览 + 变更对比 → 等待用户确认 → 调用 create_rule/modify_rule → 返回结果
```

> [WARN] `modify_rule` 不可修改字段：`ruleCode` / `monitorType` / `dataSource`。如需修改，必须先删除规则再重建。

### 数据源支持

`THIVE` / `HIVE` / `ICEBERG` / `MYSQL` / `CLICKHOUSE` / `STARROCKS`。其中 **MYSQL / CLICKHOUSE / STARROCKS 必须指定 `jobPlatform`**（us / venus）并提供 `hostAddr`、`username`、`password`。

### 参考文档

详见 [references/rule-tools.md](references/rule-tools.md)（含完整 12 类规则 JSON 模板）。

---

## 3. 监控管理 — monitor-tools

**触发场景**：用户询问某空间 / 某表的整体监控情况，需查看监控下的所有规则摘要。

**触发关键词**：监控列表、监控详情、xx 表监控情况、监控下的规则。

### 核心工具（3 个）

| 工具 | 类型 | 说明 |
|------|------|------|
| `list_monitors` | 读 | 按空间查询监控列表（一张表对应一个监控） |
| `list_user_monitors` | 读 | 按负责人查询监控（无需空间权限） |
| `get_monitor_detail` | 读 | 查询监控详情（含该监控下所有规则摘要） |

### 参考文档

详见 [references/monitor-tools.md](references/monitor-tools.md)。

---

## 4. 告警事件 — alert-tools

**触发场景**：用户询问最近的告警事件，或排查某告警的上下文（规则配置、推送渠道、调度任务关联）。

**触发关键词**：告警、事件、最近告警、告警渠道、RTX 告警、电话告警。

### 核心工具（2 个）

| 工具 | 类型 | 说明 |
|------|------|------|
| `list_alert_events` | 读 | 按空间查询告警事件（支持时间、渠道筛选） |
| `list_user_alert_events` | 读 | 按负责人查询告警事件（**无需空间权限**，支持批量用户） |

### 告警渠道（push_types）

`rtx`（企业微信）/ `phone`（电话）/ `rtxg`（企业微信群）/ `webhook` / `sre` 等，**逗号分隔**传入。

### 返回关键字段

`msgId` / `itemId` / `eventType` / `instanceTime` / `msg`（告警详情 JSON 原文）/ `dqcTaskConfig` / `ruleDataSet` / `verifyConfig` / `pushConfig` / `monitorTaskRelation`。

> [TIP] `pushConfig` 和 `monitorTaskRelation` 为 JSON 数组字符串，无关联数据时为 `null`。

### 时间格式

**告警事件专用**：`yyyy-MM-dd HH:mm:ss`（与运行结果的 `yyyyMMddHHmmss` 不同，不要混用）。

### 参考文档

详见 [references/alert-tools.md](references/alert-tools.md)。

---

## 5. 运行结果 — result-tools

**触发场景**：用户想了解规则 / 监控 / 空间的历史执行情况，按不同维度分层查询。

**触发关键词**：运行情况、执行结果、规则结果、历史运行、通过/失败。

### 核心工具（4 个）

| 工具 | 类型 | 对应层级 | 说明 |
|------|------|---------|------|
| `list_workbench_rule_results` | 读 | 空间级 | 空间下所有规则的运行结果 |
| `list_user_rule_results` | 读 | 用户级 | 用户负责的规则结果（**无需空间权限**） |
| `list_monitor_all_rule_results` | 读 | 监控级 | 单个监控下所有规则结果 |
| `list_rule_results` | 读 | 规则级 | 单条规则的历史运行结果 |

### 时间格式

**运行结果专用**：`yyyyMMddHHmmss`（如 `20260414235959`）。

### 参考文档

详见 [references/result-tools.md](references/result-tools.md)。

---

## 6. 表元数据 & 表质量 — table-tools

**触发场景**：用户提供了 **库名+表名**，希望直接查询表结构、分区产出、表的规则配置或基线状态，**无需逐级获取 workbenchId**。

**触发关键词**：表字段、表结构、分区产出、生产任务、表质量、表规则、基线配置、基线状态。

### 核心工具（7 个）

| 工具 | 类型 | 分类 | 说明 |
|------|------|------|------|
| `get_table_meta` | 读 | 元数据 | 表字段、分区、负责人、存储格式 |
| `get_table_output` | 读 | 元数据 | 表分区产出信息（分区值、产出时间） |
| `get_table_task` | 读 | 元数据 | 表的生产任务（任务ID、调度周期） |
| `get_table_rule_configs` | 读 | 质量（快捷） | 表的规则配置（**无需空间权限**） |
| `get_table_rule_results` | 读 | 质量（快捷） | 表的规则运行结果（**无需空间权限**） |
| `get_table_baseline_configs` | 读 | 质量（快捷） | 表的基线配置（**无需空间权限**） |
| `get_table_baseline_status` | 读 | 质量（快捷） | 表的基线运行状态（**无需空间权限**） |

### 数据源类型参数（datasource_type）

表质量查询支持：`HIVE`（默认）/ `THIVE` / `MYSQL` / `STARROCKS` / `CLICKHOUSE` / `ICEBERG`。

### 参考文档

详见 [references/table-tools.md](references/table-tools.md)。

---

## 全局限流规则

> [WARN] **强制规则**：所有 OLA DQC MCP 工具调用必须遵守：

1. **失败计数**：MCP 工具返回错误（网络异常、鉴权失败、业务报错 `code != 0`）计为一次失败。
2. **累计阈值**：同一次用户问答中，**累计失败不超过 3 次**（跨子 Skill 累计）。
3. **终止行为**：达到 3 次立即停止，输出已收集信息和失败摘要：

```
[WARN] MCP 工具调用失败次数已达上限（3 次），终止本次操作。

失败记录：
1. [工具名] — 失败原因
2. [工具名] — 失败原因
3. [工具名] — 失败原因

建议：请检查 dqc-mcp Server 接入配置、令牌是否有效，或前往 https://ola.woa.com/ola-quality/quality/data-quality/quality-overview 排查。
```

---

## Skills 间联动关系

```
┌─────────────────────┐
│    space-tools      │  ← 入口：list_spaces 获取 workbenchId
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐         ┌─────────────────────┐
│   monitor-tools     │ ◄───────│    table-tools      │
│  （监控维度）         │  表级    │ （库表维度，快捷路径）│
└──────────┬──────────┘  映射    └──────────┬──────────┘
           │                                │
           ▼                                ▼
┌─────────────────────┐         ┌─────────────────────┐
│    rule-tools       │ ──────► │   result-tools      │
│  （规则配置/写操作）   │ 执行历史 │  （运行结果查询）     │
└──────────┬──────────┘         └──────────┬──────────┘
           │                                │
           │ 告警触发                        │
           ▼                                ▼
┌──────────────────────────────────────────────────────┐
│                   alert-tools                         │
│ 告警事件 → 关联 itemId 回查 rule-tools / result-tools │
└──────────────────────────────────────────────────────┘
```

### 典型组合场景

| 场景 | 涉及子 Skill | 流程 |
|------|-------------|------|
| 我今天的告警排查 | alert-tools → rule-tools → result-tools | `list_user_alert_events` → `get_rule_detail` → `list_rule_results` |
| 给某表新建质量监控 | table-tools → rule-tools | `get_table_meta` 确认字段 → `create_rule` 创建规则（带预览确认） |
| 某表最近跑的怎么样 | table-tools | `get_table_rule_results` + `get_table_baseline_status` 一次性查清（无需空间权限） |
| 空间巡检 | space-tools → monitor-tools → result-tools | `list_spaces` → `list_monitors` → `list_workbench_rule_results` |
| 基线延迟排查 | alert-tools → rule-tools | `list_user_alert_events`（筛 baseline_event） → `get_baseline_problem_route` 定位关键链路 |
| 批量开关规则 | rule-tools | `list_rules` 筛出目标 → 展示清单预览 → 用户确认 → `enable_rule` / `disable_rule` 循环调用 |

---

## 联系信息

**在所有 OLA DQC 诊断分析与规则配置建议的末尾，必须输出：如有问题请联系 hericsong。**

## 资源文件

| 文件 | 说明 |
|------|------|
| `SKILL.md` | 当前总览文档 |
| `version` | 当前版本号（纯文本，单行，与 HDFS/OLAP/Flink 等其他 Skill 一致） |
| `references/tools-overview.md` | 工具总览（按模块） |
| `references/space-tools.md` | 空间查询子 Skill 详细文档 |
| `references/rule-tools.md` | 规则管理子 Skill 详细文档（含 12 类规则模板） |
| `references/monitor-tools.md` | 监控管理子 Skill 详细文档 |
| `references/alert-tools.md` | 告警事件子 Skill 详细文档 |
| `references/result-tools.md` | 运行结果子 Skill 详细文档 |
| `references/table-tools.md` | 表元数据 & 表质量子 Skill 详细文档 |
