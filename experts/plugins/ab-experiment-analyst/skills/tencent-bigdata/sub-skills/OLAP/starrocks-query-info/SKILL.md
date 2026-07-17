---
name: starrocks-query-info
description: >
  获取 StarRocks 集群的查询相关信息，包括审计记录、根据 query_id 获取完整 SQL、高危操作、运行中查询、执行计划和 Profile。
  触发关键词："审计日志", "审计记录", "慢查询", "query_id", "执行计划", "EXPLAIN", "Profile", "高危操作", "DROP TABLE", "TRUNCATE", "运行中查询", "audit"
---

## 概述

通过 do_mcp API 服务获取 StarRocks 集群查询相关的各维度信息，覆盖查询生命周期的全链路：审计记录（历史已完成的查询）→ 根据 query_id 获取具体 SQL → 实时运行中查询 → 执行计划分析 → 执行 Profile 分析。

**核心能力**：
1. **审计记录** — 查看指定时间范围内的查询/操作审计日志
2. **审计 SQL 查询** — 根据 query_id 和时间范围从审计集群表获取完整 SQL（stmt 字段）
3. **高危操作** — 筛查 DROP/TRUNCATE/DELETE 等危险操作记录
4. **运行中查询** — 查看当前正在执行或在队列中等待的查询
5. **查询计划** — 获取 SQL 的 EXPLAIN 执行计划，用于性能分析
6. **执行 Profile** — 获取已完成查询的详细 Profile，用于瓶颈定位

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

根据用户需求选择对应的子命令执行。多数场景下只需执行其中 1-2 个步骤即可，无需全部执行。

### Step 1: 获取审计记录

当用户需要查看集群的查询历史记录时使用。**注意：默认不查询具体 SQL（stmt 字段），以避免 token 膨胀。** 先通过 query_id 等概要信息定位目标查询，需要分析具体 SQL 时再使用 `--with-stmt` 参数或根据 query_id 单独查询。

```bash
# 默认最近 1 小时全部审计记录（不含 SQL，仅 query_id 等概要）
do-bigdata olap audit --cluster <集群名称> --query "<用户原始问题>"

# 包含具体 SQL 语句（审计表字段名为 stmt）
do-bigdata olap audit --cluster <集群名称> --with-stmt --query "<用户原始问题>"

# 仅查看 query 类记录
do-bigdata olap audit --cluster <集群名称> --audit-type query --query "<用户原始问题>"

# 仅查看 operation 类记录
do-bigdata olap audit --cluster <集群名称> --audit-type operation --query "<用户原始问题>"

# 最近 24 小时
do-bigdata olap audit --cluster <集群名称> --hours 24 --query "<用户原始问题>"

# 指定时间范围
do-bigdata olap audit --cluster <集群名称> \
    --start "2026-03-07 10:00:00" --end "2026-03-07 11:00:00" --query "<用户原始问题>"
```

**推荐工作流**：
1. 先不带 `--with-stmt` 查询，获取 query_id 和概要信息（耗时、状态、扫描行数等）
2. 根据 query_id 筛选出需要分析的目标查询
3. 如需查看具体 SQL，再带 `--with-stmt` 查询或使用 `audit-sql` 命令根据 query_id 单独查询

分析要点：
- 关注 `query_time` 较大的慢查询
- 关注 `scan_rows` / `return_rows` 比值判断过滤效率
- 关注 `state` 为 ERR 的异常查询

### Step 1.5: 根据 query_id 获取审计表中的完整 SQL

当用户提供了 query_id，需要获取对应的完整 SQL 语句（审计表中的 stmt 字段）时使用。支持两种查询方式：

```bash
# 方式一：仅提供 query_id，自动查找最近 7 天（默认）
do-bigdata olap audit-sql --cluster <集群名称> --query-id <query_id> --query "<用户原始问题>"

# 指定查找范围为最近 30 天
do-bigdata olap audit-sql --cluster <集群名称> --query-id <query_id> --days 30 --query "<用户原始问题>"

# 方式二：指定精确时间范围（查询更快）
do-bigdata olap audit-sql --cluster <集群名称> --query-id <query_id> \
    --start "2026-03-07 10:00:00" --end "2026-03-07 11:00:00" --query "<用户原始问题>"
```

**查询逻辑说明**：
- 未指定 `--start`/`--end` 时，使用简化版 API（`/api/starrocks/audit/sql_by_query_id`），自动查找最近 `--days` 天（默认 7 天，最大 30 天）
- 指定 `--start`/`--end` 时，使用精确查询 API（`/api/starrocks/audit/sql`），查询速度更快

**返回结果包含**：完整 SQL 语句（stmt 字段）、查询时间、用户、数据库、耗时、扫描行数、状态等全部审计信息。

### Step 2: 获取高危操作记录

当用户需要排查是否有危险操作（DROP TABLE/DATABASE、TRUNCATE、DELETE 等）时使用：

