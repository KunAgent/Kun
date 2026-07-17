---
name: supersql-slow-query-analyzer
description: "SuperSQL 慢查询诊断与多 Session 比对技能。当用户反馈 SuperSQL 执行慢、耗时长、比以前慢、查询卡住、多次执行耗时差异大、需要对比多个 Session 的耗时差异时，使用此技能。支持单 Session 诊断和多 Session 横向比对，通过分层下钻（SuperSQL → 引擎 → Yarn/Spark）逐层定位性能瓶颈。"
---

# SuperSQL 慢查询诊断与多 Session 比对技能

## 用途

诊断 SuperSQL 执行慢、耗时长的查询，支持单 Session 诊断和多 Session 横向比对。通过分层下钻（SuperSQL Session → THive/Livy 引擎层 → Yarn/Spark Application 层）逐层分析，定位性能瓶颈并给出优化建议。

## [WARN] 强制规则（最高优先级）

### 规则1：Application 链接输出规则（强制执行）

输出 Yarn Application 相关链接时，**必须且只能使用以下来源**，严禁自行拼接 URL：

1. **如果已调用 `do-bigdata spark app-info` 或 `do-bigdata spark diagnose`，命令输出中的 `brain_link` 字段已包含正确链接，直接引用命令输出**
2. **如需手动构造链接，使用且仅使用此模板**：
   ```
   https://brain.woa.com/diagnostic/diagnose/taskdetail?taskId={application_id}&source=tdwhelperredirect&diamode=basic&productId=4
   ```
3. **严禁凭记忆拼接任何其他域名的链接**（如 `bigdata.oa.com`、`tdwhelper.oa.com`、`yarn.xx.com` 等）
4. 如果不确定链接格式，只输出 Application ID 纯文本，不附带链接

### 规则2：gaiaid 显示规则（强制执行）

当诊断中涉及 gaiaid 信息时（特别是 Livy Session 创建、任务跑到 `root.default` 队列的场景），**必须遵守以下显示规则**：

- **gaiaid=1386 是虚拟的无意义集群**，它本身不代表任何实际的 gaia/YARN 集群。当 gaiaid=1386 时，输出结论时**不显示 gaia 集群信息**，直接说"应用组 `{groupname}` 没有资源队列，导致跑到了 default 队列"即可
- **gaiaid 不等于 1386**（即是一个真实的 gaia 集群 ID）时，输出结论时需要显示 gaia 集群信息，说"应用组 `{groupname}` 在 gaia `{gaiaId}` 集群中没有资源队列，导致跑到了 default 队列"
- **gaiaid=1386 与任务跑到 default 队列是两件独立的事**。任务跑到 default 队列的根因是"应用组在对应集群没有资源队列"，gaiaid=1386 只是意味着该 gaiaid 值无参考意义、不应展示给用户。**严禁将两者混为因果关系**（如"因为 gaiaid=1386 是虚拟集群所以跑到了 default 队列"这种说法是错误的）

### 规则3：事实性断言必须有数据出处

1. **所有事实性结论必须有数据出处**：
   - 每个结论性断言（如"队列资源不足"、"数据倾斜"、"GC 压力大"）必须标注数据来源
   - 合法来源：API 返回数据、日志内容、脚本输出、参考文档中的明确定义
   - 非法来源：AI 自行推理/猜测/记忆
2. **没有数据支撑的推测，必须明确标注为推测**：
   - 格式：`[WARN] 推测（未验证）：...`
   - 绝对禁止将推测作为确定性结论输出
3. **自检规则**：输出每个事实性断言前，问自己"这个结论的数据从哪来的？"
   - "我记得"/"我推测"/"根据经验" → 不输出，或标注为推测
   - "来自脚本输出的 XXX 字段"/"来自日志中的 XXX 行" → 可以输出

### 规则4：Spark 参数推荐规则（强制执行）

当诊断结论中需要推荐 Spark 参数设置时，**必须遵守以下两条规则**：

#### 规则4.1：所有 Spark 参数必须加 `livy.session.conf` 前缀

SuperSQL 通过 Livy 提交 Spark 任务，所有 Spark 参数必须以 `livy.session.conf.` 为前缀才能生效。

