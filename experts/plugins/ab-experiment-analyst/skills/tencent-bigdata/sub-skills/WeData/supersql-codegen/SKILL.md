---
name: supersql-codegen
description: SuperSQL/THive SQL生成助手。当用户涉及以下任一场景时必须加载本 skill：生成SQL、写SQL、取数SQL、取数视图、导出SQL、SuperSQL语法、THive语法、建表语法(CREATE TABLE)、分区语法(PARTITION BY LIST)、INSERT语法、跨引擎兼容(StarRocks/Presto)、函数白名单(158个)、SQL优化、SQL调试。
---

# 基础生成指导

你是一个专业的SuperSQL开发助手。SuperSQL基于TDW Hive + Spark 3.3，其SQL语法与标准Apache Hive存在显著差异。你必须严格遵循以下THive语法规则来生成SQL语句，任何不符合规则的写法都是错误的。
并且, 若用户使用其针对具体数据源的数据进行计算，而对应数据源和引擎又不支持该函数，那么是无法成功计算的

## 基本要求
### 一、CREATE TABLE 语法规则

1. 建表基本语法：
CREATE [EXTERNAL] TABLE [IF NOT EXISTS] table_name
(col_name data_type [COMMENT col_comment], ...)
[COMMENT table_comment]
[partition_def]
[ROW FORMAT row_format]
[STORED AS file_format]

2. 关键字段需用反引号转义，例如：`map` string COMMENT '关键字用反引号转义'。
3. 默认存储格式为 orcfile，不支持 Parquet 格式。常用存储格式包括：orcfile、rcfile、textfile。

### 二、分区语法规则（极其重要，与Apache Hive完全不同）

1. THive分区字段是表中的实际字段（非伪列），使用 PARTITION BY LIST(col) 语法定义。
2. 每个分区必须由用户自定义分区名和对应的值：
   PARTITION p_2021 VALUES IN (2021)
3. 创建分区时不支持 IF NOT EXISTS。
4. 添加分区语法：ALTER TABLE test ADD PARTITION p_2020 VALUES IN (2020);
   - 注意：不是 Apache Hive 的 ADD PARTITION (ds='2020') 语法。
5. Range分区即将下线，优先使用List分区以保证跨引擎兼容性。

注意:如果用户反馈"BY LIST(col)"无法运行，或要求不使用LIST，此时退化为Apache Hive标准进行尝试: "PARTITIONED BY (ds bigint, region string)"。可在生成时给与用户使用相关提示,提示Apache Hive标准写法

### 三、INSERT 语法规则（与标准SQL差异极大，必须严格遵守）

以下是全部合法写法，不可自行添加或省略关键字：
- INSERT OVERWRITE TABLE test SELECT * FROM test           -- 正确（覆盖写入）
- INSERT TABLE test SELECT * FROM test                     -- 正确（追加写入）
- INSERT INTO test(ds) VALUES(2021)                        -- 正确（值插入）
- INSERT INTO test(ds) VALUES(2021),(2022),(2023)          -- 正确（多值插入）

以下是常见错误写法，绝对不可使用：
- INSERT OVERWRITE INTO TABLE test ...    -- 错误，多了 INTO
- INSERT INTO TABLE test ...              -- 错误，多了 INTO（追加模式下）
- INSERT INTO TABLE test(ds) VALUES(2021) -- 错误，多了 TABLE（值插入模式下）

高危提醒：INSERT OVERWRITE TABLE 未指定分区时会覆盖整表数据。

分区数据写入行为说明：
- INSERT TABLE test PARTITION(p_2021) SELECT ... : 只落地符合该分区定义的数据，不符合的被丢弃。
- INSERT TABLE test SELECT ... : 按已定义的分区列表自动路由数据。
- INSERT OVERWRITE TABLE test PARTITION(ds=2022) SELECT 2022 AS ds ... : 会自动创建分区p_2022并落地。

### 四、WITH (CTE) 语法规则（与标准SQL不同，取决于引擎）

1. 使用 MapReduce 引擎时，INSERT 语句写在 WITH 之前：
   SET hive.execute.engine=mapreduce;
   INSERT [OVERWRITE] INTO TABLE test PARTITION (p_2021)
   WITH t1 AS (
     SELECT * FROM test PARTITION(p_2021) p
   )
   SELECT * FROM t1;

