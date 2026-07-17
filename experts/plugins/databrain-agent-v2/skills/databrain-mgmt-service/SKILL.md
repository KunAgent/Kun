---
name: databrain-mgmt-service
display_name_en: Management Analytics
display_name_zh: 管理层数据分析
description: Query DataBrain Management (MGMT/管理) data for users with MGMT permission — IEGG / publishing / studio / project commercialization and management metrics including revenue (收入/流水), profit (利润), market cost / 市场成本 / 营销成本 / 市场费用, R&D cost / 研发成本, KPI / 目标, forecast / 预估 / 预测, headcount / HC / 人力, human-resource risk / 人力风险, budget application / 市场预算申请, decision point / 管理决议, risks & opportunities / 风险与机会, project calendar / 项目日历, and milestones (Soft Launch / Global Launch / Early Access).
when_to_use: Use only when `agent_context.has_mgmt_permission=true` (or the host prompt says the user has MGMT permission). REQUIRED then for IEGG overall / publishing management / studio management / single project management & finance questions — revenue, gross revenue, net profit, 市场成本 / 营销成本 / 市场费用, market cost, R&D cost, KPI / 目标, forecast / 预估, headcount, 人力风险, budget application status / 预算申请状态, decision point / 管理决议, risks & opportunities / 风险与机会, project calendar, milestones, top/key projects, top studios, or IEGG-owned projects/games. If `has_mgmt_permission=false`, do NOT use this skill; route to another applicable skill. Dashboard permission is unrelated to MGMT. **Granularity limitation** MGMT data do not support **daily-level** revenue/sales data, route to `databrain-dashboard-service` using daily granularity if has dashboard permission.
---

# Skill: Management Analytics (MGMT 管理层数据分析)

## Environment Variables (Required)

| 变量名 | 是否必填 | 说明 |
|--------|----------|------|
| `DATABRAIN_TOKEN` | 必填 | 认证 token（不含 `Bearer ` 前缀） |
| `DATABRAIN_HOST` | 必填 | API 主机地址 |
| `DATABRAIN_DISPLAY_HOST` | 可选 | 系统链接展示域名 |

## 0. Skill Scope

