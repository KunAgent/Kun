---
name: databrain-datalab-analyst
description: >-
  经分Datalab 报表/知识库**兜底**分析 skill。**不是经分指标查询的首选**——一般经分（dashboard）问题必须先走
  `databrain-dashboard-service`。仅在以下情况启用本 skill：(1) 用户**直接给了 Datalab 报表 URL /
  dashboard_id / `报表id@图表id`**；(2) `databrain-dashboard-service` 已尝试且返回 unsupported metric / 空数据 /
  MCP describe 找不到 cube 的明确失败。 非白名单游戏（不在 `dashboard_white_games`）**禁止**用本 skill 兜底。
version: 3.11.0
author: Datalab Team
permissions: 网络访问权限
---

## 0. Skill Scope（必读 · 与 dashboard-service / summarize 协作）

### 0.1 路由前置（硬约束，禁止越过）

1. **本 skill 不是经分查询的入口**。涉及白名单游戏（在 `agent_context.dashboard_white_games` 中）的指标查询，**必须先**调 `databrain-dashboard-service`，只有在 dashboard-service尝试过查数据，但明确返回 unsupported / 空数据 / 找不到 cube 后，才允许走本 skill 兜底。
2. **非白名单游戏禁用本 skill**。游戏不在 `dashboard_white_games` 中 → 走 `databrain-intelligence`，**不要**回退到 datalab。
3. **直接命中场景**（无需先试 dashboard-service）：用户把 Datalab 报表 URL / dashboard_id / `报表id@图表id` 直接贴在问题里 → 直接 `full_report`；用户明确要求"看这个报表/图表"。

### 0.2 game_code 来源

直接从 `agent_context.dashboard_game_code_and_filters[<game_name>].game_code` 取值。仅当上下文缺失时，才用 `search_game` 兜底。

---

<!-- ⚡ QUICK START — Agent 读到这里就可以开始工作 -->

## ⚡ TL;DR

- **脚本入口**: `python scripts/call_api.py <action> [参数]`
- **常用 action**: `dashboard_search`, `dashboard_overview`, `full_report`, `chart_data`, `knot_search`
- **环境变量**: `DATABRAIN_TOKEN`(必填), `DATABRAIN_HOST`(必填), `DATABRAIN_DISPLAY_HOST`(必填)
- **最高频场景**: 用户给了报表链接/ID → 直接 `full_report`（1 次调用搞定）

```bash
# 搜索报表
python scripts/call_api.py dashboard_search --game_code "gstm" --keyword "留存"

# 全量分析（最常用，内部自动完成 report_log + overview + dashboard_data）
python scripts/call_api.py full_report --dashboard_id "<id>" --question "用户的问题"

# 从 URL 分析
python scripts/call_api.py full_report --dashboard_url "<url>" --question "用户的问题"

# 只分析指定图表（传 chart_ids JSON 数组，只查这些图表的数据）
python scripts/call_api.py full_report --dashboard_id "<id>" --chart_ids '["chart_id_1","chart_id_2"]'

# 🆕 通过 chart_refs 分析（格式：报表id@图表id，自动解析出 dashboard_id 和 chart_ids）
python scripts/call_api.py full_report --chart_refs '["dashboard_id_1@chart_id_1","dashboard_id_1@chart_id_2"]'

# 🆕 解析 chart_refs（纯本地解析，不调 API，用于预检查多报表情况）
python scripts/call_api.py parse_refs --chart_refs '["dash1@chart1","dash1@chart2","dash2@chart3"]'

# 🆕 多报表批量查询（chart_refs 含多个不同 dashboard，自动循环每组）
python scripts/call_api.py multi_report --chart_refs '["dash1@chart1","dash1@chart2","dash2@chart3"]'

# 报表结构
python scripts/call_api.py dashboard_overview --dashboard_id "<id>"

# 单图表查询（带筛选）
python scripts/call_api.py chart_data --dashboard_id "<id>" --chart_id "<id>" --filters '[...]'

# 指定多图表查询（dashboard_data + chart_ids）
python scripts/call_api.py dashboard_data --dashboard_id "<id>" --chart_ids '["chart_id_1","chart_id_2"]'

# 🆕 指定多图表查询（dashboard_data + chart_refs）
python scripts/call_api.py dashboard_data --chart_refs '["dash1@chart1","dash1@chart2"]'

# 知识库检索（通过 Datalab 后端代理，自动根据 game_code 获取知识库）
python scripts/call_api.py knot_search --game_code "gstm" --query "留存下降 归因分析"
```

