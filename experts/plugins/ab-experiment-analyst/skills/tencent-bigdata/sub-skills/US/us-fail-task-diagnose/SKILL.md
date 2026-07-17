---
name: us-fail-task-diagnose
description: 诊断 US（统一调度）和 WeData 平台的任务失败问题。支持 US 任务日志链接/内容分析、错误诊断与解决方案，涵盖权限管理、任务配置、调度依赖、脏数据、出库入库失败、连接超时、SQL/脚本错误、HDFS权限、封闭域等各类失败场景。触发关键词：US任务、统一调度、任务日志、任务失败、出库入库失败、脏数据、权限错误、SQL报错、OOM、连接失败、脚本错误、Permission denied。
---

# US 失败任务诊断器

## 概述

分析 US（统一调度/Unified-Scheduler）任务实例日志，自动诊断任务失败原因，提取错误特征，并提供针对性解决方案。US 是腾讯内部研发的分布式调度平台（https://us.woa.com），每天管理数百万个任务实例。

**适用场景**：
- 任务执行失败（state=3），需要分析失败根因
- 任务报错（含 ERROR/FATAL/EXCEPTION 等错误信号）
- 出库/入库任务的脏数据、权限、连接等问题
- SQL/脚本执行错误
- HDFS 权限问题
- 封闭域相关问题

## 输出通道铁律（最高优先级 — 防止报告丢进 thinking 通道）

> *** 下列内容必须出现在 final assistant message（用户可见正文），禁止仅写入 thinking / reasoning 通道：**
> 1. 所有带 emoji 的进度行（* 当前环境 / ⏳ 级联诊断检查 / * 机器化取证结果 / * 已清理 / [WARN] 联系 kimlinlin）
> 2. **完整诊断报告**（基础信息 / 根因分析 / 解决方案 / 相关链接）
> 3. R4 收尾段（* 已清理 + [WARN] 联系 kimlinlin）
>
> **[ALERT] 报告丢失自检（每轮回复发出前必须自检）**：
> 若 final message 中出现「* 已清理」**但未出现**「## 根因」「基础信息」「解决方案」中的任意一段 → **判定为报告丢失到 thinking 通道**，必须立即重新输出完整报告（不要只补一句"报告如上"）。
>
> **允许仅在 thinking 中完成的内容**：自检清单逐项打勾、4×3 取证矩阵推理、证据行号反查。但**每一条的结论**必须以 1 行简短形式落到 final message（例如：`✓ HDFS 三方对比通过` `✓ Application ID 已级联 YARN`）。
>
> **禁止表达式**：
> - [FAIL] 在 thinking 中写完整报告草稿后，final message 只输出收尾段
> - [FAIL] "暂缓输出"、"先憋着"、"等下再回复" — 凡是已经分析出根因，必须当轮一次性把报告 + 收尾段作为整体 final message 输出
> - [FAIL] 把"必须输出用户可见的进度消息"理解为"思考过程描述"

## 强制输出规则（铁律）

> **[WARN] 每次给用户输出诊断报告、回答咨询、给出方案后，回复的最末尾必须附加以下内容（加粗高亮，不可省略）：**
>
> **[WARN] 如果US或WeData使用上有任何问题，可以直接联系 kimlinlin**
>
> 无论诊断成功还是失败，无论是完整报告还是简短回复，都必须在最后一行输出此提示。

> ### R4 缓存清理收尾（强制 — 与 v2 物化方案配套）
>
> 完整诊断报告与收尾段必须**作为同一条 final message 一次性输出**（禁止拆分到多轮回复，禁止只输出收尾段而把报告留在 thinking）。结构如下：
>
> ```
> [完整诊断报告 — 基础信息 / 根因分析 / 解决方案 / 相关链接]
>
> * 已清理本次诊断缓存（task-id=<TID>，N 个文件，X MB）
>
> [WARN] 如果US或WeData使用上有任何问题，可以直接联系 kimlinlin
> ```
>
> 清理命令在报告写完之后、final message 发出之前通过 execute_command 顺序执行：
>
> ```bash
> # 步骤 1：先 dry-run 确认清单（强制）
> do-bigdata us clean-cache --task-id <本次诊断的 TID> --dry-run
> # 步骤 2：清单无误后真删
> do-bigdata us clean-cache --task-id <本次诊断的 TID>
> ```
>
> **[NO] 例外（禁止清理）**：以下情况必须保留缓存供后续追问，仅在最终对话结束时清理：
> - 用户在同一对话中明确表示"还要继续看 / 还有问题 / 再查一下"
> - 诊断结论标记为"待确认"或"需要进一步取证"
> - 用户要求保留证据（如"留着我让别人看看"）
>
> **[SHIELD] 兜底**：即使 LLM 漏调用 `clean-cache`，每次任意 `*-log` 命令启动时会自动 GC 超过 72 小时的孤儿缓存（由环境变量 `DO_BIGDATA_CACHE_TTL_HOURS` 覆盖）。

