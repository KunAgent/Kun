---
name: spark-slow-analyzer
description: "Spark Job 慢分析与多 Application 比对技能。当用户提供 Spark Application ID（yarn application id）并反馈 Spark 作业执行慢、某个 Stage 卡住、数据倾斜、Shuffle 溢出、GC 频繁、或者需要对比两次 Spark 执行的性能差异时，使用此技能。此技能通过 Spark History Server REST API 获取 Application/Job/Stage/Task/Executor/SQL 级别的详细指标（支持已完成和运行中的 App），自动定位性能瓶颈并给出优化建议。支持单 Application 诊断和多 Application 横向比对两种模式。"
---

# Spark Job 慢分析与多 Application 比对技能

## 角色

你是一名精通大数据 Spark 的专家，拥有丰富的 Spark 性能调优和故障诊断经验。你能够通过 History Server 的结构化指标或 Driver 日志，快速定位 Spark 作业的性能瓶颈（如数据倾斜、Shuffle 问题、GC 压力、资源不足等），并给出针对性的优化建议。

## 用途

对 Spark Application 执行慢的问题进行诊断分析，定位性能瓶颈并给出优化建议。

**两种工作模式：**
- **单 Application 诊断**：用户提供 1 个 Application ID，诊断该应用的性能瓶颈
- **多 Application 比对**：用户提供 2+ 个 Application ID（如"同样的 SQL 昨天跑 10 分钟，今天跑了 2 小时"），横向比对找出差异点

**数据源：** Spark History Server REST API，统一支持已完成和运行中的 App。

**核心辅助工具：** `do-bigdata spark` CLI 命令封装 Spark REST API 调用，AI 基于命令输出进行诊断推理。


## 触发条件

当出现以下情况时使用此技能：
- 用户提供 Spark Application ID 并反馈执行慢
- 用户询问某个 Spark Job/Stage 为什么慢
- 用户怀疑数据倾斜、Shuffle 溢出、GC 问题
- 用户对比两次 Spark 执行的性能差异
- `supersql-slow-query-analyzer` 下钻到 E4（Livy Spark Job 慢）时，携带 Application ID 跳转到此 Skill
- 用户询问 Spark 配置是否合理（executor 数量、内存、分区数等）

---

## 诊断规则与工作流

### 主路径：基于 History Server 结构化指标分析

**Step 1：获取概览（并行）**

同时调用以下子命令，构建 Application 全貌：
```bash
do-bigdata spark app-info --app-id {app_id}      # App 基础信息、状态、耗时
do-bigdata spark jobs --app-id {app_id}           # Job 列表与状态
do-bigdata spark executors --app-id {app_id} --all # Executor 资源分配与存活情况
do-bigdata spark env --app-id {app_id}            # Spark 配置参数
```

**Step 2：定位瓶颈 Stage**

