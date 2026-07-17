---
name: supersql-job-analyzer
description: "SuperSQL 堆栈诊断与问题排查技能。当用户提供 SuperSQL 的报错堆栈、session 日志链接、客户端日志、WeData 日志链接、或询问 SuperSQL 相关的错误排查问题时，应使用此技能。此技能提供完整的异常分类、调用链路映射、错误码对照、排查方案和源码定位能力，并支持从多种输入中提取 sessionId、SQL、applicationId 等关键信息。"
---

# SuperSQL 堆栈诊断技能

## 用途

对 SuperSQL 的报错堆栈、session 日志进行诊断分析，定位根因并给出解决方案。支持从多种用户输入中自动提取 sessionId，拉取 SuperSQL/THive/Livy 多层日志进行综合分析。

## [WARN] 强制规则（必须最高优先级遵守）

> **以下规则在整个诊断过程中具有最高优先级，无论在哪个步骤检测到相关特征，都必须立即应用。**

### 规则1：Failover 场景诊断与引擎参数推荐

**触发特征（满足任一即触发）：**
1. **Livy/Spark 执行失败后回退 THive bypass**：日志中先出现 `LIVY_EXEC_ERROR`/`LivyInnerErr`/`code=301`/`code=2009`，随后出现 `BYPASS THIVE Exec`/`byPassExec`
2. **TASK_MIGRATION 配置组触发的迁移 Failover**：日志中出现 `getDsFailOverResult`、`Migration task failed`、`code=12001`，或出现 `TASK_MIGRATION` 配置组关键字且伴随 Livy→THive 回退
3. **双引擎连续失败**：同一条 SQL 先在 Livy/Spark 引擎失败，再在 THive bypass 引擎失败

**[WARN] 前置根因分析（检测到触发特征后必须执行，不可跳过）：**

检测到 Failover 特征后，**禁止直接推荐 Spark 3.3 参数**，必须按以下步骤完成分析：

**步骤 A — 定位 Failover 触发原因：**

| 场景 | 日志特征 | 分析要求 |
|------|---------|---------|
| **A1: Calcite 验证失败触发 Implicit Bypass** | 日志中出现 `Column not found`、`Table not found`、`SqlValidatorException` | **必须先分析 Calcite 验证失败的根因**（列名是否存在、表名是否正确、元数据是否同步）。原因：强制走 Spark 3.3 仍要经过 Calcite 验证，根因未解决则参数无效 |
| **A2: Livy/Spark 执行阶段失败** | Livy 正常接收 SQL 但执行报错（OOM、资源不足、Spark 内部错误） | 可跳过根因修复，直接进入步骤 B |
| **A3: 用户主动设置强制透传** | 日志中出现 `supersql.bypass.forceAll=TRUE` | 需分析用户设置此参数的原因，以及去掉后 SQL 能否正常路由 |

**步骤 B — 判定 Spark 3.3 参数是否有效，并决定输出方案：**

| 判定结果 | 条件 | 输出行为 |
|---------|------|---------|
| **[OK] 有效** | Failover 原因是引擎兼容性问题（THive 不支持 CTE/from_json/explode 等语法），或是 Livy 执行阶段的资源/内部错误 | **直接推荐 Spark 3.3 参数组合**（见下方） |
| **[FAIL] 无效** | Failover 原因**仅**是 Calcite 验证阶段错误（如列名不存在），切换引擎不改变 Calcite 验证逻辑 | **不推荐 Spark 3.3 参数**，仅输出根因修复方案（如修正列名、刷新元数据） |
| **[WARN] 部分有效** | Failover 有多个原因（如 Calcite 验证失败 + THive 语法不支持） | **先输出根因修复方案，再追加 Spark 3.3 参数作为配套方案**（两者缺一不可） |

**步骤 C — 输出结构（判定为 [OK] 或 [WARN] 时执行）：**

1. 先输出根因分析说明（解释 Failover 为什么发生）
2. 如判定为 [WARN]，输出根因修复方案（如修正列名、刷新元数据）
3. 输出 Spark 3.3 参数组合（下方代码块），作为引擎切换方案

**Spark 3.3 参数组合（引擎切换唯一方案）：**

