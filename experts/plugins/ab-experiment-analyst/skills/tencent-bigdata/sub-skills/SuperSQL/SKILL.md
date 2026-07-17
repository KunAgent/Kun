---
name: supersql-skills
description: "SuperSQL 技能总览。汇总所有 SuperSQL 相关的诊断、排查、分析技能，包括堆栈诊断与问题排查（supersql-job-analyzer）、慢查询诊断（supersql-slow-query-analyzer）等。当用户提供 ss-qe-log.woa.com 链接（如 https://ss-qe-log.woa.com/v1/session/xxx）、supersql.logs.claw.woa.com 链接、或 SuperSQL sessionId（UUID 格式）时，必须进入本 Skill 处理，禁止直接 web_fetch/curl 访问这些内网地址。【铁律】确定路由到子 Skill 后，必须先加载该子 Skill（确保其 SKILL.md 中的铁律和门禁进入上下文），禁止不加载 Skill 就直接执行诊断脚本（裸诊断）。当用户询问 SuperSQL 相关问题或需要查找可用技能时，可参考此文档。"
---

# SuperSQL Skills 总览

> 本文档汇总 `skills/` 目录下所有 SuperSQL 相关 Skills，方便快速浏览和查找。

## 目录

| # | Skill 名称 | 目录 | 简介 |
|---|-----------|------|------|
| 1 | [SuperSQL 堆栈诊断与问题排查](#1-supersql-job-analyzer--supersql-堆栈诊断与问题排查) | `supersql-job-analyzer/` | 对 SuperSQL 报错堆栈、session 日志进行全链路诊断分析，定位根因并给出解决方案 |
| 2 | [SuperSQL 慢查询诊断与多 Session 比对](#2-supersql-slow-query-analyzer--supersql-慢查询诊断与多-session-比对) | `supersql-slow-query-analyzer/` | 诊断 SuperSQL 执行慢、耗时长的查询，支持单 Session 诊断和多 Session 横向比对 |

---

## [WARN] 场景路由表（最高优先级 — 选错 skill 等于诊断方向错误）

> **在执行任何诊断之前，必须先根据用户问题匹配下表，选择正确的 skill。选错 skill 会导致整个诊断方向错误。**

| 用户场景 | 正确的 Skill | [FAIL] 不要用 |
|---------|-------------|----------|
| SQL 执行**报错**、**失败**、异常堆栈 | `supersql-job-analyzer` | `supersql-slow-query-analyzer` |
| SQL 执行**慢**、耗时长、比以前慢、卡住 | `supersql-slow-query-analyzer` | `supersql-job-analyzer` |
| **对比**两个/多个 Session 的耗时差异 | `supersql-slow-query-analyzer` | `supersql-job-analyzer` |
| 提供了报错堆栈文本 | `supersql-job-analyzer` | `supersql-slow-query-analyzer` |
| 提供了 sessionId + "为什么慢" | `supersql-slow-query-analyzer` | `supersql-job-analyzer` |
| 提供了 sessionId + "为什么报错" | `supersql-job-analyzer` | `supersql-slow-query-analyzer` |
| 提供了 **session URL**（`ss-qe-log.woa.com` / `wedata.woa.com`） | 从 URL 中提取 sessionId，再按关键词路由到对应 Skill | [FAIL] **绝对禁止** `web_fetch` / `curl` 直接请求该 URL |
| **帮写 SQL**、建表、DDL、DML、分区管理 | `WeData/supersql-codegen`（跨目录引用） | — |
| 用户说"帮写建表 SQL"但**未指定数据库** | `WeData/supersql-codegen`（**默认 THive 语法**） | 社区 Hive/MySQL 语法 |
| 用户说"THive/TDW 建表" | `WeData/supersql-codegen`（THive 语法） | 社区 Hive/MySQL 语法 |
| 用户**明确说**"社区 Hive"/"MySQL"/"PG" | `WeData/supersql-codegen`（按指定语法） | — |
| 生成取数 SQL / 导出 SQL / 取数视图 | `WeData/supersql-codegen` | — |
| 通过一条 SQL 直接完成复杂计算 | `WeData/supersql-codegen` | — |
| Iceberg 表访问、Presto/Spark 访问 Iceberg、SQL 访问 Iceberg | `supersql-job-analyzer`（常见问题快速应答） | — |
| 诊断发现是**纯 THive Session 失败**（未经 SuperSQL 路由，Session ID 为纯数字） | `supersql-job-analyzer`（规则5：优先推荐开启 SuperSQL 执行 + Spark 3.3 参数组） | 直接给 SQL 改写方案 |

> **边界场景：** 如果用户的问题同时涉及"报错"和"慢"（如 Failover 场景：慢是因为失败重试），以**主要诉求**为准。通常"为什么慢"→ 先走 `supersql-slow-query-analyzer`，它会在步骤 2.4 联动 `supersql-job-analyzer` 的失败诊断能力。

> **[WARN] 失败诊断的三条铁律（历史教训固化）：**
>
> **铁律0（最高优先级）：确定走失败诊断后，必须先加载 `supersql-job-analyzer` 子 Skill，禁止"裸诊断"。**
> - **"裸诊断"定义**：没有加载子 Skill 的 SKILL.md 就直接执行诊断脚本、拉日志、给结论。此时 AI 上下文中没有步骤4的铁律约束，极大概率漏查 `stack_patterns.md` 知识库。
> - **历史教训**：AI 正确识别了 `ClassNotFoundException: MySequenceFileInputFormat`，但因为没加载 Skill，不知道必须查 `stack_patterns.md`（模式30已有精确到 HDFS 路径的验证方案），结果凭预训练知识"推测"了泛泛的修复建议。
> - **正确做法**：路由到 `supersql-job-analyzer` 后，**第一步**就是加载该 Skill（`use_skill("supersql-job-analyzer")`），确保步骤2~8的所有铁律、门禁、自检问题进入上下文后，再开始执行诊断流程。
> - **自检问题**："我是否已经加载了 `supersql-job-analyzer` 的 SKILL.md？" — 如果答案是否，**禁止执行任何诊断脚本或输出任何诊断结论**。
>
> **铁律1：失败诊断必须走完 `supersql-job-analyzer` 的步骤2~6，禁止只靠步骤7（外部诊断脚本 `job-analyze`）就下结论。**
> - 历史教训：外部诊断脚本只返回了 `code=9001`（Bypass 不兼容），AI 直接采信为根因。实际上 `code=9001` 是继发错误，真正的根因是更早的 `ClassNotFoundException`（JAR 包缺失）。只有通过步骤2拉取完整日志 + 步骤3.5 多 Error 时间顺序分析，才能正确区分根因和继发错误。
>
> **铁律2：`supersql-job-analyzer`（失败诊断）的步骤2中使用 `do-bigdata supersql slow-query-analyze` 命令拉取日志，但这不意味着走的是慢查询诊断流程。**
> - 这两个 skill 共用同一个日志拉取脚本。失败诊断用它只是拉取日志，后续分析必须按 `supersql-job-analyzer` 的步骤3~8执行（错误模式匹配、多 Error 时间顺序分析等），严禁混淆为 `supersql-slow-query-analyzer` 的慢查询诊断流程。

### [ALERT] 模糊意图反问策略（强制执行 — 违反等于诊断方向错误）

> **此规则与场景路由表同为最高优先级，必须在选择任何子 Skill 之前执行。**

当用户只提供了 sessionId / session 链接，但**未明确说明是"慢"还是"报错/失败"**时，**禁止默认选择任一 Skill**，必须先反问用户：

*"这个 Session 是**执行报错/失败**了，还是**执行慢/耗时不符预期**？我需要根据具体情况选择对应的诊断方式。"*

**判定规则：** 用户原文中包含以下任一关键词则视为意图明确，无需反问：
- 明确走**失败诊断**：报错、失败、异常、error、exception、堆栈、不能用、挂了
- 明确走**慢诊断**：慢、耗时长、卡住、比以前慢、性能差、为什么久、等了很久
- **不包含以上任何关键词 → 必须反问，绝对禁止跳过**

**[WARN] 常见违规场景（以下做法全部禁止）：**
- [FAIL] 用户说"帮诊断 [session链接]" → 直接选择 `supersql-slow-query-analyzer` → **错误！"帮诊断"不含慢/报错关键词，必须反问**
- [FAIL] 用户说"看看这个 session 什么问题" → 直接选择 `supersql-job-analyzer` → **错误！必须反问**
- [FAIL] 用户说"帮我分析一下" → 默认走慢查询诊断 → **错误！不能有默认偏好，必须反问**
- [FAIL] 用户给了 `ss-qe-log.woa.com` 链接 → 用 `web_fetch` / `curl` 直接请求该 URL → **严重错误！内网地址需要登录认证，永远无法直接访问。必须从 URL 中提取 sessionId，通过诊断脚本获取日志**
- [OK] 用户说"帮诊断 [链接]" → 反问"是执行报错/失败了，还是执行慢/耗时不符预期？" → **正确**
- [OK] 用户说"这个 session 报错了帮看看" → 包含"报错"关键词 → 直接走 `supersql-job-analyzer` → **正确**
- [OK] 用户说"这个查询很慢帮诊断" → 包含"慢"关键词 → 直接走 `supersql-slow-query-analyzer` → **正确**
- [OK] 用户给了 `https://ss-qe-log.woa.com/v1/session/xxx` + "报错" → 提取 sessionId `xxx` → 走 `supersql-job-analyzer` 诊断脚本 → **正确**

### [LINK] 跨 Skill 通用规则（所有 SuperSQL 子 Skill 必须遵守）

> **以下规则对 `supersql-job-analyzer`、`supersql-slow-query-analyzer` 及未来所有 SuperSQL 子 Skill 统一生效。各子 Skill 的 SKILL.md 中也有各自的重申，但此处为权威定义。**

#### 通用规则1：Application 链接输出规则（强制执行）

输出 Yarn ApplicationId 时，**必须且只能使用以下来源**，严禁自行拼接 URL：

1. **如果已调用 Spark 诊断脚本**（如 `spark_slow_diagnose.py`、`spark_history_api.py`），脚本输出中的 `brain_link` 字段已包含正确链接，**直接引用脚本输出**
2. **如需手动构造链接，使用且仅使用此模板**：
   ```
   https://brain.woa.com/diagnostic/diagnose/taskdetail?taskId={application_id}&source=tdwhelperredirect&diamode=basic&productId=4
   ```
3. **严禁凭记忆拼接任何其他域名的链接**（如 `bigdata.oa.com`、`tdwhelper.oa.com`、`yarn.xx.com` 等）
4. 如果不确定链接格式，只输出 Application ID 纯文本，不附带链接

#### 通用规则2：gaiaid 显示规则（强制执行）

当诊断中涉及 gaiaid 信息时（特别是任务跑到 `root.default` 队列的场景），**必须遵守以下显示规则**：

- **gaiaid=1386 是虚拟的无意义集群**，它本身不代表任何实际的 gaia/YARN 集群。当 gaiaid=1386 时，输出结论时**不显示 gaia 集群信息**，直接说"应用组 `{groupname}` 没有资源队列，导致跑到了 default 队列"即可
- **gaiaid 不等于 1386**（即是一个真实的 gaia 集群 ID）时，输出结论时需要显示 gaia 集群信息，说"应用组 `{groupname}` 在 gaia `{gaiaId}` 集群中没有资源队列，导致跑到了 default 队列"
- **gaiaid=1386 与任务跑到 default 队列是两件独立的事**。任务跑到 default 队列的根因是"应用组在对应集群没有资源队列"，gaiaid=1386 只是意味着该 gaiaid 值无参考意义、不应展示给用户。**严禁将两者混为因果关系**（如"因为 gaiaid=1386 是虚拟集群所以跑到了 default 队列"这种说法是错误的）

#### 通用规则3：事实性断言必须有数据出处

所有事实性结论必须有数据出处（API 返回数据、日志内容、脚本输出、参考文档中的明确定义）。没有数据支撑的推测，必须明确标注为 `[WARN] 推测（未验证）`。严禁将推测作为确定性结论输出。

---

### [NO] 内网 URL 处理铁律（最高优先级）

> **以下域名全部是需要登录认证的内网系统，绝对禁止使用 `web_fetch`、`curl`、`fetch_url` 等任何方式直接请求：**
>
> - `ss-qe-log.woa.com`
> - `supersql.logs.claw.woa.com`
> - `wedata.woa.com`
> - 所有 `*.woa.com` 域名
>
> **正确做法：从 URL 中提取 sessionId（UUID 格式），然后通过对应的诊断脚本（`sql-failed-diag.py` / `session_timeline.py`）获取日志数据。**

---

## 1. supersql-job-analyzer — SuperSQL 堆栈诊断与问题排查

**适用场景**：用户提供 SuperSQL 的报错堆栈、session 日志链接、客户端日志、WeData 日志链接、或询问 SuperSQL 相关的错误排查问题时使用。

### 核心能力

| 能力 | 说明 |
|------|------|
| 全链路追踪 | 追踪 SQL 从 SuperSQL → THive/Livy → Yarn Application 的完整执行路径 |
| 多层日志解析 | 通过诊断脚本自动获取并解析 SuperSQL/THive/Livy 三层 session 日志，提取 SQL、集群、引擎、applicationId |
| 错误模式匹配 | 内置 20+ 种典型堆栈错误模式，自动匹配根因并给出解决方案 |
| 外部诊断接口 | 调用 `sql-failed-diag.py` 获取知识库辅助诊断结论 |
| iWiki 动态方案 | 优先从 iWiki 拉取最新解决方案，保证方案时效性 |
| 专家兜底分析 | 未匹配已知模式时，基于 Java/Spark/Hive/Calcite 专业知识进行推断分析 |

### 输入

支持多种输入形式：
- SuperSQL sessionId（UUID 格式）
- SuperSQL session 日志链接（`ss-qe-log.woa.com` 或 `supersql.logs.claw.woa.com`）
- WeData 客户端日志链接（`wedata.woa.com`）
- 客户端日志文本（自动提取 sessionId）
- 报错堆栈文本（直接诊断）

### API 接口（仅供参考，不直接调用）

以下接口需要内网认证，诊断时通过 `sql-failed-diag.py` 脚本间接获取数据：

| 接口 | 方法 | 说明 |
|------|------|------|
| `http://supersql.logs.claw.woa.com/v1/session_log/{sessionId}` | GET | SuperSQL session 日志 |
| `http://supersql.logs.claw.woa.com/v1/livy/session/{sessionId}` | GET | Livy session 日志 |
| `http://supersql.logs.claw.woa.com/v1/session/{thiveSessionName}` | GET | THive session 日志 |

### 脚本工具

**日志拉取（步骤2 — 诊断主干）：**
```bash
# 一键拉取并解析三层日志（SuperSQL + Livy + THive），输出结构化 JSON
# [WARN] 此命令虽然名为 slow-query-analyze，但在失败诊断中仅用于日志拉取，后续分析流程仍按 job-analyzer 的步骤3~8执行
do-bigdata supersql slow-query-analyze --session-id "<sessionId>" --summary --pretty --query "<用户原始问题>"
```

**外部诊断接口（步骤7 — 辅助补充，不可替代步骤2）：**
```bash
# 调用外部诊断接口获取补充诊断结论
# [WARN] 此脚本的结论是辅助参考，不能作为唯一诊断依据。必须结合步骤2的完整日志做多 Error 时间顺序分析
do-bigdata supersql job-analyze --supersql-session-id "<sessionId>"

# 可选参数
do-bigdata supersql job-analyze --supersql-session-id "<sessionId>" --sql "SELECT ..." --exceptions "异常信息"
```

### 资源文件

| 文件 | 说明 |
|------|------|
| `supersql-job-analyzer/SKILL.md` | 完整的诊断工作流定义（步骤1-8） |

参考文档通过 CLI 命令查阅：
```bash
do-bigdata docs list --skill supersql-job-analyzer
do-bigdata docs show --skill supersql-job-analyzer --file architecture.md
do-bigdata docs show --skill supersql-job-analyzer --file error_codes.md
do-bigdata docs show --skill supersql-job-analyzer --file stack_patterns.md
do-bigdata docs show --skill supersql-job-analyzer --file troubleshooting.md
```

---

## 2. supersql-slow-query-analyzer — SuperSQL 慢查询诊断与多 Session 比对

**适用场景**：用户反馈 SuperSQL 执行慢、耗时长、比以前慢、查询卡住、多次执行耗时差异大、需要对比多个 Session 的耗时差异时使用。

### 核心能力

| 能力 | 说明 |
|------|------|
| 脚本辅助时间线 | 使用 `session_timeline.py` 自动拉取日志并构建结构化时间线 |
| 分层下钻诊断 | SuperSQL Session → THive/Livy 引擎 → Yarn/Spark 逐层分析 |
| 多 Session 比对 | 支持 2~N 个 Session 横向比对，自动检测差异点 |
| 止血原则 | 每层分析后判定是否需要继续下钻，避免无效深入 |
| 联动失败诊断 | Failover 场景自动联动 `supersql-job-analyzer` 的失败诊断能力 |

### 输入

- SuperSQL sessionId（UUID 格式）— 支持 1 个或多个
- SuperSQL session 日志链接
- 用户描述"同样的 SQL 昨天 30 秒，今天 300 秒"

### 脚本工具

```bash
# 单 Session 诊断
do-bigdata supersql slow-query-analyze --session-id "<sessionId>" --pretty --result-output /tmp/result.json

# 多 Session 比对
do-bigdata supersql slow-query-analyze --session-id "<id1>" --session-id "<id2>" --pretty --result-output /tmp/compare.json
```

### 下钻路由

| 场景 | 下钻目标 | 说明 |
|------|---------|------|
| 引擎 SQL 执行慢（S4） | **必须**加载 `spark-slow-analyzer` skill → 调用 `do-bigdata spark diagnose` | 下钻到 Spark Stage/Task/Executor 级分析数据倾斜、GC、Shuffle、资源不足等 |
| 多 Session 比对 + 引擎执行慢 | **必须**加载 `spark-slow-analyzer` skill → 调用 `do-bigdata spark compare --app-id {id1} --app-id {id2}` | 自动生成 App/Stage/Task/Queue 级差异报告 |
| History Server 不可用时 | 加载 `yarn-app-diagnose` skill → 获取 Driver 日志 → 多轮 grep 分析 | Fallback 方案 |
| Failover 导致的额外耗时 | 联动 `supersql-job-analyzer` 的 `do-bigdata supersql job-analyze` | 分析引擎为什么失败 |

> **[WARN] 严禁在引擎执行慢（S4）场景下，只停留在 SuperSQL session 日志层面就给出结论。必须下钻到 Spark/YARN 层面。**

### 资源文件

| 文件 | 说明 |
|------|------|
| `supersql-slow-query-analyzer/SKILL.md` | 完整的慢查询诊断工作流（步骤0-6） |

参考文档通过 CLI 命令查阅：
```bash
do-bigdata docs list --skill supersql-slow-query-analyzer
```

---

## 3. SQL 编写辅助 — 跨目录路由至 WeData/supersql-codegen

**适用场景**：用户需要编写 SQL（建表、DML、DQL、分区管理、取数 SQL、复杂 SQL 生成等）。

> [WARN] **此场景不在 SuperSQL 目录下单独维护子 Skill，统一路由到 `WeData/supersql-codegen`**。
>
> `supersql-codegen` 提供完整的 THive/SuperSQL SQL 生成能力，包括：
> - 建表语法规则（CREATE TABLE、PARTITION BY LIST、存储格式等）
> - INSERT / CTE / UDF 语法规则
> - 158 个跨引擎兼容函数白名单（StarRocks + Presto）
> - 取数 SQL 生成 API（`sql_gen_api.py`）
> - 复杂 SQL 生成 API（`complex_sql_gen_api.py`）
> - 49 个标准参考文档
> - **默认 THive 语法优先规则**（已合并自原 supersql-sql-helper）
> - **THive vs 社区 Hive 差异速查表**（已合并自原 supersql-sql-helper）
>
> 详见 `WeData/supersql-codegen/SKILL.md`。

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