- **This skill** queries MGMT data only: IEGG overall, studio, publishing, project/game management and commercialization metrics.
- Use for: gross revenue / 收入 / 流水, net profit / 利润, KPI / 目标 / 完成率, forecast / 预估 / 预测, **market cost / 市场成本 / 营销成本 / 市场费用**, R&D cost / 研发成本, headcount / HC / 人力, decision point / 管理决议, project calendar / 项目日历, milestones / 里程碑.
- **Dashboard permission (`dashboard_white_games`) is unrelated to MGMT.** Use this skill even when the project is missing from `dashboard_white_games`.
- Do **not** use this skill for Dashboard first-party game-operation drilldowns: DAU, retention, country, zone, channel, platform, feature metrics.
- **Granularity**: MGMT only supports **monthly** and **yearly** granularity. For **daily-level** revenue/sales queries (e.g. "截止2025-07-17的累计收入", a specific date's revenue), use `databrain-dashboard-service` instead.
- Never expose internal routing labels or runtime context IDs in user-facing responses unless the tool output itself includes them.
- **Hard tool constraint for MGMT queries:** only use `run_skill_script` with `skills/databrain-mgmt-service/scripts/run_tool.py` and the MGMT tools exposed there. Do not use `write_file`, `execute_sandbox_code`, custom scripts, raw backend API calls, or sandbox code to work around unsupported MGMT metrics.
- If a requested MGMT metric is unavailable and you use a substitute metric, the final answer must first include (A) 指标差异提示, and any TopN title must name the substitute metric sorting口径 rather than the unavailable metric.

## Module Mapping

- IEGG overall KPI → `module="business"`
- Studio overall KPI → `module="all_studio"`
- Single studio KPI → `module="studio"`
- Publishing overall KPI → `module="publishing"`
- Single project/game KPI → `module="project"`

## 1. How to Call Tools

```text
run_skill_script(
  script_path="skills/databrain-mgmt-service/scripts/run_tool.py",
  cli_args=["--tool", "<tool_name>", "--param1", "value1", ...]
)
```

Rules:
- `--tool` is required.
- Dates must use `YYYY-MM-DD`.
- List/dict values must be JSON strings.
- Argument names must exactly match the signatures below; unsupported args are ignored by `run_tool.py`.
- Do **not** pass `studio_id`, `combine_id`, or other entity IDs manually. MGMT tools read IDs from runtime context.
- Each failed tool call may be retried at most once. Do not retry permission/auth failures.
- Always respect explicit user requirements such as exact metrics, granularity, filters, and time range.
- If argument construction fails, read the corresponding `reference/*.md` before retrying.
- For MGMT data access, only call `skills/databrain-mgmt-service/scripts/run_tool.py`. Do not write ad-hoc debug scripts, do not call backend APIs directly from generated code, and do not use `write_file`/`run_skill_script` to bypass MGMT tools.

## 2. Tool Inventory & Signatures

### 2.1 `mgmt_metrics_query_tool`

Query MGMT metric values for IEGG/studio/publishing/project management data.

```text
start_date: str          # YYYY-MM-DD
end_date: str            # YYYY-MM-DD
metrics: list[str]       # MGMT metric_code list; source of truth is runtime metric map API
module: str              # business|all_studio|studio|publishing|project
```

Use for normal metric queries: revenue, profit, KPI, forecast, cost, headcount, decision point.

Critical rules:
- `metrics` must be valid MGMT `metric_code`. Do not guess or translate metric names into fabricated codes.
- If unsure, call `mgmt_metric_map_tool` to inspect the current user's API-backed metric map, then read `reference/mgmt_metrics_query_tool.md` for parameter rules.
- Do not pass IDs. `studio_id` / `combine_id` are auto-injected from context.
- For TopN follow-up questions, call this tool only once with the correct `module`; IDs from previous TopN are already in context.
- For management decisions, use `metrics=["decision_point"]`; the tool handles that metric specially.

### 2.2 `mgmt_topn_query_tool`

Rank studios or projects by revenue/profit/KPI/headcount/forecast metrics.

```text
start_date: str
end_date: str
order_metric_obj: dict   # {"order_metric":"...", "order_by":"...", "order":"desc|asc"}
query_metrics: list[str]
module: str              # studio|project only
top_num: int = 10
data_source: str|null    # only for module=project: studio|publishing|dev
```

Use for:
- Top N studios/projects by metric.
- Broad queries like “各个/每个/所有/全部 studio/project” to narrow scope to Top10 first.

TopN rules:
- Use the user's requested `top_num` exactly. Do not expand to Top10/Top30 unless the user asked for that size.
- Leave `data_source` empty unless the user explicitly asks for studio-issued projects, publishing/self-publishing projects, or dev/in-development projects.
- “Most popular / 最热门 / 最受欢迎 games” without IEGG is usually an intelligence question. Only when the query explicitly says IEGG / IEGG games / IEGG 项目, answer via MGMT as project ranking by `gross_revenue_actual` by default, unless the user specifies another MGMT ranking metric.
- Revenue YoY / 同比增长率 ranking:
  - For “实际收入同比增长率排行榜 / revenue YoY ranking”, use `order_metric_obj={"order_metric":"gross_revenue_actual","order_by":"yoy","order":"desc"}`.
  - Do not rank by `gross_revenue_actual` absolute value and then re-sort only the returned TopN by YoY; that is not a global YoY ranking.

### 2.3 `mgmt_milestones_query_tool`

Query IEGG project milestones such as Soft Launch / Global Launch / Early Access, Gate Review (GR) meetings, Check-in meetings, etc.

```text
start_date: str          # YYYY-MM-DD
end_date: str            # YYYY-MM-DD
type: str = "all"        # "launch" | "gr" | "checkin" | "all"
```

Use only for IEGG project/game milestone questions. For external/competitor launch dates, do not call this tool.

`type` parameter — choose by user intent:
- `"launch"` for launch / soft-launch / global-launch / EA / 公测 / 上线时间 / 即将上线 / 最近上线 questions.
- `"gr"` for Gate Review / 管理层评审 / Go/No-Go / 预算审批 / 阶段评审 / 立项评审 questions (GR meetings where GMs and Michelle make Go/No-Go decisions, approve the next GR's budget, and align on the next GR's deliverables and focus).
- `"checkin"` for check-in / 项目同步会 / 进展同步会 / mandate 变更 / 项目授权变更 / mandate change questions (Check-in meetings reviewing updates in specific areas and confirming/discussing changes to the project mandate).
- `"all"` (default) when the user asks broadly without specifying a category.

## 3. Module Selection Rules

Runtime may inject higher-priority MGMT module rules from `agent_context`. If a runtime rule conflicts with the baseline below, follow the runtime rule.

Baseline:
- IEGG overall KPI -> `module="business"`
- All studios overall KPI -> `module="all_studio"`
- Single studio KPI -> `module="studio"`
- Publishing overall KPI -> `module="publishing"`
- Single project/game KPI -> `module="project"`

Important:
- If a project entity is recognized in context, project-level revenue/profit/KPI/forecast queries should use `project`.
- If a studio/company entity is recognized in context, studio-level metrics should use `studio`.
- IEGG Central Publishing / Central Publishing / 中央发行 usually uses `project`.
- Functional Support / 职能支持 usually uses `studio`.

## 4. Metric Selection Rules

- Always use real `metric_code`; do not invent codes.
- The full metric list below is generated from MGMT metric map API. Do not edit the generated table by hand.
- Actual metrics are preferred when the user does not specify actual/forecast/KPI.
- Forecast metrics are used only when the user asks forecast / predicted / 预估 / 预测.
- KPI metrics are used only when the user asks target / KPI / 目标 / 完成率.
- Common direct mappings:
  - 市场成本实际值 / actual market cost -> `mkt_cost_actual`
  - 市场成本预测值 / forecast market cost -> `mkt_cost_forecast`
  - 市场成本目标值 / KPI/target market cost -> `mkt_cost_kpi`
  - 实际收入 / actual gross revenue -> `gross_revenue_actual`
  - 预测收入 / forecast gross revenue -> `gross_revenue_forecast`
  - 收入目标 / revenue KPI -> `gross_revenue_kpi`
  - 实际利润 / actual net profit -> `net_profit_actual`
  - 预测利润 / forecast net profit -> `net_profit_forecast`
  - 利润目标 / profit KPI -> `net_profit_kpi`
  - 盈余/赤字 / profit surplus or deficit -> `net_profit_profit_loss`
  - 实际研发成本 / actual development cost -> `total_dev_costs_actual`
  - 预估总研发成本 / estimated total dev cost -> `estimated_total_dev_cost`
  - 批准总研发成本 / approved total dev cost -> `approved_total_dev_cost`
  - 市场预算申请 / marketing budget application -> `mkt_budget_application`
  - 正职人力 / regular employee headcount -> `headcount_regular`
- Do not query `gross_revenue_profit_loss` or `net_profit_profit_loss` unless the user explicitly asks surplus/deficit/盈余/赤字.
- Ratio/rate metrics and absolute-value metrics are not interchangeable.
- Requested metric unavailable / substitute metric rule:
  - If the user asks for a metric that is not present in the MGMT metric map, do not silently substitute or rename another metric as if it were the requested one.
  - You may use the closest available metric_code to satisfy the user's intent, but the final answer must follow this order:
    - **(A) 指标差异提示**: state the requested metric is unavailable in MGMT, name the substitute metric actually queried, and explain the semantic difference. Explicitly identify whether this changes a ratio/rate/percentage (%) metric into an absolute value (amount/count/value) metric.
    - **(B) 数据展示**: only after (A), show the tool-returned data.
  - In tables/charts, column headers must use the actual substitute metric name/code, not the unavailable requested metric.
  - If the user asks for TopN/ranking by an unavailable metric and you use a substitute metric, (A) must explicitly say the TopN is ranked by the substitute metric, not by the requested metric.
  - The title must be `按【替代指标】排序的TopN（替代口径）` or equivalent; do not title it as the unavailable original metric ranking.
  - If the substitute changes the ranking meaning substantially, state that MGMT cannot answer the original ranking exactly and present the substitute ranking only as a clearly labeled fallback.
  - When using a substitute TopN, preserve the order returned by `mgmt_topn_query_tool` and do not re-rank by a derived calculation unless the tool itself ranked by that metric.

### 4.1 MGMT Metric Map From API

<!-- MGMT_METRIC_MAP_START -->
Generated from MGMT metric map API. Total metrics: 27.

| metric_code | metric_name_en | metric_name_cn | metric_desc_en | metric_desc_cn | value_type | modules | granularity | unit |
|---|---|---|---|---|---|---|---|---|
| action_note_profit |  | 利润行动与说明 |  |  | Notes | all_studio,studio,project | monthly,yearly | - |
| action_note_revenue |  | 收入行动与说明 |  |  | Notes | all_studio,studio,project | monthly,yearly | - |
| approved_total_dev_cost |  | 批准总研发成本(美元) |  |  | float | project | yearly | usd |
| decision_point |  | 决策清单 |  |  | Notes | publishing,project | monthly,yearly | - |
| estimated_total_dev_cost |  | 预估总研发成本(美元) |  |  | float | project | yearly | usd |
| event |  | 事件管理 |  |  | Notes | all_studio,studio,project | monthly,yearly | - |
| gross_revenue_actual |  | 收入实际值(美元) |  |  | float | business,all_studio,studio,publishing,project | monthly | usd |
| gross_revenue_forecast |  | 收入预测值(美元) |  |  | float | business,all_studio,studio,publishing,project | yearly | usd |
| gross_revenue_kpi |  | 收入目标值(美元) |  |  | float | business,all_studio,studio,publishing,project | yearly,monthly | usd |
| gross_revenue_profit_loss |  | 盈余/赤字 |  |  | float | business,all_studio,studio,publishing,project | yearly | - |
| headcount_regular |  | 正职人力 |  |  | numerical | all_studio,studio,publishing,project | monthly | - |
| kpi_avg_headcount |  | 全年目标平均值 |  |  | Notes | publishing,project | yearly | - |
| mgt_calendar_meeting |  | 董事会治理 |  |  | Notes | all_studio,studio | monthly,yearly | - |
| milestone_headcount |  | 当前里程碑计划人数 |  |  | numerical | project | monthly | - |
| mkt_budget_application |  | 市场预算申请 |  |  | Notes | project | monthly | - |
| mkt_cost_actual |  | 市场成本实际值(美元) |  |  | float | publishing,project | monthly,yearly | usd |
| mkt_cost_forecast |  | 市场成本预测值 (美元) |  |  | float | publishing,project | yearly | usd |
| mkt_cost_kpi |  | 市场成本目标值(美元) |  |  | float | publishing,project | yearly | usd |
| net_profit_actual |  | 利润实际值(美元) |  |  | float | business,all_studio,studio,publishing,project | monthly | usd |
| net_profit_forecast |  | 利润预测值 (美元) |  |  | float | business,all_studio,studio,publishing,project | yearly | usd |
| net_profit_kpi |  | 利润目标值(美元) |  |  | float | business,all_studio,studio,publishing,project | yearly,monthly | usd |
| net_profit_profit_loss |  | 盈余/赤字 |  |  | float | business,all_studio,studio,publishing,project | yearly | - |
| opportunities_risks_profit |  | 利润机会 & 风险 |  |  | Notes | all_studio,studio,project | monthly,yearly | - |
| opportunities_risks_revenue |  | 收入机会 & 风险 |  |  | Notes | all_studio,studio,project | monthly,yearly | - |
| pipeline_calendar |  | 项目管线规划 |  |  | Notes | all_studio,studio,project | monthly,yearly | - |
| tech_other_cost |  | 技术和其他成本 |  |  | float | project | monthly | usd |
| total_dev_costs_actual |  | 实际研发成本(美元) |  |  | float | project | monthly | usd |
<!-- MGMT_METRIC_MAP_END -->

## 5. Time Extraction Rules

- Explicit year/month/range: use the first day and last day of that period. `25年` means `2025`.
- If the user does **not** specify a year, do **not** assume `2025`. Use the current year from the system prompt.
- Lifetime / since-launch range is allowed only when the user explicitly says one of: `截止`, `上线至今`, `以来`, `历史`, `since launch`, `all-time`.
- If the user does not specify a time range, treat the query as current-year-to-date: `start_date` = Jan 1 of the current year, `end_date` = yesterday.
- Examples:
  - `what is the revenue of IEGG` -> current-year-to-date, not 2025 unless current year is 2025.
  - `Fatshark 的流水是多少` -> current-year-to-date.
  - `IEGG 的利润` -> current-year-to-date.
  - `25年/2025年 ...` -> `2025-01-01` to `2025-12-31`.
- Do not infer `start_date=2000-01-01` from the metric type itself. KPI, target, revenue, R&D cost, and user metrics still use the default YTD rule unless the lifetime keywords are present.
- If a default time range returns empty data, state the searched time range and say no data was found in that range; ask the user to specify another time range.
- If an explicit full-year/range query returns no data, do not automatically retry a narrower range unless the user asked for that narrower range. Report the no-data result for the requested range.

## 6. TopN / Broad Query Rules

For “各个/每个/所有/全部/重点/核心/头部/top studio/project”:
- Do not query all studios/projects directly with `mgmt_metrics_query_tool`.
- First call `mgmt_topn_query_tool` with `top_num=10`.
- Default ranking metric: `gross_revenue_actual`, unless the user explicitly names another metric.
- After TopN, call `mgmt_metrics_query_tool` once only if the user asks for detailed metrics.
- If the TopN result itself answers the question, do not call `mgmt_metrics_query_tool` again.
- Final answer must mention that the result is limited to Top10.

## 7. Launch Milestone Time Window Rules

For `mgmt_milestones_query_tool`:
- Explicit user time window -> use it exactly.
- Specific project but no time window -> `start_date=2000-01-01`, `end_date=today+5y`.
- Upcoming / 即将上线 / about to launch without time -> `start_date=today`, `end_date=today+1y`.
- Recently launched / 最近上线 without time -> `start_date=today-1y`, `end_date=today+1y`.
- The tool returns all milestone types. In the final answer, pick the milestone type the user asked about.
- The final answer must repeat the searched `start_date` and `end_date` from tool output.

## 8. Data/Answer Rules

- Must call tools and answer from returned data. Do not answer MGMT metric questions from memory.
- Do not create custom debug scripts or raw API request scripts to work around MGMT tool limitations. If an MGMT tool or metric cannot satisfy the exact query, explain the limitation and stop.
- Do not call `execute_sandbox_code` for simple derived calculations like `net_profit / gross_revenue`; calculate from the tool output directly in the answer.
- Use tables when presenting multiple rows or metrics.
- Before presenting data, align the user request with the tool output: metric semantics, actual vs forecast, time range/granularity, scope/module, dimensions/filters, and TopN ranking basis.
- If any part is mismatched or unavailable, first state what is mismatched/unavailable, then show only the available substitute data; never present substitute data as the original requested metric.
- Only describe observable facts in tool output. Do not invent conclusions, risks, opportunities, leadership comments, or strategic suggestions.
- Include zero and negative values; never omit them.
- If data is missing/unavailable, explicitly say so and do not infer missing values. If a requested period is partially missing, name the exact missing dates/months/quarters.
- If the query asks for a total/sum over a non-full-year range but the tool returns only partial monthly data plus yearly data, do not convert yearly values into missing months. Label any total as “available monthly subtotal” and list yearly values separately as full-year reference.
- If requested and returned time ranges differ materially, state both ranges and mention MGMT data can lag by about 2 months.
- If using an alternative metric, label table/chart columns with the actual used metric name, not the unavailable requested metric.
- For TopN/ranking with a substitute metric, explicitly say the ranking is by the substitute metric, not the requested metric. If substitute changes ranking meaning substantially, say MGMT cannot answer the original TopN exactly and provide only the substitute TopN as a fallback.
- Keep currency symbols exactly as returned. For charts, use raw numeric values for data series and only format labels/tooltips.
- Do not query `gross_revenue_profit_loss` or `net_profit_profit_loss` unless the user explicitly asks surplus/deficit/盈余/赤字.
- Never output empty text.

## 9. References

Before calling tools with complex arguments, read the relevant file:

| Tool | Reference |
|---|---|
| `mgmt_metrics_query_tool` | `reference/mgmt_metrics_query_tool.md` |
| `mgmt_topn_query_tool` | `reference/mgmt_topn_query_tool.md` |
| `mgmt_milestones_query_tool` | `reference/mgmt_milestones_query_tool.md` |
| MGMT metric lookup | Runtime `mgmt_metric_map_tool` / `context.mgmt_info["metric_by_code"]` |

## 10. Runtime Metric Map

`scripts/run_tool.py` automatically calls the metric map API before MGMT data tools and stores the current user's available metrics in:

```text
context.mgmt_info["metric_by_code"]
```

If you need to inspect the current user's metric map before choosing a metric, call:

```text
run_skill_script(
  script_path="skills/databrain-mgmt-service/scripts/run_tool.py",
  cli_args=["--tool", "mgmt_metric_map_tool", "--user_query", "<user question>", "--max_items", "200"]
)
```

Use this when the requested metric is not covered by the common mappings above.
