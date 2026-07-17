# 问题SQL诊断说明

如果输入数据中提供了**业务需求**，请**务必**参考这一信息分析 SQL 查询的逻辑是否正确。

请逐一检查每条 SQL 是否存在以下 7 类问题：

## 1. 是否存在语法错误？
**判断条件**：
- 当前的 SQL 语法方言为 SparkSQL。
- 一些“软语法”错误（如别名作用域、保留字冲突）在不同引擎间行为不一致。
- 请结合编译结果和方言语法，对 SQL 进行彻底分析，找出全部的语法问题。
- **位置定位要求**：对于每一处语法错误，必须精确标注其在 SQL 文本中的位置，格式为 `startline:startcolumn-endline:endcolumn`。行号从 1 开始计数，列号从 1 开始计数，对应错误 token 或表达式的起止位置。
**重点检查以下子类型**：
  - **列别名误用**：Hive / SparkSQL 方言通常不允许 SELECT 中定义的列别名在 GROUP BY / WHERE / HAVING / JOIN ON 中直接引用。
  - **GROUP BY 遗漏非聚合列**：SELECT 含非聚合列但未在 GROUP BY 中声明。
  - **关键字/保留字未转义**：保留字作为列名或表名时未用反引号转义。重点注意 **`user`、`timestamp`、`result`、`action`、`status`** 等保留字。
  - **子查询缺少别名**：FROM 后子查询未指定 alias 导致解析失败。
  - **逗号/分号错误**：多余逗号、缺少逗号、多余分号等标点符号错误。
  - **歧义列引用**：多表 JOIN 中未指定表前缀导致列名冲突。
  - **窗口函数语法错误**：OVER 子句缺失、ORDER BY 遗漏、ROWS 范围错误。
  - **CASE WHEN 语法错误**：缺少 END、THEN 遗漏、ELSE 类型不匹配。
  - **聚合函数嵌套错误**：聚合函数中嵌套聚合、HAVING 误用、混合粒度。
  - **CTE / 复杂查询语法错误**：WITH 子句拼写、递归 CTE、CTE 引用顺序错误。

## 2. 是否存在暴力扫描？
**判断条件**：
- 暴力扫描是指 SQL 查询在执行时扫描了远超必要范围的数据量，导致性能严重下降。
**请检查以下子类型**：
  - **缺失分区过滤**：查询中完全没有对分区字段（如 `tdbank_imp_date`）添加过滤条件，导致全分区扫描。
  - **分区列被函数包裹**：对分区列使用了函数（如 `WHERE func(tdbank_imp_date) = value`），导致分区裁剪失效。
  - **SELECT * 无 LIMIT**：开发 / 调试时使用 `SELECT *` 但未加 `LIMIT`，可能扫描大量数据。
  - **隐式类型转换导致分区失效**：分区列类型不匹配（如 STRING 分区列与 INT 常量比较），触发全分区扫描。
  - **OR 条件绕过分区裁剪**：OR 连接的条件中有一侧未带分区过滤，导致整体分区裁剪失效。
  - **子查询 / IN 子句未限定分区**：子查询内层未加分区条件，导致内层全表扫描。
  - **大表 JOIN 时一侧缺失分区过滤**：多表 JOIN 中某张大表漏加分区条件。
  - **LIKE 前导通配符**：`LIKE '%keyword'` 导致无法走索引 / 分区裁剪。
  - **NOT IN / NOT EXISTS 全表扫描**：排除型查询导致全分区遍历。
  - **时间跨度过大**：若能计算出查询的时间跨度（通过时间筛选条件），当**时间跨度大于等于 15 天**时，判定为暴力扫描。
**时间跨度计算规则**：
  - **规则 1（显式时间跨度）**：如果输入数据中直接给出了时间跨度（例如“扫描时间范围为 30 天”），则直接使用该值。
  - **规则 2（通过时间字段推断）**：如果没有显式时间跨度，但提供了时间筛选条件（例如 SQL 中的 `tdbank_imp_date >= 20250101`），则按以下步骤计算：
    - 已知**当前时间**以数据准备阶段获取的时间为准，格式为“年月日”（例如 `20260308`）。
    - 提取筛选条件中的**起始时间**（如 `20250101`）。
    - 将起始时间和当前时间转换为**标准日期格式**（例如 `20250101` → `2025-01-01`，`20250731` → `2025-07-31`）。
    - 计算两个日期之间的实际天数差（注意闰年、月份天数等）。
    - 如果筛选条件包含多个时间范围，取**最大时间跨度**（但若无法确定，则保守处理）。
  - **规则 3（无时间信息）**：如果没有任何时间跨度信息（既无显式说明，也无时间字段筛选条件），则视情况判断是否存在其他暴力扫描场景。
