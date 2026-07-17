---
name: job-management
description: Oceanus 作业全生命周期管理 sub-skill。当用户提到查看作业、修改作业、创建作业、启动作业、停止作业、重启作业、编译作业、作业状态、作业详情、作业版本、资源配置、告警配置等关键词时触发。
---

## 概述

Oceanus 作业全生命周期管理，覆盖查询、操作、配置、日志四大类能力。

**核心能力**：

| 类别 | 能力 | 说明 |
|------|------|------|
| 查询 | 作业详情、列表、全局搜索、按 AppID 查找、运行状态、执行历史、版本 | 只读查询 |
| 操作 | 启动/停止/重启/编译/创建/创建或更新版本 | 写操作 |
| 配置 | 资源配置获取/更新、基础信息更新、告警配置获取/更新 | 配置管理 |
| 日志 | 编译日志、调试日志 | 日志查看 |

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 1: 确定用户需求

根据用户的描述判断需要执行的操作：

| 用户需求 | 对应 CLI 命令 | 需要参数 |
|---------|-------------|---------|
| 查看作业详情 | `do-bigdata flink job-detail` | 项目 ID + 作业 ID 或 Oceanus URL |
| 查看作业列表 | `do-bigdata flink job-list` | 项目 ID |
| 全局搜索作业 | `do-bigdata flink job-search` | 关键词或 App ID |
| 启动作业 | `do-bigdata flink start` | 项目 ID + 作业 ID |
| 停止作业 | `do-bigdata flink stop` | 项目 ID + 作业 ID |
| 重启作业 | `do-bigdata flink restart` | 项目 ID + 作业 ID |
| 编译作业 | `do-bigdata flink compile` | 项目 ID + 作业 ID |
| 创建作业 | `do-bigdata flink job-create` | 项目 ID + 作业名称 + 作业类型 |
| 创建/更新作业版本 | `do-bigdata flink update-manifest` | 项目 ID + 作业 ID + 版本信息 JSON |
| 查看/更新资源配置 | `do-bigdata flink resource` | 项目 ID + 作业 ID |
| 查看/更新告警配置 | `do-bigdata flink alarm` | 项目 ID + 作业 ID |
| 查看当前执行状态 | `do-bigdata flink execution` | 项目 ID + 作业 ID |
| 查看执行历史 | `do-bigdata flink executions` | 项目 ID + 作业 ID |
| 查看版本/Manifest | `do-bigdata flink manifests` | 项目 ID + 作业 ID |
| 查看 Savepoint 列表 | `do-bigdata flink snapshots` | 项目 ID + 作业 ID |
| 查看编译日志 | `do-bigdata flink compile-log` | 项目 ID + 作业 ID |
| 查看调试日志 | `do-bigdata flink debug-log` | 项目 ID + 作业 ID |

### Step 2: 执行操作

> [WARN] **禁止创建临时文件**：在执行任何操作时，如果用户提供的信息不完整，模型必须直接询问用户补全，**绝对禁止创建临时 Python 脚本文件去调用 API 探测参数格式或补全缺失信息**。

#### 创建作业必填信息

| 参数 | 必填 | 说明 |
|------|------|------|
| project-id | [OK] | 项目 ID |
| job-name | [OK] | 作业名称 |
| job-type | [OK] | 作业类型（SQL 或 JAR 或 GRAPH） |
| description | [OK] | 作业描述 |
| flink-version | [OK] | Flink 版本（建议 1.15，也支持 2.1 等，注意格式为纯版本号如 `1.15`，不带 `Flink-` 前缀） |

如果用户未提供上述任一必填参数，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/1315567133

#### 创建或更新作业版本必填信息

| 参数 | 必填 | 说明 |
|------|------|------|
| project-id | [OK] | 项目 ID |
| job-id | [OK] | 作业 ID |
| manifest-json | [OK] | 版本信息 JSON（含 program 和可选 configuration） |
| --new-version | 首次时[OK] | 首次创建版本时必须指定 |

**manifest-json 中 program 字段根据作业类型不同：**

- **SQL 作业**: `{"program": {"type": "sql", "text": "SQL语句"}, "configuration": {}}`
- **JAR 作业**: `{"program": {"type": "jar", "mainClassName": "完整类名", "jarFileVersion": {"projectId": 项目ID, "fileId": 文件ID, "version": 版本号}, "artifactFileVersions": {}}, "configuration": {}}`
- **GRAPH 作业**: `{"program": {"type": "graph", "nodes": [...], "schemas": "..."}, "configuration": {}}`