## 非本技能领域请求的路由规则

当用户的请求不属于本技能的诊断范围时，**必须**根据以下映射加载正确的子技能：

| 用户请求 | 应路由到 | 动作 |
|---------|---------|------|
| 上传脚本、创建任务、修改任务、冻结/解冻、补录、回溯、重跑、终止、强制成功、复制任务、创建依赖等**操作类请求** | `us-operate-diagnose` | 通过 `read_file` 加载其 SKILL.md 并按流程执行 |
| 任务慢、耗时异常、跑得慢、执行时间长、超时等**慢任务诊断请求** | `us-slow-task-diagnose` | 通过 `read_file` 加载其 SKILL.md 并按流程执行 |
| 脚本下载、脚本查询、WeData 开发态日志查询、US 视图查询、任务列表查询等**查询类请求** | `us-log-analyzer` | 通过 `read_file` 加载其 SKILL.md 并按流程执行 |

*** 禁止在非操作类子技能中直接调用写操作命令（如 `upload-script`、`create-task`、`execute-freeze`、`execute-redo` 等）。必须先路由到 `us-operate-diagnose` 加载其完整流程规则后再执行。**

## 执行规则

> *** 完整的执行规则（铁律、参数自检清单、执行检查清单）请参阅：`do-bigdata docs show --skill us-fail-task-diagnose --file execution-rules.md`**

### [NO] 禁止访问共享存储路径

**严禁**通过 `ls`、`cat`、`read_file` 等方式访问任务配置中的文件路径（如 `/data/lhotse/shared_mfs/...`、`/data/us/...` 等共享存储路径）。这些路径是 US 调度平台执行机器上的本地路径，在当前环境中**完全不可访问**。

获取脚本内容的**唯一正确方式**（按任务类型选择接口，纯 WeData 任务才走 WeData 接口）：
1. **纯 WeData 任务（task ID 17 位）** → **WeData 文件下载 API**：`do-bigdata us download-file --project-id <PID> --task-id <TID>`。其中 `--project-id` **可通过 US 的 `query-task` 接口查询拿到（无需用户手动提供）**，因此只要有 task ID 即可：先 `query-task` 取回 project-id，再传入 `download-file`。
2. **US 任务（task ID 18 位）** → **US 脚本下载 API**：`do-bigdata us download-script --task-id <ID>`
3. 选用接口失败时可自动尝试另一种接口兜底，两者都失败再报错。

**失败任务诊断模式的具体流程**：

**全量诊断模式**（无定位参数）的具体流程：
1. **环境识别** → 识别 namespace：链接含 `us-sg.woa.com` 或 `wedata-sg.woa.com` → namespace=sg（新加坡）；**用户明确声明"新加坡环境/SG 环境"等（即使未提供 SG 域名链接） → namespace=sg（新加坡）**；其他 → namespace=default（国内）。若链接域名与用户声明冲突（如声明 SG 但提供国内域名链接），以链接为准并提示用户确认。识别完毕后输出环境声明：`* 当前环境：国内（default）` 或 `* 当前环境：新加坡（sg）`
2. 凭证检查阶段 → 回复「正在验证凭证...」，完成后 → 「凭证验证通过 ✓」
3. 第一批采集 → 回复「正在获取任务配置和依赖关系...」，使用 `execute_command` **并行调用** `query-task` 和 `relation` 两个命令，完成后 → 「任务配置和依赖关系已获取 ✓」
4. 第二批采集 → 回复「正在获取实例状态、阶段日志和执行日志...」，使用 `execute_command` **并行调用** `query-run`、`stage-log`、`log`、`original-log` 四个命令（`original-log` 需要 broker 信息，全量模式下如果无定位参数则跳过，等第三批获取到 broker 后再调用）；**如果任务状态为失败（state=3）**，在同一批中额外并行调用 `fail_task_analyze` 接口（详见下文「失败任务智能分析接口」章节）；*** 如果是 WeData 调度态（从 URL 中可提取 ProjectId、TaskId、CurRunDate）**，在同一批中**必须额外并行调用** `do-bigdata us describe-log --project-id <PID> --task-id <TID> --cur-run-date "<DATE>" --query "任务失败诊断"` 获取 WeData 侧完整日志（describe-log 能补充 stage-log 拿不到的引擎层异常细节，如 Data too long for column 等底层错误），完成后 → 「全部信息已获取 ✓ 正在分析...」

> [WARN] **namespace 参数传递**：当 namespace=sg 时，上述所有 `do-bigdata us` 命令必须附加 `--skill-namespace sg` 参数。

