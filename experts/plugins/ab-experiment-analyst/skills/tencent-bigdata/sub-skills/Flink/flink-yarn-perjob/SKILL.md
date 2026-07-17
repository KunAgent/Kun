---
name: flink-yarn-perjob
description: 当用户需要诊断作业异常、分析、异常分析、异常重启、异常时使用此 skill。支持获取作业异常信息、TaskManager 心跳超时时自动分析 GC 日志判断是否存在频繁 Full GC、OOM、通过运行时指标分析 Checkpoint 失败原因。兼容 Flink 1.7 及更新版本。所有输出为中文，适合终端阅读。
---

## 概述

诊断运行在 YARN per-job 模式下的 Apache Flink 作业异常。per-job 模式下（`flink run -m yarn-cluster` 或 `-t yarn-per-job`），每个 Flink 作业作为独立的 YARN Application 运行，Flink UI 通过 YARN ResourceManager 代理访问。

**版本兼容性**: 支持 Flink 1.7+，自动处理不同版本的 API 差异（字段名、端点可用性等）。

**核心诊断能力**：

1. **异常信息获取** — 通过 Flink REST API 获取作业级别异常（root exception + per-task exceptions）
2. **JobManager GC/OOM 分析（默认启用）** — 分析 JobManager（AM 容器）的 GC 日志和 jobmanager.log，判断是否存在频繁 Full GC 和 OOM，**给出明确结论**（可通过 `--no-analyze-jm-gc` 禁用）
3. **心跳超时 GC 分析** — 当且仅当异常中包含 `Heartbeat of TaskManager with id ... timed out` 时，自动获取该容器的 taskmanager.gc 文件，分析是否存在频繁 Full GC，**给出明确结论**
4. **心跳超时 OOM 检测** — 当且仅当异常中包含心跳超时时，分析该容器的 taskmanager.log 是否存在 OutOfMemoryError，**给出明确结论**
5. **不分析无关日志** — 若异常中无心跳超时，则不分析 TaskManager 的 GC 和日志
6. **不活跃 TM 日志获取** — 对于已不在活跃列表中的 TM（容器已被 YARN 回收），通过 NodeManager REST API 获取容器日志进行分析；若 NM 不可达（如 DevCloud 环境无法访问 IDC），可回退到 MCP (yarn_mcp) RESTful API 获取日志
7. **Checkpoint 失败分析** — 通过运行时指标（`/jobs/:jobid/checkpoints`）分析 Checkpoint 失败原因，包括超时、对齐耗时过长、状态过大、Task 失败等
8. **NoResourceAvailableException 诊断** — 当检测到 `Slot request bulk is not fulfillable` 异常时，自动搜索 JobManager 日志中未注册的 Worker 容器，获取这些容器所在的机器，并检查机器是否有故障单
9. **非运行状态日志分析** — 当 Oceanus 应用状态非 RUNNING 时（如 FAILED、STOPPED、STOPPING、CANCELLING 等），自动通过 Oceanus API 获取启动日志（startlog）和停止日志（stoplog），输出日志内容并检测关键错误模式（Exception、OOM、ClassNotFound、连接失败、YARN Kill、Savepoint 失败、停止超时、TaskManager 丢失等），辅助定位启动和停止阶段的问题原因

## 支持的 Oceanus 环境

支持通过 URL 自动识别以下 Oceanus 环境，用户可直接粘贴作业链接：

| 环境标识 | 域名 | 示例 URL |
|----------|------|----------|
| `pub_oceanus2.0` | `oceanus.woa.com` | `https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops` |
| `pcg_new_oceanus2.0` | `oceanus-pcg-new.woa.com` | `https://oceanus-pcg-new.woa.com/#/task/streaming/detail/{project_id}/{job_id}/edit` |
| `pcg_oceanus2.0` | `oceanus-pcg.woa.com` | `https://oceanus-pcg.woa.com/#/task/streaming/detail/{project_id}/{job_id}/edit` |
| `fit_oceanus2.0` | `oceanus-fit.woa.com` | `https://oceanus-fit.woa.com/#/task/streaming/detail/{project_id}/{job_id}/edit` |
| `pre_oceanus2.0` | `oceanus-pre.woa.com` | `https://oceanus-pre.woa.com/#/task/streaming/detail/{project_id}/{job_id}/edit` |
| `pub_oceanus1.0` | `oceanus1.woa.com` | `https://oceanus1.woa.com/#/task/streaming/detail/{job_id}/view` |
| `sg_oceanus2.0` | `oceanus-sg.woa.com` | `https://oceanus-sg.woa.com/#/task/streaming/detail/{project_id}/{job_id}/edit` |
| `sg_oceanus1.0` | `oceanus1-sg.woa.com` | `https://oceanus1-sg.woa.com/#/task/streaming/detail/{job_id}/view` |
| `wxgpay_oceanus2.0` | `oceanus-wxgpay.woa.com` | `https://oceanus-wxgpay.woa.com/#/task/streaming/detail/{project_id}/{job_id}/edit` |

