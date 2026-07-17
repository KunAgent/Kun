---
name: databrain-dashboard-service
display_name_en: Dashboard Analytics
display_name_zh: 经分数据分析
description: Query first-party (经分) game metrics (active users, revenue, sales, retention, ARPU, CCU/PCU, ASP, refund, LTV, wishlist, game-specific feature data, ua impression, ua ctr, etc) for games with Dashboard permission. Uses real internal data,  which supports drill-down analysis across dimensions such as channel, platform(Steam, IOS, XBox, etc), product, region, bundle, country, etc. And supports real-time data.
when_to_use: Activate this skill when the user asks for first-party dashboard metrics of a specific game — active_users, revenue, sales, retention, ARPU, new_users, CCU/PCU, refund, LTV, online_time, game-specific features, ua impression, ua ctr,etc — AND the game has Dashboard permission (determined by dashboard_white_games in agent_context). For games without permission, use databrain-intelligence instead.
---

# Skill: Dashboard Analytics (经分数据分析)

## Environment Variables (Required)

| 变量名 | 是否必填 | 说明 |
|--------|----------|------|
| `DATABRAIN_TOKEN` | 必填 | 认证 token（不含 `Bearer ` 前缀） |
| `DATABRAIN_HOST` | 必填 | API 主机地址 |
| `DATABRAIN_DISPLAY_HOST` | 必填 | 系统链接展示域名 |

## 0. Skill Scope

- **This skill** → first-party dashboard data for games with Dashboard permission (dashboard_white_games)
- Games NOT in white_games → use `databrain-intelligence`
- **Miniclip games** → ONLY via MCP tools, NOT `dashboard_metrics_query_tool`
- Never expose internal routing labels (white_games etc.) in user-facing responses

## 1. Triggers

active_users, revenue, retention, ARPU, new_users, CCU/PCU/ACU, refund, LTV, online_time, churn, ASP, downloads, wishlist, crash, progression, FPS, coop, topup, realtime etc.

## 2. How to Call Tools

```
run_skill_script(
  script_path="scripts/run_tool.py",
  cli_args=["--tool", "<tool_name>", "--param1", "value1", ...]
)
```
Rules: `--tool` required; lists as JSON strings; **date format YYYYMMDD** (not YYYY-MM-DD); arg names must exactly match signature — unsupported args silently dropped.

## 3. Tool Inventory & Signatures

### 3.1 Core Tool: `dashboard_metrics_query_tool` (完整签名)

Query standard dashboard metrics (active users, churn, in-game revenue, ltv, new user, online time, realtime, refund, retention, return, login, revenue, sale, technical, wishlist, etc.).
```
game_names: List[str] = []             # game names (use "iegg" to auto-expand IEGG games)
start_date: str = None                 # YYYYMMDD. If needs information on game's release date, game event date, game version date, season start date, life cycle, and they are not provided in agent context, can use llm_websearch tool to get.
end_date: str = None                   # YYYYMMDD. If granularity is realtime, end_date should equal to start_date.
metrics: List[str] = []                # metric names (see metric rules below)
granularity: str = None                # daily|weekly|monthly|realtime. Databrain系统的weekly和monthly只支持自然周/自然月，若是任意时间的周/月需换用daily
zone: List[str] = []                   # zone/区服 filter. for example 日本服.
country: List[str] = []               # ISO country codes. 
os: List[str] = []                     # os filter, for example Steam, IOS, XBox, Android. 也支持聚合平台code：pc(所有pc平台的数据加总), mobile(所有mobile平台的数据加总), console(所有console平台的加总). Sometimes are called platform/平台/商店/store codes. 
channel: List[str] = []               # channel filter.`channel` 不要传 OS code
bundle: List[str] = []                # bundle/包体 filter
region: List[str] = []                # region/区域 filter, 不同游戏可用的region codes在'Dashboard Game Codes and Filters'中找到
lang: List[str] = []                  # language filter
category: List[str] = []              # only for pc/console games
product: List[str] = []               # only for pc/console games non-realtime sales. Sometimes are called version/版本 codes.
campaign: List[str] = []              # campaign filter (casual games only)
ua_network: List[str] = []            # UA network买量渠道 filter (casual games only)
by_country_topn_only: bool = False    # set True for 'top country''by country' breakdown
top_countries_num: int = 10           # how many countries
top_countries_rank_by_metric: List[str] = []  # explicit rank-by metric
```
Filters:
Can input only one granularity but multiple filters (zone, country, os, channel, bundle, region, lang, product, campaign, ua_network) per tool call. All filters defaults to []. If needs to group by filters, use ["255"]. 全球/全平台/所有平台数据等于total数据，也用[]。
**剔除/排除某个值（exclude）**：在某个 filter 的值前加 `!` 前缀即表示"剔除该值"，工具会查询"该维度全部值 - 被剔除值"的【汇总】（不按该维度分组）。例：`lang=["!zh"]`=除简中外所有语言汇总；`zone=["!日本服"]`=除日本服外所有区服汇总；`channel=["!Steam"]`。适用于 zone/os/channel/region/lang/category/product/bundle/campaign/ua_network（任何有按游戏枚举码表的 filter）。**country 不支持**（无法枚举全集，请改用 region 排除或显式列出国家）。同一个 filter 不要同时混用普通值和 `!` 值。

