---
name: file-management
description: Oceanus 文件管理 sub-skill。当用户提到文件、JAR 包、依赖文件、文件版本、文件上传、文件下载、文件迁移、file、jar、upload、download、version 等关键词时触发。
---

## 概述

管理 Oceanus 平台上的文件（JAR 包、依赖文件等），包括文件上传、列表查看、版本管理、函数/应用关联和迁移。

**核心能力**：

| 类别 | 能力 | 说明 |
|------|------|------|
| 文件 | 上传/列表/详情/更新 | 文件基本管理 |
| 版本 | 新增版本/列表/详情/更新/下载 | 文件多版本管理 |
| 关联 | 函数/应用关联视图、迁移函数/应用 | 关联关系管理 |

> [WARN] **执行操作类命令前必须向用户确认**：所有会产生副作用的操作（包括上传、更新、添加版本、迁移函数、迁移作业等）在执行前必须先向用户展示即将执行的操作摘要（操作类型、目标资源、关键参数），获得用户明确确认后才能执行。查询类命令（list、detail、versions、download、file-functions、file-function-view、file-jobs、file-job-view）无需确认。

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 1: 确定用户需求

| 用户需求 | 对应 CLI 命令 | 需要参数 |
|---------|-------------|---------|
| 查看文件列表 | `do-bigdata flink file-list` | 项目 ID |
| 查看文件详情 | `do-bigdata flink file-detail` | 项目 ID + 文件 ID |
| 更新文件信息 | `do-bigdata flink file-update` | 项目 ID + 文件 ID + 描述/版本号 |
| 查看文件版本列表 | `do-bigdata flink versions` | 项目 ID + 文件 ID |
| 查看版本详情 | `do-bigdata flink version-detail` | 项目 ID + 文件 ID + 版本号 |
| 更新版本信息 | `do-bigdata flink version-update` | 项目 ID + 文件 ID + 版本号 + 描述 |
| 添加新版本 | `do-bigdata flink add-version` | 项目 ID + 文件 ID + 文件路径 |
| 下载文件 | `do-bigdata flink download` | 项目 ID + 文件 ID + 版本号 |
| 上传文件 | `do-bigdata flink upload` | 项目 ID + 文件路径 |
| 查看关联函数 | `do-bigdata flink file-functions` | 项目 ID + 文件 ID |
| 查看关联函数(含历史) | `do-bigdata flink file-function-view` | 项目 ID + 文件 ID |
| 迁移函数到版本 | `do-bigdata flink transfer-functions` | 项目 ID + 文件 ID + 目标版本 + 函数ID |
| 查看关联作业 | `do-bigdata flink file-jobs` | 项目 ID + 文件 ID |
| 查看关联作业(含历史) | `do-bigdata flink file-job-view` | 项目 ID + 文件 ID |
| 迁移作业到版本 | `do-bigdata flink transfer-jobs` | 项目 ID + 文件 ID + 目标版本 + 作业ID |

### Step 2: 执行操作

> [WARN] **禁止创建临时文件**：在执行任何操作时，如果用户提供的信息不完整，模型必须直接询问用户补全，**绝对禁止创建临时 Python 脚本文件去调用 API 探测参数格式或补全缺失信息**。

#### 上传文件必填信息

| 参数 | 必填 | 说明 |
|------|------|------|
| project-id | [OK] | 项目 ID |
| file-path | [OK] | 本地文件路径 |

如果用户未提供文件路径，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/1274352898

#### 更新文件必填信息

| 参数 | 必填 | 说明 |
|------|------|------|
| project-id | [OK] | 项目 ID |
| file-id | [OK] | 文件 ID |
| description 或 current-version | 至少一项 | 更新内容 |

如果用户未提供文件 ID 或未明确要更新什么，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/1274353026

#### 新增文件版本必填信息

| 参数 | 必填 | 说明 |
|------|------|------|
| project-id | [OK] | 项目 ID |
| file-id | [OK] | 文件 ID |
| file-path | [OK] | 本地文件路径 |

如果用户未提供文件路径，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/1274353109

#### 更新文件版本必填信息

| 参数 | 必填 | 说明 |
|------|------|------|
| project-id | [OK] | 项目 ID |
| file-id | [OK] | 文件 ID |
| version | [OK] | 版本号 |
| description | [OK] | 版本描述 |

如果用户未提供版本号或描述，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/1274353345

#### 迁移函数/作业必填信息

| 参数 | 必填 | 说明 |
|------|------|------|
| project-id | [OK] | 项目 ID |
| file-id | [OK] | 文件 ID |
| target-version | [OK] | 目标版本号 |
| function-ids / job-ids | [OK] | 要迁移的函数/作业 ID 列表 |

如果用户未提供目标版本或函数/作业 ID，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/1265415221

```bash
# 列出项目下的文件
do-bigdata flink file-list --project-id 11145 --query "<用户原始问题>"

# 查看文件详情
do-bigdata flink file-detail --project-id 11145 --file-id 123 --query "<用户原始问题>"

# 更新文件信息
do-bigdata flink file-update --project-id 11145 --file-id 123 --description "new desc" --query "<用户原始问题>"

# 查看文件版本列表
do-bigdata flink versions --project-id 11145 --file-id 123 --query "<用户原始问题>"

# 查看版本详情
do-bigdata flink version-detail --project-id 11145 --file-id 123 --version 2 --query "<用户原始问题>"

# 更新版本信息
do-bigdata flink version-update --project-id 11145 --file-id 123 --version 2 --description "fix bug" --query "<用户原始问题>"

# 为文件添加新版本
do-bigdata flink add-version --project-id 11145 --file-id 123 --file-path /path/to/file.jar --query "<用户原始问题>"

# 下载文件
do-bigdata flink download --project-id 11145 --file-id 123 --version 2 --query "<用户原始问题>"

# 上传文件
do-bigdata flink upload --project-id 11145 --file-path /path/to/file.jar --file-name my-udf.jar --query "<用户原始问题>"

# 查看文件关联的函数
do-bigdata flink file-functions --project-id 11145 --file-id 123 --query "<用户原始问题>"

# 查看文件关联的函数（含历史版本）
do-bigdata flink file-function-view --project-id 11145 --file-id 123 --query "<用户原始问题>"

# 迁移函数到指定版本
do-bigdata flink transfer-functions --project-id 11145 --file-id 123 --target-version 3 --function-ids "1,2,3" --query "<用户原始问题>"

# 查看文件关联的作业
do-bigdata flink file-jobs --project-id 11145 --file-id 123 --query "<用户原始问题>"

# 查看文件关联的作业（含历史版本）
do-bigdata flink file-job-view --project-id 11145 --file-id 123 --query "<用户原始问题>"

# 迁移作业到指定版本
do-bigdata flink transfer-jobs --project-id 11145 --file-id 123 --target-version 3 --job-ids "1,2,3" --query "<用户原始问题>"
```

### Step 3: 分析结果

格式化输出文件信息，包括文件名、版本号、关联的函数/应用等。

## 参考文档

```bash
do-bigdata docs list --skill oceanus-file-management
do-bigdata docs show --skill oceanus-file-management --file oceanus_file_api.md
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
