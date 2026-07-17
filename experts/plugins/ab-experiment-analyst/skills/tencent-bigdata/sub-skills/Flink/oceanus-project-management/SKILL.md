---
name: project-management
description: Oceanus 项目管理 sub-skill。当用户提到查看项目、项目列表、创建项目、更新项目、项目成员、项目详情等关键词时触发。
---

## 概述

管理 Oceanus 项目，包括查看项目列表、项目详情、创建项目、更新项目信息、管理项目成员。

**核心能力**：

| 能力 | 说明 |
|------|------|
| 项目列表 | 列出用户有权访问的项目，支持关键词搜索 |
| 项目详情 | 获取项目名称、描述、创建时间等 |
| 创建项目 | 创建新项目 |
| 更新项目 | 更新项目基础信息 |
| 成员列表 | 查看项目成员及权限 |

> [WARN] **执行操作类命令前必须向用户确认**：所有会产生副作用的操作（包括 project-create、project-update）在执行前必须先向用户展示即将执行的操作摘要（操作类型、目标资源、关键参数），获得用户明确确认后才能执行。查询类命令（project-list、project-detail、members）无需确认。

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 1: 确定用户需求

| 用户需求 | 对应 CLI 命令 | 需要参数 |
|---------|-------------|---------|
| 查看项目列表 | `do-bigdata flink project-list` | 可选关键词 |
| 查看项目详情 | `do-bigdata flink project-detail` | 项目 ID |
| 查看项目成员 | `do-bigdata flink members` | 项目 ID |
| 创建项目 | `do-bigdata flink project-create` | 项目名称 + 描述 |
| 更新项目 | `do-bigdata flink project-update` | 项目 ID + 可选名称/描述 |

### Step 2: 执行操作

> [WARN] **禁止创建临时文件**：在执行任何操作（尤其是创建/更新项目）时，如果用户提供的信息不完整，模型必须直接询问用户补全，**绝对禁止创建临时 Python 脚本文件去调用 API 探测参数格式或补全缺失信息**。

#### 创建项目必填信息

创建项目（`project-create`）需要以下信息：

| 参数 | 必填 | 说明 |
|------|------|------|
| name | [OK] | 项目名称 |
| description | 否 | 项目描述 |

如果用户未提供项目名称，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/1265415386

#### 更新项目必填信息

更新项目（`project-update`）需要以下信息：

| 参数 | 必填 | 说明 |
|------|------|------|
| project-id | [OK] | 项目 ID |
| name | 至少一项 | 新项目名称 |
| description | 至少一项 | 新项目描述 |

如果用户未提供项目 ID 或未明确要更新什么，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/1265416766

```bash
# 列出项目
do-bigdata flink project-list --query "<用户原始问题>"

# 搜索项目
do-bigdata flink project-list --keyword "AMS" --query "<用户原始问题>"

# 查看项目详情
do-bigdata flink project-detail --project-id 11145 --query "<用户原始问题>"

# 查看项目成员
do-bigdata flink members --project-id 11145 --query "<用户原始问题>"

# 创建项目
do-bigdata flink project-create --name "my_project" --description "desc" --query "<用户原始问题>"

# 更新项目
do-bigdata flink project-update --project-id 11145 --name "new_name" --description "new_desc" --query "<用户原始问题>"
```

### Step 3: 分析结果

格式化输出项目信息，包括项目名称、描述、成员列表等。

## 参考文档

```bash
do-bigdata docs list --skill oceanus-project-management
do-bigdata docs show --skill oceanus-project-management --file oceanus_project_api.md
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
