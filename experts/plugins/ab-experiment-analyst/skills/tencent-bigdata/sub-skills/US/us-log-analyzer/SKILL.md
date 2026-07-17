---
name: us-log-analyzer
description: "[内部共享资源库] 本 Skill 仅作为 us-slow-task-diagnose 和 us-fail-task-diagnose 的共享脚本和参考文档库，提供底层 CLI 查询命令和平台参考资料。同时承担脚本下载、WeData开发态日志查询、US视图查询、任务列表查询等独立场景。"
trigger: false
---

# US 日志分析器（共享资源库）

## 概述

本 Skill 仅作为 `us-fail-task-diagnose` 和 `us-slow-task-diagnose` 的**共享脚本和参考文档库**，不直接对用户触发。

- **CLI 命令**：通过 `do-bigdata us` 命令组提供查询能力
- **参考文档**：通过 `do-bigdata docs` 命令访问排障指南、错误码索引、平台使用指南等

## 不适用场景（Do NOT use）

以下场景**不应**路由到本 Skill，请使用对应的专用子技能：

- 任务失败原因诊断、错误日志分析 → 使用 `us-fail-task-diagnose`
- 任务慢/耗时异常/性能瓶颈定位 → 使用 `us-slow-task-diagnose`
- 创建任务/上传脚本/冻结解冻/补录/回溯/重跑等操作 → 使用 `us-operate-diagnose`
- 非 US 平台的问题（如 WeData 控制台操作、Flink 任务、Spark 任务） → 使用对应子系统 Skill

## 强制输出规则（铁律）

> **[WARN] 每次给用户输出查询结果、回答咨询、给出方案后，回复的最末尾必须附加以下内容（加粗高亮，不可省略）：**
>
> **[WARN] 如果US或WeData使用上有任何问题，可以直接联系 kimlinlin**
>
> 无论查询成功还是失败，无论是完整结果还是简短回复，都必须在最后一行输出此提示。

## 执行流程

当本 Skill 被其他子技能或路由规则调用时，按以下步骤执行：

1. **环境识别**：识别 namespace —— 链接含 `us-sg.woa.com` 或 `wedata-sg.woa.com` → namespace=sg；**用户明确声明"新加坡环境/SG 环境"等（即使未提供 SG 域名链接） → namespace=sg**；其他 → default。若链接域名与用户声明冲突（如声明 SG 但提供国内域名链接），以链接为准并提示用户确认。识别完毕后输出：`* 当前环境：国内（default）` 或 `* 当前环境：新加坡（sg）`
2. **确认场景**：判断是 CLI 命令调用、脚本下载还是参考文档查阅
3. **执行命令**：根据场景调用对应的 `do-bigdata us` 子命令（namespace=sg 时附加 `--skill-namespace sg`）
4. **结果解析**：解析命令输出，提取关键信息
5. **返回结果**：将解析后的结果返回给调用方或用户

## CLI 命令

**CMK 凭证**: 由 CLI 的 `@auth_required` 装饰器自动读取，首次使用通过 `do-bigdata auth init` 配置。

### WeData API 查询命令

封装 WeData OpenAPI，支持调度态和开发态的日志查询。

**支持的命令**:

| 命令 | 功能 | 适用模式 | 示例 |
|------|------|---------|------|
| `describe-log` | 查询实例运行日志（调度态） | 调度态 | `do-bigdata us describe-log --project-id <PID> --task-id <TID> --cur-run-date "YYYY-MM-DD HH:MM:SS" --query "查询日志"` |
| `describe-execution-records` | 查询开发态执行记录列表 | 开发态 | `do-bigdata us describe-execution-records --project-id <PID> --task-id <TID> --query "查询执行记录"` |
| `describe-execution-log` | 查询开发态执行日志 | 开发态 | `do-bigdata us describe-execution-log --project-id <PID> --job-id <JOB_ID> --query "查询执行日志"` |
| `describe-tasks` | 查询 WeData 项目下的任务列表 | 通用 | `do-bigdata us describe-tasks --project-id <PID> --query "查询任务列表"` |
| `describe-task-detail` | 查询 WeData 项目下指定任务的详细信息 | 通用 | `do-bigdata us describe-task-detail --task-id <TID> --query "查询任务详情"` |
| `download-file` | 下载 WeData 任务脚本文件 | 通用 | `do-bigdata us download-file --project-id <PID> --task-id <TID> --query "下载脚本"` |