> ### [SEARCH] [自检] HDFS 权限错误触发时的 stage-log 完整性检查
>
> 当日志中检测到 `Permission denied` / `AccessControlException` / `RangerAccessControlException` 等 HDFS 权限错误时，**必须立即执行以下自检**：
>
> | 自检项 | 检查内容 | 通过条件 |
> |--------|---------|---------|
> | stage-log 是否已获取 | 检查是否已成功调用 `stage-log` 接口 | 接口返回非空 |
> | 实际执行集群是否已提取 | 在 stage-log 中搜索 `fs.defaultFS=hdfs://` 或 `[HDFS Server] host=` | 成功提取到集群标识 |
>
> **判定**：
> - [OK] 两项均通过 → 继续执行「Permission denied 快速判定决策树」（见 error-patterns.md）进行三方对比
> - [FAIL] stage-log 未获取 → **必须重新调用 `stage-log` 接口**（不可仅凭 log 中的信息输出报告）
> - [WARN] stage-log 已获取但未提取到集群信息 → 在报告中注明「无法确定实际执行集群」，建议用户检查任务类型是否正确

> ### [SEARCH] 全量日志语义模式扫描（强制 — 不依赖日志级别）
>
> 获取所有日志后（stage-log、log、original-log、describe-log），**必须**用以下语义模式对**全量内容**做关键词扫描，**不论日志行标记的是 INFO / WARN / ERROR**：
>
> | 扫描类别 | 关键词 | 说明 |
> |---------|--------|------|
> | 异常类名 | `java.\w+(\.\w+)*Exception` / `Caused by:` / `Error:` | 任何 Java 异常类，不论所在级别 |
> | SQL/JDBC 异常 | `SQLException` / `DataTruncation` / `BatchUpdateException` | JDBC 层写入异常 |
> | 数据超长/截断 | `Data truncation` / `Data too long for column` / `Incorrect string value` | 字段值超限或编码不匹配 |
> | 约束违反 | `Duplicate entry` / `Column.*cannot be null` / `Out of range value for column` | 主键冲突/NOT NULL/数值越界 |
> | 框架脏数据信号 | `脏数据` / `dirty` / `errorLimit` / `errorRecord` / `reject` / `failed_write` | 框架脏数据统计（常在 INFO 级别！） |
> | 连接异常 | `Communications link failure` / `Connection refused` / `Connection reset` / `timed out` | 数据库/网络连接中断 |
> | 资源异常 | `OutOfMemoryError` / `GC overhead` / `OOM` | 内存耗尽 |
> | 任务状态 | `SYNC_FAIL` / `final status: FAILED` / `FAILED` / `FATAL` | 最终失败信号 |
>
> *** 框架级别陷阱警告**：DataX/Lhotse/数据同步引擎会将脏数据明细以 `[INFO]` 级别输出（如 `[INFO] java.sql.SQLException: Data truncation: Data too long for column 'url'`）。**绝对禁止仅按 `[ERROR]` 标签过滤**。
>
> **处理规则**：
> - 命中任一关键词 → 将匹配的日志片段纳入根因分析的证据链（不论其日志级别）
> - 未命中 → 在内部标记"该日志源无额外错误信号"，继续后续流程
> - **业务结果反证**：如果任务 FAILED + 脏数据条数 > 0，但扫描未命中数据质量关键词 → 说明扫描范围不足，必须扩大读取范围重扫
> - *** 禁止跳过此扫描步骤**：即使某个日志源已找到错误，其他源可能包含更底层的引擎异常细节