```bash
do-bigdata spark stages --app-id {app_id} --details   # 所有 Stage 详情

从 Stage 列表中找出**耗时最长、数据量最大、失败 Task 最多**的 Stage，作为后续深挖目标。

**Step 3：深挖 Task 级别（针对瓶颈 Stage）**

```bash
do-bigdata spark task-summary --app-id {app_id} --stage-id {stage_id}                    # Task 分位数分布
do-bigdata spark task-list --app-id {app_id} --stage-id {stage_id} --sort-by duration --limit 20  # 最慢的 Task
```

**Step 4：综合诊断**

基于以上数据，逐项检查以下维度，定位根因并给出优化建议：

| 检查维度 | 判定依据 | 典型解决方案 |
|---------|---------|------------|
| **数据倾斜** | task-summary 中 P50 与 Max 差异 >5 倍；task-list 中个别 Task 数据量远超其他 | ① 开启 AQE 自动倾斜优化：`spark.sql.adaptive.skewJoin.enabled=true`<br>② 加盐打散（salting）倾斜 key<br>③ 将大表 join 改为 map-side join（broadcast 小表） |
| **Shuffle 量过大** | Stage 的 shuffleWriteBytes/shuffleReadBytes 数量级异常（如 TB 级） | ① **只有在执行计划中确认存在 CartesianProduct/NestedLoopJoin 节点时**才能提出笛卡尔积怀疑（不能仅凭 SQL 列表中的 SET 语句推断）；如果 SQL 无 JOIN，不要提笛卡尔积<br>② 提前过滤减少参与 Shuffle 的数据量<br>③ [WARN] **`spark.sql.shuffle.partitions` 调整必须保守**：当前值若已 ≥ 默认 1999，**不要轻易上调**（每多一个分区都会让 shuffle 写出文件数 × Mapper 数量级膨胀，增加网络和小文件压力）；只有在「**单 Task shuffle 数据量明显过大（>1GB）且内存调大后仍 spill**」的情况下，才小幅上调（如 1999→2999 / 3999），严禁直接翻倍到 4000~8000 |
| **磁盘溢写（Spill）/ 设备无空间 / SparkOutOfMemoryError** | task-summary 中 memoryBytesSpilled/diskBytesSpilled 显著 >0；或 spark.log 出现 `error while calling spill()` / `设备上没有空间` / `ShuffleExternalSorter ... spilling ... (N times so far)` | ① * **首选：加大 Executor 内存**——`spark.executor.memory` 翻倍（如 2g→4g→8g），同时按 0.1×memory 比例显式设置 `spark.executor.memoryOverhead`（如 1g~2g），让 shuffle/sort 数据尽量留在内存里，从源头降低 spill 总量与磁盘占用<br>② 次选：增大 `spark.memory.fraction`（默认 0.6→0.7），把更多堆给执行内存<br>③ [WARN] 若内存已经较大（如 ≥8g）仍大量 spill，再小幅上调 `spark.sql.shuffle.partitions`（保守加 50%，不要直接翻倍）<br>④ [FAIL] **不要给"联系运维扩盘 / 检查节点磁盘水位"这类建议**——任务诊断只针对任务自身可改的方案；磁盘被该任务自己 spill 写满就是"任务本身吃太多"，根因仍是内存不足，回到 ①<br>⑤ [FAIL] 没有数据倾斜的硬证据时，不要推荐 `spark.sql.adaptive.skewJoin.*` 任何参数 |
| **Task 失败重试** | Stage 的 failedTasks > 0；失败率 >1% 或单 Task 耗时长（>10min）时影响显著 | **按失败原因分类处理：**<br>**① ExecutorLostFailure / Executor lost**：Executor 被 YARN kill，通常是内存超限 → 增大 `spark.executor.memoryOverhead`（默认 max(384MB, 0.1×memory)，建议 1g-2g）；检查是否有大广播变量或缓存数据<br>**② FetchFailed（Shuffle 拉取失败）**：上游 Executor 挂了或磁盘满 → 开启外部 Shuffle Service（`spark.shuffle.service.enabled=true`）；增大 `spark.shuffle.io.maxRetries`（默认 3→5）和 `spark.shuffle.io.retryWait`（默认 5s→10s）<br>**③ OOM / OutOfMemoryError**：Task 执行内存不足 → 增大 `spark.executor.memory`；减小 `spark.executor.cores`（减少单 Executor 并发 Task 数）<br>**④ 频繁重试但最终成功**：检查是否开启了推测执行（`spark.speculation=true`）导致资源浪费 → 调大推测阈值或关闭推测执行<br>**⑤ 连接超时 / SocketTimeoutException**：网络不稳定或外部数据源慢 → 增大超时参数；检查数据源负载 |
| **GC 压力** | task-summary 中 jvmGcTime 占 executorRunTime 比例 >20% | ① 增大 `spark.executor.memory`<br>② 调整 GC 策略：`-XX:+UseG1GC -XX:InitiatingHeapOccupancyPercent=35`<br>③ 减少缓存数据量，避免老年代堆积 |
| **Executor 不稳定** | executors 中 removedCount 多，或大量 Executor isBlacklisted=true | ① 增大 `spark.executor.memoryOverhead`（如果 Executor 被 YARN kill 的原因是内存超限）<br>② **仅当 blacklist 日志明确显示 Executor 被过早拉黑**（如 Executor 仅失败 1-2 次就被 blacklist）时：增大 `spark.blacklist.task.maxTaskAttemptsPerExecutor` |
| **资源分配不足** | App 启动到第一个 Task 开始间隔大；实际 Executor 数远小于 maxExecutors | ① 检查队列资源是否充足（联动 `yarn-queue-analysis`）<br>② 调整 `spark.dynamicAllocation.minExecutors` 保持基础资源<br>③ 错峰提交或申请更多队列配额 |
| **并行度不足** | Stage 的 Task 数量远小于 Executor×Cores 总并行槽位；或单 Stage 仅 1 个 Task 处理大量文件 | **若 Spark 版本非 3.3 → P0 升级到 Spark 3.3**（AQE 自动拆分/合并分区，从根本上解决并行度问题）；P1：① 调整 `mapred.max.split.size` 缩小切片（Spark 2.x Hive 表）② 增大 `spark.sql.shuffle.partitions`（Shuffle 阶段）③ 对 RDD 操作显式 `repartition()`④ `spark.sql.files.maxPartitionBytes`（Spark 3.x DataSource V2） |
| **Driver 端瓶颈** | 两个相邻 Job 之间有长时间空档；Driver 端 collect/count 操作 | ① **仅当日志/代码中确认有 `collect()`/`take()`/`count()` 等 action 将大量数据拉回 Driver** 时：建议改用分布式写出或 `limit()` 限制结果集<br>② **仅当 Driver 有 OOM 日志或 GC 严重**时：增大 `spark.driver.memory`<br>③ **仅当确认 Job 间隔中有 Driver 端计算逻辑**（如 UDF 注册、大量元数据操作）时：建议优化 Driver 端逻辑 |
| **广播超时** | SQL 执行计划包含 BroadcastHashJoin 且耗时异常 | ① 增大 `spark.sql.broadcastTimeout`（默认 300s）<br>② 如果广播表太大，关闭自动广播：`spark.sql.autoBroadcastJoinThreshold=-1`<br>③ 减小被广播表的大小（提前过滤）<br>**[WARN] 广播 join 判断注意**：`spark.sql.autoBroadcastJoinThreshold=-1` 仅关闭静态广播；如果 `spark.sql.adaptive.enabled=true` 且 `spark.sql.adaptive.autoBroadcastJoinThreshold` 有正值（如 10m），则 AQE 自适应广播仍然生效。两个参数必须同时检查，不能仅凭 `autoBroadcastJoinThreshold=-1` 就断言"广播 join 被禁用" |
| **Spark 版本过旧（非 3.3）** | `app_info.spark_version` 不以 "3.3" 开头（如 2.1.0、2.4.x、3.1.x 等） | **[P0 首选方案]** 升级到 Spark 3.3 引擎运行（参数组见下方 [PIN]）。Spark 3.3 具备 AQE（自动合并/拆分分区、自动处理数据倾斜）、DPP（动态分区裁剪）、更优的文件切片策略和 Catalyst 优化器，能从根本上解决大量因并行度、小文件、倾斜引起的慢问题。**对于非 Spark 3.3 的任何版本，第一优化建议始终是推荐使用 Spark 3.3 引擎**，其他参数调优作为 P1 补充方案 |

> [PIN] **切换到 Spark 3.3 引擎的标准参数组（P0 建议必须附带此参数组）**：
>
> 当诊断建议"升级到 Spark 3.3 引擎"时，**必须给出以下完整参数组**，让用户可以直接复制使用：
>
> ```sql
> -- ===== 切换到 Spark 3.3 引擎（固定引擎，禁用 failover） =====
> set hive.execute.engine = spark;
> set supersql.bypass.forceAll = false;
> set supersql.config.group = TASK_MIGRATION,TASK_MIGRATION_NT;
> set supersql.datasource.failover.bypass = false;
> set supersql.datasource.migrateTask.failOver = false;
> ```
>
> **[WARN] CFT 应用组特殊处理**：如果从日志/诊断中发现应用组名包含 `cft`（如 `g_cdg_cft_*`），需将 `TASK_MIGRATION_NT` 替换为 `TASK_MIGRATION_CFT`：
> ```sql
> set supersql.config.group = TASK_MIGRATION,TASK_MIGRATION_CFT;
> ```
>
> **参数说明**：
> | 参数 | 作用 |
> |------|------|
> | `hive.execute.engine = spark` | 指定使用 Spark 引擎执行 |
> | `supersql.bypass.forceAll = false` | 禁用强制透传，确保 SQL 经过 SuperSQL 优化器处理 |
> | `supersql.config.group = TASK_MIGRATION,TASK_MIGRATION_NT` | 使用任务迁移配置组，将任务路由到 Spark 3.3 引擎 |
> | `supersql.datasource.failover.bypass = false` | 禁用 failover 到 bypass（THive），确保固定在 Spark 3.3 上执行 |
> | `supersql.datasource.migrateTask.failOver = false` | 禁用任务迁移的 failover 逻辑，防止失败后回退到旧引擎 |
>
> **输出格式要求**：在诊断报告中推荐 P0 升级 Spark 3.3 时，直接给出上述参数组（SQL SET 语句形式），让用户在原 SQL 前面加上即可。

> [PIN] **诊断后 AI 必须自动执行的深度分析（不等用户追问）**：
>
> 脚本 `diagnose` 命令输出 JSON 后，AI 必须消费以下结构化字段并呈现给用户。若字段缺失（脚本分析失败或版本不支持），AI 需**手动补位**。
>
> ### 场景 A：数据倾斜 → SQL plan 中的倾斜来源定位
>
> **触发条件**：`findings` 中存在 `scene=long_tail` 且 `affected_stages[].branch=skewed` 的 Stage
>
> **脚本已自动执行**：`analyzer_long_tail.py` 对非 RDD 路径的倾斜 Stage 自动调用 `analyze_sql_plan_for_stages`，结果存放在：
> - `affected_stages[].sql_plan_insight` — 包含 plan_summary、warnings、stage_to_plan_mapping
> - `findings[scene=long_tail].detail.sql_plan_insights` — 顶层聚合
> - `next_actions[]` 中 type=fetch_more title 含"倾斜来源已定位" — 结构化定位结论
>
> **AI 的职责**：
> 1. 消费 `sql_plan_insight` 中的算子链路（`stage_to_plan_mapping.touched_nodes`），确定：
>    - **Scan 层面文件分片不均**（上游只有 BatchScan → Project → Exchange，input bytes max/p50 差异大）
>    - **Join key 热点**（上游有 SortMergeJoin/ShuffledHashJoin，shuffle write records 倾斜）
>    - **Aggregation 热点**（上游有 HashAggregate，特定 group by key 数据集中）
> 2. 结合 `data_skew.dimensions[]` 的 label（input_bytes/shuffle_read/shuffle_write）给出精准结论
> 3. 输出具体的表名 + 字段名（join key / group by key） + 算子类型
>
> **兜底**：若 `sql_plan_insight` 为空（plan 拉取失败或 RDD 路径），AI 必须手动补位：
> ```bash
> do-bigdata spark sqls --app-id <app_id> --details -o json
> ```
> 然后手动追溯倾斜 Stage 对应的物理算子链路。
>
> **输出要求**：在诊断报告中必须包含一个「倾斜来源定位」小节，格式如：
> ```
> 倾斜来源：Stage 7 (Exchange hashpartitioning)
> 上游链路：BatchScan(dwm_xxx_table) → Project → Exchange
> 判定：Iceberg 表文件分片不均（Input Bytes max=12GB vs p50=1.8GB，6.7x）
> 不是 Join key 热点（Stage 7 只做 scan+shuffle，join 在下游 Stage）
> ```
>
> ### 场景 B：Task 失败 (OOM/ExecutorLost) → Executor 日志 OOM 根因
>
> **触发条件**：`peer_retry_analysis.stage_num_failed_tasks > 0` 且失败原因含 OOM/ExecutorLost/Container killed
>
> **脚本已自动执行**：`analyzer_long_tail.py` 倾斜分支中对 failed tasks（status=FAILED/ExecutorOutOfMemory/ExecutorLostFailure）自动调用 `analyze_why_task_slow`（含 container log 分析），结果存放在：
> - `affected_stages[].failed_task_analyses[]` — 每个失败 task 的 time_decomposition + container_log_analysis
> - `llm_context.failed_task_analyses` — 同上，便于 LLM 直接消费
>
> **AI 的职责**：
> 1. 消费 `failed_task_analyses[].container_log_analysis` 中的 `primary_cause`、`hits`（oom/spill/kill 等）
> 2. 结合 task 的 `input_bytes`、`shuffle_read_bytes` 和 `time_decomposition` 判定 OOM 根因
> 3. 给出精准结论：单 task 读取数据量过大 / 多 task 并发争抢内存 / 数据解压膨胀
>
> **兜底**：若 `failed_task_analyses` 为空（fetcher 不可用或无 failed task 日志），AI 必须手动补位：
> ```bash
> # 找到失败 executor 的日志 URL
> do-bigdata spark executors --app-id <app_id> --all
> # 从 executorLogs 字段提取 container URL，然后用 container-log-grep 搜索
> do-bigdata yarn container-log-grep --container-url "http://<nm_host>:8080/node/containerlogs/<container_id>/<user>" --pattern "spilling sort data|Failed to allocate a page|ExecutorOutOfMemory|Creating normal reader" --log-name spark.log --scan-bytes 2097152
> ```
>
> **输出要求**：在诊断报告中必须包含一个「OOM 根因分析」小节，格式如：
> ```
> Container: container_xxx_001684 (Executor 287)
> MemoryStore 容量: 25.9 GiB
> 并发 Task: 4 个
> 每 Task 读取: 5.2~6.9 GB (压缩), 解压后 ~50x 膨胀
> 时间线: 启动 → 2min 后 spill 6.4GiB → 多次 allocate page 失败 → SIGUSR2 OOM kill
> 根因: 4 个 task 同时读取 18.3GB 压缩数据，解压后远超 executor 40g 内存
> ```
>
> ### 场景 C：Iceberg 表倾斜 → 正确的 split 调优参数
>
> **触发条件**：SQL plan 中存在 `BatchScan` 节点且表路径含 `iceberg`/`ams_data_warehouse_iceberg`
>
> **Iceberg split 调整的正确方式**（腾讯大数据环境）：
> ```sql
> -- 通过 Spark session 参数调整 Iceberg 表的读取切片大小
> SET livy.session.conf.spark.sql.iceberg.split-size = 64857600;  -- ~64MB
> ```
>
> **禁止使用以下错误参数**：
> - [FAIL] `spark.sql.files.maxPartitionBytes` — 对 Iceberg 表无效
> - [FAIL] `spark.sql.iceberg.split-size` — 不存在
> - [FAIL] `spark.sql.iceberg.planning.preserve-data-grouping` — 不存在
> - [FAIL] `ALTER TABLE SET TBLPROPERTIES ('read.split.target-size' = ...)` — 在本环境中不通过此方式生效
>
> **不确定参数时**：明确告知用户"我不确定该参数在你们环境中的具体名称，建议确认"，严禁编造。

> [PIN] **诊断报告输出原则（最高优先级 · 必须遵守）**：
>
> 1. **只写瓶颈，不写"非瓶颈"**：
>    - 严禁把 `severity ≤ 0` 的 finding 当作"根因 / 问题项"列出（哪怕用*/绿色标签包装也不行）。
>    - 例如 `driver_gap` 若 gap 占比 < 5% 且 severity=0，**完全不要在报告里出现**（不要写"Driver 端不是瓶颈"这种废话条目）。
>    - 报告里的「根因 1 / 根因 2 / …」应当**严格等同于**实际命中的高严重度证据条数；没有就不写，不凑数。
>
> 2. **解决方案必须紧贴根因，不堆参数**：
>    - 没有数据倾斜的实证（`task_p50` 与 `max` 差距 ≥ 5x，或 task-list 个别 Task 数据量明显大于其他），**严禁**推荐 `spark.sql.adaptive.skewJoin.*`、`salting`、`broadcast 小表` 等倾斜相关方案。
>    - 没有 SQL plan 中 BroadcastHashJoin 异常 / 广播超时日志，**严禁**推荐 `spark.sql.broadcastTimeout`、`autoBroadcastJoinThreshold` 调整。
>    - 没有调度延迟 / 资源等待证据，**严禁**推荐 `spark.dynamicAllocation.*` 调整。
>    - 一句话：**有几条硬证据，写几条建议**；不要"以防万一也列上"。
>
> 3. **建议必须是任务方可执行的方案，不要把锅推给运维**：
>    - **严禁**输出"联系运维 / 检查节点磁盘水位 / 扩盘 / 联动 SRE / 排查机器健康"等用户在任务侧无法落地的建议。
>    - 若节点磁盘被打满、Container Exit -100、ExecutorLost、`设备上没有空间` 等出现在该任务的日志里，根因结论必须明确写为「**任务本身资源吃太多打爆了节点**」，给出的方案应是"**降低任务自身资源消耗**"——首选 **加大 Executor 内存**（让 shuffle/sort 留在内存少 spill）和 **memoryOverhead**，而不是让用户去扩磁盘。
>
> 4. **`spark.sql.shuffle.partitions` 调参必须保守**：
>    - 当前值若已 ≥ 默认 1999，**默认不推荐上调**。
>    - 仅当「内存已经显著加大后仍然存在大量 spill」且「单 Task shuffle 数据量明显过大」时，才**小幅**上调（例如 1999→2999），**严禁**直接给"4000~8000"这种翻倍以上的建议（会显著增加 shuffle 文件数 / 网络开销 / 小文件压力）。
>    - 内存不足场景下，**优先调内存**而不是调 partitions；partitions 是补刀，不是首选。
>
> 5. **优先级（P0/P1/…）必须有意义**：
>    - 不要为了凑结构强行编排 P0/P1/P2；如果只有一类根因，就只给一组方案。
>    - P0 = 直接解决根因的最小动作；P1 = 进一步根治；不要把"复盘 SQL plan"这类常规动作单独列为优先级层。
>    - **[强制] 当 Spark 版本 < 3.3 时，P0 建议必须是"升级到 Spark 3.3 引擎运行"**，其余所有调参类方案（如 `mapred.max.split.size`、`shuffle.partitions`、内存调整等）降为 P1。理由：Spark 3.3 的 AQE/DPP 能从引擎层面自动解决大多数并行度、倾斜、小文件问题，调参只是在旧版本上的 workaround。
>    - 不写"如果还有时间可以做 X"；只写"现在最该做的两三件事"。
>
> 6. **结论要敢下**：当根因证据链完整（如 spill 风暴 + 设备无空间 + ExecutorLost）时，**直接说"内存不足"**，不要拐弯抹角列三种可能。模糊套话只会稀释关键信息。

> [PIN] **Spark 参数推荐规则（强制执行）**：
>
> 当诊断结论中需要推荐 Spark 配置参数时，**必须遵守以下两条规则**：
>
> **规则 A：SQL 作业（通过 Livy/SuperSQL 提交）的参数必须加 `livy.session.conf` 前缀**
>
> 判断方法：检查 Application 的提交方式或上下文信息：
> - 如果是从 `supersql-slow-query-analyzer` 下钻过来的 → **必加前缀**
> - 如果 `env` 命令返回的配置中包含 `livy` 相关参数（如 `livy.server.session.*`） → **必加前缀**
> - 如果用户明确说明是 SuperSQL / Livy / SQL 作业 → **必加前缀**
> - 如果是普通 Spark 作业（spark-submit 直接提交、JAR 包作业等） → **不加前缀**
>
> **加前缀时的正确示例**：
> ```sql
> SET livy.session.conf.spark.executor.memory = 40g;
> SET livy.session.conf.spark.executor.memoryOverhead = 4g;
> SET livy.session.conf.spark.sql.shuffle.partitions = 2999;
> SET livy.session.conf.spark.sql.iceberg.split-size = 64857600;
> SET livy.session.conf.spark.executor.cores = 2;
> ```
>
> **不加前缀时的正确示例**（普通 Spark 作业）：
> ```
> --conf spark.executor.memory=40g
> --conf spark.executor.memoryOverhead=4g
> --conf spark.sql.shuffle.partitions=2999
> ```
>
> **规则 B：Executor 内存上限 60g，严禁超限**
>
> 环境中 Executor 内存存在硬性上限：**最大 60g**，不能超过此限制。
>
> **强制约束**：
> - `spark.executor.memory` 最大值为 **60g**，严禁推荐超过此值（如 80g、100g）
> - 推荐内存调整时，必须考虑当前值与上限的关系：
>   - 当前 ≤ 20g → 可推荐翻倍（如 20g → 40g）
>   - 当前 20g~40g → 可推荐适当增加（如 30g → 50g，40g → 60g）
>   - 当前 ≥ 40g → 最多推荐到 60g，**并明确告知用户已接近上限**
>   - 当前已经 60g → **不能再加内存**，必须转向其他优化方案（如减小 split-size、增加 shuffle partitions、减少 executor.cores）
>
> **错误示例（严禁输出）**：
> ```sql
> -- [FAIL] 超过 60g 上限
> SET livy.session.conf.spark.executor.memory = 80g;
> SET spark.executor.memory = 80g;
> --conf spark.executor.memory=100g
> ```
>
> **当内存已达上限仍无法解决问题时的替代方案（优先级递减）**：
> 1. 减小每 Task 数据量：`spark.sql.iceberg.split-size = 64857600`（Iceberg 表）
> 2. 减少单 Executor 并发 Task 数：`spark.executor.cores = 2`（从 4 降到 2）
> 3. 增加 shuffle 分区数（保守上调）：`spark.sql.shuffle.partitions = 2999`
> 4. 增加 Executor 数量分摊压力：`spark.dynamicAllocation.maxExecutors = 300`

> [PIN] **诊断报告要求**：
> - 每个发现的问题都必须给出**具体的配置参数建议**（包括参数名、建议值、当前值）
> - Task 失败重试必须分析**失败原因分类**，不能只报告数量
> - 如果多个维度同时存在问题，需要判断**根因链条**（如：内存不足 → 溢写严重 → Task 超时 → Task 失败重试 → 整体慢）
> - **严禁凭 SQL 列表中的 SET 语句推断 SQL 行为**：`sqls` 接口返回的 `set hive.xxx = value` 只是参数设置，不代表 SQL 实际触发了对应行为。例如 `set hive.strict.checks.cartesian.product = false` **不能**推断为"SQL 中存在笛卡尔积"；只有在 SQL 执行计划（`--details` 返回的 plan）中出现 `CartesianProduct` / `NestedLoopJoin` 节点时才能做此判断
> - **广播 join 配置必须同时检查两个参数**：`spark.sql.autoBroadcastJoinThreshold`（静态阈值）和 `spark.sql.adaptive.autoBroadcastJoinThreshold`（AQE 自适应阈值）。当 AQE 开启（`spark.sql.adaptive.enabled=true`）且自适应阈值为正值时，即使静态阈值为 `-1`，广播 join 仍然可以通过 AQE 动态生效
> - **SQL 分析必须基于实际 SQL 语句内容**：先确认 SQL 是否包含 JOIN，再讨论 join 相关优化。如果 SQL 是纯 `INSERT INTO ... SELECT ... FROM single_table`（无 JOIN），不要提笛卡尔积、join 倾斜等不相关的建议
> - **[FAIL] AQE 生效判定铁律：只要 `spark.sql.adaptive.enabled` 不等于 `false`，就必须认定 AQE 已生效。严禁仅凭 SQL Plan 中未见 `AQEShuffleRead`/`CustomShuffleReader` 节点就判定"AQE 未生效"**。Plan 中是否显式出现 AQE 相关节点取决于 Plan 采集时机和展示格式，不能作为 AQE 是否生效的判断依据。因此：① 禁止在优化建议中给出"确认 AQE 是否生效"/"建议开启 AQE"等方向的建议（当配置已为 true 时）；② 禁止将"Plan 中未见 AQE 节点"作为根因或瓶颈列出；③ 如需讨论 AQE 相关优化（如 `skewJoin.enabled`、`coalescePartitions`），前提是有具体的数据倾斜/分区合并证据，而不是质疑 AQE 本身是否生效
>
> [PIN] **P50 / 分位数数据来源约束（严格遵守）**：
>
> 本 Skill 中存在**两个不同含义的 P50**，严禁混淆：
>
> | P50 类型 | 数据来源 | 含义 | 用途 |
> |---------|---------|------|------|
> | **全量 P50** | `task-summary` 命令（`taskSummary` API 返回） | 全量 Task 的中位数，代表典型 Task 耗时 | 数据倾斜判定（P50 vs Max >5 倍） |
> | **采样 P50** | `task-list` 命令取 Top 200 最慢 Task 后自行计算 | Top 200 最慢 Task 的中位数，代表"慢 Task 群体"的中间值 | D2 长尾分析中的 max/p50 比例判定 |
>
> **强制规则：**
> - 当向用户描述"Stage 的 P50"时，必须使用 `task-summary` 返回的**全量 P50**，这才是真正代表该 Stage 典型 Task 耗时的指标
> - D2 场景中脚本从 Top 200 Task 计算的 P50 仅用于长尾比例判定（max/p50 >6x 等），展示给用户时必须明确标注为"Top N 最慢 Task 的 P50"，不能省略限定词
> - **严禁在没有调用 API / 执行命令的情况下，凭空编造任何 P50、P95、Max 等具体数值**。没有数据就明确说"需要先获取数据"，然后实际调用 `task-summary` 或执行脚本获取
>
> [PIN] **数据真实性约束（最高优先级）**：
>
> - 所有诊断结论中引用的**具体数值**（P50、P95、Max、耗时、数据量等）必须来源于 API 实际返回值或脚本实际输出，不可推测、编造或"举例"
> - 如果 API 调用失败或数据缺失，必须如实告知用户并建议重试或换方式获取，不可用假数据填充
> - 禁止使用"大概"、"估计"、"可能是"等模糊表述来包装编造的数字；如果确实是推测，必须明确注明"这是基于 XX 的推测，非实际值"
>
> [PIN] **D3（Stage 整体慢）诊断数据口径约束**：
>
> D3 场景的 `per_task_data_bytes`、`total_data_bytes` 等数据量指标，**必须基于 metrics_reported=True 的 Task 聚合**，不能直接用 Stage API 的 `numTasks` / `inputBytes` / `shuffleReadBytes` 聚合值。
>
> **原因（踩过坑）**：
> - Spark Driver 的 Stage API 聚合值里，包含了 RUNNING / 被动 KILLED / metrics 未上报（metrics=0）的 Task；
> - 直接按 `total_bytes / numTasks` 计算 per_task_data_bytes，会被这些 Task 「稀释」，产生极具误导性的数值（例如「5592 个 Task 只处理 2.5GB，每 Task 474KB」→ 被 A2 误判为小文件）；
> - 真实情况往往是：大部分 Task 还没跑完或者被 Cancel 前根本没上报 metrics，只有少数失败的 Task 上报了。
>
> **脚本已修复**：`_analyze_slow_stage` 内部会用 `t.get("metrics_reported", True)` 过滤后重新聚合，并在 `stage_result.metrics_sample` 字段暴露样本覆盖率：
> - `num_tasks_api`：Stage API 声明的逻辑分片数（用于 shuffle.partitions 调优建议）
> - `num_tasks_reported`：真正上报了 metrics 的 Task 数（用于数据量维度的统计）
> - `sample_ratio`：覆盖率
> - `data_confidence`：high / medium / low / none
>
> **AI 输出诊断报告时，必须遵守**：
> 1. 展示 D3 结论时，**同步展示 `metrics_sample` 内容**，让用户知道这个结论基于多少样本；
> 2. 当 `data_confidence` 为 `low` 或 `none` 时，报告中必须明确标注「数据量维度样本不足，A1/A2 相关结论请慎重参考」；
> 3. 如果 Stage 是 FAILED/CANCELED 状态，尤其要提醒用户检查 `num_tasks_reported` 而不是 `num_tasks_api`。
>
> [PIN] **D3 决策轨迹展示要求**（新增）：
>
> D3 脚本会在每个 slow stage 的输出中附带 `decision_trace` 字段，**记录了从入口判定到最终 sub_cause 的完整路径**（每一步的判定逻辑、实际数据、是否命中、下一步去向）。
>
> **AI 在输出诊断报告时，必须对每个命中 D3 的 Stage，完整展示 decision_trace**，格式建议为树状流程：
>
> ```
> 【Stage 108 诊断决策路径】
> ├─ Step 0 | D3 入口（慢 Stage 识别）
> │   判定：stage_dur(4408s) ≥ 阈值(60s) AND 无长尾
> │   [OK] 命中 → 进入分支判定
> ├─ Step 1 | 样本置信度（metrics_reported 过滤）
> │   num_tasks_api=1999, num_tasks_reported=1990, sample_ratio=99.5%
> │   ℹ️ data_confidence=high → 数据量结论可直接使用
> ├─ Step 2 | 膨胀倍数分支判定
> │   inflation=stage_dur/task_p50=1.0
> │   [OK] 命中 A（Task 本身慢，排队贡献<50%）
> ├─ Step 3 | 【前置】并行度检查
> │   ideal_task_count=8.15TB/128MB=66805, parallelism_ratio=33.42
> │   [OK] 命中（>1.5） → 继续区分 A1a/A1b/A1c
> ├─ Step 4 | A1 子原因路由
> │   无 AQE coalesce 信息、shuffleReadBytes(8.15TB)>inputBytes(0) → A1b
> │   [OK] 进入 A1b_shuffle_partitions_low
> ├─ Step 5 | 【主原因】A2 小文件判定
> │   per_task=4.2GB > 1MB 阈值 → 未命中
> │   [FAIL] 不触发 A2，主原因继承 A1b
> └─ Step 6 | 【终局】
>     final_sub_cause=A1b_shuffle_partitions_low, severity=3
> ```
>
> **这样做的目的**：
> 1. **可复盘**：用户能清晰看到脚本为什么把这个 Stage 判定成某个 sub_cause，避免黑盒；
> 2. **可反驳**：如果用户认为某一步的阈值/逻辑有问题（例如「128MB/Task 是硬编码，没考虑 Task 实际耗时」），可以精准定位到是 Step 3 的 gate，而不是笼统地说「诊断不准」；
> 3. **可跳步修正**：当发现某一步判定错误（例如 metrics_reported 样本过低导致 total_data_bytes 被低估），用户可以明确要求「忽略 Step 3 的结论」，不会污染其他步骤。
>
> **严禁**：只给 `sub_cause` 结论、不展示 `decision_trace`；只写 verdict 一句话而不列决策路径。
---

### Fallback：History Server 指标全部获取失败时，通过 Driver 日志分析

> [WARN] **严格触发条件**：**仅当** `do-bigdata spark app-info` 命令返回 404 或错误（即 History Server 完全无法获取该 App 的任何指标数据）时，才进入此 fallback 流程。以下情况**不触发** fallback：
> - History Server 返回了 App 基础信息但部分指标缺失 → 继续用已有指标分析
> - 某个 Stage/Job 的详细数据获取失败 → 换其他子命令或调整参数重试
> - 用户只是想看日志而非指标分析 → 不走此流程，引导用户使用 `yarn-app-diagnose`

**目的**：当 History Server 完全不可用时，借助 `yarn-app-diagnose` Skill 的 **日志获取 API** 拉取 Spark Driver (AM) 日志，在本 Skill 内完成慢分析。

> [WARN] **禁止推荐 eventlog 相关参数**：进入 Fallback 流程意味着 eventlog 不存在，此时**严禁在优化建议中推荐 `spark.eventLog.enabled`、`spark.eventLog.compress`、`spark.eventLog.dir` 等 eventlog 持久化参数**。这是平台侧配置问题，不是用户任务可调的参数，推荐此类参数属于"马后炮"，对当前问题和后续性能优化没有实际帮助。诊断报告必须聚焦于用户可执行的性能调优方案。

**流程（3 步）：**

**Step 1：获取 AM 日志链接**

```bash
do-bigdata yarn app-info --app-id {app_id} --query "<用户原始问题>"
```

从返回中提取 `am_container_logs` 字段。

> [WARN] 链接预处理：如果链接包含 `tdw-application.tianqiong.woa.com:8080/` 代理前缀，需去掉该前缀还原为 `http://{nm_ip}:{nm_port}/node/containerlogs/{container_id}/{user}` 格式。

