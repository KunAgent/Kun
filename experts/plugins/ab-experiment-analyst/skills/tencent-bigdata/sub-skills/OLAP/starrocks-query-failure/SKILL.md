---
name: starrocks-query-failure
description: >
  自动分析 StarRocks 集群近期的查询失败异常。从审计日志中提取失败请求，分析失败原因（超时、内存不足、语法错误、权限问题等），
  对于超时类失败可联动 starrocks-load-analysis skill 查看集群负载。不处理物化视图相关问题（刷新失败、改写查询失败等属于 starrocks-mv-troubleshooting）。
  触发关键词："查询失败", "查询报错", "查询超时", "错误码", "failure", "失败分析", "SQL报错", "查询异常", "Syntax error", "Memory limit exceeded"
---

## 概述

通过 do_mcp API 服务查询 StarRocks 集群审计日志中的失败记录，自动进行失败分类和原因分析。支持按错误码、用户维度筛选，超时类失败可联动 `starrocks-load-analysis` skill 查看集群监控指标。

**核心能力**：
1. **失败概览** — 统计失败查询数、错误码分布、用户分布、时间分布
2. **失败详情** — 查看具体失败 SQL、异常信息，支持按错误码/用户过滤
3. **失败分类** — 自动将失败归类为超时、内存不足、语法错误、权限问题等
4. **联动监控** — 超时类失败时联动智研监控判断是否集群负载过高

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 1: 获取失败请求概览

执行命令查询集群近期失败请求的统计概览：

```bash
# 默认最近 1 小时
do-bigdata olap failure-summary --cluster <集群名称> --query "<用户原始问题>"

# 最近 24 小时
do-bigdata olap failure-summary --cluster <集群名称> --hours 24 --query "<用户原始问题>"

# 指定时间范围
do-bigdata olap failure-summary --cluster <集群名称> \
    --start "2026-03-07 10:00:00" --end "2026-03-07 11:00:00" --query "<用户原始问题>"
```

根据概览结果分析：
- 错误码分布 — 哪些错误码最多
- 用户分布 — 哪些用户失败最多
- 时间分布 — 失败是否集中在某个时段
- 失败分类 — 超时/内存不足/语法错误等各占多少

### Step 2: 查看具体失败 SQL（按需）

若需查看某些失败记录的完整 SQL 做进一步分析：

```bash
# 查看所有失败详情
do-bigdata olap failure-detail --cluster <集群名称> --query "<用户原始问题>"

# 按错误码过滤
do-bigdata olap failure-detail --cluster <集群名称> --error-code 1064 --query "<用户原始问题>"

# 按用户过滤
do-bigdata olap failure-detail --cluster <集群名称> --user root --query "<用户原始问题>"

# 限制返回条数
do-bigdata olap failure-detail --cluster <集群名称> --limit 50 --query "<用户原始问题>"
```

### Step 3: 分析失败原因

根据获取的失败记录，参考参考文档中的分类标准分析：

| 失败类型 | 特征 | 分析方向 |
|---------|------|---------|
| 超时 | exception 含 `timeout`/`exceeded` | 查询本身耗时过长，或集群负载过高 |
| 内存不足 | exception 含 `Memory limit exceeded` | 查询消耗内存过大，或集群内存紧张 |
| 语法错误 | exception 含 `Syntax error` | SQL 语法问题 |
| 表/列不存在 | exception 含 `Unknown table`/`Unknown column` | 元数据问题 |
| 权限问题 | exception 含 `Access denied` | 用户权限不足，联动 `starrocks-privilege-analysis` skill 排查权限 |

### Step 4: 联动权限排查（权限问题场景）

**当发现失败原因包含权限问题（Access denied）时**，联动 `starrocks-privilege-analysis` skill 排查用户权限：

1. 从失败记录中提取用户名（`user` 字段）
2. 使用 `do-bigdata olap user-grants` 查看该用户的当前权限
3. 对比报错中需要的权限和用户已有的权限，找出缺失项
4. 参考权限参考文档给出具体的 GRANT 授权建议

> **注意**：权限排查仅限 `default_catalog` 下的权限。如报错涉及 Hive/Iceberg 等外部 Catalog 的表，需提醒用户到对应系统确认权限。

### Step 5: 联动监控排查（超时场景）

**当发现失败原因包含超时类时**，联动 `starrocks-load-analysis` skill 查看集群负载：

1. 从失败记录中提取失败发生的时间范围
2. 使用 `do-bigdata olap metric-data` 查询该时间段的 CPU、内存等关键指标
3. 综合判断：
   - **单条查询超时 + 集群负载正常** → 查询本身过重，需优化 SQL
   - **多条查询超时 + 集群负载高** → 集群资源不足，需扩容或限流
   - **多条查询超时 + 集群负载正常** → 可能是配置问题

**分析输出格式**：

```
## StarRocks 查询失败分析报告

### 基本信息
- 集群名称: {cluster_name}
- 分析时间范围: {start_time} ~ {end_time}
- 总失败查询数: {total}

### 失败分布
- 按错误码: ...
- 按失败类型: ...

### 重点问题
1. {最突出的失败类型及数量}

### 原因分析
{基于数据的具体分析，超时类需结合监控数据}

### 建议措施
1. {建议}
```

## 参数说明

| 参数 | 说明 | 适用子命令 | 示例 |
|------|------|-----------|------|
| `--cluster` / `-c` | 集群名称（必需） | failure-summary, failure-detail | `starrocks-prod` |
| `--hours` / `-t` | 时间跨度（小时），默认 1 | failure-summary, failure-detail | `24` |
| `--start` / `-s` | 指定开始时间（优先于 hours） | failure-summary, failure-detail | `2026-03-05 10:00:00` |
| `--end` / `-e` | 指定结束时间 | failure-summary, failure-detail | `2026-03-05 11:00:00` |
| `--error-code` | 按错误码过滤 | failure-detail | `1064` |
| `--user` / `-u` | 按用户过滤 | failure-detail | `root` |
| `--limit` / `-l` | 返回记录上限，默认 200 | failure-summary, failure-detail | `50` |

## 参考文档

```bash
do-bigdata docs list --skill starrocks-query-failure
do-bigdata docs show --skill starrocks-query-failure --file failure_analysis_guide.md
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