**configuration 可选字段示例：**
```json
{
  "stateType": "ROCKSDB",
  "checkpointMode": "EXACTLY_ONCE",
  "checkpointTimeout": 60000,
  "enableCheckpointing": true,
  "checkpointInterval": 60000,
  "properties": {}
}
```

如果用户未提供 manifest-json 或不明确版本信息，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/1315568081

#### 更新作业必填信息

| 参数 | 必填 | 说明 |
|------|------|------|
| project-id | [OK] | 项目 ID |
| job-id | [OK] | 作业 ID |
| 更新内容 | [OK] | 需明确要更新什么（名称/描述等） |

如果用户未提供作业 ID 或未明确要更新什么，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/4012548292

#### 更新资源配置必填信息

| 参数 | 必填 | 说明 |
|------|------|------|
| project-id | [OK] | 项目 ID |
| job-id | [OK] | 作业 ID |
| resource-json | [OK] | 资源配置 JSON（含 cpuCores、memoryBytes 等） |

如果用户未提供资源配置 JSON，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/1321271938

#### 查询或更新告警配置必填信息

| 参数 | 必填 | 说明 |
|------|------|------|
| project-id | [OK] | 项目 ID |
| job-id | [OK] | 作业 ID |
| alarm-json | 更新时[OK] | 告警配置 JSON（含 receivers、rules 等） |

如果用户要更新告警配置但未提供 alarm-json，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/4008470205

```bash
# 查看作业详情（通过 Oceanus URL）
do-bigdata flink job-detail --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/11145/279565/ops" --query "<用户原始问题>"

# 查看作业详情（通过项目 ID + 作业 ID）
do-bigdata flink job-detail --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 查看作业列表
do-bigdata flink job-list --project-id 11145 --query "<用户原始问题>"

# 全局搜索作业
do-bigdata flink job-search --keyword "my_job" --query "<用户原始问题>"

# 按 App ID 搜索
do-bigdata flink job-search --app-id 237070 --query "<用户原始问题>"

# 启动作业
do-bigdata flink start --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 启动作业（指定 savepoint 恢复）
do-bigdata flink start --project-id 11145 --job-id 279565 --restore-path "hdfs://..." --query "<用户原始问题>"

# 停止作业（触发 savepoint）
do-bigdata flink stop --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 重启作业（先停后启）
do-bigdata flink restart --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 编译作业
do-bigdata flink compile --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 获取资源配置
do-bigdata flink resource --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 获取告警配置
do-bigdata flink alarm --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 创建作业
do-bigdata flink job-create --project-id 11145 --job-name "my_new_job" --job-type SQL --query "<用户原始问题>"

# 创建或更新作业版本（SQL 作业，首次创建需 --new-version）
do-bigdata flink update-manifest --project-id 11145 --job-id 279565 --manifest-json '{"program":{"type":"sql","text":"INSERT INTO sink SELECT * FROM source"},"configuration":{}}' --new-version --query "<用户原始问题>"

# 更新作业版本（非首次，不需要 --new-version）
do-bigdata flink update-manifest --project-id 11145 --job-id 279565 --manifest-json '{"program":{"type":"sql","text":"INSERT INTO sink SELECT * FROM source"},"configuration":{}}' --query "<用户原始问题>"

# 查看当前执行状态
do-bigdata flink execution --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 查看执行历史
do-bigdata flink executions --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 查看版本/Manifest 列表
do-bigdata flink manifests --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 查看 Savepoint 列表
do-bigdata flink snapshots --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 查看编译日志
do-bigdata flink compile-log --project-id 11145 --job-id 279565 --query "<用户原始问题>"

# 查看调试日志
do-bigdata flink debug-log --project-id 11145 --job-id 279565 --query "<用户原始问题>"
```

### Step 3: 分析结果

1. 格式化输出结果
2. 操作失败时返回详细错误信息和可能原因分析

## 参考文档

```bash
do-bigdata docs list --skill oceanus-job-management
do-bigdata docs show --skill oceanus-job-management --file oceanus_job_api.md
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
