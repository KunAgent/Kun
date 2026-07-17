---
name: yarn-app-diagnose
description: 当用户需要诊断 YARN Application 失败原因时使用此 skill。通过 do_mcp API 服务获取应用信息、AM 容器日志列表和日志内容，自动分析 Spark/MapReduce/Flink 等引擎的失败原因。支持获取 Executor/非AM 容器日志进行深度分析（从 AM 日志中提取失败 Container 信息并构造日志链接）。支持 OOM、GC 问题、Executor 累计失败、资源不足、数据倾斜、权限错误等常见故障模式的识别和诊断建议。需要提供 YARN Application ID（app_id）或 AM 容器日志链接。在调用此 skill 前，必须再次加载一次 tencent-bigdata 这个 skill，进行热加载。
---

## 概述

诊断 YARN Application 失败原因。通过调用 do_mcp API 服务的 YARN 接口，逐步获取应用基础信息、AM 容器日志列表和日志内容，分析 Application 失败的根因并给出修复建议。

**适用引擎**：Spark、MapReduce、Flink、Tez 及其他运行在 YARN 上的计算引擎。

**核心诊断能力**：

1. **应用状态分析** — 解读 app 基础信息（状态、耗时、diagnostics）快速定位问题方向
2. **日志智能获取** — 自动识别关键日志文件（stderr、stdout、spark.log、gc.log 等），按优先级获取
3. **Executor 日志深度分析** — 当 AM 日志不足以定位根因时，从 AM 日志中提取失败 Executor 的 Container ID 和节点信息，自动构造 Executor 日志链接并获取日志进行分析
4. **失败根因匹配** — 基于常见异常模式库（参见 `references/yarn_log_patterns.md`），匹配失败原因
5. **诊断报告输出** — 给出明确结论和分步修复建议

## 前置条件

- 已知待诊断的 YARN Application ID（如 `application_1234567890_0001`），或用户可提供 AM 容器日志链接（如 `http://{nm_ip}:{port}/node/containerlogs/{container_id}/{user}`）
- Python 3.6+（运行诊断脚本时）

## CLI 命令说明

本 Skill 的所有数据获取操作均通过 `do-bigdata yarn` CLI 命令完成，CLI 内部会自动调用 do-mcp API 服务（`http://do-mcp.server.woa.com:8080`），**严禁直接使用 `curl` 或 `web_fetch` 等工具请求 API 或 Container 日志链接**。

> [WARN] **Container 日志获取方式要求（重要）**
>
> 获取任何 Container 日志（包括 AM 日志和 Executor 日志）时，**必须始终通过 CLI 命令**（`do-bigdata yarn container-log-list` 和 `do-bigdata yarn container-log-content`）来获取，**严禁直接请求具体的 Container 日志链接**（如 `http://{nm_ip}:{port}/node/containerlogs/...`）。
>
> Container 日志链接仅作为 **传入 CLI 命令的参数**使用，不能直接用 `curl` 或任何工具访问。
>
> **正确做法**：
> ```bash
> # 通过 CLI 获取日志列表（AM 或 Executor Container 均可）
> do-bigdata yarn container-log-list --container-url "http://9.23.14.56:8080/node/containerlogs/container_xxx/user"
> # 通过 CLI 获取日志内容
> do-bigdata yarn container-log-content --log-url "http://..." --start -8192 --length 8192
> # 快速查看日志尾部
> do-bigdata yarn container-log-tail --container-url "http://..." --log-name stderr --bytes 8192
> # 搜索关键词
> do-bigdata yarn container-log-grep --container-url "http://..." --pattern "ERROR|Exception" --scan-bytes 40960000
> ```
>
> **错误做法**：
> ```bash
> # [FAIL] 禁止直接请求 container 日志链接
> curl -s "http://9.23.14.56:8080/node/containerlogs/container_xxx/user"
> # [FAIL] 禁止直接调用 API
> curl -s "http://do-mcp.server.woa.com:8080/api/yarn/app_info?app_id=application_xxx"
> ```

