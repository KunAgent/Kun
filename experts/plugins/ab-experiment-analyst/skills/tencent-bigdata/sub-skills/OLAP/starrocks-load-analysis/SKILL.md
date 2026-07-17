---
name: starrocks-load-analysis
description: >
  从智研（Zhiyan）监控平台查询 StarRocks 集群的各类监控指标数据，包括 CPU、内存、磁盘、网络、查询延迟等。
  当用户询问 StarRocks 集群的任何监控指标、需要查看集群负载状态或性能趋势、排查集群性能问题需要查看历史监控数据时使用此 skill。
  本 Skill 负责查看监控指标数据，starrocks-query-failure 负责分析查询失败原因，两者协作而非重叠。
  触发关键词："CPU使用率", "内存使用", "磁盘使用", "监控指标", "集群负载", "性能趋势", "查询延迟", "QPS", "Compaction", "智研", "metric", "负载分析"
---

## 概述

通过 do_mcp API 服务查询 StarRocks 集群在智研（Zhiyan）监控平台上的各类指标数据，支持 CPU、内存、磁盘、网络、查询性能、导入、Compaction 等全方位监控。

**核心能力**：
1. **指标发现** — 获取全量指标列表，按关键字搜索匹配用户需求
2. **指标元数据** — 查询指标配置信息（app_mark、tag_set 等）
3. **指标数据查询** — 获取指定时间范围内的时序监控数据和统计信息
4. **负载分析** — 结合多个指标数据综合分析集群负载状况

## 前置条件

- 已知 StarRocks 集群名称

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 1: 理解用户需求，确定查询参数

从用户描述中提取：
- **集群名称**（必需）：StarRocks 集群名
- **指标名称**（可选）：用户可能给出精确指标名，也可能只描述需求（如"CPU负载"、"内存使用"）
- **时间范围**：默认最近 1 小时，用户可指定

### Step 2: 获取指标列表并选择合适的指标

#### 情况 A：用户已提供明确的指标名

先通过关键字搜索验证指标是否存在：

```bash
do-bigdata olap metric-search --keyword <指标名关键字> --query "<用户原始问题>"
```

若搜索结果中包含该指标，则进入 Step 3；若不存在，退回到情况 B 进行更广泛的搜索。

#### 情况 B：用户未提供明确的指标名

先通过关键字搜索匹配指标：

```bash
do-bigdata olap metric-search --keyword <关键字> --query "<用户原始问题>"
```

关键字选择策略（参考参考文档中的"指标分类概览"表）：
- "CPU负载" → 关键字 `cpu`
- "内存使用" → 关键字 `mem` 或 `memory`
- "磁盘" → 关键字 `disk`
- "查询延迟" → 关键字 `latency` 或 `query`
- "导入" → 关键字 `load`

若搜索无结果，获取全量列表：

```bash
do-bigdata olap metric-list --query "<用户原始问题>"
```

从返回的指标列表中选择最匹配的指标。选择依据：
- 匹配用户描述的关键词
- 如有多个匹配，优先选最相关的
- 不确定时将候选列表展示给用户确认

### Step 3: 获取指标元数据（必须执行）

> **[WARN] 重要规则**：在查询指标数据之前，**必须**先获取指标元数据，确认指标名称正确且存在。**严禁跳过此步骤直接查询数据**，否则可能因指标名错误导致查询失败。

使用 Step 2 中确定的指标名称获取元数据：

```bash
do-bigdata olap metric-metadata --metric <指标名称> --query "<用户原始问题>"
```

验证要点：
- 若返回成功（`success: true`），确认 `metric_name`、`description`、`tag_set` 等信息符合预期，然后进入 Step 4
- 若返回失败，说明指标名不正确，**必须退回 Step 2** 重新搜索匹配正确的指标名
- **绝不要**凭猜测使用未经验证的指标名直接查询数据

### Step 4: 查询指标数据

确定指标名称且元数据验证通过后，查询数据：

```bash
# 默认最近 1 小时
do-bigdata olap metric-data --cluster <集群名称> --metric <指标名称> --query "<用户原始问题>"

# 指定时间跨度
do-bigdata olap metric-data --cluster <集群名称> --metric <指标名称> --hours 6 --query "<用户原始问题>"

# 指定精确时间范围
do-bigdata olap metric-data --cluster <集群名称> --metric <指标名称> \
    --start "2026-03-07 10:00:00" --end "2026-03-07 11:00:00" --query "<用户原始问题>"
```