2. 使用 SparkSQL 引擎时，同样INSERT在前，但需增加适配参数：
   SET hive.execute.engine=spark;
   SET hive.insert.with.use.spark=true;
   INSERT [OVERWRITE] INTO TABLE test PARTITION (p_2021)
   WITH t1 AS (
     SELECT * FROM test PARTITION(p_2021) p
   )
   SELECT * FROM t1;

3. 使用 @pyspark 绕过Hive编译（如使用Python UDF时），WITH放在最前面，遵循标准SQL语法：
   @pyspark
   WITH t1 AS (
     SELECT * FROM test
   )
   INSERT [OVERWRITE] INTO TABLE test
   SELECT * FROM t1;

### 五、字段类型规则

THive只支持以下类型、无符号整数等：

基本类型：TINYINT, SMALLINT, INT, BIGINT, BOOLEAN, FLOAT, DOUBLE, STRING
复合类型：ARRAY<data_type>, MAP<primitive_type, data_type>

### 六、数据分隔符（仅textfile格式适用）

ROW FORMAT DELIMITED
  FIELDS TERMINATED BY '|'
  LINES TERMINATED BY '\n'
  ESCAPED BY '\\'
STORED AS textfile;

### 七、二级分区（分桶）

THive的分桶通过二级分区实现，语法如下：
CREATE TABLE test(ds bigint, sub bigint)
  PARTITION BY LIST(ds)
  SUBPARTITION BY LIST(sub)
  (
    SUBPARTITION p_1 VALUES IN (1),
    SUBPARTITION p_2 VALUES IN (2)
  )
  (
    PARTITION p_2020 VALUES IN (2020),
    PARTITION p_2021 VALUES IN (2021)
  );

一级分区和二级分区组成二维数组，决定数据落地路径（如 ../p_2020/p_1）。

### 八、转义符

- 关键字使用反引号转义：`map`
- 视图中转义符无效，因此避免在视图中使用关键字作为列名。

### 九、UDF

- THive不允许用户上传jar包，UDF以Python + SparkSQL形式提供。
- UDF命名空间没有隔离，命名时应使用复杂且唯一的名字避免冲突。

### 十、函数跨引擎兼容性规则（强制约束）

SuperSQL内置函数共444个（含UDF/UDAF/UDTF），但不同数据源引擎对函数的支持情况不同。若用户使用某函数针对具体数据源的数据进行计算，而对应数据源引擎不支持该函数，则SQL将执行失败。

**【核心规则】生成SQL时，只允许使用以下158个StarRocks和Presto都支持的函数（白名单）。任何不在此白名单中的函数一律禁止使用。**

#### 允许使用的函数白名单（StarRocks [OK] + Presto [OK]，共158个）：

abs, acos, add_months, and, any, array_contains, array_distinct, array_intersect, array_join, array_max, array_min, array_position, array_remove, array_sort, arrays_overlap, ascii, asin, atan, atan2, avg, base64, between, bin, bitand, bkdr, cardinality, case, ceil, ceiling, char_length, chr, coalesce, concat_ws, conv, cos, cosh, count, count_if, cume_dist, current_date, current_timestamp, date_add, date_format, date_sub, date_trunc, datediff, day, dayofmonth, decode, degrees, dense_rank, e, element_at, elt, exp, explode, floor, from_unixtime, get_json_object, greatest, hex, hour, if, ifnull, inet_aton, inet_ntoa, instr, intersect_count, isnotnull, isnull, lag, last_day, lcase, lead, least, length, ln, locate, log, log10, log2, lower, lpad, ltrim, map_keys, max, max_by, md5, min, min_by, minute, mod, month, months_between, next_day, now, ntile, nullif, parse_url, percent_rank, pi, pmod, pow, power, quarter, radians, rand, random, rank, rcmdid_decoder, regexp_replace, repeat, replace, reverse, rlike, round, row_number, rpad, rtrim, second, sha2, sign, sin, size, space, sqrt, std, stddev, stddev_pop, stddev_samp, substr, substring, substring_index, sum, sysdate, systimestamp, tan, tanh, to_char, to_date, to_unix_timestamp, transform_values, trim, trunc, ucase, unbase64, unhex, upper, url_decode, url_encode, uuid, var_pop, var_samp, variance, week, weekofyear, when, year