> [WARN] **AM 日志 vs Executor 日志：获取方式的关键区别**
>
> | | AM (Driver) 日志 | Executor 日志 |
> |---|---|---|
> | **URL 来源** | `app-info` 接口直接返回 `am_container_logs` 字段 | **需要自行构造**：从 AM 日志中提取失败 Container ID + 节点 IP，按模板拼接 URL |
> | **获取难度** | 简单——一步即得 URL | 复杂——需要先分析 AM 日志，提取信息后构造 |
> | **典型流程** | `app-info` → 取 `am_container_logs` → `container-log-list` | `app-info` → AM 日志 → grep 提取 container_id + host → 构造 URL → `container-log-list` |
> | **CLI 命令** | 完全相同（`container-log-*` 系列） | 完全相同（`container-log-*` 系列） |
> | **URL 格式** | `http://{nm_ip}:{port}/node/containerlogs/{container_id}/{user}` | 相同格式，只是 container_id 和 nm_ip 不同 |
>
> **核心区别总结**：
> - **AM 日志**：URL 由 `app-info` 接口直接提供（`am_container_logs` 字段），拿到后直接调用 `container-log-*` 命令即可
> - **Executor 日志**：URL **不会被任何接口直接返回**，必须通过以下步骤自行构造：
>   1. 在 AM 日志中 grep 搜索 `Container exited` / `ExecutorLostFailure` / `container_e` 等关键字
>   2. 从匹配结果中提取失败 Executor 的 **Container ID**（如 `container_e704_xxx_000025`）和**所在节点 IP**
>   3. 参照 AM 日志链接的格式模板，替换 container_id 和 nm_ip 构造出 Executor 日志 URL
>   4. 用构造好的 URL 调用 `container-log-*` 命令获取日志
>
> **一旦拿到 URL，后续的日志获取操作（list / tail / grep / content）对 AM 和 Executor 完全一致。**

## 工作流

当用户提供 app_id 并要求诊断 YARN Application 失败原因时，按以下步骤执行：

### 第 1 步：获取应用基础信息

```bash
do-bigdata yarn app-info --app-id {app_id} --query "<用户原始问题>"
```

**分析要点**：
- `state` 和 `final_status`：确认应用状态（FAILED/KILLED/SUCCEEDED）
- `elapsed_time`：执行耗时是否异常（过长可能是数据倾斜或资源等待）
- `diagnostics`：YARN 级别的诊断信息，通常包含 AM 退出原因，这是最重要的一级线索
- `am_container_logs`：AM 容器日志链接，用于下一步获取日志列表
- `app_type`：应用类型（SPARK、MAPREDUCE、APACHE FLINK 等），决定后续日志分析策略

**[WARN] 重要：YARN 状态为 SUCCEEDED 不代表内部任务全部成功。** 对于 Spark 类型应用（尤其是通过 Livy 提交的交互式 Session），Spark SQL 内部的某条语句可能因 Stage 失败而报错，但 Livy 会捕获异常继续运行，最终 YARN Application 状态仍被置为 SUCCEEDED。因此，**即使 YARN 状态是 SUCCEEDED，对于 Spark 类型应用也必须继续执行后续步骤检查日志中是否存在内部失败**（参见第 3 步"Spark 内部失败检测"）。

**[WARN] 边界限制：获取失败时的处理**

`/api/yarn/app_info` 接口内部实现了两级数据获取策略：
1. **优先**通过 tdwbi 接口获取完整的 YARN Application 信息（包括状态、diagnostics、AM 日志链接等全部字段）
2. **回退**：若 tdwbi 接口失败或返回不完整（如缺少 `am_container_logs`），会自动从 `spark_app` 表查询 AM 日志链接进行补充

因此，当接口返回中包含 `"data_source": "spark_app"` 时，说明数据来自回退查询，此时仅 `am_container_logs` 可用，其他字段（如 state、diagnostics 等）不可用，直接跳到第 2 步使用 AM 日志链接继续诊断即可。

若接口返回包含 `error` 字段（说明两级策略均未获取到信息），**必须严格按以下规则处理**：

