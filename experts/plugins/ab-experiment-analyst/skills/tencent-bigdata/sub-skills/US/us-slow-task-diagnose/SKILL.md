---
name: us-slow-task-diagnose
description: 诊断 US（统一调度）和 WeData 平台的慢任务、耗时异常问题。支持 US 任务阶段耗时分析、耗时对比、瓶颈定位、队列资源排查，涵盖调度等待、引擎提交、Application 运行等全链路耗时拆解。触发关键词：任务慢、执行慢、耗时长、耗时异常、跑得慢、超时、等待下发、运行时间长、调度延迟、队列排队、资源等待。
---

# US 慢任务诊断器

## 概述

分析 US（统一调度/Unified-Scheduler）任务实例日志，自动诊断任务耗时异常原因，拆解全生命周期各阶段耗时，定位性能瓶颈，并提供针对性优化建议。US 是腾讯内部研发的分布式调度平台（https://us.woa.com），每天管理数百万个任务实例。

**适用场景**：
- 用户反馈"任务跑得慢"/"执行时间长"/"比之前慢了很多"
- 任务耗时超出预期或超出告警阈值
- 任务长时间处于"等待下发"/"运行中"状态
- 需要定位任务全链路中的性能瓶颈

## 强制输出规则（铁律）

> **[WARN] 每次给用户输出诊断报告、回答咨询、给出方案后，回复的最末尾必须附加以下内容（加粗高亮，不可省略）：**
>
> **[WARN] 如果US或WeData使用上有任何问题，可以直接联系 kimlinlin**
>
> 无论诊断成功还是失败，无论是完整报告还是简短回复，都必须在最后一行输出此提示。

> ### R4 缓存清理收尾（强制 — 与 v2 物化方案配套）
>
> 每次完整诊断报告输出之后（即"联系 kimlinlin"提示**之前**），必须按顺序执行：
>
> ```bash
> do-bigdata us clean-cache --task-id <本次诊断的 TID> --dry-run
> do-bigdata us clean-cache --task-id <本次诊断的 TID>
> ```
>
> 清理后在报告末尾追加一行简短回执：
> ```
> * 已清理本次诊断缓存（task-id=<TID>，N 个文件，X MB）
> ```
>
> **[NO] 例外**：用户明确要求继续追问或保留证据时，禁止清理。
>
> **[SHIELD] 兜底**：每次任意 `*-log` 命令启动时会自动 GC 超过 72 小时的孤儿缓存。

## 非本技能领域请求的路由规则

当用户的请求不属于本技能的诊断范围时，**必须**根据以下映射加载正确的子技能：

| 用户请求 | 应路由到 | 动作 |
|---------|---------|------|
| 上传脚本、创建任务、修改任务、冻结/解冻、补录、回溯、重跑、终止、强制成功、复制任务、创建依赖等**操作类请求** | `us-operate-diagnose` | 通过 `read_file` 加载其 SKILL.md 并按流程执行 |
| 任务失败、错误日志、失败根因分析等**失败诊断请求** | `us-fail-task-diagnose` | 通过 `read_file` 加载其 SKILL.md 并按流程执行 |
| 脚本下载、脚本查询、WeData 开发态日志查询、US 视图查询、任务列表查询等**查询类请求** | `us-log-analyzer` | 通过 `read_file` 加载其 SKILL.md 并按流程执行 |

*** 禁止在非操作类子技能中直接调用写操作命令（如 `upload-script`、`create-task`、`execute-freeze`、`execute-redo` 等）。必须先路由到 `us-operate-diagnose` 加载其完整流程规则后再执行。**

## 执行规则

> *** 完整的执行规则（铁律、参数自检清单、执行检查清单）请参阅：`do-bigdata docs show --skill us-slow-task-diagnose --file execution-rules.md`**

