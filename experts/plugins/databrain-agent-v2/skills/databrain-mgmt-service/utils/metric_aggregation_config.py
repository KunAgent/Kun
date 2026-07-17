from __future__ import annotations
"""
指标聚合函数配置

为每个指标配置默认的聚合函数。如果某个指标在此配置中，则使用配置的聚合函数；
否则使用传入的默认 agg_functions。

配置格式：
METRIC_AGGREGATION_FUNCTIONS = {
    "metric_name": ["mean", "min", "max", "sum"],  # 列表形式，支持的聚合函数
    "another_metric": [],  # 空列表表示不进行聚合，跳过该指标
    ...
}

支持的聚合函数：
- count: 计数
- mean: 平均值
- std: 标准差
- min: 最小值
- max: 最大值
- sum: 求和
- 百分位: "25%", "50%", "75%" 等

特殊说明：
- 如果配置为空列表 []，则该指标不会进行聚合，会被跳过
"""

METRIC_AGGREGATION_FUNCTIONS: dict[str, list[str]] = {
    # ========== 最近(max)类指标 ==========
    # units/销量/下载/用户量 - 最近
    "units": ["max", "sum", "min", "mean"],
    "est_units": ["max", "sum", "min", "mean"],
    "est_cumulative_units": ["max"],  # 累计销量 - 最近
    "cumulative_units": ["max"],
    "physical_units": ["max", "sum", "min", "mean"],
    "gsd_physicalUnits": ["max", "sum"],
    "gsd_digitalUnits": ["max", "sum"],
    "mscienceLifetimeDigitalUnits": ["max", "sum"],
    "databrain__base_game_sales_units": ["max", "sum"],
    "databrain__lifetime_base_game_sales_units": ["max", "sum"],
    "digital_cumulative_units": ["max"],
    "physical_cumulative_units": ["max"],
    "download": ["max", "sum", "min", "mean"],
    
    # revenue/收入 - 最近
    "revenue": ["max", "sum", "min", "mean"],
    "est_revenue": ["max", "sum", "min", "mean"],
    "cumulative_revenue": ["max"],
    "est_cumulative_revenue": ["max"],  # 累计收入 - 最近
    "digitalRevenue": ["max", "sum", "min", "mean"],
    "gsd_physicalRevenue": ["max", "sum", "min", "mean"],
    "gsd_digitalRevenue": ["max", "sum", "min", "mean"],
    "mscienceLifetimeDigitalRevenue": ["max"],
    "databrain__total_revenue": ["max", "sum", "min", "mean"],
    "databrain__lifetime_total_revenue": ["max"],
    "digital_cumulative_revenue": ["max"],
    "physical_cumulative_revenue": ["max"],
    
    # wishlists/followers - 最近
    "wishlists": ["max", "sum"],
    "wishlists_total": ["max"],
    "followers": ["max"],
    "steamfollowers": ["max", "sum"],
    
    # cumulative_playtime - 最近
    "cumulative_playtime": ["max"],
    
    # steamreviews - 最近
    "steamreviews": ["max"],
    
    # steam_rates - 最近,最好
    "steam_rates": ["max"],
    
    # leaderboard - 最好,最近
    "leaderboard": ["max"],
    
    # PCU - 峰值并发用户
    "pcu": ["max"],
    
    # 价格类 - 最近
    "est_price": ["max", "mean"],
    "weighted_price": [],
    "lifetime_weighted_price": [],
    
    # 其他最近类指标
    "ampere_lifetime_users": ["max"],
    
    # rank - 最近
    "rank": [],
    "change_rank": [],
    
    # ========== 总和(sum)类指标 ==========
    # detail_units/分拆后的单位时间销量 - 总和
    "detail_units": ["sum", "max"],
    
    # detail_revenue/分拆后的单位时间收入 - 总和
    "detail_revenue": ["sum", "max"],
    
    # ========== 平均(mean)类指标 ==========
    # active_users/活跃 - 平均
    "active_users": ["mean", "max", "min"],
    "dau": ["mean", "max", "min"],  # 日活
    # "dau_daily": ["mean", "max"],  # 日活
    "dau_weekly": ["mean", "max", "min"],  # 周活
    "dau_monthly": ["mean", "max", "min"],  # 月活
    "ampere_dau": ["mean", "max", "min"],
    "ampere_new_dau": ["mean", "max", "min"],
    "acu": ["mean", "max", "min"],  # 平均并发用户
    
    # platform - 跳过
    "platform": [],  # Skip 
    
    # MAU相关 - 平均
    "ampere_mau": ["mean", "max", "min"],
    "ampere_previous_mau": ["mean", "max", "min"],
    "ampere_added_mau": ["mean", "max", "min"],
    "ampere_new_mau": ["mean", "max", "min"],
    "ampere_retained_mau": ["mean", "max", "min"],
    "ampere_churned_mau": ["mean", "max", "min"],
    
    # playtime - 平均
    "playtime": ["mean", "max", "min"],
    "ampere_avg_monthly_playtime": ["mean", "max", "min"],
    "ampere_avg_dailly_playtime": ["mean", "max", "min"],
    
    # retention/留存 - 平均
    "retention": ["mean"],
    "ampere_d1": ["mean"],
    "ampere_d7": ["mean"],
    "ampere_d14": ["mean"],
    "ampere_d28": ["mean"],
    "ampere_d60": ["mean"],
    "ampere_rolling_d1": ["mean"],
    "ampere_rolling_d7": ["mean"],
    "ampere_rolling_d14": ["mean"],
    "ampere_rolling_d28": ["mean"],
    "ampere_rolling_d60": ["mean"],
    "rolling_retention": ["mean"],
    "D1": ["mean"],
    "D2": ["mean"],
    "D3": ["mean"],
    "D4": ["mean"],
    "D5": ["mean"],
    "D6": ["mean"],
    "D7": ["mean"],
    "D14": ["mean"],
    "D30": ["mean"],
    "D60": ["mean"],
    "D90": ["mean"],
    
    # arpu/arppu/ltv - 平均
    "arpu": ["mean"],
    "arppu": ["mean"],
    "ltv": ["mean"],
    "digitalARPPU": ["mean"],
    "digital_arppu": ["mean"],
    
    # ast - 平均
    "ast": ["mean"],
    
    # churn_rate/pay_rate/stickiness - 平均
    "churn_rate": ["mean"],
    "pay_rate": ["mean"],
    "stickiness": ["mean"],
    "ampere_stickiness": ["mean"],
    "ampere_acquisition_rate": ["mean"],
    "acquisition_rate": ["mean"],
    
    # rpd/refund_rate - 平均
    "rpd": ["mean"],
    "refund_rate": ["mean"],
    
    # player_share_by_country - 平均
    "player_share_by_country": ["mean"],
    "players_by_country": ["mean"],
    
    # stream - 平均
    "stream": ["mean"],
    "hoursWatched": ["mean"],
    "peakCCV": ["max"],
    "avgCCV": ["mean"],
    "airtime": ["mean"],
    
    # overlap相关 - 平均
    "ss_cross_affinity": [],
    "ss_cross_app_usage": [],
    "db_overlap_app_a_users_using_app_b_share_PP": [],
    "db_overlap_app_a_users_likelihood_multiplier_PP": [],
    "db_overlap_app_a_users_using_app_b_share_PW": [],
    "db_overlap_app_a_users_likelihood_multiplier_PW": [],
    "db_overlap_app_a_users_using_app_b_share_WP": [],
    "db_overlap_app_a_users_likelihood_multiplier_WP": [],
    "db_overlap_app_a_users_using_app_b_share_WW": [],
    "db_overlap_app_a_users_likelihood_multiplier_WW": [],
    
    # demographic相关 - 平均
    "demographics": [],
    
    # ========== 时间维度指标（daily/weekly/monthly）==========
    # acu 时间维度
    "acu_daily": ["mean", "max", "min"],
    "acu_weekly": ["mean", "max", "min"],
    "acu_monthly": ["mean", "max", "min"],
    
    # wishlists 时间维度
    "wishlists_daily": ["max", "sum"],
    "wishlists_weekly": ["max", "sum"],
    "wishlists_monthly": ["max", "sum"],
    "wishlists_total_daily": ["max"],
    "wishlists_total_weekly": ["max"],
    "wishlists_total_monthly": ["max"],
    
    # pcu 时间维度
    "pcu_daily": ["max"],
    "pcu_weekly": ["max"],
    "pcu_monthly": ["max"],
    
    # revenue 时间维度
    "revenue_daily": ["max", "sum", "min", "mean"],
    "revenue_weekly": ["max", "sum", "min", "mean"],
    "revenue_monthly": ["max", "sum", "min", "mean"],
    "est_revenue_daily": ["max", "sum", "min", "mean"],
    "est_revenue_weekly": ["max", "sum", "min", "mean"],
    "est_revenue_monthly": ["max", "sum", "min", "mean"],
    
    # cumulative_revenue 时间维度
    "cumulative_revenue_daily": ["max"],
    "cumulative_revenue_weekly": ["max"],
    "cumulative_revenue_monthly": ["max"],
    "est_cumulative_revenue_daily": ["max"],
    "est_cumulative_revenue_weekly": ["max"],
    "est_cumulative_revenue_monthly": ["max"],
    
    # units 时间维度
    "est_units_daily": ["max", "sum", "min", "mean"],
    "est_units_weekly": ["max", "sum", "min", "mean"],
    "est_units_monthly": ["max", "sum", "min", "mean"],
    
    # cumulative_units 时间维度
    "est_cumulative_units_daily": ["max"],
    "est_cumulative_units_weekly": ["max"],
    "est_cumulative_units_monthly": ["max"],
    
    # price 时间维度
    "est_price_daily": ["max", "mean"],
    "est_price_weekly": ["max", "mean"],
    "est_price_monthly": ["max", "mean"],
    "weighted_price_daily": [],
    "weighted_price_weekly": [],
    "weighted_price_monthly": [],
    "lifetime_weighted_price_daily": [],
    "lifetime_weighted_price_weekly": [],
    "lifetime_weighted_price_monthly": [],
    
    # playtime 时间维度
    "playtime_daily": ["mean", "max", "min"],
    "playtime_weekly": ["mean", "max", "min"],
    "playtime_monthly": ["mean", "max", "min"],
    
    # steamreviews 时间维度
    "steamreviews_daily": ["max"],
    "steamreviews_weekly": ["max"],
    "steamreviews_monthly": ["max"],
    
    # players_by_country 时间维度
    "players_by_country_daily": ["mean"],
    "players_by_country_weekly": ["mean"],
    "players_by_country_monthly": ["mean"],
    
    # stream 时间维度
    "peakCCV_daily": ["max"],
    "peakCCV_weekly": ["max"],
    "peakCCV_monthly": ["max"],
    "avgCCV_daily": ["mean"],
    "avgCCV_weekly": ["mean"],
    "avgCCV_monthly": ["mean"],
    "airtime_daily": ["mean"],
    "airtime_weekly": ["mean"],
    "airtime_monthly": ["mean"],
    
    # download 时间维度
    "download_daily": ["max", "sum", "min", "mean"],
    "download_weekly": ["max", "sum", "min", "mean"],
    "download_monthly": ["max", "sum", "min", "mean"],
    "cumulative_download": ["max"],
    "cumulative_download_daily": ["max"],
    "cumulative_download_weekly": ["max"],
    "cumulative_download_monthly": ["max"],
    
    # arpu 时间维度
    "arpu_daily": ["mean"],
    "arpu_weekly": ["mean"],
    "arpu_monthly": ["mean"],
    
    # overlap 时间维度 - 跳过
    "ss_cross_affinity_daily": [],
    "ss_cross_affinity_weekly": [],
    "ss_cross_affinity_monthly": [],
    "ss_cross_app_usage_daily": [],
    "ss_cross_app_usage_weekly": [],
    "ss_cross_app_usage_monthly": [],
    "db_overlap_app_a_users_using_app_b_share_PP_daily": [],
    "db_overlap_app_a_users_using_app_b_share_PP_weekly": [],
    "db_overlap_app_a_users_using_app_b_share_PP_monthly": [],
    "db_overlap_app_a_users_likelihood_multiplier_PP_daily": [],
    "db_overlap_app_a_users_likelihood_multiplier_PP_weekly": [],
    "db_overlap_app_a_users_likelihood_multiplier_PP_monthly": [],
    "db_overlap_app_a_users_using_app_b_share_PW_daily": [],
    "db_overlap_app_a_users_using_app_b_share_PW_weekly": [],
    "db_overlap_app_a_users_using_app_b_share_PW_monthly": [],
    "db_overlap_app_a_users_likelihood_multiplier_PW_daily": [],
    "db_overlap_app_a_users_likelihood_multiplier_PW_weekly": [],
    "db_overlap_app_a_users_likelihood_multiplier_PW_monthly": [],
    "db_overlap_app_a_users_using_app_b_share_WP_daily": [],
    "db_overlap_app_a_users_using_app_b_share_WP_weekly": [],
    "db_overlap_app_a_users_using_app_b_share_WP_monthly": [],
    "db_overlap_app_a_users_likelihood_multiplier_WP_daily": [],
    "db_overlap_app_a_users_likelihood_multiplier_WP_weekly": [],
    "db_overlap_app_a_users_likelihood_multiplier_WP_monthly": [],
    "db_overlap_app_a_users_using_app_b_share_WW_daily": [],
    "db_overlap_app_a_users_using_app_b_share_WW_weekly": [],
    "db_overlap_app_a_users_using_app_b_share_WW_monthly": [],
    "db_overlap_app_a_users_likelihood_multiplier_WW_daily": [],
    "db_overlap_app_a_users_likelihood_multiplier_WW_weekly": [],
    "db_overlap_app_a_users_likelihood_multiplier_WW_monthly": [],
    
    # ampere 留存时间维度
    "ampere_d1_daily": ["mean"],
    "ampere_d1_monthly": ["mean"],
    "ampere_d7_daily": ["mean"],
    "ampere_d7_monthly": ["mean"],
    "ampere_d14_daily": ["mean"],
    "ampere_d14_monthly": ["mean"],
    "ampere_d28_daily": ["mean"],
    "ampere_d28_monthly": ["mean"],
    "ampere_d60_daily": ["mean"],
    "ampere_d60_monthly": ["mean"],
    "ampere_rolling_d1_daily": ["mean"],
    "ampere_rolling_d1_monthly": ["mean"],
    "ampere_rolling_d7_daily": ["mean"],
    "ampere_rolling_d7_monthly": ["mean"],
    "ampere_rolling_d14_daily": ["mean"],
    "ampere_rolling_d14_monthly": ["mean"],
    "ampere_rolling_d28_daily": ["mean"],
    "ampere_rolling_d28_monthly": ["mean"],
    "ampere_rolling_d60_daily": ["mean"],
    "ampere_rolling_d60_monthly": ["mean"],
    
    # ========== 其他缺失的指标 ==========
    # mau - 平均
    "mau": ["mean", "max", "min"],
    
    # wau - 平均
    "wau": ["mean", "max", "min"],
    
    # digital_units - 最近
    "digital_units": ["max", "sum", "min", "mean"],
    
    # mscience 指标
    "mscience_lifetime_digital_revenue": ["max"],
    "mscience_lifetime_digital_units": ["max"]
}