1. **立即停止自主探索**：禁止自行尝试其他方式获取信息（如直接拼接 ResourceManager URL、猜测日志路径、调用未在本 Skill 中定义的 API 等）。本 Skill 所有数据获取仅通过 `do-mcp.server.woa.com:8080` 的 `/api/yarn/` 系列接口完成，不应使用任何其他数据源。
2. **向用户请求 AM 日志链接**：告知用户当前 API 无法获取到该应用的信息，请用户直接提供 AM 容器日志链接。链接格式示例：`http://{nm_ip}:{port}/node/containerlogs/{container_id}/{user}`。
3. **用户提供链接后继续流程**：拿到 AM 日志链接后，直接跳到第 2 步（获取 AM 容器日志列表）继续诊断。此时 `app_type` 未知，按"通用策略"获取日志，后续根据日志内容（如出现 `spark.log` 则判定为 Spark 应用）动态识别引擎类型。

**此规则同样适用于后续步骤**：任何接口调用失败或返回异常时，不要自行尝试绕过，应告知用户具体失败原因并请求必要信息。

### 第 2 步：获取 AM 容器日志列表

使用第 1 步返回的 `am_container_logs` 字段（CLI 会自动去除 TDW 代理前缀）：

```bash
do-bigdata yarn container-log-list --container-url "{am_container_logs}" --query "<用户原始问题>"
```

> [WARN] **Container 日志链接预处理（重要）**
>
> 用户提供的 container 日志链接或 `am_container_logs` 字段中返回的链接，可能带有 **TDW 应用代理前缀**，格式为：
> ```
> http://tdw-application.tianqiong.woa.com:8080/{nm_ip}:{nm_port}/node/containerlogs/{container_id}/{user}
> ```
>
> 在传入 `--container-url` 参数前，**必须去掉 `tdw-application.tianqiong.woa.com:8080/` 这段代理前缀**，将链接还原为 NodeManager 的直接地址格式（`container-log-*` 命令也会自动去除，但手动预处理更可靠）：
> ```
> http://{nm_ip}:{nm_port}/node/containerlogs/{container_id}/{user}
> ```
>
> **示例**：
> - 原始链接：`http://tdw-application.tianqiong.woa.com:8080/9.23.14.56:8080/node/containerlogs/container_e704_1757659972062_13336918_01_000001/tdwadmin`
> - 处理后传入：`http://9.23.14.56:8080/node/containerlogs/container_e704_1757659972062_13336918_01_000001/tdwadmin`
>
> **处理规则**：检查链接中是否包含 `tdw-application.tianqiong.woa.com:8080/`，如果包含，则将 `http://tdw-application.tianqiong.woa.com:8080/` 替换为 `http://`，后续部分保持不变。此规则适用于所有需要传入 container 日志链接的 `container-log-*` 命令调用（包括 AM 和 Executor 日志获取）。

**返回示例**：
```json
{
  "logs": [
    {"name": "stderr", "url": "http://...", "size": "12345"},
    {"name": "stdout", "url": "http://...", "size": "234"},
    {"name": "spark.log", "url": "http://...", "size": "1"},
    {"name": "gc.log", "url": "http://...", "size": "5678"}
  ]
}
```

**日志优先级策略**：
- 不同引擎关注的日志不同，参考下方"日志获取策略"
- 日志可能有滚动（如 `stderr`, `stderr.1`, `stderr.2`），用户也可能自定义日志名
- 优先获取最新的（无后缀或后缀数字最小的）日志

#### [WARN] 大日志清理识别（size=1）

> **重要诊断知识**：在调用 `container-log-content` 之前，**必须先检查 `container-log-list` 返回的每条日志的 `size` 字段**。

**触发特征**：
- `container-log-list` 返回的某条日志记录中，`url` 字段正常存在，但 `size == 1`（或字符串 `"1"`）

**根本原因**：
- 当某个 Container 的日志文件**单文件超过 1.5GB** 时，为了避免写满 NodeManager 节点磁盘导致整台机器上的任务一起失败，**机器上的日志清理脚本会自动清空该日志文件内容**（保留文件名和链接，但内容被置空，文件大小变为 1 字节占位）
- 这是机器侧的**自我保护机制**，不是任务异常

**对任务的影响**：
- **完全不影响任务运行**：任务本身可能仍正常完成（YARN 状态可能为 SUCCEEDED）
- 只是无法再通过 NodeManager 容器日志查看该文件的具体内容