**各命令参数详解**:

#### describe-log（调度态日志）

| 参数 | 必需 | 说明 |
|------|:---:|------|
| `--project-id` | [OK] | WeData 项目 ID |
| `--task-id` | [OK] | 任务 ID |
| `--cur-run-date` | [OK] | 数据时间，格式 `YYYY-MM-DD HH:MM:SS` |
| `--runtime-broker` | [FAIL] | 执行代理 IP |
| `--runtime-port` | [FAIL] | 执行代理端口 |
| `--log-time` | [FAIL] | 日志时间戳（毫秒） |
| `--log-run-num` | [FAIL] | 运行次数 |
| `--output-dir` | [FAIL] | 额外保存日志到指定目录 |
| `--raw` | [FAIL] | 输出原始 JSON |
| `--from-file` | [FAIL] | 从本地 JSON 文件加载（不调用 API） |
| `--no-cache` | [FAIL] | 禁用本地缓存，强制从 API 重新获取 |

#### describe-execution-records（开发态执行记录）

| 参数 | 必需 | 说明 |
|------|:---:|------|
| `--project-id` | [OK] | WeData 项目 ID |
| `--task-id` | [FAIL] | 按任务 ID 过滤 |
| `--job-id` | [FAIL] | 按执行 ID 过滤 |
| `--page-number` | [FAIL] | 页码（默认 1） |
| `--page-size` | [FAIL] | 每页条数（默认 20） |
| `--output-dir` | [FAIL] | 额外保存结果到指定目录 |
| `--raw` | [FAIL] | 输出原始 JSON |
| `--from-file` | [FAIL] | 从本地 JSON 文件加载 |
| `--no-cache` | [FAIL] | 禁用本地缓存 |

#### describe-execution-log（开发态执行日志）

| 参数 | 必需 | 说明 |
|------|:---:|------|
| `--project-id` | [OK] | WeData 项目 ID |
| `--job-id` | [OK] | 执行 ID（从 describe-execution-records 获取） |
| `--start-line` | [FAIL] | 开始行号（默认 0） |
| `--output-dir` | [FAIL] | 额外保存日志到指定目录 |
| `--raw` | [FAIL] | 输出原始 JSON |
| `--from-file` | [FAIL] | 从本地 JSON 文件加载 |
| `--no-cache` | [FAIL] | 禁用本地缓存 |

#### describe-tasks（WeData 项目任务列表查询）

> [WARN] **注意**：该接口只能查询 **WeData 项目**下的任务，`--project-id` 为必填参数。非 WeData 项目的任务无法通过此接口查询。

| 参数 | 必需 | 说明 |
|------|:---:|------|
| `--project-id` | [OK] | WeData 项目 ID（必填） |
| `--page-number` | [FAIL] | 页码（默认 1） |
| `--page-size` | [FAIL] | 每页条数，1~2000（默认 10） |
| `--task-ids` | [FAIL] | 任务 ID 列表，逗号分隔（精确匹配，最多 50 个） |
| `--task-name` | [FAIL] | 任务名称（模糊匹配） |
| `--task-type-list` | [FAIL] | 任务类型 ID 列表，逗号分隔，如 `10,23` |
| `--task-status-list` | [FAIL] | 任务状态列表，逗号分隔，如 `Y,O` |
| `--task-cycle-type-list` | [FAIL] | 周期类型列表，逗号分隔，如 `D,H` |
| `--owner-list` | [FAIL] | 负责人列表，逗号分隔（最多 10 个） |
| `--in-charge-list` | [FAIL] | 负责人+维护人列表，逗号分隔（最多 10 个） |
| `--create-time-from` | [FAIL] | 创建时间起始（格式 `yyyy-MM-dd HH:mm:ss`） |
| `--create-time-to` | [FAIL] | 创建时间结束（格式 `yyyy-MM-dd HH:mm:ss`） |
| `--last-update-time-from` | [FAIL] | 最后更新时间起始（格式 `yyyy-MM-dd HH:mm:ss`） |
| `--last-update-time-to` | [FAIL] | 最后更新时间结束（格式 `yyyy-MM-dd HH:mm:ss`） |

#### describe-task-detail（WeData 任务详情查询）

> [WARN] **注意**：该接口只能查询 **WeData 项目**下的任务详细信息，包括任务配置、调度参数、资源组、扩展配置等。需要提供任务 ID。