> ### * 步骤 3.4 全量日志机器化取证（强制 — 不可跳过）
>
> *** v2 物化方案（2026-06）**：流程从"多次 fetch+scan"重构为"一次 fetch + N 次本地 grep"，节省 token 与 HTTP。
>
> **触发**：步骤 3 任一日志类命令调用完成后立即执行，**无视根因是否已猜到**。
>
> ---
>
> #### 阶段 1：批量物化（仅一次 HTTP，并行落盘三件套）
>
> 4 个日志命令带 `--no-scan` **并行**执行，只落盘不渲染、不扫描：
>
> ```bash
> do-bigdata us describe-log  --project-id <P> --task-id <T> --cur-run-date "<D>" --log-run-num <N> [--log-time <LT>] --no-scan
> do-bigdata us stage-log     --task-id <ID> --date <DATE> --no-scan
> do-bigdata us log           --task-id <ID> --date <DATE> --no-scan
> do-bigdata us original-log  --task-id <ID> --date <DATE> --broker <IP-PORT> --no-scan
> ```
>
> 每条命令产出最多 3 个文件（统一存放于 `.log_cache/`）：
>
> | 文件 | 内容 | 作用 |
> |---|---|---|
> | `<base>.json` | 原始 API JSON（仅 describe-log） | `--output json` / 后续重放 |
> | `<base>.raw.txt` | **完整无损纯文本视图** — JSON 树打平到字段路径，所有字段（含将来新增字段）自动落盘 | ★ 后续本地扫描的唯一数据源 |
> | `<base>.meta.json` | 字段路径 → 行号区间 + 行数 + 抽样首行 | `scan-cache --list-fields` 总览用 |
>
> ---
>
> #### 阶段 2：本地总览（0 HTTP）— 看清楚有哪些字段
>
> ```bash
> do-bigdata us scan-cache --task-id <TID> --list-fields
> ```
>
> 输出示例（每个字段都列出行数+首行抽样，新增字段一目了然）：
> ```
> ── wedata_<TID>_<DATE>_3.raw.txt  (4211 行, 18 字段)
>     [Response.Data.ErrorInfo]   lines=1   L12-L12   ↳ 任务执行失败...
>     [Response.Data.DataXLog]    lines=4030 L57-L4087 ↳ [INFO] DataX start...
>     [Response.Data.PluginLog]   lines=33  L4090-L4123 ↳ ...
> ```
>
> ---
>
> #### 阶段 3：本地精扫（0 HTTP，可多次免费迭代）
>
> ```bash
> # 一站式全 preset 扫描（合并 4 个 *-log 的 .raw.txt）
> do-bigdata us scan-cache --task-id <TID> --scan-preset all
>
> # 单类预设
> do-bigdata us scan-cache --task-id <TID> --scan-preset jdbc
> do-bigdata us scan-cache --task-id <TID> --scan-preset resource
>
> # 自定义正则
> do-bigdata us scan-cache --task-id <TID> --regex "Data too long for column '[^']+'"
>
> # 字段定向（精确 grep 某字段下的内容，避免噪音）
> do-bigdata us scan-cache --task-id <TID> --field DataXLog --regex "SQLException"
> do-bigdata us scan-cache --task-id <TID> --field RunnerLogs --scan-preset perm
> ```
>
> 兜底：若需要直接 `grep`，4 个 `.raw.txt` 文件名前缀分别是：
> - `wedata_<TID>_<DATE>...` （describe-log）
> - `us_stage-log_<TID>_<DATE>...`
> - `us_log_<TID>_<DATE>...`
> - `us_original-log_<TID>_<DATE>...`
>
> ---
>
> #### 强制规则
>
> **R1（强制反证 — 跨预设泛化版）**
> 任务 state=3 但 `--scan-preset all` 命中总数 < 5 → **不可下结论**，必须执行：
> ```bash
> do-bigdata us scan-cache --task-id <TID> --list-fields
> ```
> 检查是否有任何字段 `lines > 100` 但完全未被扫到。如有 → 对该字段单独 `--field <X> --scan-preset all` 复扫。
>
> **R2（业务结果反证 — 通用版）**
> task_desc 中以下任一信号触发，但对应 preset 未命中 → 必须按映射逐字段 grep `.raw.txt`：
>
> | 业务信号 | 必须命中的 preset | 否则强制 grep 字段 |
> |---|---|---|
> | `failed_writed > 0` 或脏数据计数 > 0 | `jdbc` + `dirty` | DataXLog / PluginLog |
> | 状态 = OOM / killed | `resource` | RunnerLogs.Content / SparkLog |
> | 包含 HDFS 路径关键字 | `perm` | RunnerLogs.Content |
> | retries > 1 | `network` | TaskLogs / RunnerLogs |
> | 超时类描述 | `network` + `fatal` | 全字段（用 `--field` 逐个） |
>
> **R3（结论诚实度）**
> - 错误次数稳定递增（如 73→76→78）→ **禁止**写"偶发"，必须标记"系统性"，并溯源到具体字段/列名
> - `errorRate=0.0` → 解决方案中**禁止**只给"调大 errorRate"，必须先给"溯源根因"
> - 凡声称根因的语句，必须附 `.raw.txt` 行号 + 字段路径作为证据
>
> **R4（指纹库优先 — MVP）**
> `scan-cache` **默认开启**指纹库匹配（`references/error-fingerprints.json`），自动输出 `[指纹匹配]` 段。诊断报告**强制字段**：
> - 每个根因必须填 `指纹 ID`（若 scan-cache 未命中指纹则填 `none`）
> - 每个根因必须填 `文档依据`（指纹 ID 对应的 `doc_anchor`，如 `common-errors.md#1.11`）
> - 若 `指纹 ID = none` 且 `文档依据 = 空` → 报告**顶部**强制 banner：
>   > [WARN] 此根因未匹配到指纹库与官方文档，仅基于通用知识判断（置信度：低）。建议人工复核后通过 `references/error-fingerprints.json` 补充指纹。
> - 若输出 `[未匹配告警]` → 报告中必须保留这段告警原文（不可隐藏），并在末尾建议补充指纹
>
> ---
>
> #### 用户可见进度消息（必须输出）
>
> ```
> * 机器化取证结果（步骤 3.4）：
> ┌────────────────┬────────┬──────────────────────────────────────────────────────┐
> │ 日志源          │ 命中数 │ Top 命中类型                                          │
> ├────────────────┼────────┼──────────────────────────────────────────────────────┤
> │ stage-log      │  X     │ ...                                                  │
> │ log            │  X     │ ...                                                  │
> │ original-log   │  X     │ ...                                                  │
> │ describe-log   │  X     │ Data too long for column 'url' (78), SQLException(68)│
> └────────────────┴────────┴──────────────────────────────────────────────────────┘
> ```
>
> **入证据链规则（强制）**：所有命中条目（不论级别 INFO/WARN/ERROR）→ 直接写入诊断报告"关键证据"段，附**出现次数**+**字段路径**+**最早行号**。

