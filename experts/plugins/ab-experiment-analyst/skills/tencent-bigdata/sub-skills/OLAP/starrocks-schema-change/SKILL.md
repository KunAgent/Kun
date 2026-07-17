---
name: starrocks-schema-change
description: >
  分析 StarRocks 集群的表变更（Schema Change / ALTER TABLE）操作。查询 Schema Change 记录和表的建表 Schema，分析变更状态、定位失败原因并给出解决建议。
  触发关键词："ALTER TABLE", "Schema Change", "加列", "删列", "改列", "表变更", "DDL", "建表语句", "SHOW CREATE TABLE", "表结构", "变更进度", "变更失败"
---

## 概述

通过 do_mcp API 服务查询 StarRocks 集群的表变更（Schema Change）相关信息，包括查看某个库下的所有 Schema Change 记录和指定表的建表 Schema（DDL）。根据记录状态和错误信息进行分析，给出操作进度说明或失败原因解决建议。

**核心能力**：
1. **Schema Change 记录查询** — 获取库下所有 Schema Change（ALTER TABLE COLUMN）的 Job 记录
2. **表 DDL 查询** — 获取指定表的完整建表语句（SHOW CREATE TABLE），用于确认当前表结构
3. **状态分析** — 根据 Schema Change 的 State 字段判断操作进度或失败原因
4. **问题诊断** — 对失败的 Schema Change 给出根因分析和解决建议

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 0: 确认参数

首先跟用户确认以下信息：
- **集群名称**（必需）：StarRocks 集群名称
- **数据库名称**（必需）：要查看 Schema Change 的数据库名
- **表名称**（可选）：如果用户需要查看特定表的变更

如果用户未提供集群名称或数据库名称，**必须先向用户询问**，不要猜测。

### Step 1: 查询 Schema Change 记录

获取目标库下的所有 Schema Change 记录：

```bash
# 获取库下所有 Schema Change 记录
do-bigdata olap schema-change --cluster <集群名称> --database <库名> --query "<用户原始问题>"

# 按表名过滤（模糊匹配）
do-bigdata olap schema-change --cluster <集群名称> --database <库名> --table <表名> --query "<用户原始问题>"
```

从返回的 JSON 数据中提取 `schema_changes` 列表，找到用户所对应的操作记录。

**关键字段**：

| 字段 | 说明 |
|------|------|
| `JobId` | Schema Change Job 唯一 ID |
| `TableName` | 操作的表名 |
| `State` | 状态：PENDING/WAITING_TXN/RUNNING/FINISHED/CANCELLED |
| `CreateTime` | Job 创建时间 |
| `FinishTime` | Job 完成时间 |
| `Progress` | 执行进度（如 60%） |
| `Msg` | 状态消息（失败时包含错误信息） |

### Step 2: 分析 Schema Change 状态

根据 `State` 字段判断操作状态并给出对应分析（详见参考文档）：

#### 情况 A：操作进行中（PENDING / WAITING_TXN / RUNNING）

如果用户的操作 State 为 `PENDING`、`WAITING_TXN` 或 `RUNNING`，需要向用户说明：

> Schema Change 操作是**异步执行**的。StarRocks 在收到 ALTER TABLE 请求后，需要在后台对所有已有数据进行重刷（Rewrite），因此：
> - 提交任务后需要**异步等待**数据刷写完成
> - 表数据量越大，分区和分桶越多，耗时越长
> - 执行期间正常读写不受影响，但会消耗集群 CPU 和磁盘 IO 资源
> - 可通过 `Progress` 字段查看当前进度

同时可用 Step 3 获取表的 DDL 确认当前表结构。

#### 情况 B：操作已完成（FINISHED）

告知用户操作已成功完成。如果需要确认最终表结构，执行 Step 3 获取最新 DDL。

#### 情况 C：操作失败（CANCELLED）

查看 `Msg` 字段分析失败原因，对照参考文档中的"常见错误与解决方案"给出建议：

| 错误特征 | 可能原因 | 建议 |
|---------|---------|------|
| `timeout` / `exceeded` | 操作超时 | 增大 `alter_table_timeout_second` 参数后重试 |
| `memory` / `Memory limit` | 内存不足 | 检查 BE 内存，错峰执行 |
| `disk space` / `No space` | 磁盘空间不足 | 清理磁盘或扩容 |
| `replica` / `tablet` / `version` | 副本不一致 | 等待副本修复后重试 |
| `type` / `cast` / `convert` | 类型不兼容 | 检查类型兼容性，参考变更矩阵 |
| `another alter job` / `conflict` | 操作冲突 | 等待当前操作完成或取消后重试 |