| 参数 | 必需 | 说明 |
|------|:---:|------|
| `--task-id` | [OK] | 任务 ID（必填） |

#### download-file（WeData 任务脚本下载）

> [WARN] **注意**：该接口只能用于 **WeData 项目**下的任务，`--project-id` 为必填参数。`FileId` 自动从任务详情的 `mainFile` 字段获取，无需手动指定。

**流程**：先调用 `DescribeTaskDetail` 获取任务的 `mainFile`（即 FileId），再调用 `DownloadFile` 接口下载文件内容。

| 参数 | 必需 | 说明 |
|------|:---:|------|
| `--project-id` | [OK] | WeData 项目 ID（必填） |
| `--task-id` | [OK] | 任务 ID（必填，用于获取 mainFile） |
| `--output-dir` | [FAIL] | 保存目录（默认当前目录） |

**通用功能**:
- **本地缓存**：首次 API 调用自动缓存，后续相同参数直接从缓存加载（使用 `--no-cache` 可强制刷新）
- **自动重试**：网络连接失败和服务端 5xx 错误自动重试最多 3 次，指数退避
- **限流保护**：内置请求间隔控制（100ms），避免触发 API 限流
- **错误处理**：自动检测 WeData API 错误响应，输出 Error Code、Error Message 和 Request ID

### US API 查询命令

封装 US 统一调度查询类 API，支持查询任务信息、实例状态、获取日志等。

**支持的命令**:

| 命令 | 功能 | 示例 |
|------|------|------|
| `check` | 查询任务是否存在 | `do-bigdata us check --task-id <ID> --query "检查任务"` |
| `query-task` | 查询任务配置信息 | `do-bigdata us query-task --task-id <ID> --query "查询任务配置"` |
| `query-run` | 查询实例状态 | `do-bigdata us query-run --task-id <ID> --start 2024-01-01 --end 2024-01-02 --query "查询实例"` |
| `log` | 获取实例执行日志（文本） | `do-bigdata us log --task-id <ID> --date 20240101000000 --query "获取日志"` |
| `log` (带定位参数) | 精准获取指定执行次数的日志 | `do-bigdata us log --task-id <ID> --date 20240101000000 --broker <IP> --log-time <TIME> --query "获取日志"` |
| `stage-log` | 获取实例结构化日志 | `do-bigdata us stage-log --task-id <ID> --date 20240101000000 --query "获取阶段日志"` |
| `stage-log` (带定位参数) | 精准获取指定执行次数的日志 | `do-bigdata us stage-log --task-id <ID> --date 20240101000000 --broker <IP> --log-time <TIME> --query "获取阶段日志"` |
| `original-log` | 从指定 broker 节点获取原始执行日志 | `do-bigdata us original-log --task-id <ID> --date 20240101000000 --broker <IP>-<PORT> --output-dir . --query "获取原始日志"` |
| `original-log` (带定位参数) | 精准获取指定执行的原始日志 | `do-bigdata us original-log --task-id <ID> --date 20240101000000 --broker <IP>-<PORT> --log-time <TIME> --life-cycle <NUM> --output-dir . --query "获取原始日志"` |
| `job-info` | 查询集群 Job ID | `do-bigdata us job-info --task-id <ID> --date 20240101000000 --query "查询job"` |
| `list-view` | 查询任务所属视图 | `do-bigdata us list-view --task-id <ID> --query "查询视图"` |
| `view-detail` | 查询视图详情（任务列表+依赖关系） | `do-bigdata us view-detail --view-id <ViewID> --query "查询视图详情"` |
| `relation` | 查询任务依赖关系 | `do-bigdata us relation --task-id <ID> --query "查询依赖"` |
| `change-log` | 查询任务变更记录 | `do-bigdata us change-log --task-id <ID> --query "查询变更"` |
| `redo-list` | 查询重跑明细（前台重跑子任务） | `do-bigdata us redo-list --command-id <CommandID> --query "查询重跑"` |
| `task-list` | 查询任务列表 | `do-bigdata us task-list --in-charge <user> --query "查询任务列表"` |
| `task-type-info` | 查询任务类型信息 | `do-bigdata us task-type-info --task-id <ID> --query "查询任务类型"` |