> **重要**: 所有接口调用均使用 **HTTP 直连**，不使用 SSL/HTTPS。脚本会自动将域名 DNS 解析为内网 IP 并通过 HTTP 直连访问，绕过 OA 网关和 SSL 证书问题。

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 1: 确定用户需求

根据用户的描述判断需要执行的诊断类型：

| 用户需求 | 对应 CLI 命令 | 需要参数 |
|---------|-------------|---------|
| 诊断作业异常（心跳超时、GC、OOM） | `do-bigdata flink diag` | Flink URL 或 Oceanus URL 或作业名称 |
| 分析 Checkpoint 失败 | `do-bigdata flink checkpoint` | Flink URL 或 Oceanus URL |
| 定向诊断单个峰峦 TM 容器日志（按容器名） | `do-bigdata flink tm-log` | TM 容器名 + redirect URL 或 Oceanus URL；可选关键字 |

如果用户未提供 Flink URL、Oceanus URL 或作业名称，**先向用户询问**。

### Step 2: 执行诊断

#### 异常诊断

```bash
# 通过 Flink URL 诊断（推荐）
do-bigdata flink diag --flink-url http://<rm-host>:<port>/proxy/<application-id> --query "<用户原始问题>"

# 通过 Oceanus URL 自动发现
do-bigdata flink diag --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops" --query "<用户原始问题>"

# 通过作业名称搜索并诊断（全局模糊匹配，精确匹配优先）
do-bigdata flink diag --job-name "{job-name}" --query "<用户原始问题>"

# 通过作业名称 + 指定启动时间
do-bigdata flink diag --job-name "{job-name}" --start-time "YYYY-MM-DD HH:MM:SS" --query "<用户原始问题>"

# 通过 Oceanus URL + 指定启动时间（精确定位重试多次的某一次执行）
do-bigdata flink diag --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops" --start-time "YYYY-MM-DD HH:MM:SS" --query "<用户原始问题>"

# 通过 YARN RM 自动发现
do-bigdata flink diag --rm-url http://<rm-host>:8088 --app-id <application-id> --query "<用户原始问题>"

# 禁用 JobManager GC/OOM 分析
do-bigdata flink diag --flink-url http://<rm-host>:<port>/proxy/<application-id> --no-analyze-jm-gc --query "<用户原始问题>"

# 关键字过滤（在每个 JM/TM 的 ERROR 抽取后附加命中记录块，支持多次叠加）
do-bigdata flink diag --oceanus-url "..." --keyword "TRPCInstance.start" --keyword "polaris" --query "<用户原始问题>"

# NM 不可达时通过 MCP 回退获取不活跃 TM 日志
do-bigdata flink diag --flink-url http://<rm-host>:<port>/proxy/<application-id> --mcp-url http://mcp-host:8080 --query "<用户原始问题>"
```

> **`--keyword` 参数说明**：可多次叠加（OR 命中），关键字会**透传给 MCP service 端**做过滤，
> 输出中每个 JM/TM 段后会额外打印「★ 关键字 [...] 命中 N 行 / M 个记录块」。
> 命中段块按时间戳行去重并附上下文，每个 TM 默认展示前 5 个，更多请用 `flink tm-log --keyword`。

> **`--job-name` 参数说明**：当用户提供作业名称（而非 URL）时，Agent 必须传递该参数。
> CLI 会通过 `/api/v2/jobs?keyword={job_name}` 全局搜索作业，精确匹配优先，
> 找到后自动构造 Oceanus URL 进入诊断流程。可与 `--start-time` 组合使用。

> **`--start-time` 参数说明**：当用户给出「启动时间」时，Agent 必须传递该参数。格式为 `"YYYY-MM-DD HH:MM:SS"`。
> CLI 会从 Oceanus executions 列表中匹配 `startTime` 最接近的那一次执行（容忍 ±120s），
> 用对应的 Flink URL 进行诊断。适用于"作业重试多次，需要定位某次具体启动"的场景。
> **同时支持 `--flink-url` 传入 oceanus URL 的场景**（CLI 自动识别并走 Oceanus 发现流程）。

