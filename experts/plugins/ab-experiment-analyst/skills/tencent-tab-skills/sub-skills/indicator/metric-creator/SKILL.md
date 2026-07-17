---
name: metric-creator
description: TAB 指标创建助手。当用户需要在 TAB 平台创建新指标时触发，通过自然语言引导用户完成指标类型推断、数据源推荐、口径生成、sqlConfig 组装、元信息补全、SQL 校验、最终创建全流程，无需用户了解底层 JSON 结构。仅支持新建普通 TAB 指标（T+1 天级），不支持 OLA/实时/分钟级/第三方指标。
---

## 前置依赖

本技能依赖顶层 Skill 完成鉴权和业务空间初始化。`business_code` 从顶层 `env_config.json` 读取，用户临时指定不同空间时本次使用指定值，不修改配置。

所有 MCP 调用通过 `mcporter call` 执行，不得使用 agent 自带的 MCP 连接（详见顶层 Skill「MCP 调用隔离」章节）。

## 工具说明

| 工具 | 说明 |
|---|---|
| `tab_get_recommend_source_table` | 获取推荐行为数据源表（table_type=3，支持模糊搜索，按绑定指标数降序返回最多 10 条） |
| `tab_get_source_table` | 获取全量曝光表列表（table_type=2） |
| `tab_get_table_field` | 获取指定表的字段列表及字段类型 |
| `tab_get_indicator_type` | 获取业务空间下的指标标签列表，返回 `id`/`name`，用于填写 `category_ids` |
| `tab_list_indicators` | 搜索已有指标，返回 `indicator_sql`（SQL文本）供参考 |
| `tab_get_indicator_sql` | 根据指标配置生成指标计算 SQL |
| `tab_add_indicator` | 创建指标第一步：写入基本信息，返回 `indicator_id` |
| `tab_save_indicator` | 创建指标第二步：写入 config 对象及计算配置 |

---

## 整体流程

```
[F1 意图理解] → [F2 数据源推荐] → [F3+F4 口径与事件加工]
                                            ↓
                          [F5 sqlConfig 组装（对用户透明）]
                                            ↓
                                    [F6 元信息补全]
                                            ↓
                                   [F7 创建前置门控]
                                            ↓
                             ⏸ 展示元信息摘要，等待用户确认
                                            ↓（用户确认）
                          [F8-Step1 tab_add_indicator] → 获得 indicator_id
                                            ↓
                             ⏸ 展示 sqlConfig 配置，等待用户确认
                                            ↓（用户确认）
                          [F8-Step2 tab_get_indicator_sql]（使用 indicator_id）
                                            ↓
                          [F8-Step3 tab_save_indicator]
```

- **F7 门控**：进入 F8-Step1 前检查 F1-F6 所有步骤均已完成，任意未通过则立即终止。
- **两次用户确认**：① Step1 前确认元信息（名称/类型/数据源/元数据）；② Step1 后、Step2 前确认 sqlConfig 配置（inner/outer 口径）。两次均须等待用户明确回复，**严禁自动跳过**。
- **F8-Step2 SQL 生成**：在 F8-Step1（`tab_add_indicator`）之后、F8-Step3（`tab_save_indicator`）之前执行；使用 Step1 返回的 `indicator_id` 作为 `metric_id`；失败自动修正，最多重试 3 次；3 次仍失败则终止，需人工介入后通过同一 `indicator_id` 重新从 F8-Step2 进入。

---

## F1：意图理解与类型推断

### 指标类型映射表

| # | 类型名称 | formula | 触发关键词/场景 | 分子逻辑 | 分母逻辑 |
|---|---|---|---|---|---|
| 1 | 均值类 | 1 | 人均X、平均X、每人X | SUM(字段) | COUNT(DISTINCT uin) |
| 2 | 用户比例类 | 2 | X率、X占比、X人数比 | COUNT(DISTINCT uin) WHERE 条件 | COUNT(DISTINCT uin) |
| 3 | 比率类 | 3 | X比率、X/Y、CTR、单PV时长 | SUM(字段A) | SUM(字段B) |
| 4 | 用户数据求和类 | 4 | 总X、累计X、总时长、总点击 | SUM(字段) | — |
| 5 | 用户计数类 | 5 | X人数、X用户数、总点击人数 | COUNT(DISTINCT uin) WHERE 条件 | — |
| 6 | 人均活跃天数类 | 7 | 人均活跃天数 | SUM(user_day) | COUNT(DISTINCT uin) |
| 7 | 用户去重分位数类 | 10 | P50/P90/P99（去重）、收入金额P99 | 按用户聚合→排序→取分位数 | — |
| 8 | 非去重分位数类 | 11 | P50/P90/P99（非去重）、冷启动耗时P99 | 不按用户聚合→排序→取分位数 | — |
| 9 | 秩均值类 | 12 | 秩均值检验、秩次统计 | 按用户粒度聚合→排序→秩次检验 | — |
| 10 | 去重口径留存 | 6 | N日留存率（去重）、首次命中留存 | 留存用户数 | 基准用户数 |
| 11 | 非去重留存类 | 8 | N日留存率（非去重）、业务常用留存 | 留存用户数 | 基准用户数 |

> **留存类说明**：
> - **去重口径留存（#10，formula=6）**：实验期内每个用户只计一次基准（首次曝光日起算），推荐作为常规留存指标。
> - **非去重留存（#11，formula=8）**：每次曝光都作为独立基准，同一用户可被计多次，适合衡量频次留存。
> - 用户不确定时默认选择**去重口径留存（#10）**。

### 推断流程

1. 从用户描述中提取指标含义、分子/分母逻辑、业务场景
2. 按上表匹配最相似的类型
3. 向用户确认推断结果：

```
根据您的描述「{用户输入}」，我推断这是一个：

📊 指标类型：{类型名称}
- 分子：{分子逻辑描述}
- 分母：{分母逻辑描述（无则标"-"）}

是否正确？如有偏差请告知，或从以下 11 种类型中选择：
1. 均值类  2. 用户比例类  3. 比率类  4. 用户数据求和类  5. 用户计数类
6. 人均活跃天数类  7. 用户去重分位数类  8. 非去重分位数类  9. 秩均值类
10. 去重口径留存  11. 非去重留存类
```

### 条件分支

| 场景 | 处理方式 |
|---|---|
| 描述清晰 | 展示推断结果请确认 |
| 描述模糊 | 追问：「请补充：1）分子统计的是什么？2）分母是实验样本量还是其他统计量？」 |
| 涉及留存类 | 追问：「需要几日留存？（1/3/7/14/30 日）另外，确认口径：①去重（首次曝光起算，推荐）②非去重；以及③N日留存（第N天，默认）④N日内留存（N天内任意一天）。不确定请选①③。」 |
| 用户不认可推断 | 列出全部 11 种类型供选择 |
| 关键词匹配多个类型 | 列出候选：「您的描述可能对应：1）均值类 2）比率类，请确认？」 |

