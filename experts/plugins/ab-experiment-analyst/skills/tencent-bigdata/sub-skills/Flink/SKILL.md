---
name: Flink
description: Flink/Oceanus 流计算诊断与运维 Skills 集合。包含十个子 skill：flink-yarn-perjob（作业异常诊断/异常分析/异常重启/单 TM 容器定向诊断）、oceanus-job-list（作业列表查询）、oceanus-log-analyzer（编译/启动/停止日志分析）、oceanus-resource-advisor（实时资源咨询）、oceanus-job-management（作业全生命周期管理，CLI 命令 job-detail/job-create/start/stop/restart/compile/resource/alarm）、oceanus-file-management（文件管理，CLI 命令 file-list/file-detail/versions/upload）、oceanus-metrics-query（监控指标查询）、oceanus-project-management（项目管理，CLI 命令 project-list/project-detail/project-create/members）、oceanus-resource-management（库表与函数管理，CLI 命令 table-list/table-detail/function-list/function-detail）、oceanus-knowledge（基于 Knot MCP 检索 Oceanus 官方知识库，回答使用方法/原理/最佳实践等知识类问题）。所有命令均带模块前缀，无冲突。
---

# Flink/Oceanus Skills 总览

> 本文档汇总 `sub-skills/Flink` 目录下所有 Flink/Oceanus 相关 Skills，方便快速浏览和查找。

## 支持的 Oceanus 环境

以下所有 Skill 均支持通过 URL 自动识别 Oceanus 环境，用户可直接粘贴对应环境的作业链接：

| 环境标识 | 域名 | API IP（直连） | 示例 URL |
|----------|------|---------------|----------|
| `pub_oceanus2.0` | `oceanus.woa.com` | `21.63.245.239` | `https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops` |
| `pcg_new_oceanus2.0` | `oceanus-pcg-new.woa.com` | `21.63.245.67` | `https://oceanus-pcg-new.woa.com/#/task/streaming/detail/{project_id}/{job_id}/edit` |
| `pcg_oceanus2.0` | `oceanus-pcg.woa.com` | `21.63.244.149` | `https://oceanus-pcg.woa.com/#/task/streaming/detail/{project_id}/{job_id}/edit` |
| `fit_oceanus2.0` | `oceanus-fit.woa.com` | `21.63.245.16` | `https://oceanus-fit.woa.com/#/task/streaming/detail/{project_id}/{job_id}/edit` |
| `pre_oceanus2.0` | `oceanus-pre.woa.com` | `21.63.246.106` | `https://oceanus-pre.woa.com/#/task/streaming/detail/{project_id}/{job_id}/edit` |
| `pub_oceanus1.0` | `oceanus1.woa.com` | `30.45.66.6` | `https://oceanus1.woa.com/#/task/streaming/detail/{job_id}/view` |
| `sg_oceanus2.0` | `oceanus-sg.woa.com` | `21.51.0.86` | `https://oceanus-sg.woa.com/#/task/streaming/detail/{project_id}/{job_id}/edit` |
| `sg_oceanus1.0` | `oceanus1-sg.woa.com` | `11.186.153.93` | `https://oceanus1-sg.woa.com/#/task/streaming/detail/{job_id}/view` |
| `wxgpay_oceanus2.0` | `oceanus-wxgpay.woa.com` | `21.72.235.231` | `https://oceanus-wxgpay.woa.com/#/task/streaming/detail/{project_id}/{job_id}/edit` |

> **重要**: 所有 Oceanus API 调用均默认使用 **IP 直连**（`http://{API_IP}:8080`），不通过域名访问，绕过 OA 网关和 SSL 证书问题。脚本内部会根据用户提供的域名 URL 自动映射到对应 IP。

**URL 格式说明**：
```
https://{domain}/#/task/streaming/detail/{project_id}/{job_id}/{tab}
```
- `domain`: 环境域名（如 `oceanus.woa.com`）
- `project_id`: 项目 ID（如 `12500`）
- `job_id`: 作业 ID（如 `243133`）
- `tab`: 页面标签（如 `ops`、`edit`、`view`、`config` 等，可选）
- **API 调用地址**：`http://{API_IP}:8080`（从上表按域名查找对应 IP）