- **禁止** Agent 自己写 curl/requests/subprocess 代码调 API
- **禁止** 猜测 filter column 名或 value 值（必须从 dashboard_overview 的 `available_filters` 获取 column，从 `available_values` 匹配 value）
- **禁止** 反向匹配：不得因为某筛选器 `available_values` 含有某值就自动加上该筛选器，只有用户明确提及的维度才加

<!-- END QUICK START -->

---

## 🗺️ 完整决策树（唯一权威版）

> ⚠️ 决策树前置：先按 §0.1 路由前置判断本 skill 该不该被调用。被调用后才走下表。

```
本 skill 被路由进来后：
  │
  ├── 用户给了报表 URL / dashboard_id / chart_refs（报表id@图表id）？
  │     └── ✅ 是 →【路径 C】直接 full_report，不走 MCP 知识库；URL 自带授权，不再判白名单
  │
  ├── 白名单游戏 + dashboard-service 已尝试且明确失败（unsupported / 空数据 / 找不到 cube）？
  │     │
  │     ├── game_code 以 "gst" 开头 → 【路径 A: Knot MCP 知识库前置 + 数据分析】
  │     │     ├── ① knot_search（用用户问题作 query，获取相关报表/指标定义/方法论）
  │     │     ├── ② 根据 MCP 返回 + dashboard_search 定位目标报表
  │     │     ├── ③ dashboard_overview 获取报表结构
  │     │     ├── ④ full_report 获取数据
  │     │     └── ⑤ 输出"知识 + 数据"融合分析（格式交给 summarize 收尾）
  │     │
  │     └── 其他白名单游戏 → 【路径 B: 标准数据分析（无 MCP）】
  │           ├── ① dashboard_search 搜索匹配报表
  │           ├── ② dashboard_overview 获取报表结构
  │           ├── ③ 自动选择最匹配报表 + full_report
  │           └── ④ 数据分析 + 末尾提示其他候选报表
  │
  ├── 用户问通用概念（无具体业务，无报表 ID）？
  │     └── 查 references/ 本地文件直接回答
  │
  └── 上下文缺 game_code 且用户没给报表 URL/ID？
        └── 兜底调一次 `search_game`，0 结果即放弃，不要循环试错
```

---

## 📋 前置条件

| 变量名                      | 是否必填 | 说明                                          |
|--------------------------|------|---------------------------------------------|
| `DATABRAIN_TOKEN`        | 必填   | 认证 token 原始值（**不含** `Bearer ` 前缀），由上层服务动态传入 |
| `DATABRAIN_HOST`         | 必填   | API 主机地址，由上层服务动态传入                          |
| `DATABRAIN_DISPLAY_HOST` | 必填   | 系统链接展示域名                                    |

### MCP 知识库配置

| 配置项            | 值                                                        | 说明            |
|----------------|----------------------------------------------------------|---------------|
| 知识库检索方式 | 通过 Datalab 后端代理（`/api/v1/datalab/skill/knot_search`） | 后端根据 game_code 自动从七彩石获取对应 knot_uuid |
| 认证方式 | 复用 DATABRAIN_TOKEN（Bearer 认证透传） | 无需额外配置 Knot Token |

### 🎯 MCP 知识库接入游戏白名单

| game_code 前缀 | MCP 知识库 | 分析路径                       |
|:-------------|:-------:|:---------------------------|
| `gst`        |  ✅ 已接入  | **知识库增强分析**（MCP 检索 + 报表数据） |
| 其他           |  未接入  | **标准数据分析**（仅报表数据，跳过 MCP）   |