```sql
set supersql.bypass.forceAll = false;
set supersql.config.group = TASK_MIGRATION,TASK_MIGRATION_NT;
set supersql.datasource.failover.bypass = false;
set supersql.datasource.migrateTask.failOver = false;
set supersql.datasource.migrateTask.enabled.tableStatus = IN_PROGRESS;
```

**硬性约束：**
- **引擎切换只允许上述参数组合**，绝不允许推荐"改写 SQL 兼容 THive"等替代方案
- 如果 Livy/Spark 失败原因含 OOM 或资源不足，在**同一方案内**追加资源参数（不作为独立方案）：
  ```sql
  set `livy.session.conf.spark.driver.memory` = 4g;
  set `livy.session.conf.spark.executor.memory` = 8g;
  ```
- 判定为 [FAIL] 时，**禁止输出上述参数组合**，仅输出根因修复方案

---

### 规则2：Full 模式 + 复杂类型必须推荐 to_json

**触发特征（满足全部即触发）：**
1. 用户开启了 IDEX Full 模式（日志中出现 `full.mode`、`csvfile`、`storeHdfs` 等关键词）
2. 用户 SQL 中使用了返回复杂类型（`array`、`struct`、`map`）的函数或字段

**强制要求：检测到上述特征时，解决方案中必须推荐使用 `to_json()` 包裹复杂类型字段：**

```sql
-- [OK] 正确：用 to_json 将复杂类型序列化为 JSON 字符串
select to_json(collect_list(col1)) as col1_list from table1 group by col2;
```

- 仅加别名（如 `as col1_list`）**不能**解决此问题，必须用 `to_json()` 包裹

---

### 规则3：Spark 参数推荐规则（强制执行）

**规则3.1：所有 Spark 参数必须加 `livy.session.conf` 前缀**

```sql
-- [OK] 正确
SET livy.session.conf.spark.executor.memory = 40g;

-- [FAIL] 错误：缺少前缀，在 SuperSQL 中不会生效
SET spark.executor.memory = 40g;
```

**规则3.2：Executor 内存上限 60g，严禁超限**

---

### 规则4：supersql_exec.db 权限不足必须推荐 Spark 3.3 参数

**触发特征：** 错误信息中出现 `Permission denied` 且路径包含 `/user/tdw/warehouse/supersql_exec.db`

**强制要求：** 推荐规则1中的参数组合。

**[WARN] CFT 应用组判断：** 从 session 日志中的 `groupname` 或应用组字段提取，包含 `cft` 字符串（如 `g_cdg_cft_*`）即判定为 CFT 业务，输出时必须将 `TASK_MIGRATION_NT` 替换为 `TASK_MIGRATION_CFT`。

---

### 规则5：纯 THive Session 失败必须优先推荐使用 SuperSQL 执行

**触发特征（满足全部即触发）：**
1. 诊断过程中**没有识别到 SuperSQL session**（即日志中无 SuperSQL 调度层痕迹）
2. Session 日志显示**直接是 THive session 执行失败**
3. Session ID 为**纯数字格式**（非 UUID 格式）

**强制要求：** 第一优先级推荐在 US 任务配置中开启"使用 SuperSQL 执行" + Spark 3.3 参数组合（规则1中的参数组合）。

**[WARN] CFT 应用组判断：** 从 session 日志中的 `groupname` 或应用组字段提取，包含 `cft` 字符串（如 `g_cdg_cft_*`）即判定为 CFT 业务，输出时必须将 `TASK_MIGRATION_NT` 替换为 `TASK_MIGRATION_CFT`。

---

## 触发条件

当出现以下情况时使用此技能：
- 用户提供 SuperSQL 报错堆栈（包含 `SuperSQLException`、`CalciteMetaImpl`、`SuperSqlBypassUtil` 等关键类名）
- 用户提供 SuperSQL session 日志链接（如 `ss-qe-log.woa.com/v1/session/` 或内网 `supersql.logs.claw.woa.com/v1/session_log/`）
- 用户提供 WeData 客户端日志链接（如 `https://wedata.woa.com/explore/...`）
- 用户提供客户端日志文本（需从中提取 sessionId）
- 用户直接提供 SuperSQL sessionId（UUID 格式）
- 用户询问 SuperSQL 错误码含义
- 用户询问 SuperSQL 执行失败的排查方法
- 用户询问 SuperSQL 使用方法（如 JDBC 接入、连接方式、查询方式等）