---

## CLI 命令速查表

以下是 `do-bigdata flink` 实际注册的所有命令及其所属 Skill（共 33 个，所有命令带模块前缀，无冲突）：

| CLI 命令 | 说明 | 所属 Skill |
|---------|------|-----------|
| `diag` | 一站式异常诊断 | flink-yarn-perjob |
| `checkpoint` | Checkpoint 失败分析 | flink-yarn-perjob |
| `job-list` | 按项目查询作业列表 | oceanus-job-list |
| `search` | 按应用名称全局搜索作业 | oceanus-job-list |
| `find` | 按应用 ID 精确查找作业 | oceanus-job-list |
| `analyze` | 分析编译/启动/停止日志 | oceanus-log-analyzer |
| `overview` | 项目资源概览和作业明细 | oceanus-resource-advisor |
| `clusters` | 项目关联的集群列表 | oceanus-resource-advisor |
| `guide` | 资源申请和集群调整指引 | oceanus-resource-advisor |
| `job-detail` | 查看作业详情 | oceanus-job-management |
| `job-create` | 创建作业 | oceanus-job-management |
| `start` | 启动作业 | oceanus-job-management |
| `stop` | 停止作业 | oceanus-job-management |
| `restart` | 重启作业 | oceanus-job-management |
| `compile` | 编译作业 | oceanus-job-management |
| `resource` | 查看/更新资源配置 | oceanus-job-management |
| `alarm` | 查看/更新告警配置 | oceanus-job-management |
| `file-list` | 查看文件列表 | oceanus-file-management |
| `file-detail` | 查看文件详情 | oceanus-file-management |
| `upload` | 上传文件 | oceanus-file-management |
| `versions` | 文件版本列表 | oceanus-file-management |
| `hermes` | 平台侧指标查询 | oceanus-metrics-query |
| `starrocks` | StarRocks 历史指标 | oceanus-metrics-query |
| `flink-ui` | Flink UI 指标查询 | oceanus-metrics-query |
| `project-list` | 查看项目列表 | oceanus-project-management |
| `project-detail` | 查看项目详情 | oceanus-project-management |
| `project-create` | 创建项目 | oceanus-project-management |
| `members` | 查看项目成员 | oceanus-project-management |
| `table-list` | 查看库表列表 | oceanus-resource-management |
| `table-detail` | 查看库表详情 | oceanus-resource-management |
| `function-list` | 查看函数列表 | oceanus-resource-management |
| `function-detail` | 查看函数详情 | oceanus-resource-management |

---

---

