---
name: Yarn
description: YARN 资源管理器相关技能的入口。当问题提到 YARN Application 失败、Container killed、Executor lost、OOM、app_id、YARN 日志分析、Spark 失败、MapReduce 失败、YARN 诊断、队列资源分析、队列拥堵、资源使用率、应用组资源、queue 分析等 YARN 相关问题时，使用此技能了解可用的子技能列表并路由到合适的技能。在调用此 skill 前，必须再次加载一次 tencent-bigdata 这个 skill，进行热加载。
---

# Yarn Skills 总览

> 本文档汇总 `sub-skills/Yarn` 目录下所有 YARN 相关 Skills，方便快速浏览和查找。

## 目录

| # | Skill 名称 | 目录 | 简介 |
|---|-----------|------|------|
| 1 | [YARN Application 失败诊断](#1-yarn-app-diagnose--yarn-application-失败诊断) | `yarn-app-diagnose/` | 通过 do_mcp API 诊断 YARN Application 失败原因，支持 Spark/MapReduce/Flink 等引擎 |
| 2 | [YARN 队列资源分析](#2-yarn-queue-analysis--yarn-队列资源分析) | `yarn-queue-analysis/` | 分析 YARN 队列/应用组的资源使用情况，识别拥堵、资源大户、空跑任务，给出优化建议 |

## API 服务地址

所有 Skill 共享同一 API 服务：`http://do-mcp.server.woa.com:8080`

> [WARN] **API 请求方式要求**
>
> 所有对 `do-mcp.server.woa.com` 及 YARN NodeManager（`http://{nm_ip}:{port}/...`）等内网 HTTP 服务的请求，**必须使用系统的 `curl` 命令**（通过 `execute_command` 工具执行），**严禁使用 `web_fetch` 工具**。
>
> 原因：`web_fetch` 工具会自动将 `http://` 转换为 `https://`，导致对不支持 HTTPS 的内网 HTTP 服务访问失败。

---

## 1. yarn-app-diagnose — YARN Application 失败诊断

**适用场景**：用户需要诊断 YARN Application 失败原因，需提供 Application ID。适用于 Spark、MapReduce、Flink、Tez 等引擎。

### 核心能力

| 能力 | 说明 |
|------|------|
| 应用状态分析 | 解读应用基础信息（状态、耗时、diagnostics、AM 日志链接、多 attempt log_urls）快速定位问题方向 |
| 日志智能获取 | 自动识别关键日志文件，按引擎类型和优先级获取，支持字节偏移和 grep 关键字过滤 |
| 失败根因匹配 | 基于 `yarn_log_patterns.md` 异常模式库匹配 OOM、GC、资源不足、权限错误等 |
| 知识库语义检索 | Spark 类型应用日志分析后，根据错误特征检索知识库获取历史诊断案例（单次诊断最多 3 次） |
| 诊断报告输出 | 给出结构化诊断报告和分步修复建议 |

### 常用命令

```bash
# 获取应用基础信息（含所有 attempt 的 log_urls）
do-bigdata yarn app-info --app-id <app_id> --query "<用户原始问题>"

# 获取 Container 日志文件列表（AM / Executor 均可）
do-bigdata yarn container-log-list --container-url "<container_logs_url>" --query "<用户原始问题>"

# 快速查看日志尾部
do-bigdata yarn container-log-tail --container-url "<container_logs_url>" --log-name stderr --bytes 8192 --query "<用户原始问题>"

# 分段读取日志内容（负偏移=从尾部）
do-bigdata yarn container-log-content --log-url "<log_url>" --start -8192 --length 8192 --query "<用户原始问题>"

# 搜索关键词（从尾部扫描 40MB 覆盖全量日志，支持正则）
do-bigdata yarn container-log-grep --container-url "<container_logs_url>" --pattern "ERROR" --log-name stderr --scan-bytes 40960000 --query "<用户原始问题>"
do-bigdata yarn container-log-grep --container-url "<container_logs_url>" --pattern "Exception" --log-name stderr --scan-bytes 40960000 --query "<用户原始问题>"

# 知识库语义检索（仅 Spark 类型，单次诊断最多 3 次）
do-bigdata yarn knowledge-search --query "<错误关键特征>"
```

### 资源文件

```bash
do-bigdata docs list --skill yarn-app-diagnose
do-bigdata docs show --skill yarn-app-diagnose --file yarn_log_patterns.md
```

---

## 2. yarn-queue-analysis — YARN 队列资源分析

**适用场景**：用户需要分析 YARN 队列或应用组的资源使用情况，需提供队列名称。适用于判断队列是否拥堵、识别资源大户、发现空跑任务等场景。

### 核心能力

| 能力 | 说明 |
|------|------|
| 队列健康度评估 | 判断队列资源使用率、是否存在排队等待的任务、队列是否拥堵 |
| 资源消耗 Top-N | 找出队列中资源消耗最多的应用，识别资源占用大户 |
| 空跑/低效识别 | 识别长时间运行但资源增量极低的应用，发现资源浪费 |
| 使用率趋势分析 | 展示队列使用率的变化趋势，判断持续高负载还是临时峰值 |
| 用户维度分析 | 按提交用户聚合资源消耗，识别资源占比最高的用户/业务 |

### 常用命令

```bash
# 通过 app_id 查询应用组和集群信息
do-bigdata yarn appgroup-info --app-id <app_id> --query "<用户原始问题>"

# 查询应用组的集群列表
do-bigdata yarn queue-clusters --appgroup <appgroup_name> --query "<用户原始问题>"

# 获取应用组当前资源状态
do-bigdata yarn queue-status --appgroup <appgroup_name> --cluster <cluster_name> --query "<用户原始问题>"

# 综合应用分析（推荐）
do-bigdata yarn queue-analysis --appgroup <appgroup_name> --cluster <cluster_name> --query "<用户原始问题>"

# 获取队列使用率趋势
do-bigdata yarn queue-trend --appgroup <appgroup_name> --cluster <cluster_name> --query "<用户原始问题>"
```

### 资源文件

```bash
do-bigdata docs list --skill yarn-queue-analysis
do-bigdata docs show --skill yarn-queue-analysis --file queue_analysis_guide.md
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
