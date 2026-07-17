# OLAP（StarRocks）子系统 Skill 明细

> [WARN] **使用本 catalog 内任何子 skill 前，必须先读取该子 skill 的 `SKILL.md`**
>
> 本文档仅用于 **路由发现**：根据触发场景 / 关键词定位到目标子 skill 后，**必须再加载** `sub-skills/<子系统>/<skill-name>/SKILL.md`，了解完整的执行步骤、参数约束、两阶段流程与边界条件，再调用 CLI 命令或脚本。
>
> [FAIL] 严禁仅凭本文档列出的命令清单直接执行；catalog 描述通常省略关键参数与前置依赖，跳读会导致执行路径不准确。

### starrocks-load-analysis

- **目录**: `OLAP/starrocks-load-analysis/`
- **触发场景**: 查询 StarRocks 集群监控指标（CPU、内存、磁盘、查询延迟等），从智研平台获取数据；查询失败诊断、导入超时分析常联动本 Skill。
- **触发关键词**: StarRocks监控、StarRocks负载、CPU使用率、内存使用、磁盘IO、查询延迟、QPS、Compaction、智研指标
- **CLI 命令**:
  - `do-bigdata olap metric-list` — 可用指标清单
  - `do-bigdata olap metric-search` — 按关键字模糊搜指标
  - `do-bigdata olap metric-metadata` — 查指标的元信息（单位/维度）
  - `do-bigdata olap metric-data` — 拉指标时序数据
- **参考文档**: `do-bigdata docs show --skill starrocks-load-analysis --file zhiyan_metrics_guide.md`

---

### starrocks-query-failure

- **目录**: `OLAP/starrocks-query-failure/`
- **触发场景**: 排查 StarRocks 集群查询失败 / 报错 / 超时。超时类失败可联动 `starrocks-load-analysis` 做 BE 资源指标分析 [[memory:ngecgtey]]。
- **触发关键词**: StarRocks查询失败、查询报错、查询超时、SQL失败、error_code、审计日志、Memory limit exceeded
- **CLI 命令**:
  - `do-bigdata olap failure-summary` — 失败查询聚合摘要
  - `do-bigdata olap failure-detail` — 单条失败查询的详细 error_code / stack
- **参考文档**: `do-bigdata docs show --skill starrocks-query-failure --file failure_analysis_guide.md`

---

### starrocks-batch-load-diagnose

- **目录**: `OLAP/starrocks-batch-load-diagnose/`
- **触发场景**: 诊断 StarRocks **批量（离线）导入**作业问题，覆盖 Broker Load（HDFS/S3/OSS/COS/OBS/GCS/Azure/MinIO）、Spark Load、INSERT 三种导入方式。重点处理 CANCELLED 失败、QUEUEING 堆积、LOADING 卡住三大核心场景，并给出参数优化 SQL 建议。
- **触发关键词**: Broker Load、离线写入、批量导入、SHOW LOAD、导入失败、导入取消、CANCELLED、ETL_QUALITY_UNSATISFIED、数据质量不合格、max_filter_ratio、TIMEOUT、导入超时、HDFS 导入、S3 导入、OSS 导入、COS 导入、INSERT 导入、Spark Load、脏数据、dpp.abnorm、QUEUEING、LOADING 卡住
- **只读原则**: 严格只读，禁止自动执行 `CANCEL LOAD` / `ALTER LOAD` 等写操作；只以文本形式返回调优 SQL 供用户自行执行。
- **核心能力**:
  - 作业列表与健康度摘要（按状态/类型聚合）
  - 作业详情深度解析（`ErrorMsg` / `TaskInfo` / `EtlInfo` / `JobDetails`）
  - 脏数据样本抓取（`ETL_QUALITY_UNSATISFIED` 场景）
  - `information_schema.loads` 双轨查询（3.1+ 走 IS，老版本降级 `SHOW LOAD`）
  - 参数调优 SQL 生成（不执行）
- **CLI 命令**:
  - `do-bigdata olap load-list` — 作业列表（SHOW LOAD 降级路径）
  - `do-bigdata olap load-detail` — 作业详情根因解析（`ErrorMsg` / `TaskInfo` / `EtlInfo`）
  - `do-bigdata olap load-from-is` — 3.1+ 推荐（走 `information_schema.loads`，支持时间过滤 + 丰富字段）
  - `do-bigdata olap load-error` — 抓取 `ErrorLogUrls` 指向的脏数据样本
- **参考文档**: `do-bigdata docs show --skill starrocks-batch-load-diagnose --file batch_load_guide.md`

---

### starrocks-routine-load-diagnose

