---
name: starrocks-mv-troubleshooting
description: >
  排查 StarRocks 集群异步物化视图问题。诊断物化视图刷新失败、超时、不可用、资源占用过多、无法改写查询等问题。
  物化视图改写查询失败（查询未被 MV 重写）属于本 Skill 范畴，而非 starrocks-query-failure。
  触发关键词："物化视图", "MV", "materialized view", "刷新失败", "is_active", "REFRESH", "改写查询", "查询重写", "TRACE REASON MV", "刷新超时"
---

## 概述

通过 do_mcp API 服务查询 StarRocks 集群的异步物化视图相关信息，包括查看所有物化视图列表、物化视图创建语句（DDL）、物化视图工作状态和刷新历史。根据物化视图的状态和刷新记录进行故障诊断，给出解决方案和优化建议。

**核心能力**：
1. **物化视图列表查询** — 获取集群所有物化视图信息，支持按数据库筛选
2. **物化视图 DDL 查询** — 获取指定异步物化视图的创建语句（SHOW CREATE MATERIALIZED VIEW）
3. **物化视图状态查看** — 获取物化视图工作状态（is_active、刷新状态、错误信息等）
4. **物化视图刷新历史** — 查看刷新任务的执行记录（成功/失败/耗时/错误信息等）
5. **问题诊断** — 对物化视图的各类异常给出根因分析和解决建议

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 0: 确认参数

首先跟用户确认以下信息：
- **集群名称**（必需）：StarRocks 集群名称
- **物化视图名称**（按需）：具体排查某个物化视图时需要
- **数据库名称**（可选）：用于筛选特定数据库下的物化视图

如果用户未提供集群名称，**必须先向用户询问**，不要猜测。

### Step 1: 获取物化视图列表

当需要了解集群物化视图全貌、或不确定物化视图名称时，先获取列表：

```bash
# 获取集群所有物化视图
do-bigdata olap mv-list --cluster <集群名称> --query "<用户原始问题>"

# 按数据库筛选
do-bigdata olap mv-list --cluster <集群名称> --database <库名> --query "<用户原始问题>"
```

从返回的 JSON 数据中提取 `materialized_views` 列表，找到用户关心的物化视图。

### Step 2: 查看物化视图工作状态

获取物化视图的详细状态信息，这是排查问题的核心步骤：

```bash
do-bigdata olap mv-status --cluster <集群名称> --mv-name <物化视图名称> --query "<用户原始问题>"
```

**关键字段分析**：

| 字段 | 说明 | 关注点 |
|------|------|--------|
| `is_active` | 是否为 Active 状态 | 只有 Active 才能用于查询改写和自动刷新 |
| `last_refresh_state` | 最近一次刷新状态 | PENDING / RUNNING / FAILED / SUCCESS |
| `last_refresh_error_message` | 刷新失败原因 | 失败时重点关注 |
| `task_name` | 刷新任务名称 | 用于 Step 4 查询刷新历史 |
| `last_refresh_duration` | 刷新耗时（秒） | 判断是否存在性能问题 |
| `rows` | 数据行数 | 可能有延迟，仅供参考 |

### Step 3: 查看物化视图创建语句（按需）

当需要确认物化视图定义是否正确、分析查询改写问题时使用：

```bash
# 查看指定物化视图的创建语句
do-bigdata olap mv-ddl --cluster <集群名称> --mv-name <物化视图名称> --query "<用户原始问题>"

# 指定数据库
do-bigdata olap mv-ddl --cluster <集群名称> --mv-name <物化视图名称> --database <库名> --query "<用户原始问题>"
```

分析要点（详见参考文档）：
- **刷新策略**：REFRESH ASYNC / MANUAL / ASYNC EVERY
- **分区策略**：PARTITION BY 是否合理
- **分布策略**：DISTRIBUTED BY HASH 的分桶键选择
- **属性配置**：enable_spill、insert_timeout、resource_group 等

### Step 4: 查看物化视图刷新历史

当物化视图刷新出现问题时，查看历史刷新记录进行诊断：

```bash
# task_name 从 Step 2 的 mv-status 结果中获取
do-bigdata olap mv-refresh-history --cluster <集群名称> --task-name <任务名称> --query "<用户原始问题>"
```

> **[WARN] 重要**：`--task-name` 参数的值必须从 Step 2（mv-status 命令）返回结果中的 `task_name` 字段获取，不要猜测。

**关键字段分析**：