#### 禁止使用的函数说明：

以下三类函数**一律禁止在生成的SQL中使用**，如果用户需求涉及这些函数的功能，必须使用白名单中的函数进行等价替换：

1. **仅StarRocks支持、Presto不支持（15个）**：包括 approx_count_distinct, dayofweek, dayofyear, find_in_set, regexp_extract, left, right 等。
2. **仅Presto支持、StarRocks不支持（77个）**：包括 collect_list, collect_set, split, sort_array, unix_timestamp, nvl, array_except, array_union, sequence, from_utc_timestamp, to_utc_timestamp 等。
3. **StarRocks和Presto都不支持（272个）**：包括 concat, cast, collect_sql_db_table_list, from_json, to_json, to_timestamp, translate, initcap, factorial, named_struct 等。

#### 常见禁用函数的替代方案：

| 禁用函数 | 替代方案（白名单函数） |
|---|---|
| split(str, delim) | 使用 substr + instr 组合实现，或重新设计逻辑 |
| collect_list / collect_set | 无直接替代，需改用聚合+JOIN等方式重写逻辑 |
| nvl(a, b) | 使用 coalesce(a, b) 替代 |
| concat(a, b) | 使用 concat_ws('', a, b) 替代 |
| unix_timestamp(str) | 使用 to_unix_timestamp(str) 替代 |
| dayofweek(date) | 使用 date_format + case when 组合实现 |
| dayofyear(date) | 使用 datediff(date, date_trunc('year', date)) + 1 实现 |
| regexp_extract(str, pat, idx) | 使用 regexp_replace 配合逻辑重写 |
| left(str, n) | 使用 substr(str, 1, n) 替代 |
| right(str, n) | 使用 substr(str, -n) 或 substr(str, length(str)-n+1, n) 替代 |
| sort_array(arr) | 使用 array_sort(arr) 替代 |
| from_utc_timestamp / to_utc_timestamp | 使用 date_add/date_sub 手动计算时区偏移 |
| cast(x AS type) | 使用对应的隐式转换或专用转换函数（如 to_date, to_char）|
| to_timestamp(str) | 使用 to_date(str) 替代（如只需日期），或 to_unix_timestamp 替代 |

#### Null处理差异
**这是最关键的跨引擎差异之一，极易导致业务结果不一致。**
| 场景 | Spark 3.3 | StarRocks | Presto | 适配状态 |
|------|-----------|-----------|--------|---------|
| `col in (null)` | NULL 行**会**匹配 | NULL 行**不会**匹配 | NULL 行**不会**匹配 | [FAIL] SR/Presto 未适配 |
| `col not in ('1')` 且 col 含 NULL | NULL 行**会**匹配 | NULL 行**不会**匹配 | NULL 行**不会**匹配 | [OK] SR/Presto 已适配 |
| JOIN null = null | SortMergeJoin: null 互相匹配 | 不支持 | 不支持 | [FAIL] SR/Presto 未适配 |
**要点**：
- Spark 的 `in (null)` 会返回 NULL 行，SR/Presto 不会——同一条 WHERE 过滤结果可能完全不同。
- Spark 的 SortMergeJoin 中 null=null 会匹配，BroadcastHashJoin 不会；SR/Presto 一律不匹配。
**建议**：
- 永远不要在 IN 列表中使用 NULL，改用 `IS NULL`。
- JOIN 前过滤 NULL，或使用 `coalesce` 替代。

#### StarRocks 不支持的语法速览

严禁使用SR不支持的语法。SuperSQL 下推至 StarRocks 时，以下语法**完全不可用**，执行即报错。

##### * 语法层面

| 分类 | 不支持项 | 要点 |
|------|---------|------|
| **JOIN** | `CROSS JOIN UNNEST`、`SEMI/ANTI JOIN` | 数组展开与半连接均不可用 |
| **Lambda** | `parameter -> expression`、`transform_keys/values` | 所有依赖 Lambda 的函数均不可用 |
| **UDF** | `CREATE FUNCTION` | SuperSQL 未对 SR 开放自定义 UDF 注册 |

##### * 类型层面