- **目录**: `OLAP/starrocks-routine-load-diagnose/`
- **触发场景**: 诊断 StarRocks **Routine Load 实时写入**作业问题，覆盖任务暂停（PAUSED）、任务持续失败（Aborted Task 高）、写入延迟（Lag 大）三大核心场景。支持 Kafka / Pulsar / Iceberg 三类数据源。
- **触发关键词**: Routine Load、实时导入、流式写入、PAUSED、导入暂停、消费延迟、消费卡住、导入失败、Kafka 消费、Pulsar 消费、Iceberg 实时、ALTER ROUTINE LOAD、resume routine load
- **只读原则** : 严格只读，禁止自动执行 `PAUSE/RESUME/STOP ROUTINE LOAD` 等写操作；仅生成 SQL 文本建议。
- **核心能力**:
  - 作业枚举与健康度摘要（`state_summary`）
  - 作业详情深度解析（自动展开 JobProperties / DataSourceProperties / Statistic / Progress）
  - 重点高亮 `ReasonOfStateChanged` / `ErrorLogUrls` / `OtherMsg`
  - Task 级下钻（单次失败原因）
  - 联动智研监控拉 `time_lag_of_partition` / `aborted_tasks` 指标趋势
- **CLI 命令**:
  - `do-bigdata olap rl-list` — 作业列表 + 状态聚合
  - `do-bigdata olap rl-detail` — 作业详情（最核心）
  - `do-bigdata olap rl-tasks` — 作业下所有 Task 的 Message
  - `do-bigdata olap rl-lag` — 消费延迟时序（联动智研监控）
  - `do-bigdata olap rl-failure` — 失败 Task 时序（联动智研监控）
- **参考文档**: `do-bigdata docs show --skill starrocks-routine-load-diagnose --file routine_load_guide.md`

---

### starrocks-be-crash-diagnose

- **目录**: `OLAP/starrocks-be-crash-diagnose/`
- **触发场景**: 诊断 StarRocks 集群 **BE（Backend）节点与 CN（Compute Node）节点的宕机 / 崩溃问题**（同时覆盖存算一体与存算分离架构）。即使用户没有明确提到"BE"或"CN"，只要涉及节点进程级崩溃、服务异常退出、日志里有崩溃堆栈的场景，都优先触发本 Skill，而不是只调用 starrocks-cluster-ops 看节点状态。
- **触发关键词**: BE 宕机、BE 挂了、BE 崩溃、BE down、BE 重启、BE 异常退出、be.out、CN 宕机、CN 挂了、CN 崩溃、CN down、CN 重启、CN 异常退出、cn.out、Aborted、集群挂了、StarRocks 崩溃、StarRocks 宕机
- **核心能力**（"反推崩溃时间 → 拉取节点日志 → 解析堆栈 → 反查 SQL"闭环）:
  - 节点启动时间反推崩溃时间（`LastStartTime` 字段，同时适用于 BE / CN）
  - 定向拉取崩溃日志：BE 节点 → be.out、CN 节点 → cn.out（BE / CN 在智研 ES 共用同一个索引，仅 @source 路径不同）
  - 堆栈解析 + `query_id` 抽取（`extract-crash` 本地解析器，BE / CN 堆栈格式一致，同一个工具通用）
  - 联动 `starrocks-query-info::audit-sql` 反查触发 SQL
- **CLI 命令**:
  - `do-bigdata olap backends` — 识别最近被重启的 BE（`LastStartTime`）
  - `do-bigdata olap computenodes` — 识别最近被重启的 CN（`LastStartTime`）
  - `do-bigdata olap be-log` — 拉取 be.out 崩溃日志（必须指定 `--cluster / --host / --start / --end`）
  - `do-bigdata olap cn-log` — 拉取 cn.out 崩溃日志（参数与 be-log 完全对称）
  - `do-bigdata olap extract-crash` — 从 be.out / cn.out 日志中抽取崩溃段 + `query_id`
  - `do-bigdata olap audit-sql` — 通过 `query_id` 反查触发崩溃的 SQL（`starrocks-query-info` 提供）
- **时效性**: 崩溃时间距今不超过 **7 天**（超出后智研 ES 日志可能已被清理）
- **角色判定铁律**（避免 AI 默认只走 BE 分支绕路）:
  - 用户明确说 CN/cn.out → 直接 `computenodes` + `cn-log`，不查 backends
  - 未明确节点角色 → 先调 `backends`；若返回 0 节点 → **立即** 切 `computenodes` 并从此只走 CN 分支（`cn-log`），**不要**回头试 `be-log`
  - `cn-log`/`be-log` 报错 "SR_CN_OUT_SOURCE_PATH / SR_BE_OUT_SOURCE_PATH 未配置" → 平台未接入采集，不要重试 / 不要换 IP / 不要扩窗口，改走 `starrocks-load-analysis` 看监控指标