| 字段 | 说明 |
|------|------|
| `CREATE_TIME` / `FINISH_TIME` | 刷新开始和结束时间 |
| `STATE` | 任务状态：PENDING / RUNNING / FAILED / SUCCESS |
| `ERROR_CODE` / `ERROR_MESSAGE` | 失败原因（STATE 为 FAILED 时关注） |
| `PROGRESS` | 刷新进度百分比 |
| `QUERY_ID` | 刷新任务的 Query ID（可用于获取 Query Profile 分析性能瓶颈） |
| `EXTRA_MESSAGE` | 额外信息（包含分区刷新详情、是否强制刷新等） |

### Step 5: 问题诊断与建议

根据以上信息，对照参考文档中的问题分类进行诊断：

#### 情况 A：创建物化视图失败

- 检查是否误用了同步物化视图的 SQL 语法（缺少 `REFRESH ASYNC`、`DISTRIBUTED BY HASH`）
- 检查 `PARTITION BY` 列是否符合要求（单列 Range 分区，可用 `date_trunc()` 调整粒度）
- 检查用户权限是否充足（需要查询对象的 SELECT 权限）

#### 情况 B：物化视图刷新失败（last_refresh_state = FAILED）

分析 `last_refresh_error_message` 或刷新历史中的 `ERROR_MESSAGE`：

| 错误特征 | 可能原因 | 建议 |
|---------|---------|------|
| `Memory limit exceeded` | 内存不足 | 为物化视图指定分区策略；启用中间结果落盘 `session.enable_spill=true` |
| `timeout` / `exceeded` | 刷新超时 | 增大超时 `session.insert_timeout`；设置分区策略实现增量刷新 |
| 其他错误 | 需具体分析 | 查看 `QUERY_ID` 对应的 Query Profile |

如果错误指向**集群负载过高**，应联动 `starrocks-load-analysis` skill 查看 CPU / 内存指标。

#### 情况 C：物化视图不可用（is_active = false）

- 常见原因：基表发生了 Schema Change
- 解决方案：`ALTER MATERIALIZED VIEW mv_name ACTIVE;`
- 如果设置无效，需要删除并重新创建

联动 `starrocks-schema-change` skill 检查基表是否有近期的 Schema Change 操作。

#### 情况 D：物化视图刷新任务占用过多资源

- 检查物化视图是否 Join 了多张大表
- 检查刷新间隔是否过于频繁
- 检查物化视图是否已分区
- 紧急处理：`ALTER MATERIALIZED VIEW mv1 INACTIVE;` 或 `CANCEL REFRESH MATERIALIZED VIEW mv1;`

#### 情况 E：物化视图无法改写查询

- 使用 `TRACE REASON MV <query>` 诊断改写失败原因（要先确认这个集群的版本是不是 v3.2.8 或者以上）
- 检查物化视图 SELECT 是否缺少查询中 WHERE / ORDER BY 引用的列
- 检查查询是否属于 SPJG 类型（不支持窗口函数、嵌套聚合等）
- 检查数据一致性配置（`query_rewrite_consistency`、`mv_rewrite_staleness_second`）

## 典型分析场景

### 场景 A：物化视图刷新失败排查

1. 用 `do-bigdata olap mv-status` 查看物化视图状态，确认 `last_refresh_state` 和 `last_refresh_error_message`
2. 用 `do-bigdata olap mv-refresh-history` 查看最近的刷新记录，分析失败模式（偶发/持续失败）
3. 根据错误信息对照解决方案表给出建议
4. 如果需要分析性能瓶颈，提取 `QUERY_ID` 联动 `starrocks-query-info` skill 获取 Profile

### 场景 B：物化视图不可用排查

1. 用 `do-bigdata olap mv-status` 查看 `is_active` 和 `inactive_reason`
2. 尝试 `ALTER MATERIALIZED VIEW mv ACTIVE;` 恢复
3. 如果恢复失败，用 `do-bigdata olap mv-ddl` 查看创建语句，联动 `starrocks-schema-change` 检查基表变更

### 场景 C：全面物化视图巡检

1. 用 `do-bigdata olap mv-list` 列出集群所有物化视图
2. 逐一用 `do-bigdata olap mv-status` 检查每个物化视图的状态
3. 重点关注 `is_active = false` 和 `last_refresh_state = FAILED` 的物化视图
4. 对异常物化视图执行详细排查

### 场景 D：物化视图性能优化