def get_aggregation_functions_for_metric(metric_name: str, default_functions: list[str]) -> list[str]:
    """
    获取指定指标的聚合函数配置
    
    Args:
        metric_name: 指标名称（列名）
        default_functions: 默认的聚合函数列表
        
    Returns:
        如果指标有配置，返回配置的聚合函数列表；否则返回默认的聚合函数列表
    """
    # 先尝试直接使用指标名称获取配置（优先使用完整指标名称的配置，允许特殊覆盖）
    if metric_name in METRIC_AGGREGATION_FUNCTIONS:
        return METRIC_AGGREGATION_FUNCTIONS[metric_name]
    
    # _ratio 后缀的指标（环比变化率）：sum 无意义，仅保留 mean/min/max
    if metric_name.endswith('_ratio'):
        return ["mean", "min", "max"]
    
    # 如果指标名称以 _daily、_weekly 或 _monthly 结尾，尝试去除后缀获取基础指标的配置
    if metric_name.endswith(('_daily', '_weekly', '_monthly')):
        base_metric_name = metric_name.rsplit('_', 1)[0]  # 去除最后一个下划线及之后的部分
        if base_metric_name in METRIC_AGGREGATION_FUNCTIONS:
            return METRIC_AGGREGATION_FUNCTIONS[base_metric_name]
    
    # 如果都没有找到，返回默认值
    return default_functions