**检索相似指标辅助**：用户不确定口径时，主动调用：

```bash
mcporter call "tab.tab_list_indicators(business_code: {business_code}, fuzzy_search: {关键词}, enable_sql: true, page_size: 3)"
```

> 只摘取 `indicator_name`、`indicator_comment`、`indicator_formula`、`source_table_names`、`indicator_sql`（仅展示 inner SELECT 聚合部分和 outer 分子/分母，截断至 300 字符）展示，不得原样输出完整 SQL。`tab_list_indicators` 返回的是 SQL 文本，**不含结构化 sqlConfig**，只能作参考，不能直接复用。

---

## F2：数据源智能推荐

### 步骤一：获取行为表（带关键词搜索+降级）与曝光表

**行为表阶段1**（与曝光表并行）：从指标描述中提取 1-3 个关键词，每个关键词并行调用一次，最多3个并行。
关键词提取：从用户的指标描述中提取 1 到 3 个关键词（如业务动作词、指标核心名词），关键词数量由语义分析决定，不强制凑满 3 个。例如：「视频完播率」→ ["完播", "视频"]；「点击次数」→ ["点击"]。

```bash
mcporter call "tab.tab_get_recommend_source_table(business_code: {business_code}, fuzzy_search: {关键词N}, table_type: 3, rt_status: 0)"
```
多次结果按 `table_id` 去重合并，`indicator_count` 取最大值，降序排列。

**行为表阶段2（降级）**：所有关键词结果合并后仍为空时，去掉 `fuzzy_search` 调用一次，结果注明「未找到与关键词匹配的表，以下为使用频率最高的推荐表」：
```bash
mcporter call "tab.tab_get_recommend_source_table(business_code: {business_code}, table_type: 3, rt_status: 0)"
```

**曝光表**（与行为表阶段1并行，结果缓存复用）：
```bash
mcporter call "tab.tab_get_source_table(business_code: {business_code}, table_type: 2, rt_status: 0)"
```

**返回结构差异**：

| 工具 | `data[]` 每项结构 |
|---|---|
| `tab_get_recommend_source_table` | `{ source_table: { table_id, table_name, table_comment, source_name, user_field }, indicator_count }` → 字段从 `data[i].source_table` 读取 |
| `tab_get_source_table` | `{ table_id, table_name, table_comment, source_name, user_field }` → 字段直接从 `data[i]` 读取 |

### 步骤二：展示推荐结果

```
根据您要配置的【{指标名}】指标：

📊 推荐数据源（行为表）：
{若降级，首行注明：「未找到与关键词匹配的表，以下为使用频率最高的推荐表」}
┌─ 1. {source_name}（ID: {table_id}）
│  表名：{table_name}
│  用户字段：{user_field}
│  描述：{table_comment 或 "（暂无描述）"}
│  使用频率：已绑定 {indicator_count} 个指标
│  匹配说明：{语义匹配理由；table_comment 为空则注明 "暂无描述，仅按使用频率推荐"}
│
└─ N. ...

📊 可用曝光表（全量）：
1. {source_name}（ID: {table_id}）- {table_comment 或 "暂无描述"}

💡 建议选择第 {N} 条行为表（{匹配理由}）。您想基于哪个表？
```

### 步骤三：获取字段并映射确认

用户确认数据源后：
```bash
mcporter call "tab.tab_get_table_field(business_code: {business_code}, table_ids: [{table_id}])"
```

返回字段：`field_name`、`field_type`（string/long/integer/double/text）、`table_id`

**字段过滤策略**（不得原样输出全部字段）：
1. 求和/均值/比率/分位数类 → 保留 `long/integer/double` 类型字段
2. 计数/比例类 → 保留所有字段，标注 `string` 类型适合作 WHERE 条件而非聚合
3. 排除以 `_bk`/`_test`/`_tmp`/`_backup` 结尾的字段
4. 超过 20 个候选字段时只展示前 20 个，附提示「还有 {N} 个字段未展示，如需查找请告知关键词」

**字段映射确认**：

```
关键字段映射（自动识别）：
- uin 字段  → {user_field} ✅
- ds 字段   → {推断的日期字段，如 ds/dt/date} ✅
- gray_id 字段 → {推断的实验ID字段，如 exp_id/gray_id} ✅

业务字段推荐：根据【{指标描述}】需求，推荐使用 {field_name}（{type}）
```

- `ds` 字段优先：`ds` > `dt` > `date` > `day`；均无时列出 date/string 类型字段请用户指定
- `gray_id` 字段优先：`exp_id` > `gray_id` > `expid`；均无时列出整数类型字段请用户指定

### 条件分支

| 场景 | 处理方式 |
|---|---|
| 所有关键词阶段1结果合并后为空 | 降级调用（不重复调用曝光表） |
| 降级后行为表仍为空 | **终止**：「当前空间下没有可用的行为数据源表，请联系数据管理员配置后再试」 |
| 曝光表列表为空 | **终止**：「当前空间下没有可用的曝光表，请联系数据管理员配置后再试」 |
| 所有行为表 `table_comment` 均为空 | 列出全部表（含展示名和绑定指标数），说明「暂无描述，仅按使用频率推荐」 |
| 字段类型不匹配聚合方式 | 提示：「字段 {name} 为 string 类型，不建议用于 SUM 聚合，建议使用 COUNT」 |
| MCP 接口调用失败 | **终止**：「数据源查询服务暂不可用，请稍后再试」 |

---

## F3+F4：口径生成与事件加工

根据 F1 推断的类型和 F2 选择的字段，自动生成分子/分母表达式及事件加工配置，**合并为一次确认**，减少交互轮次。

### 各类型自动生成规则

> **核心原则**：`inner_select` 的 `func_name`/`column`/`input_mode` 完全由用户选择的**事件加工变量**决定，**不按指标类型强制绑定函数**。区分指标类型的关键在 `outer_select`（分子/分母的函数与条件）。

