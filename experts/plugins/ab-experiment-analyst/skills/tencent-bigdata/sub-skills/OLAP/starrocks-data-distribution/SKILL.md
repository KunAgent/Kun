---
name: starrocks-data-distribution
description: >
  诊断 StarRocks 集群的数据分布健康状况。自动检测分桶数过多、分桶数过少、数据倾斜等问题，并结合表的建表 Schema 给出优化建议。
  支持集群级别的健康概览和单表级别的深入诊断。
  触发关键词："数据分布", "分桶", "Tablet", "数据倾斜", "分区分桶", "BUCKETS", "副本数", "数据健康", "集群巡检", "diagnose-table"
---

## 概述

通过 do_mcp API 获取运营信息数据库中的库表统计信息（`starrocks_cluster_table_info`），自动诊断数据分布健康状况，发现分桶数过多、分桶数过少、数据倾斜等问题，并给出优化建议。

**核心能力**：
1. **集群健康概览** — 扫描集群所有表，统计健康/警告/严重问题表数量，重点列出需要修复的表
2. **单表深入诊断** — 分析指定表的 Tablet 大小分布，结合表的 Schema 给出具体优化方案
3. **原始数据查询** — 获取库表统计原始数据，支持按库名、表名筛选

## [WARN] 数据单位说明（重要）

> **底层 API（`/api/starrocks/table_stats`）返回的 size 字段原生单位为 MB**
> （与 StarRocks `information_schema.tablets.DATA_SIZE` 对齐），
> **CLI 已在入口处统一换算为 GB**，最终 JSON / 文本输出中的 size 字段单位均为 **GB**。
>
> **AI 在解读 CLI 输出时必须遵守**：
>
> - CLI 返回的以下字段单位为 **GB（吉字节）**，**禁止再自行换算或臆测单位**：
>   - `data_size` / 表数据量 → **GB**
>   - `tablet_size_max` / 最大 tablet 大小 → **GB**
>   - `tablet_size_min` / 最小 tablet 大小 → **GB**
>   - `tablet_size_avg` / 平均 tablet 大小 → **GB**
>   - `table_standard_deviation` / 标准差 → **GB**
> - `replica_counts` / 副本总数：纯数量，无单位。
> - 向用户展示时，直接在数值后标注 `GB`，例如 `平均 tablet 大小：0.5 GB`、`最大 tablet：15 GB`。
> - 当数据量较大时（如 > 1024 GB），可换算为 TB 方便阅读（÷1024），但必须注明原始单位是 GB。
> - [WARN] **直接调用底层 API（非 CLI）拿到的是 MB**，不要把 MB 值当 GB 解读；生产流程必须通过 `do-bigdata olap ...` CLI 使用。

**诊断规则**（以下所有 tablet 和数据量阈值单位均为 **GB**，CLI 已完成换算）：

| 问题类型 | 判定条件 | 说明 |
|---------|---------|------|
| 分桶数过多 | 副本总数 > 10000 且数据量 < 1024 GB（即 <1 TB）且平均 tablet < 1 GB | 大量小分桶导致元数据膨胀，通常是空分区过多或分桶数设置过高 |
| 分桶数过少 | 最大 tablet > 10 GB 且最大 tablet 与平均 tablet 大小相近（比值 ≤ 3） | 单个 tablet 过大影响并行度，需增加分桶数 |
| 数据倾斜 | 最大 tablet > 10 GB 且最大 tablet 与平均 tablet 大小差距大（比值 > 3） | 分桶键基数不够高导致数据分布不均匀 |

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### 场景 A：集群数据分布健康概览

用户询问某个集群有多少表存在数据分布问题时使用。

#### Step 1: 获取集群健康概览

```bash
do-bigdata olap cluster-overview --cluster <集群名称> --query "<用户原始问题>"
```

该命令会：
1. 获取集群全部库表统计信息（不限制返回条数）
2. 对每张表执行健康诊断规则
3. 统计健康/警告/严重问题表数量
4. 按问题类型分布统计
5. 重点列出严重问题表和警告表

#### Step 2: 分析输出结果

从输出中关注以下要点：
- **严重问题表**（critical）：需要尽快修复，尤其是数据量大的表
- **问题类型分布**：判断集群的主要问题是分桶过多、分桶过少还是数据倾斜
- 对严重问题表，建议用户使用「场景 C：单表深入诊断」进一步分析

### 场景 B：如何判断一张表是否不健康

向用户解释诊断规则时，参考以下判定标准：

> **单位提示**：以下所有 tablet 大小和数据量的阈值单位均为 **GB**（Skill 返回数据原生单位）。

**（1）分桶数过多**：
- 整表副本总数超过 10000，但数据量很小（不到 1000 GB，即 1 TB）
- 平均 tablet 大小不到 1 GB，存在大量小分桶
- 会导致集群元数据膨胀
- 通常由大量空分区或单分区分桶数设置过高导致

**（2）分桶数过少**：
- 最大 tablet 大小超过 10 GB，且最大 tablet 与平均 tablet 大小相近
- 说明整体分桶数不足
- 通常是分桶数设置太小导致

**（3）数据倾斜**：
- 最大 tablet 大小超过 10 GB，且最大 tablet 与平均 tablet 大小差距很大
- 说明数据分布不均匀
- 通常是分桶键基数不够高导致

### 场景 C：单表数据分布深入诊断

用户需要分析某张具体表的数据分布健康状况时使用。

#### Step 1: 获取表统计信息并诊断

```bash
do-bigdata olap diagnose-table --cluster <集群名称> --database <库名> --table <表名> --query "<用户原始问题>"
```

#### Step 2: 获取表的建表 Schema（联动 starrocks-schema-change skill）