**示例**：
- `tdbank_imp_date >= 20250101`，当前时间为 `20250731`，时间跨度 = 212 天（≥ 15 天）→ 存在暴力扫描。
- `tdbank_imp_date >= 20250601`，当前时间为 `20250603`，时间跨度 = 3 天（< 15 天）→ 仅时间跨度维度不存在暴力扫描，但仍需检查其他子类型。
- `SELECT * FROM large_table` 无分区过滤 → 存在暴力扫描。

## 3. 是否存在笛卡尔积问题？
**判断条件**：
- 笛卡尔积会导致结果集行数 = 左表行数 × 右表行数，呈指数级膨胀，可能导致 OOM、任务超时、集群资源耗尽。
- **特别注意**：笛卡尔积不仅指完全缺失关联条件的情况，还包括**关联条件不完整**导致的"部分笛卡尔积"（即一行匹配多行，数据膨胀数十倍甚至更多）。这类"部分笛卡尔积"更隐蔽、更常见，必须重点排查。
- 注意：如果关联条件被写在 WHERE 子句（例如`WHERE t1.id = t2.id`），则不属于笛卡尔积。
**请逐一检查以下子类型**：
  - **逗号分隔表无关联条件**：FROM 多表逗号分隔但 WHERE 中无 JOIN 条件。
  - **显式 CROSS JOIN**：使用了 `CROSS JOIN` 关键字。
  - **JOIN 条件恒为真**：`ON 1=1` / `ON TRUE` 等恒真条件，实质等同于笛卡尔积。
  - **JOIN 缺少关联键**：多表 JOIN 中漏写关键关联字段。
  - **子查询间笛卡尔积**：子查询结果集之间缺少关联。注意，当 FROM 中使用多个子查询时，如果子查询结果集之间没有正确关联，同样会产生笛卡尔积。
  - **复合键 JOIN 只写了部分关联字段**：ON 子句中**已有部分关联条件**，看似合理，但实际上关联键不完整，导致一行匹配到多行（多对多 JOIN），结果集意外膨胀。
  - **聚合粒度不同的子查询 JOIN**：两个子查询分别按不同粒度聚合（如一个按 `app_id` 聚合，另一个按 `app_id + stage_id` 聚合），JOIN 时只用粗粒度字段关联，导致粗粒度侧的数据被重复展开。
    **执行以下检查步骤**：
    - 检查 JOIN 两侧子查询的 GROUP BY 粒度是否一致。
    - 如果粒度不一致，仅用粗粒度字段关联就会导致粗粒度侧数据被重复。
    - 特别注意：对重复展开的粗粒度列做 SUM/COUNT 等聚合会产生膨胀的错误指标。
  - **CTE 之间笛卡尔积**：多个 CTE 关联时缺少连接条件。
  - **LATERAL VIEW 与表笛卡尔积**：`explode` 后与其他表缺关联。
  - **多表链式 JOIN 断裂**：多表链式 JOIN 时如果中间环节的关联断裂或跳级关联，会导致后续所有表产生笛卡尔积。
    **执行以下检查步骤**：
    - **步骤1：绘制 JOIN 链路图**。
    - **步骤2：检查每个 JOIN 的 ON 条件是否关联了正确的"相邻表"**。
    - **步骤3：检查是否存在"跳级关联"**。
    - **步骤4：检查是否有被注释掉或删除的中间表**。
    - **步骤5：检查 ON 条件是否写到了错误的表上**。
  - **复杂场景综合笛卡尔积**：UNION + 子查询 + JOIN 组合场景中的隐藏笛卡尔积。
    **执行以下检查步骤**：
    - **步骤1：逐一检查 UNION ALL 的每个分支**。
    - **步骤2：检查 INSERT...SELECT 中 SELECT 部分的 JOIN**。
    - **步骤3：检查窗口函数是否基于膨胀数据计算**。
    - **步骤4：检查子查询嵌套中的内层 JOIN**。