| 类型 | inner_select 典型写法 | inner_where | outer.nume | outer.deno | 特殊说明 |
|---|---|---|---|---|---|
| 均值类(1) | `Sum, column: [业务字段]`，select模式 | 可选 | `func_name:"Sum", user_input:"A"` | `func_name:"Count", user_input:"all_exp_user"（命中实验）` | — |
| 用户比例类(2) | `Sum, column: [业务字段]`，select模式（inner 可用任意聚合） | 可选 | `func_name:"Count", user_input:"A>0"` | `func_name:"Count", user_input:"all_exp_user"` | outer 用 Count(A>0) 统计有行为人数 |
| 比率类(3) | A: `Sum/input` 字段A；B: `Sum/input` 字段B | 可选 | `func_name:"Sum", user_input:"A"` | `func_name:"Sum", user_input:"B"` | A、B 两个变量必填 |
| 求和类(4) | `Sum, column: [业务字段]`，select模式 | 可选 | `func_name:"Sum", user_input:"A"` | **不传（传空结构）** | 无分母 |
| 计数类(5) | `Sum, column: [业务字段]`，select模式 | 可选 | `func_name:"Count", user_input:"A>0"` | **不传（传空结构）** | outer 用 Count(A>0) 统计人数，无分母 |
| 人均活跃天数(7) | `Sum/input` 业务聚合（如 `sum(case when ... then cnt else 0 end)`） | 可选 | `func_name:"Sum", user_input:"A>0"` | **不传（传空结构）** | NUME_ONLY 类型；平台在 inner 按 uin+ds 分组后自动计算天数与人均 |
| 去重留存(6) | 留存行为字段的 `Sum`，select模式 | 可选（`[]` 或有条件） | `func_name:"Count", user_input:"A>0"` | `func_name:"Count", user_input:"A>0"` | `tab_save_indicator` 时 config.cal_info 传 `null`；但 `tab_get_indicator_sql` 仍需传完整 inner/outer |
| 非去重留存(8) | 留存行为字段的 `Sum`，select模式 | 可选（`[]` 或有条件） | `func_name:"Count", user_input:"A>0"` | `func_name:"Count", user_input:"A>0"` | 同上 |
| 用户去重分位数(10) | 按用户聚合：`Sum/input` 字段（1用户1条） | 可选 | `func_name:"Sum", user_input:"A"` | **不传（传空结构）** | `props.quantile` 必填（百分数字符串，如 `"99.00"`） |
| 非去重分位数(11) | **`func_name:""`**，select模式直接取字段值（1用户可多条，不聚合） | 可选 | `func_name:"", user_input:"A"` | **不传（传空结构）** | `props.quantile` 必填；`outer_where` 可用于过滤中间变量（如 `B>0`） |
| 秩均值(12) | `Sum, column: [字段]`，select模式 | 可选 | `func_name:"Sum", user_input:"A"` | **不传（传空结构）** | Mann-Whitney U 检验 |

> **关键规则**：
> - 过滤条件**必须**写入 `inner_query.where`（对象数组，每条 `input_mode: "input"`），**绝对不能**写入 `inner_query.select` 的聚合表达式中。
> - **"不传（传空结构）"**：无分母类型（求和/计数/活跃天数/分位数/秩均值），`outer_select.deno` 传 `{ "column": [], "input_mode": "input", "user_input": "" }`（空结构），**不可省略该字段**。
> - **人均活跃天数(7)**：属于 `NUME_ONLY` 类型，outer 无真实分母，平台后端根据 inner 按 uin+ds 的分组结果自动计算人均天数；Skill 中无需生成分母表达式。

### 语义预校验

- 用户比例类(2) → outer.nume 使用 `Count(A>0)`，outer.deno 使用 `Count(all_exp_user)`；inner_select 负责聚合业务字段，`A>0` 在 outer 层筛选有行为人数
- 计数类(5) → 同比例类，outer.nume 使用 `Count(A>0)`，无分母
- 比率类(3) → outer.nume 为 `Sum(A)`，outer.deno 为 `Sum(B)`，A/B 均来自 inner 两个变量
- 留存类(6/8) → 必须有 `retain_days`（整数：1/3/7/14/30）和 `retain_type`；`tab_save_indicator` 时 config.cal_info 传 `null`
- 分位数类(10/11) → 必须有分位值（`quantile` 字段为**百分数字符串**：P50=`"50.00"`，P90=`"90.00"`，P99=`"99.00"`）

### 展示模板

```
自动生成口径及事件配置：

📐 事件加工（inner_query）：
- 数据源表：{table_name}
- 聚合规则：A = {FuncName}({field})
- 过滤条件：{WHERE 条件 或 "无"}
- GROUP BY：{uin字段}, {ds字段}

📊 组合规则（outer_query）：
- 分子：{Numerator 表达式}
- 分母：{Denominator 表达式 或 "—（无分母）"}

需要调整吗？比如：
- 只统计满足特定条件的行？（如 play_duration > 3）
- 只统计某个渠道或场景？
- 需要多个事件加工变量（A/B/C...）？
```

### 条件分支

| 场景 | 处理方式 |
|---|---|
| 比例型配置 | 用户比例类通过 `outer.nume` 的 `Count(A>0)` 统计有行为人数，inner 聚合业务字段即可；若用户需要 inner 层过滤特定行为，可在 `inner_where` 中添加条件 |
| 留存型但未指定天数 | 追问：「请指定留存天数（1/3/7/14/30日）；留存类型：去重（formula=6，推荐）/非去重（formula=8）；口径：N日（第N天，`retain_type="default"`，默认）/ N日内（`retain_type="interval"`）」 |
| 分位数型但未指定分位值 | 追问：「请指定分位值：P50 / P75 / P90 / P95 / P99？」 |
| 字段类型不支持所选函数 | 提示：「字段 {name} 为 string 类型，不支持 SUM 聚合，建议使用 COUNT」 |
| 组合规则引用不存在的变量 | 提示：「变量 {var} 未定义，当前可用变量：{list}」 |
| 用户不清楚如何配置 | 调用 `tab_list_indicators` 检索相似指标作为参考 |

---

## F5：sqlConfig 组装

将前 4 阶段信息组装为完整 config 对象，**此过程对用户透明**。

> config 字段命名与 `tab_save_indicator` 和 `tab_get_indicator_sql` 完全一致，均使用 **snake_case**。

### config 结构（非留存类）