**慢任务诊断模式的具体流程**：
1. **环境识别** → 识别 namespace：链接含 `us-sg.woa.com` 或 `wedata-sg.woa.com` → namespace=sg（新加坡）；**用户明确声明"新加坡环境/SG 环境"等（即使未提供 SG 域名链接） → namespace=sg（新加坡）**；其他 → namespace=default（国内）。若链接域名与用户声明冲突（如声明 SG 但提供国内域名链接），以链接为准并提示用户确认。识别完毕后输出环境声明：`* 当前环境：国内（default）` 或 `* 当前环境：新加坡（sg）`
2. 凭证检查阶段 → 回复「正在验证凭证...」，完成后 → 「凭证验证通过 ✓」
3. 第一批采集 → 回复「正在获取任务配置和依赖关系...」，使用 `execute_command` **并行调用** `query-task` 和 `relation` 两个命令，完成后 → 「任务配置和依赖关系已获取 ✓」
4. 第二批采集 → 回复「正在获取实例状态、阶段日志和执行日志...」，使用 `execute_command` **并行调用** `query-run`、`stage-log`、`log`、`original-log` 四个命令（`original-log` 需要 broker 信息，全量模式下如果无定位参数则跳过，等后续获取到 broker 后再调用）；*** 如果是 WeData 调度态（从 URL 中可提取 ProjectId、TaskId、CurRunDate）**，在同一批中**必须额外并行调用** `do-bigdata us describe-log --project-id <PID> --task-id <TID> --cur-run-date "<DATE>" --query "慢任务诊断"` 获取 WeData 侧完整日志（describe-log 能补充 stage-log 拿不到的引擎层耗时细节），完成后 → 「全部信息已获取 ✓ 正在分析...」
5. **[KEY] 慢任务专属步骤：获取上一周期日志** → 回复「正在获取上一运行周期的日志进行耗时对比...」，调用 `stage-log --task-id <TASK_ID> --date <上一周期数据时间> --output-dir .`，完成后 → 「耗时对比数据已获取 ✓」

> [WARN] **namespace 参数传递**：当 namespace=sg 时，上述所有 `do-bigdata us` 命令必须附加 `--skill-namespace sg` 参数。

> ### * 步骤 3.4 全量日志机器化取证（强制 — 不可跳过）
>
> *** v2 物化方案（2026-06）**：流程从"多次 fetch+scan"重构为"一次 fetch + N 次本地 grep"，节省 token 与 HTTP。
>
> **触发**：步骤 3 任一日志类命令调用完成后立即执行，**无视瓶颈是否已猜到**。
>
> #### 阶段 1：批量物化（仅一次 HTTP，并行落盘三件套）
>
> ```bash
> do-bigdata us describe-log  --project-id <P> --task-id <T> --cur-run-date "<D>" --log-run-num <N> [--log-time <LT>] --no-scan
> do-bigdata us stage-log     --task-id <ID> --date <DATE> --no-scan
> do-bigdata us log           --task-id <ID> --date <DATE> --no-scan
> do-bigdata us original-log  --task-id <ID> --date <DATE> --broker <IP-PORT> --no-scan
> ```
>
> 每条命令产出 `.json` / `.raw.txt`（JSON 树打平/纯文本视图）/ `.meta.json`（字段索引）三件套到 `.log_cache/`。
>
> #### 阶段 2：本地总览（0 HTTP）
>
> ```bash
> do-bigdata us scan-cache --task-id <TID> --list-fields
> ```
>
> #### 阶段 3：本地精扫（0 HTTP，按需多次）
>
> ```bash
> # 全 preset 扫描（合并 4 源）
> do-bigdata us scan-cache --task-id <TID> --scan-preset all
>
> # 慢任务专属：resource / network / yarn 三类预设
> do-bigdata us scan-cache --task-id <TID> --scan-preset resource
> do-bigdata us scan-cache --task-id <TID> --scan-preset network
> do-bigdata us scan-cache --task-id <TID> --scan-preset yarn
>
> # 自定义正则 / 字段定向
> do-bigdata us scan-cache --task-id <TID> --regex "GC overhead|exit code: 137"
> do-bigdata us scan-cache --task-id <TID> --field SparkLog --scan-preset resource
> ```
>
> #### R-slow（慢任务专属反证）
>
> | 业务信号 | 必须命中的 preset | 否则强制 grep 字段 |
> |---|---|---|
> | 总耗时增幅 > 50% | `resource` + `yarn` | RunnerLogs.Content / SparkLog |
> | 单 stage 卡顿 | `network` + `yarn` | RunnerLogs.Content |
> | Container 被杀 | `resource` | RunnerLogs.Content / TaskLogs |
>
> **入证据链规则（强制）**：所有命中条目（不论级别）→ 直接写入诊断报告"关键证据"段，附**出现次数**+**字段路径**+**最早行号**。