**Step 2：获取 Driver 日志文件列表 → 多轮 grep 提取关键信息 → 分析**

```bash
# 获取日志文件列表
do-bigdata yarn container-log-list --container-url {am_container_logs} --query "<用户原始问题>"

# 快速查看日志尾部
do-bigdata yarn container-log-tail --container-url {am_container_logs} --log-name stderr --bytes 8192 --query "<用户原始问题>"

# 搜索关键词（从尾部扫描指定字节量，支持正则）
do-bigdata yarn container-log-grep --container-url {am_container_logs} --pattern {keyword} --log-name stderr --scan-bytes 40960000 --query "<用户原始问题>"

# 分段读取日志内容（--start 负数=从尾部，正数=从头部）
do-bigdata yarn container-log-content --log-url {log_url} --start -{bytes} --length {bytes} --query "<用户原始问题>"
```

**日志文件优先级**：`stderr` > `spark.log` > `stdout` > `gc.log`

> [WARN] **关键约束**：Driver 日志可能数十 MB，无法一次性全部读取。必须通过 `grep` 参数分多轮定向搜索提取有效信息，再综合分析。

**日志获取分三轮（在主要日志文件上并行执行）：**

**第一轮：概览（了解 App 执行全貌）**

在 `stderr` 和 `spark.log` 上并行执行：
```
start=8192                          — 先看最后 8KB，了解 App 最终状态
grep=Starting job    (start=40960000) — 所有 Job 的启动时间点
grep=finished        (start=40960000) — 所有 Job/Stage 的完成时间点
```
> 通过 Job/Stage 的开始和结束时间戳，构建出执行时间线，定位**哪个阶段最耗时**。