**判断规则**：从 `agent_context.dashboard_game_code_and_filters[<name>].game_code` 取值；`gst*` 走路径 A（MCP 前置），其他白名单游戏走路径 B（标准）。唯一例外：用户直接给了报表 URL/ID → 路径 C，不走 MCP。

---

## Agent 行为准则

### 🔴 核心禁令（数据正确性硬约束）

**调用方式**：

- Agent 自己写 `curl`/`requests.post`/`subprocess` 代码调 API（必须通过 `python scripts/call_api.py`）
- 多轮逐个执行 chart_data（用 full_report 批量获取；如只需部分图表，传 `--chart_ids` 指定）

**筛选器拼接（直接影响返回数据正确性，必须遵守）**：

- 猜测 filter column 名（必须从 `dashboard_overview.available_filters[].column` 获取）
- 猜测 filter value 值（必须从 `available_filters[].available_values` 中匹配，不得自行编造值）
- **反向匹配**：不得因为 `available_values` 中含某个值就自动添加该筛选器；筛选器使用必须由**用户明确意图**驱动
- **强行拼接报表不存在的筛选器**：只使用 `available_filters` 中存在的 column；匹配不上就不加
- **循环试错**：不得对同一个不存在的筛选器尝试多种 column 名变体（country → region → geo → ...），一次失败即放弃，先不带该条件查询，再从返回数据中筛选

**数据真实性（零容忍）**：

- 编造/捏造任何数值、指标、日期、趋势
- 输出未从 `call_api.py` 返回 JSON 中读到的数据；所有数字必须有原始出处
- 数据不完整时推断、补全或捏造数值
- 探索性代码（`print(data.keys())`）/ 自行 groupBy 求和求平均（这会改变数据含义）
- **去掉负号**：负数必须保留负号原样（如 `-3.2%`、`-$1,200`），不得 abs 或省略
- ✅ 查询返回 0 行 / 异常 → 必须如实说明"未查到数据"，不得虚构内容
- ✅ `available_values` 是参考值（截断 ≤100 个），不代表全量；用户明确指定的值即使不在列表里也可尝试


### 🚀 性能优化规则

1. 所有 API 调用必须通过 `python scripts/call_api.py <action>` 完成
2. 用 `full_report` 一次完成 report_log + overview + dashboard_data
3. 不要重复调用同一个 API；错误不要重试超过 1 次
4. 空值防御：API 返回数组中的元素可能为 `None`，遍历时 `if item is not None`

### 🎯 模糊查询自动选择规则

| 场景                        | 行为                                       |
|---------------------------|------------------------------------------|
| 明确报表链接 URL / dashboard_id | 直接 `full_report`                         |
| `报表id@图表id` 引用（chart_refs） | 直接 `full_report --chart_refs`（自动解析）     |
| 报表名称（如"5_4 合抢玩法参与"）       | 搜索确认后直接获取                                |
| gst 游戏 + 指标/关键词           | **先查 MCP 知识库** → 用知识库推荐的报表 → full_report |
| 非 gst 白名单游戏 + 指标/关键词       | **自动选第一个匹配报表**，末尾提示其他                    |
| 模糊描述（如"看下用户数据"）           | gst 走 MCP 前置；其他自动选第一个                    |

**选择优先级**（gst 游戏）：MCP 知识库推荐 > 名称完全匹配 > 图表数量更多 > 搜索排序靠前
**选择优先级**（非 gst）：名称完全匹配 > 图表数量更多 > 搜索排序靠前

特殊情况：搜索 0 结果 → `dashboard_list` 翻页；用户说"换一个" → 选下一个；用户说"全部" → 逐个执行，超 3 个提示分批。

---

## 🔌 接口清单

