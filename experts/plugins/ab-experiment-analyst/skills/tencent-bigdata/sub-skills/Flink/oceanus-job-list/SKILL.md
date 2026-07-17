---
name: oceanus-job-list
description: 查看 Oceanus/Flink 作业列表。当用户需要查看、搜索、列出 Oceanus 平台上的作业（任务）时调用此 skill，支持按项目 ID、项目名称、任务名称、应用名称模糊查询，输出任务列表信息。不涉及日志分析或异常诊断。
---

## 概述

通过 Oceanus REST API 查询作业列表，支持多种查询维度。

**核心能力**：
1. **按应用名称模糊查询（跨项目）** — 全局搜索任务名称
2. **按项目 ID 查询** — 列出指定项目下的所有作业
3. **按应用 ID 精确查找** — 通过 `--app-id` 全局精确查找指定任务
4. **按状态过滤** — 仅列出 RUNNING/CANCELLED/FAILED 等状态的作业
5. **单个作业自动分析** — 当查询结果为单个作业时，自动调用 `flink-yarn-perjob` 分析

## 触发条件

**当用户请求中包含以下意图时调用此 skill**：

- 查看/列出 Oceanus 作业（任务）
- 搜索/查找 Oceanus 任务
- 按项目 ID、项目名称、任务名称查询

**不触发的场景**：

- 分析日志（启动/编译/停止日志）→ 使用 `oceanus-log-analyzer`
- 诊断作业异常（OOM、GC、心跳超时等）→ 使用 `flink-yarn-perjob`

**[WARN] 安全约束：本 skill 仅限只读查询操作，严禁执行任何写操作。**

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 1: 确定查询条件

根据用户的描述判断查询方式：

| 用户需求 | 对应 CLI 命令 | 需要参数 |
|---------|-------------|---------|
| 按应用名称全局搜索 | `do-bigdata flink search` | 关键词 |
| 按应用 ID 精确查找 | `do-bigdata flink find` | 应用 ID |
| 按项目 ID 列出作业 | `do-bigdata flink job-list` | 项目 ID |

**核心规则**：
> - **纯数字** → 视为**项目 ID**，列出该项目下的作业
> - **环境名称**（如 `pub_oceanus2.0`）或**域名** → 视为**环境标识**，列出该环境下的项目列表
> - **其他非数字** → 视为**应用（任务）名称**，全局模糊搜索（跨项目）
>
> **用户没有明确说"项目"时，非数字关键词默认当作应用名称模糊查询。**

### Step 2: 执行查询

```bash
# 按应用名称全局搜索（推荐，跨项目模糊匹配）
do-bigdata flink search --keyword test_adilwu --query "<用户原始问题>"

# 按应用 ID 精确查找
do-bigdata flink find --app-id 237070 --query "<用户原始问题>"

# 按项目 ID 列出作业
do-bigdata flink job-list --project-id 11145 --query "<用户原始问题>"

# 按项目 ID + 状态过滤
do-bigdata flink job-list --project-id 11145 --state RUNNING --query "<用户原始问题>"

# 从 Oceanus URL 自动提取
do-bigdata flink job-list --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops" --query "<用户原始问题>"

# 指定环境
do-bigdata flink job-list --project-id 11145 --env pcg_oceanus2.0 --query "<用户原始问题>"
```

### Step 3: 分析结果

- 将脚本输出的表格结果直接展示给用户
- **查看单个 job 时自动分析**：当查询结果为单个作业时，自动调用 `do-bigdata flink diag` 分析该应用异常
- 仅当作业状态为 RUNNING、FAILED、CANCELLED、STOPPED 等有资源的状态时才分析；UNREADY 状态无需分析

### 查询条件推导

- 用户说"查看 oceanus test_adilwu" → `do-bigdata flink search --keyword test_adilwu`
- 用户说"oceanus 应用ID 237070" → `do-bigdata flink find --app-id 237070`
- 用户说"oceanus 11145 的任务" → `do-bigdata flink job-list --project-id 11145`
- 用户给出 Oceanus URL → 使用 `--oceanus-url`
- 用户额外说"查看运行中的" → 加 `--state RUNNING`
- 用户额外说"PCG 环境" → 加 `--env pcg_oceanus2.0`
- **用户未说明环境时，默认使用 `oceanus.woa.com`（pub_oceanus2.0）**

## 参考文档

```bash
do-bigdata docs list --skill oceanus-job-list
do-bigdata docs show --skill oceanus-job-list --file oceanus_job_api.md
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