**第二轮：定向深挖（针对第一轮发现的耗时阶段）**

根据第一轮的时间线分析结果，选择性地执行以下 grep（全部使用 `start=40960000`）：

| 怀疑方向 | grep 关键字 |
|---------|-----------|
| 数据倾斜 | `grep=Finished task` — 对比同 Stage 内各 Task 耗时 |
| Shuffle 问题 | `grep=FetchFailed`、`grep=shuffle` |
| Stage/Task 重试 | `grep=Retrying`、`grep=Lost task`、`grep=resubmitted` |
| Executor 不稳定 | `grep=Lost executor`、`grep=Removing executor`、`grep=ExecutorLost` |
| GC 问题 | `grep=heartbeat timed out`、`grep=Removing executor.*no recent heartbeats` |
| 资源分配慢 | `grep=Registered executor`、`grep=Requesting.*executor` |
| Driver 端瓶颈 | （无需 grep，从第一轮 Job 间隔判断：上一个 Job finished 到下一个 Starting job 间隔大 → Driver 端慢） |
| 错误/异常 | `grep=ERROR`、`grep=Exception`、`grep=WARN` |

**第三轮：补充（按需）**

- 如果怀疑 GC → 获取 `gc.log` 内容：`grep=Full GC`（`start=40960000`）
- 如果信息仍不足 → 增大 `start` 到 `65536`/`131072` 读更多尾部日志