| # | 接口                                            | 用途                             |
|:-:|-----------------------------------------------|--------------------------------|
| 0 | report_log                                    | Agent 内部静默调用，**不要向用户提及**       |
| 1 | knot_search (Datalab 代理)                      | 知识库语义检索（需要 game_code）          |
| 2 | search_game                                   | 业务名称模糊搜索 → game_code           |
| 3 | dashboard_list                                | 报表列表（分页）                       |
| 4 | dashboard_search                              | 关键词搜索报表                        |
| 5 | dashboard_overview                            | 报表结构（图表列表 + 筛选器），**获取数据前必须先调** |
| 6 | chart_data                                    | 单图表数据（支持筛选 + 聚合）               |
| 7 | dashboard_data                                | 报表图表数据（支持 `chart_ids` / `chart_refs` 指定图表，不传则全量） |
| 8 | parse_refs                                    | 🆕 本地解析 `报表id@图表id` 引用列表（不调 API） |
| 9 | multi_report                                  | 🆕 多报表批量查询：chart_refs 含多个 dashboard 时自动循环 |

所有 HTTP 接口：`Authorization: Bearer $DATABRAIN_TOKEN`，Base URL: `${DATABRAIN_HOST}`

---

## ⏱️ 理想执行路径

> game_code 默认来自 `agent_context.dashboard_game_code_and_filters`（§0.2）。

#### 路径 A: gst 游戏 + 关键词（目标 ≤5 轮）— MCP 知识库前置

```
轮次 1: read_file SKILL.md（首次进入）
轮次 2: knot_search（用 agent_context 里的 game_code，用户问题作 query；获取报表信息 + 业务知识）
轮次 3: 根据 MCP 结果 + dashboard_search 定位报表 → dashboard_overview
轮次 4: full_report（获取数据）
轮次 5: 输出"知识 + 数据"融合的结构化结果（格式由 summarize 收尾）
```

> **路径 A 核心逻辑**：MCP 知识库先行，用知识库返回的报表信息指导报表选择，而非盲目搜索后再补充知识。

#### 路径 B: 白名单非 gst 游戏 + dashboard-service 兜底场景（目标 ≤4 轮）

```
轮次 1: read_file SKILL.md（首次进入）
轮次 2: dashboard_search（用 agent_context 里的 game_code）
轮次 3: dashboard_overview（最多并行 5 个）→ 自动选择 → full_report
轮次 4: 输出结构化数据分析结果
```

#### 路径 C: 直接给报表 ID/URL（目标 ≤2 轮）

```
轮次 1: read_file SKILL.md（首次进入）
轮次 2: full_report（不走 MCP）
```

#### 路径 D: 纯知识查询（目标 ≤3 轮）

```
轮次 1: read_file SKILL.md（首次进入）
轮次 2: gst → knot_search；非 gst → references/
轮次 3: 输出知识解答
```

---

## 📖 完整使用流程

### 🚀 最常用：用户给了报表链接/ID

```bash
python scripts/call_api.py full_report \
  --dashboard_id "c1ef70ac094263d1e8cd06ade2876b31" \
  --question "分析报表"
```

**full_report 返回结构**（stdout JSON）：

```json
{
  "steps": [
    {
      "step": "report_log"
    },
    {
      "step": "dashboard_overview"
    },
    {
      "step": "dashboard_data"
    }
  ],
  "overview": {
    "dashboard": {},
    "charts_summary": [],
    "available_filters": []
  },
  "data": {
    "dashboard": {},
    "charts": []
  },
  "validation": {
    "all_charts_received": true,
    "charts_status": []
  }
}
```

> `validation.all_charts_received`: `true` → 直接生成报告；`false` → 降级逐图 chart_data

### Step 1：game_code 获取

从 `agent_context.dashboard_game_code_and_filters[<game_name>].game_code` 直接取值。仅在 agent_context 缺失或业务名找不到时，兜底执行：`python scripts/call_api.py search_game --game_name "<名称>" --top 3`（不区分大小写，0 结果即放弃，不要改大小写重试）。

### Step 2：知识库检索（仅 gst 游戏，前置执行）