### Step 5: 分析输出结果（按节点角色分别解读）

> **[WARN] 重要变化**：`metric-data` 命令现已支持**存算一体（BE）/ 存算分离（CN）/ 混合部署**三种集群形态。
> 服务端会自动探测集群拓扑，并对存在的角色（BE / CN）**各自调用一次智研接口**，返回结构按角色分组。

命令输出关键字段：

- `node_topology`：`{"BE": true/false, "CN": true/false}`，指明集群中存在哪种角色的活节点
- `queried_roles`：本次实际查询的角色列表（如 `["BE"]` 或 `["CN"]` 或 `["BE", "CN"]`）
- `node_data`：按角色分组的指标结果，形如：
  ```json
  {
    "BE": {"success": true, "metrics": [...], "tag_set_used": [...]},
    "CN": {"success": true, "metrics": [...], "tag_set_used": [...]}
  }
  ```
  每个角色的 `metrics[].statistics` / `metrics[].data_points` / `metrics[].unit` 含义同旧版。
- `request_info.gap_minutes`：数据点间隔

**集群形态判定与解读策略**：

| `node_topology` 状态 | 集群形态 | 解读策略 |
|---|---|---|
| `BE=true, CN=false` | 存算一体 | 仅解读 `node_data.BE`，按 BE 资源使用率做结论 |
| `BE=false, CN=true` | 存算分离 | 仅解读 `node_data.CN`，按 CN 资源使用率做结论；说明该集群无 BE |
| `BE=true, CN=true` | 混合部署 | **必须分别解读 BE 和 CN 两组数据**，分章节呈现，明确指出哪一类节点是瓶颈 |
| 都为 false | 探测失败兜底 | 服务端会兜底按 BE 查询一次，向用户提示"节点状态探测异常，请人工确认集群存活情况" |

**注意**：cpuBusy / ioUtil / memUsedPercent 这类指标在 zhiyan 配置表中默认按 BE 路径配置，服务端会**根据集群角色自动把 `[BE]` 标签替换为 `[CN]`** 后再调智研，无需 Skill 手动处理。

**分析输出格式**：

#### 形态 A：存算一体（BE-only）或存算分离（CN-only）

```
## StarRocks 集群负载分析报告

### 查询信息
- 集群名称: {cluster_name}
- 集群形态: 存算一体 / 存算分离
- 查询指标: {metric_name}（{description}）
- 时间范围: {start_time} ~ {end_time}

### {BE|CN} 节点数据
- 当前值: {current}
- 最大值: {max}（时间: {max_time}）
- 最小值: {min}（时间: {min_time}）
- 平均值: {avg}

### 分析结论
{基于该角色节点数据的分析结论和建议}
```

#### 形态 B：混合部署（BE + CN）

```
## StarRocks 集群负载分析报告

### 查询信息
- 集群名称: {cluster_name}
- 集群形态: 混合部署（BE + CN 同时存在）
- 查询指标: {metric_name}
- 时间范围: {start_time} ~ {end_time}

### BE 节点数据
- 当前值 / 最大 / 最小 / 平均: ...

### CN 节点数据
- 当前值 / 最大 / 最小 / 平均: ...

### 综合分析结论
{对比 BE 与 CN 的资源水位，明确指出哪类节点是当前瓶颈，给出针对性建议}
```

若需进一步分析，参考参考文档中的"指标分析要点"和"指标组合分析建议"。

## 多指标组合分析

当用户需要全面了解集群负载时，按以下顺序查询多个指标：

1. **资源水位**：CPU → 内存 → 磁盘使用率
2. **查询性能**：Query QPS → Query Latency
3. **数据健康**：Compaction Score → 版本数量

每个指标单独执行 Step 3 和 Step 4，最后汇总输出综合分析报告。

## 参考文档

```bash
do-bigdata docs list --skill starrocks-load-analysis
do-bigdata docs show --skill starrocks-load-analysis --file zhiyan_metrics_guide.md
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