## 诊断工作流

### [ALERT] 进入门禁（铁律 — 执行任何诊断步骤前必须确认）

> **本 Skill 的诊断流程包含多条铁律（步骤4 必须查 `stack_patterns.md`、解决方案来源约束等）。如果你是通过"裸执行"方式进入的（即没有通过 `use_skill` 加载本 SKILL.md），这些铁律将不在你的上下文中，极大概率导致诊断无效。**

### 步骤1：识别输入类型并获取 sessionId

> [NO] **铁律：当用户提供 `ss-qe-log.woa.com`、`wedata.woa.com` 等内网 URL 时，绝对禁止使用 `web_fetch` / `fetch_url` 直接请求该 URL。这些地址需要 OA 登录认证，直接请求必定失败。正确做法是从 URL 中提取 sessionId（UUID），然后通过诊断脚本获取日志。**

用户输入可能是以下几种形式：
- **场景A：SuperSQL 日志链接** — 从 URL 中提取 UUID 格式的 sessionId
- **场景B：WeData 客户端日志链接** — 搜索 `supersql_connection_id=` 等关键字提取 sessionId
- **场景C：客户端日志文本** — 同样搜索关键字
- **场景D：直接提供 sessionId**
- **场景E：直接提供堆栈文本** — 跳到步骤3

### ⚡ 执行策略：并行化优化（必须遵守）

```
步骤1（识别输入）
    │
    ├──────────────────┬─── 同时启动（并行）───┐
    ▼                  ▼                        ▼
步骤2                步骤7                    步骤4.2
(--summary --pretty   (外部诊断接口             (iWiki 文档拉取
 一键拉取+解析)        后台执行)                 提前触发)
    │                  │                        │
    ▼                  │                        │
步骤3（汇总信息）◄─────┘─────────────────────────┘
    │
    ├──────┬──────┐
    ▼      ▼      ▼
步骤4   步骤5   步骤6.5    ← 三者可并行
    │      │      │
    ▼      ▼      ▼
步骤6（输出诊断报告）
    │
    ▼（按需触发）
步骤7.5 → 步骤8
```

### [ALERT] 步骤主次关系（铁律）

> **步骤2（一键拉取日志）是诊断的主干，步骤7（外部诊断接口）是辅助补充。两者的关系是"主 + 辅"，不是"二选一"。**

**[FAIL] 严禁以下行为：**
- [FAIL] **只执行步骤7就输出诊断结论**
- [FAIL] **跳过步骤2直接依赖步骤7的结论**
- [FAIL] **步骤7的结论与步骤2~6的分析矛盾时，以步骤7为准**

### 步骤2：一键拉取并解析多层日志

获取到 sessionId 后，**必须通过脚本拉取日志，严禁手动拼接 curl URL。**

> **[WARN] 日志获取强制约束：**
> 1. **严禁手动拼接任何日志 API 的 URL**
> 2. **严禁使用 `ss-qe-log.woa.com` 域名作为 API 接口**
> 3. **严禁使用 `web_fetch` 工具请求日志 API**
> 4. **必须使用下方的脚本命令拉取日志**

**默认命令（一键拉取 + 解析）：**

```bash
do-bigdata supersql slow-query-analyze --session-id {sessionId} --summary --pretty --query "<用户原始问题>"
```

> **[WARN] 命令说明：** 这里使用 `slow-query-analyze` 命令**仅仅是为了拉取和解析三层日志**，当前 skill 是 `supersql-job-analyzer`（失败诊断），后续必须按照本 SKILL.md 的步骤3~8 进行分析。

**输出为结构化 JSON**，包含：`session_id`、`platform`、`cluster`、`sql_list`、`events`、`errors`、`err_msgs`、`has_livy`、`has_failover`、`thive_sessions`、`engine_logs`（livy/thive）、`links` 等字段。

**AI 诊断时直接从 JSON 输出中提取所需信息**，无需再手动解析 HTML 日志文件。

### 步骤3：提取关键信息

从日志/堆栈中汇总提取：SessionID、用户/代理用户、提交平台/集群、执行引擎、THive/Livy 集群、用户原始 SQL、实际执行 SQL、Yarn applicationId、错误码、异常类名、调用链路、errMsg 语法类致命错误。