> ⚠️ **gst 游戏必须先查 MCP 知识库**，用知识库返回的报表信息指导后续报表选择和数据分析。

通过 Datalab 后端代理调用 Knot MCP 知识库（后端自动根据 game_code 从七彩石获取对应 knot_uuid）：

```bash
python scripts/call_api.py knot_search --game_code "gstm" --query "留存下降 归因分析 原因" --top_k 5
```

**MCP 检索结果中可能包含**：

- 相关报表名称/ID → 直接用于 full_report
- 指标定义和计算口径 → 融入分析报告
- 归因方法论/最佳实践 → 指导分析方向
- 业务基准值 → 用于异常判断

**🏷️ MCP 状态 Tag**（自动化测试用，后期可移除）：`knot_search` 返回的 `_mcp_status` 字段标识 MCP 请求是否成功。脚本会在 JSON
输出前通过 **stderr** 打印状态行：

- 成功：`[MCP_OK] MCP 知识库请求成功`
- 失败：`[MCP_FAIL] MCP 知识库请求失败原因`

自动化测试脚本可捕获 stderr 第一行判断 MCP 连通性。

### Step 3：报表发现 + 数据获取

```bash
# 3.1 若 MCP 返回了报表信息，优先使用；否则用关键词搜索
python scripts/call_api.py dashboard_search --game_code "gstm" --keyword "留存"
# 3.2 获取结构
python scripts/call_api.py dashboard_overview --dashboard_id "<id>"
# 3.3 获取数据
python scripts/call_api.py full_report --dashboard_id "<id>" --question "用户的问题"
```

### 单图表查询（带筛选和聚合）

```bash
python scripts/call_api.py chart_data \
  --dashboard_id "<dashboard_id>" \
  --chart_id "<chart_id>" \
  --filters '[{"column":"dtstatdate","operation":"between","value":["2026-03-11","2026-03-17"]}]' \
  --aggregation '{"enabled":true,"group_by":["date"],"metrics_agg":"sum","top_n":50}'
```

### 🔑 Filters 参数格式详解

> ⚠️ **筛选器拼接原则（必须遵守）**：
> 1. **只拼用户明确提及的维度**：先从用户问题中提取筛选意图（如"安卓"→系统、"东南亚服"→区服），再与 `available_filters[].column` + `filter_name` 做匹配，能匹配上的才加入 filters
> 2. **禁止反向匹配**：❌ 不得因为某个筛选器的 `available_values` 中恰好包含某个值（如数字"1"），就反向推断用户想筛选该维度。筛选器的使用必须由**用户意图驱动**，而非由可选值驱动
> 3. **匹配不上就不加**：如果用户提到的维度在 `available_filters` 中找不到对应 column，**不要强行拼接**，也不要反复尝试不同写法
> 4. **利用 `available_values` 精准匹配值**：确定要使用某个筛选器后，再从其 `available_values` 中选取与用户描述最匹配的值。注意：这一步是"确定用哪个筛选器"之后的值选择，不是用来决定"是否使用该筛选器"
> 5. **从返回数据中筛选**：匹配不到筛选器时，先不带该条件查询，再从返回的数据中查看是否有符合用户要求的数据行
> 6. **禁止循环试错**：不得对同一个不存在的筛选器尝试多种 column 名变体（如 country → region → geo → ...），一次匹配不上即放弃
>
> 💡 **正确的筛选器决策流程**：
> ```
> 用户问题 → 提取筛选意图关键词 → 与 filter_name/column 匹配 → 确定使用哪些筛选器 → 从 available_values 选值
> ```
> **错误的决策流程**（禁止）：
> ```
> 遍历所有 available_values → 发现某个值像是和用户问题有关 → 自动添加该筛选器
> ```

**`available_filters` 返回结构**（dashboard_overview / full_report 返回）：