```bash
do-bigdata olap table-schema --cluster <集群名称> --database <库名> --table <表名> --query "<用户原始问题>"
```

获取表的完整 DDL 后，按以下要点深度分析：

**2.1 分区策略分析**：
- **识别分区类型**：
  - `PARTITION BY RANGE(col)` → Range 分区（检查是否有 `dynamic_partition` 配置）
  - `PARTITION BY date_trunc(...)` / `time_slice(...)` → 表达式分区（推荐方式）
  - `PARTITION BY (col)` 或 `PARTITION BY col` → 列表达式分区
  - `PARTITION BY LIST(col)` → List 分区
  - 无 PARTITION BY → 无分区（数据量大时建议添加）
- **分区粒度评估**：
  - 单月数据量 < 10GB → 建议按月分区
  - 单月数据量 > 10GB 且查询精确到天 → 建议按天分区
  - 数据需要按天过期 → 建议按天分区
- **动态分区配置检查**（如果有 `dynamic_partition`）：
  - `dynamic_partition.buckets` 是否与初始分区的 BUCKETS 一致（[WARN] 常见陷阱）
  - `dynamic_partition.history_partition_num` 是否为 0（[WARN] 默认不创建历史分区，导致历史数据无法导入）
  - `dynamic_partition.start` 数据保留期是否合理
  - `dynamic_partition.end` 预创建分区数是否足够
- **分区 TTL 管理**：
  - 表达式分区是否配置了 `partition_live_number` 或 `partition_retention_condition`
  - 数据持续增长但无 TTL → 提醒用户注意分区数量膨胀
- **分区迁移建议**：
  - Range 分区 → 建议迁移到表达式分区（v3.1+，更灵活，导入时自动创建）
  - List 分区且每分区只有一个值 → 建议迁移到表达式分区

**2.2 分桶策略分析**：
- **分桶方式**：使用的是哈希分桶还是随机分桶？
- **分桶键选择**：是否为高基数列？是否为常用查询条件列？
- **分桶数**：BUCKETS 设置是否与数据量匹配？（推荐每 tablet 1~10GB）
- **随机分桶限制**：随机分桶仅支持明细表（DUPLICATE KEY）

**2.3 表模型**：DUPLICATE/AGGREGATE/UNIQUE/PRIMARY KEY
**2.4 排序键**：排序键选择是否有利于查询

#### Step 3: 结合统计信息和 Schema 给出优化建议

根据诊断结果和 Schema 分析，给出具体的优化建议：

需要读取参考文档进行分析和建议：
```bash
do-bigdata docs show --skill starrocks-data-distribution --file data_distribution_guide.md
```

**分桶数过多时**：
```sql
-- 清理空分区（如果使用动态分区）
ALTER TABLE db.table SET ("dynamic_partition.start" = "-N");

-- 减少分桶数
ALTER TABLE db.table DISTRIBUTED BY HASH(col) BUCKETS N;

-- 或改为自动分桶（推荐，2.5.7+）
ALTER TABLE db.table DISTRIBUTED BY HASH(col);
```

**分桶数过少时**：
```sql
-- 增加分桶数（建议每 10 GB 数据 1 个 tablet）
ALTER TABLE db.table DISTRIBUTED BY HASH(col) BUCKETS N;
```

**数据倾斜时**：
```sql
-- 修改分桶键为更高基数的列组合（3.2+）
ALTER TABLE db.table DISTRIBUTED BY HASH(col1, col2) BUCKETS N;

-- 明细表可改为随机分桶（3.1+）
ALTER TABLE db.table DISTRIBUTED BY RANDOM;
```

> **注意**：ALTER TABLE 修改分桶键或分桶数是异步操作（3.2+ 支持），会在后台重刷数据。操作前建议确认集群负载状况。

### 辅助功能：获取原始统计数据

如需直接获取原始库表统计数据（不进行诊断）：

```bash
# 获取整个集群的库表统计
do-bigdata olap table-stats --cluster <集群名称> --query "<用户原始问题>"

# 按库名筛选
do-bigdata olap table-stats --cluster <集群名称> --database <库名> --query "<用户原始问题>"

# 查询特定表
do-bigdata olap table-stats --cluster <集群名称> --database <库名> --table <表名> --query "<用户原始问题>"

# 限制返回条数
do-bigdata olap table-stats --cluster <集群名称> --limit 50 --query "<用户原始问题>"
```

## 参数说明

| 参数 | 说明 | 适用子命令 | 示例 |
|------|------|-----------|------|
| `--cluster` / `-c` | 集群名称（必需） | 所有 | `starrocks-prod` |
| `--database` / `-d` | 数据库名称 | diagnose-table（必需）, table-stats（可选） | `my_database` |
| `--table` / `-t` | 表名称 | diagnose-table（必需）, table-stats（可选） | `my_table` |
| `--limit` / `-l` | 返回条数上限 | table-stats（可选） | `100` |

## 联动说明

| 联动 Skill | 场景 |
|-----------|------|
| **starrocks-schema-change** | 单表诊断时，调用 `do-bigdata olap table-schema` 获取表的建表 Schema（分区分桶策略详情），结合统计数据给出更精确的优化建议 |
| **starrocks-cluster-ops** | 获取集群版本信息，确认是否支持某些优化操作（如 3.1+ 随机分桶、3.2+ 修改分桶键） |
| **starrocks-load-analysis** | 执行 ALTER TABLE 调整分桶前，查看集群当前负载，避免高负载时执行影响业务 |

## 参考文档

```bash
do-bigdata docs list --skill starrocks-data-distribution
do-bigdata docs show --skill starrocks-data-distribution --file data_distribution_guide.md
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