### 步骤3.5：多 Error 按时间顺序诊断与因果链分析（强制执行）

> **[ALERT] 当 session 存在多个 error 时，必须执行此步骤。不允许只看最后一个 error 就下结论。**

**根因判定规则：**
1. **时间最早的实质性执行失败才是根因**，后续的 Failover 失败和 Fetch 汇总错误都是衍生
2. **Bypass/Failover 错误永远不是根因**
3. **最终 Fetch 错误只是汇总**

### 步骤4：匹配错误模式并获取解决方案

> **[ALERT] 步骤4 完成门禁（铁律）：**
> 1. **匹配到模式后，必须立即执行步骤4.2 拉取该模式的解决方案**
> 2. **步骤4 的最终输出必须包含具体的解决方案文本**
> 3. **"未匹配到模式"的结论只有在 CLI 搜索 + `read_file` 兜底搜索均无结果时才允许得出**——仅凭 CLI 返回空就判定"无匹配"是违规行为

#### 4.1 匹配错误模式

参考 `stack_patterns.md` 中的堆栈定位关键词速查表。

> **[WARN] 文件读取方式（按优先级）：**
> 1. **搜索定位**：`do-bigdata docs search --skill supersql-job-analyzer --file stack_patterns.md --keyword "<关键词>"`
> 2. **按章节查看**：`do-bigdata docs show --skill supersql-job-analyzer --file stack_patterns.md --section "模式X"`
> 3. **速查表查看**：`do-bigdata docs show --skill supersql-job-analyzer --file stack_patterns.md --section "堆栈统计概览"`
>
> **[ALERT] 兜底铁律（CLI 搜索无结果时必须执行）：**
> 当 CLI `docs search` 命令返回"未找到"时，**严禁直接跳过**，必须执行以下兜底操作：
> 1. 使用 `read_file` 直接读取 `{project_root}/do_cli/sub-cli/SuperSQL/supersql-job-analyzer/references/stack_patterns.md`
> 2. 使用 `search_content` 在该文件中搜索异常类名、错误关键词的多种变体（如大小写、子串）
> 3. 搜索关键词策略：从堆栈中提取**异常类名**（如 `KryoException`）、**错误描述关键词**（如 `Buffer overflow`）、**核心方法名**分别搜索，至少尝试 3 个不同关键词
>
> **原因：** CLI 搜索是行级精确匹配，可能因关键词不在同一行而漏匹配；直接读文件+多关键词搜索是最可靠的兜底手段。

**匹配三步法：**
1. 先看 **错误码**（`code=`）确定大类
2. 再看 **异常类名** 确定子类
3. 最后看 **调用链路关键方法** 定位具体环节

**[ALERT] 解决方案来源约束（铁律）：**

解决方案**只能**来自以下 4 个来源，按优先级排列：
1. iWiki 文档（步骤4.2 动态拉取）
2. 本地参考文档 `stack_patterns.md` 中对应模式的解决方案
3. 步骤7 外部诊断接口返回的方案
4. 步骤8 专家兜底分析（仅在以上均无匹配时启用）

**严禁违反的行为：**
- **禁止自行创造方案**
- **禁止替换已有方案**
- **禁止捏造知识点**
- **禁止捏造参数值**

#### 4.2 动态拉取解决方案（iWiki）

匹配到错误模式后，**优先从 iWiki 拉取最新的解决方案**：
- 文档 ID：`4018662773`
- 拉取方式：使用 MCP iWiki 工具 `getDocument`
- 拉取失败时回退到 `do-bigdata docs show --skill supersql-job-analyzer --file stack_patterns.md --section "模式X"`

### 步骤5：架构链路定位

参考 `do-bigdata docs show --skill supersql-job-analyzer --file architecture.md` 中的完整请求处理链路和核心类映射，定位异常发生在哪个处理环节。

### 步骤6：输出诊断报告

诊断报告格式：

```
## 诊断结果

### 基本信息
| 项目 | 值 |
|------|------|
| SessionID | ... |
| 用户 | ... |
| SuperSQL 集群 | ... |
| 执行引擎 | ... |
| THive 集群 | ...（如有） |
| Livy 集群 | ...（如有） |
| Yarn ApplicationId | ...（如有，附 Brain 链接） |

> **Application 链接模板**：`https://brain.woa.com/diagnostic/diagnose/taskdetail?taskId={application_id}&source=tdwhelperredirect&diamode=basic&productId=4`