**关键提醒**：不要因为 ON 子句中已经存在关联条件就跳过笛卡尔积检查。**ON 子句有条件 ≠ 关联条件完整**。必须逐一核查每个 JOIN 的关联键是否能唯一确定两表之间的行级对应关系。如果不能，即使 ON 中有条件，也应判定为笛卡尔积问题。
**示例**：
- 复合键只写部分字段：`FROM app_table a JOIN job_table j ON a.app_id = j.app_id`，但查询跨多天数据且两表都有 `tdbank_imp_date` 分区字段却未在 ON 中对齐 → 数据膨胀（同一 app_id 跨天交叉匹配）。
- 非唯一ID缺父级：`FROM stage_table s JOIN task_table t ON s.stage_id = t.stage_id AND s.tdbank_imp_date = t.tdbank_imp_date`，但缺少 `s.app_id = t.app_id` → stage_id 在不同 app 中重复，导致跨 app 错误关联。
- 聚合粒度不同：子查询A `GROUP BY app_id`（粗粒度），子查询B `GROUP BY app_id, stage_id`（细粒度），`ON A.app_id = B.app_id` → A 侧数据按 stage 数量被重复膨胀。
- 链式 JOIN 跳级：`FROM app a JOIN job j ON a.app_id=j.app_id JOIN stage s ON a.app_id=s.app_id JOIN task t ON j.app_id=t.app_id`，stage 跳过 job 直接关联 app（应通过 job 精确定位 stage），task 跳过 stage 直接关联 job（缺少 `s.stage_id=t.stage_id`）→ stage 与 job 交叉匹配，task 与 stage 交叉匹配。
- 中间表被注释掉：原来 `A JOIN B ON ... JOIN C ON b.id=c.b_id`，调试时注释掉 B，C 退化为 `ON a.date=c.date` → 只用日期关联等同于笛卡尔积。
- UNION 分支缺关联：`SELECT ... FROM a JOIN j ON a.date=j.date UNION ALL SELECT ... FROM a`，第一个分支缺少 `a.app_id=j.app_id` → 该分支笛卡尔积。
- INSERT 写入膨胀数据：`INSERT OVERWRITE TABLE t SELECT ..., SUM(s.num_tasks) FROM a JOIN j ON ... JOIN s ON a.app_id=s.app_id GROUP BY ...`，stage 未关联 job 导致 SUM 膨胀 → 错误指标写入结果表。
- 窗口函数在膨胀数据上计算：先做缺关联条件的 JOIN，再用 `ROW_NUMBER() OVER(PARTITION BY app_id ...)` 排名 → 排名基于膨胀后的假数据。

## 4. 是否存在隐式转换问题？
**判断条件**：
- 隐式类型转换不报错，但可能导致分区裁剪失效（性能问题）、排序语义变化（正确性问题）和 Shuffle 数据暴增。
- 检查 WHERE、JOIN、SELECT、UNION、CASE WHEN 等子句中的**条件表达式和操作符**（如 `=`、`>`、`+`、`||` 等）。
**请检查以下子类型**：
  - **分区列与整数比较**：STRING 类型分区列用整数常量过滤（如 `tdbank_imp_date >= 20250101`），正确写法通常应为 `tdbank_imp_date >= '20250101'`。
  - **JOIN 关联键类型不匹配**：STRING 与 BIGINT 字段做 JOIN。
  - **WHERE 条件字符串与数值混用**：如 `WHERE int_column = '1'`。
  - **UNION 列类型不一致**：UNION ALL 各分支对应列类型不同。
  - **CASE WHEN 分支类型混用**：THEN / ELSE 分支返回不同类型。
  - **聚合函数参数隐式转换**：SUM / AVG 传入 STRING 字段。
  - **IN 列表类型不匹配**：IN 列表中混合不同类型值。
  - **字符串拼接中的数值隐式转换**：CONCAT 中混用数值和字符串。
  - **时间戳与字符串比较**：BIGINT 时间戳与日期字符串比较。
  - **复杂多表场景隐式转换**：多表 JOIN + 子查询 + 聚合中的综合隐式转换。
