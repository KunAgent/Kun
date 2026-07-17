# supersql-codegen

面向 THive/SuperSQL 的 SQL 生成助手，处理建表、插入、分区、函数兼容等场景。

## 目录结构

### SKILL.md

Skill 的核心定义文件，包含：
- SuperSQL/THive 的完整语法规则（CREATE TABLE、INSERT、分区、CTE、字段类型、UDF 等）
- 跨引擎（StarRocks / Presto）函数白名单（158 个）及禁用函数替代方案
- Null 处理差异、时间一致性要求、最小时间取数原则
- SQL 生成最简原则与检查清单
- 两个 API 的调用指南与选择逻辑

### scripts/

提供两个 Python 脚本，用于通过 API 自动生成 SuperSQL 语句：

| 脚本 | 说明 |
|------|------|
| `sql_gen_api.py` | **取数 SQL 生成**（默认）。以 Stream 模式调用远程服务，返回 SQL 列表及执行计划，适用于取数、导出、数据准备等场景。 |
| `complex_sql_gen_api.py` | **复杂 SQL 生成**。以同步模式调用远程服务，返回包含完整计算逻辑的单段 SQL，适用于聚合统计、多表 JOIN、指标对比等一步到位的场景。 |

两个脚本均需提供 `--query`（自然语言需求）、`--table`（候选表名）、`--user_name`、`--cmk`、`--cmk_id` 等参数。

### references/

SuperSQL 官方标准文档的参考资料集合，按主题分目录组织于 `references/standard_documents/` 下：

| 子目录 | 内容 |
|--------|------|
| `1_SQL概述/` | SuperSQL 总体介绍 |
| `2_通用参考/` | SQL 使用限制、运算符、转义字符、正则表达式、Lambda 函数、保留字与关键字、数据类型转换、SQL 注释、EXPLAIN 语句、引擎差异等 |
| `3_SQL参考/` | DDL（建表/删表/分区/视图）、DML（Insert/Update/Delete/Load/导出）、DQL（Select/JOIN/Union/With/多维分析等），以及 Iceberg 表的 DDL/DML/DQL |
| `5_跨源查询/` | 跨源场景下的 DDL、DML、DQL、DCL 语句参考 |

可通过 `references/目录.md` 快速查阅完整的文档索引。

---

> 📬 如有相关问题，欢迎联系企微：**milesxie**