| # | Skill 名称 | 目录 | 简介 |
|---|-----------|------|------|
| 1 | [Flink on YARN Per-Job 诊断](#1-flink-yarn-perjob--flink-on-yarn-per-job-诊断) | `flink-yarn-perjob/` | 诊断 Flink on YARN per-job 模式作业异常，支持心跳超时 TM/JM GC/OOM 分析、Checkpoint 失败分析、不活跃 TM 日志获取（NM 直连 + MCP 回退）、Oceanus 自动发现（oceanus1 + oceanus2） |
| 2 | [Oceanus 作业列表查询](#2-oceanus-job-list--oceanus-作业列表查询) | `oceanus-job-list/` | 查看、搜索 Oceanus 平台作业列表，支持按应用名称全局搜索（跨项目）、按项目 ID/名称查询、按应用 ID 精确查找、按环境列出项目列表、单个作业自动触发异常分析 |
| 3 | [Oceanus 日志分析](#3-oceanus-log-analyzer--oceanus-日志分析) | `oceanus-log-analyzer/` | 分析 Oceanus 作业的编译/启动/停止日志异常（仅当用户提到启动失败、编译失败、停止失败等关键词时触发），支持 20+ 种异常模式匹配和 JAR 冲突检测 |
| 4 | [Oceanus 实时资源咨询](#4-oceanus-resource-advisor--oceanus-实时资源咨询) | `oceanus-resource-advisor/` | 查询项目实时计算资源总量和使用情况、作业资源占用明细、集群列表，提供资源申请和集群切换指引 |
| 5 | [Oceanus 作业管理](#5-oceanus-job-management--oceanus-作业管理) | `oceanus-job-management/` | Oceanus 作业全生命周期管理，支持作业详情（`job-detail`）、创建（`job-create`）、启动/停止/重启/编译作业、资源配置、告警配置 |
| 6 | [Oceanus 文件管理](#6-oceanus-file-management--oceanus-文件管理) | `oceanus-file-management/` | Oceanus 文件管理，支持文件列表（`file-list`）、详情（`file-detail`）、上传（`upload`）、版本管理（`versions`） |
| 7 | [Oceanus 监控指标查询](#7-oceanus-metrics-query--oceanus-监控指标查询) | `oceanus-metrics-query/` | Oceanus 监控指标查询，支持平台侧指标（Hermes）、StarRocks 历史指标（NGCP）、Flink UI 指标（多版本适配 1.7/1.9/1.13/1.15/2.1） |
| 8 | [Oceanus 项目管理](#8-oceanus-project-management--oceanus-项目管理) | `oceanus-project-management/` | Oceanus 项目管理，支持项目列表（`project-list`）/详情（`project-detail`）/创建（`project-create`）/成员管理（`members`） |
| 9 | [Oceanus 资源管理](#9-oceanus-resource-management--oceanus-资源管理) | `oceanus-resource-management/` | Oceanus 资源管理（库表与函数），支持库表（`table-list`/`table-detail`）和函数（`function-list`/`function-detail`） |
| 10 | [Oceanus 知识库检索](#10-oceanus-knowledge--oceanus-知识库检索) | `oceanus-knowledge/` | 通过 Knot MCP 检索 Oceanus 官方知识库（UUID `ecde7202c88d482991bb3b52f9c8d861`），回答使用方法/原理/最佳实践/FAQ 等知识类问题，不调用 CLI/REST API。同时包含 Oceanus 运维工具参考（智研平台工具列表） |

---

## 联系信息（必须遵守）

**在所有 Flink/Oceanus 诊断分析的建议中，必须在末尾输出：如有问题请联系 adilwu/julianwei**

---

## 1. flink-yarn-perjob — Flink on YARN Per-Job 诊断

**适用场景**：用户需要诊断运行在 YARN per-job 模式下的 Flink 作业异常，包括心跳超时、GC 问题、OOM、Checkpoint 失败等。兼容 Flink 1.7+。

### 核心能力

| 能力 | 说明 |
|------|------|
| 异常信息获取 | 通过 Flink REST API 获取作业级别异常（root exception + per-task exceptions） |
| 心跳超时 TM GC 分析 | 仅在异常包含心跳超时时，自动获取 TaskManager GC 日志，分析是否存在频繁 Full GC |
| 心跳超时 TM OOM 检测 | 仅在异常包含心跳超时时，分析 taskmanager.log 是否存在 OutOfMemoryError |
| JM GC/OOM 分析 | 默认分析 JobManager 的 GC 日志和 OOM（优先 Flink REST API，回退到 NM/MCP），可通过 `--no-analyze-jm-gc` 禁用 |
| 不活跃 TM 日志获取 | 对已被 YARN 回收的容器，优先通过 NodeManager REST API 获取日志；NM 不可达时通过 MCP (yarn_mcp) 回退 |
| Checkpoint 失败分析 | 通过运行时指标分析 Checkpoint 失败原因（超时、Task 失败、状态过大、数据倾斜等） |
| Oceanus 自动发现 | 支持 oceanus2（TAUTH 认证）和 oceanus1（不同 token 机制）自动获取 Flink 地址进行诊断 |

### 常用命令

```bash
# 异常诊断（推荐，通过 Oceanus URL 自动发现）
do-bigdata flink diag --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops" --query "<用户原始问题>"

# 通过 Flink URL 直接诊断
do-bigdata flink diag --flink-url http://<rm-host>:<port>/proxy/<application-id> --query "<用户原始问题>"

# 通过 YARN RM 自动发现
do-bigdata flink diag --rm-url http://<rm-host>:8088 --app-id <application-id> --query "<用户原始问题>"

# 禁用 JobManager GC/OOM 分析
do-bigdata flink diag --flink-url http://<rm-host>:<port>/proxy/<application-id> --no-analyze-jm-gc --query "<用户原始问题>"

# NM 不可达时通过 MCP 回退获取不活跃 TM 日志
do-bigdata flink diag --flink-url http://<rm-host>:<port>/proxy/<application-id> --mcp-url http://mcp-host:8080 --query "<用户原始问题>"

# Checkpoint 失败分析
do-bigdata flink checkpoint --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops" --query "<用户原始问题>"
```

### 参考文档

```bash
do-bigdata docs list --skill flink-yarn-perjob
do-bigdata docs show --skill flink-yarn-perjob --file yarn_flink_api.md
```

---

## 2. oceanus-job-list — Oceanus 作业列表查询

**适用场景**：用户需要查看、搜索、列出 Oceanus 平台上的作业（任务），支持按应用名称全局搜索（跨项目）、按项目 ID/名称查询、按应用 ID 精确查找等。仅限只读查询，不执行写操作。

### 核心能力

| 能力 | 说明 |
|------|------|
| 按应用名称全局搜索 | 非数字关键词默认跨项目模糊搜索任务名称（通过 `/api/v2/jobs`） |
| 按应用 ID 精确查找 | 通过 `--app-id` 全局精确查找指定任务 |
| 按项目 ID 查询 | 直接列出指定项目下的所有作业 |
| 按项目名称模糊查询 | 先搜索项目，再列出匹配项目下的作业 |
| 按环境列出项目列表 | 传入环境名称或域名时列出该环境的项目列表 |
| 按状态过滤 | 仅列出 RUNNING/CANCELLED/FAILED 等状态的作业 |
| URL 自动提取 | 从 Oceanus URL 自动提取环境、项目 ID、任务 ID |
| 多环境支持 | 支持 9 个 Oceanus 环境，默认 `oceanus.woa.com`（pub_oceanus2.0） |
| 单个作业自动分析 | 当查询结果为单个作业时，自动调用 `flink-yarn-perjob` 分析该作业异常 |

### 常用命令

```bash
# 按应用名称全局搜索（推荐，跨项目模糊匹配）
do-bigdata flink search --keyword test_adilwu --query "<用户原始问题>"

# 按应用 ID 精确查找
do-bigdata flink find --app-id 237070 --query "<用户原始问题>"

# 按项目 ID 列出作业
do-bigdata flink job-list --project-id 11145 --query "<用户原始问题>"

# 按环境列出项目列表
do-bigdata flink job-list --project-id 11145 --env pcg_oceanus2.0 --query "<用户原始问题>"

# 从 Oceanus URL 自动提取
do-bigdata flink job-list --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops" --query "<用户原始问题>"

# 指定环境 + 按状态过滤
do-bigdata flink job-list --project-id 11145 --env pcg_oceanus2.0 --state RUNNING --query "<用户原始问题>"
```

### 参考文档

```bash
do-bigdata docs list --skill oceanus-job-list
do-bigdata docs show --skill oceanus-job-list --file oceanus_job_api.md
```

---

## 3. oceanus-log-analyzer — Oceanus 日志分析

**适用场景**：**仅当**用户提到"启动失败"、"启动异常"、"启动错误"、"编译异常"、"编译失败"、"编译错误"、"停止中"、"停止失败"或"停止错误"时触发。分析 Oceanus 平台上 Flink 流式作业的编译日志、启动日志和停止日志中的异常信息。

**不触发的场景**：查看作业状态、修改配置、资源调优、Checkpoint 分析等。

### 核心能力

| 能力 | 说明 |
|------|------|
| 编译日志分析 | 获取作业构建阶段日志，检测编译错误、依赖缺失、构建失败等问题 |
| 启动日志分析 | 获取作业启动阶段日志，检测 OOM、类加载失败、连接异常、资源不足等问题 |
| 停止日志分析 | 获取作业停止阶段日志，检测 Checkpoint/Savepoint 失败、容器被杀、资源抢占等问题 |
| 自动异常提取 | 从日志中自动提取 ERROR 级别日志、Exception 堆栈、关键 WARN 信息 |
| 模式匹配诊断 | 基于 20+ 种常见异常模式自动识别问题类型并给出结论 |
| JAR 冲突检测 | 检测到 ClassNotFoundException、NoSuchMethodError、NoClassDefFoundError、LinkageError 等异常时，自动提示排查文档和推荐依赖版本 |

### 常用命令

```bash
# 分析所有日志（推荐）
do-bigdata flink analyze --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops" --query "<用户原始问题>"

# 仅分析编译日志
do-bigdata flink analyze --oceanus-url "..." --log-type compile --query "<用户原始问题>"

# 仅分析启动日志
do-bigdata flink analyze --oceanus-url "..." --log-type start --query "<用户原始问题>"

# 仅分析停止日志
do-bigdata flink analyze --oceanus-url "..." --log-type stop --query "<用户原始问题>"
```

### 参考文档

```bash
do-bigdata docs list --skill oceanus-log-analyzer
do-bigdata docs show --skill oceanus-log-analyzer --file oceanus_log_api.md
```

---

## 4. oceanus-resource-advisor — Oceanus 实时资源咨询

**适用场景**：用户需要了解项目下实时计算资源总量和使用情况、查看各作业资源占用明细、了解如何申请实时资源、如何在 Oceanus 上调整资源或切换集群。

### 核心能力

| 能力 | 说明 |
|------|------|
| 项目资源概览 | 查询项目的 CPU/内存配额以及当前使用量 |
| 作业资源明细 | 列出运行中作业的实时资源占用，按 CPU 或内存排序，支持 TOP N |
| 集群列表查询 | 查看项目关联的可用集群 |
| 资源管理指引 | 输出实时资源申请、扩容、集群切换的操作步骤和页面入口 URL |

### 常用命令

```bash
# 查询项目资源概览
do-bigdata flink overview --project-id {project_id} --query "<用户原始问题>"

# 从 Oceanus URL 自动提取
do-bigdata flink overview --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops" --query "<用户原始问题>"

# 查看集群列表
do-bigdata flink clusters --project-id {project_id} --query "<用户原始问题>"

# 显示资源申请和集群调整指引
do-bigdata flink guide --project-id {project_id} --query "<用户原始问题>"

# 仅查看资源 TOP 10 的作业
do-bigdata flink overview --project-id {project_id} --top 20 --query "<用户原始问题>"

# 按内存排序
do-bigdata flink overview --project-id {project_id} --sort memory --query "<用户原始问题>"
```

### 参考文档

```bash
do-bigdata docs list --skill oceanus-resource-advisor
do-bigdata docs show --skill oceanus-resource-advisor --file oceanus_resource_api.md
```

## 5. oceanus-job-management — Oceanus 作业管理

**适用场景**：用户需要对 Oceanus 作业进行全生命周期管理，包括查看详情、创建、修改、启动、停止、重启、编译作业，以及资源配置和告警配置管理。

**触发关键词**：查看作业、修改作业、创建作业、启动作业、停止作业、重启作业、编译作业、作业状态、作业详情、作业版本、资源配置、告警配置

### 核心能力

| 能力 | 说明 |
|------|------|
| 查询 | 作业详情、列表、全局搜索、按 AppID 查找、运行状态、执行历史、版本 |
| 操作 | 启动/停止/重启/编译/创建|
| 配置 | 资源配置获取/更新、基础信息更新、告警配置获取/更新 |
| 日志 | 编译日志、调试日志 |

### CLI 命令

| CLI 命令 | 说明 |
|---------|------|
| `do-bigdata flink job-detail` | 查看作业详情 |
| `do-bigdata flink job-create` | 创建作业 |
| `do-bigdata flink start` | 启动作业 |
| `do-bigdata flink stop` | 停止作业 |
| `do-bigdata flink restart` | 重启作业 |
| `do-bigdata flink compile` | 编译作业 |
| `do-bigdata flink resource` | 查看/更新资源配置 |
| `do-bigdata flink alarm` | 查看/更新告警配置 |

### 常用命令

```bash
# 查看作业详情（从 URL 自动解析）
do-bigdata flink job-detail --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops" --query "<用户原始问题>"

# 查看作业详情（手动指定）
do-bigdata flink job-detail --project-id {project_id} --job-id {job_id} --query "<用户原始问题>"

# 启动作业
do-bigdata flink start --project-id {project_id} --job-id {job_id} --query "<用户原始问题>"

# 停止作业
do-bigdata flink stop --project-id {project_id} --job-id {job_id} --query "<用户原始问题>"

# 重启作业
do-bigdata flink restart --project-id {project_id} --job-id {job_id} --query "<用户原始问题>"

# 编译作业
do-bigdata flink compile --project-id {project_id} --job-id {job_id} --query "<用户原始问题>"

# 创建作业
do-bigdata flink job-create --project-id {project_id} --job-name "my_new_job" --job-type SQL --query "<用户原始问题>"

# 查看资源配置
do-bigdata flink resource --project-id {project_id} --job-id {job_id} --query "<用户原始问题>"

# 查看告警配置
do-bigdata flink alarm --project-id {project_id} --job-id {job_id} --query "<用户原始问题>"
```

### 参考文档

```bash
do-bigdata docs list --skill oceanus-job-management
do-bigdata docs show --skill oceanus-job-management --file oceanus_job_api.md
```

---

## 6. oceanus-file-management — Oceanus 文件管理

**适用场景**：用户需要管理 Oceanus 平台上的文件（JAR 包、依赖文件等），包括文件上传、列表查看、版本管理、函数/应用关联和迁移。

**触发关键词**：文件、JAR 包、依赖文件、文件版本、上传、下载、迁移、文件管理

### 核心能力

| 能力 | 说明 |
|------|------|
| 文件管理 | 文件上传/列表/详情/更新 |
| 版本管理 | 新增版本/列表/详情/更新/下载 |
| 关联管理 | 函数/应用关联视图、迁移函数/应用 |

### CLI 命令

| CLI 命令 | 说明 |
|---------|------|
| `do-bigdata flink file-list` | 查看文件列表 |
| `do-bigdata flink file-detail` | 查看文件详情 |
| `do-bigdata flink upload` | 上传文件 |
| `do-bigdata flink versions` | 查看文件版本列表 |

### 常用命令

```bash
# 查看文件列表
do-bigdata flink file-list --project-id {project_id} --query "<用户原始问题>"

# 查看文件详情
do-bigdata flink file-detail --project-id {project_id} --file-id {file_id} --query "<用户原始问题>"

# 查看文件版本列表
do-bigdata flink versions --project-id {project_id} --file-id {file_id} --query "<用户原始问题>"

# 上传文件
do-bigdata flink upload --project-id {project_id} --file-path /path/to/file.jar --query "<用户原始问题>"
```

### 参考文档

```bash
do-bigdata docs list --skill oceanus-file-management
do-bigdata docs show --skill oceanus-file-management --file oceanus_file_api.md
```

---

## 7. oceanus-metrics-query — Oceanus 监控指标查询

**适用场景**：用户需要查询 Oceanus 平台上 Flink 作业的监控指标，包括平台侧指标（Hermes）、StarRocks 历史指标（NGCP API）、Flink UI 指标。支持 Flink 1.7/1.9/1.13/1.15/2.1 多版本适配。

**触发关键词**：指标、监控、TPS、延迟、Checkpoint、背压、吞吐量、metrics、connector 指标、operator 指标、MQ 消费延迟、Flink UI 指标、Hermes、NGCP

### 核心能力

| 能力分类 | 说明 |
|---------|------|
| 平台侧指标（Hermes） | 作业指标、Connector 指标、Operator 指标、审计指标、Client 指标、告警数据、MQ Lag 趋势/分区排名/详情 |
| StarRocks 历史指标（NGCP） | Job/Node/Task/Operator 历史指标、Trace 事件、Checkpoint 事件、告警消息、阶段耗时、GC 综合分析 |
| Flink UI 指标 | 作业概览、算子列表、Task 详情、Checkpoint 统计/配置、TaskManager 概览、异常信息（多版本适配） |

### 常用命令

```bash
# 查询平台指标（Hermes）
do-bigdata flink hermes --action job_metrics --project-id {project_id} --job-id {job_id} --query "<用户原始问题>"

# 查询 StarRocks 历史指标（NGCP）
do-bigdata flink starrocks --action query_job --project-id {project_id} --job-id {job_id} --env oc2 --query "<用户原始问题>"

# 查询 Flink UI 指标
do-bigdata flink flink-ui --action job_overview --project-id {project_id} --job-id {job_id} --query "<用户原始问题>"

# 从 Oceanus URL 自动提取
do-bigdata flink hermes --action job_metrics --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops" --query "<用户原始问题>"
```

### 参考文档

```bash
do-bigdata docs list --skill oceanus-metrics-query
do-bigdata docs show --skill oceanus-metrics-query --file oceanus_metrics_api.md
do-bigdata docs show --skill oceanus-metrics-query --file flink_rest_api_reference.md
do-bigdata docs show --skill oceanus-metrics-query --file starrocks_metrics_reference.md
do-bigdata docs show --skill oceanus-metrics-query --file flink_metrics_analysis_guide.md
```

---

## 8. oceanus-project-management — Oceanus 项目管理

**适用场景**：用户需要管理 Oceanus 项目，包括查看项目列表、项目详情、创建项目、更新项目信息、管理项目成员。

**触发关键词**：查看项目、项目列表、创建项目、更新项目、项目成员、项目详情

### 核心能力

| 能力 | 说明 |
|------|------|
| 项目查询 | 项目列表（支持搜索）、项目详情 |
| 项目操作 | 创建项目、更新项目 |
| 成员管理 | 查看项目成员列表 |

### CLI 命令

| CLI 命令 | 说明 |
|---------|------|
| `do-bigdata flink project-list` | 项目列表（支持 `--keyword` 搜索） |
| `do-bigdata flink project-detail` | 项目详情（需 `--project-id`） |
| `do-bigdata flink project-create` | 创建项目（需 `--name` + `--description`） |
| `do-bigdata flink members` | 项目成员（需 `--project-id`） |

### 常用命令

```bash
# 查看项目列表
do-bigdata flink project-list --query "<用户原始问题>"

# 搜索项目
do-bigdata flink project-list --keyword "AMS" --query "<用户原始问题>"

# 查看项目详情
do-bigdata flink project-detail --project-id 11145 --query "<用户原始问题>"

# 查看项目成员
do-bigdata flink members --project-id 11145 --query "<用户原始问题>"

# 创建项目
do-bigdata flink project-create --name "my_project" --description "desc" --query "<用户原始问题>"
```

### 参考文档

```bash
do-bigdata docs list --skill oceanus-project-management
do-bigdata docs show --skill oceanus-project-management --file oceanus_project_api.md
```

---

## 9. oceanus-resource-management — Oceanus 资源管理

**适用场景**：用户需要管理 Oceanus 平台的库表（Connector/Schema）和函数（UDF），包括创建、查看、更新，以及版本管理和关联作业查询。

**触发关键词**：库表、函数、connector、schema、UDF、table、function、资源管理、元数据

### 核心能力

| 能力分类 | 说明 |
|---------|------|
| 库表管理 | 列表查询、详情查看、创建/更新、版本列表、关联作业 |
| 函数管理 | 列表查询、详情查看、创建/更新、版本列表、关联作业 |

### CLI 命令

| CLI 命令 | 说明 |
|---------|------|
| `do-bigdata flink table-list` | 查看库表列表 |
| `do-bigdata flink table-detail` | 查看库表详情 |
| `do-bigdata flink function-list` | 查看函数列表 |
| `do-bigdata flink function-detail` | 查看函数详情 |

### 常用命令

```bash
# 查看库表列表
do-bigdata flink table-list --project-id {project_id} --query "<用户原始问题>"

# 查看库表详情
do-bigdata flink table-detail --project-id {project_id} --resource-id {table_id} --query "<用户原始问题>"

# 查看函数列表
do-bigdata flink function-list --project-id {project_id} --query "<用户原始问题>"

# 查看函数详情
do-bigdata flink function-detail --project-id {project_id} --resource-id {function_id} --query "<用户原始问题>"
```

### 参考文档
— Oceanus 资源管理脚本
— Oceanus 资源管理 REST API 参考文档
```bash
do-bigdata docs list --skill oceanus-resource-management
do-bigdata docs show --skill oceanus-resource-management --file oceanus_resource_api.md
```

---

## 10. oceanus-knowledge — Oceanus 知识库检索

**适用场景**：用户提问 Oceanus 平台的**知识类**问题（使用方法、原理概念、最佳实践、配置说明、FAQ、入门指引、文档查找），且其他动手操作类 sub-skills 无法覆盖时。本 skill **不调用 CLI / 不调用 REST API**，仅通过 Knot MCP 检索 Oceanus 官方知识库。

**触发关键词**：Oceanus 文档、Oceanus 怎么用、Oceanus 是什么、如何配置、最佳实践、参数说明、FAQ、知识库、官方说明、原理、概念、入门、使用指引

**触发关键词（运维工具）**：告警屏蔽、批量重启、集群迁移、清理 checkpoint、清理 savepoint、触发 savepoint、垂直扩容、复制应用、查消费组、运维工具、智研工具

### 核心区分原则

> 其他 sub-skills 解决「**做什么 / 怎么做（动手操作）**」；
> 本 skill 解决「**是什么 / 为什么 / 应该怎么做（知识与原理）**」。

| 应路由到 | 用户场景 |
|---|---|
| `flink-yarn-perjob` | 诊断作业异常 / OOM / GC / Checkpoint 失败 / TM 容器问题 |
| `oceanus-log-analyzer` | 启动 / 编译 / 停止失败的日志分析 |
| `oceanus-job-list` | 查看作业列表 / 搜索作业 |
| `oceanus-metrics-query` | 监控指标 / TPS / 延迟 / 背压 |
| `oceanus-job-management` | 修改 / 启停作业 |
| `oceanus-resource-advisor` | 资源配额 / 集群资源 |
| `oceanus-resource-management` | 库表 / UDF 元数据 |
| **`oceanus-knowledge`** | **以上都不沾边、纯文档/原理类问题、运维工具查询（智研平台工具）** |

### MCP 配置

依赖 Knot MCP（已通过 IDE/Agent 的 MCP 配置注入），知识库 UUID 已固定为 Oceanus 知识库：

> 若 Knot MCP 未注册，告知用户接入上述配置（`<TOKEN>` 由用户填入个人 Knot API token）。

### 工作流

1. 按「核心区分原则」表判断是否走本 skill；属于动手类则路由到对应 sub-skill 后终止
2. 通过 Knot MCP 提供的检索工具（`knot_search` / `knot_query` / `knot_qa` 等，以实际注册名为准）查询用户问题
3. 整合答案并**标注来源**（每段引用都带文档标题或 URL）；未命中时坦诚告知，**禁止编造**

详见 `sub-skills/Flink/oceanus-knowledge/SKILL.md`。

### 运维工具参考

本 skill 同时维护了 Oceanus 智研运维平台（项目 ID: 542）的工具列表，涵盖 9 个分类共 78 个工具：

| 分类 | 典型工具 |
|---|---|
| 告警屏蔽类 | Oceanus 告警屏蔽、failover 告警屏蔽、ck 失败告警屏蔽 |
| 批量重启/启停类 | 批量重启、批量停止、修改集群批量重启 |
| 集群迁移类 | 迁移作业 Snapshots、应用组资源迁移、复制作业到新集群 |
| Checkpoint/Savepoint 类 | 清理 cp/sp、手动触发 savepoint、从指定 cp 恢复 |
| 作业管理类 | 复制应用、垂直扩容、版本升级、修改项目 |
| 诊断排查类 | 异常重启查看、指标查看、应用状态检查 |
| 日志与容器类 | 容器日志获取、jstack dump |
| 查询定位类 | 按消费组查应用、按 IP 查 application、按机器查任务 |
| 数据与元数据类 | 库表迁移、重置 tube offset |
| 机器与集群运维类 | zstd 版本、端口范围修改、权限修复 |

地址格式：`https://zhiyan.woa.com/operate/542/task/#/task/result/{ID}`

完整工具列表详见 `sub-skills/Flink/oceanus-knowledge/SKILL.md` 的「运维工具参考」章节。

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