```json
{
  "filter_name": "国家",              // 筛选器显示名称
  "column": "country",               // 字段名（构造 filter 时使用此值）
  "column_type": "string",           // 字段类型：date / string / number
  "available_values": ["CN", "US", "JP", "KR", "TW"],  // ⭐ 参考值列表（有截断，非全量；string 类型有值）
  "current_value": ["所有国家"],       // 当前默认值
  "date_type": "",                   // 仅日期类型有值（day/week/month）
  "description": "按国家筛选数据"       // 筛选器描述
}
```

> 💡 **`available_values` 使用指南**：
> - ⚠️ **`available_values` 仅为参考值，非全量数据**：由于数据量可能很大，返回的可选值列表经过截断（最多 100 个），不代表该字段的所有可能值
> - `available_values` 的用途是**帮你了解该字段的值长什么样、格式是怎样的**，而不是作为唯一可选范围
> - 只有当你已经确认用户意图涉及某个筛选维度时，才参考 `available_values` 来确定值的格式和写法
> - date 类型筛选器没有 `available_values`，直接使用用户指定的日期范围
>
> 📐 **匹配精度三级判断**（按优先级从高到低）：
>
> | 级别 | 条件 | 处理方式 | 示例 |
> |------|------|----------|------|
> | ✅ 精准命中 | 用户描述与 `available_values` 中的值**完全一致或一一对应** | 直接使用原始值 | 用户说"安卓" → `available_values` 含"安卓" → 用"安卓" |
> | ⚠️ 模糊但可信 | 用户描述是某个值的**同义词/别名/翻译**，且该筛选器维度与用户意图**完全吻合** | 使用匹配到的原始值 | 用户说"Android" → `filter_name`="系统"，`available_values` 含"安卓" → 用"安卓" |
> | 似是而非 | 用户描述与某值**语义相关但不等价**，或用户描述的**粒度/维度与筛选器不同** | **不使用该筛选器**，改为从返回数据中分析 | 用户说"泰国" → `filter_name`="区服"，`available_values` 含"东南亚服" → 不等价，不加 |
>
> 💡 **"似是而非"的判断标准**：
> - 用户的描述和可选值不在同一粒度（如"泰国"是国家粒度，"东南亚服"是区服粒度）→
> - 用户的描述只是可选值的一个子集/部分含义（如"新手"只是"1-10级"的子集）→
> - 用户的描述需要额外推理/假设才能对应到某个值 →
> - 只有**直接对等、无需推理**的匹配才是合法匹配 ✅
>
> 🔄 **匹配失败的降级策略**：
> - 匹配失败但用户明确指定了值 → 可以参考 `available_values` 的格式规律，用用户描述的值直接尝试（因为列表有截断，用户要的值可能存在但未返回）
> - 匹配失败且无法推断格式 → 不添加该筛选条件，先不带该筛选查询数据，再从返回结果中人工筛选
>
> ⚠️ **反向匹配陷阱（必须避免）**：
> - 用户说"近一周角色升级" → 只需加日期筛选，**不要**因为"注册天数"筛选器有 `available_values: ["1","2","3"...]` 就自动加上 `注册天数=1`
> - 用户说"哪个等级人数最多" → 这是对返回数据的分析需求，**不是**筛选条件
> - 判断标准：用户是否**明确指定了某个维度的具体值**？如"安卓系统"（明确指定系统=安卓）✅ vs "升级情况"（没有指定注册天数）❌

**请求结构体定义**（每个 filter 对象）：

```json
{
  "column": "字段名",
  // 必填，从 available_filters[].column 获取
  "operation": "操作符",
  // 必填，见下表
  "value": []
  // 必填，始终是数组（即使只有一个值），值从 available_values 中选取
}
```

> 🚨 **`value` 字段始终是数组 `[]`**，无论任何 operation，都不能传单个值（如 `"value": "2026-03-11"`）
>
> 💡 **数字类型兼容**：数值型 value 传数字 `[100]` 或字符串 `["100"]` 均可，底层通过 `AnyToString()` 自动转换。推荐直接传数字字面量（无引号）。

**各操作符对应的 value 格式**：