#### ⚠️ 指标选择规则（必须遵守）
1. **实时指标口径**：问实时类指标必须选择 realtime 指标，非 realtime 指标不支持 realtime 粒度。实时累计销量用 `lifetime_base_game_units_sold_after_refund_realtime`，当日实时销量用 `units_sold_after_refund_realtime`，实时累计收入用 `lifetime_revenue_after_refund_realtime`。
2. **PC/Console 累计lifetime指标 vs 日粒度**：Databrain中lifetime类指标是从上线/预购日期起的数字加和，本身就是汇总指标。如问"某天/截止某天/累计/没有提及任何时间范围的总数据" → 只查该天 lifetime 指标；"某时间范围内/近N天/某月/今年/2025年/最近/上个月" → 用日/月粒度非累计指标，然后对数据做sum。
3. **PC/console 销量口径**：用户未明确时段（如x游戏销量是多少）->默认查累计销量 `lifetime_base_game_units_sold_after_refund`（从上线/预购日期起的数字加和）；给了具体时段/日期则用 `units_sold_after_refund` + 对应粒度；若明确 DLC/版本/分产品升级销量则用 `units_sold_after_refund_for_product`；若查预购总量，需要查询从预购日期到上线日期的每日销量并计算加总。
4. **收入口径**：mobile 收入/销量有时间范围用 `pay_amount`；无时间范围用 `lifetime_pay_amount`；PC/console 收入无时段默认累计 `lifetime_revenue_after_refund`；有明确时段则用 `revenue_after_refund` + 对应粒度。**Casual 游戏收入/销量统一用 `advertisement_revenue`（广告收入）。**
5. **PCU/CCU/ACU 映射**：PCU=`peak_concurrent_users_count`，CCU/实时在线=`online_users_count_realtime`，ACU=`average_concurrent_users_count`。
6. **留存默认口径**：默认优先 new user retention（不是 active user retention），如next_day_new_users_retention_rate_daily、7_day_new_users_retention_rate_daily，加权用weighted， 如weighted_next_day_new_users_retention_rate_daily，weekly粒度用weekly指标，如next_week_new_users_retention_rate_weekly。**Casual 游戏只有 new user retention，没有 active user retention。**
7. **DAU/WAU/MAU 口径**：月峰值 DAU 才用 `peak_daily_active_users`；明确"平均"时用 `average_daily_active_users_in_week_or_month`；其余 DAU/WAU/MAU 用 `active_users_count`（按 daily/weekly/monthly 粒度）。
8. **PC/console 付费用户**：使用 `in_game_paying_users` 相关指标。
9. **在线时长/Session**：每活跃用户在线时长用 `average_online_time`；每活跃用户 session 数用 `average_session_count`。
10. **UA CTR/CVR**：用 `ua_ctr` / `ua_conversion_rate`（UA 专用语义）。
11. **TNU 映射**：TNU（total new users）对应 `lifetime_new_users_count`，某天的总新进 -> `lifetime_new_users_count`，某天的新进 -> `new_users_count`。
12. **日粒度默认时间**：未指定时间范围时，默认最近 7 天。
13. **Country/Region/Zone 选择**：查地区/国家数据优先 country code；查不到再用 region code；仅当用户明确问"区服/日服"时用 zone code。
14. **退款率口径**：无时间范围用 `lifetime_refund_rate`；有时间范围用 `refund_rate` + daily/monthly。
15. **月峰值 DAU 补充**：仅月粒度时用 `peak_daily_active_users`；非月粒度峰值 DAU 需查 `active_users_count` daily 再取 max。
16. **自然量/付费用户占比**：用 `dashboard_metrics_query_tool`，不要用 percentage tool。
17. **国家维度 Top 国家请求**：对"by country/top country/头部国家/分国家/各国/国家维度/国家分布/国家排名"类请求，必须设置 `by_country_topn_only=True`。
18. **Top 国家排序指标参数**：当用户明确表达"按某指标给国家排序"（如"按 metric_a 排的头部国家 / top countries by metric_a/top10销量国家"）时才设置 `top_countries_rank_by_metric=metric_a`；若只是查询"头部国家的 metric_a"，保持 `top_countries_rank_by_metric` 默认值，会按系统默认metric排序。
19. **默认指标兜底**：若用户未指定 metrics，或仅询问游戏总体表现，默认查询 `peak_concurrent_users_count`, `revenue`, `paying_users_count`（mobile）/`sales`（非 mobile）, `active_users_count`。
20. **PC/console 最新销量/收入**：针对刚上线3个月内的游戏问最新销量/收入，取上线以来的每日收入和截止当天的realtime lifetime sales/revenue，realtime指标可以给到最新一个小时的数字，更精准。
21. 如果用户问xx国家版的数据（包含"版"字眼），需要使用channel维度查询，不要使用by country查询。
22. 如果问有多少用户买了升级版，查该升级版的sales而不是player number。
23. 如果问游戏活跃用户表现，查日活跃DAU/月活跃MAU, 最高同时在线Peak concurrent users,平均同时在线（Average concurrent users）和 average online time.
24. 如果用户问上线以来的数据，但游戏有预购机制，则需要查询上线日期后的daily数值加总，不能使用cumulative指标，因为cumulative仅统计从预购开始的收入。
25. **Mobile LTV 默认口径**：问 mobile 游戏的 LTV 时，默认同时查询 2 日、3 日、7 日 LTV（`average_2_day_revenue_ltv_daily`、`average_3_day_revenue_ltv_daily`、`average_7_day_revenue_ltv_daily`）。
26. **Wishlist 默认口径**：问 PC/Console 游戏的 wishlist/愿望单数据时，默认同时查询 `total_wishlist_count`（愿望单总量）和 `total_wishlist_coversion_rate_daily`（愿望单转化率）。
27. **Churn 默认口径**：问流失/churn 数据时，默认同时查询 `active_users_churn_rate`（流失率）和 `active_users_churn_count`（流失人数）。
28. For other metrics not listed above, you **MUST** first read `reference/dashboard_metrics_query_tool_metric_reference.md` to look up the correct metric names. **Do NOT guess or fabricate metric names**