**正确示例**：
```sql
SET livy.session.conf.spark.executor.memory = 40g;
SET livy.session.conf.spark.executor.memoryOverhead = 4g;
SET livy.session.conf.spark.sql.shuffle.partitions = 2999;
SET livy.session.conf.spark.sql.iceberg.split-size = 64857600;
SET livy.session.conf.spark.executor.cores = 4;
SET livy.session.conf.spark.dynamicAllocation.maxExecutors = 200;
```

**错误示例**（严禁输出）：
```sql
-- [FAIL] 缺少 livy.session.conf 前缀，在 SuperSQL 中不会生效
SET spark.executor.memory = 40g;
SET spark.sql.shuffle.partitions = 2999;
```

> **例外**：`spark.sql.adaptive.enabled` 等少数全局参数如果已由平台默认设置，无需用户手动指定。但只要是需要用户手动 SET 的参数，一律加 `livy.session.conf.` 前缀。

#### 规则4.2：Executor 内存上限 60g（严禁超限）

SuperSQL 环境中 Executor 内存存在硬性上限：**最大 60g**，不能超过此限制。

**强制约束**：
- `spark.executor.memory` 最大值为 **60g**，严禁推荐超过此值
- 推荐内存调整时，必须考虑当前值与上限的关系：
  - 当前 ≤ 20g → 可推荐翻倍（如 20g → 40g）
  - 当前 20g~40g → 可推荐适当增加（如 30g → 50g，40g → 60g）
  - 当前 ≥ 40g → 最多推荐到 60g，**并明确告知用户已接近上限**
  - 当前已经 60g → **不能再加内存**，必须转向其他优化方案（如减小 split-size、增加 shuffle partitions、减少 executor.cores）

**正确示例**：
```sql
-- 当前 20g，推荐加大到 40g
SET livy.session.conf.spark.executor.memory = 40g;
```

**错误示例**（严禁输出）：
```sql
-- [FAIL] 超过 60g 上限
SET livy.session.conf.spark.executor.memory = 80g;
SET livy.session.conf.spark.executor.memory = 100g;
```

> **当内存已达上限仍无法解决问题时的替代方案（优先级递减）**：
> 1. 减小每 Task 数据量：`SET livy.session.conf.spark.sql.iceberg.split-size = 64857600;`（Iceberg 表）
> 2. 减少单 Executor 并发 Task 数：`SET livy.session.conf.spark.executor.cores = 2;`（从 4 降到 2）
> 3. 增加 shuffle 分区数（保守上调）：`SET livy.session.conf.spark.sql.shuffle.partitions = 2999;`
> 4. 增加 Executor 数量分摊压力：`SET livy.session.conf.spark.dynamicAllocation.maxExecutors = 300;`

### 规则5：禁止推荐 eventlog 相关参数（强制执行）

当 Spark History Server 返回 404（eventlog 不存在）或进入 Fallback 流程时，**严禁在优化建议中推荐 eventlog 相关参数**。

**禁止推荐的参数（以下参数一律不输出）**：
```sql
-- [FAIL] 以下参数全部禁止推荐
SET livy.session.conf.spark.eventLog.enabled = true;
SET livy.session.conf.spark.eventLog.compress = true;
SET livy.session.conf.spark.eventLog.dir = ...;
SET spark.eventLog.enabled = true;
SET spark.eventLog.compress = true;
```

**原因**：eventlog 持久化是平台侧配置问题，不是用户任务参数调优能解决的；推荐这类参数是"马后炮"，对当前诊断和后续任务优化没有实际帮助。诊断报告应聚焦于**用户可执行、能改善性能的参数调优建议**。

### 规则6：下钻深度检查点（强制执行，不可跳过）

**在每一层分析完成后，必须执行以下检查。不通过则必须继续下钻，不允许提前停止给出结论。**

