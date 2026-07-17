---
name: yarn-queue-analysis
description: 当用户需要分析 YARN 队列（Queue）或应用组（AppGroup）的资源使用情况时使用此 skill。通过 do_mcp API 服务获取队列的调度器快照数据和队列内各应用的资源消耗数据，自动分析队列的资源使用合理性、是否存在拥堵、识别资源消耗大户、临时任务、新增任务和批量补录，并从队列使用者的角度给出优化建议。需要提供应用组名称（appgroup_name）和集群名称（cluster_name），或者提供一个 Application ID（app_id）来自动定位。在调用此 skill 前，必须再次加载一次 tencent-bigdata 这个 skill，进行热加载。
---

## 概述

分析 YARN 队列（Queue）或应用组（AppGroup）的资源使用情况。通过调用 do_mcp API 服务获取两类数据：**队列级别的调度器快照**和**队列内各应用的资源采集数据**，从多个维度分析队列资源使用的合理性，并从队列使用者的角度给出可操作的优化建议。

**维度说明**：
- 所有分析以**应用组**为基本维度，一个应用组下有 `-offline` 和 `-online` 两个子队列，后端接口已做汇总
- 一个应用组可能在**多个集群**上有资源，必须指定集群名称（`cluster_name`）
- 支持两种入口：直接提供应用组名+集群名，或通过 Application ID 自动定位

**核心分析能力**：

1. **队列健康度评估** — 判断应用组当前的资源使用率、是否存在排队等待（pending）的任务、队列是否拥堵
2. **资源消耗 Top-N 应用识别** — 找出应用组中资源消耗最多的应用，帮助用户快速定位资源占用大户
3. **持续资源占用任务识别** — 识别当前持有大量资源且长时间持续占用的任务。[WARN] 注意：此数据无法判断任务是否空闲，只能识别持续占用资源的大户，是否空闲需要用户自行检查
4. **临时任务识别** — 识别临时查询、PySpark Shell、Notebook 等非调度任务，量化临时任务对队列资源的影响
5. **新增任务识别** — 识别近期新增的调度任务，帮助用户定位队列使用率变化的原因
6. **批量补录检测** — 检测同一个调度任务产生大量不同数据时间的 app（批量补录/重跑），帮助定位队列拥堵原因
7. **队列使用趋势分析** — 基于历史数据展示队列使用率的变化趋势，帮助判断是持续高负载还是临时峰值
8. **用户维度资源分析** — 按提交用户聚合资源消耗，识别哪个用户/业务占用了最多队列资源

## 分析入口

用户可以通过以下**任意一种**方式发起分析：

1. **提供应用组名 + 集群名**：直接进入分析流程
2. **提供应用组名（不带集群名）**：先查询应用组有哪些集群，让用户选择后再分析
3. **提供 Application ID（app_id）**：先通过 app_id 查到应用组和集群，再进入分析流程

## 工具脚本
所有需要鉴权的 API 调用均通过 `do-bigdata yarn` CLI 执行，鉴权信息由 CLI 的 `@auth_required` 装饰器自动处理，不经过模型传输。

### 命令列表

| 命令 | 功能 | 需要鉴权 |
|------|------|------|
| `do-bigdata yarn queue-clusters` | 查询应用组的集群列表 | 是（CLI 内部处理） |
| `do-bigdata yarn queue-status` | 获取应用组当前资源使用状态 | 是（CLI 内部处理） |
| `do-bigdata yarn queue-analysis` | 综合应用分析（推荐，一次返回 6 个维度） | 是（CLI 内部处理） |
| `do-bigdata yarn queue-trend` | 获取队列使用率趋势 | 是（CLI 内部处理） |
| `do-bigdata yarn appgroup-info` | 通过 app_id 查询应用组和集群信息 | 是（CLI 内部处理） |


> [WARN] 性能约束：涉及 app 资源数据的命令（`queue-analysis`），**1 分钟内最多调用 2 次**。如需对比多个时间段，两次调用之间**等待至少 30 秒**。## 工作流

### 第 0 步：确定应用组名和集群名（路由步骤）

#### 情况 A：用户提供了 Application ID（app_id）

```bash
do-bigdata yarn appgroup-info --app-id {app_id} --query "<用户原始问题>"
```