**Fallback 专用诊断模式（基于日志证据链的常见 pattern）：**

> [PIN] **Pattern F1：小文件合并导致并行度=1（HiveTableScan 单 Task 瓶颈）**
>
> **触发条件（从日志 grep 中识别）**：
> - `grep=output partition` 或 Job 启动日志 → `Got job X with 1 output partitions`
> - `grep=Submitting` → `Submitting 1 missing tasks from ResultStage`（或 ShuffleMapStage 但 Task 数为 1）
> - `grep=Finished task` → 只有 1 个 Task，且耗时占 Stage 总耗时 >90%
> - `grep=input` → `Total input files` 数量大（数百~数万），但 `RDD inputSizes` 总量小（< 256MB）
>
> **根因判定**：
> 大量小文件（如数千~数万个 ORC/Parquet 文件）总大小未超过 split 阈值（通常 256MB），被 `CombineHiveInputFormat` 或 Spark 的文件合并机制合并为 1 个 split → 只生成 1 个 Task → 单线程处理所有文件的 HDFS open 操作（NameNode RPC 密集），耗时集中在 IO 元数据开销。
>
> **证据链模板**：
> ```
> 1. 只有 1 个 Task：Got job X with 1 output partitions / Submitting 1 missing tasks
> 2. 输入文件数多但总大小小：Total input files: {N} / RDD inputSizes: {M}MB (< split 阈值)
> 3. 单 Task 耗时占绝对主导：Finished task 0.0 ... (1/1) 耗时 {T}ms ≈ {分钟}分钟
> 4. 无 Shuffle（ResultStage，which has no missing parents）
> ```
>
> **优化建议输出（按优先级，仅在有证据支撑时给出对应建议）**：
>
> | 优先级 | 方案 | 给出条件 | 说明 |
> |--------|------|----------|------|
> | **P0** | **升级到 Spark 3.3 引擎** | Spark 版本非 3.3（始终给出） | Spark 3.3 的 AQE + DataSource V2 + `spark.sql.files.maxPartitionBytes` 能自动按字节量拆分 Task，不会出现"小文件合成 1 个 split"问题。**必须附带标准参数组**（见上方 [PIN] "切换到 Spark 3.3 引擎的标准参数组"） |
> | P1 | 缩小 `mapred.max.split.size` | 仅当 Spark 版本为 2.x 且使用 Hive 表（日志中有 `HiveTableScan` 或 `CombineHiveInputFormat`） | `SET livy.session.conf.mapred.max.split.size = 16777216;`（强制按 16MB 切分）|
> | P1 | 缩小分区扫描范围 | **仅当日志中有证据**表明扫描了大量分区（如 `Total input files` 数千+，或 `ds` 条件跨越 >30 天，或出现大量 partition pruning 日志） | 缩小 `ds` 时间范围减少文件数 |
> | P2 | 源表小文件合并（治本） | **仅当日志明确显示**输入文件数 >1000 且平均文件大小 < 1MB（即 `Total input files: N` 且 `inputSizes / N < 1MB`） | 建议表 owner 在数据写入管道中定期对源表做 compact / merge |
>
> **[重要] 不要无脑罗列所有建议**——每条 P1/P2 建议必须有日志中的具体证据支撑，无证据则不输出。诊断报告中只写"当前有证据证明的优化方向"。

