---
name: starrocks-olap-skills
description: >
  StarRocks OLAP 运维技能总览。涵盖集群运营信息查询、集群负载监控分析、查询失败分析、
  查询信息获取（审计/执行计划/Profile）、Schema Change 分析、异步物化视图故障排查、
  权限问题排查、数据分布健康诊断、BE 宕机诊断、Routine Load 实时导入诊断、Batch Load 批量离线导入诊断等子 Skill。
  当用户询问 StarRocks 集群相关的运维问题时，根据问题类型匹配对应的子 Skill 进行处理。
  触发关键词："StarRocks", "OLAP", "集群运维", "查询失败", "物化视图", "Schema Change", "权限排查", "数据分布", "监控指标", "审计日志", "BE 宕机", "BE 崩溃", "be.out", "Routine Load", "实时导入", "流式写入", "PAUSED", "Kafka 消费", "Pulsar 消费", "Iceberg 实时", "Broker Load", "离线导入", "批量导入", "SHOW LOAD", "CANCELLED", "max_filter_ratio", "HDFS 导入", "S3 导入", "OSS 导入", "COS 导入", "INSERT 导入", "Spark Load", "分区", "SHOW PARTITIONS", "分区元数据", "分区键", "分区范围"
---

# StarRocks OLAP Skills 总览

> API 服务地址：`http://do-mcp.server.woa.com:8080`

## 子 Skill 路由表