**示例**：
- `WHERE int_column = '1'` → 存在隐式转换。
- `WHERE CAST(int_column AS VARCHAR) = '1'` → 为显式转换，不属于此类问题。

## 5. 是否存在空表问题？
**判断条件**：
- 空表问题在数仓 ETL 链路中极为常见——上游数据延迟、分区未生成、数据被误清理等都会导致某个环节读到空表。空表上的操作不会报错，但会产出空结果或零值。
**请检查以下子类型**：
  - **JOIN 空表 / 空分区**：某张表分区无数据导致 JOIN 结果为空。
  - **INSERT 写入空结果**：从空表 / 空分区 SELECT 写入目标表。
  - **空表上做聚合运算**：COUNT 返回 0，SUM / AVG 返回 NULL 等边界行为。
  - **过滤条件指向空分区**：分区不存在或数据未到位就开始查询，典型场景是查询未来分区。
  - **LEFT JOIN 右表为空**：左表有数据但右表空，结果表面正常但语义异常。
  - **UNION 包含空表分支**：多分支 UNION 中某些分支为空。
  - **子查询返回空集**：IN / EXISTS 子查询为空导致外层结果异常。
  - **空表 / 空分区上的窗口函数**：窗口函数在空数据集上的边界行为。
  - **空表上的 GROUP BY**：GROUP BY 空表产出 0 行，下游可能误判。
  - **空表级联传播**：上游空表通过 ETL 链路层层传播，导致整个链路异常。
**示例**：
- `WHERE a.tdbank_imp_date = '20260310'`，而当前时间为 `20260308` → 目标未来分区大概率为空。

## 6. 是否存在基础逻辑疏漏？
**判断条件**：
- 基础逻辑疏漏是最危险的一类问题——SQL 能正常执行，但产出的数据**静默失真**。排查成本极高，往往要在下游指标异常被业务方反馈后才能发现。
**请逐一检查以下子类型**：
  - **NULL 值未处理**：比较/运算/聚合中忽略 NULL 导致数据丢失或计算错误。例如 `WHERE column != 'value'` 会过滤掉 NULL 行。
  - **JOIN 类型选择错误**：INNER/LEFT/RIGHT JOIN 混用导致数据丢失或膨胀。例如应使用 LEFT JOIN 却用了 INNER JOIN，导致不匹配的行丢失。
  - **分区过滤遗漏**：忘记添加分区条件导致跨天数据混入，结果包含非目标日期的数据。
  - **去重逻辑缺失**：COUNT/SUM 时未去重导致指标重复计算。例如 `COUNT(id)` 应为 `COUNT(DISTINCT id)`。
  - **WHERE 与 HAVING 混淆**：聚合前后过滤时机搞反导致结果偏差。例如将聚合后的过滤条件写在 WHERE 中，或将行级过滤写在 HAVING 中。
  - **边界值差一错误**：大于/大于等于、BETWEEN 边界、时间范围差一天等 off-by-one 错误。
    **执行以下检查步骤**：
    - **步骤1：识别范围条件**：找出 SQL 中所有 BETWEEN、>= AND <=、> AND < 等范围过滤条件。
    - **步骤2：计算实际覆盖范围**：对于 BETWEEN A AND B，实际覆盖的元素数量 = B - A + 1（闭区间）。对于日期型字段，BETWEEN '20260301' AND '20260308' 实际包含 8 天而非 7 天。
    - **步骤3：与业务需求对比**：如果已知业务需求（如"统计7天数据"），将实际覆盖范围与需求期望值对比，检查是否存在差一（off-by-one）偏差。
    - **步骤4：检查是否应使用半开区间**：当数据存在连续时间段划分（如按小时分段）时，闭区间 BETWEEN 会导致边界值被相邻两个时间段同时包含，建议改用半开区间 `>= A AND < B`。
  - **外连接被 WHERE 条件破坏**：LEFT JOIN 后 WHERE 过滤右表列（非 IS NULL 判断），导致退化为 INNER JOIN。
  - **聚合粒度不匹配**：GROUP BY 粒度与业务需求不一致导致指标失真。例如按天聚合但业务需要按小时。
  - **UNION 列顺序/类型不一致**：UNION ALL 各分支列的语义或类型对不上，导致数据混乱。
  - **关联子查询逻辑错误**：关联条件不足/方向反转/结果集非预期。