| operation        | 说明         | value 格式               | 示例                             |
|------------------|------------|------------------------|--------------------------------|
| `between`        | 区间（日期/数值）  | `[起始值, 结束值]`（长度必须=2）   | `["2026-03-11", "2026-03-17"]` |
| `include`        | 包含（IN）     | `[值1, 值2, ...]`（1~N 个） | `["CN", "US", "JP"]`           |
| `exclude`        | 排除（NOT IN） | `[值1, 值2, ...]`（1~N 个） | `["bot", "test"]`              |
| `greater`        | 大于         | `[阈值]`（长度=1）           | `[100]`                        |
| `less`           | 小于         | `[阈值]`（长度=1）           | `[50]`                         |
| `greaterOrEqual` | 大于等于       | `[阈值]`（长度=1）           | `[0]`                          |
| `lessOrEqual`    | 小于等于       | `[阈值]`（长度=1）           | `[1000]`                       |
| `equal`          | 等于         | `[值]`（长度=1）            | `["active"]`                   |
| `notEqual`       | 不等于        | `[值]`（长度=1）            | `["deleted"]`                  |
| `notNull`        | 非空         | `[]`（空数组）              | `[]`                           |
| `null`           | 为空         | `[]`（空数组）              | `[]`                           |

**日期筛选示例**（最常见场景）：

```json
[
  {
    "column": "dtstatdate",
    "operation": "between",
    "value": [
      "2026-05-13",
      "2026-05-19"
    ]
  }
]
```

**多条件筛选示例**：

```json
[
  {
    "column": "dtstatdate",
    "operation": "between",
    "value": [
      "2026-05-13",
      "2026-05-19"
    ]
  },
  {
    "column": "country",
    "operation": "include",
    "value": [
      "CN",
      "US"
    ]
  },
  {
    "column": "level",
    "operation": "greaterOrEqual",
    "value": [
      10
    ]
  }
]
```

### 聚合参数格式

```json
{
  "enabled": true,
  // 是否启用聚合，默认 false
  "group_by": [
    "date"
  ],
  // 聚合维度列表（字段名数组）
  "metrics_agg": "sum",
  // 指标聚合方式：sum / avg / max / min
  "top_n": 50,
  // 返回前 N 条，默认 50，最大 200
  "sort_by": "字段名",
  // 排序字段（可选）
  "sort_order": "desc"
  // asc / desc（可选）
}
```

---

## 错误处理

| 错误场景              | 处理方式                    |
|-------------------|-------------------------|
| 非白名单游戏            | 跳过 MCP，走标准数据分析          |
| knot_search 失败    | 提示知识库暂时不可用，继续走标准数据分析 |
| 知识库无结果            | references 兜底 + 报表数据    |
| HTTP 401/403      | 提示检查认证配置                |
| HTTP 500          | 提示稍后重试                  |
| 超时（检索>15s/数据>90s） | 取消 + references 兜底      |
| game_code 搜索无结果   | 提示确认名称                  |
| row_count=0       | 展示"暂无数据"                |

---

## 📊 图表类型与数据结构映射

> 详细映射见 [`references/chart_data_mapping.md`](references/chart_data_mapping.md)，以下是速查表。

| chart_type             | 核心数据字段                                         | 取值方式                        |
|------------------------|------------------------------------------------|-----------------------------|
| `LineChart`            | `line_chart.series_data[].data[]`              | X轴: `x_axis_data[]`         |
| `Table`                | `table_data[]`                                 | 每行: `{列名: {value: "值"}}`    |
| `BarChart`             | `bar_charts.series_data[].data[]`              | X轴: `x_axis_data[]`         |
| `BigNumberChart`       | `big_number_chart.value`                       | 对比: `time_comparisons[]`    |
| `StackBarChart`        | `stack_bar_chart.series_data[]` + `table_data` |                             |
| `PieChart`             | `chart_sum_data[0].指标名[]`                      | ⚠️ 必须 `if item is not None` |
| `EventLineChart`       | `event_line_chart` + `event_list`              |                             |
| `HorizontalBarChart`   | `horizontal_bar_charts[].series[].data[]`      |                             |
| `TrendChart`           | `trend_metric`(大数字) + `line_chart`(趋势)         |                             |
| `MixedChart`           | `mixed_chart.series_data[]`                    |                             |
| `Map`                  | `map_charts[].map_chart_value[]`               |                             |
| `WordCloud`            | `word_cloud.data[]`                            |                             |
| `DimTrend`             | `trend_metric` + `line_chart` + `dimension`    |                             |
| `PercentStackBarChart` | `percent_stack_bar_chart` + `table_data`       |                             |