```json
{
  "action_table": [
    { "tb_id": {action_table_id}, "tb_name": "{table_name}", "uin": "{uin_field}", "ds": "{ds_field}" }
  ],
  "exposure_table": {
    "tb_id": {exposure_table_id}, "tb_name": "{exposure_table_name}",
    "uin": "{uin_field}", "ds": "{ds_field}", "gray_id": "{gray_id_field}"
  },
  "basic_info": {
    "metric_id": {indicator_id}, "metric_type": {formula枚举值},
    "metric_name": "{indicator_name}", "retain_days": 0, "retain_type": "default"
  },
  "cal_info": {
    "inner_query": {
      "select": [
        {
          "tb_id": {action_table_id}, "column": "{business_field}",
          "func_name": "Sum", "input_mode": "select", "user_input": "Sum({business_field})"
        }
      ],
      "where": []
    },
    "outer_query": {
      "select": {
        "nume": { "column": ["A"], "func_name": "Sum", "input_mode": "select", "user_input": "A" },
        "deno": { "column": [], "func_name": "Count", "input_mode": "select", "user_input": "all_exp_user" }
      },
      "where": {}
    }
  },
  "multi_action_table_join_mode": "inner",
  "props": { "quantile": "", "dive_deno_def": false, "qid_mode": 0 }
}
```

### 多数据源关联模式（`multi_action_table_join_mode`）

当 `action_table` 数组包含多张行为表时，通过 `multi_action_table_join_mode` 控制关联方式（写入 config 顶层）：

| 场景 | SQL 生成模式 | `multi_action_table_join_mode` |
|---|---|---|
| 单行为表（默认） | 曝光表 LEFT JOIN 行为表 | `"inner"`（默认，可不传） |
| 多行为表 INNER JOIN | 曝光表 LEFT JOIN（行为表A INNER JOIN 行为表B） | `"inner"` |
| 多行为表 OUTER JOIN | 曝光表 LEFT JOIN（行为表A OUTER JOIN 行为表B） | `"outer"` |
| 留存类多行为表 | 曝光表 LEFT JOIN（行为表A UNION 行为表B） | `"inner"`（留存类固定 UNION） |

> Skill 默认单行为表场景，`multi_action_table_join_mode` 默认传 `"inner"`。用户明确说明多表 OUTER JOIN 时才改为 `"outer"`。

### 各子结构说明

**`inner_query.select`**：数组，第1项产出变量 `A`，第2项产出变量 `B`，依次类推：
- `input_mode`：精确匹配字段名 → `"select"`；手动输入表达式（如 `"count(distinct if(...))"` ）→ `"input"`
- `func_name`：
  - `input_mode="select"` 时首字母大写（`"Sum"`、`"Count"`、`"CountDistinct"`）；**非去重分位数(11) 例外，传 `""`**（直接取原始字段值）
  - `input_mode="input"` 时小写或空字符串（如纯 SQL 表达式时传 `""`）
- `user_input`：
  - `input_mode="select"` 且有 `func_name` 时 → `"Sum({字段名})"`（函数包裹形式）
  - `input_mode="select"` 且 `func_name=""` 时 → 字段名本身（如 `"rtime_diff"`，与 `column` 完全相同）
  - `input_mode="input"` 时 → 完整 SQL 表达式

**`inner_query.where`**：过滤条件数组，`input_mode` 统一使用 `"input"`；无过滤条件时传 `[]`：
```json
[{ "tb_id": 101, "column": "", "func_name": "", "input_mode": "input", "user_input": "event_type='click'" }]
```

**`outer_query.where`**：对 inner 聚合后的中间变量再次过滤，不开启时传 `{}`。**留存类指标（formula=6/8）禁止使用，传入会报错。**

### 各类型关键差异

| 类型 | metric_type | inner select func | inner where | outer.nume | outer.deno | outer_where |
|---|---|---|---|---|---|---|
| 均值类 | 1 | `Sum`（select模式） | 可选 `[]` | `func:"Sum", input:"A"` | `func:"Count", input:"all_exp_user"` | 可选 `{}` |
| 用户比例类 | 2 | 任意聚合（`Sum`等） | 可选 `[]` | `func:"Count", input:"A>0"` | `func:"Count", input:"all_exp_user"` | 可选 `{}` |
| 比率类 | 3 | A:`Sum`；B:`Sum` | 可选 `[]` | `func:"Sum", input:"A"` | `func:"Sum", input:"B"` | 可选 `{}` |
| 求和类 | 4 | `Sum`（select模式） | 可选 `[]` | `func:"Sum", input:"A"` | **空结构**（`{column:[],input_mode:"input",user_input:""}`） | 可选 `{}` |
| 计数类 | 5 | 任意聚合（`Sum`等） | 可选 `[]` | `func:"Count", input:"A>0"` | **空结构** | 可选 `{}` |
| 人均活跃天数 | 7 | `Sum/input`（业务聚合） | 可选 `[]` | `func:"Sum", input:"A>0"` | **空结构** | 可选 `{}` |
| 去重留存 | 6 | 留存行为字段 `Sum` | 可选 `[]` | `func:"Count", input:"A>0"` | `func:"Count", input:"A>0"` | **禁止**（留存类传`{}`即可） |
| 非去重留存 | 8 | 留存行为字段 `Sum` | 可选 `[]` | `func:"Count", input:"A>0"` | `func:"Count", input:"A>0"` | **禁止** |
| 用户去重分位数 | 10 | `Sum/input`，按用户聚合 | 可选 `[]` | `func:"Sum", input:"A"` | **空结构** | 可选 `{}` |
| 非去重分位数 | 11 | **`func:""`**，直接取字段值 | 可选 `[]` | `func:"", input:"A"` | **空结构** | 可用（支持 `>`/`<`/LIKE/NOT IN等） |
| 秩均值 | 12 | `Sum`（select模式） | 可选 `[]` | `func:"Sum", input:"A"` | **空结构** | 可选 `{}` |

> - **"空结构"**：无真实分母类型（求和/计数/人均活跃天数/分位数/秩均值）的 `outer_select.deno` 必须传 `{ "column": [], "input_mode": "input", "user_input": "" }`，**不可省略**。
> - **分位数格式**：`props.quantile` 为**百分数字符串，保留两位小数**：P50=`"50.00"`，P75=`"75.00"`，P90=`"90.00"`，P95=`"95.00"`，P99=`"99.00"`
> - **人均活跃天数**：`NUME_ONLY` 类型，outer 无真实分母，平台后端根据 inner 按 uin+ds 分组结果自动计算人均天数，`func_name` 与 inner 保持用户配置不变
> - **留存类 cal_info**：`tab_save_indicator` 时 config.cal_info 传 `null`；`tab_get_indicator_sql` 调用时仍需传完整 inner_select/outer_select（**不是 null**）
> - **非去重分位数 outer_where**：支持对中间变量过滤（如 `B>2`），前端有专用操作符支持，**不禁止**；仅留存类（6/8）禁止非空 outer_where

### 留存类 config 示例（tab_save_indicator 时）

留存类 `tab_save_indicator` 的 `config.cal_info` 传 `null`，平台根据 `basic_info` 自动生成留存计算逻辑。**调用 `tab_get_indicator_sql` 时不传 null，仍需传 inner_select 和 outer_select**：