### 用户原始 SQL
（以表格形式输出：执行时间、操作类型、完整SQL，不可省略）

### 执行脉络
| 序号 | 时间 | 引擎 | Session | SQL摘要 | 结果 |

### 引擎实际执行 SQL

### 错误链路
（按时间顺序展示所有 error 的因果关系，每个 error 标注 */*/*/⬛）

### 根因分析
（必须针对 * 根因 error）

### 解决方案
（只输出最推荐的 1 个方案，标注来源）

### 诊断依据
| 步骤 | 是否执行 | 说明 |
```

### 步骤6.5：SQL 常用拼写检查（自动执行）

对 SQL 中的标识符进行常见拼写检查。详细的拼写错误速查表参见 CLI references。如果拼写问题与报错直接相关，升级为根因；否则在附加提示中列出。

### 步骤7：调用外部诊断接口（补充诊断）

> **[ALERT] 步骤7 的定位是"辅助补充"，不是"主要诊断手段"。**

**调用方式（推荐 CLI）：**

```bash
do-bigdata supersql job-analyze --supersql-session-id "{sessionId}" --query "<用户原始问题>" > /tmp/diag_{sessionId_short}.txt 2>&1 & echo "PID=$!"
```

**备选（直接调用 Python 脚本）：**

```bash
python3 {project_root}/do_cli/sub-cli/SuperSQL/supersql-job-analyzer/scripts/sql-failed-diag.py \
  --supersql_session_id "{sessionId}" > /tmp/diag_{sessionId_short}.txt 2>&1 & echo "PID=$!"