> 完整字段结构、Series 通用格式、详细展示规范 → [`references/chart_data_mapping.md`](references/chart_data_mapping.md)

---

## 📊 输出形态（仅数据正确性约束 · 格式由 summarize 收尾）

> 用户最终看到的 Markdown / 标题 / emoji / 章节骨架 / 字段简化引用块 / 报告开头格式 / 表格分块**全部由 `databrain-summarize` 在 phase B 决定**（参考 `markdown_layout.md` / `simple.md` / `complete.md`）。本 skill 在 phase A 只输出"数据正确"的中间产物，不强制格式模板。

### 数据正确性硬约束（违反即视为输出错误）

| #  | 约束项     | 要求                                                                              |
|:--:|---------|---------------------------------------------------------------------------------|
| 1  | 数据来源    | 所有数值/日期/趋势必须能在 `call_api.py` 返回 JSON 中找到原始出处；找不到就说"未查到"，不得编造                  |
| 2  | 零值/空数据  | 全 0 行可隐藏（避免噪声），空 row_count 必须如实说明"暂无数据"，不得静默删除整图                              |
| 3  | 负号保留    | 负数原样展示（如 `-3.2%`、`-$1,200`），禁止取绝对值或省略 `-`                                      |
| 4  | 不自行聚合   | 不得 groupBy / 求和求平均改变数据含义；如需聚合，通过 `chart_data --aggregation` 让后端做                |
| 5  | 不反向匹配筛选器 | 不因 `available_values` 中存在某值就自动加该筛选器；筛选器使用必须由用户明确意图驱动                          |
| 6  | 不强拼不存在筛选器 | 用户提到的维度在 `available_filters` 中找不到 column → 不加该筛选；先不带条件查询，再从返回行中筛                |
| 7  | 数据完整性    | 数据不完整时不推断/补全；如某 chart 数据缺失，明确指出哪个图表缺失而非编造                                       |
| 8  | 内部细节不外泄  | 不主动向用户提"打点/上报/记录日志/report_log"；这些是 phase A 内部行为                                |

> 完整图表字段结构与各图表类型字段映射仍可参考 [`references/chart_data_mapping.md`](references/chart_data_mapping.md)（仅作字段映射参考，不再强制 emoji / 章节标题 / 字段简化引用块格式）。

---

## 📚 知识库参考

Agent 执行时可按需加载 `references/` 下的文件（仅作字段/参数/术语参考，不再约束输出格式）：

| 文件                      | 用途                        |
|-------------------------|---------------------------|
| `chart_data_mapping.md` | 图表类型完整字段映射（取数用，不约束格式）     |
| `query_examples.md`     | 用户提问示例 & 参数拼接指南           |
| `metrics_dictionary.md` | 英文字段名 → 中文翻译              |
| `chart_types.md`        | 图表类型说明（取数用）               |
| `filter_operations.md`  | 筛选操作符详解                   |
| `business_glossary.md`  | 业务术语解释                    |
| `common_issues.md`      | 常见问题排查                    |

> ⚠️ `output_example.md` 已不再作为输出强制模板（输出由 `databrain-summarize` 决定），保留仅供历史参考。

**与其他 Skill 的协作**：

- **首选经分查询** → `databrain-dashboard-service`（本 skill 是 dashboard-service 的兜底，不是替代）
- **非白名单游戏指标** → `databrain-intelligence`
---