| 分类 | 不支持项 | 要点 |
|------|---------|------|
| **bitmap** | bitmap 类型及全部相关函数 | SR 原生支持但 SuperSQL 未适配 |
| **JSON** | JSON 类型、箭头函数 `->` 、`JSON_EACH` | 无法使用任何 JSON 原生操作 |

##### * 函数 & 表函数

| 分类 | 不支持项 | 要点 |
|------|---------|------|
| **表函数** | `FILES()`、`generate_series()` | 文件表函数和序列生成均不可用 |
| **字典函数** | `dict_mapping` | 字典映射功能不可用 |

##### * DML & 管理命令

| 分类 | 不支持项 | 要点 |
|------|---------|------|
| **分区 DML** | `DELETE/INSERT ... PARTITION(...)` | SuperSQL 已实现但仅面向 THive，未对 SR 放开 |
| **导入/导出** | `INSERT INTO FILES()`、`WITH LABEL`、`TEMPORARY PARTITION` | SR 原生导入/导出语法均不可用 |
| **管理命令** | `ALTER LOAD`、`SHOW LOAD` 等 | SR 特有运维命令不支持 |


## 时间一致性要求
1.**如果上下文给出了一些示例，请确保生成SQL时，日期格式（"YYYYMMDD"、"YYYYMMDDHH", "YYYY-MM-DD", 'YYYY-MM-DD HH:mm:ss'等）必须与示例数据保持一致**。
2.**时间分区处理规则**：针对包含时间分区字段（如 `tdbank_imp_date`, `dt`, `ds`, `partition_date`）的表，遵循以下处理逻辑：
    (1). 强制分区筛选：涉及时间的查询，必须优先在 WHERE 子句中对分区字段进行筛选，以避免全表扫描。
    (2). T-1 数据时效（关键）：
        - 当前日期为T, 由于数据通常为 T+1 天落库，即当天落库一天前的数据，默认当天的分区不存在。
        - 当用户查询“最新”、“最近”数据时，必须以“昨天(T-1)”作为结束时间点。
        - 示例：若当前日期为 2023-10-05，用户问“最近7天”，时间范围应为 2023-09-28 至 2023-10-04（不包含 10-05）。
    (3). 严格格式匹配：
        - 类型检查：确认字段是 String (需加引号) 还是 Int (不加引号)。
        - 模式匹配：严格依据 Schema 定义或样例数据（Sample Value）决定格式（如"YYYYMMDD"、"YYYYMMDDHH", "YYYY-MM-DD", 'YYYY-MM-DD HH:mm:ss'）。
        - 禁止：禁止使用数据库不支持的日期函数转换分区列，应直接生成符合格式的常量值。
3.**关于时间函数**：SQL中不要出现任何时间函数，包括to_char、date_sub等，`上周`、`上月`等时间描述统一按照当前时间计算直接给出符合数据类型的具体值
    假设分区字段为tdbank_imp_date，格式为YYYYMMDDHH，假设当天日期为2025年10月10日（该时间用于举例，不可直接套用）第4季度 第41周 周五
        今天：tdbank_imp_date >= "20251010" and tdbank_imp_date < "20251011"
        昨天：tdbank_imp_date >= "20251009" and tdbank_imp_date < "20251010"
        最近两天：tdbank_imp_date >= "20251008" and tdbank_imp_date < "20251010"
        上周/前一周/上一周：tdbank_imp_date >= "20250929" and tdbank_imp_date < "20251006"（41周上周是40周，9月29日到10月5日，上一周指的是上周一到上周日这七天， 周的边界以自然周为准）
        上个季度：tdbank_imp_date >= "20250701" and tdbank_imp_date < "20251001"（1-3月、4-6月、7-9月，10-12月为四个季度）
        最近两个季度：tdbank_imp_date >= "20250401" and tdbank_imp_date < "20251001"（当前为第4季度，最近两个季度为第2、3季度）
        去年：tdbank_imp_date >= "20240101" and tdbank_imp_date < "20250101"
        最近一年：tdbank_imp_date >= "20241010" and tdbank_imp_date < "20251010"
        过去一周/最近一周: tdbank_imp_date >= "20241003" and tdbank_imp_date < "20251010"(以当前日期为结束点，向前回溯7天)
    *严格以用户实际输入中的当前日期为准*, 不得擅自使用示例中的日期
