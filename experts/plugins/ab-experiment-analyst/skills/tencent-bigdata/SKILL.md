---
name: tencent-bigdata
description: |
  天穹大数据 Skills 集合，面向天穹大数据平台(WeData)的专业技能包，提供日志分析、故障诊断、平台指导、数据运维能力。
  覆盖平台：天穹、tianqiong、WeData、TDW、Oceanus、TDBank、InLong、小马BI、EasyGraph、Hermes、Notebook。
  计算引擎：Flink(实时计算/checkpoint)、Spark(shuffle/数据倾斜)、StarRocks/Doris(OLAP/Load/SQL)、SuperSQL(THIVE/PYSQL)、HIVE。
  存储与消息：HDFS(block/小文件/EC/降冷)、Iceberg、Kafka、Pulsar、TubeMQ、TDBus。
  调度与资源：US统一调度(任务调度/运维/失败分析)、YARN(RM/NM/Container/资源池)。
  数据链路：采集、接入、入库、出库、同步、消费、校验、分析、SQL计算。
  资产治理：数据资产、数据地图、数据质量、数据安全、元数据、库表管理、模型管理。
  权限安全：权限中心、Ranger、tauth。开发运维：WeData控制台、tdwhelper、GraphServer。
---

# 天穹大数据 Skills 集合

## 会话初始化

每次会话首次加载时，执行热加载脚本拉取最新 sub-skills：

```bash
python3 ./hot_reload.py
```


## 子系统路由表

根据用户问题中的关键词，加载对应子系统的 `SKILL.md` 获取详细路由。

| 子系统 | 目录 | 触发关键词 | 说明 |
|--------|------|-----------|------|
| Authentication | `sub-skills/Authentication/` | Hive库表权限、TDW库表权限、tauth鉴权、表权限检查 | 仅限 Hive/TDW 库表访问权限检查；StarRocks 权限走 OLAP，HDFS 权限走 HDFS，消息队列权限走 DataIntegration |
| Flink | `sub-skills/Flink/` | Flink、Oceanus、实时计算、Checkpoint、作业异常、taskmanager、jobmanager、心跳超时、GC、OOM | Flink/Oceanus 流计算作业诊断、管理、监控 |
| HDFS | `sub-skills/HDFS/` | HDFS、丢块、BlockMissing、Xceiver、DataNode、NameNode、存储满、Block丢失、块副本、tdw读写慢、上传文件、put、创建目录、mkdir | HDFS 文件系统诊断（丢块/负载/存储/基础操作/文件上传/创建目录） |
| OLAP | `sub-skills/OLAP/` | StarRocks、Doris、OLAP、集群负载、查询失败、Schema Change、物化视图、FE/BE/CN节点、审计日志、高危操作、智研指标 | StarRocks 分析型数据库运维与监控 |
| Spark | `sub-skills/Spark/` | Spark慢、Spark Application、Stage耗时、数据倾斜、shuffle | Spark 慢任务诊断与性能分析 |
| SuperSQL | `sub-skills/SuperSQL/` | SuperSQL、sessionId、thive、livy、SQL链路追踪 | SuperSQL 作业诊断与慢查询分析 |
| DataIntegration | `sub-skills/DataIntegration/` | TDBank、Pulsar、TubeMQ、InLong、消息队列、数据接入、业务接口、MQ主题、入库配置、订阅滞后、消费慢 | 数据接入平台诊断（TDBank/Pulsar/TubeMQ/InLong） |
| OLA | `sub-skills/OLA/DQC/` | OLA、DQC、数据质量、质量规则、质量监控、基线、告警事件、告警查询、规则运行结果、表质量、欧拉、workbenchId、monitorId、itemId、dqc-mcp | 欧拉数据质量引擎（OLA DQC），基于 dqc-mcp MCP Server |
| US | `sub-skills/US/` | 统一调度、US任务、任务失败、任务慢、任务超时、出库失败、入库失败、等待下发、封闭域、WeData任务 | US 统一调度平台任务失败/慢任务诊断与日志分析 |
| WeData | `sub-skills/WeData/` | WeData、数据探索、执行SQL、ChatBI、SQL诊断、SQL生成、SQL预检、集群列表、资源池、CMK凭证、Notebook、代码生成、数据地图、datamap、库表检索、数据资产、找表、字段反查、表 schema、血缘、上下游、我有权限、我名下、我常用、热度表、数据治理、低热度表、未配生命周期、治理项分布、存储 Top N、治理方案、应用组治理 | WeData 平台 SQL 执行、数据分析、SQL 诊断与生成、Notebook 管理、SuperSQL 代码生成、数据地图 AI 库表检索 + 数据治理问答 |
| Yarn | `sub-skills/Yarn/` | YARN、Application、app_id、队列资源、queue、Container killed、Executor lost、OOM、Spark失败、MapReduce失败、AM日志、知识库检索 | YARN 应用失败诊断（含知识库检索辅助）与队列资源分析 |
| ~~TDBank~~ | ~~`sub-skills/TDBank/`~~ | ~~已废弃~~ | 已废弃，功能迁移至 DataIntegration |
| ~~SkillBase~~ | ~~`sub-skills/SkillBase/`~~ | ~~已废弃~~ | 已废弃，Pipeline 机制已废弃，权限校验等由 CLI 自动完成 |