#### Checkpoint 失败分析

```bash
# 分析 Checkpoint 失败
do-bigdata flink checkpoint --flink-url http://<rm-host>:<port>/proxy/<application-id> --query "<用户原始问题>"

# 通过 Oceanus URL
do-bigdata flink checkpoint --oceanus-url "https://oceanus.woa.com/#/task/streaming/detail/{project_id}/{job_id}/ops" --query "<用户原始问题>"
```

#### 单 TM 容器日志定向诊断（峰峦 K8s 任务）

适用于「已知具体 TM 容器名或归档日志 URL，需要**仅诊断该 TM 一个容器**（不遍历整作业其他 TM）」的场景。比 `flink diag` 更精准，跳过整体作业扫描。

**默认采集分析三类文件**（无需额外参数；仅针对目标 TM）：

| 文件 | 用途 |
|---|---|
| `taskmanager.log` | 业务异常 + Caused by 链 + 关键字过滤（service 端过滤，客户端兜底） |
| `taskmanager.out` | 容器层信号：OOMKilled / JVM crash / Native crash / Stderr |
| `taskmanager.gc_log.0~N.current` | 自动列举所有 GC 轮转文件并合并分析，输出 ★ Full GC 结论 |

**四种入参模式**（按精准度递增）：

```bash
# 1) 最精准：直接传完整归档日志 URL（仅拉该文件，跳过 platforms 解析）
do-bigdata flink tm-log \
    --log-url 'http://<gw>:8081/logs/<host>/<uuid>/flink-main-container/taskmanager.log?jobID=...&podName=oceanus-job-{job_id}-{exec}-taskmanager-1-12&tenantCluster=...' \
    --query "<用户原始问题>"

# 2) 最简（推荐）：仅传 --tm-id，CLI 自动解析 job_id + 反查 execution 对应的 redirect/platforms URL
do-bigdata flink tm-log --tm-id 'oceanus-job-{job_id}-{execution}-taskmanager-1-5' --query "..."

# 3) 叠加用户关键字过滤（service 端过滤，按时间戳行去重；旧版 MCP 自动兜底走客户端过滤）
do-bigdata flink tm-log --tm-id 'oceanus-job-{job_id}-2-taskmanager-1-5' \
    --keyword "TRPCInstance.start" --keyword "polaris" --query "..."

# 4) 已知 redirect URL（跳过反查 execution）
do-bigdata flink tm-log --tm-id '...' \
    --fengluan-url 'http://<gw>/redirect/<base64>' --query "..."

# 5) 切换 Oceanus 环境
do-bigdata flink tm-log --tm-id '...' --env pcg_oceanus2.0 --query "..."
```

> **关键参数**：
> - `--tm-id`：TM 容器名，格式 `oceanus-job-<job_id>-<execution>-taskmanager-<g>-<i>`，CLI 自动解析 `job_id` 与 `execution`；传 `--log-url` 时可省略
> - `--log-url`：完整归档日志文件 URL（最精准，直接定位单文件，跳过 platforms 解析与全 TM 遍历）
> - `--env`：Oceanus 环境名/域名，默认 `oceanus.woa.com`
> - `--keyword`（可多次叠加）：用户关键字过滤，命中行带前后上下文展示，自动以时间戳行去重
> - `--max-lines` / `--max-errors`：控制拉取规模，避免大日志超时
> - `--include-out`：（已默认启用）附加扫描 `taskmanager.out`，保留参数仅作向后兼容

> **execution 一致性校验 + 自动切换**（关键能力）：
> CLI 会主动比较 `--tm-id` 中的 execution 与 redirect URL 中的 execution。
> 若不一致（典型场景：作业已重启，旧 execution 容器已回收），会**自动从 Oceanus executions 列表反查目标 execution 的 platforms URL**，
> 命中后透明切换到「已停止」流程，**仅诊断目标 TM**（解析 platforms → 在 pods 列表中精确匹配 tm-id → 仅拉该 TM 的日志，不遍历其他）。
> 反查失败时阻断并给出手动建议：① 改用当前活跃 execution 的等价容器名重试；② 改走 `flink diag --start-time '...'` 查询历史 execution。