> ### * STOP — 严禁在此处直接输出报告
>
> 步骤 3 采集完成后，**必须执行以下强制动作**（不是思考，是动作）。不执行 = 执行失败。
>
> **强制动作 1：加载级联规则文档**
> ```bash
> do-bigdata docs show --skill us-slow-task-diagnose --file cascade-diagnosis.md
> ```
> 此命令必须通过 `execute_command` 实际执行，不可跳过。
>
> **强制动作 2：向用户输出级联判断结果（用户可见的进度提示）**
> [WARN] 级联判断结果必须作为**用户可见的进度消息**输出（不是内部思考），格式如下：
> ```
> ⏳ 级联诊断检查：
> - 总耗时增幅：+XX%（门槛 50%）→ [触发/未触发]
> - ⑤ Application 运行增幅：+XX%（门槛 50%）→ [触发/未触发]
> - 提取到的关键 ID：[Application ID / Session ID / Connection ID 列表，或「无」]
> - 底层引擎：[Spark/MR/Flink/...]
> - 级联动作：[调用 XX skill 的 YY 模式（场景 A/B/C/D）]
> - [WARN] 无论慢因是否已明确，满足触发条件即执行级联
> ```
> **注意**：当提取到关键 ID 时，不提供「不触发」选项。「不触发」仅用于真正无任何 ID 且不满足耗时触发条件的情况。
>
> **强制动作 3：如果触发，立即读取下游 Skill 的 SKILL.md**
> 从下方步骤 3.5 的「快速决策表」确定目标 Skill，通过 `read_file` 读取其 SKILL.md，然后按其工作流执行。

3.5. **[WARN] 级联诊断判断与执行（独立步骤，必须在输出报告前完成）**

**快速决策表（内联，无需查阅外部文档即可做出正确决策）：**

| 条件 | 动作 |
|------|------|
| 底层引擎=Spark + 有 1 个 App ID | → **[无条件]** `read_file("../../Spark/spark-slow-analyzer/SKILL.md")` → 执行 `diagnose` 模式。即使慢因已明确也必须执行 |
| 底层引擎=Spark + 有 2 个 App ID（含上一周期） | → **[无条件]** `read_file("../../Spark/spark-slow-analyzer/SKILL.md")` → 执行 `compare` 模式。即使慢因已明确也必须执行 |
| 底层引擎=MR/Flink + 有 App ID | → **[无条件]** `read_file("../../Yarn/yarn-app-diagnose/SKILL.md")` → 执行。即使慢因已明确也必须执行 |
| 有 Session/Connection ID | → **[无条件]** `read_file("../../SuperSQL/")` 下查找 SQL 链路诊断 Skill → 执行。即使慢因已明确也必须执行 |
| 无关键 ID 但耗时异常 | → `read_file("../../Yarn/yarn-queue-analysis/SKILL.md")` → 用应用组名+集群排查 |

**完整规则**：`do-bigdata docs show --skill us-slow-task-diagnose --file cascade-diagnosis.md`（已在强制动作 1 中加载）