```json
{
  "action_table": [{ "tb_id": {action_table_id}, "tb_name": "{table_name}", "uin": "{uin_field}", "ds": "{ds_field}" }],
  "exposure_table": { "tb_id": {exposure_table_id}, "tb_name": "{exposure_table_name}", "uin": "{uin_field}", "ds": "{ds_field}", "gray_id": "{gray_id_field}" },
  "basic_info": {
    "metric_id": {indicator_id}, "metric_type": 6,
    "metric_name": "{indicator_name}", "retain_days": 7, "retain_type": "default"
  },
  "cal_info": null
}
```

- `retain_type`：`"default"`（N日，第N天是否回来）/ `"interval"`（N日内，任意一天回来即算），默认 `"default"`
- `retain_days`：支持 1 / 3 / 7 / 14 / 30
- 去重/非去重通过 `metric_type`（6/8）区分，与 `retain_type` 无关

---

## F6：元信息补全

### 指标信息

| 字段 | 约束 | 默认值/交互策略 |
|---|---|---|
| 指标名称 | ≤60 字符，业务内唯一，仅支持中文、英文字母、下划线 | **自动生成**（根据指标类型和业务字段推导），可修改 |
| 指标英文名 | 全局唯一，变量名格式 | **自动生成**（如 `avg_top1_accuracy`），可修改 |
| 指标口径 | ≤100 字符 | 基于分子/分母逻辑**自动生成**，可修改 |
| 指标负责人 | RTX 账号 | **必须询问**，没有则传 `""` |
| 指标标签 | 空间已有标签，至少1个 | **必须询问**，调用 `tab_get_indicator_type` 获取列表 |
| 指标属性 | 三选一（互斥，仅管理员可设置非默认值） | **默认「无固定属性」**（`is_oec=0, is_guardrail=0`） |
| 是否DS认证 | 是/否 | **默认「否」**（`is_ds=0`） |
| 指标变更通知 | 是/否 | **默认「是」**（`is_notify=true`）；其他用户修改该指标时，是否向负责人发送邮件通知 |

**指标属性三选一**（仅业务管理员可编辑，普通用户创建时默认「无固定属性」）：

| 用户选项 | 传参 |
|---|---|
| T0-北极星指标 | `is_oec=1, is_guardrail=0` |
| T1-护栏指标 | `is_oec=0, is_guardrail=1` |
| 无固定属性（默认）| `is_oec=0, is_guardrail=0` |

获取标签列表：
```bash
mcporter call "tab.tab_get_indicator_type(business_code: {business_code})"
```

### 计算配置

以下字段均有默认值，**直接填充，不主动询问**，展示给用户确认时列出即可：

| 字段 | 默认值 | 何时主动询问/自动推断 |
|---|---|---|
| 指标单位 | 空 | 语义涉及时长/次数/金额时**主动询问** |
| 预期收益方向 | 正向（`expected_marked=0`） | 名称含「时长/延迟/耗时/错误率/失败率/跳出率」→ 自动推断为负向（`expected_marked=1`），标注「⚠️ 已自动推断为负向」 |
| 数值格式 | 数字（`percentage=0`） | 用户比例类（2）/留存类（6/8）→ 自动推断为百分比（1），标注「已自动推断为百分比」 |
| 小数位数 | 4（`digit=4`） | 用户主动提出时修改 |
| 换算系数 | `"1"`（字符串，支持分数如 `1/60`、整数如 `10`、小数如 `0.01`） | 用户主动提出时修改 |
| MDE | 展示给用户为 `1`（即1%），传参为 `0.01` | 用户主动提出时修改；用户填写百分比数值（如填 `2` 表示2%），传参时除以100（`0.02`），保留3位小数 |
| 异常值排除 | 关（`outliers` 不传） | 用户主动提出时配置 |
| 延迟计算 | 关（`delay_switch=false`） | 仅均值类(1)/用户比例类(2)/比率类(3)支持；其他类型（求和/计数/活跃天数/留存/分位数/秩均值）**不支持延迟计算**，用户提及时告知不支持 |

**延迟计算（`delay_window`）参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `delay_switch` | boolean | 是否开启，默认 `false` |
| `mode` | integer | `1`=前N日计算（命中日到第N日区间） / `2`=第N日计算（命中日起第N日） / `3`=延迟N日计算（延迟N日后开始多次统计） |
| `window_interval` | integer | 延迟天数N（正整数） |

`delay_window` 写入 config 顶层（与 `cal_info`、`basic_info` 同级）。用户开启时通过 `tab_get_indicator_sql` 的 `delay_window` 参数传入，返回的 `data.config` 会自动携带。关闭时传 `{ delay_switch: false, window_interval: 1, mode: 0 }`。

### 展示模板（一次性展示，减少来回问答）

```
📋 指标信息确认：
- 名称：{name}（{len}/60字符，自动生成，可修改）
- 英文名：{engname}（自动生成，可修改）
- 口径：{comment}（{len}/100字符）
- 负责人：（默认平台当前用户，如需指定请告知）
- 标签：{category_names}
- 属性：{无固定属性/T0-北极星/T1-护栏}
- DS认证：否
- 变更通知：是

⚙️ 计算配置（默认值，如需修改请告知）：
- 指标单位：{unit 或 "—（待填写）"}
- 预期收益：{正向 / ⚠️ 负向（自动推断）}
- 数值格式：{数字 / 百分比（自动推断）}
- 小数位数：4 / 换算系数：1 / MDE：1%（传参 0.01）

如需修改某项，请告知；否则确认继续。
```

### 条件分支

| 场景 | 处理方式 |
|---|---|
| 名称超60字符 | 自动截断并提示：「名称已超60字符，已截断为 "{truncated}"，请确认」 |
| 口径超100字符 | 自动精简并提示：「口径已超100字符，已精简，请确认」 |
| 标签列表为空 | 提示：「当前空间暂无可用标签，请联系管理员添加后再试，或跳过」 |
| 语义涉及计量但未指定单位 | 主动询问：「指标涉及计量单位，请指定（如：秒、分钟、次、元）」 |

### 高级配置（用户主动提出时才处理）

以下功能属于进阶用法，Skill 不主动引导，仅在用户明确提出时按对应规则处理：

| 功能 | 参数 | 说明 |
|---|---|---|
| 异常用户名单过滤 | `black_table_list=[{tb_id}]` | 按黑名单过滤异常用户 ID，传入异常用户表的 `tb_id` 列表 |
| 离群值替换 | `outliers={outliers_replace:true, header_value:{1-headerValue/100}}` | 将头部 a% 的数据替换为对应分位数值；`header_value` 为 0~1 小数（如排除头部 1% → `header_value=0.99`） |