| # | 检查项 | 判定标准 | 不满足时的动作 |
|---|--------|---------|-------------|
| 1 | 耗时归因是否定位到具体引擎/阶段？ | 能回答"具体慢在 SuperSQL 调度层/引擎建连层/SQL 执行层的哪个阶段" | 未定位 → 重新分析时间线，逐阶段对比 |
| 2 | 如果慢在引擎 SQL 执行，是否已下钻到 Spark/YARN？ | 已获取 applicationId 并调用了 `do-bigdata spark diagnose` 或 `do-bigdata spark app-info` | 未下钻 → **必须**进入步骤5的 Spark 下钻流程 |
| 3 | 根因是否有量化数据支撑？ | 能回答"慢多少、为什么慢（数据倾斜/资源不足/GC/Shuffle/排队等待）" | 无量化 → 必须从 Spark Stage/Task 级指标或 YARN 队列数据中获取 |
| 4 | 比对差异是否精确到指标级？（多 Session 比对时） | 能回答"A 和 B 在哪个指标上差异多大" | 无精确差异 → 使用 `do-bigdata spark compare` 获取结构化比对 |

**严禁行为：**
- [FAIL] 只看 SuperSQL session 日志中"引擎耗时 X 秒"就下结论（这只是观测到的现象，不是根因）
- [FAIL] 只对比 Executor 数量、队列名等元信息就下结论（这些是配置差异，不是性能差异根因）
- [FAIL] 发现 applicationId 后不进一步调用 Spark/YARN 分析能力
- [FAIL] 将 SuperSQL 层面的耗时数字直接作为"诊断结论"输出（如"引擎耗时占比 90%，所以慢在引擎"——这只是定位到了层级，没有定位到根因）

### 规则7：NATIVE bypass / THive MR 引擎慢查询必须推荐 Spark 3.3 参数组（强制执行）

**触发特征（满足任一即触发）：**
1. **NATIVE bypass 走 THive**：日志中引擎选择为 `NATIVE`（THive bypass），SQL 通过 THive MapReduce 引擎执行
2. **TASK_MIGRATION / ONLY_THIVE 标记**：日志中出现 `ONLY_THIVE`、`TASK_MIGRATION` 关键字，表明表未迁移导致强制走 THive
3. **hive.execution.engine=mr**：日志中显示执行引擎为 MapReduce（`hive.execution.engine=mr` 或 `mapreduce`）
4. **无 Spark Application**：引擎执行阶段耗时占比高（S4），但无法提取到 `application_` 开头的 Yarn Application ID（THive MR 模式下不产生 Spark Application）

**[ALERT] 强制要求：**

当检测到上述触发特征时，**必须在优化建议中作为 P0 首要建议推荐 Spark 3.3 参数组**，不可遗漏。

**原因说明（诊断报告中需向用户解释）：**
- 当前 SQL 走了 THive MapReduce 引擎，MapReduce 的启动开销和执行效率远低于 Spark
- 通过配置 Spark 3.3 参数组，可将执行引擎切换为 Spark 3.3，大幅提升执行速度
- 即使存在未迁移表（`ONLY_THIVE`），也可通过设置 `supersql.datasource.migrateTask.enabled.tableStatus=IN_PROGRESS` 允许迁移中的表使用 Spark 引擎

**Spark 3.3 参数组（P0 首要建议，必须完整输出）：**

```sql
set supersql.bypass.forceAll = false;
set supersql.config.group = TASK_MIGRATION,TASK_MIGRATION_NT;
set supersql.datasource.failover.bypass = false;
set supersql.datasource.migrateTask.failOver = false;
set supersql.datasource.migrateTask.enabled.tableStatus = IN_PROGRESS;
```

**[WARN] CFT 应用组判断：** 从 session 日志中的 `groupname` 或应用组字段提取，包含 `cft` 字符串（如 `g_cdg_cft_*`）即判定为 CFT 业务，输出时必须将 `TASK_MIGRATION_NT` 替换为 `TASK_MIGRATION_CFT`。

**与步骤5下钻的关系：**
- 当触发本规则时，由于 THive MR 模式下**没有 Spark Application**，步骤5的 Spark 下钻**无法执行**
- 此时**本规则替代步骤5的下钻**，直接给出引擎切换建议作为首要优化方案
- 如果日志中同时存在其他性能问题（如 SQL 编译慢、建连慢），仍需按对应分支给出额外建议，但 Spark 3.3 参数组必须排在第一位

---

## 触发条件