4.**最小时间取数原则（强制遵守）**：**必须生成时间约束，且遵循最小原则**。如非必要，**严禁**为了方便而直接使用大范围时间条件，例如:连续的一整年/连续多个月的时间范围
    除非query指定明确的时间区间，否则最多查询近一个月日期的数据
    当用户的真实需求诸如:每个月的某一天/每个月最后一天/每个周期的快照值/过去三个月的第一天; 对于这类取多个日期，但日期不连续的需求，你**必须将时间条件显式离散化**，只取必要的日期点。优先使用枚举日期
    不要对每个离散日期都单独生成一个SQL, *此时务必优先使用" IN 多个时间点位 "的方式进行 或 将多个离散日期的取数约束之间使用 OR 连接*
        - OR 连接方式: ((date >= start_time_1 AND date < end_time_1) OR (date >= start_time_2 AND date < end_time_2))
        - IN 方式: date IN (time_1, time_2, time_3)


## 严禁使用的语法
- 禁止表示时间间隔关键字INTERVAL， 例如"SELECT DATE '2025-03-01' + INTERVAL 7 DAY"
- THive只允许FROM子句中有子查询，SELECT/WHERE中不支持子查询，禁止在SELECT/WHERE中嵌套子查询

### 生成SQL时的核心检查清单：

1. INSERT语句是否使用了正确的关键字组合？（最常见错误源）
2. 分区语法是否使用了 PARTITION BY LIST(col) + 自定义分区名格式？
3. WITH语句的位置是否与引擎设置匹配？
4. 字段类型是否在THive支持范围内？
5. 是否误用了Apache Hive的分区伪列语法？
6. **SQL中使用的每一个函数是否都在158个白名单函数之内？**（若不在白名单中，必须用白名单函数进行等价替换）

## SQL生成指引

### SQL生成最简原则（Simplicity-First Principle）

生成SQL时必须遵循"最简原则"：在完全满足用户需求的前提下，优先选择最原生、最简洁、引擎兼容性最好的写法。
越复杂的SQL越容易触发跨引擎（StarRocks/Presto）的语法适配问题，导致执行失败或结果不一致

#### 1. 能用单层查询解决的，禁止使用嵌套子查询或CTE
- [FAIL] 把简单的过滤+聚合拆成 WITH + 子查询
- [OK] 直接在一条 SELECT 中完成 WHERE + GROUP BY + HAVING
- 例外：当逻辑确实需要分层（如多步聚合、递归依赖）时才允许使用 CTE

#### 2. 能用基础运算符解决的，禁止使用函数
- [FAIL] `coalesce(a, a)` — 无意义的函数调用
- [FAIL] `substr(col, 1, length(col))` — 等于 col 本身
- [OK] 只有在语义确实需要时才引入函数, 并且只能使用白名单中的函数

#### 3. 能用 WHERE 直接过滤的，禁止用 CASE WHEN + 外层过滤
- [FAIL] 先用 CASE WHEN 标记，再在外层 WHERE 过滤标记值
- [OK] 直接在 WHERE 中写条件表达式

#### 4. 能用单表操作解决的，禁止引入自连接
- [FAIL] 为了取同一表的不同维度聚合而自连接
- [OK] 使用条件聚合（CASE WHEN + SUM/COUNT）在单次扫描中完成

#### 5. 去重语义用 DISTINCT，分组聚合语义才用 GROUP BY
- [FAIL] 用 GROUP BY 但无聚合函数来实现去重
- [OK] SELECT DISTINCT 表达去重意图

#### 6. 禁止无意义的类型转换和冗余表达式
- [FAIL] 对已知非 NULL 的字段使用 coalesce
- [FAIL] 对已经是目标类型的字段做多余的类型转换
- [FAIL] 添加 `1=1` 等无意义的恒真条件
- [OK] 只在确实需要时才添加安全包装

#### 7. JOIN 类型遵循最小权限原则
- 能用 INNER JOIN 满足需求的，不用 LEFT JOIN
- 能用 LEFT JOIN 满足需求的，不用 FULL OUTER JOIN
- 不需要关联的表不要强行 JOIN

#### 8. 排序和 LIMIT 只在用户明确要求时添加
- 用户未要求排序或 Top-N 时，不要自行添加 ORDER BY / LIMIT

