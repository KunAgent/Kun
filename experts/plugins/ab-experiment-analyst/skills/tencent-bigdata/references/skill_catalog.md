# Skill 明细目录

> 各子系统的 Skill 明细已拆分为独立文件，按需加载对应子系统的 catalog 即可。
> 具体 Skill 列表以热加载后实际结果为准。

## 子系统 Catalog 索引

根据 SKILL.md 路由表确定子系统后，加载对应 catalog 获取该子系统下所有 Skill 的详细信息（触发场景、关键词、核心能力、包含资源）。

| 子系统 | Catalog 文件 | Skill 数量 | 覆盖能力 |
|--------|-------------|-----------|---------|
| Authentication | `references/catalogs/authentication.md` | 1 | 库表访问权限检查 |
| Flink | `references/catalogs/flink.md` | 9 | Flink/Oceanus 作业诊断、管理、监控、资源、文件、项目 |
| HDFS | `references/catalogs/hdfs.md` | 4 | 丢块诊断、集群负载、存储满、基础操作 |
| OLAP | `references/catalogs/olap.md` | 8 | StarRocks 集群运营、监控、查询分析、Schema Change、物化视图、权限、数据分布 |
| OLA | `references/catalogs/ola.md` | 1 | 欧拉数据质量引擎、欧拉基线、欧拉数据DQC、欧拉告警 |
| Spark | `references/catalogs/spark.md` | 1 | Spark 慢任务诊断与性能分析 |
| SuperSQL | `references/catalogs/supersql.md` | 2 | SuperSQL 作业失败诊断、慢查询分析 |
| DataIntegration | `references/catalogs/dataintegration.md` | 4 | TDBank/Pulsar/TubeMQ/InLong 数据接入诊断 |
| US | `references/catalogs/us.md` | 3 | US 统一调度任务失败/慢任务诊断 |
| WeData | `references/catalogs/wedata.md` | 5 | SQL 执行、ChatBI 分析、SQL 生成、SQL 预检、数据地图 AI 库表检索 + 数据治理问答 |
| Yarn | `references/catalogs/yarn.md` | 2 | YARN 应用失败诊断、队列资源分析 |

**总计**: 11 个子系统，39 个 Skill

## 使用方式

1. 用户问题命中 SKILL.md 子系统路由表 → 加载子系统 SKILL.md 进行 Skill 级路由
2. 子系统 SKILL.md 路由不够精确 → 加载对应的 `references/catalogs/<子系统>.md`
3. **禁止一次性加载全部 catalog 文件**，仅加载命中的子系统