- **参考文档**: `do-bigdata docs show --skill starrocks-be-crash-diagnose --file be_crash_diagnose_guide.md`

---

### starrocks-query-info

- **目录**: `OLAP/starrocks-query-info/`
- **触发场景**: 查看查询审计日志、排查高危操作（DROP/TRUNCATE）、查看运行中查询、EXPLAIN 执行计划、Query Profile。BE 崩溃诊断会反查此处的 audit-sql 映射 query_id。
- **触发关键词**: StarRocks审计、高危操作、DROP TABLE、运行中查询、EXPLAIN、执行计划、Query Profile、慢查询
- **CLI 命令**:
  - `do-bigdata olap audit` — 审计日志综合查询
  - `do-bigdata olap audit-sql` — 通过 `query_id` 反查 SQL 原文
  - `do-bigdata olap danger-ops` — 高危操作（DROP/TRUNCATE 等）审计
  - `do-bigdata olap running` — 当前运行中的查询列表
  - `do-bigdata olap explain` — 生成查询的执行计划
  - `do-bigdata olap profile` — 拉取 Query Profile
- **参考文档**: `do-bigdata docs show --skill starrocks-query-info --file query_analysis_guide.md`

---

### starrocks-schema-change

- **目录**: `OLAP/starrocks-schema-change/`
- **触发场景**: 排查表结构变更问题（ALTER TABLE）、查看 Schema Change 进度、分析变更失败原因。获取表 DDL 后可深度分析分区策略（类型/粒度/动态分区配置）和分桶策略，给出建表/改表优化建议。
- **触发关键词**: Schema Change、ALTER TABLE、加列、删列、改列、表变更、DDL变更、建表语句、表结构、分区策略分析、建表建议
- **只读原则** [[memory:ngecgtey]]: 不自动执行 ALTER TABLE，只查询进度、分析失败原因并以文本形式返回建议。
- **CLI 命令**:
  - `do-bigdata olap schema-change` — Schema Change 进度与失败分析
  - `do-bigdata olap table-schema` — 查目标表当前 Schema（含分区分桶策略深度分析）
- **参考文档**: `do-bigdata docs show --skill starrocks-schema-change --file schema_change_guide.md`

---

### starrocks-cluster-ops

- **目录**: `OLAP/starrocks-cluster-ops/`
- **触发场景**: 查询集群版本、地域、节点状态、全局配置、连接数、数据均衡等运营信息。
- **触发关键词**: StarRocks集群信息、集群版本、FE/BE/CN节点、全局变量、连接数、数据均衡、节点状态
- **与 BE 崩溃诊断的分工**: 如果涉及进程级崩溃 / 异常退出，优先触发 `starrocks-be-crash-diagnose`；本 Skill 只看节点状态快照。
- **CLI 命令**:
  - `do-bigdata olap ops-info` — 集群总览（版本 / 地域 / 关键配置）
  - `do-bigdata olap frontends` — FE 节点状态
  - `do-bigdata olap backends` — BE 节点状态（含 `LastStartTime`）
  - `do-bigdata olap computenodes` — CN 节点状态
  - `do-bigdata olap variables` — 全局变量
  - `do-bigdata olap processlist` — 当前连接
  - `do-bigdata olap balance` — 数据均衡情况
- **参考文档**: `do-bigdata docs show --skill starrocks-cluster-ops --file cluster_ops_guide.md`

---

### starrocks-mv-troubleshooting

- **目录**: `OLAP/starrocks-mv-troubleshooting/`
- **触发场景**: 排查 StarRocks 异步物化视图问题，包括创建失败、刷新失败 / 超时、状态异常（is_active=false）、刷新占用资源多、无法改写查询等。
- **触发关键词**: 物化视图、MV、刷新失败、is_active=false、REFRESH、MATERIALIZED VIEW、创建失败、查询改写
- **只读原则** [[memory:ngecgtey]]: 不自动执行 REFRESH / DROP MATERIALIZED VIEW，仅查询状态并生成 SQL 文本建议。
- **核心能力**:
  - 物化视图列表查询和 DDL 查看
  - 工作状态检查（is_active / 刷新状态 / 错误信息）
  - 刷新历史查看
  - 问题诊断（创建失败 / 刷新失败 / 不可用 / 资源占用 / 改写失败）