| # | Skill 名称 | 触发关键词 | 简介 |
|---|-----------|-----------|------|
| 1 | [集群运营信息](#1-starrocks-cluster-ops) | 集群版本/节点/配置/连接/均衡 | 查询集群基本信息、节点状态、配置参数 |
| 2 | [集群负载分析](#2-starrocks-load-analysis) | CPU/内存/磁盘/监控/指标/负载 | 从智研监控查询时序指标数据 |
| 3 | [查询失败分析](#3-starrocks-query-failure) | 查询失败/报错/超时/错误码 | 分析查询失败原因（不含物化视图相关） |
| 4 | [查询信息获取](#4-starrocks-query-info) | 审计/慢查询/Profile/执行计划/高危操作 | 审计记录、SQL 分析、Profile |
| 5 | [Schema Change](#5-starrocks-schema-change) | ALTER/加列/改列/DDL/表变更 | 分析表结构变更进度和失败原因 |
| 6 | [物化视图故障排查](#6-starrocks-mv-troubleshooting) | 物化视图/MV/刷新失败/is_active | 排查 MV 刷新、不可用、改写查询失败 |
| 7 | [权限问题排查](#7-starrocks-privilege-analysis) | Access denied/权限/GRANT/角色 | 查看权限、分析不足、给出授权建议 |
| 8 | [数据分布诊断](#8-starrocks-data-distribution) | 分桶/Tablet/数据倾斜/分区/分区元数据 | 诊断分桶问题，查看分区元数据，给出优化建议 |
| 9 | [BE 宕机诊断](#9-starrocks-be-crash-diagnose) | BE 宕机/BE down/be.out/SIGSEGV/SIGABRT/Aborted/core dump | 反推崩溃时间 → 拉 be.out → 解析堆栈 → 反查 SQL |
| 10 | [Routine Load 诊断](#10-starrocks-routine-load-diagnose) | Routine Load/实时导入/PAUSED/Kafka 消费/Pulsar 消费/延迟高/导入失败 | 作业列表 → 详情 → Task 下钻 → 延迟/失败时序 → 参数优化 |
| 11 | [Batch Load 诊断](#11-starrocks-batch-load-diagnose) | Broker Load/离线导入/SHOW LOAD/CANCELLED/质量不合格/max_filter_ratio/TIMEOUT/HDFS/S3/OSS | 作业列表 → 详情 → 脏数据样本 → 按 ErrorMsg.type 分派 → 生成优化 SQL |
| 12 | [库表反查集群](#12-starrocks-table-locator) | 表在哪个集群/库在哪个集群/反查集群/locate table/我只有表名/我只有库名 | 按 db/table 精确反查所属 StarRocks 集群（T+1 快照） |

---

## 1. starrocks-cluster-ops

**触发场景**：用户询问集群版本、地域、负责人、节点状态、全局配置、连接数、数据均衡等运营信息。

### 核心命令

```bash
# 集群运营信息
do-bigdata olap ops-info --cluster <集群名称> --query "<用户原始问题>"

# 节点状态（FE / BE / CN）
do-bigdata olap frontends --cluster <集群名称> --query "<用户原始问题>"
do-bigdata olap backends --cluster <集群名称> --query "<用户原始问题>"
do-bigdata olap computenodes --cluster <集群名称> --query "<用户原始问题>"

# 全局变量配置（支持 --keyword 过滤）
do-bigdata olap variables --cluster <集群名称> --query "<用户原始问题>"

# 活跃连接
do-bigdata olap processlist --cluster <集群名称> --query "<用户原始问题>"

# 数据均衡（支持 --sub-type running/waiting/history）
do-bigdata olap balance --cluster <集群名称> --query "<用户原始问题>"
```

### 参考文档

```bash
do-bigdata docs show --skill starrocks-cluster-ops --file cluster_ops_guide.md
```

---

## 2. starrocks-load-analysis

**触发场景**：用户询问集群监控指标（CPU、内存、磁盘、网络、查询延迟等）、查看负载状态或性能趋势、排查性能问题需要历史监控数据。
**协作声明**：本 Skill 负责查看监控指标数据，query-failure 负责分析查询失败原因。当 query-failure 检测到超时类失败时会联动本 Skill 查看对应时段的指标，两者协作而非重叠。

### 核心命令

> **[WARN] 重要**：查询指标数据前，**必须**先通过 `metric-search` 确认指标名称存在，再用 `metric-metadata` 验证。严禁跳过验证直接查询。

```bash
# 搜索指标
do-bigdata olap metric-search --keyword <关键字> --query "<用户原始问题>"

# 获取指标元数据（查询数据前必须先执行）
do-bigdata olap metric-metadata --metric <指标名称> --query "<用户原始问题>"

# 查询指标数据（默认最近 1 小时）
do-bigdata olap metric-data --cluster <集群名称> --metric <指标名称> --query "<用户原始问题>"
# 指定时间：--hours 6 或 --start "2026-03-07 10:00:00" --end "2026-03-07 11:00:00"
```

### 多指标组合分析建议

- **资源水位**：CPU → 内存 → 磁盘使用率
- **查询性能**：Query QPS → Query Latency
- **数据健康**：Compaction Score → 版本数量

### 参考文档

```bash
do-bigdata docs show --skill starrocks-load-analysis --file zhiyan_metrics_guide.md
```

---

## 3. starrocks-query-failure

**触发场景**：用户想了解集群近期查询失败情况、排查查询报错原因、查询超时需结合监控判断负载。

### 核心命令

```bash
# 失败概览（默认最近 1 小时，支持 --hours 24 或 --start/--end）
do-bigdata olap failure-summary --cluster <集群名称> --query "<用户原始问题>"

# 失败详情（支持 --error-code、--user、--limit 过滤）
do-bigdata olap failure-detail --cluster <集群名称> --query "<用户原始问题>"
```

### 失败分类参考

| 失败类型 | 特征关键字 | 分析方向 |
|---------|-----------|---------|
| 超时 | `timeout` / `exceeded` | 联动 load-analysis 查看集群负载 |
| 内存不足 | `Memory limit exceeded` | 查询内存消耗大或集群内存紧张 |
| 语法错误 | `Syntax error` | SQL 语法问题 |
| 表/列不存在 | `Unknown table/column` | 元数据问题 |
| 权限问题 | `Access denied` | 联动 privilege-analysis 排查 |

### 联动说明

超时类失败自动联动 **starrocks-load-analysis** 查看对应时段 CPU、内存等指标。权限类失败联动 **privilege-analysis** 查看用户权限。

### 参考文档

```bash
do-bigdata docs show --skill starrocks-query-failure --file failure_analysis_guide.md
```

---

## 4. starrocks-query-info

**触发场景**：查看查询审计日志、排查高危操作（DROP/TRUNCATE）、查看运行中/排队中查询、分析 SQL 执行计划、获取 Query Profile。

### 核心命令

```bash
# 审计记录（默认最近 1 小时，不含 SQL 以避免 token 膨胀）
do-bigdata olap audit --cluster <集群名称> --query "<用户原始问题>"
# 含 SQL：加 --with-stmt；按类型：加 --audit-type query；时间：--hours 24 或 --start/--end

# 根据 query_id 获取完整 SQL（默认查最近 7 天，支持 --days 30）
do-bigdata olap audit-sql --cluster <集群名称> --query-id <query_id> --query "<用户原始问题>"

# 高危操作记录
do-bigdata olap danger-ops --cluster <集群名称> --query "<用户原始问题>"

# 运行中/排队中查询
do-bigdata olap running --cluster <集群名称> --query "<用户原始问题>"

# SQL 执行计划
do-bigdata olap explain --cluster <集群名称> --sql "<SQL语句>" --query "<用户原始问题>"

# Query 历史执行 Profile
do-bigdata olap profile --cluster <集群名称> --query-id "<query_id>" --query "<用户原始问题>"
```

### 典型分析场景

| 场景 | 步骤 |
|------|------|
| **慢查询排查** | audit（找慢查询 ID）→ audit-sql（获取 SQL）→ explain（执行计划）→ profile（瓶颈定位） |
| **集群负载异常** | running（当前查询）→ 联动 load-analysis 查看指标 |
| **高危操作审计** | danger-ops → audit（同时段所有操作） |

### 参考文档

```bash
do-bigdata docs show --skill starrocks-query-info --file query_analysis_guide.md
```

---

## 5. starrocks-schema-change

**触发场景**：排查表结构变更问题（加列、删列、改列类型等 ALTER TABLE）、查看 Schema Change 进度、分析变更失败原因。

### 核心命令

```bash
# Schema Change 记录（支持 --table 按表名过滤）
do-bigdata olap schema-change --cluster <集群名称> --database <库名> --query "<用户原始问题>"

# 表的建表 Schema
do-bigdata olap table-schema --cluster <集群名称> --database <库名> --table <表名> --query "<用户原始问题>"
```

### Schema Change 状态说明

| 状态 | 含义 |
|------|------|
| `PENDING` | 等待执行 |
| `WAITING_TXN` | 等待事务完成 |
| `RUNNING` | 正在执行（查看 Progress） |
| `FINISHED` | 已完成 |
| `CANCELLED` | 已取消/失败（查看 Msg） |

### 常见失败原因

| 错误特征 | 建议 |
|---------|------|
| `timeout` | 增大 `alter_table_timeout_second` 后重试 |
| `memory` / `Memory limit` | 检查 BE 内存，错峰执行 |
| `disk space` / `No space` | 清理磁盘或扩容 |
| `replica` / `tablet` | 等待副本修复后重试 |
| `type` / `cast` / `convert` | 检查类型兼容性 |
| `another alter job` | 等待当前操作完成后重试 |

### 联动说明

超时或内存不足失败时，联动 **load-analysis** 查看操作时段集群负载。

### 参考文档

```bash
do-bigdata docs show --skill starrocks-schema-change --file schema_change_guide.md
```

---

## 6. starrocks-mv-troubleshooting

**触发场景**：排查异步物化视图问题，包括创建失败、刷新失败/超时、物化视图不可用（is_active=false）、刷新任务占用过多资源、**物化视图改写查询失败**（查询未被 MV 重写）。

### 核心命令

> **[WARN] 重要**：`mv-refresh-history` 的 `--task-name` **必须**先通过 `mv-status` 获取，严禁猜测。

```bash
# 列出物化视图（支持 --database 筛选）
do-bigdata olap mv-list --cluster <集群名称> --query "<用户原始问题>"

# 查看创建语句（支持 --database 指定库）
do-bigdata olap mv-ddl --cluster <集群名称> --mv-name <物化视图名称> --query "<用户原始问题>"

# 查看工作状态
do-bigdata olap mv-status --cluster <集群名称> --mv-name <物化视图名称> --query "<用户原始问题>"

# 查看刷新历史（task_name 从 mv-status 获取）
do-bigdata olap mv-refresh-history --cluster <集群名称> --task-name <任务名称> --query "<用户原始问题>"
```

### 常见问题诊断

| 问题 | 特征 | 分析方向 |
|------|------|----------|
| 刷新失败 | `last_refresh_state=FAILED` | 检查 ERROR_MESSAGE |
| 刷新超时 | `timeout` / `exceeded` | 增大 `session.insert_timeout`，设置分区策略 |
| 内存不足 | `Memory limit exceeded` | 启用 `session.enable_spill` |
| 不可用 | `is_active=false` | 基表 Schema Change 导致，执行 `ALTER MV ACTIVE` |
| 无法改写查询 | 查询未被重写 | 使用 `TRACE REASON MV` 诊断 |

### 联动说明

刷新超时/内存不足联动 **load-analysis** 查看指标。通过 `QUERY_ID` 联动 **query-info** 获取 Profile。基表变更导致不可用联动 **schema-change** 查看变更记录。

### 参考文档

```bash
do-bigdata docs show --skill starrocks-mv-troubleshooting --file mv_troubleshooting_guide.md
```

---

## 7. starrocks-privilege-analysis

**触发场景**：用户遇到 Access denied / 权限不足报错、确认用户或角色的当前权限、询问如何授予特定权限。

### 核心命令

```bash
# 查看用户权限
do-bigdata olap user-grants --cluster <集群名称> --user <用户名> --query "<用户原始问题>"

# 查看角色权限
do-bigdata olap role-grants --cluster <集群名称> --role <角色名> --query "<用户原始问题>"
```

### 典型分析场景

| 场景 | 步骤 |
|------|------|
| **权限报错排查** | 从报错提取用户名 → user-grants 查看权限 → 对比缺失 → 给出 GRANT 建议 |
| **历史查询失败联动** | query-failure 发现 Access denied → 提取用户名 → user-grants 确认 |

### 重要限制

**仅支持 default_catalog**，无法查询 Hive、Iceberg 等外部 Catalog 权限。涉及外部表权限时需提醒用户到对应系统确认。

### 参考文档

```bash
do-bigdata docs show --skill starrocks-privilege-analysis --file privilege_guide.md
```

---

## 8. starrocks-data-distribution

**触发场景**：用户询问集群数据分布是否健康、表的分桶设置是否合理、是否存在数据倾斜，或需要集群数据分布巡检。也适用于用户询问建表/改表的分区分桶策略建议。

### 诊断规则

| 问题类型 | 判定条件 |
|---------|---------|
| 分桶数过多 | 副本总数 > 10000 且数据量 < 1T 且平均 tablet < 1G |
| 分桶数过少 | 最大 tablet > 10G 且最大与平均 tablet 相近 |
| 数据倾斜 | 最大 tablet > 10G 且最大与平均 tablet 差距大 |

### 核心命令

```bash
# 集群数据分布健康概览
do-bigdata olap cluster-overview --cluster <集群名称> --query "<用户原始问题>"

# 单表数据分布诊断
do-bigdata olap diagnose-table --cluster <集群名称> --database <库名> --table <表名> --query "<用户原始问题>"

# 原始库表统计数据（支持 --database、--table 过滤）
do-bigdata olap table-stats --cluster <集群名称> --query "<用户原始问题>"

# 获取表分区元数据（分区键、范围、分桶数、数据量、行数等）
do-bigdata olap partitions --cluster <集群名称> --database <库名> --table <表名> --query "<用户原始问题>"
# 查看最新分区：--order-by "PartitionId DESC" --limit 10
# 查看指定分区：-p <分区名>
# 查看临时分区：--temporary
```

### 典型分析场景

| 场景 | 步骤 |
|------|------|
| **集群巡检** | cluster-overview → 重点关注 critical 表 → diagnose-table 深入分析 |
| **单表诊断** | diagnose-table → 联动 schema-change 的 table-schema 获取 DDL → 分析分区分桶策略 → 给出 ALTER TABLE 建议 |
| **分区查询** | partitions 查看分区元数据（分区键、范围、数据量、行数） → 结合 diagnose-table 分析分桶合理性 |
| **建表/改表建议** | table-schema 获取 DDL → 分析分区类型和粒度 → 结合参考文档给出分区分桶优化建议 |

### 分区策略分析要点（获取 DDL 后必须分析）

获取表 DDL 后，需按以下维度分析并给出建议：
- **分区类型识别**：Range 分区 / 表达式分区 / List 分区 / 无分区
- **分区粒度评估**：是否与数据量和查询模式匹配
- **动态分区配置检查**：`dynamic_partition.buckets` 是否与初始分区一致（[WARN] 常见陷阱）
- **分区 TTL 管理**：是否配置了 `partition_live_number` 或 `partition_retention_condition`
- **分区迁移建议**：Range/List 分区 → 建议迁移到表达式分区（v3.1+）
- 详见参考文档中的「分区策略选择决策树」和「分区粒度选择建议」

### 联动说明

联动 **schema-change** 获取表 DDL 分析分区分桶策略。ALTER TABLE 前联动 **load-analysis** 查看负载。确认版本支持联动 **cluster-ops**。

### 参考文档

```bash
do-bigdata docs show --skill starrocks-data-distribution --file data_distribution_guide.md
```

---

## 9. starrocks-be-crash-diagnose

**触发场景**：用户反馈 BE 节点宕机、重启、Aborted、SIGSEGV/SIGABRT 崩溃堆栈、be.out 中出现异常、"BE down"、内存打满导致 BE 挂掉等涉及 BE 进程级异常退出的问题。

### 核心命令

```bash
# 1) 先用 cluster-ops 的 backends / computenodes 命令定位异常节点和 LastStartTime（本 Skill 复用这两个命令）
do-bigdata olap backends     --cluster <集群名称> --query "<用户原始问题>"
do-bigdata olap computenodes --cluster <集群名称> --query "<用户原始问题>"   # 仅存算分离架构有 CN

# 2A) BE 宕机：拉取指定 BE 的 be.out 日志（日志路径由服务端硬编码，外部无法指定）
do-bigdata olap be-log \
    --cluster <集群名称> \
    --host <BE IP> \
    --start "<LastStartTime 前 30 分钟>" \
    --end "<LastStartTime + 2 分钟>" \
    --query "<用户原始问题>"

# 2B) CN 宕机：拉取指定 CN 的 cn.out 日志（参数与 be-log 完全对称）
do-bigdata olap cn-log \
    --cluster <集群名称> \
    --host <CN IP> \
    --start "<LastStartTime 前 30 分钟>" \
    --end "<LastStartTime + 2 分钟>" \
    --query "<用户原始问题>"

# 3) 从日志文本中抽取崩溃堆栈和 query_id（纯本地工具，BE / CN 通用）
do-bigdata olap extract-crash --input /tmp/node_out.log --query "<用户原始问题>"

# 4) 根据 query_id 反查触发崩溃的 SQL（跨 Skill 联动 query-info）
do-bigdata olap audit-sql --cluster <集群名称> --query-id <id> --days 7 --query "<用户原始问题>"
```

### 参数说明（be-log / cn-log）

| 参数 | 是否必填 | 说明 |
|------|:-------:|------|
| `--cluster` / `-c` | [OK] | StarRocks 集群名 |
| `--host` / `-H` | [OK] | 节点 IP（BE 或 CN），**只支持单个节点**（同集群同类节点通常同因宕机，无需重复拉取） |
| `--start` / `-s` | [OK] | 起始时间 YYYY-MM-DD HH:MM:SS |
| `--end` / `-e` | [OK] | 结束时间 YYYY-MM-DD HH:MM:SS |
| `--keyword` / `-k` | [FAIL] | 过滤 @message 字段（如 Aborted / SIGABRT） |
| `--size` | [FAIL] | 单次返回条数，默认 1000，上限 10000 |

> [WARN] **不要混用**：BE 节点用 `be-log`，CN 节点用 `cn-log`。两者背后的 `@source` 不同（一个对应 be.out，一个对应 cn.out），拍错了会查不到日志。

### 联动关系

- **上游**：`starrocks-cluster-ops` 提供 `backends` / `computenodes` → `LastStartTime`
- **下游**：`starrocks-query-info` 的 `audit-sql` 反查 SQL
- **旁路**：日志拉不到堆栈时，联动 `starrocks-load-analysis` 看监控指标

### 参考文档

```bash
do-bigdata docs show --skill starrocks-be-crash-diagnose --file be_crash_diagnose_guide.md
```

---

## 10. starrocks-routine-load-diagnose

**触发场景**：用户反馈 Routine Load 实时导入作业相关问题，包括作业 PAUSED/CANCELLED、任务持续失败、消费 Kafka/Pulsar/Iceberg 延迟高、想做参数优化等。

### 核心命令（原子化，按需编排）

```bash
# 1) 列出集群所有 Routine Load 作业，按状态聚合摘要（可按 --state / --data-source 过滤）
do-bigdata olap rl-list --cluster <集群名称> --query "<用户原始问题>"
do-bigdata olap rl-list --cluster <集群名称> --state PAUSED --query "<用户原始问题>"

# 2) 查看单个作业完整配置（重点看 ReasonOfStateChanged / ErrorLogUrls / OtherMsg）
do-bigdata olap rl-detail \
    --cluster <集群名称> \
    --database <数据库名> \
    --job <作业名> \
    --query "<用户原始问题>"

# 3) 查看作业下所有 Task 的 Message（用于定位 task 级失败）
do-bigdata olap rl-tasks --cluster <集群名称> --job <作业名> --query "<用户原始问题>"

# 4) 查看延迟时序（单位：秒）
do-bigdata olap rl-lag --cluster <集群名称> --job <作业名> --hours 6 --query "<用户原始问题>"

# 5) 查看失败任务数时序
do-bigdata olap rl-failure --cluster <集群名称> --job <作业名> --hours 6 --query "<用户原始问题>"
```

### 参数说明（rl-list）

| 参数 | 是否必填 | 说明 |
|------|:-------:|------|
| `--cluster` / `-c` | [OK] | StarRocks 集群名 |
| `--state` | [FAIL] | 状态过滤: RUNNING / PAUSED / CANCELLED / STOPPED / NEED_SCHEDULE |
| `--data-source` | [FAIL] | 数据源过滤: KAFKA / PULSAR / ICEBERG |

### 分场景建议

- **PAUSED**：看 `ReasonOfStateChanged` 定根因 → 按 references 参数建议 → `PAUSE → ALTER → RESUME`
- **CANCELLED**：终态，需重建；仅告知用户原因
- **RUNNING 但失败多**：`rl-tasks` 看每个 Task 的 Message → 按关键词对照表诊断
- **RUNNING 但延迟高**：`rl-lag` 看趋势 + `rl-detail` 看并行度 → 调 `desired_concurrent_number` 或批量参数

### 联动关系

- **横向**：`starrocks-cluster-ops`（看 BE 存活数判并发上限）、`starrocks-load-analysis`（看 BE CPU/IO）、`starrocks-schema-change`（tablet 异常时查 DDL）

### 参考文档

```bash
do-bigdata docs show --skill starrocks-routine-load-diagnose --file routine_load_guide.md
```

---

## 11. starrocks-batch-load-diagnose

**触发场景**：用户反馈批量（离线）导入作业相关问题，包括 Broker Load（HDFS/S3/OSS/COS/OBS/GCS/Azure/MinIO）、Spark Load、INSERT 导入任一种的 CANCELLED/TIMEOUT/质量不合格/排队堆积/LOADING 卡住等场景。

### 核心命令（全部只读，原子化，按需编排）

```bash
# 1) 列举批量导入作业（3.1+ 优先用 information_schema，老版本降级用 SHOW LOAD）
do-bigdata olap load-from-is --cluster <集群名称> --database <库名> \
    --state CANCELLED --hours 24 --query "<用户原始问题>"

do-bigdata olap load-list --cluster <集群名称> --database <库名> \
    --state CANCELLED --type BROKER --limit 50 --query "<用户原始问题>"

# 2) 查看单个作业详情（重点看 ErrorMsg.type / URL / JobDetails）
do-bigdata olap load-detail \
    --cluster <集群名称> \
    --database <库名> \
    --label <作业 label> \
    --query "<用户原始问题>"

# 3) 拉取脏数据样本（URL 字段有值时，诊断 ETL_QUALITY_UNSATISFIED 最关键）
do-bigdata olap load-error \
    --cluster <集群名称> \
    --database <库名> \
    --label <作业 label> \
    --query "<用户原始问题>"
```

### 只读原则

> **[WARN] 强制规则**：本 Skill 不提供 CANCEL LOAD / ALTER LOAD / ADMIN SET 等写操作的自动执行能力。需要调整参数时，AI 只向用户**输出 SQL 文本**，由用户自行执行。

### 分场景建议

- **CANCELLED + ErrorMsg.type = ETL_QUALITY_UNSATISFIED**：`load-error` 拉脏数据 → 分析错误模式 → 生成重建 LOAD SQL（放宽 max_filter_ratio 或修原数据）
- **CANCELLED + ErrorMsg.type = TIMEOUT**：**强制联动 `starrocks-load-analysis`** 查同时段 BE CPU/内存/IO → 区分资源瓶颈还是 timeout 过小
- **CANCELLED + LOAD_RUN_FAIL**：看 `ErrorMsg.msg` 关键词 → 联动 cluster-ops / schema-change / 提示外部存储问题
- **LOADING 卡住**：看 `JobDetails.Unfinished backends` → 联动 cluster-ops 核 BE 状态 + load-analysis 看负载
- **QUEUEING 堆积**：查 FE 配置 `max_broker_load_job_concurrency` → 建议运维调大或降频

### 联动关系

- **强制联动**：TIMEOUT 场景 → `starrocks-load-analysis`（查 BE 资源指标）
- **横向联动**：`starrocks-cluster-ops`（看 BE 存活数、fe-config）、`starrocks-schema-change`（tablet not found）、`starrocks-be-crash-diagnose`（LOADING 卡住且 BE 可能崩过）

### 参考文档

```bash
do-bigdata docs show --skill starrocks-batch-load-diagnose --file batch_load_guide.md
```

---

## 12. starrocks-table-locator

**触发场景**：用户只提供了库名 / 表名而没有指定集群名，需要反向定位归属的 StarRocks 集群。
通常作为其他 StarRocks Skill 的**前置步骤**（绝大多数 StarRocks Skill 都强依赖 `--cluster` 参数）。

### 核心命令

```bash
# 按表名反查（多个集群可能有同名表，全部列出）
do-bigdata olap locate-table --table <表名> --query "<用户原始问题>"

# 按库 + 表组合精确反查
do-bigdata olap locate-table --database <库名> --table <表名> --query "<用户原始问题>"

# 按库名反查（locate-database 是 locate-table 的简化形式）
do-bigdata olap locate-database --database <库名> --query "<用户原始问题>"
```

### 能力边界（必须告知用户）

| 限制 | 说明 |
|------|------|
| 仅精确匹配 | 不支持 LIKE / 模糊查询；库表名必须与 StarRocks 一致 |
| 数据 T+1 | 当天新建库 / 表当天查不到，需等次日快照 |
| 依赖采集覆盖 | 未接入 `starrocks_cluster_table_info` 采集的集群无法反查 |
| 查询窗口固定 | 仅查今天快照，今天无则回退昨天；再无则返回 0 命中，不提供更长回溯 |

### 多命中场景处理

| 命中情况 | 后续动作 |
|---------|----------|
| 0 个集群 | 提示用户：可能拼写错误 / T+1 未同步 / 集群未接入采集；本工具不提供更长回溯重试能力 |
| 1 个集群 | 直接告知集群名，并询问后续诊断 |
| 多个集群 | **必须列出全部命中**，请用户确认目标集群后再继续；不要擅自挑选 |

### 联动说明

反查到集群后可继续联动：
- `starrocks-data-distribution`（数据分布诊断 / partitions）
- `starrocks-schema-change`（建表语句）
- `starrocks-query-info`（审计 / Profile）
- `starrocks-cluster-ops`（节点状态 / 版本）

### 只读原则

仅 SELECT 反查 `starrocks_cluster_table_info`，不涉及任何写操作 [[memory:ngecgtey]]。

### 参考文档

```bash
do-bigdata docs list --skill starrocks-table-locator
```

---

## 全局限流规则

> **[WARN] 强制规则**：所有 StarRocks Skill 命令调用必须遵守：

1. **失败计数**：命令返回错误（退出码非 0、输出含 `[错误]`、API 返回 `success: false`）计为一次失败
2. **累计阈值**：同一次用户问答中，**累计失败不超过 3 次**（跨 Skill 累计）
3. **终止行为**：达到 3 次立即停止，输出已收集信息和失败摘要

```
[WARN] 命令调用失败次数已达上限（3 次），终止本次分析。

失败记录：
1. [子命令] — 失败原因
2. [子命令] — 失败原因
3. [子命令] — 失败原因

建议：请检查集群名称是否正确、API 服务是否正常运行，或联系运维人员排查。
```

---

## Skills 间联动关系

```
┌─────────────────────────┐
│  starrocks-cluster-ops  │  ← 集群全貌入口
└──────────┬──────────────┘
           │ 节点异常时查看监控
           ▼
┌─────────────────────────┐       ┌──────────────────────────┐
│ starrocks-load-analysis │ ◄─────│  starrocks-query-failure │
│  （监控指标查询）         │  超时  │  （查询失败分析）          │
└──────────▲──────────────┘  联动  └───────────┬──────────────┘
           │                                   │ 权限问题
           │ 负载异常时查看监控                   │ 联动
┌──────────┴──────────────┐       ┌────────────┴───────────┐
│ starrocks-schema-change │       │  starrocks-query-info  │
│  （Schema Change 分析）   │       │ （审计/计划/Profile）    │
└──────────┬──────────────┘       └──────────▲─────────────┘
           │ 基表变更 → MV 不可用              │ Profile 分析
           ▼                                  │
┌──────────────────────────────────────────────┴─┐
│  starrocks-mv-troubleshooting                   │
│  （物化视图故障排查：含 MV 改写查询失败）         │
└─────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────┐
│  starrocks-privilege-analysis                      │
│  ← 被 query-failure/mv/schema-change 联动          │
└───────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────┐
│  starrocks-data-distribution                       │
│  → 联动 schema-change（DDL）/ load-analysis（负载）│
│  → 联动 cluster-ops（版本确认）                     │
└───────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────┐
│  starrocks-be-crash-diagnose                       │
│  ← 依赖 cluster-ops 的 backends（拿 LastStartTime）│
│  → 联动 query-info 的 audit-sql（反查触发 SQL）     │
│  → 无堆栈时联动 load-analysis 看指标趋势            │
└───────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────┐
│  starrocks-routine-load-diagnose                   │
│  → 联动 cluster-ops（backends 看并发上限）          │
│  → 联动 load-analysis（延迟高时查 BE 负载）          │
│  → 联动 schema-change（tablet 异常时查 DDL）        │
└───────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────┐
│  starrocks-batch-load-diagnose                     │
│  → 强制联动 load-analysis（TIMEOUT 时查 BE 资源）    │
│  → 联动 cluster-ops（BE 存活、fe-config）           │
│  → 联动 schema-change（tablet not found）           │
│  → 联动 be-crash-diagnose（LOADING 卡住且 BE 异常） │
└───────────────────────────────────────────────────┘
```

### 典型组合场景

| 场景 | 涉及 Skills | 流程 |
|------|------------|------|
| 集群全面巡检 | cluster-ops → load-analysis | 节点状态 → 监控指标 |
| 查询超时排查 | query-failure → load-analysis → query-info | 失败概览 → 查监控 → SQL + Profile |
| 慢查询优化 | query-info（audit → explain → profile） | 找慢查询 → 执行计划 → Profile |
| Schema Change 失败 | schema-change → load-analysis | 失败原因 → 操作时段负载 |
| MV 刷新失败 | mv-troubleshooting → load-analysis → query-info | 状态 + 刷新历史 → 负载 → Profile |
| MV 不可用 | mv-troubleshooting → schema-change | is_active 状态 → 基表变更记录 |
| 权限报错排查 | query-failure → privilege-analysis | Access denied → 用户权限 → GRANT 建议 |
| 数据分布巡检 | data-distribution → schema-change → load-analysis | 概览 → DDL → 负载 → ALTER 建议 |
| **BE / CN 节点宕机诊断** | **cluster-ops → be-crash-diagnose → query-info** | **backends/computenodes 反推崩溃时间 → be-log（BE）/ cn-log（CN）拉堆栈 → extract-crash 抽 query_id → audit-sql 反查 SQL** |
| **Routine Load 诊断** | **routine-load-diagnose (+ cluster-ops / load-analysis)** | **rl-list 找 PAUSED → rl-detail 看原因 → rl-tasks / rl-lag / rl-failure 下钻 → 给参数建议** |
| **Batch Load 诊断** | **batch-load-diagnose (+ load-analysis / cluster-ops)** | **load-from-is/load-list 找 CANCELLED → load-detail 看 ErrorMsg.type → load-error 拉脏数据 / 联动 load-analysis 查资源 → 生成优化 SQL** |

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