## 子 skill 执行路径约束（强制）

> [WARN] **所有子 skill 调用前，必须按以下顺序加载文档，禁止跳步执行。**

1. 通过子系统路由表 / `references/skill_catalog.md` 定位到目标 **子系统**；
2. 加载对应的 `references/catalogs/{子系统}.md`，定位到目标 **子 skill**（例如 `flink-yarn-perjob`、`yarn-app-diagnose`）；
3. **必须再读取** `sub-skills/<子系统>/<子 skill>/SKILL.md`，了解完整的执行步骤、参数约束、前置依赖与边界条件；
4. 仅在读完子 skill 的 `SKILL.md` 后，才允许调用其 CLI 命令或脚本。

> [FAIL] **严禁仅凭 catalog 中的简要描述（触发场景 / 触发关键词 / CLI 命令清单）直接开始执行。** catalog 仅用于 **路由发现**，不替代子 skill 的 `SKILL.md`；catalog 列出的命令往往省略了参数细节、两阶段流程、前置条件、错误处理与场景示例，跳读会导致：执行路径不准确、参数遗漏、混用其他子系统脚本、误判失败原因等问题。
>
> [OK] 正确顺序：**子系统路由 → catalog 定位子 skill → 子 skill SKILL.md → 执行命令**。

## 执行规范

- 脚本路径必须使用完整路径：`sub-skills/<子系统>/<skill-name>/scripts/<脚本名>`
- 禁止创建临时脚本替代已有诊断脚本
- 禁止混用不同子系统的脚本
- 数据查询由 Skill 脚本负责，数据分析和报告输出由 AI 负责
- **执行任何子 skill 命令前，必须已加载其 `sub-skills/<子系统>/<skill-name>/SKILL.md`**（见上方「子 skill 执行路径约束」）

## 参考文档

以下文档按需加载，不必全部读入上下文。当多个文档可能适用时，按优先级顺序选择：

| 优先级 | 文档 | 定位 | 何时加载 |
|--------|------|------|---------| 
| 1 | `references/skill_catalog.md` | Skill 索引目录 | 子系统路由表不足以确定目标 Skill 时，加载此索引找到对应子系统 |
| 1→ | `references/catalogs/{系统名}.md` | 子系统 Skill 明细 | 从索引确定子系统后，**仅加载该子系统的 catalog**，禁止一次性加载全部。可用文件：`authentication.md`、`dataintegration.md`、`flink.md`、`hdfs.md`、`ola.md`、`olap.md`、`spark.md`、`supersql.md`、`us.md`、`wedata.md`、`yarn.md`、~~`tdbank.md`~~（已废弃）。[WARN] catalog **仅用于路由发现**，定位到目标子 skill 后必须再读取 `sub-skills/<子系统>/<skill-name>/SKILL.md` 才能执行命令。 |
| 2 | `references/operation_guide.md` | 运行时操作指南（How） | 需要组合诊断的联动关系、路由歧义判定规则、脚本执行报错排查、场景示例时 |
| 3 | `references/development_guide.md` | Skill 开发规范 | 仅在需要新增或修改 Skill 时加载 |

> **边界说明**：`skill_catalog.md` + `catalogs/*.md` 回答"有哪些 Skill、各自做什么"；`operation_guide.md` 回答"多个 Skill 如何协作、歧义如何判定、脚本怎么调"；`development_guide.md` 回答"如何创建新 Skill"。三者不重叠。

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