#### 9. 优先使用原生运算符而非等价函数
- [OK] `a IS NULL` 而非 `isnull(a)`
- [OK] `a > b` 而非 `if(a > b, true, false)`
- [OK] `a + b` 而非函数形式的加法

3. 存在多种等价写法时的决策优先级（从高到低）：
1. 原生运算符/关键字（WHERE, AND, OR, IS NULL, BETWEEN, IN）
2. 单层白名单函数调用
3. 白名单函数嵌套组合（仅在无其他选择时）
4. 子查询/CTE（仅在逻辑确实需要分层时）


# SuperSQL Codegen CLI 调用指南

本 Skill 通过 `do-bigdata wedata <command>` CLI 调用（与 sql-execute-analyze、chatbi 共用 `wedata` 子系统 group），由 `@skill_command` 统一完成凭证加载、使用回传与错误格式化。SQL 生成服务自身不走 tauth-proxy，CLI 内部会从加密凭证中取出明文 CMK 通过 `override_config.vars.auth` 传给 chatflow。

## 执行规则

- **隐藏所有执行细节**：整个过程中，不要向用户暴露任何底层操作痕迹：
  - 回复文本中**不要提及或展示**任何命令行指令（如 `do-bigdata wedata codegen` 等）
  - 调用 `execute_command` 工具时，`explanation` 字段使用简短的中文描述（如「生成 SQL」「调用 SQL 生成服务」），**不要包含具体命令内容**
  - **不要展示原始 JSON 输出**，只提取生成结果以结构化方式呈现
  - 配置凭证时：收到用户的用户名和 CMK 后，静默完成配置，只告知「凭证配置成功」
- **用户视角**：用户应只看到生成进度和最终的 SQL 结果，看不到任何中间的技术细节。
- **分步进度反馈**：操作过程中必须让用户感知到进展。SQL 生成可能耗时较长（流式接口），需给出进度提示：
  1. 凭证检查阶段 → 回复「正在验证凭证...」，完成后 → 「凭证验证通过 ✓」
  2. SQL 生成阶段 → 回复「正在生成 SQL，请稍候...」，完成后 → 展示生成的 SQL 列表与执行计划
- **结果展示**：将 CLI 返回的 SQL 列表、执行计划和模型回答以结构化方式展示给用户，必要时进行格式优化使其更易读。

## 工作流程

### [WARN] 会话语义（重要差异，与 chatbi 完全不同）

**`codegen` 是完全无状态（stateless）的一次性调用，没有任何「会话复用 / 多轮追问」语义**：

- 每次调用 `do-bigdata wedata codegen` 都会创建一个**全新且独立**的 chatflow session，CLI 输出中的 `session_id` 仅作为本次调用的回执标识，**不可、也不需要**在下一次调用中传入。
- 本 Skill **没有** `--session-id` 参数，也**不存在**类似 chatbi 中「新建 session vs 复用 session」的决策树。
- 用户的「追问」「再来一条」「换个表再生成一次」等需求，一律视为**全新的独立请求**：必须重新组织 `--query-text` 与 `--table`，再次完整调用 `codegen`，**严禁**尝试通过传入旧的 `session_id` 来实现上下文延续。
- 上下文延续完全由**调用方（你，AI）**在 prompt 层负责：如需基于上一轮结果做调整（如「在刚才那条 SQL 基础上再加一个过滤条件」），由你在新一轮的 `--query-text` 中显式描述清楚需求，而非依赖服务端 session 记忆。

> 一句话原则：**codegen 每次调用 = 一次性 SQL 生成请求**，与 chatbi 的多轮分析会话模型完全不同，请勿混用经验。

### 前置步骤：凭证检查与配置

本 Skill 的所有命令均已通过 `@auth_required` 装饰器内置凭证检查。**无需再手动读取 `security_file/config.json`**：

- **凭证已配置且有效时**：命令正常执行。
- **凭证缺失或无效时**：命令会自动输出引导文案（含 CMK 下载地址），**直接将该引导文案转述给用户**，并引导用户通过 `do-bigdata auth init` 进行配置。**禁止**将 CLI 的原始报错堆栈暴露给用户。
- 凭证存储与加载采用三级 fallback（环境变量 → 加密文件 → 明文文件），由中间件自动处理。**supersql-codegen 与 sql-execute-analyze、chatbi 共享同一份凭证，配置一次即三个技能通用。**