> ### [OK] 输出顺序约束（步骤 3 → 级联检查 → 报告 + 收尾）
>
> 步骤 3 采集完成后，按以下顺序执行。**每一步的产物都必须落到 final message 用户可见正文，不是仅 thinking**。
>
> **动作 1（thinking 内）：加载级联规则文档**
> ```bash
> do-bigdata docs show --skill us-fail-task-diagnose --file cascade-diagnosis.md
> ```
> 此命令必须通过 `execute_command` 实际执行，不可跳过。文档读取过程可以放 thinking。
>
> **动作 2（→ final message）：向用户输出级联判断结果**
> 级联判断结果必须作为 **final assistant message 的一段用户可见进度提示**输出（不是仅写入 thinking），格式如下：
> ```
> ⏳ 级联诊断检查：
> - 执行状态：[成功/失败]
> - 提取到的关键 ID：[Application ID / Session ID / Connection ID 列表，或「无」]
> - ID 来源：[stage-log / log / fail_task_analyze / 均未找到]
> - 底层引擎：[Spark/MR/Flink/...]
> - 级联动作：[调用 XX skill（场景 A/B/C）]
> - [WARN] 无论根因是否已明确，满足触发条件即执行级联
> ```
> **注意**：当提取到关键 ID 时，不提供「不触发」选项。「不触发」仅用于真正无任何 ID 且降级策略也无法获取的情况。
>
> **动作 3（→ final message）：如果触发，立即读取下游 Skill 的 SKILL.md**
> 从下方步骤 3.5 的「快速决策表」确定目标 Skill，通过 `read_file` 读取其 SKILL.md，然后按其工作流执行。级联完成后，**当轮**把「US 报告 + 级联结论 + R4 收尾」作为同一条 final message 一次性输出。

3.5. **[WARN] 级联诊断判断与执行（独立步骤，必须在输出报告前完成）**

> #### [ALERT] 关键 ID 提取 — 强制搜索全部日志源（铁律）
>
> 提取 Application ID / Session ID / Connection ID 时，**必须同时搜索以下三个日志源**，缺一不可：
>
> | 日志源 | CLI 命令 | 包含内容 | 为什么必须搜索 |
> |--------|---------|---------|---------------|
> | **阶段日志（stage-log）** | `do-bigdata us stage-log` | 完整执行链路，包含 YARN 提交、SuperSQL 会话、各阶段详情 | **主要搜索源** — Application ID 通常出现在这里 |
> | **运行日志（log）** | `do-bigdata us log` | US Runner 层面的运行概况和错误摘要 | **补充搜索源** — 部分场景 ID 仅出现在此处 |
> | **原始日志（original-log）** | `do-bigdata us original-log` | broker 节点的原始执行日志，包含更完整的运行时输出 | **深度搜索源** — 某些 ID（如被截断的 Application ID、嵌套的 Session ID）仅出现在原始日志中 |
>
> **提取正则**：`application_\d+_\d+`、UUID 格式的 Session/Connection ID
>
> **[WARN] 禁止的错误模式**：
> - [FAIL] 只搜索 `log`（运行日志），不搜索 `stage-log`（阶段日志）→ 这是最常见的遗漏原因
> - [FAIL] 看到日志中有 `parse failed` / `SqlParseException` 等错误就断定"未提交到 YARN" → SuperSQL 存在 **Implicit Bypass 机制**（见下方说明），解析失败的 SQL 可能被透传给底层 THIVE 引擎执行，仍然会产生 YARN Application
> - [FAIL] 只搜索了其中一个或两个日志源就下结论"无 Application ID"
> - [FAIL] 忽略 `original-log` 中可能存在的额外 ID 信息

> #### ⚡ SuperSQL Implicit Bypass 机制感知（关键知识）
>
> SuperSQL 的 Calcite Parser 无法解析某些 SQL 语法（如 `DISTRIBUTE BY`、`SORT BY`、`CLUSTER BY` 等 HiveQL 专有语法）时，会触发 **Implicit Bypass 机制**：
> - 日志表现：出现 `SuperSQLException: parse failed`、`SqlParseException`、`Implicit Bypass` 等关键词
> - **实际行为**：SQL 被直接透传给底层 THIVE/Hive 引擎执行，**仍然会提交 YARN Application**
> - **因此**：看到 SuperSQL 解析错误 ≠ 没有提交到 YARN，**必须继续在 stage-log 中搜索 Application ID**

**快速决策表（内联，无需查阅外部文档即可做出正确决策）：**