返回 `appgroup_name` 和 `cluster_name` 后，直接进入第 1 步。

#### 情况 B：用户提供了应用组名（可能带或不带集群名）

```bash
do-bigdata yarn queue-clusters --appgroup {appgroup_name} --query "<用户原始问题>"
```

处理逻辑：
1. 如果用户提供了集群名 → 在返回的集群列表中匹配
2. 如果用户没有提供集群名 → 将集群列表展示给用户，请用户选择
3. 如果只有一个集群 → 直接使用

### 第 1 步：获取应用组当前状态快照

```bash
do-bigdata yarn queue-status --appgroup {appgroup_name} --cluster {cluster_name} --query "<用户原始问题>"
```

**返回字段说明**：

| 字段 | 含义 |
|------|------|
| `memory_usage_pct` | 内存使用率（%） |
| `vcores_usage_pct` | vCores 使用率（%） |
| `num_active_apps` | 当前正在运行的应用数 |
| `num_pending_apps` | 当前排队等待的应用数 |
| `used_memory_mb` / `max_memory_mb` | 已用/最大内存（MB） |
| `used_vcores` / `max_vcores` | 已用/最大 vCores |
| `collect_time` | 数据采集时间 |

**分析要点**：
- 使用率 **≥ 90%** → 资源接近饱和
- 使用率 **≥ 95%** 且 pending > 0 → 队列明显拥堵
- `num_pending_apps > 10` → 严重排队

### 第 2 步：综合应用分析（核心步骤）

```bash
do-bigdata yarn queue-analysis --appgroup {appgroup_name} --cluster {cluster_name} [--time-range 60] [--top-n 10] --query "<用户原始问题>"
```

**一次调用返回 6 个维度**：

| 维度 | 字段 | 说明 |
|------|------|------|
| Top-N 应用 | `top_apps` | 按内存累加值降序，含资源占比 |
| 持续占用任务 | `attention_apps` | 当前持有 ≥ 1GB 且持续占用，含关注评分 |
| 临时任务 | `adhoc_apps` | data_time 为空的非调度任务 |
| 新增任务 | `new_tasks` | 近 7 天内新建的调度任务 |
| 批量补录 | `backfill_tasks` | 同一任务 ≥ 3 个不同数据时间 |
| 用户聚合 | `user_stats` | 按用户聚合资源占比 |

各维度的详细字段说明和分析要点参见 `references/queue_analysis_guide.md`。

### 第 3 步：获取队列使用率趋势（可选）

```bash
do-bigdata yarn queue-trend --appgroup {appgroup_name} --cluster {cluster_name} [--time-range 360] --query "<用户原始问题>"
```

返回时间序列 + 统计摘要（平均使用率、峰值使用率、pending 持续时间）。

### 第 4 步：综合分析与诊断报告

基于以上数据，进行综合分析并输出诊断报告。

**[WARN] 重要原则：所有建议必须站在队列使用者的角度**

- [OK] 建议用户优化自己的任务资源配置
- [OK] 建议用户错峰提交任务
- [OK] 建议用户释放不必要的长期运行任务
- [FAIL] **不要**建议扩容集群、修改调度器配置等集群管理员层面的操作
- [FAIL] **不要**建议用户提单申请扩容应用组队列资源（除非确认队列完全无法满足合理需求，提单申请地址为https://wedata.woa.com/groupManage）

## 调用摘要

| 步骤 | 命令 | 必须/可选 |
|------|------|------|
| 第 0 步 | `do-bigdata yarn appgroup-info` 或 `do-bigdata yarn queue-clusters` | 按需 |
| 第 1 步 | `do-bigdata yarn queue-status` | 必须 |
| 第 2 步 | `do-bigdata yarn queue-analysis` | 必须 |
| 第 3 步 | `do-bigdata yarn queue-trend` | 可选 |

**总计**：一次完整分析最多 4 次调用（其中慢查询仅第 2 步 1 次）。

## 参考文档

```bash
do-bigdata docs list --skill yarn-queue-analysis
do-bigdata docs show --skill yarn-queue-analysis --file queue_analysis_guide.md
```

- `queue_analysis_guide.md` — 队列资源分析参考指南。包含常见的队列资源问题模式、各类阈值参考标准、以及从使用者角度的优化策略。

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