> [WARN] **`task-list` / `query-command` / `describe-tasks` 等命令的用户字段（`--in-charge` / `--setter` / `--owner-list` 等）意图识别规则**：
> - 用户说"**我的/我名下/我负责的**" → 先执行 `do-bigdata auth whoami` 拿到当前 CMK 用户的 RTX，再作为用户字段值传入（**不要不传，也不要依赖服务端兜底**）；
> - 用户说"**张三的/某 RTX 的**" → 传用户原话里给出的那个 RTX；
> - 用户说"**应用组/视图/表/任务 ID/项目下**"等按对象筛选 → **不传**任何用户字段；
> - [NO] **任何情况下都禁止**用 `$USER` / `$(whoami)` / `$LOGNAME` 作为用户字段值（shell 用户 ≠ CMK 用户）。
> - 详见 `references/us-task-list-api.md` 顶部"用户字段意图识别规则"。

### US 脚本管理命令

| 命令 | 功能 | 示例 |
|------|------|------|
| `script-versions` | 查询脚本版本信息（元数据） | `do-bigdata us script-versions --script-id <ScriptID> --query "查询版本"` |
| `script-view` | 查询脚本元数据信息（版本、上传者、路径等） | `do-bigdata us script-view --type py --tdw-groups g_teg_xxx --query "查询脚本"` |
| `download-script` | 下载单个脚本文件 | `do-bigdata us download-script --task-id <ID> --output-dir /tmp --query "下载脚本"` |
| `batch-download` | 批量下载应用组脚本（先获取元数据列表，再并发下载） | `do-bigdata us batch-download --type py --tdw-groups g_teg_xxx --output-dir /tmp/scripts --query "批量下载"` |

> **[WARN] 脚本下载接口选择策略（按任务类型路由）**：先判断任务类型，再选择对应的下载接口，**不要默认用 US 接口去下 WeData 任务**。
> 1. **纯 WeData 任务**（task ID 为 **17 位**）→ **必须**走 WeData 下载接口 `do-bigdata us download-file --project-id <PID> --task-id <TID>`（US 的 `download-script` 不支持纯 WeData 任务）；
> 2. **其他任务**（US 任务，task ID 为 **18 位**）→ 走 US 下载接口 `do-bigdata us download-script --task-id <ID>`；
> 3. **兜底降级**：当选用的接口下载失败（接口报错、脚本不存在等）时，可自动尝试另一种接口重试；两种方式都失败时，才向用户报告脚本下载失败。
>
> > [TIP] 任务类型判定：纯 WeData 任务 task ID 为 17 位；US 任务 task ID 为 18 位。`download-file` 需要 `--project-id`，**纯 WeData 任务也可通过 US 的 `query-task` 接口查询拿到 project-id（无需用户手动提供）**，因此下载时只要拿到 task ID 即可：先用 `query-task` 取回 project-id，再传入 `download-file`。
| `script-exist` | 检查脚本是否存在 | `do-bigdata us script-exist --type py --tdw-groups g_teg_xxx --file script.py --query "检查脚本"` |

### 批量下载应用组脚本

当用户需要**下载整个应用组的脚本**（如迁移、备份、审计等场景）时，使用 `batch-download` 命令。该命令自动完成「查询元数据 → 并发下载」的完整流程，内置接口限流保护（`/script/download` 限流 240次/min，实际使用 80% 即 192次/min），无需担心触发限流。

**参数说明**：

| 参数 | 必需 | 说明 |
|------|:---:|------|
| `--type` | [OK] | 脚本类型：`py`（PythonSQL）、`mr`（MapReduce/SparkScala/PySpark）、`pig`（PIG）、`hbase`（HBase） |
| `--tdw-groups` | py/pig 必需 | 应用组（多个逗号分隔） |
| `--task-id` | mr/hbase 必需 | 任务ID |
| `--script-name` | [FAIL] | 脚本名过滤（缩小下载范围，支持模糊匹配） |
| `--login-user` | [FAIL] | 按上传者过滤 |
| `--output-dir` | [FAIL] | 保存目录（默认以应用组名命名的子目录） |
| `--concurrency` | [FAIL] | 并发下载数（默认5） |

**使用示例**：

```bash
# 下载整个应用组的 PythonSQL 脚本
do-bigdata us batch-download --type py --tdw-groups g_teg_xxx --output-dir /tmp/scripts --query "批量下载脚本"

# 按脚本名关键词过滤下载
do-bigdata us batch-download --type py --tdw-groups g_teg_xxx --script-name keyword --query "下载脚本"

# 下载 MR/Spark 类型脚本（需用 task-id）
do-bigdata us batch-download --type mr --task-id 20200212210154263 --output-dir /tmp/scripts --query "下载脚本"

# 控制并发数（避免限流或减少服务端压力）
do-bigdata us batch-download --type py --tdw-groups g_teg_xxx --concurrency 3 --query "下载脚本"
```