**正确响应方式**：
1. **不要对该日志文件调用 `container-log-content`**（调用结果会是空内容，浪费一次 API 调用）
2. **跳过该日志文件**，继续分析其他 `size > 1` 的日志（如 stderr / stdout / gc.log 等）
3. **明确告知用户**：该日志因超过 1.5GB 被机器侧清理脚本自动清空，**不代表任务失败**
4. **引导用户使用替代方案**：如果需要查看任务的运行情况和详细指标，建议通过 **Spark History Server** 查看（任务的 Spark UI / History Server 链接通常可在 `am_container_logs` 同级页面找到，或通过 Spark 平台入口访问）

**回复模板（参考）**：

> 您查看的应用中 `<日志文件名>` 这个日志文件，因为单个文件超过了 1.5GB，触发了机器上的大日志清理脚本（这是为了避免日志写满磁盘导致整机任务失败的保护机制），文件内容已被清空，**但这不影响任务运行**。
>
> 如果您需要查看任务的具体运行情况和指标，建议通过 **Spark History Server** 查看（包含 Stage、Task、Executor 等运行指标）。其他日志（如 stderr / stdout）我已经获取并分析。

### 第 3 步：获取并分析日志内容

获取具体日志文件内容：

```bash
# 首次获取（读取末尾 8KB）
do-bigdata yarn container-log-content --log-url "{log_url}" --start -8192 --length 8192 --query "<用户原始问题>"

# 快速查看指定日志尾部（自动查找文件并拉取尾部）
do-bigdata yarn container-log-tail --container-url "{container_url}" --log-name stderr --bytes 8192 --query "<用户原始问题>"

# 使用 grep 关键字过滤（从尾部扫描 40MB 覆盖全量日志）
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "ERROR" --log-name stderr --scan-bytes 40960000 --query "<用户原始问题>"
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "Exception" --log-name stderr --scan-bytes 40960000 --query "<用户原始问题>"
```

**参数策略**：
- `container-log-content --start`：支持正数（从头）和负数（从尾）偏移。**首次获取建议 `--start -8192 --length 8192`**（获取最后 8KB），若信息不足再逐步增大到 `--start -65536 --length 65536`
- `container-log-tail`：简化版尾部读取，自动查找指定文件并拉取尾部，适合快速查看
- `container-log-grep --pattern`：支持正则表达式搜索，`--scan-bytes` 建议设为 `40960000`（约 40MB）以覆盖全量日志。常用 pattern：`ERROR`、`Exception`、`FATAL`、`OOM|OutOfMemory`、`killed|Container`、`Job aborted due to stage failure`

#### 3.0 首轮错误全面扫描（必须执行）

**[WARN] 在获取日志列表后、深入分析前，必须先对所有关键日志执行一轮系统化的错误扫描。** 这是诊断流程中最关键的一步，目的是快速全面地捕获所有错误信息，避免遗漏关键异常。

**扫描策略**：

**第一批（并行执行）**：对每个关键日志文件（stderr、stdout，以及 spark.log / syslog / jobmanager.log 等引擎特定日志），**同时**发起以下 `container-log-grep` 搜索。所有搜索均使用 `--scan-bytes 40960000`（约 40MB）以覆盖全量日志：

```bash
# 对每个关键日志文件（如 stderr、stdout、spark.log），并行执行以下搜索：
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "ERROR" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "Exception" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "FATAL" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "Error" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "Traceback" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "FAILED" --log-name stderr --scan-bytes 40960000
```

搜索关键字说明：
- `ERROR` — Java/框架级错误日志
- `Exception` — Java 异常栈（含 Caused by 链）
- `FATAL` — 致命错误
- `Error` — 通用错误信息（捕获 Python 的 SyntaxError、TypeError 等）
- `Traceback` — Python 异常栈的起始标记
- `FAILED` — 应用/任务失败状态

> [PIN] **关键说明**：以上 6 个关键字的 grep 搜索必须在**每个关键日志文件上并行执行**（更换 `--log-name` 参数即可）。例如对于有 stderr 和 stdout 两个关键日志的应用，应同时发起 `6 × 2 = 12` 个并行请求。这种并行策略能在一轮调用中最大化错误信息的覆盖面。