| 条件 | 动作 |
|------|------|
| 有 Application ID | → **[无条件]** `read_file("../../Yarn/yarn-app-diagnose/SKILL.md")` → 执行。即使根因已明确也必须执行 |
| 有 Session/Connection ID | → **[无条件]** `read_file("../../SuperSQL/")` 下查找 SQL 链路诊断 Skill → 执行。即使根因已明确也必须执行 |
| 同时有 Session/Connection ID + Application ID | → **[无条件]** 同时执行上述两条 |
| 无关键 ID 但任务失败 | → 尝试从 `fail_task_analyze` 接口的 `appid` 字段获取 → 重新匹配 |

**完整规则**：`do-bigdata docs show --skill us-fail-task-diagnose --file cascade-diagnosis.md`（已在强制动作 1 中加载）

   - **执行阶段**：若触发，先完成所有级联诊断（SuperSQL → YARN）。通过快速决策表直接定位下游 skill（映射表无匹配时 fallback 到 `use_skill("find-skills")` 搜索）。级联诊断完成后，**当轮**在**同一条 final message** 中按「US 报告 + 级联诊断结论 + * 清理回执 + [WARN] 联系 kimlinlin」顺序合并输出，禁止把 US 报告草稿留在 thinking 不输出

> ### [OK] 自检清单（输出报告前必须回答以下问题）
>
> 在输出最终诊断报告前，**必须逐条检查以下清单**。如果有任何一项回答为「否」，必须返回执行对应的级联步骤：
>
> 1. 是否已同时搜索 stage-log、log 和 original-log 三个日志源提取关键 ID？
> 2. 所有提取到的 Application ID 是否都已进行了 YARN 级联诊断？
> 3. 所有提取到的 Session/Connection ID 是否都已进行了 SQL 链路级联诊断？
> 4. 如果日志中有 `fail_task_analyze` 的 `appid` 字段，是否已纳入级联判断？
> 5. 是否存在"根因已明确所以跳过级联"的情况？（如果是 → **必须返回执行级联**）
> 6. **如果是 WeData 调度态，是否已调用 `describe-log` 获取 WeData 侧完整日志？**（无论正常路径还是降级路径，WeData 调度态必须调用 `describe-log`）
> 7. **WeData describe-log 是否已执行错误关键词扫描？**（必须 grep `SQLException` / `Data truncation` / `Data too long` / `Duplicate entry` / `BatchUpdateException` / `Communications link failure` 等关键词，不可跳过）
>
> #### * 机器化取证矩阵（4×3 — 任一格 ☐ → 报告作废）
>
> | 日志源 | 已用 `--scan-preset` 扫描？ | 命中已入证据链？ | 未命中已反证扩范围？ |
> |---|:---:|:---:|:---:|
> | stage-log    | ☐ | ☐ | N/A |
> | log          | ☐ | ☐ | N/A |
> | original-log | ☐ | ☐ | ☐（最易截断） |
> | describe-log | ☐ | ☐ | ☐（必填） |
>
> #### * 任务类型对齐检查
> - 当前 typeId = ____
> - 对应 `error-patterns.md` "通用查证矩阵"中标注的 ★ 首选源 = ____
> - 是否已对该首选源执行 `--scan-preset all` 扫描？ ☐
>
> #### * 业务结果反证
> - 任务状态 = FAILED ？ ☐
> - 脏数据 > 0 ？ ☐
> - 4 源全部未命中 ？ ☐
> - **三项都为 ☑ → 必须扩大 lifecycleNum/broker 重扫，否则报告作废**

> ### [PKG] 封闭域文档自动加载触发（强制）
>
> 当以下**任一条件**满足时，**必须自动加载封闭域指南**：
> ```bash
> do-bigdata docs show --skill us-log-analyzer --file closed-domain-guide.md
> ```
>
> | # | 触发条件 | 检测来源 |
> |---|---------|---------|
> | 1 | 任务类型为封闭域任务（typeId 为 86/89/93/96/99/101/103/105/122） | query-task 返回的 `typeId` |
> | 2 | 应用组名包含 `close`（如 `g_teg_close_xxx`） | query-task 返回的应用组信息 |
> | 3 | YARN 集群名 / HDFS namespace 包含 `close`（如 `ss-pcg-close-v2`、`qy-ieg-close-v3`、`ss-cdg-close-v3`、`qy-wxg-close-v3`、`qy-tme-close-v3`、`ss-siaa-close-v3`、`hdfs-sw0-csig-yuanbao-close-v3`） | stage-log 中的 `fs.defaultFS` 或 query-task 中的 `targetServer` |
> | 4 | 日志中出现 `Connection refused` + 封闭域 HDFS nameservice（含 `close` 关键字） | stage-log 或 log |
> | 5 | 日志中出现 `is readOnly to current client` 或 `UnsupportedOperationException` + `readOnly` | stage-log 或 log |
>
> **注意**：此触发与级联诊断（YARN/SuperSQL）相互独立，可同时触发。加载后按封闭域指南中的诊断流程执行。