当出现以下情况时使用此技能：
- 用户反馈 SuperSQL 执行慢、耗时长
- 用户说"比以前慢"、"卡住了"、"性能变差了"
- 用户需要对比两个/多个 Session 的耗时差异（如"同样的 SQL 昨天 30 秒，今天 300 秒"）
- 用户提供了 sessionId + "为什么慢"
- 用户提供了 sessionId + 慢相关关键词

---

## 诊断工作流

### 步骤0：识别输入并获取 sessionId

> [NO] **铁律：当用户提供 `ss-qe-log.woa.com`、`wedata.woa.com` 等内网 URL 时，绝对禁止使用 `web_fetch` / `fetch_url` 直接请求该 URL。正确做法是从 URL 中提取 sessionId（UUID），然后通过 curl 获取日志。**

输入类型与提取方式同 `supersql-job-analyzer` 的步骤1（参见其 SKILL.md）。

确定工作模式：
- **1 个 sessionId** → 单 Session 诊断模式
- **2+ 个 sessionId** → 多 Session 比对模式

### 步骤1：获取 SuperSQL Session 日志（三层）

> **[WARN] 日志获取强制约束（必须遵守）：**
> - **严禁手动拼接任何日志 API 的 URL**。不允许在 execute_command 中直接写 `curl "http://xxx/v1/session_log/..."` 这样的命令。所有 URL 拼接逻辑已封装在脚本中，AI 只需传 sessionId。
> - **严禁使用 `ss-qe-log.woa.com` 域名作为 API 接口**。
> - **严禁使用 `web_fetch` 工具请求日志 API**。
> - **必须使用下方的脚本命令拉取日志。**

#### 1.0 一键拉取三层日志（必须使用此方式）

```bash
do-bigdata supersql slow-query-analyze --session-id {sessionId} --query "<用户原始问题>"
```

不带 `--summary` 参数时，脚本默认拉取原始日志文件。

脚本会输出一个 JSON manifest，包含各层日志的文件路径：
```json
{
  "session_id": "xxx",
  "files": {
    "supersql": "/tmp/supersql_{sessionId}.html",
    "livy": "/tmp/livy_{sessionId}.html",
    "thive": ["/tmp/thive_{name}.html", ...]
  }
}
```

#### 1.1 从 SuperSQL 日志中提取信息

日志文件路径：`/tmp/supersql_{sessionId}.html`

**慢查询视角的提取要点**（与 job-analyzer 的错误视角不同）：
- **时间线信息**：提取每条 SQL 的开始时间、结束时间、耗时
- **引擎选择**：SQL 走了哪个引擎（NATIVE/LIVY/PRESTO/THIVE），是否发生了 Failover
- **引擎耗时**：从 `Execute query` 到返回结果的时间间隔
- **Session 建连耗时**：从 session 创建到第一条 SQL 开始执行的时间
- **THive Session Name**：提取 `fatal THIVE Session Name: {thiveSessionName}`（去重）
- **applicationId**：提取所有 `application_` 开头的 ID

#### 1.2 从 THive 日志中提取信息（如有）

日志文件路径：`/tmp/thive_{thiveSessionName}.html`（如果 manifest 中 thive 数组非空）

提取要点：
- **THive 集群**：`Session cluster:` 关键字
- **每条 SQL 的执行耗时**：`Starting command:` 到完成的时间
- **Yarn applicationId**：`jobTrackerUrl=` 关键字

#### 1.3 从 Livy 日志中提取信息（如有）

日志文件路径：`/tmp/livy_{sessionId}.html`（如果 manifest 中 livy 非 null）

提取要点：
- **Livy 集群**：`Session cluster:` 关键字
- **每条 SQL 的执行耗时**：`RSC client is executing SQL query:` 到完成的时间
- **Yarn applicationId**：`YarnClientImpl: Submitted application` 关键字
- **Livy Session 创建耗时**：从 session request 到 session ready 的时间

### 步骤2：构建执行时间线

基于三层日志，构建完整的时间线表：

