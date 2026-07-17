---
name: oceanus-resource-advisor
description: 查询 Oceanus 实时计算项目的资源使用情况。当用户需要了解项目下实时计算资源总量和使用情况、按应用组查看实时资源和集群资源使用情况、查看各作业资源占用明细、了解如何申请实时资源、如何在 Oceanus 上调整资源或切换集群时调用此 skill。不涉及日志分析、异常诊断或 Checkpoint 分析。
---

## 概述

查询 Oceanus 实时计算项目的实时资源配额和实际使用情况，提供作业级别的资源使用明细，以及资源申请和集群调整的操作指引。

**核心能力**：

1. **项目资源概览** — 查询项目的 CPU、内存配额以及当前使用量
2. **应用组资源查询** — 按应用组名查找关联的项目，汇总所有项目的集群实时资源使用情况
3. **作业资源明细** — 列出运行中作业的实时资源占用，按 CPU 或内存排序，支持 TOP N
4. **集群列表查询** — 查看项目关联的可用集群
5. **资源管理指引** — 输出实时资源申请、扩容、集群切换的操作步骤

## 触发条件

**当用户请求中包含以下意图时调用此 skill**：

- 查看项目资源使用情况 / 资源概览
- 查看应用组的实时资源 / 集群资源使用情况
- 各作业占用了多少 CPU / 内存
- 如何申请实时计算资源 / 如何换集群
- 资源不足 / 配额不够

**不触发的场景**：

- 诊断作业异常 → 使用 `flink-yarn-perjob`
- 分析日志 → 使用 `oceanus-log-analyzer`
- 查看作业列表 → 使用 `oceanus-job-list`

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 1: 确定用户需求

根据用户的描述判断需要查询的信息类型：

| 用户需求 | 对应 CLI 命令 | 需要参数 |
|---------|-------------|---------|
| 查看项目资源概览和作业明细 | `do-bigdata flink overview` | 项目 ID 或应用组名 |
| 查看项目关联的集群列表 | `do-bigdata flink clusters` | 项目 ID |
| 了解如何申请资源/换集群 | `do-bigdata flink guide` | 项目 ID |

如果用户未提供项目 ID、应用组名或 Oceanus URL，**先向用户询问**。

### Step 2: 执行查询

```bash
# 查询项目资源概览（推荐）
do-bigdata flink overview --project-id {project_id} --query "<用户原始问题>"

# 按应用组查询实时资源
do-bigdata flink overview --app-group {app_group_name} --query "<用户原始问题>"

# 从 Oceanus URL 自动提取
do-bigdata flink overview --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops" --query "<用户原始问题>"

# 仅查看资源 TOP N 的作业
do-bigdata flink overview --project-id {project_id} --top 10 --query "<用户原始问题>"

# 按内存排序
do-bigdata flink overview --project-id {project_id} --sort memory --query "<用户原始问题>"

# 查看集群列表
do-bigdata flink clusters --project-id {project_id} --query "<用户原始问题>"

# 显示资源申请和集群调整指引
do-bigdata flink guide --project-id {project_id} --query "<用户原始问题>"
```

### Step 3: 分析结果

输出内容包括集群资源配额汇总、作业资源明细表格、各集群资源详情和操作指引。

实时资源申请关键信息（供快速回答）：
- **申请入口**: https://wedata.woa.com/groupManage → 选择应用组 → 申请资源 → 资源类型选「实时计算」
- **资源评估**: 1 计算单元 = 20 CPU核 + 60G 内存
- **重要**: 离线和实时资源分开管理，不能混用！

## 应用资源配置建议

| 组件 | 最小值 | 推荐值 | 最大值 | 说明 |
|------|--------|--------|--------|------|
| **JobManager 内存** | **2 GB** | 2-4 GB | 50 GB | 单个 JM 内存必须 ≥ 2GB |
| **TaskManager 内存** | **2 GB** | 2-8 GB | 50 GB | 有状态算子建议 4-8GB |
| **单个 TM CPU** | 1 核 | 1-4 核 | 8 核 | YARN 对每个容器申请的资源有上限限制 |

**资源配置参考文档**：https://iwiki.woa.com/p/1060395513

### 查询条件推导

- 用户说"查看项目 12500 的资源" → `do-bigdata flink overview --project-id 12500`
- 用户说"查看应用组 xxx 的实时资源" → `do-bigdata flink overview --app-group xxx`
- 用户给出 Oceanus URL → `do-bigdata flink overview --oceanus-url "..."`
- 用户说"有哪些集群可用" → `do-bigdata flink clusters --project-id xxx`
- 用户说"如何申请资源" → `do-bigdata flink guide --project-id xxx`

## 参考文档

```bash
do-bigdata docs list --skill oceanus-resource-advisor
do-bigdata docs show --skill oceanus-resource-advisor --file oceanus_resource_api.md
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