4. 分析阶段 → 综合日志分析结果与 `fail_task_analyze` 接口返回的分析结果（如有），输出合并后的诊断报告

**精确定位模式**（URL 含 runtimeBroker/lifeCycleNum 等定位参数）的具体流程：
1. 凭证检查阶段 → 同上
2. 第一批采集 → 回复「正在获取任务配置和依赖关系...」，**并行调用** `query-task` 和 `relation`
3. 第二批采集 → **[ALERT] 构造命令前必须执行「参数自检清单」（见 `do-bigdata docs show --skill us-fail-task-diagnose --file execution-rules.md`）**。回复「正在获取第 N 次执行的日志...」（N 从 lifeCycleNum 获取），**并行调用** `stage-log`、`log` 和 `original-log`（**均带全部定位参数**，`original-log` 的 `--broker` 格式为 `IP-PORT`，由 runtimeBroker + runTimePort 拼接），**不调用** `query-run`；**如果任务状态为失败（state=3）**，在同一批中额外并行调用 `fail_task_analyze` 接口；*** 如果是 WeData 调度态 URL（步骤 0 判定命中规则 #3 或 #6）**，在同一批中**必须额外并行调用** `do-bigdata us describe-log` 获取 WeData 侧日志（参数映射详见 `do-bigdata docs show --skill us-fail-task-diagnose --file platform-and-log.md`）

> **[PIN] 采集后处理**：同上方全量诊断模式的「HDFS 权限自检」「* STOP 级联诊断强制动作」「步骤 3.5 级联诊断判断与执行」规则，此处不再重复。

4. 分析阶段 → 综合日志分析结果与 `fail_task_analyze` 接口返回的分析结果（如有），输出合并后的诊断报告（只分析这一次执行）

每批内的多个 `execute_command` 调用应在同一个 tool call batch 中并行发出。

## 工作流程

> *** 平台识别、凭证检查、URL 参数解析、日志获取规则请参阅：`do-bigdata docs show --skill us-fail-task-diagnose --file platform-and-log.md`**

### 第一步：获取日志内容

按 `do-bigdata docs show --skill us-fail-task-diagnose --file platform-and-log.md` 中定义的流程获取日志。

### 第二步：识别任务类型和阶段

从日志内容中确定：

1. **任务类型**：TDW2MySQL、TDW2ClickHouse、TDW2PG、TDW2HDFS、TDW2HBase、TDW2Doris/StarRocks、HDFS2TDW、MySQL2TDW、HBase2TDW、Flink2TDW、PythonSQL、PySpark、SparkScala、MapReduce（配置式/命令行/Streaming）、Shell、SuperSQL、SQL计算、TDBank、微信计算等。
2. **出错的执行阶段**：
   - 调度阶段（实例调度）：实例生成 → 依赖检查 → 下发执行
   - 运行阶段（实例运行）：初始化 → 数据处理 → 数据写入 → 完成
3. **底层引擎**：Spark、MapReduce、DataX、SuperSQL JDBC、PLC Client

### 第三步：提取错误特征

> *** 完整的错误模式匹配规则（分析顺序、11 类错误模式、HDFS 权限专项诊断）请参阅：`do-bigdata docs show --skill us-fail-task-diagnose --file error-patterns.md`**

从日志中按**语义模式**扫描错误特征（不依赖日志级别标签）。涵盖出库/脏数据、入库/分区、权限/连接、资源/超时、SQL/脚本、HDFS/文件、Shell、封闭域等 11 类错误场景。

**[WARN] 日志级别陷阱警告**：部分框架（DataX/Lhotse/数据同步）会将致命的脏数据异常以 `[INFO]` 级别输出（如 `[INFO] java.sql.SQLException: Data truncation: Data too long for column`）。**绝对禁止仅靠 `[ERROR]` 标签过滤日志**——必须用语义关键词扫描全量日志内容。

### 第四步：诊断并给出解决方案

> *** 完整的报告模板、权限凭证交叉验证、Permission denied 提问策略请参阅：`do-bigdata docs show --skill us-fail-task-diagnose --file report-template.md`**
>
> *** 级联深度诊断的完整规则请参阅：`do-bigdata docs show --skill us-fail-task-diagnose --file cascade-diagnosis.md`**

#### 强制约束（不可省略）

1. **证据链**：每条结论必须引用 1~2 条最关键的日志片段（`>` 引用块），无日志支撑的结论禁止写入
2. **根因强制字段**（与 R4 配套）：
   - `根因`：一句话总结
   - `指纹 ID`：来自 scan-cache `[指纹匹配]` 段；未命中填 `none`
   - `文档依据`：指纹对应的 `doc_anchor`（如 `common-errors.md#1.11`）；未命中留空并在报告顶部加 [WARN] banner