> ### [OK] 自检清单（输出报告前必须回答以下问题）
>
> 在输出最终诊断报告前，**必须逐条检查以下清单**。如果有任何一项回答为「否」，必须返回执行对应的级联步骤：
>
> 1. 是否已同时搜索 stage-log、log 和 original-log 三个日志源提取关键 ID？
> 2. 所有提取到的 Application ID 是否都已进行了对应引擎的级联诊断（Spark → spark-slow-analyzer / 其他 → yarn-app-diagnose）？
> 3. 所有提取到的 Session/Connection ID 是否都已进行了 SQL 链路级联诊断？
> 4. 是否存在"慢因已明确所以跳过级联"的情况？（如果是 → **必须返回执行级联**）
> 5. 级联步骤的收益远大于时间成本 — 是否因"效率优化"而省略了某个级联步骤？（如果是 → **必须返回执行**）
> 6. **如果是 WeData 调度态，是否已调用 `describe-log` 获取 WeData 侧完整日志？**（无论正常路径还是降级路径，WeData 调度态必须调用 `describe-log`）
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
> #### * 慢任务专属反证
> - 总耗时增幅 > 50% ？ ☐
> - ⑤ Application 运行增幅 > 50% ？ ☐
> - 4 源全部未命中 `resource` / `network` / `yarn` 类信号 ？ ☐
> - **三项都为 ☑ → 必须 `--scan-preset resource` + `network` 重扫，或扩大 lifecycleNum/broker 范围，否则报告作废**

**[NO] 禁止行为（铁律）：**
- [FAIL] 当底层引擎为 Spark 且成功提取到 Application ID 时，**禁止**通过 YARN AM 日志 grep 来分析 Spark 内部的 Job/Stage/Task 问题
- [FAIL] **禁止**用 `yarn-app-diagnose` 的日志获取 API + 手动 grep 来替代 `spark-slow-analyzer` 的结构化指标分析
- [OK] 正确做法：通过级联调用 `spark-slow-analyzer`，使用 Spark History Server REST API 获取结构化指标
- [WARN] 唯一的例外：`spark-slow-analyzer` 的 History Server API 完全不可用（返回 404）时，才退化为日志分析

   - **执行阶段**：若触发，**暂缓输出 US 报告**，通过快速决策表直接定位下游 skill（映射表无匹配时 fallback 到 `use_skill("find-skills")` 搜索），调用并完成所有级联诊断
4. 分析阶段 → 综合日志分析结果，输出合并后的诊断报告（若触发了级联诊断，则为 US + 下游的合并报告；否则为纯 US 诊断报告）

**精确定位模式**（URL 含 runtimeBroker/lifeCycleNum 等定位参数）的具体流程：
1. 凭证检查阶段 → 同上
2. 第一批采集 → 回复「正在获取任务配置和依赖关系...」，**并行调用** `query-task` 和 `relation`
3. 第二批采集 → **[ALERT] 构造命令前必须执行「参数自检清单」（见 `do-bigdata docs show --skill us-slow-task-diagnose --file execution-rules.md`）**。回复「正在获取第 N 次执行的日志...」（N 从 lifeCycleNum 获取），**并行调用** `stage-log`、`log` 和 `original-log`（**均带全部定位参数**，`original-log` 的 `--broker` 格式为 `IP-PORT`，由 runtimeBroker + runTimePort 拼接），**不调用** `query-run`
4. **[KEY] 慢任务专属步骤：获取上一周期日志** → 同上

> ### * STOP — 严禁在此处直接输出报告
> 同上方全量诊断模式的三个强制动作，必须执行步骤 3.5。

3.5. **[WARN] 级联诊断判断与执行**（同上方的快速决策表和禁止行为铁律）
4. 分析阶段 → 综合日志分析结果，输出合并后的诊断报告（只分析这一次执行）

每批内的多个 `execute_command` 调用应在同一个 tool call batch 中并行发出。

## 工作流程

> *** 平台识别、凭证检查、URL 参数解析、日志获取规则请参阅：`do-bigdata docs show --skill us-slow-task-diagnose --file platform-and-log.md`**

### 第一步：获取日志内容