**第二批（根据第一批结果按需执行）**：根据第一批扫描结果中发现的线索，针对性地搜索更具体的关键字：

| 如果第一批发现... | 则继续搜索 |
|---|---|
| Java OOM 相关异常 | `grep=OutOfMemoryError`、`grep=heap space`、`grep=killed by YARN` |
| Python 异常（Traceback/Error） | `grep=SyntaxError`、`grep=ImportError`、`grep=ModuleNotFoundError`、`grep=NameError`、`grep=TypeError`、`grep=ValueError`、`grep=KeyError`、`grep=AttributeError`、`grep=IndentationError`、`grep=FileNotFoundError`、`grep=PermissionError` |
| Executor 失败信息 | `grep=ExecutorLostFailure`、`grep=Container exited`、`grep=Lost executor`、`grep=Max number of executor` |
| Spark Stage 失败 | `grep=Job aborted due to stage failure`、`grep=Lost task`、`grep=FetchFailedException` |
| 连接/网络问题 | `grep=Connection refused`、`grep=SocketTimeoutException`、`grep=RpcEndpointNotFoundException` |
| 权限问题 | `grep=AccessControlException`、`grep=Permission denied` |
| 文件/路径问题 | `grep=FileNotFoundException`、`grep=Path does not exist`、`grep=No such file` |
| `submitSql has error` 或类似 | `grep=submitSql`、`grep=PythonRunner`、`grep=HiveContextManager` |

> [WARN] **不要跳过首轮扫描直接去读日志尾部。** 很多关键错误信息（如 Python 的 SyntaxError、ImportError）可能出现在日志中间而非末尾。仅靠 `container-log-tail --bytes 8192` 读取日志尾部很容易遗漏这些错误。首轮 `container-log-grep --scan-bytes 40960000` 能覆盖全量日志，确保不遗漏任何位置的错误信息。
>
> **只有在首轮扫描的所有 grep 均无结果时**，才回退到通过 `container-log-tail` 增大 `--bytes` 直接读取日志尾部内容的方式进行分析。

**扫描结果分析原则**：
1. **优先关注 Traceback 和 Exception**：如果同时匹配到多种错误，Python Traceback 和 Java Exception 通常包含最直接的根因信息
2. **关注因果链**：如果发现 `Caused by:` 链，追踪到最内层的 `Caused by` 通常就是根因
3. **关注时间顺序**：最早出现的错误通常是根因，后续错误可能是连锁反应
4. **如果 grep 返回大量匹配**：说明日志中有很多错误，此时应进一步缩小搜索范围（使用更具体的关键字）或获取特定时间段的日志

**日志获取策略（按引擎）**：

#### Spark 应用

**[WARN] Spark 内部失败检测（必须执行）**：

对于 Spark 类型应用，**无论 YARN 状态是 FAILED 还是 SUCCEEDED**，都必须在 AM 日志（stderr、spark.log、stdout）中搜索以下关键字，检测是否存在 Spark 内部任务失败：

```bash
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "Job aborted due to stage failure" --log-name stderr --scan-bytes 40960000
```

**原因**：Spark SQL 应用（尤其通过 Livy 提交的交互式 Session）可能在内部某条 SQL 语句的 Stage 失败后，由 Livy 层捕获异常继续运行，最终将 YARN 状态主动置为 SUCCEEDED。仅依赖 YARN 状态无法发现这类隐藏的失败。

**执行方式**：在 stderr、spark.log、stdout 三个关键日志中并行搜索（更换 `--log-name`），只要任一日志中匹配到该关键字，即说明存在 Spark 内部失败，需要继续分析失败详情。

如果搜索发现了 `Job aborted due to stage failure`，继续使用 `container-log-grep` 搜索以下 pattern 获取详细失败信息：
- `--pattern "ERROR"` — 获取错误级别日志
- `--pattern "Lost task"` — 获取 Task 失败详情（节点、Executor、TID）
- `--pattern "Exception"` — 获取完整异常栈
- `--pattern "TypeError|PythonException"` — 当涉及 Python UDF 时搜索 Python 异常

#### PySpark / Python 应用专项检查