- **CLI 命令**:
  - `do-bigdata olap mv-list` — 物化视图列表
  - `do-bigdata olap mv-ddl` — 查看物化视图 DDL
  - `do-bigdata olap mv-status` — 活跃/刷新状态 + 错误信息
  - `do-bigdata olap mv-refresh-history` — 刷新历史
- **参考文档**: `do-bigdata docs show --skill starrocks-mv-troubleshooting --file mv_troubleshooting_guide.md`

---

### starrocks-privilege-analysis

- **目录**: `OLAP/starrocks-privilege-analysis/`
- **触发场景**: 用户遇到 Access denied / 权限不足报错、需要确认用户或角色的当前权限、询问如何授予特定权限。仅支持 `default_catalog` 下的权限查询。
- **触发关键词**: Access denied、权限不足、GRANT、SHOW GRANTS、授权
- **不触发场景**: 涉及 Hive / Iceberg 等外部 Catalog 的表权限（需到外部权限管理系统确认）
- **只读原则**: 不自动执行 GRANT / REVOKE，只生成语句建议。
- **核心能力**:
  - 用户 / 角色权限查询（SHOW GRANTS）
  - 权限分析（对比报错所需权限与当前权限）
  - 授权建议（给出具体 GRANT 语句文本）
- **CLI 命令**:
  - `do-bigdata olap user-grants` — 查某个用户的权限
  - `do-bigdata olap role-grants` — 查某个角色的权限
- **参考文档**: `do-bigdata docs show --skill starrocks-privilege-analysis --file privilege_guide.md`

---

### starrocks-data-distribution

- **目录**: `OLAP/starrocks-data-distribution/`
- **触发场景**: 诊断 StarRocks 集群数据分布健康状况，检测分桶数过多 / 过少 / 数据倾斜等问题，结合建表 Schema 深度分析分区策略（表达式分区/Range分区/List分区/动态分区配置）和分桶策略，给出建表/改表优化建议。
- **触发关键词**: 数据分布、分桶、分桶数、Tablet、数据倾斜、健康诊断、bucket、分区策略、建表建议、改表建议、分区优化、动态分区
- **只读原则** : 不自动执行 ALTER TABLE，只输出优化 SQL 文本建议。
- **核心能力**:
  - 集群健康概览（扫描所有表，统计健康 / 警告 / 严重问题表）
  - 单表深入诊断（Tablet 大小分布 + Schema 分析）
  - 内置诊断规则（分桶数过多 / 过少 / 数据倾斜）
  - 分区策略深度分析（分区类型识别、粒度评估、动态分区配置检查、TTL 管理、迁移建议）
  - 输出优化 ALTER TABLE 建议
- **CLI 命令**:
  - `do-bigdata olap cluster-overview` — 集群级数据分布健康概览
  - `do-bigdata olap diagnose-table` — 单表深入诊断（Tablet + Schema）
  - `do-bigdata olap table-stats` — 表级统计数据
  - `do-bigdata olap partitions` — 获取表的分区元数据（SHOW PARTITIONS，含分区键、范围、分桶数、数据量、行数等）
- **参考文档**: `do-bigdata docs show --skill starrocks-data-distribution --file data_distribution_guide.md`

---

### starrocks-table-locator

- **目录**: `OLAP/starrocks-table-locator/`
- **触发场景**: 用户只提供库名 / 表名而没有指定集群，需要反向定位归属于哪个 StarRocks 集群。常作为 `starrocks-data-distribution` / `starrocks-schema-change` / `starrocks-query-info` 等 Skill 的前置步骤。
- **触发关键词**: 表在哪个集群、库在哪个集群、反查集群、定位集群、locate table、locate database、找 StarRocks 集群、哪个 StarRocks、我只有表名、我只有库名、table 属于哪个集群、database 属于哪个集群
- **只读原则** [[memory:ngecgtey]]: 仅 SELECT 反查 `starrocks_cluster_table_info`，不涉及任何写操作。
- **能力边界**:
  - 仅支持精确匹配（不支持 LIKE / 模糊查询）
  - 数据 T+1 同步（当天新建库/表当天查不到）
  - 默认回溯 1 天，最大可调至 30 天
  - 未接入采集的集群无法反查
- **核心能力**:
  - 按表名反查（多个集群可能有同名表，全部列出）
  - 按库名反查（locate-database 是简化形式）
  - 库 + 表组合精确反查
  - 按集群分组展示，含数据量、副本数、最近更新时间
- **CLI 命令**:
  - `do-bigdata olap locate-table` — 按 db / table 反查所属集群（两个参数至少一个）
  - `do-bigdata olap locate-database` — 按库名反查所属集群（locate-table 的简化版）
- **参考文档**: `do-bigdata docs list --skill starrocks-table-locator`