**也可分步操作**（先查后下）：

```bash
# Step 1: 先用 script-view 查看脚本列表
do-bigdata us script-view --type py --tdw-groups g_teg_xxx --query "查看脚本列表"

# Step 2: 确认后，用 download-script 下载单个脚本
do-bigdata us download-script --task-id <ID> --output-dir /tmp/scripts --query "下载脚本"
```

### 凭证配置

凭证由 CLI 的 `@auth_required` 装饰器自动管理。首次使用通过 `do-bigdata auth init` 配置，支持三级 fallback（环境变量 → 加密文件 → 明文文件）。

**多地域凭证**：新加坡环境需要单独配置凭证：
```bash
# 国内凭证（默认）
do-bigdata auth init

# 新加坡凭证
do-bigdata auth init --namespace sg
```

CMK 密钥获取：
- 国内：https://wedata.woa.com/security/user/keys
- 新加坡：https://sg.security.tianqiong.woa.com/user/keys

## 参考文档

通过 `do-bigdata docs` 命令访问：

```bash
do-bigdata docs list --skill us-log-analyzer
do-bigdata docs show --skill us-log-analyzer --file <文件名>.md
```

**可用文档**：
- `troubleshooting-guide.md` — 按任务类型和失败阶段的详细排障流程，含任务责任人完整管理流程（新增/替换/离职交接/视图交接/依赖迁移）
- `common-errors.md` — 完整的错误码索引及解决方案，含 US 工具箱完整分类列表（调度运维/权限管理/配置迁移/数据库服务器/恢复删除/Shell插件/自助诊断）
- `us-user-guide.md` — US 平台使用指南：术语定义、权限管理（含HDFS路径权限申请流程）、任务规则、任务依赖（含虫洞依赖）、任务补录（含补录限制和长时间补录方法）、告警配置（含各周期超时告警案例表）、时间变量、系统冻结（含新冻结规则/SQL&Spark额外规则/权限异常冻结/长期等待父任务处理）、任务权限管理（含数据负责人/审批状态/平台运行账号）、实例重跑（含自依赖选项组合详细说明）、视图管理、移动端功能
- `us-task-types.md` — US 任务类型配置指南：公共配置、数据出库（MySQL/HDFS/PG/ClickHouse/HBase/Doris）、数据入库（HDFS/Flink/HBase）、数据计算（PythonSQL/PySpark/Spark/SQL/MapReduce）、数据同步（MySQL→HDFS/PG→HDFS/HDFS→HDFS）、数据校验、其他（Shell脚本/滚动分区）。PySpark部分含完整的自定义Python环境配置指南
- `closed-domain-guide.md` — 封闭域（Close Domain）使用指南：硬性规则、各BG集群地址、Spark/MR参数配置、封闭域出库流程、iDex注意事项、readOnly排查、资源扩容、联系方式
- `us-api-identification.md` — US API 前缀识别规则（强制）：US API 识别特征（域名/路径前缀/路径风格）、非 US API 常见误判场景（tRPC/gRPC 等）、遇到非 US API 时的标准回复模板
- `gaia-clusters.md` — Gaia 集群 ID 与名称映射表：包含 300+ 集群的 ID、名称、Gaia 名字对应关系
- `notebook-runner-guide.md` — WeData Notebook 一键转调度（NotebookRunner）使用指南：功能简介、NotebookRunner与PySpark对比、操作流程（发起例行化/运维/删除）、调度时间获取（task_time全局变量/${YYYYMMDD}变量替换/TASK_TIME_PATTERN环境变量/TASK_DATA_TIME默认时间戳）、自定义参数传入（模版参数/环境变量）、thive分区表剪枝建议
- `us-faq.md` — US 常见问题（FAQ）
- `tdw-sql-common-issues.md` — TDW SQL 常见问题汇总
- `mysql-sync-ip-whitelist.md` — MySQL 同步 IP 白名单授权指南：WeData 离线同步场景下 MySQL 作为源端/目标端时需要授权的 IP 列表、按同步模式（Cluster/Local）和写入模式（append/truncate）的权限授权说明，同样适用于 WeData 离线同步

> **[WARN] 如果US或WeData使用上有任何问题，可以直接联系 kimlinlin**

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