> [PIN] **Pattern F2：Partition Reset 等待过长（Hive Metastore 分区元数据加载慢）**
>
> **触发条件**：
> - `grep=partition` → 日志中出现大量 `Waiting for partition be reseted` 循环（>50 次）
> - 或 `grep=pruning` → 分区裁剪（partition pruning）跨越大量日期分区（>100 天）
>
> **根因**：Hive Metastore 需要列出并处理大量分区元数据（如 660+ 天分区），导致 Driver 端阻塞等待。
>
> **优化建议（仅在有证据支撑时给出对应建议）**：
>
> | 优先级 | 方案 | 给出条件 | 说明 |
> |--------|------|----------|------|
> | **P0** | **升级到 Spark 3.3** | Spark 版本非 3.3（始终给出） | DPP 动态分区裁剪，更高效的 Metastore 交互。**必须附带标准参数组**（见上方 [PIN] "切换到 Spark 3.3 引擎的标准参数组"） |
> | P1 | 缩小 SQL 中的分区范围 | **仅当日志中有证据**显示 `ds` 条件跨越了大量天数（如 pruning 日志显示 >100 天，或 `Waiting for partition be reseted` 循环中可观察到时间范围） | 缩小 `ds` 条件减少分区数 |
> | P2 | 源表分区整理 | **仅当日志明确显示**分区数 >500（如 partition reset 循环次数 >500）且表有明确的历史归档可能 | drop 过期分区、归档历史数据 |
>
> **[重要] 不要无脑罗列所有建议**——P1/P2 必须有日志证据支撑，无证据则不输出。

