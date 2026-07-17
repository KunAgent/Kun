---
name: resource-management
description: Oceanus 资源管理（库表与函数）sub-skill。当用户提到库表、函数、connector、schema、UDF、table、function、资源、元数据等关键词时触发。
---

## 概述

管理 Oceanus 平台的库表（Connector/Schema）和函数（UDF），包括创建、查看、更新，以及版本管理和关联作业查询。

**核心能力**：

| 类别 | 能力 | 说明 |
|------|------|------|
| 库表 | 列表查询、详情查看、创建/更新、版本列表、关联作业 | 库表全生命周期 |
| 函数 | 列表查询、详情查看、创建/更新、版本列表、关联作业 | 函数全生命周期 |

> [WARN] **执行操作类命令前必须向用户确认**：所有会产生副作用的操作（包括 table-create、table-update、function-create、function-update）在执行前必须先向用户展示即将执行的操作摘要（操作类型、目标资源、关键参数），获得用户明确确认后才能执行。查询类命令（list、detail、versions、jobs）无需确认。

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 1: 确定用户需求

| 用户需求 | 对应 CLI 命令 | 需要参数 |
|---------|-------------|---------|
| 查看库表列表 | `do-bigdata flink table-list` | 项目 ID |
| 查看库表详情 | `do-bigdata flink table-detail` | 项目 ID + 资源 ID |
| 查看库表版本 | `do-bigdata flink table-versions` | 项目 ID + 资源 ID |
| 查看库表关联作业 | `do-bigdata flink table-jobs` | 项目 ID + 资源 ID |
| 创建库表 | `do-bigdata flink table-create` | 项目 ID + body(JSON) |
| 更新库表 | `do-bigdata flink table-update` | 项目 ID + 资源 ID + body(JSON) |
| 查看函数列表 | `do-bigdata flink function-list` | 项目 ID |
| 查看函数详情 | `do-bigdata flink function-detail` | 项目 ID + 资源 ID |
| 查看函数版本 | `do-bigdata flink function-versions` | 项目 ID + 资源 ID |
| 查看函数关联作业 | `do-bigdata flink function-jobs` | 项目 ID + 资源 ID |
| 创建函数 | `do-bigdata flink function-create` | 项目 ID + body(JSON) |
| 更新函数 | `do-bigdata flink function-update` | 项目 ID + 资源 ID + body(JSON) |

### Step 2: 执行操作

> [WARN] **禁止创建临时文件**：在执行任何操作（尤其是创建/更新库表）时，如果用户提供的信息不完整，模型必须直接询问用户补全，**绝对禁止创建临时 Python 脚本文件去调用 API 探测参数格式或补全缺失信息**。

#### 创建库表 body 必填字段

创建库表（`table-create`）的 `--body` JSON 必须包含以下字段，缺一不可：

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 数据表名称 |
| type | string | 表类型：tube / kafka / hbase / jdbc / es 等 |
| description | string | 描述（可为空字符串 ""） |
| connector | object | 连接器配置，内部 type 须与表 type 一致 |
| format | object | 数据格式配置（如 csv / json） |

如果用户未提供 connector 或 format 的完整信息，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/1271680100

#### 更新库表 body 要求

更新库表（`table-update`）的 `--body` JSON 至少包含要更新的字段，不能为空对象。常见可更新字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 数据表名称 |
| type | string | 表类型 |
| description | string | 描述 |
| connector | object | 连接器配置 |
| format | object | 数据格式配置 |

如果用户未明确要更新哪些字段或提供的信息不完整，**必须停止执行并询问用户**，并提示用户参考文档：https://iwiki.woa.com/p/1271680245

#### 创建函数 body 必填字段

创建函数（`function-create`）的 `--body` JSON 必须包含以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 函数名称 |
| className | string | 函数完整类名（如 com.example.MyUDF） |
| type | string | 函数类型：SCALAR / TABLE / AGGREGATE |
| file | object | JAR 包信息对象 |

如果用户未提供 className 或 file 的完整信息，**必须停止执行并询问用户**。

#### 更新函数 body 要求

更新函数（`function-update`）的 `--body` JSON 至少包含要更新的字段，不能为空对象。常见可更新字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 函数名称 |
| className | string | 函数完整类名 |
| type | string | 函数类型 |
| file | object | JAR 包信息对象 |

如果用户未明确要更新哪些字段或提供的信息不完整，**必须停止执行并询问用户**。

```bash
# 查看库表列表
do-bigdata flink table-list --project-id 11145 --query "<用户原始问题>"

# 查看库表详情
do-bigdata flink table-detail --project-id 11145 --resource-id 12345 --query "<用户原始问题>"

# 查看库表版本列表
do-bigdata flink table-versions --project-id 11145 --resource-id 12345 --query "<用户原始问题>"

# 查看库表关联的作业
do-bigdata flink table-jobs --project-id 11145 --resource-id 12345 --query "<用户原始问题>"

# 创建库表
do-bigdata flink table-create --project-id 11145 --body '{"key":"value"}' --query "<用户原始问题>"

# 更新库表
do-bigdata flink table-update --project-id 11145 --resource-id 12345 --body '{"key":"value"}' --query "<用户原始问题>"

# 查看函数列表
do-bigdata flink function-list --project-id 11145 --query "<用户原始问题>"

# 查看函数详情
do-bigdata flink function-detail --project-id 11145 --resource-id 67890 --query "<用户原始问题>"

# 查看函数版本列表
do-bigdata flink function-versions --project-id 11145 --resource-id 67890 --query "<用户原始问题>"

# 查看函数关联的作业
do-bigdata flink function-jobs --project-id 11145 --resource-id 67890 --query "<用户原始问题>"

# 创建函数
do-bigdata flink function-create --project-id 11145 --body '{"key":"value"}' --query "<用户原始问题>"

# 更新函数
do-bigdata flink function-update --project-id 11145 --resource-id 67890 --body '{"key":"value"}' --query "<用户原始问题>"
```

### Step 3: 分析结果

格式化输出资源信息，包括库表/函数名称、版本、关联作业等。

## 参考文档

```bash
do-bigdata docs list --skill oceanus-resource-management
do-bigdata docs show --skill oceanus-resource-management --file oceanus_resource_api.md
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
