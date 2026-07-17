---
name: starrocks-table-locator
description: >
  根据库名或表名，反向定位该库/表归属于哪个或哪些 StarRocks 集群。
  适用于"我只知道库名/表名，不知道集群名"的场景，常作为其他 StarRocks 排查 Skill 的前置步骤。
  数据来源：StarRocks 库表统计快照（T+1 同步），仅支持精确匹配。
  触发关键词："表在哪个集群", "库在哪个集群", "反查集群", "定位集群", "locate table",
  "找 StarRocks 集群", "哪个 StarRocks", "我只有表名", "我只有库名", "table 属于哪个集群",
  "database 属于哪个集群"
---

## 概述

StarRocks 运维诊断的绝大多数 Skill（数据分布诊断、Schema Change、Routine Load、查询审计等）都
**强依赖 `cluster_name` 作为入参**。当用户只提供了库名 / 表名而没有指定集群时，本 Skill 用于
反向定位归属集群，再把结果交给下游 Skill 继续做诊断。

数据来源：运营信息表 `starrocks_cluster_table_info`，由后台每日 T+1 同步一次集群所有库表的
统计快照。Skill 通过精确匹配 `data_base` / `table_name` 字段，按 **集群粒度聚合**
返回归属集群清单，仅附带该集群下命中的表数量与最近快照时间，不返回逐表明细。

**核心能力**：
1. **按表名反查** — 仅给定 table 名，列出所有包含同名表的集群（可能多个集群有同名表）
2. **按库名反查** — 仅给定 database 名，列出所有包含该库的集群清单
3. **库 + 表组合反查** — 两个都给定，精确定位集群

## [WARN] 能力边界（重要）

| 限制 | 说明 |
|------|------|
| **仅精确匹配** | 不支持 `LIKE` / 模糊查询。库表名必须与 StarRocks 中一致（大小写敏感） |
| **数据时效 T+1** | 当天新建的库 / 表当天查不到，需要等次日快照同步 |
| **依赖快照覆盖** | 如果某个 StarRocks 集群未接入 `starrocks_cluster_table_info` 采集，反查会漏掉该集群 |
| **查询窗口** | 仅扫描今天的快照；今天还没有数据则回退到昨天；再没有则返回 0 命中，不提供更长回溯能力 |
| **只读** | 严格只读，仅 SELECT 反查，不涉及任何变更 |

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### 场景 A：用户只给了表名，问"这张表在哪个集群"

#### Step 1: 按表名精确反查

```bash
do-bigdata olap locate-table --table <表名> --query "<用户原始问题>"
```

输出会以集群为粒度，列出所有命中的集群（例：有 N 个集群都有该表名，则返回 N 条）。
```
集群名                                    命中表数      最近更新
------------------------------------------------------------------------------------------
starrocks-prod-a                          1             2026-05-20 04:06:16
starrocks-prod-b                          1             2026-05-20 04:06:16
```

#### Step 2: 处理多种命中场景

| 命中情况 | AI 后续动作 |
|---------|-------------|
| 0 个集群 | 提示用户：可能是表名拼写错误 / 表是今天新建的 / 集群未接入采集；本工具不提供更长窗口的回溯重试能力 |
| 1 个集群 | 直接告知用户集群名，并询问是否要继续做某项诊断（如数据分布、Schema 查看等） |
| 多个集群 | **必须列出全部命中集群**，并请用户确认目标集群后再继续；不要擅自挑选某个集群继续 |

### 场景 B：用户只给了库名，问"这个库在哪个集群"

#### Step 1: 按库名精确反查（locate-database 是 locate-table 的简写）

```bash
do-bigdata olap locate-database --database <库名> --query "<用户原始问题>"
# 等价于：
do-bigdata olap locate-table --database <库名> --query "<用户原始问题>"
```

#### Step 2: 同名库可能在多个集群存在

由于 StarRocks 各集群命名空间独立，相同库名可能同时存在于多个集群。务必把所有集群完整列出供用户选择。

### 场景 C：库 + 表组合，精确定位

```bash
do-bigdata olap locate-table --database <库名> --table <表名> --query "<用户原始问题>"
```

适用于用户明确给出 `db.table` 但没说集群的情况，能给出最精确的反查结果。

## 参数说明

| 参数 | 适用子命令 | 说明 | 示例 |
|------|-----------|------|------|
| `--database` / `-d` | locate-table（与 --table 至少一个）, locate-database（必需） | 数据库名（精确匹配） | `my_db` |
| `--table` / `-t` | locate-table（与 --database 至少一个） | 表名（精确匹配） | `orders` |

## 输出字段说明

返回为**集群粒度**的清单（不返回逐表明细，避免一个库下表很多时返回大量噪音数据）：

| 字段 | 说明 |
|------|------|
| `success` | 调用是否成功 |
| `query` | 回显本次查询入参（database_name / table_name） |
| `snapshot_date` | 命中所用的快照日期（today 或 yesterday） |
| `total` | **命中的集群个数** |
| `clusters[]` | 集群清单（每个集群一条），字段见下 |
| `clusters[].cluster_name` | 命中的 StarRocks 集群名 |
| `clusters[].matched_table_count` | 该集群下匹配到的表数量（按 db.table 去重） |
| `clusters[].latest_update_time` | 该集群下匹配快照的最近更新时间（YYYY-MM-DD HH:MM:SS） |

> [TIP] 本 Skill 不返回表数据量、副本数等明细字段。如需了解具体表的存储/副本分布，
> 在拿到 `cluster_name` 后改用 **starrocks-data-distribution** 的 `table-stats` / `diagnose-table` 子命令。

## 联动说明

| 联动 Skill | 触发场景 |
|-----------|---------|
| **starrocks-data-distribution** | 反查到集群后，可继续做数据分布诊断（cluster-overview / diagnose-table / table-stats / partitions） |
| **starrocks-schema-change** | 反查到集群后，调用 `table-schema` 获取建表语句 |
| **starrocks-query-info** | 反查到集群后，按 db / table 看相关审计、慢查询 |
| **starrocks-cluster-ops** | 反查到集群后，看节点状态、版本等运营信息 |

## 推荐用法（典型组合）

```
用户："orders 表为什么这么慢？"
   ↓
1. do-bigdata olap locate-table --table orders --query "..."
   → 命中集群：starrocks-prod-a
   ↓
2. do-bigdata olap diagnose-table --cluster starrocks-prod-a --database <从1拿到> --table orders --query "..."
   → 数据分布诊断
```

## 参考文档

```bash
do-bigdata docs list --skill starrocks-table-locator
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