```

**结果解析：** 从输出中提取 `"最终诊断结果如下"` 到结尾分隔线之间的内容。

**[ALERT] 方案采用规则：** 如果外部诊断结论中包含了具体的解决方案，必须直接采用，严禁用 AI 推理的"等价方案"替换。

### 步骤7.5：Yarn Application 深度下钻（按需触发 — 模糊错误场景为强制触发）

**触发条件：** 存在 applicationId 且 SuperSQL 层面无法确定引擎内部根因时触发。

**[ALERT] 强制触发特征清单（匹配任一即必须下钻，严禁跳过）：**

以下错误特征属于**模糊错误**——错误信息本身不包含根因，真正的根因只存在于 Yarn Application 的 Driver/Container 日志中。匹配到任一特征时，**必须触发步骤7.5 下钻**，**严禁**仅凭模糊错误信息猜测根因后直接给出解决方案：

| 模糊错误特征 | 对应模式 | 下钻关注点 |
|-------------|---------|-----------|
| `Lost task ... UnknownReason` | 模式19h | 失败 Executor/Container 的 stderr 日志（常见：Executor OOM 被 YARN Kill） |
| `InterruptedException` + `Job aborted` | 模式19f | Driver 日志（常见：Driver OOM） |
| `Job aborted due to stage failure` + 无明确异常类名（非 OOM/ClassNotFound 等已知异常） | — | Container 日志 |
| `ExecutorLostFailure` / `executor lost` + 无具体原因 | — | 失败 Executor 的 stderr 日志 |

**[FAIL] 严禁以下行为：**
- [FAIL] 匹配到上述模糊错误后，不下钻就猜测"可能是 OOM"/"可能是网络抖动"并直接给出泛泛建议（如"建议增加内存或重试"）
- [FAIL] 将 `UnknownReason`、`InterruptedException` 等模糊描述直接作为根因输出
- [FAIL] 在诊断报告中输出"根因：Executor 异常丢失（UnknownReason）"后不做下钻就给解决方案

**[OK] 正确做法：**
- [OK] 识别到模糊错误 → 触发步骤7.5 → 加载 `yarn-app-diagnose` skill → 拉取 Container/Driver 日志 → 从日志中获取真正根因（如 `OutOfMemoryError`、`Container killed by YARN`）→ 基于真正根因给出解决方案

**[ALERT] 执行方式：** 必须调用 `use_skill` 工具加载 `yarn-app-diagnose` skill。**严禁自己手动 curl Yarn API 接口。**

### 步骤8：专家兜底分析

**触发条件：** 步骤4 未匹配到已知模式、iWiki 和本地文档均无方案、步骤7 也未返回有效结果。

基于大数据领域专业知识给出分析和建议。步骤8 中使用预训练知识必须用不确定语气，标注 `（来源：专家兜底 — 基于预训练知识推测，建议用户验证）`。

## 常见问题快速应答

当用户询问 SuperSQL 使用方法类问题（非堆栈诊断）时，**必须附带对应的 iWiki 官方文档链接**。

### 问题→文档映射表

| 用户问题关键词 | 推荐文档 | iWiki 链接 |
|--------------|---------|-----------|
| Iceberg、iceberg 表、访问 iceberg | SQL访问 Iceberg 表 | https://iwiki.woa.com/p/4010775929 |
| JDBC 接入、JDBC 连接 | SuperSQL JDBC 简单示例 | https://iwiki.woa.com/p/800796319 |
| SuperSQL FAQ、常见问题 | SuperSQL FAQ | https://iwiki.woa.com/p/800796902 |
| 错误码、error code | SuperSQL Error Code 对照表 | https://iwiki.woa.com/p/1014338144 |
| 排查链路、日志排查 | 任务报错排查链路 | https://iwiki.woa.com/p/4017200961 |
| SQL 语法 | SuperSQL SQL 语法 | https://iwiki.woa.com/p/800805070 |
| 计算引擎、引擎选择 | SuperSQL 计算引擎 | https://iwiki.woa.com/p/800804474 |
| 数据源、数据源配置 | SuperSQL 数据源介绍 | https://iwiki.woa.com/p/800803628 |
| 元数据命令、REFRESH | SuperSQL 元数据命令 | https://iwiki.woa.com/p/800805988 |
| SuperSQL 日志、查看日志 | 如何查看 SuperSQL 日志 | https://iwiki.woa.com/p/4018506283 |
| THive 日志 | 如何查看 THive 日志 | https://iwiki.woa.com/p/4018546746 |
| Livy 日志 | 如何查看 Livy 日志 | https://iwiki.woa.com/p/4018546742 |
| 常用参数、参数配置 | 现网常用 SuperSQL 参数汇总 | https://iwiki.woa.com/p/4012749190 |
| get_json_object、JSON 解析 | SuperSQL FAQ | https://iwiki.woa.com/p/800796902 |
| 函数使用 | SuperSQL 函数相关使用说明 | https://iwiki.woa.com/p/907306645 |

### JDBC 接入方式的引擎限制

- **JDBC 不支持 Presto**：通过 JDBC 方式连接 SuperSQL 时，无法使用 Presto 作为执行引擎。
- **JDBC 使用 StarRocks 需业务自提供集群**。

## 参考文档

查阅参考文档（详细的堆栈模式、架构、错误码、排查工具等知识均在此处）：
```bash
do-bigdata docs list --skill supersql-job-analyzer
do-bigdata docs show --skill supersql-job-analyzer --file architecture.md
do-bigdata docs show --skill supersql-job-analyzer --file error_codes.md
do-bigdata docs show --skill supersql-job-analyzer --file stack_patterns.md
do-bigdata docs show --skill supersql-job-analyzer --file troubleshooting.md
do-bigdata docs show --skill supersql-job-analyzer --file tdw_spark_toolkit.md
```

- `architecture.md` — SuperSQL 架构、模块结构、核心类映射、完整请求处理链路、Livy/THive 架构与调用链路、异常传播链
- `error_codes.md` — 错误码完整对照表、异常包装链路、noBypassException 判断逻辑、Livy 错误码体系、THive DDLTask 异常对照
- `stack_patterns.md` — 32种典型堆栈错误模式、关键词速查表、排查方案、Livy/THive 深层堆栈模式
- `troubleshooting.md` — 日志获取完整链路、排查工具、常用参数、FAQ速查、iWiki文档索引
- `tdw_spark_toolkit.md` — TDW Spark Toolkit 知识文档

## 泛化堆栈处理

如果堆栈经过脱敏/泛化处理（包含 `#NUM`、`#TABLE_NAME`、`#FILE_PATH` 等占位符），诊断时忽略这些占位符，聚焦于类名、方法名、异常类型和错误描述进行模式匹配。

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