按 `do-bigdata docs show --skill us-slow-task-diagnose --file platform-and-log.md` 中定义的流程获取日志。

### 第二步：识别任务类型和阶段

从日志内容中确定：

1. **任务类型**：TDW2MySQL、TDW2ClickHouse、TDW2PG、TDW2HDFS、TDW2HBase、TDW2Doris/StarRocks、HDFS2TDW、MySQL2TDW、HBase2TDW、Flink2TDW、PythonSQL、PySpark、SparkScala、MapReduce、Shell、SuperSQL、SQL计算、TDBank、微信计算等。
2. **当前执行阶段**：
   - 调度阶段（实例调度）：实例生成 → 依赖检查 → 下发执行
   - 运行阶段（实例运行）：初始化 → 数据处理 → 数据写入 → 完成
3. **底层引擎**：Spark、MapReduce、DataX、SuperSQL JDBC、PLC Client

### 第三步：阶段耗时分析（慢任务核心）

#### [ALERT] 慢任务诊断专项规则（必须遵守）

**规则 1：父任务检查 — 仅检查直接父任务**

当慢任务诊断涉及上游依赖分析时，**只检查直接父任务（一级依赖）的运行情况**，不递归追溯更上游的依赖链：

- [OK] 正确：获取直接父任务的 stage-log，确认其完成时间，判断当前任务是否因等待父任务而延迟
- [FAIL] 禁止：递归追溯父任务的父任务（祖父任务）、再追溯祖父任务的上游……层层回溯整条依赖链
- 如果直接父任务本身也运行较晚，在报告中指出「直接父任务 `<taskId>`（`<taskName>`）到 `<HH:MM:SS>` 才完成，导致当前任务延迟启动」即可，**不再进一步分析父任务为什么晚**
- 如果用户需要进一步分析上游依赖链，需用户**主动要求**后才进行

**规则 2：耗时比对 — 仅与上一个运行周期比对**

慢任务的耗时分析必须获取**上一个运行周期**的同一任务的 stage-log 进行对比，判断是否真正异常：

**执行流程**：
1. 根据当前数据时间和任务周期（天/小时/周等），计算上一个周期的数据时间
   - 天任务：当前数据时间 - 1天（如 `20260406000000` → `20260405000000`）
   - 小时任务：当前数据时间 - 对应小时间隔
   - 周任务：当前数据时间 - 7天
2. 调用 `stage-log --task-id <TASK_ID> --date <上一周期数据时间> --output-dir .` 获取上一周期的阶段日志
3. 将当前周期和上一周期的各阶段耗时进行**逐阶段对比**

**对比结果判定**：
- **耗时异常**：某阶段耗时比上一周期**增长 50% 以上**，或总耗时增长 50% 以上 → 在报告中标注该阶段为瓶颈，分析可能原因。**[WARN] 特别注意**：即使总耗时增幅不足 50%，只要 ⑤ Application 运行阶段等关键计算阶段增幅超过 50%，也必须标注为异常并触发级联诊断
- **耗时无异常**：各阶段耗时与上一周期**接近**（波动在 50% 以内）**且**总耗时波动在 50% 以内 → 在报告中明确给出结论：**「本次执行耗时与上一周期（`<上一周期数据时间>`）接近，耗时无明显异常」**，然后**使用 `ask_followup_question` 工具追问用户**：是否需要比对更早的运行周期

#### 阶段耗时拆解

将任务全生命周期拆分为各阶段，逐段列出耗时，快速定位瓶颈所在：

