---
name: oceanus-log-analyzer
description: 仅当用户提到"启动失败"、"启动异常"、"启动错误"、"编译异常"、"编译失败"、"编译错误"、"停止中"、"停止失败"或"停止错误"时才调用此 skill。其他 Oceanus 相关请求（如查看作业状态、修改配置、资源调优、Checkpoint 分析等）不应触发此 skill。
---

## 概述

分析 Oceanus 平台上 Flink 流式作业的编译日志、启动日志和停止日志中的异常信息。通过 Oceanus REST API 自动获取日志内容，提取关键错误模式，给出诊断结论。

**核心诊断能力**：

1. **编译日志分析** — 获取作业构建阶段日志，检测编译错误、依赖缺失、构建失败等问题
2. **启动日志分析** — 获取作业启动阶段日志，检测 OOM、类加载失败、连接异常、资源不足等问题
3. **停止日志分析** — 获取作业停止阶段日志，检测 Checkpoint/Savepoint 失败、容器被杀、资源抢占等问题
4. **自动异常提取** — 从日志中自动提取 ERROR 级别日志、Exception 堆栈、关键 WARN 信息
5. **模式匹配诊断** — 基于 20+ 种常见异常模式自动识别问题类型并给出结论
6. **JAR 冲突检测** — 检测到 ClassNotFoundException、NoSuchMethodError 等异常时，自动提示排查文档和推荐依赖版本

## 触发条件

**仅在用户请求中包含以下关键词时才调用此 skill**：

- 启动失败 / 启动异常 / 启动错误
- 编译异常 / 编译失败 / 编译错误
- 停止中 / 停止失败 / 停止错误

**不触发的场景**（即使涉及 Oceanus 作业）：

- 查看作业状态、运行信息
- 修改作业配置、参数调优
- 资源调整、Checkpoint 配置

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 1: 确定分析类型

从用户请求中判断需要分析的日志类型：

| 用户需求 | 日志类型参数 |
|---------|------------|
| 编译失败/编译异常 | `--log-type compile` |
| 启动失败/启动异常 | `--log-type start` |
| 停止失败/停止异常 | `--log-type stop` |
| 不确定或要全面分析 | 默认分析所有日志 |

### Step 2: 执行日志分析

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

### Step 3: 解读输出结论

- `★ [编译日志结论] 发现异常` → 编译阶段存在问题，检查代码或依赖
- `★ [启动日志结论] 发现异常` → 启动阶段存在问题，检查配置或资源
- `★ [停止日志结论] 发现异常` → 停止阶段存在问题，检查 Checkpoint/Savepoint
- `★ [xxx结论] 正常` → 该阶段日志无异常

## 参考文档

```bash
do-bigdata docs list --skill oceanus-log-analyzer
do-bigdata docs show --skill oceanus-log-analyzer --file oceanus_log_api.md
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