## 7. 是否存在 Where 条件逻辑问题？
**判断条件**：
- 先**计算**Where条件的实际过滤范围，再对比业务需求，分析是否和需求一致。
**请逐一检查以下子类型**：
  - **OR 与 AND 优先级混淆**：缺少括号导致 OR/AND 组合逻辑偏差。
    - 例如 `WHERE a = 1 OR b = 2 AND c = 3` 实际等价于 `WHERE a = 1 OR (b = 2 AND c = 3)`，而非 `WHERE (a = 1 OR b = 2) AND c = 3`。
  - **NOT IN 陷阱**：NOT IN 遇 NULL / 空集 / 大列表的各种异常行为。当子查询结果包含 NULL 时，`NOT IN` 会返回空集。建议该用`NOT EXISTS`。
  - **LIKE 通配符误用**：LIKE 模式匹配中，`'%'` 和 `_` 是通配符，`'%'` 匹配任意长度字符串（含空）， `_` 匹配单个任意字符。常见误用如下：
    - 前导 `%` 导致无法利用索引/分区
    - 数据中含有 `%` 或 `%` 字面值但未转义
    - 多个 `%` 组合导致匹配范围远超预期
    - 忘记 LIKE 是大小写敏感的（某些引擎）或混淆 LIKE 和 RLIKE
    - 用 LIKE `%` 代替 IS NOT NULL，语义不等价。
  - **BETWEEN 语义陷阱**：BETWEEN 等价于 `>= AND <=`（左闭右闭），这一闭区间语义是多种边界错误的根源。
    **执行以下检查步骤**：
    - **步骤1：确认闭区间是否符合业务意图**：BETWEEN A AND B 包含 A 和 B 两端的值。对于离散值（如日期分区），实际覆盖元素数 = B - A + 1。若业务需求指定了明确的数量（如"7天"），需验证 BETWEEN 的范围是否恰好覆盖该数量，警惕"多算一个"的 off-by-one 错误。
    - **步骤2：检查字符串类型字段的 BETWEEN 语义**：当字段为 STRING 类型时，BETWEEN 按**字典序**（lexicographic order）比较而非数值比较。例如字符串 '1000' < '200'（因为 '1' < '2'），这会导致 BETWEEN '100' AND '200' 意外包含 '1000'~'1999' 等值。如果业务意图是数值范围比较，应先 CAST 为数值类型。
    - **步骤3：检查时间戳/连续值的边界重叠**：对于毫秒时间戳等连续值，BETWEEN 包含右端会导致恰好等于右端边界的记录被当前和下一个时间段同时包含（双重计入）。建议改用半开区间 `>= start AND < end`。
    - **步骤4：检查 NOT BETWEEN 的边界行为**：`NOT BETWEEN A AND B` 等价于 `< A OR > B`，即**排除**了 A 和 B 本身。如果开发者意图是保留边界值（即只排除开区间 (A, B) 内的数据），则 NOT BETWEEN 会过度排除边界点。
    - **步骤5：检查 BETWEEN 左右值顺序**：BETWEEN 要求左值 ≤ 右值。如果左值 > 右值（如 BETWEEN '20260308' AND '20260301'），条件永远为假，返回空集，且不会报错。
    - **步骤6：检查 NULL 参与 BETWEEN**：如果 BETWEEN 的操作数或边界值为 NULL，结果为 NULL（被 WHERE 过滤），可能导致数据静默丢失。
  - **冗余/矛盾条件**：恒真恒假条件（如 `WHERE 1=1 AND 1=0`）、相互矛盾条件导致空集或全量返回。
  - **隐式类型转换**：过滤时误用**字符串(STRING)**与**数值(BIGINT/INT)**比较时的隐式转换导致索引失效、分区裁剪失败。
  - **子查询 WHERE 作用域错误**：在包含子查询（IN/EXISTS/标量子查询）的 WHERE 中，过滤逻辑与业务意图不符，导致结果静默失真。
  - **日期/时间函数误用**：数仓中时间相关的 WHERE 条件是最常见的过滤场景，但日期函数的参数顺序、单位精度、格式字符串等极易出错。这类错误往往导致条件永远不满足（返回空集）或永远满足（返回全量），且不会报语法错误。
  - **IN 列表膨胀与逻辑陷阱**：IN 列表过长、IN + OR 混用语义偏差、多列 IN 不支持、IN 列表中类型不一致。
  - **复杂嵌套条件逻辑错误**：多层嵌套 AND/OR/NOT/EXISTS 组合导致语义偏差。