**分析产出**：基于以上多轮 grep 结果，综合分析得出慢的根因并给出优化建议。

> [PIN] **Fallback 诊断报告输出规则补充**：
>
> 当通过 Fallback 流程诊断时，**如果检测到 Spark 版本不是 3.3（从 `yarn app-info` 返回的 `sparkVersion` 字段判断）**：
> - 诊断报告中的**第一条优化建议（P0）必须是"升级到 Spark 3.3"**，并**附带标准参数组**（见上方 [PIN] "切换到 Spark 3.3 引擎的标准参数组"中的 SET 语句）
> - 即使已经给出了其他可行的调参方案，也要将其降为 P1/P2，明确告知用户"升级引擎版本是从根本上解决此类问题的最优方案"
> - 在建议中说明 Spark 3.3 能直接解决当前问题的具体机制（如 AQE 自动拆分分区、DPP 动态裁剪等）

> [PIN] **注意**：此流程仅借用 `yarn-log-tools` 的日志获取能力（通过 `do-bigdata yarn container-log-*` CLI 命令），不使用 `yarn-app-diagnose` 的诊断分析逻辑。

---

## CLI 命令工具

| 命令 | 用途 | 调用方式 |
|------|------|---------|
| `do-bigdata spark` | 封装 Spark History Server REST API 调用 | 见下方详细说明 |