1. 用 `do-bigdata olap mv-refresh-history` 查看刷新历史，关注耗时变化趋势
2. 用 `do-bigdata olap mv-ddl` 查看物化视图定义，检查是否有分区策略
3. 通过 `QUERY_ID` 联动 `starrocks-query-info` 获取 Profile 分析瓶颈
4. 联动 `starrocks-load-analysis` 查看刷新时段的集群负载

## 参数说明

| 参数 | 说明 | 适用子命令 | 示例 |
|------|------|-----------|------|
| `--cluster` / `-c` | 集群名称（必需） | 所有 | `starrocks-prod` |
| `--mv-name` / `-m` | 物化视图名称 | mv-ddl, mv-status | `mv_example` |
| `--database` / `-d` | 数据库名称 | mv-list, mv-ddl（可选） | `my_database` |
| `--task-name` / `-t` | 刷新任务名称 | mv-refresh-history | `mv-112517` |

## 联动说明

| 场景 | 联动 Skill | 说明 |
|------|-----------|------|
| 刷新超时/内存不足 | `starrocks-load-analysis` | 查看刷新时段的 CPU / 内存 / 磁盘指标 |
| 分析刷新任务性能瓶颈 | `starrocks-query-info` | 通过 `query_id` 获取 Query Profile |
| 基表 Schema Change 导致不可用 | `starrocks-schema-change` | 查看基表的变更记录 |
| 确认集群节点状态 | `starrocks-cluster-ops` | 查看 FE / BE 节点状态和配置 |

## 参考文档

```bash
do-bigdata docs list --skill starrocks-mv-troubleshooting
do-bigdata docs show --skill starrocks-mv-troubleshooting --file mv_troubleshooting_guide.md
```

<!-- BIGDATA_QUERY_GUARD -->

## [WARN] --query 参数（强制要求）

每次调用 `do-bigdata` 命令时，**必须**带上 `--query "<用户原始问题>"` 参数，将用户的原始自然语言问题传递给 CLI。

**正确示例**：
```bash
do-bigdata olap metric-data --cluster starrocks-prod --metric cpu_util --query "帮我看看 starrocks-prod 最近一小时的 CPU 使用率"
```

**错误示例**（缺少 --query）：
```bash
do-bigdata olap metric-data --cluster starrocks-prod --metric cpu_util
```

> `--query` 参数用于使用回传记录用户的真实问题，缺少此参数会导致回传数据中 `user_query` 字段记录为 CLI 命令而非用户原始问题。

**严禁省略 `--query` 参数。**

<!-- /BIGDATA_QUERY_GUARD -->

<!-- BIGDATA_CLI_GUARD -->

## [WARN] CLI 可用性检查（强制前置）

在执行任何 `do-bigdata` 命令之前，**必须**先检查 CLI 是否已安装：

```bash
which do-bigdata
```

### 如果 CLI 不可用，按以下步骤修复：

**第一步**：执行本地热加载脚本安装 CLI：

```bash
python3 tencent-bigdata/hot_reload.py
```

执行后再次检查 `which do-bigdata`。如果 CLI 已可用，跳到「安装后检查」。

**第二步（仅当第一步后 CLI 仍不可用时）**：本地 `hot_reload.py` 可能是远古版本，不包含 CLI 安装逻辑。需要从远程下载最新版本并重新执行：

```bash
# 从 Skills Manager 下载最新的 hot_reload.py，覆盖本地远古版本
curl -fsSL "http://bigdata-do-skills-manager.woa.com/api/root-skill/hot_reload.py/download" -o tencent-bigdata/hot_reload.py

# 同时更新根 SKILL.md
curl -fsSL "http://bigdata-do-skills-manager.woa.com/api/root-skill/SKILL.md/download" -o tencent-bigdata/SKILL.md

# 执行最新的热加载脚本（会自动安装 CLI + 更新所有 Skills）
python3 tencent-bigdata/hot_reload.py
```

### 安装后检查

检查 hot_reload 输出：
- 如果输出包含 `[WARN] 注意: do-bigdata 不在默认 PATH 中`，需要根据输出的 `bin_dir` 执行 `export PATH` 后再调用 `do-bigdata`
- 如果输出 `CLI 可用: <路径>`，则可直接使用 `do-bigdata` 命令

**如果 CLI 不可用，必须先按照上述步骤完成安装，严禁跳过安装步骤直接放弃调用。** 如果安装出现问题，请联系 shimerhe 处理。

<!-- /BIGDATA_CLI_GUARD -->