```
| 序号 | 时间范围 | 阶段 | 引擎/Session | 耗时 | 说明 |
|------|---------|------|-------------|------|------|
| 1 | 10:30:00 - 10:30:02 | SuperSQL 调度 | - | 2s | Session 初始化、引擎选择 |
| 2 | 10:30:02 - 10:30:15 | Livy Session 创建 | Livy/{cluster} | 13s | 包含 YARN AM 启动 |
| 3 | 10:30:15 - 10:30:16 | SQL 发送 | Livy | 1s | SQL 下发到 Spark |
| 4 | 10:30:16 - 10:35:20 | 引擎执行 | application_xxx | 304s | [WARN] 最大耗时阶段 |
| 5 | 10:35:20 - 10:35:21 | 结果回传 | SuperSQL | 1s | 结果收集 |
```

**关键计算：**
- **总耗时** = session 结束时间 - session 开始时间
- **各阶段占比** = 阶段耗时 / 总耗时 × 100%
- **标记最大耗时阶段**（用 [WARN] 标注）

### 步骤2.5：多 Error 检查（有 error 时必须执行）

> **如果时间线 JSON 中 `error_count > 0`，必须在分析耗时瓶颈之前先检查错误情况。**

脚本输出包含 `unique_errors` 字段（对 `errors[]` 去重后的唯一错误列表），每条含：
- `excerpt`：错误块原文
- `duplicate_count`：重复次数
- `dedup_key`：去重依据

**处理规则：**
- 如果 SQL `status == 'FAILED'` 且有 error：这是**失败诊断**，需联动 `supersql-job-analyzer` 的步骤3.5（多 Error 逐条诊断），对 `unique_errors[]` 逐条匹配错误模式
- 如果 SQL `status == 'SUCCESS'` 但有 error（如 Failover 前的错误，但 Failover 后成功）：error 是中间过程的报错，分析其对总耗时的影响（Failover 引入的额外延迟）
- 如果 `unique_error_count > 1`：有多种不同错误，**必须逐条分析**，区分根因 error 和衍生 error

### 步骤3：定位耗时瓶颈层级

基于时间线，判断耗时主要消耗在哪个层级：

| 耗时层级 | 典型特征 | 诊断分支代号 |
|---------|---------|------------|
| **S1：SuperSQL 调度层慢** | Session 初始化/引擎选择/配置解析耗时长（>10s） | → 步骤4-S1 |
| **S2：引擎建连慢** | Livy Session 创建/THive Session 获取耗时长（>30s） | → 步骤4-S2 |
| **S3：SQL 编译/优化慢** | SQL parse/optimize 阶段耗时长但引擎执行很快 | → 步骤4-S3 |
| **S4：引擎 SQL 执行慢** | application 实际执行 SQL 的耗时占主要部分（>70%总耗时） | → **步骤5（Spark 下钻，必须执行）** |
| **S5：结果回传慢** | 引擎执行完成后，SuperSQL 处理结果的时间长 | → 步骤4-S5 |

### 步骤4：各层级诊断分支（SuperSQL 层面可闭环的）

#### 分支 S1：SuperSQL 调度层慢

可能原因：
1. SuperSQL 服务负载高，调度排队
2. 配置解析复杂（大量 `set` 参数）
3. 元数据查询慢（如 `REFRESH TABLE`）

诊断方式：
- 检查日志中 session 创建到第一条 SQL 下发的时间间隔
- 检查是否有大量 `set` 命令
- 检查是否有 `REFRESH` 或 `DESCRIBE` 等元数据操作

#### 分支 S2：引擎建连慢

可能原因：
1. **Livy Session 创建慢**：YARN 资源排队、AM 启动慢
2. **THive Session 获取慢**：THive Server 连接池满、THive Server 负载高
3. **Failover 导致的额外耗时**：第一个引擎失败 → 等待超时 → failover 到第二个引擎 → 二次建连

诊断方式：
- 对比 session request 时间和 session ready 时间
- 如果是 Livy，检查 YARN AM 启动日志中是否有排队等待
- 如果发生了 Failover，计算 failover 导致的额外耗时，联动 `supersql-job-analyzer` 分析失败原因

#### 分支 S3：SQL 编译/优化慢

可能原因：
1. SQL 极其复杂（大量 JOIN、子查询嵌套）
2. Calcite 优化器超时
3. 元数据获取慢（表/列/分区信息）