| 阶段 | 开始时间 | 结束时间 | 耗时 | 占比 | 说明 |
| --- | --- | --- | --- | --- | --- |
| ① US 调度等待 | [实例创建时间] | [下发执行时间] | [耗时] | [X%] | 等待父任务完成 + 排队等待下发 |
| ② US 提交到执行引擎 | [下发时间] | [Runner开始时间] | [耗时] | [X%] | US 将任务下发到 Runner 并启动 |
| ③ Runner 准备阶段 | [Runner开始] | [提交SuperSQL/Spark时间] | [耗时] | [X%] | 初始化、组装参数、获取权限等 |
| ④ SuperSQL/计算引擎提交 | [提交时间] | [Application启动时间] | [耗时] | [X%] | SuperSQL 排队 + Session 建立 + SQL 编译优化 |
| ⑤ Application 运行 | [App启动时间] | [App结束时间] | [耗时] | [X%] | Spark/MR/Hive 实际计算执行 |
| ⑥ 结果回写/收尾 | [App结束时间] | [任务完成时间] | [耗时] | [X%] | 数据写入目标表、清理临时资源等 |
| **总耗时** | [开始] | [结束] | **[总耗时]** | **100%** | |

> **⏱️ 瓶颈定位**：阶段 ⑤ 占总耗时 XX%，是主要瓶颈。[简要说明原因]

**阶段耗时提取规则**（从不同数据源中获取各阶段时间点）：

- **US 调度等待**：从 `query-run` 的实例记录中获取 `start_time`（实例创建时间）和 `stage-log` 的 `taskLogs` 中第一条 state=1（正在执行）的 `logTimeStr`（下发时间）
- **US 提交到执行引擎**：从 `taskLogs` 中 state=1 的时间到 `runnerLogs` 中第一条日志的时间戳
- **Runner 准备阶段**：从 `runnerLogs` 第一条日志时间到"提交SUPERSQL运行"/"提交SPARK运行"/"提交MR运行"/"提交HIVE运行"/"提交PYSPARK运行"等阶段的第一条日志时间
- **SuperSQL/计算引擎提交**：从"提交SUPERSQL运行"阶段开始到日志中出现 `application_` 或 `Session` 建立完成的时间
- **Application 运行**：从 `application_` 出现到日志中出现"运行完成"/"任务执行完成"等标志的时间，或从级联诊断中的 YARN Application `startedTime` / `finishedTime` 获取
- **结果回写/收尾**：从 Application 完成到 `taskLogs` 中 state=2（成功）或 state=3（失败）的时间

**注意事项**：
- 不是所有阶段都会出现在每个任务中（如无 SuperSQL 的任务跳过阶段④，Shell 任务可能只有①②⑤）
- 某些阶段的时间点可能无法从日志中精确提取，此时标注"≈ 估算"或"N/A"
- 占比 = 该阶段耗时 / 总耗时 × 100%，用于快速识别瓶颈
- 耗时超过总耗时 30% 的阶段应**加粗标注**，并在"瓶颈定位"中重点说明

#### 耗时对比表格（慢任务诊断时必须展示）

| 阶段 | 本次耗时 | 上一周期耗时 | 变化 | 判定 |
| --- | --- | --- | --- | --- |
| ① US 调度等待 | [耗时] | [耗时] | [+X% / -X%] | [正常 / [WARN] 异常] |
| ② US 提交到执行引擎 | [耗时] | [耗时] | [+X% / -X%] | [正常 / [WARN] 异常] |
| ... | ... | ... | ... | ... |
| **总耗时** | **[总耗时]** | **[总耗时]** | **[+X%]** | **[正常 / [WARN] 异常]** |

**注意事项**：
- 如果上一周期的 stage-log 获取失败（如该周期未运行、数据不存在等），在报告中说明「无法获取上一周期数据进行比对」，按原有流程分析
- 比对时只关注主要阶段的耗时变化，忽略几秒级的微小波动
- 周期类型可从 `query-task` 返回的任务配置中获取

### 第四步：诊断并给出解决方案

> *** 级联深度诊断的完整规则请参阅：`do-bigdata docs show --skill us-slow-task-diagnose --file cascade-diagnosis.md`**

#### 诊断结论的证据链规则（强制）

所有诊断结论**必须**有日志原文支撑，否则**禁止**写入报告：

