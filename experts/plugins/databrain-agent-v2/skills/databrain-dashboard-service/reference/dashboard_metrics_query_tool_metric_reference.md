# dashboard_metrics_query_tool Metric Reference

This reference is extracted from `dashboard_tools/dashboard/dashboard_metrics_query_tool.py` docstring for quick metric-name lookup and argument guidance.

## Core Signature (for quick recall)

```text
game_names: List[str] = []
start_date: str = None            # YYYYMMDD
end_date: str = None              # YYYYMMDD
metrics: List[str] = []           # max 20
granularity: str = None           # daily|weekly|monthly|realtime
zone: List[str] = []
country: List[str] = []
os: List[str] = []
channel: List[str] = []
region: List[str] = []
lang: List[str] = []
category: List[str] = []
product: List[str] = []
by_country_topn_only: bool = False
top_countries_num: int = 10
top_countries_rank_by_metric: List[str] = []
```

## Important Argument Rules

- Use list args for most filters; avoid plain string for list fields.
- Date format must be `YYYYMMDD` (not `YYYY-MM-DD`).
- One granularity per call; multiple filters can be combined.
- For by-country/top-country queries, set `by_country_topn_only=True` and optionally `top_countries_num`.
- Use `top_countries_rank_by_metric` only when user explicitly asks rank-by metric.
- `product` filter only applies to **non-realtime sales** metrics.
- Daily granularity default (if period unspecified): recent 7 days.
- Filter-code discipline:
  - do not use OS codes in `channel`
  - do not use country codes in `region`

## Supported Metrics (by category)

```json
[
  {"name": "active users活跃", "metrics": ["active_users_count", "average_concurrent_users_count", "average_daily_active_users_in_week_or_month", "peak_concurrent_users_count", "peak_daily_active_users", "average_session_count", "fake_active_users_rate", "impressions_per_dau"]},
  {"name": "churn流失", "metrics": ["churn", "active_users_churn_count", "active_users_churn_rate", "next_day_new_users_churn_count_daily", "next_day_new_users_churn_rate_daily", "next_month_new_users_churn_count_monthly", "next_month_new_users_churn_rate_monthly", "next_week_new_users_churn_count_weekly", "next_week_new_users_churn_rate_weekly"]},
  {"name": "in-game revenue游戏内收入(for pc/console game)", "metrics": ["in_game_paying_users_ratio", "in_game_paying_users_count", "in_game_revenue", "lifetime_in_game_paying_users_ratio", "lifetime_in_game_paying_users_count", "lifetime_in_game_revenue"]},
  {"name": "ltv生命周期总值(for mobile game)", "metrics": ["ltv", "average_14_day_revenue_ltv_daily", "average_180_day_revenue_ltv_daily", "average_1_day_revenue_ltv_daily", "average_2_day_revenue_ltv_daily", "average_30_day_revenue_ltv_daily", "average_360_day_revenue_ltv_daily", "average_3_day_revenue_ltv_daily", "average_60_day_revenue_ltv_daily", "average_7_day_revenue_ltv_daily", "average_90_day_revenue_ltv_daily"]},
  {"name": "revenue收入(for casual game)", "metrics": ["ua_ctr", "advertisement_impressions", "advertisement_revenue", "ctr", "effective_cost_per_mille_ecpm", "impression_rate", "return_on_ad_spend_d1", "return_on_ad_spend_d14", "return_on_ad_spend_d2", "return_on_ad_spend_d3", "return_on_ad_spend_d7", "revenue_on_spend_roi", "ua_conversion_rate"]},
  {"name": "new user新进用户", "metrics": ["new_users_count", "lifetime_new_users_count", "new_users_count_online_time_over_2_hours", "advertisement_spend", "cost_per_install_cpi", "organic_new_users_ratio"]},
  {"name": "online time 在线", "metrics": ["average_online_time", "median_online_time"]},
  {"name": "realtime实时类", "metrics": ["3_day_new_users_retention_rate_realtime", "7_day_new_users_retention_rate_realtime", "active_users_count_realtime", "full_game_units_after_refund_realtime", "gross_full_game_units_realtime", "gross_revenue_after_refund_realtime", "lifetime_full_game_units_realtime", "lifetime_revenue_realtime", "revenue_after_tax_and_refund_realtime", "new_users_count_realtime", "next_day_new_users_retention_rate_realtime", "online_users_count_realtime", "refund_rate_realtime", "revenue_realtime", "steam_concurrent_users_ccu_realtime", "lifetime_base_game_gross_units_sold_realtime", "lifetime_base_game_units_sold_after_refund_realtime", "lifetime_refund_rate_realtime", "lifetime_revenue_after_refund_realtime", "units_sold_after_refund_realtime"]},
  {"name": "refund退款(for pc/console game)", "metrics": ["base_game_refund_rate", "base_game_refund_units", "lifetime_refund_rate", "refund_rate", "refund_units"]},
  {"name": "refund退款(for mobile game)", "metrics": ["paying_users_count", "paying_users_rate"]},
  {"name": "retention留存", "metrics": ["retention", "14_day_active_users_retention_rate_daily", "14_day_new_users_retention_rate_daily", "2_day_active_users_retention_rate_daily", "2_day_new_users_retention_rate_daily", "30_day_active_users_retention_rate_daily", "30_day_new_users_retention_rate_daily", "3_day_active_users_retention_rate_daily", "3_day_new_users_retention_rate_daily", "3_month_active_users_retention_rate_monthly", "3_month_new_users_retention_rate_monthly", "3_week_active_users_retention_rate_weekly", "3_week_new_users_retention_rate_weekly", "4_day_active_users_retention_rate_daily", "4_day_new_users_retention_rate_daily", "4_month_active_users_retention_rate_monthly", "4_month_new_users_retention_rate_monthly", "4_week_active_users_retention_rate_weekly", "4_week_new_users_retention_rate_weekly", "5_day_active_users_retention_rate_daily", "5_day_new_users_retention_rate_daily", "5_month_active_users_retention_rate_monthly", "5_month_new_users_retention_rate_monthly", "5_week_active_users_retention_rate_weekly", "5_week_new_users_retention_rate_weekly", "6_day_active_users_retention_rate_daily", "6_day_new_users_retention_rate_daily", "6_month_active_users_retention_rate_monthly", "6_month_new_users_retention_rate_monthly", "6_week_active_users_retention_rate_weekly", "6_week_new_users_retention_rate_weekly", "7_day_active_users_retention_rate_daily", "7_day_new_users_retention_rate_daily", "7_month_active_users_retention_rate_monthly", "7_month_new_users_retention_rate_monthly", "7_week_active_users_retention_rate_weekly", "7_week_new_users_retention_rate_weekly", "next_day_active_users_retention_rate_daily", "next_day_new_users_retention_rate_daily", "next_month_active_users_retention_rate_monthly", "next_month_new_users_retention_rate_monthly", "next_week_active_users_retention_rate_weekly", "next_week_new_users_retention_rate_weekly", "weighted_14_day_new_users_retention_rate_daily", "weighted_30_day_new_users_retention_rate_daily", "weighted_3_day_new_users_retention_rate_daily", "weighted_3_month_new_users_retention_rate_monthly", "weighted_3_week_new_users_retention_rate_weekly", "weighted_4_month_new_users_retention_rate_monthly", "weighted_4_week_new_users_retention_rate_weekly", "weighted_7_day_new_users_retention_rate_daily", "weighted_next_day_new_users_retention_rate_daily", "weighted_next_month_new_users_retention_rate_monthly", "weighted_next_week_new_users_retention_rate_weekly"]},
  {"name": "return回流", "metrics": ["return_users_count"]},
  {"name": "login登录", "metrics": ["first_login_ratio", "second_login_ratio"]},
  {"name": "revenue收入", "metrics": ["average_revenue_per_users_arpu", "average_revenue_per_paying_users_arppu", "new_user_average_revenue_per_users_arpu", "base_game_gross_revenue", "base_game_gross_revenue_ratio", "base_game_revenue_after_refund_and_tax", "gross_revenue", "lifetime_gross_revenue", "lifetime_pay_amount", "lifetime_revenue_after_refund", "new_player_pay_rate", "pay_amount", "refund_revenue", "revenue_after_refund"]},
  {"name": "sale销量(for pc/console game)", "metrics": ["average_selling_price", "base_game_average_selling_price", "units_sold_after_refund", "gross_base_game_units_sold", "gross_units_sold", "lifetime_base_game_gross_units_sold", "lifetime_base_game_units_sold_after_refund", "lifetime_gross_units_sold", "third_party_units", "units_sold_after_refund_for_product"]},
  {"name": "technical技术性能(for pc/console game)", "metrics": ["0_to_60_ms_ping_player_rate", "120_to_150_ms_ping_player_rate", "150_to_200_ms_ping_player_rate", "200_to_300_ms_ping_player_rate", "60_to_80_ms_ping_player_rate", "80_percentile_ping", "80_to_120_ms_ping_player_rate", "95_percentile_ping", "average_lowest_1_percent_fps", "crash_count", "crash_rate", "cumulative_crash_count", "mean_time_between_crashes", "median_fps", "median_ping"]},
  {"name": "wishlist 愿望单(for pc/console game)", "metrics": ["wishlist", "daily_wishlist_add_count_without_delete_purchase_gift_daily", "daily_wishlist_delete_count_daily", "lifetime_steam_wishlist_conversion_count", "lifetime_steam_wishlist_deletes", "lifetime_steam_wishlist_gifts", "lifetime_steam_wishlist_purchases_activations", "new_wishlist_add_count_daily", "lifetime_wishlist_add_count_daily", "lifetime_wishlist_count", "lifetime_wishlist_coversion_rate"]}
]
```