### do-bigdata spark 命令详细说明

**数据源：**
- Spark History Server `http://spark.eventlog.server.woa.com/api/v1`（统一支持已完成和运行中的 App）

**支持的子命令：**

| 子命令 | 功能 | 参数 |
|--------|------|------|
| `app-info` | 获取 Application 概览信息 | `--app-id`（可多个） |
| `jobs` | 获取 Job 列表 | `--app-id`，`--status`（可选） |
| `stages` | 获取 Stage 列表 | `--app-id`，`--job-id`（可选），`--details`（可选） |
| `task-summary` | 获取 Stage 的 Task 分位数分布 | `--app-id`，`--stage-id` |
| `task-list` | 获取 Stage 的 Task 列表（分页） | `--app-id`，`--stage-id`，`--sort-by`，`--limit` |
| `executors` | 获取 Executor 列表 | `--app-id`，`--all`（含已移除） |
| `env` | 获取运行环境和 Spark 配置 | `--app-id` |
| `sqls` | 获取 SQL 执行列表 | `--app-id`，`--details`（可选） |
| `diagnose` | ⭐ 一键综合诊断 | `--app-id`，`--result-output`（可选） |
| `compare` | ⭐ 多 Application 比对 | `--app-id`（2+个），`--result-output`（可选） |

**调用示例：**

```bash
# === 单命令调用 ===
do-bigdata spark app-info --app-id {app_id}
do-bigdata spark jobs --app-id {app_id}
do-bigdata spark stages --app-id {app_id} [--job-id {job_id}]
do-bigdata spark task-summary --app-id {app_id} --stage-id {stage_id}
do-bigdata spark task-list --app-id {app_id} --stage-id {stage_id} [--sort-by duration] [--limit 20]
do-bigdata spark executors --app-id {app_id} [--all]
do-bigdata spark env --app-id {app_id}
do-bigdata spark sqls --app-id {app_id} [--details]

# === 一键诊断 ===
do-bigdata spark diagnose --app-id {app_id}

# === 多 App 比对 ===
do-bigdata spark compare --app-id {app_id_1} --app-id {app_id_2}
```

**输出格式：** 所有子命令输出 JSON 格式。`diagnose` 和 `compare` 命令额外输出结构化诊断摘要。

> [WARN] **网络说明**：Spark History Server API（`http://spark.eventlog.server.woa.com`）需要在内网环境访问。如果本机无法直接访问，命令会提示错误，用户需要确保网络环境。se-2026-04-w3

---

## 参考文档

查阅 Spark 慢查询诊断指标术语表与决策分支说明（AI 输出报告时参考此文档解释指标）：
```bash
do-bigdata docs list --skill spark-slow-analyzer
do-bigdata docs show --skill spark-slow-analyzer --file spark_slow_patterns.md
```

## 与其他 Skill 的关系

| 联动 Skill | 联动场景 |
|-----------|---------|
| `supersql-slow-query-analyzer` | SuperSQL 诊断定位到 E4（Livy Spark Job 慢）→ 携带 application_id 进入本 Skill |
| `yarn-queue-analysis` | **已内置集成**：`spark_slow_diagnose.py` 的 `diagnose` 和 `compare` 模式会自动查询 Application 运行期间的 YARN 队列资源状况（通过无鉴权 API 反查应用组 + 获取趋势数据），输出到报告的 `yarn_queue_context` 字段。在 `compare` 模式下，会自动生成 `YARN_QUEUE_RESOURCE_DIFF` 类型的差异项，对比两次运行的队列资源竞争程度 |
| `yarn-app-diagnose` | ① Application 失败时 → 联动 Yarn 失败诊断分析日志；② **History Server 指标全部获取失败时** → 仅借用 `yarn-log-tools` 的日志获取能力（通过 `do-bigdata yarn app-info`、`do-bigdata yarn container-log-list`、`do-bigdata yarn container-log-content`、`do-bigdata yarn container-log-tail`、`do-bigdata yarn container-log-grep` 命令）拉取 Driver/Executor 日志，分析在本 Skill 内完成 |

### yarn_queue_context 输出字段说明

`diagnose` 和 `compare` 命令的输出中，`yarn_queue_context` 字段结构如下：

| 字段 | 说明 |
|------|------|
| `appgroup` | 应用组名称 |
| `cluster` | 集群名称 |
| `queue_trend.memory_pct.avg/max/min` | App 运行窗口内队列内存使用率（均值/最大/最小） |
| `queue_trend.pending_apps.max` | 运行窗口内最大排队 App 数 |
| `queue_trend.active_apps.max/avg` | 运行窗口内最大/平均活跃 App 数 |
| `queue_trend.contention_level` | 资源竞争等级：`none` / `low` / `moderate` / `high` / `severe` |
| `queue_trend.contention_label` | 资源竞争中文标签：无 / 轻微 / 中等 / 较高 / 严重 |
| `queue_trend.raw_points` | 运行窗口内的原始趋势数据点（每 ~3 分钟一个采样） |
| `queue_24h_stats` | 队列 24 小时整体统计 |

> **使用指南**：当 `contention_level` 为 `severe` 或 `high` 时，应在诊断结论中明确提及队列资源竞争对性能的影响。在 `compare` 模式下，`YARN_QUEUE_RESOURCE_DIFF` 差异项的 `explain` 字段提供了两次运行的队列资源对比结论，可直接引用。

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