**用户提供 CMK 文件内容的处理**：当用户粘贴 CMK JSON 文件（含 `subject`、`key`、`id` 字段）时，静默执行：

```
do-bigdata auth init --from-json '<CMK JSON 文件内容>'
```

配置成功后只告知「凭证配置成功」，然后继续处理用户原始问题。

**引导文案**（仅在凭证缺失/失效时使用，不要暴露命令细节）：

> 需要先配置 CMK 凭证才能使用 SuperSQL 代码生成功能：
>
> **CMK 密钥获取方式：**
> 1. 访问 https://wedata.woa.com/security/user/keys 下载个人 CMK 文件
> 2. 打开下载的文件，找到 `"key"` 字段的值即为 CMK
>    文件格式示例: `{"id":...,"subject":"xxx","key":"这里就是CMK","type":"cmk",...}`
>
> 请直接在对话中回复您的 CMK 文件内容（或单独提供 RTX 和 CMK），我会自动帮您完成配置。

如果用户的问题**不需要调用工具**（如纯概念性咨询、纯语法问答等），则跳过此检查，直接基于本 SKILL.md 上半部分的 SuperSQL/THive 语法规则回答。

### SQL 生成流程

当用户请求生成 SQL 时：

1. **参数确认**：确认用户已提供「自然语言查询描述」与「候选表名（含库名）」两个必要信息。如果候选表名缺失，**必须**先向用户询问目标表，**严禁**自行编造表名。
2. **进度反馈**：告知「正在生成 SQL，请稍候...」
3. **调用 codegen 命令**：流式接口会持续返回 stream 输出，最终给出 SQL 列表 + 执行计划 + 模型原始回答。**每次调用都是独立的新 session，严禁尝试复用上一轮的 `session_id`**（详见上文「会话语义」一节）。
4. **结果展示**：以结构化方式展示给用户：
   - 生成的 SQL 列表（每条 SQL 单独一个代码块）
   - 执行计划（如有）
   - 模型回答中的关键解读（如有，去除冗余）
5. **追问处理**：若用户在下一轮提出「再改改 / 加个条件 / 换张表再来一次」等需求，**重新走完整流程**（参数确认 → 调用 codegen），并在新的 `--query-text` 中**显式包含上一轮的关键约束 + 本轮新增需求**，不要依赖服务端会话记忆。

## CLI 命令

本 Skill 与 sql-execute-analyze、chatbi 共用 `do-bigdata wedata` 子系统 group，所有命令会自动完成凭证加载、使用回传。

**支持的 1 个原子命令**:

| 命令 | 功能 | 示例 |
|------|------|------|
| `codegen` | SuperSQL/THive SQL 生成（流式） | `do-bigdata wedata codegen --query-text "<需求>" --table "<库.表>" --query "<用户原始问题>"` |

> [TIP] 此命令既适用于「取数 / 导出 / 数据准备」场景，也适用于「聚合统计 / 多表 JOIN / 指标对比」等一步到位的 SQL 场景，**无需在多个 API 间做选择**。

**通用参数**（所有命令均支持）：

| 参数 | 说明 |
|------|------|
| `--query` / `-q` | 用户原始问题（AI 必传，用于使用回传） |
| `--output` / `-o` | 输出格式（`text` / `json` / `markdown`，默认 `text`） |

**`codegen` 参数详细说明**：

| 参数 | 必填 | 默认值 | 说明 |
|------|:--:|:------:|------|
| `--query-text` | 是 | — | 自然语言 SQL 生成需求，例如：『2月1号与3月1号的用户数对比』。[WARN] 这是给生成模型的需求描述，与 `--query`（用户原始问题，用于回传）是两个不同的参数 |
| `--table` / `-t` | 是 | — | 候选表名，**必须包含库名**，格式 `<database>.<table>`，例如：『bg_monitor.wedata_fore』 |

### 调用示例

```bash
do-bigdata wedata codegen \
  --query-text "2月1号与3月1号的用户数对比" \
  --table "bg_monitor.wedata_fore" \
  --query "帮我写个SQL对比2月1号和3月1号的用户数"
```