> **ERROR 抽取智能裁剪**：
> 对于 `switched ... to FAILED` 这类长 message + 长堆栈的事件（典型如 KafkaWriter task FAILED），
> 自动检测 `failure cause:` / `with Exception` / `Caused by` 锚点，把头部 logger meta 裁掉，**优先保留**完整 `Caused by` 链（最多 8 行）。
> 避免 message 头部 300 字被 logger meta（subtask 名、Class.method 等）耗尽导致 Caused by 被截断。

> **已知噪声自动过滤**：
> service 端 `_DEFAULT_NOISE_PATTERNS` + CLI 端 `_extract_business_root_causes.noise_msg_patterns` 双层屏蔽：
> ① TDBank `BusConfigManager.requestConfiguration` 配置中心（SDK 自带容灾）
> ② Flink `FatalExitExceptionHandler.uncaughtException` / TaskExecutor / TaskManager 的 fatal 兜底声明
> ③ HDFS `dfsFailoverCache` 镜像缺目录
> ④ ClassLoader 隔离冲突的「幻影异常」`IllegalArgumentException: Expecting FormatMetricGroup, but got org.apache.flink.formats.metrics.FormatMetricGroup`（同名 FQCN 双加载）

### Step 3: 解读输出结论

命令输出包含格式化的诊断结论，分析时关注以下要点：

**异常诊断结论**：
- `★ [GC 结论] 存在频繁 Full GC` → 建议增大堆内存或调优 GC 参数
- `★ [GC 结论] 未发现频繁 Full GC` → 排除 GC 原因，排查网络或资源抢占
- `★ [OOM 结论] 存在 OOM` → 堆内存不足，需增大 TM 内存
- `★ [OOM 结论] 未发现 OOM` → 排除内存溢出
- `★ [JM GC 结论] 存在频繁 Full GC` → 建议增大 JobManager 堆内存
- `★ [JM OOM 结论] 存在 OOM` → JobManager 内存不足，需增大 JM 内存

**Checkpoint 失败分析**：
- 诊断 6 类失败原因：超时、Task 失败、被取代/取消、存储写入失败、Coordinator 异常、数据倾斜/反压
- 给出针对性优化建议

### NoResourceAvailableException 诊断

当异常中包含 `NoResourceAvailableException: Slot request bulk is not fulfillable` 时，自动执行：

1. 搜索 JobManager 日志中未注册的 Worker 容器
2. 获取容器所在节点
3. 检查节点故障单

**可能原因**：节点故障/负载过高、网络问题、TM 启动 OOM、资源被抢占

### NoResourceAvailableException 诊断工作流

当异常中包含 `NoResourceAvailableException: Slot request bulk is not fulfillable` 时，自动执行以下诊断流程：

1. **检测异常** — 扫描 root-exception 和 all-exceptions 是否包含 `Slot request bulk is not fulfillable`
2. **获取 JobManager 日志** — 优先通过 Flink REST API，失败则通过 MCP 获取
3. **搜索未注册的 Worker** — 在 JM 日志中搜索关键字 `Worker container_xxx did not register in xxx ms`
4. **获取容器所在节点** — 通过 YARN RM API 或 MCP 查询未注册容器分配到的机器
5. **检查节点故障单** — 通过 xray + xwork 接口检查节点是否存在硬件故障或维修工单
6. **输出诊断结论** — 列出所有未注册的容器、所在节点、故障单状态，并给出可能原因和建议

**可能原因**：
- 容器分配到的节点存在故障或负载过高
- 节点网络问题导致 TaskManager 无法与 JobManager 通信
- TaskManager 启动过程中 OOM 或其他异常退出
- YARN 资源分配后节点资源被抢占

**建议操作**：
- 检查未注册容器所在节点的故障单和健康状态
- 查看 YARN NodeManager 日志确认容器启动情况
- 适当增加 Slot 请求超时时间 (`slot.request.timeout`)
- 检查集群资源是否充足，考虑申请更多资源

### 不活跃 TM 日志获取流程

当心跳超时的 TM 已不在 Flink 活跃列表中时：

1. **优先 NodeManager 直连**：通过 NodeManager REST API 获取容器日志
2. **MCP 回退**（当 NM 不可达时）：若指定了 `--mcp-url`，自动回退到 MCP (yarn_mcp) RESTful API

## 参考文档

```bash
do-bigdata docs list --skill flink-yarn-perjob
do-bigdata docs show --skill flink-yarn-perjob --file yarn_flink_api.md
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