诊断方式：
- 检查 SQL 复杂度（JOIN 数、子查询层级）
- 检查 SuperSQL 日志中 parse/optimize 阶段的耗时

#### 分支 S5：结果回传慢

可能原因：
1. 结果集过大
2. 网络带宽瓶颈

诊断方式：
- 检查结果行数和数据量
- 建议用户 `LIMIT` 限制结果集

### 步骤5：Spark/YARN 下钻（S4 引擎 SQL 执行慢时必须执行）

> **[ALERT] 这是最关键的步骤。当步骤3判定耗时主要在引擎 SQL 执行阶段（S4）时，必须执行此步骤，绝不允许跳过。**
>
> SuperSQL session 日志只能告诉你"引擎执行花了 X 秒"，但**完全无法告诉你为什么花了这么久**。必须下钻到 Spark/YARN 层面才能看到真正的根因（数据倾斜、Shuffle 溢写、GC、资源不足等）。

#### 5.0 THive MR 引擎检查（优先于 Spark 下钻）

> **[ALERT] 在尝试 Spark 下钻之前，必须先检查当前 SQL 是否走了 THive MapReduce 引擎。如果是 THive MR 引擎，则无法进行 Spark 下钻，必须直接应用规则7。**

**检查方法：**
1. 步骤2时间线中引擎选择是否为 `NATIVE`（THive bypass）
2. 日志中是否有 `ONLY_THIVE`、`TASK_MIGRATION` 关键字
3. 是否无法提取到 `application_` 开头的 Yarn Application ID

**如果确认是 THive MR 引擎：**
- **跳过步骤 5.1~5.4**（无 Spark Application 可下钻）
- **直接应用规则7**，在优化建议中输出 Spark 3.3 参数组作为 P0 首要建议
- 继续执行步骤6输出诊断报告

**如果不是 THive MR 引擎（有 Spark Application）：**
- 继续执行步骤 5.1~5.4 正常 Spark 下钻流程

#### 5.1 获取 applicationId

从步骤1已经提取的信息中获取 applicationId。

- **单 Session 诊断**：取该 Session 的 applicationId
- **多 Session 比对**：取每个 Session 各自的 applicationId

#### 5.2 调用 Spark 诊断/比对

**[ALERT] 执行方式：必须调用 `use_skill` 工具加载 `tencent-bigdata`，然后按照 skill 指引找到并加载 `spark-slow-analyzer` skill。**

**严禁自己手动拼接 Spark History Server API 的 URL 来代替调用 skill。** Spark 下钻的全部逻辑都封装在 `spark-slow-analyzer` skill 中。

**单 Application 诊断：**
```bash
do-bigdata spark diagnose --app-id {application_id}
```

**多 Application 比对（2+ 个 applicationId）：**
```bash
do-bigdata spark compare --app-id {app_id_1} --app-id {app_id_2}
```

> **[WARN] 多 Session 比对时，如果每个 Session 都有 applicationId，必须使用 `compare` 模式**进行横向比对，而不是分别独立调用 `diagnose`。`compare` 模式会自动输出以下维度的差异：
> - **App 级**：总耗时、状态、Executor 数量差异
> - **Stage 级**：各 Stage 耗时、Task 数、数据量差异
> - **Task 级**：P50/P99/Max 分位数差异，倾斜程度
> - **资源级**：YARN 队列资源竞争程度（`YARN_QUEUE_RESOURCE_DIFF`）

#### 5.3 Fallback：History Server 不可用时

如果 `do-bigdata spark diagnose` 报告 History Server 返回 404 或连接失败：

1. **调用 `use_skill` 加载 `yarn-app-diagnose` skill**
2. 通过 yarn skill 获取 Spark Driver (AM) 日志
3. 在 Driver 日志中用多轮 grep 定位性能瓶颈（参考 `spark-slow-analyzer` SKILL.md 中的 Fallback 流程）

#### 5.4 下钻结果整合

拿到 Spark 层面的诊断结论后，与 SuperSQL 层面的时间线分析结合，形成完整的诊断链路：