当识别到应用涉及 Python 代码时（日志中出现 `PythonRunner`、`submitPythonSql`、`pyspark`、`.py` 文件名等线索），**必须额外执行以下 Python 专项搜索**（均使用 `--scan-bytes 40960000`），在 stderr 和 stdout 上并行执行：

```bash
# 以下命令在 stderr 和 stdout 两个日志上并行执行（更换 --log-name）
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "Traceback" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "SyntaxError" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "ImportError" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "ModuleNotFoundError" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "NameError" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "TypeError" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "IndentationError" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "FileNotFoundError" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "from.*import" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{container_url}" --pattern "File.*line" --log-name stderr --scan-bytes 40960000
```

**PySpark 应用快速失败的典型模式**：
- 应用启动后秒级失败（< 30 秒），且无 Executor 被分配 → 大概率是 Driver 端 Python 代码加载阶段就失败了（如 SyntaxError、ImportError）
- 这类错误的关键信息通常在 stderr 或 stdout 中，且可能出现在日志中间位置而非末尾
- **必须通过 `container-log-grep` 全量扫描定位**，不能仅靠 `container-log-tail` 读取日志尾部

**日志优先级**：
1. **stderr** — 首要目标，包含 Driver/Executor 异常栈、OOM 错误、Container killed 信息、Python Traceback
2. **stdout** — Driver 的标准输出，可能包含用户 print 的业务日志、Python 子进程的错误输出
3. **spark.log** — Spark 事件日志（若存在），包含 Stage/Task 失败详情
4. **gc.log** — 当怀疑 GC 问题时查看（心跳超时、Container 被 kill）

#### MapReduce 应用
1. **stderr** — AM 异常信息
2. **stdout** — 任务输出
3. **syslog** — 系统日志，包含详细的 Task 执行信息

#### Flink 应用
1. **jobmanager.log** — JobManager 日志，包含作业提交和调度异常
2. **stderr** — JVM 级别错误
3. **gc.log** — GC 分析

#### 通用策略
对于未知引擎类型或自定义日志名，先获取 `stderr` 和 `stdout`，再根据日志列表中的文件名逐步排查。

### 第 3.5 步：获取 Executor / 非 AM 容器的日志（按需）

在某些场景下，仅靠 AM（Driver）日志无法确定具体的失败根因，需要进一步查看 **Executor / TaskManager / 其他 Container** 的日志。典型触发场景包括：

- AM 日志显示 `Max number of executor failures (N) reached`，但未包含具体 Executor 失败原因
- AM 日志显示 `ExecutorLostFailure` 但未给出详细 exit code 或异常栈
- AM 日志显示 Container 退出但原因不明
- 需要分析特定 Task 在某个 Executor 上的失败详情

> [WARN] **Executor 失败达上限时，必须同时检查 AM（Driver）的 GC 日志**
>
> 当诊断结果为 `Max number of executor failures (N) reached` 时，除了获取失败 Executor 的日志分析具体失败原因外，**还必须检查 AM（Driver）容器的 GC 日志（gc.log）**，确认 Driver 端是否存在严重的 Full GC 问题。
>
> **原因**：Driver 端严重的 Full GC 会导致以下连锁问题：
> 1. Driver 长时间 STW（Stop-The-World），无法及时处理 Executor 的心跳和 RPC 请求
> 2. Executor 因无法与 Driver 通信而被判定为丢失（`ExecutorLostFailure`）
> 3. 大量 Executor 集中失败，快速触发 `max.executor.failures` 上限
> 4. 此时 Executor 本身可能并无问题，根因在 Driver 端的 GC 压力
>
> **检查方法**：
> 1. 在第 2 步获取的 AM 日志列表中查找 `gc.log`（或 `gc.log.0`、`gc.log.0.current` 等 GC 日志文件）
> 2. 获取 GC 日志内容，搜索 Full GC 相关记录：
>    ```bash
>    do-bigdata yarn container-log-grep --container-url "{am_container_url}" --pattern "Full GC" --log-name gc.log --scan-bytes 40960000
>    ```
> 3. **判定标准**：
>    - 单次 Full GC 暂停时间 > 10 秒 → 严重
>    - Full GC 累计次数 ≥ 5 次 → 频繁
>    - 连续多次 Full GC 且回收后堆使用率仍 > 80% → 内存严重不足
> 4. 如确认存在严重 Full GC，在诊断报告中应标注 **Driver 端 GC 压力是导致 Executor 集中失败的根因或重要因素**，并给出 Driver 端的内存和 GC 调优建议（参见 `references/yarn_log_patterns.md` 中"9.4 Executor 累计失败次数达上限"的 Driver GC 诊断部分）