3. **报告必备段落**：基础信息 / 执行记录 / 根因分析 / 解决方案 / 相关链接（HDFS 类任务额外加"配置一致性检查"，依赖失败场景额外加"依赖链路"）
4. **结尾固定提示**：`[WARN] 如果US或WeData使用上有任何问题，可以直接联系 kimlinlin`
5. **HDFS Permission denied 场景**：必须执行权限凭证三方交叉验证（详见 report-template.md 第三节）

[WARN] 输出报告前必须通过 `docs show --file report-template.md` 加载完整模板，按其格式输出。

#### 动作二：询问下载日志

**必须主动询问用户**：是否需要将该实例的运行日志和阶段日志下载到本地？

参考 `do-bigdata docs show --skill us-log-analyzer --file troubleshooting-guide.md`、`do-bigdata docs show --skill us-log-analyzer --file common-errors.md`、`do-bigdata docs show --skill us-log-analyzer --file us-user-guide.md`、`do-bigdata docs show --skill us-log-analyzer --file closed-domain-guide.md` 获取详细诊断流程和解决方案。

#### 动作三：清理临时诊断文件

**诊断报告输出完成后（无论用户是否选择下载日志），必须执行临时文件清理。此步骤不可省略。**

清理范围（基于当前诊断涉及的 taskId 和 date）：
1. **阶段日志文件**：当前 Skill 目录下的 `{taskId}_{date}_stage.json` 文件
2. **运行日志文件**：当前 Skill 目录下的 `{taskId}_{date}.log` 文件
3. **原始日志文件**：当前 Skill 目录下的 `{taskId}_{date}_original.log` 文件
4. **WeData 缓存文件**：`../us-log-analyzer/scripts/.log_cache/` 目录下匹配 `wedata_{taskId}_*.json` 的文件

清理规则：
- **精准清理**：只删除本次诊断产生的文件（按 taskId 匹配），不影响其他诊断任务的缓存
- **静默执行**：清理过程不需要询问用户确认，直接执行
- **容错处理**：如果文件已不存在或删除失败，忽略错误继续执行，不中断流程
- **清理时机**：在诊断报告输出之后、Step 4 上报之前执行
- **清理确认**：清理完成后在报告末尾附加一行简要说明，例如："* 已清理本次诊断产生的 N 个临时文件"

## 失败任务智能分析接口

> *** 完整的接口文档（地址、参数、返回字段、使用规则）请参阅：`do-bigdata docs show --skill us-fail-task-diagnose --file fail-task-analyze-api.md`**

当任务状态为失败（state=3）时，在第二批采集中**额外并行调用** `fail_task_analyze` 接口，作为辅助参考与日志分析结果交叉比对，整合进诊断报告中。

## 关键参考链接

> *** 完整的参考链接列表（US 平台、排障 FAQ、数据出库、权限、任务配置、运维工具）请参阅：`do-bigdata docs show --skill us-fail-task-diagnose --file reference-links.md`**

## CLI 命令

通过 `do-bigdata us` 命令组进行数据采集，详见 `../us-log-analyzer/SKILL.md` 中的完整命令说明。

**关键命令**：
- `do-bigdata us query-task --task-id <ID> --query "查询任务"`
- `do-bigdata us relation --task-id <ID> --query "查询依赖"`
- `do-bigdata us query-run --task-id <ID> --start <DATE> --end <DATE> --query "查询实例"`
- `do-bigdata us stage-log --task-id <ID> --date <DATE> --query "获取阶段日志"`
- `do-bigdata us log --task-id <ID> --date <DATE> --query "获取执行日志"`
- `do-bigdata us original-log --task-id <ID> --date <DATE> --broker <IP>-<PORT> --output-dir . --query "获取原始日志"`
- `do-bigdata us describe-log --project-id <PID> --task-id <TID> --cur-run-date "<DATE>" --query "查询WeData日志"`

### 凭证配置

凭证由 CLI 的 `@auth_required` 装饰器自动管理。首次使用通过 `do-bigdata auth init` 配置。

CMK 密钥获取：https://wedata.woa.com/security/user/keys

## 参考文档

通过 `do-bigdata docs` 命令访问：

```bash
do-bigdata docs list --skill us-log-analyzer
do-bigdata docs show --skill us-log-analyzer --file <文件名>.md
```

**可用文档**：
- `troubleshooting-guide.md` — 按任务类型和失败阶段的详细排障流程，含任务责任人管理流程
- `common-errors.md` — 完整的错误码索引及解决方案，含 US 工具箱完整分类列表
- `us-user-guide.md` — US 平台使用指南
- `us-task-types.md` — US 任务类型配置指南
- `closed-domain-guide.md` — 封闭域使用指南
- `us-api-identification.md` — US API 前缀识别规则
- `gaia-clusters.md` — Gaia 集群 ID 与名称映射表
- `us-faq.md` — US 常见问题（FAQ）
- `tdw-sql-common-issues.md` — TDW SQL 常见问题汇总

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