**示例**：
- NOT IN 陷阱：`WHERE t0.c0 NOT IN (SELECT t1.c1 FROM t1 WHERE t1.c2 = v2)` → 极端条件下子查询可能为空，导致NOT IN返回全部，从而失效
- LIKE 通配符误用：`WHERE t0.c0 LIKE '%abcd%'` → 尽量避免前导 %，或用专门的搜索函数 `WHERE INSTR(a.app_name, 'etl') > 0`
- 子查询作用域-分区条件只在子查询中：`WHERE a.app_id IN (SELECT j.app_id FROM job j WHERE j.tdbank_imp_date='20260308')` — 外层 app 表缺少 `a.tdbank_imp_date='20260308'`，导致全表扫描并可能返回非目标日期的数据。
- 子查询作用域-EXISTS 缺关联条件：`WHERE EXISTS (SELECT 1 FROM stage s WHERE s.tdbank_imp_date='20260308' AND expr)` — 缺少 `s.app_id = a.app_id` 关联，只要存在任何满足条件的 stage，所有 app 都被返回。
- 子查询作用域-条件漏到外层：子查询中本应有 `AND t.status='FAILED'`，但误写到外层变成 `AND 'FAILED'='FAILED'`（恒真），子查询实际统计了所有 task 而非失败 task。
- 子查询作用域-内外层日期不一致：外层 `a.tdbank_imp_date = '20260308'`，IN 子查询 `j.tdbank_imp_date = '20260307'` — 查的是"昨天有失败job的今天的app"，通常非业务意图。
- 日期函数-分区字段被函数包裹：`WHERE SUBSTR(tdbank_imp_date,1,6)='202603'` → 分区裁剪失效，应改为范围比较 `>= '20260301' AND <= '20260331'`。
- 日期函数-FROM_UNIXTIME毫秒当秒：`WHERE FROM_UNIXTIME(start_time,'yyyy-MM-dd')='2026-03-08'` — start_time 是毫秒级，应 `start_time/1000`。
- 日期函数-DATEDIFF参数写反：`DATEDIFF(FROM_UNIXTIME(start/1000,...), FROM_UNIXTIME(end/1000,...)) > 2` — start-end 为负，永远不满足。
- 日期函数-字符串算术代替日期运算：`WHERE tdbank_imp_date = '20260301' - 1` — 得到 20260300 而非 20260228。