#### 3.5.1 从 AM 日志中定位失败 Executor 信息

在 AM 的关键日志（stderr、spark.log、stdout）中搜索以下关键字，找到失败 Executor 对应的 Container ID 和所在 NodeManager 节点：

```bash
do-bigdata yarn container-log-grep --container-url "{am_container_url}" --pattern "ExecutorLostFailure" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{am_container_url}" --pattern "Container exited" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{am_container_url}" --pattern "container_e" --log-name stderr --scan-bytes 40960000
do-bigdata yarn container-log-grep --container-url "{am_container_url}" --pattern "Lost executor" --log-name stderr --scan-bytes 40960000
```

**需要从日志中提取的关键信息**：
1. **失败 Executor 的 Container ID**：格式为 `container_e{epoch}_{cluster_timestamp}_{app_number}_{attempt}_{container_number}`，例如 `container_e704_1757659972062_13336918_01_000025`。其中 AM 容器的 container_number 为 `000001`，Executor 容器从 `000002` 开始递增。
2. **Container 所在 NodeManager 节点 IP/hostname**：通常在日志中以 `host: x.x.x.x` 或 `on host x.x.x.x` 形式出现。

**提取示例**：
AM 日志中可能出现如下内容：
```
Container exited with a non-zero exit code 137. Container id: container_e704_1757659972062_13336918_01_000025 on host: 9.134.56.78
```
或 Spark 日志中：
```
Lost executor 24 (already removed): Container container_e704_1757659972062_13336918_01_000025 ... was preempted.
```

从中提取到：
- Container ID = `container_e704_1757659972062_13336918_01_000025`
- NodeManager IP = `9.134.56.78`

#### 3.5.2 构造 Executor Container 日志链接

AM 日志链接的格式为：
```
http://{nm_ip}:{nm_port}/node/containerlogs/{container_id}/{user}
```

将提取到的 Executor Container ID 和 NodeManager IP 替换到 AM 日志链接模板中即可得到 Executor 日志链接。

**构造方法**：
1. 取 AM 日志链接作为模板（如 `http://9.23.14.56:8080/node/containerlogs/container_e704_1757659972062_13336918_01_000001/tdwadmin`）
2. 替换其中的 `{nm_ip}` 为 Executor 所在节点 IP（如 `9.134.56.78`）
3. 替换其中的 `{container_id}` 为 Executor 的 Container ID（如 `container_e704_1757659972062_13336918_01_000025`）
4. `{nm_port}` 和 `{user}` 保持与 AM 链接一致

**结果示例**：
```
http://9.134.56.78:8080/node/containerlogs/container_e704_1757659972062_13336918_01_000025/tdwadmin
```

#### 3.5.3 获取 Executor 日志并分析

使用构造好的 Executor 日志链接，**通过 `container-log-*` 系列 CLI 命令**获取日志（禁止直接请求 Container 日志链接）。

> [PIN] **提醒**：`container-log-*` 命令会自动去除 TDW 代理前缀，无需手动预处理。

1. **获取日志列表**：
```bash
do-bigdata yarn container-log-list --container-url "{executor_container_log_url}" --query "<用户原始问题>"
```

2. **快速查看 Executor 日志尾部**：
```bash
do-bigdata yarn container-log-tail --container-url "{executor_container_log_url}" --log-name stderr --bytes 8192 --query "<用户原始问题>"
```

3. **搜索 Executor 日志关键词**：
```bash
do-bigdata yarn container-log-grep --container-url "{executor_container_log_url}" --pattern "OOM|OutOfMemory|killed|FetchFailed" --log-name stderr --scan-bytes 40960000 --query "<用户原始问题>"
```