#### ⚠️ MCP Tool Routing Rules (when to use MCP vs metrics_query_tool)
- **MCP 适用场景**: dashboard_metrics_query_tool 不支持的特性指标（crash players count/progression 通关率/coop 联机/fps 帧数/multiple_topup 多次充值/loss rate 折损率/register 注册率/bundle 绑定数/漏斗转化率/开黑等）
- **MCP 固定两步**: (1) `dashboard_mcp_describe_data_tool(game_code=xxx)` 获取 JSON query → (2) `dashboard_mcp_read_data_tool(game_code=xxx, query=<上一步 JSON>)` 获取数据。**不要自己拼 query**。
- **崩溃**: 崩溃率/崩溃数 → `dashboard_metrics_query_tool`；崩溃**玩家数** → MCP tools
- **HOK 去小号留存**: 与 general 留存指标不同，必须走 MCP
- **HOK 注册/折损**: register 注册率/启动注册率/loss rate 折损率 → MCP
- **游戏内最畅销商品** (DL2): → MCP
- **新老玩家付费对比** (DL2): topup_by_user_type → MCP
- **上次活跃** (DLTB/DL2): last_active_day → MCP
- **FPS 帧数** (DLTB): → MCP
如果用户问了特别长尾的游戏内指标，比如某个消耗渠道，你试了MCP和databrain-datalab-analyst skill之后也都不支持，不要试图用整个游戏的数据来回答，可以告诉用户没有查到数据。

### 3.2 Other Tools (详见 reference/ 目录)

| Tool | Best For | Reference |
|---|---|---|
| `dashboard_mcp_describe_data_tool` | Discover MCP cubes/measures/dimensions (step 1) | `reference/dashboard_mcp_tools.md` |
| `dashboard_mcp_read_data_tool` | Execute MCP queries (step 2) | `reference/dashboard_mcp_tools.md` |
| `dashboard_metric_percentage_tool` | Metric % by dimension (country/os/channel) | `reference/dashboard_metric_percentage_tool.md` |
| `dashboard_metrics_query_tool` (metric lookup) | Quick metric-name lookup and mapping rules | `reference/dashboard_metrics_query_tool_metric_reference.md` |

> 📖 Before calling a 3.2 tool, read its `reference/<filename>.md` for full signature and constraints.

## 4. Key Rules

- **Permission gate**: Only for games in white_games. other games → intelligence.
- **Per-game routing**: Permission is per game, not global.
- **Game code resolution**: Resolve via `dashboard_game_code_and_filters` in context.
- **Miniclip MCP-only**: Miniclip games MUST use MCP tools only.
- **De-minor (去小号)**: NIKKE → `dashboard_metrics_query_tool`; others → MCP tools.
- **Period-over-period**: Split into two independent API calls (current + previous), then compare.
- **Derived metrics**: Use `calculation_tool` for computed values.
- **Fallback transparency**: If tool changes filters/date, explain `fallback_info`.

## 5. Cross-skill Coordination

Routing rules: see **soul.md §5**. Sentiment → `databrain-opinion-service`.

## 6. Pitfalls

- Dashboard tools for non-whitelisted games
- Mixing dashboard + third-party metrics without noting source
- `dashboard_metrics_query_tool` for Miniclip games
- Wrong granularity for realtime
- Hardcoding tokens/hosts
- Passing `game_names` to MCP tools (they need `game_code`)
- Passing `game_code` to `dashboard_metrics_query_tool` (it needs `game_names`)
- Guessing/fabricating metric names without reading `reference/dashboard_metrics_query_tool_metric_reference.md` first