如果错误原因指向**集群负载过高**导致超时或内存不足，应联动 `starrocks-load-analysis` skill 查看集群在操作时间段的 CPU、内存等关键指标。

> **联动提示**：`starrocks-data-distribution` skill 在进行单表数据分布诊断时，会联动本 Skill 的 `table-schema` 命令获取表的建表 Schema（分区分桶策略详情），以便结合统计数据给出更精确的分桶优化建议。

### Step 3: 查看表的建表 Schema（按需）

当需要确认表当前结构（变更是否生效、列定义等）时使用：

```bash
do-bigdata olap table-schema --cluster <集群名称> --database <库名> --table <表名> --query "<用户原始问题>"
```

获取 DDL 后，按以下要点进行深度分析（详见参考文档 "建表 Schema 分析要点"章节）：

#### 3.1 表模型分析
- **DUPLICATE KEY**（明细模型）：日志、事件流场景
- **AGGREGATE KEY**（聚合模型）：指标汇总场景
- **UNIQUE KEY**（更新模型）：维度表、状态表
- **PRIMARY KEY**（主键模型）：实时更新、CDC 场景

#### 3.2 分区策略分析（重点）

**识别分区类型**：
- `PARTITION BY RANGE(col)` → Range 分区（检查是否有 `dynamic_partition` 配置）
- `PARTITION BY date_trunc(...)` / `PARTITION BY time_slice(...)` → 表达式分区（推荐）
- `PARTITION BY (col)` 或 `PARTITION BY col` → 列表达式分区
- `PARTITION BY LIST(col)` → List 分区
- 无 PARTITION BY → 无分区

**给出分区优化建议**：
- 无分区且数据量大 → 建议添加表达式分区
- 使用 Range 分区 + 动态分区 → 检查 `dynamic_partition.buckets` 是否与初始分区一致，建议迁移到表达式分区
- 使用表达式分区 → 检查分区粒度是否合理，是否配置了 TTL（`partition_live_number`）
- 使用 List 分区且每分区只有一个值 → 建议迁移到表达式分区

**动态分区配置检查**（如果有）：
- `dynamic_partition.time_unit`：粒度是否与查询模式匹配
- `dynamic_partition.start`：数据保留期是否满足需求
- `dynamic_partition.end`：预创建分区数是否足够
- `dynamic_partition.buckets`：[WARN] 是否与手动创建分区的 BUCKETS 一致（常见陷阱）
- `dynamic_partition.history_partition_num`：[WARN] 默认值为 `0`（不创建历史分区），建表后需导入历史数据时必须设置为 > 0 的值

#### 3.3 分桶策略分析
- **分桶方式**：HASH 还是 RANDOM？
- **分桶键选择**：是否为高基数列？是否为常用查询条件列？
- **分桶数**：是否与数据量匹配？（推荐每 tablet 1~10GB）

#### 3.4 索引信息
- **排序键**：排序键选择是否有利于查询
- **Bitmap 索引**：低基数列的过滤加速
- **Bloom Filter 索引**：高基数列的等值查询加速

## 典型分析场景

### 场景 A：用户提交 ALTER TABLE 后查看进度

1. 用 `do-bigdata olap schema-change` 获取记录，按表名筛选
2. 查看 `State` 和 `Progress` 字段
3. 如果是 RUNNING，告知用户等待完成
4. 如果是 FINISHED，用 `do-bigdata olap table-schema` 确认最终结构

### 场景 B：Schema Change 失败排查

1. 用 `do-bigdata olap schema-change` 获取记录，找到 CANCELLED 的记录
2. 分析 `Msg` 字段确定失败根因
3. 给出解决方案（调参数/清磁盘/错峰执行等）
4. 如需查看集群负载，联动 `starrocks-load-analysis` skill

### 场景 C：确认表结构是否符合预期

1. 用 `do-bigdata olap table-schema` 获取当前表 DDL
2. 对比用户预期的表结构
3. 如果有差异，检查 `do-bigdata olap schema-change` 记录确认是否有未完成或失败的变更

## 参数说明

| 参数 | 说明 | 适用子命令 | 示例 |
|------|------|-----------|------|
| `--cluster` / `-c` | 集群名称（必需） | 所有 | `starrocks-prod` |
| `--database` / `-d` | 数据库名称（必需） | 所有 | `my_database` |
| `--table` / `-t` | 表名称 | schema-change（可选，模糊匹配）; table-schema（必需） | `my_table` |

## 参考文档

```bash
do-bigdata docs list --skill starrocks-schema-change
do-bigdata docs show --skill starrocks-schema-change --file schema_change_guide.md
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