4. **分段读取日志内容**（按引擎类型的日志优先级获取，Executor 的关键日志通常是 `stderr` 和 `stdout`）：
```bash
do-bigdata yarn container-log-content --log-url "{log_url}" --start -65536 --length 65536 --query "<用户原始问题>"
```

   > [WARN] **同样需要检查 size 字段**：Executor 日志列表中如果某条日志 `size == 1`，同样表示该日志因超过 1.5GB 触发了机器侧大日志清理脚本（不影响任务运行）。处理方式参见第 2 步的「[WARN] 大日志清理识别（size=1）」章节。

3. **分析要点**：
   - `java.lang.OutOfMemoryError` — Executor 内存不足
   - `Container killed by YARN for exceeding memory limits` — 物理内存超限
   - `exit code 137` — 被 OOM-killer 或 YARN 抢占杀死
   - `exit code 143` — 收到 SIGTERM（正常终止或超时）
   - `FetchFailedException` — Shuffle 数据拉取失败
   - `Executor heartbeat timed out` — GC 暂停导致心跳超时

**[WARN] 注意事项**：
- 优先选择最近一次失败的 Executor（container_number 较大的）进行分析
- 如果多个 Executor 失败原因可能不同，可选取 2-3 个不同的 Executor 做对比分析
- 如果从 AM 日志中无法提取到 Executor 的 Container ID 或 NodeManager IP，应告知用户并请求提供相关信息
- Executor 的日志可能因 Container 已被清理而无法获取（日志过期），此时告知用户日志不可用即可

### 第 3.6 步：知识库检索（辅助诊断）

当任务类型是spark时，或者日志中有spark相关的内容时，使用知识库检索命令获取历史诊断案例作为辅助参考。

**触发条件**：根据首轮 grep 扫描结果中出现的错误特征判断，是否是spark任务。

**调用方式**：
```bash
do-bigdata yarn knowledge-search --query "<核心错误特征>"
```

**查询构造**：从首轮 grep 扫描结果中提取最核心的错误特征作为 query 参数。例如：
- `java.lang.OutOfMemoryError: Java heap space`
- `ExecutorLostFailure: Executor heartbeat timed out`
- `FetchFailedException: Failed to connect`

**约束**：
- 单次诊断中 `knowledge-search` **最多调用 3 次**，超过后不再调用，直接基于已有信息进行分析
- 每次检索应使用不同的核心错误特征，避免重复查询
- 检索结果作为**辅助参考**纳入第 4 步根因分析，不替代基于 `yarn_log_patterns.md` 的模式匹配分析
- 如果检索服务不可用（返回错误），跳过此步骤继续诊断，不阻塞流程

### 第 4 步：根因分析与诊断报告

基于获取到的日志内容，对照 `references/yarn_log_patterns.md` 中的异常模式进行匹配分析。

**诊断报告格式**：

```
## YARN Application 诊断报告

### 基础信息
- Application ID: {app_id}
- 应用名称: {name}
- 提交用户: {user}
- 应用类型: {app_type}
- 状态: {state} / {final_status}
- 执行耗时: {elapsed_time}

### 诊断结论
{一句话概述失败根因}

### 详细分析
{分步骤的分析过程，引用关键日志片段}

### 修复建议
{从用户（app 维护者）角度给出的具体修复步骤和参数调整建议。所有建议必须是用户在提交任务时可自主操作的，如调整 Spark/MR/Flink 配置参数、修改代码逻辑、优化 SQL 等。不要给出需要集群运维权限的建议（如修改 YARN/NodeManager 集群配置、登录集群机器操作、调整队列配额等），如遇此类集群侧问题，建议用户联系集群运维方协助处理。}
```

## 参考文档

```bash
do-bigdata docs list --skill yarn-app-diagnose
do-bigdata docs show --skill yarn-app-diagnose --file yarn_log_patterns.md
```

- `yarn_log_patterns.md` — YARN 应用失败常见日志模式和分析用例参考文档。包含 OOM、GC 问题、资源不足、权限错误、数据倾斜、网络超时等故障模式的日志特征和诊断思路。当需要分析具体日志内容时，通过上述 CLI 命令读取此文件获取匹配模式和诊断建议。

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