## IMPORTANT Metric Choice Rules

1. Realtime queries must use realtime metrics; non-realtime metrics do not support realtime granularity.  
   - 实时累计销量: `lifetime_base_game_units_sold_after_refund_realtime`  
   - 当日实时销量: `units_sold_after_refund_realtime`  
   - 实时累计收入: `lifetime_revenue_after_refund_realtime`
2. PC/console 销量：未给明确时段 → 默认累计 `lifetime_base_game_units_sold_after_refund`；给了具体时段/日期 → `units_sold_after_refund` + 对应粒度；若明确 DLC/版本/分产品升级销量 → `units_sold_after_refund_for_product`。
3. mobile 收入/销量用 `pay_amount`；PC/console 收入无时段默认累计 `lifetime_revenue_after_refund`；有明确时段则用 `revenue_after_refund` + 对应粒度。
4. PCU=`peak_concurrent_users_count`，CCU/实时在线=`online_users_count_realtime`，ACU=`average_concurrent_users_count`。
5. 留存默认优先 new user retention（不是 active user retention）。
6. 活跃相关：月峰值 DAU 才用 `peak_daily_active_users`；明确“平均”时用 `average_daily_active_users_in_week_or_month`；其余 DAU/WAU/MAU 用 `active_users_count`（按 daily/weekly/monthly 粒度）。
7. PC/console 付费用户用 `in_game_paying_users` 相关指标。
8. 每活跃用户在线时长用 `average_online_time`；每活跃用户 session 数用 `average_session_count`。
9. UA 广告点击/转化用 `ua_ctr` / `ua_conversion_rate`（UA 专用语义）。
10. TNU（total new users）对应 `lifetime_new_users_count`。