## 8. 是否存在业务意图不匹配问题？
**判断条件**：
- 这类错误无法通过语法检查或简单规则发现，需要结合**业务需求**理解 SQL 的语义。如果输入数据中提供了**业务需求**，请**务必**参考这一信息进行分析。
**请逐一检查以下子类型**：
  - **成功率/失败率分母错误**：计算成功率或失败率时，分母选取不当。常见错误：用 `COUNT(*)` 当分母（包含 NULL 等无效记录导致分母偏大）；`result` 字段值含义混淆（0 代表成功而非失败）；多表 JOIN 后行数膨胀导致分母偏大；分子和分母的过滤条件不对齐；`CASE WHEN` 分支遗漏导致部分记录未被统计。
  - **耗时计算单位混淆**：时间相关计算中单位不一致。常见错误：`start_time`/`end_time` 为毫秒时间戳，相减后直接当秒用（差 1000 倍）；`start_time - end_time` 顺序搞反得到负值；不同表的时间字段精度不一致（如毫秒 vs 纳秒）混合计算；`AVG` 和 `SUM` 语义混淆（想要平均耗时却用了 SUM）。
  - **去重统计遗漏**：`COUNT` 未加 `DISTINCT` 导致重复计数；`DISTINCT` 放在错误的列上；多表 JOIN 后对主表字段 `COUNT` 实际统计的是关联表的行数。
  - **聚合粒度不匹配**：`GROUP BY` 粒度过粗或过细，与业务需求不一致。例如业务需要按 app 统计但 GROUP BY 了 app+stage，或业务需要按天统计但 GROUP BY 了更细的粒度。
  - **比率/百分比计算溢出**：整数除法截断为 0（两个 BIGINT 相除结果仍为 BIGINT，小数部分被截断）；分母可能为零但未用 `NULLIF` 保护；先做整数除法再乘 100 导致精度已丢失；`ROUND` 精度丢失（先 ROUND 再 AVG 而非先 AVG 再 ROUND）；多层嵌套比率计算中精度累积丢失。
  - **时间窗口偏移**：分区范围多一天或少一天（off-by-one）；时间戳范围与分区日期不对齐；`BETWEEN` 闭区间导致边界日期被重复计入；查询的时间范围与业务需求的统计周期不一致。
  - **JOIN 关联语义偏差**：`LEFT JOIN` 与 `INNER JOIN` 选错导致统计偏差。例如应使用 `LEFT JOIN` 保留无关联记录却用了 `INNER JOIN`，导致分母缩小、比率失真；或应使用 `INNER JOIN` 却用了 `LEFT JOIN`，引入了不应参与计算的 NULL 行。
  - **排名/TopN 逻辑错误**：`ROW_NUMBER` 不处理并列，应用 `RANK` 的场景用了 `ROW_NUMBER`；排序方向 `ASC`/`DESC` 搞反（想取最大值却取了最小值）；`PARTITION BY` 范围错误（分组内排名变成了全局排名）；TopN 过滤时用 `> N` 而非 `<= N`；多字段排序优先级与业务需求不一致。
  - **累计/环比计算错误**：窗口函数 `ROWS` 与 `RANGE` 边界差异（`RANGE` 会合并相同值的行导致累计值跳跃）；`LAG`/`LEAD` 方向搞反（`LAG` 取前面的行，`LEAD` 取后面的行）；累计求和窗口未指定 `ORDER BY` 导致结果不确定；环比分母使用当期而非上期；窗口函数缺少 `PARTITION BY` 变成全局计算。
  - **多表聚合膨胀**：先 JOIN 再聚合（`SUM`/`COUNT`）导致数据膨胀。常见错误：`app JOIN job`（1:N）后 `COUNT(*)`，结果是 job 行数而非 app 数；`app JOIN stage` 后 `SUM(driver_memory)`，每个 app 的值被 stage 数量翻倍；多层 1:N JOIN 导致指数级膨胀；应先聚合再 JOIN 但顺序搞反；应使用 `UNION ALL` 纵向合并却误用 JOIN。
**示例**：
- 成功率分母错误：`COUNT(CASE WHEN result != 0 THEN 1 END) / COUNT(*)` — `COUNT(*)` 包含 `result IS NULL` 的无效记录，分母偏大，应改为 `COUNT(CASE WHEN result IS NOT NULL THEN 1 END)`。
- 耗时单位混淆：`WHERE (end_time - start_time) > 3600` — `end_time - start_time` 单位是毫秒，3600 毫秒 = 3.6 秒，应改为 `> 3600000`。
- start/end 顺序搞反：`(start_time - end_time) AS duration_ms` — 得到负值，应为 `end_time - start_time`。
- 整数除法截断：`shuffle_output_size / output_size AS shuffle_ratio` — 两个 BIGINT 相除结果为 0，应改为 `CAST(shuffle_output_size AS DOUBLE) / output_size`。
- 排序方向搞反：`ROW_NUMBER() OVER (ORDER BY duration ASC)` 取 `rn <= 3` — 取到的是耗时最短的 Bottom 3，应改为 `ORDER BY duration DESC`。
- LAG/LEAD 方向搞反：`LEAD(app_count, 1) OVER (ORDER BY imp_date) AS prev_day_count` — `LEAD` 取后一天，应改为 `LAG`。
- 多表聚合膨胀：`app JOIN stage` 后 `SUM(a.driver_memory)` — 每个 app 的 `driver_memory` 被 stage 数量翻倍，应先在 app 表内聚合，不需要 JOIN stage。
- 环比分母用当期：`(job_count - LAG(job_count,1) OVER (...)) * 100.0 / job_count` — 分母应为 `LAG(job_count,1) OVER (...)`（上期值）。