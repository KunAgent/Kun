---
name: metrics-query
description: Oceanus 监控指标查询 sub-skill。当用户提到指标、监控、TPS、延迟、Checkpoint、背压、吞吐量、metrics、connector 指标、operator 指标、MQ 消费延迟、Flink UI 指标、vertices 详情、TaskManager 资源、异常信息、Flink 版本、多版本适配等关键词时触发。也在用户需要查询 StarRocks 历史指标、离线指标分析、运行失败后回溯指标、Trace 事件、告警消息、作业阶段耗时等场景时触发。
---

## 概述

查询 Oceanus 平台上 Flink 作业的监控指标，涵盖三大数据源。

**核心能力**：

### 平台侧指标（Oceanus API → Hermes）

| 能力 | 说明 |
|------|------|
| 作业指标 | 获取作业 overview 级别指标 |
| Connector 指标 | connector 级别吞吐延迟（支持 SOURCE/SINK 过滤） |
| Operator 指标 | operator 级别指标详情 |
| 审计指标 | 审计链路级别指标 |
| 告警数据 | 查询告警数据 |
| MQ Lag | MQ 消费延迟趋势、分区排名、详情 |

### StarRocks 历史指标（NGCP API → StarRocks）

| 能力 | 说明 |
|------|------|
| Job 历史指标 | Checkpoint、重启、宕机等作业级别指标 |
| Node 历史指标 | TM/JM 级别 JVM、CPU、内存、GC、IO 指标 |
| Task 历史指标 | records/bytes in/out、backpressure、busyTime |
| Operator 历史指标 | Connector 访问、RocksDB 状态大小、审计延迟 |
| Trace 事件 | Job/Task 状态变更、Checkpoint 事件 |
| 告警消息 | 历史告警消息查询 |
| 作业阶段耗时 | 启动/停止/恢复各阶段耗时 |
| **GC 综合分析** | 一键 TM/JM GC 健康分析：自动探测 GC 类型、查询时序、逐容器分析、给出优化建议 |

### Flink UI 指标（多版本适配 1.7/1.9/1.13/1.15/2.1）

| 能力 | 说明 |
|------|------|
| 作业概览 | 状态、持续时间、最大并行度 |
| 算子列表 | 运行状态、并行度、延迟 |
| Checkpoint 统计/配置 | 计数、成功/失败详情、大小、间隔、模式 |
| TaskManager 概览 | 资源使用、slot 使用 |
| 异常信息 | 运行时异常列表 |

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 1: 确定用户需求

根据用户描述判断查询的数据源和指标类型：

| 用户需求 | 对应 CLI 命令 | 需要参数 |
|---------|-------------|---------|
| 平台侧指标（Hermes） | `do-bigdata flink hermes` | 项目 ID + 作业 ID |
| StarRocks 历史指标（NGCP） | `do-bigdata flink starrocks` | 项目 ID + 作业 ID + 环境 |
| Flink UI 指标 | `do-bigdata flink flink-ui` | 项目 ID + 作业 ID |

### Step 2: 执行查询

#### 平台侧指标查询（Hermes）

```bash
# 查看作业指标概览
do-bigdata flink hermes --action job_metrics --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 查看 Connector 指标（仅 Source）
do-bigdata flink hermes --action connector_metrics --project-id 11145 --job-id 279565 --connector-type SOURCE --query "<用户原始问题>"

# 查看 MQ Lag 趋势
do-bigdata flink hermes --action mq_lag --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 查看告警数据
do-bigdata flink hermes --action alarm_data --project-id 11145 --job-id 279565 --query "<用户原始问题>"
```

#### StarRocks 历史指标查询（NGCP）

```bash
# 查看 Job 级别历史指标
do-bigdata flink starrocks --action query_job --project-id 11145 --job-id 279565 --env oc2 --query "<用户原始问题>"

# 查看 Node 级别指标（所有 TM 聚合平均值）
do-bigdata flink starrocks --action query_node --project-id 11145 --job-id 279565 --env oc2 --summary AVG --query "<用户原始问题>"

# 查看 Checkpoint 事件
do-bigdata flink starrocks --action trace_checkpoint --project-id 11145 --job-id 279565 --env oc2 --query "<用户原始问题>"

# 一键 GC 分析
do-bigdata flink starrocks --action analyze_gc --project-id 11306 --job-id 283736 --env oc2 --query "<用户原始问题>"

# GC 分析（指定时间范围）
do-bigdata flink starrocks --action analyze_gc --project-id 11306 --job-id 283736 --env oc2 \
    --start-time "2026-03-22 00:00:00" --end-time "2026-03-23 00:00:00" --query "<用户原始问题>"

# 查看告警消息
do-bigdata flink starrocks --action query_alarm --project-id 11145 --env oc2 --limit 20 --query "<用户原始问题>"
```

#### Flink UI 指标查询

# 查看 Flink 作业概览
do-bigdata flink flink-ui --action job_overview --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 查看所有算子详情
do-bigdata flink flink-ui --action vertices --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 查看 Checkpoint 统计
do-bigdata flink flink-ui --action checkpoints --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 查看 TaskManager 概览
do-bigdata flink flink-ui --action taskmanagers --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 查看运行时异常
do-bigdata flink flink-ui --action exceptions --project-id 11145 --job-id 279565 --query "<用户原始问题>"
```

### Step 3: 分析结果

- 对于已停止的作业，Flink UI 不可用，引导使用 StarRocks 历史指标
- GC 分析输出包含健康评估和优化建议
- 根据 `flink_version` 字段自动选择正确的 API 路径模板

## 参考文档

```bash
do-bigdata docs list --skill oceanus-metrics-query
do-bigdata docs show --skill oceanus-metrics-query --file oceanus_metrics_api.md
do-bigdata docs show --skill oceanus-metrics-query --file flink_rest_api_reference.md
do-bigdata docs show --skill oceanus-metrics-query --file starrocks_metrics_reference.md
do-bigdata docs show --skill oceanus-metrics-query --file flink_metrics_analysis_guide.md
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