```bash
# 默认最近 1 小时
do-bigdata olap danger-ops --cluster <集群名称> --query "<用户原始问题>"

# 最近 24 小时
do-bigdata olap danger-ops --cluster <集群名称> --hours 24 --query "<用户原始问题>"

# 指定时间范围
do-bigdata olap danger-ops --cluster <集群名称> \
    --start "2026-03-07 08:00:00" --end "2026-03-07 18:00:00" --query "<用户原始问题>"
```

分析要点（详见参考文档 "高危操作识别"章节）：
- 确认操作人是否为授权人员
- 确认影响范围（库、表）
- 确认时间是否在维护窗口内

### Step 3: 获取正在运行的查询

当用户需要了解集群当前负载或排查阻塞问题时使用：

```bash
do-bigdata olap running --cluster <集群名称> --query "<用户原始问题>"
```

分析要点：
- 关注长时间运行的查询（`query_time` 很大）
- 关注排队中（State=Pending/Queued）的查询数量
- 如发现异常查询，可记录 `query_id` 用于后续 Profile 分析

### Step 4: 获取查询执行计划

当用户需要分析某条 SQL 性能或优化方向时使用：

```bash
do-bigdata olap explain --cluster <集群名称> \
    --sql "SELECT count(*) FROM db.table WHERE dt='2026-03-07'" --query "<用户原始问题>"
```

分析要点（详见参考文档 "查询执行计划分析"章节）：
- **分区裁剪**：`OlapScanNode` 的 `partitions=X/Y`，X 尽量小
- **物化视图命中**：`rollup` 是否使用了预期的物化视图
- **Join 顺序**：小表在 Build 端，大表在 Probe 端
- **谓词下推**：过滤条件是否下推到 Scan 节点

### Step 5: 获取历史执行 Profile

当用户需要深入分析某个已完成查询的性能瓶颈时使用。只需提供 `query_id`（**无需指定集群**），可从审计记录（Step 1）或运行中查询（Step 3）获取 query_id：

```bash
do-bigdata olap profile --query-id "d73a12d0-dbaf-11ec-a0e3-02420a000448" --query "<用户原始问题>"
```

分析要点（详见参考文档 "Query Profile 解读"章节）：
- **总耗时分布**：`ScanTime` / `JoinTime` / `AggTime` / `SortTime` 各占比
- **数据倾斜**：对比不同 BE 节点的 `MaxTime` vs `MinTime`
- **内存使用**：`QueryMemCost` 是否接近 `exec_mem_limit`
- **网络开销**：`ShuffleBytes` 是否过大

## 典型分析场景

### 场景 A：慢查询排查

1. 先用 `do-bigdata olap audit` 获取审计记录，找到 `query_time` 较大的查询
2. 用 `do-bigdata olap audit-sql` 根据 query_id 获取完整 SQL
3. 用 `do-bigdata olap explain` 分析 SQL 执行计划，找优化方向
4. 若有 `query_id`，用 `do-bigdata olap profile` 查看详细 Profile 定位瓶颈

### 场景 B：集群当前负载异常

1. 用 `do-bigdata olap running` 查看当前运行中/排队中的查询
2. 若有长时间运行的查询，记录其 `query_id` 和 SQL
3. 联动 `starrocks-load-analysis` skill 查看集群 CPU/内存指标

### 场景 C：高危操作审计

1. 用 `do-bigdata olap danger-ops` 查看指定时间段的高危操作
2. 确认操作人、影响范围和时间
3. 若需进一步了解上下文，用 `do-bigdata olap audit` 查看同时段所有操作

## 参数说明

| 参数 | 说明 | 适用子命令 | 示例 |
|------|------|-----------|------|
| `--cluster` / `-c` | 集群名称（除 profile 外均必需；profile 子命令**不接受** --cluster） | audit / audit-sql / danger-ops / running / explain | `starrocks-prod` |
| `--hours` / `-t` | 时间跨度（小时），默认 1 | audit, danger-ops | `24` |
| `--start` / `-s` | 开始时间（优先于 hours） | audit, danger-ops, audit-sql | `2026-03-07 10:00:00` |
| `--end` / `-e` | 结束时间 | audit, danger-ops, audit-sql | `2026-03-07 11:00:00` |
| `--audit-type` / `-a` | 审计类型: query/operation/all | audit | `query` |
| `--with-stmt` | 在结果中包含 SQL 语句（stmt 字段），默认不包含以减少 token 消耗 | audit | - |
| `--sql` | 要分析执行计划的 SQL | explain | `SELECT ...` |
| `--query-id` / `-i` | 查询 ID（profile 子命令仅需此参数，无需 --cluster） | profile, audit-sql | `d73a12d0-...` |
| `--days` / `-d` | 往前查找天数（默认 7，最大 30） | audit-sql | `30` |

## 参考文档

```bash
do-bigdata docs list --skill starrocks-query-info
do-bigdata docs show --skill starrocks-query-info --file query_analysis_guide.md
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