---

## F7：创建前置门控

> **所有前置步骤必须通过，并完成元信息确认后，才能执行 `tab_add_indicator`（不可逆操作）。**

| # | 前置条件 | 未满足时的处理 |
|---|---|---|
| 1 | F1 指标类型已确认 | **终止**，返回 F1 重新确认 |
| 2 | F2 数据源表和曝光表已确认 | **终止**，返回 F2 重新选择 |
| 3 | F3 分子/分母口径已确认 | **终止**，返回 F3 重新确认 |
| 4 | F6 元信息已全部填写（名称、英文名、口径、标签必填） | **终止**，返回 F6 补全 |
| 5 | 用户已对元信息摘要（指标名称/类型/数据源/曝光表/元数据）明确确认 | **等待**，展示元信息摘要后不执行 Step1，直到用户确认 |

**元信息摘要展示模板**（Step1 前展示，等待用户确认）：

```
📋 指标元信息确认：
- 指标名称：{indicator_name}    指标英文名：{indicator_engname}
- 指标类型：{formula_name}      数据源表：{action_table_name}
- 曝光表：{exposure_table_name}
- 指标口径：{indicator_comment}
- 指标单位：{unit}  预期收益：{expected_marked_name}  数值格式：{percentage_name}（{digit}位小数）
- MDE：{mde*100}%  负责人：{principle}  标签：{category_names}  属性：{attribute_name}

如需修改请告知，确认无误后回复「确认」继续。
```

| 用户回复 | 处理方式 |
|---|---|
| 「确认」/「ok」/「是」等肯定回复 | 执行 Step1（tab_add_indicator） |
| 提出修改意见 | 返回对应步骤（F1-F6）修改，修改后重新展示本摘要并再次等待确认 |
| 无回复 / 模糊回复 | **等待**，不执行 Step1 |

---

## F8：创建与通知

### 创建调用（三步操作）

**Step1：tab_add_indicator**

```bash
mcporter call "tab.tab_add_indicator(
  business_code: {business_code},
  indicator_name: '{name}',
  indicator_engname: '{engname}',
  indicator_comment: '{comment}',
  category_ids: [{category_id_list}],
  principle: '{principle}',
  is_oec: {0或1}, is_guardrail: {0或1},
  is_ds: {0或1}, is_notify: {true或false},
  calculate_interval: 0
)"
```

- `category_ids`：通过 `tab_get_indicator_type` 返回的 `id` 获取；用户跳过时传 `[]`
- `calculate_interval`：天级固定传 `0`
- 返回 `data.indicator_id`，**务必记录**，Step2 和 Step3 均需使用

---

**Step1 完成后：sqlConfig 配置确认（Step2 前必须等待用户确认）**

> **强制要求**：获得 `indicator_id` 后，必须向用户展示将要传入 `tab_get_indicator_sql` 的 sqlConfig 配置，**等待用户明确确认**后才能执行 Step2。**严禁**在用户确认前自动调用 `tab_get_indicator_sql`。

展示模板（**仅展示与当前指标类型相关的字段**，默认值且无需用户关注的字段不展示）：

```
✅ 指标 ID 已生成：{indicator_id}

📐 SQL 生成配置确认（tab_get_indicator_sql 完整入参）：

【事件加工 inner_query】
- 变量 A：{func_name}({column})  来源：{table_name}
- 变量 B：{func_name}({column})  来源：{table_name}（如有多个变量依次列出）
- 过滤条件（inner_where）：{条件列表 或 "无"}

【组合规则 outer_query】
- 分子：{outer.nume.func_name}({outer.nume.user_input})
- 分母：{outer.deno.func_name}({outer.deno.user_input}) 或 "—（无分母）"
- 变量过滤（outer_where）：{表达式 或 "无"}

【留存配置】（仅留存类展示）
- 留存天数：{retain_days} 日
- 留存口径：{retain_type：default=第N日 / interval=N日内}

【分位数】（仅分位数类展示）
- 分位值：P{quantile}

【延迟计算】（仅开启时展示）
- 模式：{前N日 / 第N日 / 延迟N日}，N = {window_interval}

【高级配置】（非默认值时展示，默认值时注明"均为默认值，如需修改请告知"）
- 精准曝光（precise_accum）：{true / false（默认）}
- 离群值处理（outliers）：{替换头部 a% / 关（默认）}
- 异常用户黑名单（black_table_list）：{表ID列表 / 无（默认）}

如需调整任何配置请告知，确认无误后回复「确认」继续生成 SQL。
```

| 用户回复 | 处理方式 |
|---|---|
| 「确认」/「ok」/「是」等肯定回复 | 执行 Step2（tab_get_indicator_sql） |
| 提出修改意见 | 更新 sqlConfig，重新展示本摘要并再次等待确认；**不重复调用 Step1** |
| 无回复 / 模糊回复 | **等待**，不执行 Step2 |

---

**Step2：tab_get_indicator_sql（SQL 生成）**

> `tab_get_indicator_sql` 根据配置**生成** SQL，**不做**语法/语义校验。返回 `data.sql`（必须传入 Step3 的 `sql` 字段）和 `data.config`（可直接用于 Step3 的 `config` 字段）。

**有分母类型（均值/比例/比率/活跃天数）：**

```bash
mcporter call "tab.tab_get_indicator_sql(
  business_code: {business_code},
  metric_id: {indicator_id},
  metric_name: '{indicator_name}',
  metric_type: {formula枚举值},
  source_table_list: [{action_table_id}],
  exp_table: {exposure_table_id},
  inner_select: [
    { tb_id: {action_table_id}, column: '{business_field}', func_name: 'Sum', input_mode: 'select', user_input: 'Sum({business_field})' }
  ],
  inner_where: [
    { tb_id: {action_table_id}, column: '', func_name: '', input_mode: 'input', user_input: '{过滤条件}' }
  ],
  outer_select: {
    nume: { column: ['A'], func_name: 'Sum', input_mode: 'select', user_input: 'A' },
    deno: { column: ['uin'], func_name: 'Count', input_mode: 'input', user_input: 'uin > 0' }
  },
  outer_where: {},
  retain_days: 0, retain_type: '', quantile: '',
  dive_deno_def: false, precise_accum: false, outliers: {}, black_table_list: []
)"
```

**无分母类型（求和/计数/人均活跃天数/分位数/秩均值）**：`outer_select.deno` 传**空结构** `{ "column": [], "input_mode": "input", "user_input": "" }`，**不可省略该字段**。