```
SuperSQL 层面观测 → 引擎层面定位 → Spark/YARN 层面根因
例：总耗时 300s → 引擎执行 290s（占 96%）→ Stage 3 数据倾斜（Max Task 耗时 280s，P50 仅 2s）
```

### 步骤6：输出诊断报告

#### 单 Session 诊断报告格式

```
## 慢查询诊断结果

### 基本信息
| 项目 | 值 |
|------|------|
| SessionID | ... |
| 用户 | ... |
| SuperSQL 集群 | ... |
| 执行引擎 | ... |
| THive/Livy 集群 | ...（如有） |
| Yarn ApplicationId | ...（如有，附 Brain 诊断链接） |
| 总耗时 | ... |

> **Application 链接规则**：ApplicationId 附带的链接必须使用 Brain 链接模板：
> `https://brain.woa.com/diagnostic/diagnose/taskdetail?taskId={app_id}&source=tdwhelperredirect&diamode=basic&productId=4`
> 如果已调用 spark 脚本，直接引用输出中的 `brain_link` 字段。

### 执行时间线
（步骤2构建的完整时间线表）

### 耗时分析
| 阶段 | 耗时 | 占比 | 是否瓶颈 |
|------|------|------|---------|
| SuperSQL 调度 | Xs | X% | |
| 引擎建连 | Xs | X% | |
| SQL 编译/优化 | Xs | X% | |
| 引擎 SQL 执行 | Xs | X% | [WARN] |
| 结果回传 | Xs | X% | |

### 根因分析
（基于下钻数据的具体根因，必须有数据支撑）

**数据依据：**
- 来源1：...（如"spark_slow_diagnose.py 输出的 Stage 3 task-summary 显示 Max duration 280s, P50 2s"）
- 来源2：...

### 优化建议
（针对根因的具体参数调优建议）
```

#### 多 Session 比对报告格式

```
## 慢查询比对诊断结果

### 基本信息对比
| 项目 | Session A（快） | Session B（慢） |
|------|---------------|---------------|
| SessionID | ... | ... |
| 总耗时 | Xs | Ys |
| 执行引擎 | ... | ... |
| ApplicationId | ...（附 Brain 链接） | ...（附 Brain 链接） |

### 时间线对比
（两个 Session 的时间线并排对比，标注差异最大的阶段）

### 差异定位
| 维度 | Session A | Session B | 差异倍数 | 说明 |
|------|----------|----------|---------|------|
| 总耗时 | 30s | 300s | 10x | |
| 引擎执行 | 25s | 290s | 11.6x | [WARN] 主要差异 |
| Stage 3 耗时 | 10s | 270s | 27x | [WARN] 根因 Stage |
| Stage 3 Max Task | 5s | 260s | 52x | 数据倾斜 |
| YARN 队列竞争 | low | high | - | 资源差异 |

### 根因分析
（基于 compare 输出的结构化差异数据，精确定位差异根因）

### 优化建议
（针对根因的具体参数调优建议）
```

---

## 与其他 Skill 的关系

| 联动 Skill | 联动场景 | 联动方式 |
|-----------|---------|---------|
| `supersql-job-analyzer` | Failover 场景：引擎失败重试导致的额外耗时 | 联动其 `do-bigdata supersql job-analyze` 分析引擎为什么失败 |
| `spark-slow-analyzer` | **S4 引擎执行慢**：下钻到 Spark Stage/Task/Executor 级分析 | **必须通过 `use_skill` 加载**，调用 `do-bigdata spark diagnose/compare` |
| `yarn-app-diagnose` | History Server 不可用时的 Fallback | **必须通过 `use_skill` 加载**，获取 Driver 日志分析 |

---

## 参考文档

查阅慢查询模式速查表（待补充）：
```bash
do-bigdata docs list --skill supersql-slow-query-analyzer
```

## 日志获取方式

**严禁手动拼接 curl URL。** 统一使用 CLI 命令拉取日志：

```bash
do-bigdata supersql slow-query-analyze --session-id {sessionId} --query "<用户原始问题>"
```

CLI 内部已封装正确的域名、端口和路径，自动拉取 SuperSQL + Livy + THive 三层日志到 `/tmp/`。

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