1. **日志实证**：每条结论必须引用 **1~2 条最关键的日志片段**（使用 `>` 引用块）
2. **推理链路**：简明呈现「日志证据 → 根因结论」，一句话说清因果关系
3. **禁止猜测**：无日志支撑的结论禁止写入。日志不足时标注「[WARN] 日志信息不足」并给出排查方向
4. **待确认线索**：有部分线索但不确定的，单独列出，注明需进一步确认

根据找到的耗时瓶颈，提供结构化诊断报告。按以下格式输出：

```
## 慢任务诊断报告

### 基础信息

| 字段 | 值 |
| --- | --- |
| 任务ID | [任务ID] |
| 任务名 | [任务名称] |
| 数据时间 | [数据日期] |
| 实例状态 | [状态描述] |
| 总耗时 | [本次总耗时] |
| 上一周期耗时 | [上一周期总耗时] |
| 耗时增幅 | [+XX%] [WARN] / [+XX%] 正常 |
| 瓶颈阶段 | [主要瓶颈所在的阶段] |
| 负责人 | [负责人列表] |
[按需补充：任务类型、应用组、Session ID、Connection ID、Application ID 等]

### 阶段耗时分析

[上方定义的阶段耗时拆解表格]

> **⏱️ 瓶颈定位**：阶段 ⑤ 占总耗时 XX%，是主要瓶颈。[简要说明原因]

### 耗时对比

[上方定义的耗时对比表格]

### 根因分析

**根因**：[一句话总结根因，如"Stage 1 并行度不足导致写入阶段成为瓶颈"]

**关键证据**：
> [1~2条最关键的日志片段]

**因果链**：[日志证据] → [根因结论]

**待确认线索**（仅当存在不确定因素时）：
- [线索] — 建议排查：[方向]

### 优化建议

| 优先级 | 建议 | 预期收益 |
| --- | --- | --- |
| * 高 | [建议1] | [预期收益] |
| * 中 | [建议2] | [预期收益] |

### 相关链接

汇总所有相关链接

> **[WARN] 如果US或WeData使用上有任何问题，可以直接联系 kimlinlin**
```

#### 动作二：询问下载日志

**必须主动询问用户**：是否需要将该实例的运行日志和阶段日志下载到本地？

参考 `do-bigdata docs show --skill us-log-analyzer --file troubleshooting-guide.md`、`do-bigdata docs show --skill us-log-analyzer --file common-errors.md`、`do-bigdata docs show --skill us-log-analyzer --file us-user-guide.md`、`do-bigdata docs show --skill us-log-analyzer --file us-faq.md` 获取详细诊断流程和解决方案。

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

## 关键参考链接

| 资源 | URL |
|------|-----|
| **US 平台** | |
| US 网页端 | https://us.woa.com |
| US 使用指南 | https://iwiki.woa.com/p/188168765 |
| **排障与 FAQ** | |
| US 常见问题与排障 | https://iwiki.woa.com/p/435809358 |
| 慢任务优化指南 | https://iwiki.woa.com/p/644739326 |
| 等待下发指南 | https://iwiki.woa.com/p/4006844339 |
| Spark 问题排查 | https://iwiki.woa.com/p/1479566036 |
| **权限** | |
| 权限申请指南 | https://iwiki.woa.com/p/188168782 |
| 权限中心 | https://security.tianqiong.woa.com/auth/group |
| **运维工具** | |
| US 工具箱 | https://iwiki.woa.com/p/1461774926 |
| 资源池统计 | http://tdwhelper.oa.com/pool_stat/pool_stat.php |
| 优先级提升工具 | http://zhiyan.oa.com/operate/#/task/result/132 |

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
- `troubleshooting-guide.md` — 按任务类型和失败阶段的详细排障流程
- `common-errors.md` — 完整的错误码索引及解决方案
- `us-user-guide.md` — US 平台使用指南
- `us-task-types.md` — US 任务类型配置指南
- `us-faq.md` — US 常见问题（FAQ）
- `gaia-clusters.md` — Gaia 集群 ID 与名称映射表
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