**参数规范**：

- **`input_mode`**：精确匹配已有字段/变量名 → `"select"`；手动输入自定义表达式 → `"input"`；`inner_where` 统一 `"input"`
- **`func_name`**：
  - `input_mode="select"` → 首字母大写（`"Sum"`、`"Count"`、`"CountDistinct"`）；**非去重分位数(11) inner_select 的 `func_name` 例外，传 `""`**（直接取字段原始值）
  - `input_mode="input"` → 小写（`"sum"`、`"count_distinct"`）；若为纯表达式（如 `count(distinct if(...))`）则 `func_name` 传 `""`
- **`user_input`**：
  - `inner_select select模式` → 与 `column` 相同，如 `"in_vstart_cnt"`（**不加函数包裹**；注意与 select模式但有函数时的区别：有函数时 `user_input` 为 `"Sum(字段名)"`）
  - `inner_select input模式` → 完整表达式，如 `"count(distinct if(a>0, e_mid, null))"`
  - `outer_select select模式` → 变量名如 `"A"` 或条件表达式如 `"A>0"`、`"all_exp_user"`
  - `outer_select input模式` → 完整表达式

> **`user_input` 细化规则（inner_select select模式）**：
> - 有 `func_name`（如 `"Sum"`）时：`user_input = "Sum(字段名)"`
> - `func_name = ""`（非去重分位数直取字段）时：`user_input = "字段名"`（与 `column` 完全相同）

**config → tab_get_indicator_sql 字段映射**：

| config 字段 | tab_get_indicator_sql 参数 | 备注 |
|---|---|---|
| Step1 返回的 `indicator_id` | `metric_id` | **使用 Step1 返回值，非0** |
| `basic_info.metric_type` | `metric_type` | 必填 |
| `basic_info.retain_days` | `retain_days` | 非留存类传 `0` |
| `basic_info.retain_type` | `retain_type` | 非留存类传 `"default"` |
| `action_table[0].tb_id` | `source_table_list[0]` | 必填 |
| `exposure_table.tb_id` | `exp_table` | 必填 |
| `cal_info.inner_query.select` | `inner_select` | 数组结构相同；留存类也需传实际内容 |
| `cal_info.inner_query.where` | `inner_where` | 数组结构相同；无条件传 `[]` |
| `cal_info.outer_query.select.nume` | `outer_select.nume` | — |
| `cal_info.outer_query.select.deno` | `outer_select.deno` | **无分母类型传空结构，不可省略** |
| `cal_info.outer_query.where` | `outer_where` | 无过滤时传 `{}`；留存类传 `{}` |
| `props.quantile` | `quantile` | 非分位数类传 `""`；分位数类传百分数字符串如 `"99.00"` |
| `props.dive_deno_def` | `dive_deno_def` | 默认 `false` |
| F6 `precise_accum` | `precise_accum` | 默认 `false` |
| F6 `outliers` | `outliers` | 未开启时传 `{}` |
| F6 `black_table_list` | `black_table_list` | 未开启时传 `[]` |

**SQL 预览展示**：

```
📋 SQL 预览：
-- inner_query（行为表按天聚合）：
SELECT {uin_field} AS uin, {ds_field} AS ds, {aggregation_expr} AS A
FROM {table_name} {WHERE_clause}
GROUP BY {uin_field}, {ds_field}

-- outer_query（关联曝光表后的最终计算）：
{numerator} / {denominator}

SQL 生成：✅ 成功
```

**自定义 SQL 模式（fixed_sql=1）**：用户选择自定义 SQL 时跳过 `tab_get_indicator_sql` 调用，Skill 做基础语法检查（非空、含SELECT/FROM、无明显语法错误），通过后直接进入 Step3，设置：`fixed_sql=1`，`sql`=用户提供的完整 SQL，`config` 仍需传 `action_table`/`exposure_table`/`basic_info`，`source_table` 中 ID 数量必须与 `config.action_table` 数组长度一致。

**自动修正流程**：接口返回错误（`status: error`）或接口不可用（空响应、超时）均进入修正流程：

```
调用失败 → 分析错误原因 → 自动修正 sqlConfig → 重新调用
                （最多3次）
           仍失败 → 展示错误详情 → 终止，请求人工介入，不执行 Step3
```

修正策略：字段不存在→替换为同语义可用字段；聚合函数不匹配→按类型规则修正；GROUP BY 缺少字段→自动补充；分子/分母类型不匹配→按后端校验规则修正；接口不可用→重新检查 sqlConfig 结构完整性后重试。

每次重试只输出**修正的 diff 部分**，不重新展示完整 JSON：

```
第 {N} 次自动修正：
- 修改 inner_query.select[0].column: "play_dur" → "play_duration"（字段不存在，替换为同语义字段）
重新校验中...
```

成功后记录 `data.sql` 和 `data.config`；3次仍失败则**终止**，告知用户通过同一 `indicator_id` 重新从 F8-Step2 进入。

---

**Step3：tab_save_indicator**

```bash
mcporter call "tab.tab_save_indicator(
  business_code: {business_code},
  indicator_id: {indicator_id},
  indicator_name: '{name}', indicator_engname: '{engname}', indicator_comment: '{comment}',
  indicator_category: '{tab_get_indicator_type返回的category_code逗号分隔，如tag1,tag2}',
  indicator_formula: {F1确认的formula整数枚举值，如1/2/3/4/5/6/7/8/10/11/12},
  is_oec: {整数0或1}, is_guardrail: {整数0或1},
  is_ds: {整数0或1}, is_notify: {true或false}, principle: '{principle}',
  source_table: '{action_table_id逗号分隔字符串，如123或123,456}',
  exposure_table: {exposure_table_id整数},
  indicator_unit: '{unit}', percentage: {整数0=数字或1=百分比}, digit: {小数位数整数},
  rate: '{换算系数字符串，默认为1}', expected_marked: {整数0=正向或1=负向，默认0，禁止传-1}, mde: {百分比除以100的小数如0.01},
  fixed_sql: {整数0=自动生成或1=自定义},
  sql: '{tab_get_indicator_sql返回的data.sql}',
  is_modify: false,
  config: { ...tab_get_indicator_sql返回的data.config，合并multi_action_table_join_mode和precise_accum... }
)"
```