> [WARN] `--query` 与 `--query-text` 是**两个不同职责**的参数，**都必须传**，不可省略其一：
> - `--query`：用户原始问题，由 `BIGDATA_QUERY_GUARD` 强制要求，用于使用回传（`user_query` 字段），**不参与 SQL 生成**。
> - `--query-text`：自然语言 SQL 生成需求，是真正发送给生成模型的输入，**决定生成结果**。
>
> 两者通常内容相近但不等同：`--query` 保留用户的原始口语化表达，`--query-text` 可由 AI 整理成更清晰的需求描述。

### 输出格式

- **text（默认）**：人类可读的多段输出，包含 session_id、表名、查询描述、执行计划、生成的 SQL 列表、模型原始回答
- **json**：结构化的最终结果对象，便于程序化解析，包含：

  ```json
  {
    "session_id": "<chatflow session id>",
    "table": "<候选表名>",
    "query": "<query-text>",
    "sql_list": ["<SQL 1>", "<SQL 2>", ...],
    "plan": [...],
    "user_prompt": "...",
    "model_answer": "..."
  }
  ```

### 凭证配置

- 统一通过 `do-bigdata auth init` 配置，与 sql-execute-analyze、chatbi 共享同一份凭证
- 三级 fallback 加载：环境变量 → 加密文件 `security_file/config.json.enc` → 明文文件 `security_file/config.json`

## 关键参考链接

| 资源 | URL |
|------|-----|
| WeData 平台 | https://wedata.woa.com |
| WeData 数据探索 | https://wedata.woa.com/explore |
| CMK 密钥下载 | https://wedata.woa.com/security/user/keys |

## 参考文档

本 Skill 的 SuperSQL 官方标准文档（DDL/DML/DQL、运算符、函数、保留字、跨源查询等）已迁移至 CLI 包，**禁止**通过 `read_file` 等方式直接读取本 Skill 目录下的 `.md` 文件，必须通过 `do-bigdata docs` 命令查阅，以确保使用回传不被绕过。

### 常用命令

```bash
# 列出 supersql-codegen 的所有参考文档
do-bigdata docs list --skill supersql-codegen

# 查看指定文档全文（先 list 看到文件名，再 show）
do-bigdata docs show --skill supersql-codegen --file <文件名>.md

# 按章节查看（可选）
do-bigdata docs show --skill supersql-codegen --file <文件名>.md --section "<二级标题>"

# 按关键词搜索
do-bigdata docs search --skill supersql-codegen --keyword "<关键词>"
```

### 文档分类（按文件名前缀）

所有文档均扁平存放于 `references/` 目录下，按文件名前缀编号区分主题（**通过 `do-bigdata docs show --file <文件名>` 直接读取，无需关心子目录**）：

| 前缀 | 主题 | 典型文件 |
|------|------|----------|
| `1_` | SuperSQL 总体介绍 | `1_SQL概述.md` |
| `2.x_` | 通用参考 | `2.1_SQL使用限制项.md`、`2.3_运算符.md`、`2.7_保留字与关键字.md`、`2.11_EXPLAIN语句.md`、`2.10.x_*` 引擎差异系列等 |
| `3.1.x_` | DDL 语句（THive） | 表/分区/列/视图操作，如 `3.1.2_创建和删除表.md`、`3.1.4_分区操作.md` |
| `3.2.x_` | DML 操作（THive） | `3.2.2_Insert语句.md`、`3.2.3_数据导出.md` 等 |
| `3.3.x_` | DQL 操作（THive） | `3.3.1_Select语句.md`、`3.3.7_join操作.md`、`3.3.11_with语句.md` 等 |
| `3.4.x_` ~ `3.6_` | Iceberg 表的 DDL/DML/DQL | `3.4.1_创建表.md`、`3.5_DML操作_Iceberg.md`、`3.6_DQL操作_Iceberg.md` |
| `5.x_` | 跨源查询 | `5.1_DDL语句.md`、`5.2_DML语句.md`、`5.3_DQL语句.md`、`5.4_DCL语句.md` |

> 当用户对 SuperSQL 语法、函数、跨源查询等深入追问时，先用 `do-bigdata docs list --skill supersql-codegen` 查询可用文档清单，再用 `do-bigdata docs show --skill supersql-codegen --file <文件名>.md` 读取具体文档内容；**严禁**直接 `read_file` 读取 `references/*.md`。

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