**关键参数说明**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `indicator_category` | string | `tab_get_indicator_type` 返回的 **`category_code`** 逗号分隔，如 `"tag1,tag2"`；**不是 `id`，不是 `name`** |
| `indicator_formula` | integer | **必传整数**，与 F1 formula 枚举值一致（1/2/3/4/5/6/7/8/10/11/12）；**不可传字符串**，否则报 `"wrong indicator formula"` |
| `source_table` | string | 行为表 ID 逗号分隔**字符串**，如 `"123"` 或 `"123,456"`；**不是数组，不是整数** |
| `exposure_table` | integer | 曝光表 ID **整数**；**不可传字符串** |
| `percentage` | integer | **必传整数**：数字格式=`0`，百分比=`1`；用户比例/留存类自动推断为 `1` |
| `digit` | integer | **必传整数**：小数位数，默认 `4`；**不可传字符串** |
| `rate` | string | 换算系数**字符串**，默认 `"1"`；支持分数如 `"1/60"`、整数如 `"10"`、小数如 `"0.01"`；**必须加引号传字符串，不可传数字类型** |
| `expected_marked` | integer | **必传整数**：正向=`0`，负向=`1`；**绝不能传 `-1`、`true`、`false` 或省略**；默认传 `0` |
| `mde` | number | 用户填写百分比数值 → 除以100传入（如用户填 `1` → 传 `0.01`），保留3位小数 |
| `fixed_sql` | integer | **必传整数**：自动生成=`0`，自定义SQL=`1`；**不可传布尔值** |
| `is_modify` | boolean | 新建和重试均传 `false` |
| `config` | object | **优先使用 `data.config`**，再合并 `multi_action_table_join_mode`/`precise_accum` 等字段；留存类 `cal_info` 传 `null` |
| `config.cal_info.inner_query.select.deno` | — | 无分母类型（求和/计数/分位数/秩均值）**不传此字段** |
| `config.cal_info.outer_query.where` | — | 无变量过滤传 `{}`；留存类传 `{}` |

Step3 失败时：`indicator_id` 已生成，直接用同一 `indicator_id` 重新从 F8-Step2 进入（重新调用 SQL 生成 → Step3），**不重复调用 Step1**。多次重试仍失败时告知：「指标 ID {indicator_id} 已创建但配置保存失败，请在 TAB 平台手动完成配置或删除残缺指标后重试」。

### MCP 错误码处理

| 错误码/错误信息 | 处理方式 |
|---|---|
| 401 | 提示重新鉴权：「认证失败，请重新执行 `python3 auth_setup.py`」 |
| 403 | **立即终止**：「当前用户无「T+1指标创建/复制」权限，请联系空间管理员授权」 |
| 409 / "指标名已存在" | 自动建议新名称，请用户确认 |
| 422 | 进入自动修正（见 F8-Step2） |
| 429 | 等待后重试：「请求过于频繁，{N}秒后自动重试」 |
| 500 | 「服务暂时不可用，请稍后重试」 |
| "指标数据源表配置错误" | source_table ID 数量与 config.action_table 数组长度不一致，自动修正后重试 |
| "指标数据源表配置异常" | action_table 中 tb_id 不在 source_table 中，自动修正后重试 |

### 创建成功通知

其中：
- `indicator_id`：F8-Step1（`tab_add_indicator`）返回的 `data.indicator_id`
- `business_code`：每个mcp工具的 `business_code` 入参

```
✅ 指标创建成功！

- 指标ID：{indicator_id}
- 指标名称：{name}
- 指标链接：https://tab.woa.com/tab/data/indicator/edit?id={indicator_id}&optTitle=view&business={business_code}&appGroup=abtest

已自动通知负责人（企微）。
```

---

## 关键约束速查

| 约束点 | 规则 |
|---|---|
| 权限校验（F0） | 用户启动创建意图时第一步执行，无权限不进入任何引导步骤 |
| F7 门控 | `tab_add_indicator` 不可逆，执行前必须确认 F1-F6 所有步骤通过 |
| SQL 生成位置（F8-Step2） | 在 F8-Step1 之后、F8-Step3 之前；`tab_get_indicator_sql` 仅生成 SQL，不校验 |
| `func_name` 规则 | `input_mode="select"` → 首字母大写（`"Sum"`/`"Count"`/`"CountDistinct"`），**非去重分位数(11) inner_select 例外传 `""`**；`input_mode="input"` 或纯表达式 → 小写或 `""` |
| `user_input` 格式 | `inner_select select模式且有func` → `"Sum(字段名)"`；`inner_select select模式且func=""` → 字段名本身；`outer_select select模式` → `"A"`/`"A>0"`/`"all_exp_user"` |
| `indicator_formula` | `tab_save_indicator` 必传**整数**，`tab_add_indicator` 不传；不可传字符串 |
| 无分母 outer_select.deno | 求和/计数/人均活跃天数/分位数/秩均值类，`deno` 传空结构 `{column:[],input_mode:"input",user_input:""}`, **不可省略字段** |
| `quantile` 格式 | 百分数字符串保留两位小数：P99=`"99.00"`，P90=`"90.00"`，P50=`"50.00"` 等；**非小数格式** |
| `sql` 来源 | auto 模式必须使用 `tab_get_indicator_sql` 返回的 `data.sql`，不可自行构造 |
| `config` 来源 | auto 模式优先使用 `data.config`，再合并 `multi_action_table_join_mode`/`precise_accum` |
| `mde` 格式 | 用户填写百分比数值（如 `1` 表示1%），传参时除以100：`0.01`，保留3位小数 |
| 留存类 `cal_info` | `tab_save_indicator` 时 config.cal_info 传 `null`；`tab_get_indicator_sql` 时仍传完整 inner/outer（不传 null）；outer_where 传 `{}` |
| inner GROUP BY | 必须包含 `{uin字段}` 和 `{ds字段}` |
| SQL 生成失败 | 最多重试3次；仍失败则终止，不调用 `tab_save_indicator` |
| Step3 失败重试 | 用同一 `indicator_id` 从 F8-Step2 重进，**不重复调用 Step1** |
| 创建后状态 | 指标立即上线，不可自动回滚，配置有误需在 TAB 平台手动下线 |
| 指标名格式 | 仅支持中文、英文字母、下划线，≤60字符 |
| 延迟计算支持范围 | 仅均值类(1)/用户比例类(2)/比率类(3)支持；求和(4)/计数(5)/活跃天数(7)/留存(6/8)/分位数(10/11)/秩均值(12)**不支持** |
| `delay_window.mode` | `1`=前N日计算 / `2`=第N日计算 / `3`=延迟N日计算；关闭时传 `{delay_switch:false, window_interval:1, mode:0}` |

## 参考文件

`references/sqlconfig-examples.json`：覆盖全部 11 种 `metric_type` 的完整 sqlConfig 示例，每条附 `_comment` 说明类型特征和易错点。组装 `tab_get_indicator_sql` 入参时**优先参照对应类型的示例结构**