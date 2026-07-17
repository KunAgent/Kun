DASHBOARD_METRIC_MAP = [
    {
        "metric_code": "active_users_max",
        "metric_code_name": "peak_daily_active_users",
        "metric_desc": "The highest number of users online simultaneously at each moment (every 5 minutes) of the day",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Monthly Peak DAU",
        "metric_name_cn": "每月峰值日活",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active",
        "label": "active users活跃",
        "weight": 202,
        "active": 1,
        "unsupported_aggregation": ["sum", "mean", "min", "max"]
    },
    {
        "metric_code": "active_users_max",
        "metric_code_name": "peak_daily_active_users",
        "metric_desc": "The highest number of users online simultaneously at each moment (every 5 minutes) of the day",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Monthly Peak DAU",
        "metric_name_cn": "每月峰值日活",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active",
        "label": "active users活跃",
        "weight": 202,
        "active": 1,
        "unsupported_aggregation": ["sum", "mean", "min", "max"]
    },
    {
        "metric_code": "total_users",
        "metric_code_name": "lifetime_new_users_count",
        "metric_desc": "Total Users",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "total new users",
        "metric_name_cn": "总新进用户数",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/register",
        "label": "new user新进用户",
        "weight": 401,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "new_users",
        "metric_code_name": "new_users_count",
        "metric_desc": "New Register Users. newly-registered users, also known as downloads",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "New Users",
        "metric_name_cn": "新进用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/register",
        "label": "new user新进用户",
        "weight": 402,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_users",
        "metric_code_name": "active_users_count",
        "metric_desc": "Daily Active Users(DAU) or Weekly Active Users(WAU) or Monthly Active Users(MAU)",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Active Users",
        "metric_name_cn": "活跃用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active",
        "label": "active users活跃",
        "weight": 201,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "pay_amount",
        "metric_code_name": "pay_amount",
        "metric_desc": "revenue in given time period, currency unit is us dollar $",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "revenue",
        "metric_name_cn": "收入",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "revenue收入",
        "weight": 106,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "pcu",
        "metric_code_name": "peak_concurrent_users_count",
        "metric_desc": "The highest number of users online simultaneously at each moment (every 5 minutes) of the day",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "PCU",
        "metric_name_cn": "最高同时在线",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active",
        "label": "active users活跃",
        "weight": 202,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "acu",
        "metric_code_name": "average_concurrent_users_count",
        "metric_desc": "The average number of users online simultaneously at each moment (every 5 minutes) of the day",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "ACU",
        "metric_name_cn": "平均同时在线",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active",
        "label": "active users活跃",
        "weight": 203,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "aot",
        "metric_code_name": "average_online_time",
        "metric_desc": "Daily average online time/Daily average online time per week/Daily average online time per month",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "Avg.Playtime(min)",
        "metric_name_cn": "平均在线时长（分钟）",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "min",
        "url": "/overview/daily",
        "label": "online time 在线",
        "weight": 204,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "paid_users",
        "metric_code_name": "paying_users_count",
        "metric_desc": "Total number of paid users",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Payer",
        "metric_name_cn": "付费人数",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "refund退款(for mobile game)",
        "weight": 107,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "payer_rate",
        "metric_code_name": "paying_users_rate",
        "metric_desc": "Paying User Rate, which means paid users/ total users",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Payer%",
        "metric_name_cn": "付费渗透率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "refund退款(for mobile game)",
        "weight": 108,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "arpu",
        "metric_code_name": "average_revenue_per_users_arpu",
        "metric_desc": "Average Revenue Per Active Users, ARPU",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "ARPU($)",
        "metric_name_cn": "ARPU($)",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "refund退款(for mobile game)",
        "weight": 109,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "arppu",
        "metric_code_name": "average_revenue_per_paying_users_arppu",
        "metric_desc": "Average Revenue Per Paid Users",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "ARPPU($)",
        "metric_name_cn": "ARPPU($)",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "refund退款(for mobile game)",
        "weight": 110,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "new_paid_users",
        "metric_code_name": "new_paying_users_count",
        "metric_desc": "Number of new paid users",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "First-time Payer",
        "metric_name_cn": "首次付费用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "refund退款(for mobile game)",
        "weight": 111
    },
    {
        "metric_code": "new_pay_amount",
        "metric_code_name": "revenue_of_new_paying_users_arpu",
        "metric_desc": "Total revenue of new paid users",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "Revenue(first-time payer)",
        "metric_name_cn": "首次付费用户金额",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "refund退款(for mobile game)",
        "weight": 112
    },
    {
        "metric_code": "new_arppu",
        "metric_code_name": "average_revenue_per_new_paying_users_arppu",
        "metric_desc": "First time paying user ARPPU",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "First-time Payer ARPPU($)",
        "metric_name_cn": "每个首次付费用户平均付费($)",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "refund退款(for mobile game)",
        "weight": 113
    },
    {
        "metric_code": "alc",
        "metric_code_name": "average_login_count",
        "metric_desc": "Daily/Weekly/Monthly Average Login Count",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Sessions per user",
        "metric_name_cn": "平均登录次数",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "login登录",
        "weight": 205
    },
    {
        "metric_code": "d2",
        "metric_code_name": "next_day_new_users_retention_rate_daily",
        "metric_desc": "the next day retention rate of new players, 次日留存",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "D2",
        "metric_name_cn": "D2留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index",
        "label": "retention留存",
        "weight": 601,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d3",
        "metric_code_name": "3_day_new_users_retention_rate_daily",
        "metric_desc": "New 3-day user retention rate of new players, 三日留存",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "D3",
        "metric_name_cn": "D3留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index",
        "label": "retention留存",
        "weight": 602,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d4",
        "metric_code_name": "4_day_new_users_retention_rate_daily",
        "metric_desc": "New 4-day user retention rate of new players, 四日留存",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "D4",
        "metric_name_cn": "D4留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index",
        "label": "retention留存",
        "weight": 603,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "d5",
        "metric_code_name": "5_day_new_users_retention_rate_daily",
        "metric_desc": "New 5-day user retention rate of new players, 五日留存",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "D5",
        "metric_name_cn": "D5留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index",
        "label": "retention留存",
        "weight": 604,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "d6",
        "metric_code_name": "6_day_new_users_retention_rate_daily",
        "metric_desc": "New 6-day user retention rate of new players, 六日留存",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "D6",
        "metric_name_cn": "D6留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index",
        "label": "retention留存",
        "weight": 605,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "d7",
        "metric_code_name": "7_day_new_users_retention_rate_daily",
        "metric_desc": "New 7-day user retention rate of new players, 七日留存",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "D7",
        "metric_name_cn": "D7留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index",
        "label": "retention留存",
        "weight": 606,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d14",
        "metric_code_name": "14_day_new_users_retention_rate_daily",
        "metric_desc": "New 14-day user retention rate of new players, 十四日留存",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "D14",
        "metric_name_cn": "D14留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index",
        "label": "retention留存",
        "weight": 607,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d30",
        "metric_code_name": "30_day_new_users_retention_rate_daily",
        "metric_desc": "New 30-day user retention rate of new players, 三十日留存",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "D30",
        "metric_name_cn": "D30留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index",
        "label": "retention留存",
        "weight": 608,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "w2",
        "metric_code_name": "next_week_new_users_retention_rate_weekly",
        "metric_desc": "2-week user retention rate of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "W2",
        "metric_name_cn": "次周留存",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "retention留存",
        "weight": 609,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "w3",
        "metric_code_name": "3_week_new_users_retention_rate_weekly",
        "metric_desc": "3-week user retention rate of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "W3",
        "metric_name_cn": "3周留存",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "retention留存",
        "weight": 610,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "w4",
        "metric_code_name": "4_week_new_users_retention_rate_weekly",
        "metric_desc": "4-week user retention rate of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "W4",
        "metric_name_cn": "4周留存",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "retention留存",
        "weight": 611,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "m2",
        "metric_code_name": "next_month_new_users_retention_rate_monthly",
        "metric_desc": "2-month user retention rate of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "M2",
        "metric_name_cn": "次月留存",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/overview/monthly",
        "label": "retention留存",
        "weight": 612,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "m3",
        "metric_code_name": "3_month_new_users_retention_rate_monthly",
        "metric_desc": "3-month user retention rate of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "M3",
        "metric_name_cn": "3月留存",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/overview/monthly",
        "label": "retention留存",
        "weight": 613,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "m4",
        "metric_code_name": "4_month_new_users_retention_rate_monthly",
        "metric_desc": "4-month user retention rate of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "M4",
        "metric_name_cn": "4月留存",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/overview/monthly",
        "label": "retention留存",
        "weight": 614,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "retention_users",
        "metric_code_name": "retention_users_count",
        "metric_desc": "Daily/weekly/monthly retention user",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Retention Users",
        "metric_name_cn": "留存用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 615
    },
    {
        "metric_code": "retention_users",
        "metric_code_name": "retention_users_count",
        "metric_desc": "Daily/weekly/monthly retention user",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Retention Users",
        "metric_name_cn": "留存用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 616
    },
    {
        "metric_code": "churn_users",
        "metric_code_name": "active_users_churn_count",
        "metric_desc": "The number of churn users",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Churn User",
        "metric_name_cn": "流失用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "churn流失",
        "weight": 901,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "churn_rate",
        "metric_code_name": "active_users_churn_rate",
        "metric_desc": "Users churn rate",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Churn%",
        "metric_name_cn": "流失率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "churn流失",
        "weight": 902,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "return_users",
        "metric_code_name": "return_users_count",
        "metric_desc": "Daily/Weekly/Monthly Return Users",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Daily Return Users",
        "metric_name_cn": "回流用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "return回流",
        "weight": 951,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_d2",
        "metric_code_name": "weighted_next_day_new_users_retention_rate_daily",
        "metric_desc": "Weighted 2-day retention rate for new arrivals",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Weighted D2",
        "metric_name_cn": "加权D2留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 617,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_d3",
        "metric_code_name": "weighted_3_day_new_users_retention_rate_daily",
        "metric_desc": "Weighted 3-day retention rate for new arrivals",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Weighted D3",
        "metric_name_cn": "加权D3留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 618,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_d7",
        "metric_code_name": "weighted_7_day_new_users_retention_rate_daily",
        "metric_desc": "Weighted 7-day retention rate for new arrivals",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Weighted D7",
        "metric_name_cn": "加权D7留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 619,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_d14",
        "metric_code_name": "weighted_14_day_new_users_retention_rate_daily",
        "metric_desc": "Weighted 14-day retention rate for new arrivals",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Weighted D14",
        "metric_name_cn": "加权D14留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 620,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_d30",
        "metric_code_name": "weighted_30_day_new_users_retention_rate_daily",
        "metric_desc": "Weighted 30-day retention rate for new arrivals",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Weighted D30",
        "metric_name_cn": "加权D30留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 621,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_w2",
        "metric_code_name": "weighted_next_week_new_users_retention_rate_weekly",
        "metric_desc": "Weighted 2-week retention rate for new arrivals",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Weighted W2",
        "metric_name_cn": "加权W2留存",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "retention留存",
        "weight": 622,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_w3",
        "metric_code_name": "weighted_3_week_new_users_retention_rate_weekly",
        "metric_desc": "Weighted 3-week retention rate for new arrivals",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Weighted W3",
        "metric_name_cn": "加权W3留存",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "retention留存",
        "weight": 623,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_w4",
        "metric_code_name": "weighted_4_week_new_users_retention_rate_weekly",
        "metric_desc": "Weighted 4-week retention rate for new arrivals",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Weighted W4",
        "metric_name_cn": "加权W4留存",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "retention留存",
        "weight": 624,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_m2",
        "metric_code_name": "weighted_next_month_new_users_retention_rate_monthly",
        "metric_desc": "Weighted 2-month retention rate for new arrivals",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Weighted M2",
        "metric_name_cn": "加权M2留存",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/overview/monthly",
        "label": "retention留存",
        "weight": 625,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_m3",
        "metric_code_name": "weighted_3_month_new_users_retention_rate_monthly",
        "metric_desc": "Weighted 3-month retention rate for new arrivals",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Weighted M3",
        "metric_name_cn": "加权M3留存",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/overview/monthly",
        "label": "retention留存",
        "weight": 626,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_m4",
        "metric_code_name": "weighted_4_month_new_users_retention_rate_monthly",
        "metric_desc": "Weighted 4-month retention rate for new arrivals",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Weighted M4",
        "metric_name_cn": "加权M4留存",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/overview/monthly",
        "label": "retention留存",
        "weight": 627,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "first_login_ratio",
        "metric_code_name": "first_login_ratio",
        "metric_desc": "1st tier login ratio, 一阶登录比",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "1st Order Login%",
        "metric_name_cn": "一阶登录比",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "login登录",
        "weight": 206,
        "active": 1,
    },
    {
        "metric_code": "second_login_ratio",
        "metric_code_name": "second_login_ratio",
        "metric_desc": "2nd tier login ratio, 二阶登录比",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "2nd Order Login%",
        "metric_name_cn": "二阶登录比",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "login登录",
        "weight": 207,
        "active": 1,
    },
    {
        "metric_code": "login_count",
        "metric_code_name": "login_count",
        "metric_desc": "Number of logins",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Login Count",
        "metric_name_cn": "登录用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "login登录",
        "weight": 208
    },
    {
        "metric_code": "login_count",
        "metric_code_name": "login_count",
        "metric_desc": "Number of logins",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Login Count",
        "metric_name_cn": "登录用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "login登录",
        "weight": 209
    },
    {
        "metric_code": "online_time",
        "metric_code_name": "online_time",
        "metric_desc": "Online time",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Online Time",
        "metric_name_cn": "在线时长",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "min",
        "url": "/active/onlineAnalysis",
        "label": "online time 在线",
        "weight": 210
    },
    {
        "metric_code": "avg_active_users",
        "metric_code_name": "average_daily_active_users_in_week_or_month",
        "metric_desc": "Average number of daily users who have logged in to the game during the statistical period",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "Daily Average Active Users",
        "metric_name_cn": "日均活跃用户数",
        "granularity": [
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "active users活跃",
        "weight": 211,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "asot",
        "metric_code_name": "average_single_online_time",
        "metric_desc": "The average duration a user stays online during a single gaming session within the statistical period",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "Average Single Online Time",
        "metric_name_cn": "平均单次在线时长",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "min",
        "url": "/overview/weekly",
        "label": "online time 在线",
        "weight": 212
    },
    {
        "metric_code": "alc",
        "metric_code_name": "average_login_count",
        "metric_desc": "Daily/Weekly/Monthly Average Login Count",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "Sessions per user",
        "metric_name_cn": "平均登录次数",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "login登录",
        "weight": 213
    },
    {
        "metric_code": "active_retention_d2",
        "metric_code_name": "next_day_active_users_retention_rate_daily",
        "metric_desc": "The percentage of users who remain active on Day 2 after their last engagement",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Active Retention D2",
        "metric_name_cn": "D2活跃留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 627,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_d3",
        "metric_code_name": "3_day_active_users_retention_rate_daily",
        "metric_desc": "The percentage of users who remain active on Day 3 after their last engagement",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Active Retention D3",
        "metric_name_cn": "D3活跃留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 628,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_d4",
        "metric_code_name": "4_day_active_users_retention_rate_daily",
        "metric_desc": "The percentage of users who remain active on Day 4 after their last engagement",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Active Retention D4",
        "metric_name_cn": "D4活跃留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 629,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_retention_d5",
        "metric_code_name": "5_day_active_users_retention_rate_daily",
        "metric_desc": "The percentage of users who remain active on Day 5 after their last engagement",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Active Retention D5",
        "metric_name_cn": "D5活跃留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 630,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_retention_d6",
        "metric_code_name": "6_day_active_users_retention_rate_daily",
        "metric_desc": "The percentage of users who remain active on Day 6 after their last engagement",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Active Retention D6",
        "metric_name_cn": "D6活跃留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 631,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_retention_d7",
        "metric_code_name": "7_day_active_users_retention_rate_daily",
        "metric_desc": "The percentage of users who remain active on Day 7 after their last engagement",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Active Retention D7",
        "metric_name_cn": "D7活跃留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 632,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_d14",
        "metric_code_name": "14_day_active_users_retention_rate_daily",
        "metric_desc": "The percentage of users who remain active on Day 14 after their last engagement",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Active Retention D14",
        "metric_name_cn": "D14活跃留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 633,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_d30",
        "metric_code_name": "30_day_active_users_retention_rate_daily",
        "metric_desc": "The percentage of users who remain active on Day 30 after their last engagement",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Active Retention D30",
        "metric_name_cn": "D30活跃留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 634,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "churn_users_d2",
        "metric_code_name": "next_day_new_users_churn_count_daily",
        "metric_desc": "The number of users who stopped playing or became inactive on Day 2 after their last engagement",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Churn Users D2",
        "metric_name_cn": "D2流失用户",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/engagement/churn",
        "label": "churn流失",
        "weight": 903,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "churn_users_w2",
        "metric_code_name": "next_week_new_users_churn_count_weekly",
        "metric_desc": "The number of users who stopped playing or became inactive during the second week after their last engagement",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Churn Users W2",
        "metric_name_cn": "W2流失用户",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/engagement/churn",
        "label": "churn流失",
        "weight": 904,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "churn_users_m2",
        "metric_code_name": "next_month_new_users_churn_count_monthly",
        "metric_desc": "The number of users who stopped playing or became inactive during the second month after their last engagement",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Churn Users M2",
        "metric_name_cn": "M2流失用户",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/churn",
        "label": "churn流失",
        "weight": 905,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "churn_d2",
        "metric_code_name": "next_day_new_users_churn_rate_daily",
        "metric_desc": "The percentage of users who stopped playing on Day 2, calculated as churned users divided by total users who started on Day 1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Churn D2",
        "metric_name_cn": "D2流失率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/engagement/churn",
        "label": "churn流失",
        "weight": 906,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "churn_w2",
        "metric_code_name": "next_week_new_users_churn_rate_weekly",
        "metric_desc": "The percentage of users who stopped playing during the second week, calculated as churned users divided by total active users from Week 1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Churn W2",
        "metric_name_cn": "W2流失率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/engagement/churn",
        "label": "churn流失",
        "weight": 907,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "churn_m2",
        "metric_code_name": "next_month_new_users_churn_rate_monthly",
        "metric_desc": "The percentage of users who stopped playing during the second month, calculated as churned users divided by total active users from Month 1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Churn M2",
        "metric_name_cn": "M2流失率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/churn",
        "label": "churn流失",
        "weight": 908,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "churn_paid_users",
        "metric_code_name": "paying_users_churn_count",
        "metric_desc": "The number of paying users who stopped playing or making purchases during the statistical period",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Chrun Paid Users",
        "metric_name_cn": "付费流失用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/churn",
        "label": "churn流失",
        "weight": 909
    },
    {
        "metric_code": "churn_paid_rate",
        "metric_code_name": "paying_users_churn_rate",
        "metric_desc": "The percentage of paying users who stopped playing or making purchases, calculated as churned paid users divided by total paid users",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "Churn Paid Rate",
        "metric_name_cn": "付费流失率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/churn",
        "label": "churn流失",
        "weight": 910
    },
    {
        "metric_code": "total_pay_amount",
        "metric_code_name": "lifetime_pay_amount",
        "metric_desc": "The cumulative revenue generated from all users' in-game purchases during the statistical period",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "Total Pay Amount",
        "metric_name_cn": "所有用户累计付费",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "revenue收入",
        "weight": 115,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "1d_ltv",
        "metric_code_name": "average_1_day_revenue_ltv_daily",
        "metric_desc": "The average revenue generated from a user within their first day of gameplay",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "1D LTV",
        "metric_name_cn": "1天 LTV",
        "granularity": [
            "daily"
        ],
        "unit": "usd",
        "url": "/monetization/ltv",
        "label": "ltv生命周期总值(for mobile game)",
        "weight": 116,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "2d_ltv",
        "metric_code_name": "average_2_day_revenue_ltv_daily",
        "metric_desc": "The average revenue generated from a user within their second day of gameplay",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "2 LTV",
        "metric_name_cn": "2天 LTV",
        "granularity": [
            "daily"
        ],
        "unit": "usd",
        "url": "/monetization/ltv",
        "label": "ltv生命周期总值(for mobile game)",
        "weight": 117,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "3d_ltv",
        "metric_code_name": "average_3_day_revenue_ltv_daily",
        "metric_desc": "The average revenue generated from a user within their third day of gameplay",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "3D LTV",
        "metric_name_cn": "3天 LTV",
        "granularity": [
            "daily"
        ],
        "unit": "usd",
        "url": "/monetization/ltv",
        "label": "ltv生命周期总值(for mobile game)",
        "weight": 118,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "7d_ltv",
        "metric_code_name": "average_7_day_revenue_ltv_daily",
        "metric_desc": "The average revenue generated from a user within their seventh day of gameplay",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "7D LTV",
        "metric_name_cn": "7天 LTV",
        "granularity": [
            "daily"
        ],
        "unit": "usd",
        "url": "/monetization/ltv",
        "label": "ltv生命周期总值(for mobile game)",
        "weight": 119,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "14d_ltv",
        "metric_code_name": "average_14_day_revenue_ltv_daily",
        "metric_desc": "The average revenue generated from a user within their 14th day of gameplay",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "14D LTV",
        "metric_name_cn": "14天 LTV",
        "granularity": [
            "daily"
        ],
        "unit": "usd",
        "url": "/monetization/ltv",
        "label": "ltv生命周期总值(for mobile game)",
        "weight": 120,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "30d_ltv",
        "metric_code_name": "average_30_day_revenue_ltv_daily",
        "metric_desc": "The average revenue generated from a user within their 30th day of gameplay",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "30D LTV",
        "metric_name_cn": "30天 LTV",
        "granularity": [
            "daily"
        ],
        "unit": "usd",
        "url": "/monetization/ltv",
        "label": "ltv生命周期总值(for mobile game)",
        "weight": 121,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "60d_ltv",
        "metric_code_name": "average_60_day_revenue_ltv_daily",
        "metric_desc": "The average revenue generated from a user within their 60th day of gameplay",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "60D LTV",
        "metric_name_cn": "60天 LTV",
        "granularity": [
            "daily"
        ],
        "unit": "usd",
        "url": "/monetization/ltv",
        "label": "ltv生命周期总值(for mobile game)",
        "weight": 122,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "90d_ltv",
        "metric_code_name": "average_90_day_revenue_ltv_daily",
        "metric_desc": "The average revenue generated from a user within their 90th day of gameplay",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "90D LTV",
        "metric_name_cn": "90天 LTV",
        "granularity": [
            "daily"
        ],
        "unit": "usd",
        "url": "/monetization/ltv",
        "label": "ltv生命周期总值(for mobile game)",
        "weight": 123,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "180d_ltv",
        "metric_code_name": "average_180_day_revenue_ltv_daily",
        "metric_desc": "The average revenue generated from a user within their 180th day of gameplay",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "180D LTV",
        "metric_name_cn": "180天 LTV",
        "granularity": [
            "daily"
        ],
        "unit": "usd",
        "url": "/monetization/ltv",
        "label": "ltv生命周期总值(for mobile game)",
        "weight": 124,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "270d_ltv",
        "metric_code_name": "average_270_day_revenue_ltv_daily",
        "metric_desc": "The average revenue generated from a user within their 270th day of gameplay",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "270D LTV",
        "metric_name_cn": "270天 LTV",
        "granularity": [
            "daily"
        ],
        "unit": "usd",
        "url": "/monetization/ltv",
        "label": "ltv生命周期总值(for mobile game)",
        "weight": 125
    },
    {
        "metric_code": "360d_ltv",
        "metric_code_name": "average_360_day_revenue_ltv_daily",
        "metric_desc": "The average revenue generated from a user within their 360th day of gameplay",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "360D LTV",
        "metric_name_cn": "360 天LTV",
        "granularity": [
            "daily"
        ],
        "unit": "usd",
        "url": "/monetization/ltv",
        "label": "ltv生命周期总值(for mobile game)",
        "weight": 126,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "gross_revenue",
        "metric_code_name": "gross_revenue",
        "metric_desc": "The sales amount of all products (Base Game, DLC, Bundle, MTX) includes platform shares, refunds, and taxes but excludes retail revenue (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Gross Revenue",
        "metric_name_cn": "总收入",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "revenue收入",
        "weight": 127,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "net_revenue",
        "metric_code_name": "revenue_after_refund_and_tax",
        "metric_desc": "The sales amount of all products (Base Game, DLC, Bundle, MTX) includes platform shares but excludes refunds, taxes, and retail revenue (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Revenue After Refund&TAX",
        "metric_name_cn": "收入(剔除退款&税)",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "revenue收入",
        "weight": 101
    },
    {
        "metric_code": "revenue_after_chargeback",
        "metric_code_name": "revenue_after_refund",
        "metric_desc": "The sales amount of all products (Base Game, DLC, Bundle, MTX) includes platform shares and tax but excludes refunds and retail revenue (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Revenue After Refund",
        "metric_name_cn": "收入(剔除退款)",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "revenue收入",
        "weight": 102,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "refund_revenue",
        "metric_code_name": "refund_revenue",
        "metric_desc": "Total chargeback/returns amount.",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Refund Revenue",
        "metric_name_cn": "退款收入",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "revenue收入",
        "weight": 128,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "full_game_gross_revenue",
        "metric_code_name": "base_game_gross_revenue",
        "metric_desc": "The sales amount of Base Game includes platform shares, refunds, and taxes but excludes retail revenue (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Base Game Gross Revenue",
        "metric_name_cn": "本体收入",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "revenue收入",
        "weight": 129,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "units_revenue",
        "metric_code_name": "base_game_revenue_after_refund_and_tax",
        "metric_desc": "The revenue amount of Base Game includes platform shares but excludes refunds, taxes, and retail revenue (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Base Game Revenue After Refund&TAX",
        "metric_name_cn": "本体收入(剔除退款&税)",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "revenue收入",
        "weight": 103,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "game_units_revenue_share",
        "metric_code_name": "base_game_gross_revenue_ratio",
        "metric_desc": "Base Game Gross Revenue / Gross Revenue; The proportion of base game revenue to total gross revenue",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Game Units Revenue Share%",
        "metric_name_cn": "本体收入占比",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "revenue收入",
        "weight": 130,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "gross_full_game_units",
        "metric_code_name": "gross_base_game_units_sold",
        "metric_desc": "The number of Base Game units sold includes refunds but excludes retail units (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Gross Base Game Units",
        "metric_name_cn": "本体销量",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "sale销量(for pc/console game)",
        "weight": 131,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "units_number",
        "metric_code_name": "units_sold_after_refund",
        "metric_desc": "The number of Base Game units sold  excludes refunds and retail units (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Base Game Units After Refund",
        "metric_name_cn": "本体销量(剔除退款)",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "sale销量(for pc/console game)",
        "weight": 104,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "full_refunded_units",
        "metric_code_name": "base_game_refund_units",
        "metric_desc": "Total chargeback/returns Base Game units",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Refund Base Game Units",
        "metric_name_cn": "本体退款数量",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "refund退款(for pc/console game)",
        "weight": 132,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "gross_units_sold",
        "metric_code_name": "gross_units_sold",
        "metric_desc": "The total units sold of all products (Base Game, DLC, Bundles, MTX) includes refunds but excludes retail units (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Gross Units",
        "metric_name_cn": "产品销量",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "sale销量(for pc/console game)",
        "weight": 133,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "net_units_sold",
        "metric_code_name": "units_sold_after_refund_for_product",
        "metric_desc": "The total units sold of all products (include Base Game, DLC, Bundles, MTX) excludes refunds and retail units (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Units After Refund",
        "metric_name_cn": "产品销量(剔除退款)",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "sale销量(for pc/console game)",
        "weight": 105,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "refunded_units",
        "metric_code_name": "refund_units",
        "metric_desc": "The total chargeback/returns units of all products (Base Game, DLC, Bundles, MTX)",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Refund Units",
        "metric_name_cn": "产品退款数量",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "refund退款(for pc/console game)",
        "weight": 134,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "refund_rate",
        "metric_code_name": "refund_rate",
        "metric_desc": "Refund Units/Gross Units； Units include all types of products (Base Game, DLC, Bundles, MTX)",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Refund Rate",
        "metric_name_cn": "退款率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "refund退款(for pc/console game)",
        "weight": 135,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "asp",
        "metric_code_name": "average_selling_price",
        "metric_desc": "The average price of the product",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "ASP / Average Selling Price",
        "metric_name_cn": "平均销售价格",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "sale销量(for pc/console game)",
        "weight": 136,
        "active": 1,
        "unsupported_aggregation": ["sum"]
    },
    {
        "metric_code": "full_game_asp",
        "metric_code_name": "base_game_average_selling_price",
        "metric_desc": "The average price of Base Game，Base Game Gross Revenue / Gross Base Game Units",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Base Game ASP",
        "metric_name_cn": "本体平均销售价格",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "sale销量(for pc/console game)",
        "weight": 137,
        "active": 1,
        "unsupported_aggregation": ["sum"]
    },
    {
        "metric_code": "lifetime_gross_revenue",
        "metric_code_name": "lifetime_gross_revenue",
        "metric_desc": "The cumulative historical revenue from sales of all products (Base Game, DLC, Bundle, MTX) includes platform shares, refunds, and taxes but excludes retail revenue (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Lifetime Gross Revenue",
        "metric_name_cn": "累计总收入",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "revenue收入",
        "weight": 138,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "lifetime_net_revenue",
        "metric_code_name": "lifetime_revenue_after_refund_and_tax",
        "metric_desc": "The cumulative historical revenue from sales of all products (Base Game, DLC, Bundle, MTX) includes platform shares but excludes refunds, taxes, and retail revenue (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Lifetime Revenue After Refund&TAX",
        "metric_name_cn": "累计收入(剔除退款&税）",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "revenue收入",
        "weight": 139
    },
    {
        "metric_code": "lifetime_revenue_after_refund",
        "metric_code_name": "lifetime_revenue_after_refund",
        "metric_desc": "The cumulative historical revenue from sales of all products (Base Game, DLC, Bundle, MTX) includes platform shares and tax but excludes refunds and retail revenue.",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Lifetime Revenue After Refund",
        "metric_name_cn": "累计收入(剔除退款）",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "revenue收入",
        "weight": 140,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "lifetime_chargeback_revenue",
        "metric_code_name": "lifetime_refund_revenue",
        "metric_desc": "The cumulative historical chargeback/returns revenue.",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Lifetime Refund Revenue",
        "metric_name_cn": "退款收入",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "refund退款(for pc/console game)",
        "weight": 141
    },
    {
        "metric_code": "lifetime_full_game_gross_units",
        "metric_code_name": "lifetime_base_game_gross_units_sold",
        "metric_desc": "The number of cumulative historical Base Game units sold includes refunds but excludes retail units.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime Gross Base Game Units",
        "metric_name_cn": "累计本体销量",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "sale销量(for pc/console game)",
        "weight": 142,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "lifetime_full_game_net_units",
        "metric_code_name": "lifetime_base_game_units_sold_after_refund",
        "metric_desc": "The number of cumulative historical Base Game units sold excludes refunds and retail units.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime Base Game Units After Refund",
        "metric_name_cn": "累计本体净销量(剔除退款）",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "sale销量(for pc/console game)",
        "weight": 143,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "lifetime_full_game_refund_units",
        "metric_code_name": "lifetime_base_game_refund_units",
        "metric_desc": "Total chargeback/returns Base Game units",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime Refund Base Game Units",
        "metric_name_cn": "累计本体退款数量",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "refund退款(for pc/console game)",
        "weight": 144
    },
    {
        "metric_code": "lifetime_refund_rate",
        "metric_code_name": "lifetime_refund_rate",
        "metric_desc": "Lifetime Refund Units/Lifetime Gross Units； Units include all types of products (Base Game, DLC, Bundles, MTX)",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Lifetime Refund Rate",
        "metric_name_cn": "累计退款率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "refund退款(for pc/console game)",
        "weight": 145,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "lifetime_gross_full_game_units",
        "metric_code_name": "lifetime_full_game_units_realtime",
        "metric_desc": "Realtime lifetime gross full game units data",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime Gross Full Game Units (Realtime)",
        "metric_name_cn": "累计本体销量(实时)",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "realtime实时类",
        "weight": 146,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "lifetime_gross_revenue",
        "metric_code_name": "lifetime_revenue_realtime",
        "metric_desc": "Realtime lifetime gross revenue data",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Lifetime Gross Revenue (Realtime)",
        "metric_name_cn": "累计总收入(实时)",
        "granularity": [
            "realtime"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "realtime实时类",
        "weight": 147,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "mtx_revenue",
        "metric_code_name": "in_game_revenue",
        "metric_desc": "The total amounts from in-game purchase",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "In-Game Revenue",
        "metric_name_cn": "内购收入($)",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 146,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "mtx_arpu",
        "metric_code_name": "average_revenue_per_users_arpu",
        "metric_desc": "Average in-game purchase revenue per active user",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "In-Game ARPU",
        "metric_name_cn": "内购ARPU",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 147,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "mtx_arppu",
        "metric_code_name": "average_revenue_per_paying_users_arppu",
        "metric_desc": "Average in-game purchase revenue per paying user",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "In-Game ARPPU",
        "metric_name_cn": "内购付费ARPPU",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 148,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "platform_arpu",
        "metric_code_name": "platform_arpu",
        "metric_desc": "Average in-game purchase revenue per active user",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "average revenue per user",
        "metric_name_cn": "用户平均收入",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/inGameRevenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 169,
        "active": 1,
        "unsupported_aggregation": [
            "mean"
        ]
    },
    {
        "metric_code": "platform_arppu",
        "metric_code_name": "platform_arppu",
        "metric_desc": "Average in-game purchase revenue per paying user",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "average revenue per paying user",
        "metric_name_cn": "付费用户平均收入",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/inGameRevenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 170,
        "active": 1,
        "unsupported_aggregation": [
            "mean"
        ]
    },
    {
        "metric_code": "mtx_payers",
        "metric_code_name": "in_game_paying_users_count",
        "metric_desc": "Total number of users who made in-game purchases",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "In-Game Payers",
        "metric_name_cn": "内购付费人数",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 149,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "mtx_payer_rate",
        "metric_code_name": "in_game_paying_users_ratio",
        "metric_desc": "In-Game paying users/Active users",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "In-Game Payer%",
        "metric_name_cn": "内购付费渗透率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 150,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "new_users_mtx_payer_rate",
        "metric_code_name": "in_game_paying_new_users_rate",
        "metric_desc": "The number of new users who made in-game purchases / New users",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "In-Game Payer% (New Users)",
        "metric_name_cn": "新进用户内购付费渗透率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 151
    },
    {
        "metric_code": "new_users_arpu",
        "metric_code_name": "average_in_game_revenue_per_new_users_arpu",
        "metric_desc": "Total amount of in-game payments made by new users / New users",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "In-Game ARPU (New Users)",
        "metric_name_cn": "新进用户内购付费ARPU($)",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 152
    },
    {
        "metric_code": "mtx_new_paid_users",
        "metric_code_name": "first_time_in_game_paying_users_count",
        "metric_desc": "The number of users who have in-game payment behaviors for the first time",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "First-time In-Game Payers",
        "metric_name_cn": "首次内购用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 153
    },
    {
        "metric_code": "mtx_new_pay_amount",
        "metric_code_name": "first_time_in_game_revenue",
        "metric_desc": "The cumulative amounts from payers who have in-game payment behaviors for the first time in the statistical period",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "First-time In-Game Payer Revenue",
        "metric_name_cn": "首次内购用户收入($)",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 154
    },
    {
        "metric_code": "mtx_new_arpu",
        "metric_code_name": "average_first_time_in_game_revenue_per_users_arpu",
        "metric_desc": "First-time In-Game Payers Revenue / First-time In-Game payers",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "First-time In-Game Payer ARPU($)",
        "metric_name_cn": "首次内购用户付费ARPU($)",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 155
    },
    {
        "metric_code": "total_users",
        "metric_code_name": "lifetime_new_users_count",
        "metric_desc": "Total number of registered users accumulated to the statistical day (userid deduplicated).",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "total new users",
        "metric_name_cn": "累计注册用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/register",
        "label": "new user新进用户",
        "weight": 404,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "new_users",
        "metric_code_name": "new_users_count",
        "metric_desc": "Number of new users in the statistical period (userid deduplicated), A user who logs in for the first time is usually defined as a new user",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "new users",
        "metric_name_cn": "新增用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/register",
        "label": "new user新进",
        "weight": 405,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_users",
        "metric_code_name": "active_users_count",
        "metric_desc": "Number of users who have logged in to the game during the statistical period (userid deduplicated)",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "active users",
        "metric_name_cn": "活跃用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active",
        "label": "active users活跃",
        "weight": 214,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "avg_active_users",
        "metric_code_name": "average_daily_active_users_in_week_or_month",
        "metric_desc": "Average number of daily users who have logged in to the game during the statistical period",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "daily average active users",
        "metric_name_cn": "日均活跃用户",
        "granularity": [
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active",
        "label": "active users活跃",
        "weight": 215,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "pcu",
        "metric_code_name": "peak_concurrent_users_count",
        "metric_desc": "Peak concurrent players in 5 minute interval during the statistical period.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "pcu",
        "metric_name_cn": "最高同时在线",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active",
        "label": "active users活跃",
        "weight": 216,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "acu",
        "metric_code_name": "average_concurrent_users_count",
        "metric_desc": "Average concurrent players in 5 minute interval during the statistical period.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "acu",
        "metric_name_cn": "平均同时在线",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active",
        "label": "active users活跃",
        "weight": 217,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "online_time_hour",
        "metric_code_name": "online_time",
        "metric_desc": "Total playtime of all players",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Playtime (h)",
        "metric_name_cn": "总游戏时长",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active/onlineAnalysis",
        "label": "online time 在线",
        "weight": 218
    },
    {
        "metric_code": "median_online_time",
        "metric_code_name": "median_online_time",
        "metric_desc": "Daily median playtime",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Median.Playtime (h)",
        "metric_name_cn": "中位数游戏时长",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active/onlineAnalysis",
        "label": "online time 在线",
        "weight": 219,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "aot_hour",
        "metric_code_name": "average_online_time",
        "metric_desc": "Daily/Weekly/Monthly average playtime. Total playtime /Number of active users (h).",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Avg.Playtime (h)",
        "metric_name_cn": "平均游戏时长",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active/onlineAnalysis",
        "label": "online time 在线",
        "weight": 220,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "median_session_time",
        "metric_code_name": "median_session_length",
        "metric_desc": "Daily median Session Length.",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Median.Session Length (h)",
        "metric_name_cn": "中位数单次在线时长",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active/onlineAnalysis",
        "label": "online time 在线",
        "weight": 221
    },
    {
        "metric_code": "asot_hour",
        "metric_code_name": "average_session_online_time",
        "metric_desc": "Daily/Weekly/Monthly average Session Length: Total playtime / Number of sessions (min).",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Avg.Session Length (h)",
        "metric_name_cn": "平均单次在线时长",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active/onlineAnalysis",
        "label": "online time 在线",
        "weight": 222
    },
    {
        "metric_code": "avg_session_cnt",
        "metric_code_name": "average_session_count",
        "metric_desc": "Daily: Sum of the number of sessions all users have entered the game on that day/Active users on the day",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Avg.Sessions",
        "metric_name_cn": "平均登录次数",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/active/onlineAnalysis",
        "label": "active users活跃",
        "weight": 223,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "first_login_ratio",
        "metric_code_name": "first_login_ratio",
        "metric_desc": "1st tier login ratio: 3-day valid new user / 2-day valid new users.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "First order login ratio",
        "metric_name_cn": "次日留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "login登录",
        "weight": 635
    },
    {
        "metric_code": "second_login_ratio",
        "metric_code_name": "second_login_ratio",
        "metric_desc": "2nd tier login ratio: 3-day valid retained users / 3-day valid new users",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Second order login ratio",
        "metric_name_cn": "三日留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "login登录",
        "weight": 636
    },
    {
        "metric_code": "d1",
        "metric_code_name": "next_day_new_users_retention_rate_daily",
        "metric_desc": "D1 retention = the percentage of players that first played the game on this day and returned to the game 1 day later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d1 retention ratio（new user）",
        "metric_name_cn": "D1留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 637,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d2",
        "metric_code_name": "2_day_new_users_retention_rate_daily",
        "metric_desc": "D2 retention = the percentage of players that first played the game on this day and returned to the game 2 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d2 retention ratio（new user）",
        "metric_name_cn": "D2留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 638,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d3",
        "metric_code_name": "3_day_new_users_retention_rate_daily",
        "metric_desc": "D3 retention = the percentage of players that first played the game on this day and returned to the game 3 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d3 retention ratio（new user）",
        "metric_name_cn": "D3留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 639,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "d4",
        "metric_code_name": "4_day_new_users_retention_rate_daily",
        "metric_desc": "D4 retention = the percentage of players that first played the game on this day and returned to the game 4 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d4 retention ratio（new user）",
        "metric_name_cn": "D4留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 640,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "d5",
        "metric_code_name": "5_day_new_users_retention_rate_daily",
        "metric_desc": "D5 retention = the percentage of players that first played the game on this day and returned to the game 5 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d5 retention ratio（new user）",
        "metric_name_cn": "D5留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 641,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "d6",
        "metric_code_name": "6_day_new_users_retention_rate_daily",
        "metric_desc": "D6 retention = the percentage of players that first played the game on this day and returned to the game 6 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d6 retention ratio（new user）",
        "metric_name_cn": "D6留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 642,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d7",
        "metric_code_name": "7_day_new_users_retention_rate_daily",
        "metric_desc": "D7 retention = the percentage of players that first played the game on this day and returned to the game 7 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d7 retention ratio（new user）",
        "metric_name_cn": "D7留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 643,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "d14",
        "metric_code_name": "14_day_new_users_retention_rate_daily",
        "metric_desc": "D14 retention = the percentage of players that first played the game on this day and returned to the game 14 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d14 retention ratio（new user）",
        "metric_name_cn": "D14留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 644,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d30",
        "metric_code_name": "30_day_new_users_retention_rate_daily",
        "metric_desc": "D30 retention = the percentage of players that first played the game on this day and returned to the game 30 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d30 retention ratio（new user）",
        "metric_name_cn": "D30留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 645,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "rolling_d1",
        "metric_code_name": "next_day_new_users_rolling_retention_rate_daily",
        "metric_desc": "D1 rolling retention = the percentage of players that first played the game on this day and returned to the game 1 day later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d1 rolling retention ratio（new user）",
        "metric_name_cn": "D1滚动留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 646
    },
    {
        "metric_code": "rolling_d2",
        "metric_code_name": "2_day_new_users_rolling_retention_rate_daily",
        "metric_desc": "D2 rolling retention = the percentage of players that first played the game on this day and returned to the game 2 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d2 rolling retention ratio（new user）",
        "metric_name_cn": "D2滚动留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 647
    },
    {
        "metric_code": "rolling_d3",
        "metric_code_name": "3_day_new_users_rolling_retention_rate_daily",
        "metric_desc": "D3 rolling retention = the percentage of players that first played the game on this day and returned to the game 3 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d3 rolling retention ratio（new user）",
        "metric_name_cn": "D3滚动留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 648
    },
    {
        "metric_code": "rolling_d4",
        "metric_code_name": "4_day_new_users_rolling_retention_rate_daily",
        "metric_desc": "D4 rolling retention = the percentage of players that first played the game on this day and returned to the game 4 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d4 rolling retention ratio（new user）",
        "metric_name_cn": "D4滚动留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 649
    },
    {
        "metric_code": "rolling_d5",
        "metric_code_name": "5_day_new_users_rolling_retention_rate_daily",
        "metric_desc": "D5 rolling retention = the percentage of players that first played the game on this day and returned to the game 5 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d5 rolling retention ratio（new user）",
        "metric_name_cn": "D5滚动留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 650
    },
    {
        "metric_code": "rolling_d6",
        "metric_code_name": "6_day_new_users_rolling_retention_rate_daily",
        "metric_desc": "D6 rolling retention = the percentage of players that first played the game on this day and returned to the game 6 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d6 rolling retention ratio（new user）",
        "metric_name_cn": "D6滚动留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 651
    },
    {
        "metric_code": "rolling_d7",
        "metric_code_name": "7_day_new_users_rolling_retention_rate_daily",
        "metric_desc": "D7 rolling retention = the percentage of players that first played the game on this day and returned to the game 7 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d7 rolling retention ratio（new user）",
        "metric_name_cn": "D7滚动留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 652
    },
    {
        "metric_code": "rolling_d14",
        "metric_code_name": "14_day_new_users_rolling_retention_rate_daily",
        "metric_desc": "D14 rolling retention = the percentage of players that first played the game on this day and returned to the game 14 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d14 rolling retention ratio（new user）",
        "metric_name_cn": "D14滚动留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 653
    },
    {
        "metric_code": "rolling_d30",
        "metric_code_name": "30_day_new_users_rolling_retention_rate_daily",
        "metric_desc": "D30 rolling retention = the percentage of players that first played the game on this day and returned to the game 30 days later， Registration date is Day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d30 rolling retention ratio（new user）",
        "metric_name_cn": "D30滚动留存率（新用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/newUsers",
        "label": "retention留存",
        "weight": 654
    },
    {
        "metric_code": "active_retention_d1",
        "metric_code_name": "next_day_active_users_retention_rate_daily",
        "metric_desc": "Daily: D1 retention = the percentage of players that played the game on this day and returned to the game 1 day later， Active date is D0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d1 retention ratio（active user）",
        "metric_name_cn": "D1留存率（活跃用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 655,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_retention_d2",
        "metric_code_name": "2_day_active_users_retention_rate_daily",
        "metric_desc": "Daily: D2 retention = the percentage of players that played the game on this day and returned to the game 2 days later， Active date is D0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d2 retention ratio（active user）",
        "metric_name_cn": "D2留存率（活跃用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 656,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_retention_d3",
        "metric_code_name": "3_day_active_users_retention_rate_daily",
        "metric_desc": "Daily: D3 retention = the percentage of players that played the game on this day and returned to the game 3 days later， Active date is D0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d3 retention ratio（active user）",
        "metric_name_cn": "D3留存率（活跃用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 657,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_retention_d4",
        "metric_code_name": "4_day_active_users_retention_rate_daily",
        "metric_desc": "Daily: D4 retention = the percentage of players that played the game on this day and returned to the game 4 days later， Active date is D0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d4 retention ratio（active user）",
        "metric_name_cn": "D4留存率（活跃用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 658,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_retention_d5",
        "metric_code_name": "5_day_active_users_retention_rate_daily",
        "metric_desc": "Daily: D5 retention = the percentage of players that played the game on this day and returned to the game 5 days later， Active date is D0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d5 retention ratio（active user）",
        "metric_name_cn": "D5留存率（活跃用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 659,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_retention_d6",
        "metric_code_name": "6_day_active_users_retention_rate_daily",
        "metric_desc": "Daily: D6 retention = the percentage of players that played the game on this day and returned to the game 6 days later， Active date is D0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d6 retention ratio（active user）",
        "metric_name_cn": "D6留存率（活跃用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 660,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_retention_d7",
        "metric_code_name": "7_day_active_users_retention_rate_daily",
        "metric_desc": "Daily: D7 retention = the percentage of players that played the game on this day and returned to the game 7 days later， Active date is D0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d7 retention ratio（active user）",
        "metric_name_cn": "D7留存率（活跃用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 661,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_retention_d14",
        "metric_code_name": "14_day_active_users_retention_rate_daily",
        "metric_desc": "Daily: D14 retention = the percentage of players that played the game on this day and returned to the game 14 days later， Active date is D0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d14 retention ratio（active user）",
        "metric_name_cn": "D14留存率（活跃用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 662,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_retention_d30",
        "metric_code_name": "30_day_active_users_retention_rate_daily",
        "metric_desc": "Daily: D30 retention = the percentage of players that played the game on this day and returned to the game 30 days later， Active date is D0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "d30 retention ratio（active user）",
        "metric_name_cn": "D30留存率（活跃用户）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 663,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_d2",
        "metric_code_name": "weighted_next_day_new_users_retention_rate_daily",
        "metric_desc": "D2 weighted retention ratio = D2 weighted retention ratio, which refers to the sum of (number of newly-registered users * D2 retention ratio) from the game launching day to the statistical day / the sum of the number of newly-registered users from the game launching day to the statistical day.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Weighted D2",
        "metric_name_cn": "加权D2留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 664,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_d3",
        "metric_code_name": "weighted_3_day_new_users_retention_rate_daily",
        "metric_desc": "D3 weighted retention ratio = D3 weighted retention ratio, which refers to the sum of (number of newly-registered users * D3 retention ratio) from the game launching day to the statistical day / the sum of the number of newly-registered users from the game launching day to the statistical day.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Weighted D3",
        "metric_name_cn": "加权D3留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 665,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_d7",
        "metric_code_name": "weighted_7_day_new_users_retention_rate_daily",
        "metric_desc": "D7 weighted retention ratio = D7 weighted retention ratio, which refers to the sum of (number of newly-registered users * D7 retention ratio) from the game launching day to the statistical day / the sum of the number of newly-registered users from the game launching day to the statistical day.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Weighted D7",
        "metric_name_cn": "加权D7留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 666,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "weighted_d14",
        "metric_code_name": "weighted_14_day_new_users_retention_rate_daily",
        "metric_desc": "D14 weighted retention ratio = D14 weighted retention ratio, which refers to the sum of (number of newly-registered users * D14 retention ratio) from the game launching day to the statistical day / the sum of the number of newly-registered users from the game launching day to the statistical day.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Weighted D14",
        "metric_name_cn": "加权D14留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 667,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "churn_users_d2",
        "metric_code_name": "next_day_new_users_churn_count_daily",
        "metric_desc": "Daily: The number of new users who logged in yesterday but did not log in today.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "churn of new users (daily)",
        "metric_name_cn": "新用户流失数（日）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "churn流失",
        "weight": 911
    },
    {
        "metric_code": "churn_users_w2",
        "metric_code_name": "next_week_new_users_churn_count_weekly",
        "metric_desc": "Weekly: The number of new users who logged in last week but did not log in this week.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "churn of new users (weekly)",
        "metric_name_cn": "新用户流失数（周）",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "churn流失",
        "weight": 912
    },
    {
        "metric_code": "churn_users_m2",
        "metric_code_name": "next_month_new_users_churn_count_monthly",
        "metric_desc": "Monthly: The number of new users who logged in last month but did not log in this month.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "churn of new users (monthly)",
        "metric_name_cn": "新用户流失数（月）",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/overview/monthly",
        "label": "churn流失",
        "weight": 913
    },
    {
        "metric_code": "churn_d2",
        "metric_code_name": "next_day_new_users_churn_rate_daily",
        "metric_desc": "churn of new users/ new user",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "new users churn rate (daily)",
        "metric_name_cn": "新用户流失率（日）",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "churn流失",
        "weight": 914
    },
    {
        "metric_code": "churn_w2",
        "metric_code_name": "next_week_new_users_churn_rate_weekly",
        "metric_desc": "churn of new users/ new user",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "new users churn rate (weekly)",
        "metric_name_cn": "新用户流失率（周）",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "churn流失",
        "weight": 915
    },
    {
        "metric_code": "churn_m2",
        "metric_code_name": "next_month_new_users_churn_rate_monthly",
        "metric_desc": "churn of new users/ new user",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "new users churn rate (monthly)",
        "metric_name_cn": "新用户流失率（月）",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/overview/monthly",
        "label": "churn流失",
        "weight": 916
    },
    {
        "metric_code": "churn_users",
        "metric_code_name": "active_users_churn_count",
        "metric_desc": "Daily: The number of users who logged in yesterday but did not log in today; Weekly: The number of users who logged in last week but did not log in this week; Monthly: The number of users who logged in last month but did not log in this month",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "churn of active users",
        "metric_name_cn": "活跃用户流失数",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/churn/allUsers",
        "label": "churn流失",
        "weight": 917
    },
    {
        "metric_code": "churn_rate",
        "metric_code_name": "active_users_churn_rate",
        "metric_desc": "churn of active users / Active Users last time period",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "active users churn rate",
        "metric_name_cn": "活跃用户流失率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/churn/allUsers",
        "label": "churn流失",
        "weight": 918
    },
    {
        "metric_code": "churn_paid_users",
        "metric_code_name": "paying_users_churn_count",
        "metric_desc": "number of paying users churn: Total number of users who have had consuming behaviors in the game and have logged in during the second period before the statistical period, but have not logged in during the last period.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "churn of pay users",
        "metric_name_cn": "付费用户流失数",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/churn/allUsers",
        "label": "churn流失",
        "weight": 919
    },
    {
        "metric_code": "churn_paid_rate",
        "metric_code_name": "paying_users_churn_rate",
        "metric_desc": "churn rate of paying users: number of paying users churn/Number of active paying users in the previous day/week/month.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "pay users churn rate",
        "metric_name_cn": "付费用户流失率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/churn/allUsers",
        "label": "churn流失",
        "weight": 920
    },
    {
        "metric_code": "return_users",
        "metric_code_name": "return_users_count",
        "metric_desc": "return users = active users - new users - retention users",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "return users",
        "metric_name_cn": "回流用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/engagement/return",
        "label": "return回流",
        "weight": 952
    },
    {
        "metric_code": "wishlist_lifetime",
        "metric_code_name": "lifetime_wishlist_count",
        "metric_desc": "The total wishlist excludes the number of purchases & activations、gifts and deletions",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime Wishlist",
        "metric_name_cn": "累计愿望单数量",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "nan",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 701,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "wishlist_lifetime_add",
        "metric_code_name": "lifetime_wishlist_add_count_daily",
        "metric_desc": "The total wishlist",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime New Adds",
        "metric_name_cn": "累计愿望单新增",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "nan",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 702,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "wishlist_new_add",
        "metric_code_name": "new_wishlist_add_count_daily",
        "metric_desc": "Daily wishlist new adds",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Daily New Adds",
        "metric_name_cn": "日新增愿望单",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "nan",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 703,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "wishlist_net_add",
        "metric_code_name": "daily_wishlist_add_count_without_delete_purchase_gift_daily",
        "metric_desc": "Daily New Adds - Daily Deletes - Daily Purchases & Activations - Daily Gifts",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Daily Net Adds",
        "metric_name_cn": "日净增愿望单",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "nan",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 704,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "wishlist_delete",
        "metric_code_name": "daily_wishlist_delete_count_daily",
        "metric_desc": "Daily wishlist deletes",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Daily Deletes",
        "metric_name_cn": "日删除愿望单",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "nan",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 705,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "wishlist_lifetime_conversion_rate",
        "metric_code_name": "lifetime_wishlist_coversion_rate",
        "metric_desc": "Lifetime wishlist purchases & activations & Gifts / Lifetime New Adds",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Lifetime Conversion Rate",
        "metric_name_cn": "累计愿望单转化率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "nan",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 706,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "new_users",
        "metric_code_name": "new_users_count_realtime",
        "metric_desc": "Total number of newly-registered users from 0:00 to the current statistical time point on the statistical day (vopenid deduplicated from Play Register ).",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "New Users",
        "metric_name_cn": "新进用户",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 301,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "active_users",
        "metric_code_name": "active_users_count_realtime",
        "metric_desc": "Total number of users who have logged in to the game during the period from 0:00 to the current statistical time point on the statistical day (vopenid deduplicated from Play Login).",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Active Users",
        "metric_name_cn": "活跃用户",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 302,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "online_users",
        "metric_code_name": "online_users_count_realtime",
        "metric_desc": "Total number of concurrent users at the current statistical time point.",
        "metric_type": "mobile",
        "value_type": "numerical",
        "metric_name_en": "Concurrent Users",
        "metric_name_cn": "在线用户",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 303,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "d2",
        "metric_code_name": "next_day_new_users_retention_rate_realtime",
        "metric_desc": "Take T as the statistical day. Number of retained users from 0:00 to the current statistical time point on the statistical day / Number of new users on the day before the statistics day (T-1, registration date).",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "D2(T-1)",
        "metric_name_cn": "新进次留（T-1)",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 304,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "d3",
        "metric_code_name": "3_day_new_users_retention_rate_realtime",
        "metric_desc": "Take T as the statistical day. Number of retained users from 0:00 to the current statistical time point on the statistical day / Number of new users on two days before the statistics day (T-2, registration date).",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "D3(T-2)",
        "metric_name_cn": "新进3留（T-2)",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 305,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "d7",
        "metric_code_name": "7_day_new_users_retention_rate_realtime",
        "metric_desc": "Take T as the statistical day. Number of retained users from 0:00 to the current statistical time point on the statistical day / Number of new users on six days before the statistics day (T-6, registration date).",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "D7(T-6)",
        "metric_name_cn": "新进7留（T-6)",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 306,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "imoney",
        "metric_code_name": "revenue_realtime",
        "metric_desc": "Realtime Daily Accumulated Revenue (10 min)",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "Realtime Daily Accumulated Revenue (10 min)",
        "metric_name_cn": "每日实时累计付费金额（10分钟）",
        "granularity": [
            "realtime"
        ],
        "unit": "usd",
        "url": "/realtime/revenue",
        "label": "realtime实时类",
        "weight": 307,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "new_users",
        "metric_code_name": "new_users_count_realtime",
        "metric_desc": "Total number of newly-registered users from 0:00 to the current statistical time point on the statistical day (userid deduplicated from Play Register ).",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "New Users",
        "metric_name_cn": "新进用户",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 308,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "active_users",
        "metric_code_name": "active_users_count_realtime",
        "metric_desc": "Total number of users who have logged in to the game during the period from 0:00 to the current statistical time point on the statistical day (userid deduplicated from Play Login).",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Active Users",
        "metric_name_cn": "活跃用户",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 309,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "online_users",
        "metric_code_name": "online_users_count_realtime",
        "metric_desc": "Total number of concurrent users at the current statistical time point.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Concurrent Users",
        "metric_name_cn": "在线用户",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 310,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "d2",
        "metric_code_name": "next_day_new_users_retention_rate_realtime",
        "metric_desc": "The retention rate of new register users on day 1. Number of retained users on day 1 from XX (registration date) / Number of new users on XX (registration date). Registration date is day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "D1(T-1)",
        "metric_name_cn": "新进D1留存(T-1)",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 311
    },
    {
        "metric_code": "d3",
        "metric_code_name": "3_day_new_users_retention_rate_realtime",
        "metric_desc": "The retention rate of new register users on day 2. Number of retained users on day 2 from XX (registration date) / Number of new users on XX (registration date). Registration date is day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "D2(T-2)",
        "metric_name_cn": "新进D2留存(T-2)",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 312
    },
    {
        "metric_code": "d7",
        "metric_code_name": "7_day_new_users_retention_rate_realtime",
        "metric_desc": "The retention rate of new register users on day7. Number of retained users on day 7 from XX (registration date) / Number of new users on XX (registration date). Registration date is day 0.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "D7(T-7)",
        "metric_name_cn": "新进D7留存(T-7)",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 313
    },
    {
        "metric_code": "imoney",
        "metric_code_name": "revenue_realtime",
        "metric_desc": "Realtime Daily Accumulated Revenue (10 min)",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Realtime Daily Accumulated Revenue (10 min)",
        "metric_name_cn": "每日实时累计付费金额（10分钟）",
        "granularity": [
            "realtime"
        ],
        "unit": "usd",
        "url": "/realtime/revenue",
        "label": "realtime实时类",
        "weight": 314,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "steam_ccu",
        "metric_code_name": "steam_concurrent_users_ccu_realtime",
        "metric_desc": "Realtime Steam Concurrent User",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Realtime steam CCU",
        "metric_name_cn": "实时Steam 在线",
        "granularity": [
            "realtime"
        ],
        "unit": "users",
        "url": "/realtime/users",
        "label": "realtime实时类",
        "weight": 315,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "gross_full_game_units",
        "metric_code_name": "gross_full_game_units_realtime",
        "metric_desc": "Gross full game unit sales",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Realtime gross full game units sold",
        "metric_name_cn": "实时本体销量",
        "granularity": [
            "realtime"
        ],
        "unit": "usd",
        "url": "/realtime/revenue",
        "label": "realtime实时类",
        "weight": 316,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "net_full_game_units",
        "metric_code_name": "full_game_units_after_refund_realtime",
        "metric_desc": "Net full game unit sales after refund",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Realtime base game units after refund",
        "metric_name_cn": "实时本体销量（剔除退款）",
        "granularity": [
            "realtime"
        ],
        "unit": "usd",
        "url": "/realtime/revenue",
        "label": "realtime实时类",
        "weight": 317,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "net_revenue",
        "metric_code_name": "revenue_after_tax_and_refund_realtime",
        "metric_desc": "Net revenue after tax and refund",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Realtime net revenue after tax and refund",
        "metric_name_cn": "实时本体收入（剔除退款&税）",
        "granularity": [
            "realtime"
        ],
        "unit": "usd",
        "url": "/realtime/revenue",
        "label": "realtime实时类",
        "weight": 318,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "refund_rate",
        "metric_code_name": "refund_rate_realtime",
        "metric_desc": "Refund rate",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Realtime refund rate",
        "metric_name_cn": "实时退款率",
        "granularity": [
            "realtime"
        ],
        "unit": "ratio",
        "url": "/realtime/revenue",
        "label": "realtime实时类",
        "weight": 319,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "gross_refund_after_revenue",
        "metric_code_name": "gross_revenue_after_refund_realtime",
        "metric_desc": "Gross_refund_after_revenue",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Realtime gross revenue after refund",
        "metric_name_cn": "实时总收入（剔除退款）",
        "granularity": [
            "realtime"
        ],
        "unit": "ratio",
        "url": "/realtime/revenue",
        "label": "realtime实时类",
        "weight": 320,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "profit",
        "metric_code_name": "profit_realtime",
        "metric_desc": "profit",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Realtime profit",
        "metric_name_cn": "实时利润",
        "granularity": [
            "realtime"
        ],
        "unit": "ratio",
        "url": "/realtime/revenue",
        "label": "realtime实时类",
        "weight": 321
    },
    {
        "metric_code": "crash_count",
        "metric_code_name": "crash_count",
        "metric_desc": "All crashes in production env，For each server crash, every affected player contributes 1 to the count.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Crash count",
        "metric_name_cn": "崩溃数",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 801,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "crash_rate",
        "metric_code_name": "crash_rate",
        "metric_desc": "In general 'crash rate' will refer to session crash rate.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Crash rate",
        "metric_name_cn": "崩溃率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 802,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "session_crash_rate",
        "metric_code_name": "session_crash_rate",
        "metric_desc": "Percentage of crash per session, expressed in %",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Session crash rate",
        "metric_name_cn": "会话崩溃率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 803
    },
    {
        "metric_code": "user_crash_rate",
        "metric_code_name": "user_crash_rate",
        "metric_desc": "distinct crash user count / distinct total user count * 100%",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "User Crash Rate",
        "metric_name_cn": "用户崩溃率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 804
    },
    {
        "metric_code": "device_crash_rate",
        "metric_code_name": "device_crash_rate",
        "metric_desc": "distinct crash device count / distinct total device count * 100%",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Device Crash Rate",
        "metric_name_cn": "设备崩溃率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 805
    },
    {
        "metric_code": "mtbc",
        "metric_code_name": "mean_time_between_crashes",
        "metric_desc": "An important metric where the players total playtime is taken into account and the metric is not skewed by continuous crashes during startup, expressed in hours",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Mean Time Between Crashes (MTBC)",
        "metric_name_cn": "MTBC",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 806,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "median_fps",
        "metric_code_name": "median_fps",
        "metric_desc": "The average number of frames rendered per second over a given time period. This reflects the overall performance of the game from a fluidity perspective.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "AVG(Median) FPS",
        "metric_name_cn": "平均FPS",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 807,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "one_percent_low_fps",
        "metric_code_name": "average_lowest_1_percent_fps",
        "metric_desc": "The average FPS of the lowest 1% of frame time samples. This indicates how bad performance can get during frame drops or stutter spikes, and is often used to measure worst-case scenarios.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "1% Low FPS",
        "metric_name_cn": "最低1%FPS",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 808,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "p50_ping_country",
        "metric_code_name": "median_ping",
        "metric_desc": "The 50th percentile of player ping values, representing typical, higher, and worst-case network latency. Higher values indicate worse performance.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "P50 Ping",
        "metric_name_cn": "第50百分位数Ping值",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 809,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "p80_ping_country",
        "metric_code_name": "80_percentile_ping",
        "metric_desc": "The 80th percentile of player ping values, representing typical, higher, and worst-case network latency. Higher values indicate worse performance.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "P80 Ping",
        "metric_name_cn": "第80百分位数Ping值",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 810,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "p95_ping_country",
        "metric_code_name": "95_percentile_ping",
        "metric_desc": "The 95th percentile of player ping values, representing typical, higher, and worst-case network latency. Higher values indicate worse performance.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "P95 Ping",
        "metric_name_cn": "第95百分位数Ping值",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 811,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "ping_0to60_count",
        "metric_code_name": "0_to_60_ms_ping_player_rate",
        "metric_desc": "The percentage of players falling within predefined ping value ranges (e.g., <50ms, 50–100ms, >200ms), based on thresholds defined by GTDR or studio standards. Used to evaluate overall network quality.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Ping (0-60) Distribution",
        "metric_name_cn": "Ping（0-60）分布值",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 812,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "ping_60to80_count",
        "metric_code_name": "60_to_80_ms_ping_player_rate",
        "metric_desc": "The percentage of players falling within predefined ping value ranges (e.g., <50ms, 50–100ms, >200ms), based on thresholds defined by GTDR or studio standards. Used to evaluate overall network quality.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Ping (60-80) Distribution",
        "metric_name_cn": "Ping（60-80）分布值",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 813,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "ping_80to120_count",
        "metric_code_name": "80_to_120_ms_ping_player_rate",
        "metric_desc": "The percentage of players falling within predefined ping value ranges (e.g., <50ms, 50–100ms, >200ms), based on thresholds defined by GTDR or studio standards. Used to evaluate overall network quality.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Ping (80-120) Distribution",
        "metric_name_cn": "Ping（80-120）分布值",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 814,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "ping_120to150_count",
        "metric_code_name": "120_to_150_ms_ping_player_rate",
        "metric_desc": "The percentage of players falling within predefined ping value ranges (e.g., <50ms, 50–100ms, >200ms), based on thresholds defined by GTDR or studio standards. Used to evaluate overall network quality.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Ping (120-150) Distribution",
        "metric_name_cn": "Ping（120-150）分布值",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 815,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "ping_150to200_count",
        "metric_code_name": "150_to_200_ms_ping_player_rate",
        "metric_desc": "The percentage of players falling within predefined ping value ranges (e.g., <50ms, 50–100ms, >200ms), based on thresholds defined by GTDR or studio standards. Used to evaluate overall network quality.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Ping (150-200) Distribution",
        "metric_name_cn": "Ping（150-200）分布值",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 816,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "ping_200to300_count",
        "metric_code_name": "200_to_300_ms_ping_player_rate",
        "metric_desc": "The percentage of players falling within predefined ping value ranges (e.g., <50ms, 50–100ms, >200ms), based on thresholds defined by GTDR or studio standards. Used to evaluate overall network quality.",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Ping (200-300) Distribution",
        "metric_name_cn": "Ping（200-300）分布值",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "nan",
        "label": "technical技术性能(for pc/console game)",
        "weight": 817,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "avg_net_revenue",
        "metric_code_name": "average_revenue_after_refund_and_tax",
        "metric_desc": "Daily Average Net Revenue during the statistical period, the net sales revenue of 4 sales platforms, including Steam, Epic, Xbox, and Playstation,Net Revenue excludes refunds and is net of taxes",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "week average revenue after Refund&TAX",
        "metric_name_cn": "日平均收入(剔除退款&税)",
        "granularity": [
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/overview/weekly",
        "label": "revenue收入",
        "weight": 156
    },
    {
        "metric_code": "avg_units_number",
        "metric_code_name": "average_base_game_units_sold_after_refund",
        "metric_desc": "Daily Average Full Game Units during the statistical period, the net sales of the game itself include sales of full game, edition, etc. Data Source: Platform Sales Reports",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "week average Base Game Units After Refund",
        "metric_name_cn": "日平均本体销量(剔除退款)",
        "granularity": [
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "sale销量(for pc/console game)",
        "weight": 157
    },
    {
        "metric_code": "full_game_refund_rate",
        "metric_code_name": "base_game_refund_rate",
        "metric_desc": "Base Game Refund Rate = chargeback units of the base game/gross sold units of the base game",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Refund Base Game Rate",
        "metric_name_cn": "本体退款率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview",
        "label": "refund退款(for pc/console game)",
        "weight": 158,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "third_party_units",
        "metric_code_name": "third_party_units",
        "metric_desc": "The number of games sold on third-party platforms (e.g., Humble Bundle, Heybox) and activated on Steam includes only Steam platform data.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Third-party Units",
        "metric_name_cn": "第三方销量",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "sale销量(for pc/console game)",
        "weight": 159,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "lifetime_profit",
        "metric_code_name": "lifetime_profit",
        "metric_desc": "The Lifetime Revenue is calculated as the net lifetime revenue since preorder, which is the gross lifetime revenue minus the lifetime refund and tax, after deducting the platform fees.Note: The share of the platform fee is estimated/provided by the studio, and retail revenue is excluded.Data source: Steam（PST time zone）",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Lifetime profit",
        "metric_name_cn": "累计利润",
        "granularity": [
            "realtime"
        ],
        "unit": "usd",
        "url": "/realtime/sales",
        "label": "realtime实时类",
        "weight": 322
    },
    {
        "metric_code": "lifetime_gross_units",
        "metric_code_name": "lifetime_gross_units_sold",
        "metric_desc": "The number of cumulative historical Steam Base Game units sold includes refunds but excludes retail units (e.g., Humble Bundle, Heybox). Data source: Steam platforms Time zone: Steam sales data is in PST time zone",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime Gross Units",
        "metric_name_cn": "累计总销量",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/lifetime",
        "label": "sale销量(for pc/console game)",
        "weight": 160,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "total_mtx_revenue",
        "metric_code_name": "lifetime_in_game_revenue",
        "metric_desc": "The cumulative amounts from microtransactions , during the launch time to the selected date",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Lifetime In-Game Revenue",
        "metric_name_cn": "累计内购收入",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "usd",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 161,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "total_mtx_payers",
        "metric_code_name": "lifetime_in_game_paying_users_count",
        "metric_desc": "The cumulative of users who have in-game payment behaviors, during the launch time to the selected date. (deduplicated)",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime In-Game Payers",
        "metric_name_cn": "累计内购付费用户数",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 162,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "total_mtx_payer_rate",
        "metric_code_name": "lifetime_in_game_paying_users_ratio",
        "metric_desc": "Number of in-game paying users/Number of active users during the launch time to the selected date",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Lifetime In-Game Payers %",
        "metric_name_cn": "累计内购付费渗透率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 163,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "total_pay_days",
        "metric_code_name": "total_pay_days",
        "metric_desc": "All users total pay days from the date of registration",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Total Pay Days",
        "metric_name_cn": "所有用户累计付费天数",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "in-game revenue游戏内收入(for pc/console game)",
        "weight": 164
    },
    {
        "metric_code": "cumulative_crash_count",
        "metric_code_name": "cumulative_crash_count",
        "metric_desc": "Total number of crashes accumulated for the day",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Cumulative session count",
        "metric_name_cn": "当天累计崩溃数",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview",
        "label": "technical技术性能(for pc/console game)",
        "weight": 818,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "gross_units_sold_realtime",
        "metric_code_name": "gross_units_sold_realtime",
        "metric_desc": "The total units sold of all products (Base Game, DLC, Bundles, MTX) includes refunds but excludes retail units (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Gross Units",
        "metric_name_cn": "产品销量",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "realtime实时类",
        "weight": 323
    },
    {
        "metric_code": "net_units_sold_realtime",
        "metric_code_name": "units_sold_after_refund_realtime",
        "metric_desc": "The total units sold of all products (Base Game, DLC, Bundles, MTX) excludes refunds and retail units (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Units After Refund",
        "metric_name_cn": "产品销量(剔除退款)",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "realtime实时类",
        "weight": 324,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "lifetime_net_revenue_realtime",
        "metric_code_name": "lifetime_revenue_after_refund_and_tax_realtime",
        "metric_desc": "The cumulative historical revenue from sales of all products (Base Game, DLC, Bundle, MTX) includes platform shares but excludes refunds, taxes, and retail revenue (e.g., Humble Bundle, Heybox).",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Lifetime Revenue After Refund&TAX",
        "metric_name_cn": "累计收入(剔除退款&税）",
        "granularity": [
            "realtime"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "realtime实时类",
        "weight": 325
    },
    {
        "metric_code": "lifetime_revenue_after_refund_realtime",
        "metric_code_name": "lifetime_revenue_after_refund_realtime",
        "metric_desc": "The cumulative historical revenue from sales of all products (Base Game, DLC, Bundle, MTX) includes platform shares and tax but excludes refunds and retail revenue.",
        "metric_type": "pc/console",
        "value_type": "float",
        "metric_name_en": "Lifetime Revenue After Refund",
        "metric_name_cn": "累计收入(剔除退款）",
        "granularity": [
            "realtime"
        ],
        "unit": "usd",
        "url": "/monetization/salesOverview",
        "label": "realtime实时类",
        "weight": 326,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "lifetime_full_game_gross_units_realtime",
        "metric_code_name": "lifetime_base_game_gross_units_sold_realtime",
        "metric_desc": "The number of cumulative historical Base Game units sold includes refunds but excludes retail units.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime Gross Base Game Units",
        "metric_name_cn": "累计本体销量",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "realtime实时类",
        "weight": 327,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "lifetime_full_game_net_units_realtime",
        "metric_code_name": "lifetime_base_game_units_sold_after_refund_realtime",
        "metric_desc": "The number of cumulative historical Base Game units sold excludes refunds and retail units.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime Base Game Units After Refund",
        "metric_name_cn": "累计本体净销量(剔除退款）",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "realtime实时类",
        "weight": 328,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "lifetime_refund_rate_realtime",
        "metric_code_name": "lifetime_refund_rate_realtime",
        "metric_desc": "Lifetime Refund Units/Lifetime Gross Units； Units include all types of products (Base Game, DLC, Bundles, MTX)",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Lifetime Refund Rate",
        "metric_name_cn": "累计退款率",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/monetization/salesOverview",
        "label": "realtime实时类",
        "weight": 329,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "above_2hr_users",
        "metric_code_name": "new_users_count_online_time_over_2_hours",
        "metric_desc": "The number of new users whose online time exceeds 2 hours during the statistical period",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Playtime over 2h+ new users",
        "metric_name_cn": "在线时长2小时以上新进用户数",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "users",
        "url": "/overview/daily",
        "label": "new user新进",
        "weight": 403,
        "active": 1,
        "unsupported_aggregation": []
    },
    {
        "metric_code": "login_funnel",
        "metric_code_name": "login_funnel",
        "metric_desc": "The completion rate benchmarks below reflect system-level technical performance metrics only. User interaction stages are excluded from benchmarking due to the inherent difficulty in isolating technical issues from UX design factors and natural user drop-off.",
        "metric_type": "pc/console",
        "value_type": "nan",
        "metric_name_en": "Player Entry Funnel",
        "metric_name_cn": "玩家进入漏斗",
        "granularity": [
            "realtime"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "realtime实时类",
        "weight": 330
    },
    {
        "metric_code": "steam_lifetime_purchases_activations",
        "metric_code_name": "lifetime_steam_wishlist_purchases_activations",
        "metric_desc": "Lifetime wishlist purchases & activations & gifts",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime Purchases & Activations",
        "metric_name_cn": "nan",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 707,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "steam_lifetime_gifts",
        "metric_code_name": "lifetime_steam_wishlist_gifts",
        "metric_desc": "Lifetime wishlist gifts",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime Gifts",
        "metric_name_cn": "nan",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 708,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "steam_lifetime_deletes",
        "metric_code_name": "lifetime_steam_wishlist_deletes",
        "metric_desc": "Lifetime  wishlist deletes by users",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime Deletes",
        "metric_name_cn": "nan",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 709,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "wishlist_lifetime_conversion",
        "metric_code_name": "lifetime_steam_wishlist_conversion_count",
        "metric_desc": "Lifetime wishlist purchases & activations &Gifts/Lifetime New Adds",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Lifetime Conversion",
        "metric_name_cn": "累计愿望单转化",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 710,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "wishlist_conversion",
        "metric_code_name": "steam_wishlist_conversion_daily",
        "metric_desc": "Daily wishlist purchases, activations and gifts number",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Daily Conversion",
        "metric_name_cn": "每日转化",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 711
    },
    {
        "metric_code": "wishlist_conversion_rate",
        "metric_code_name": "steam_wishlist_conversion_rate_daily",
        "metric_desc": "Daily wishlist purchases & activations &Gifts/Lifetime New Adds",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Daily Conversion Rate",
        "metric_name_cn": "每日转化率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 712
    },
    {
        "metric_code": "steam_daily_purchases_activations",
        "metric_code_name": "steam_wishlist_purchases_activations_daily",
        "metric_desc": "Daily wishlist purchases & activations",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Daily Purchases & Activations",
        "metric_name_cn": "nan",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 713
    },
    {
        "metric_code": "steam_daily_gifts",
        "metric_code_name": "steam_wishlist_gifts_daily",
        "metric_desc": "Daily wishlist Gifts",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Daily Gifts",
        "metric_name_cn": "nan",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 714
    },
    {
        "metric_code": "steam_daily_wishlist",
        "metric_code_name": "steam_wishlist_daily",
        "metric_desc": "Daily wishlist new adds - deletes - purchases - activation on Steam platform",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Daily wishlist",
        "metric_name_cn": "每日愿望单数量",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "wishlist 愿望单(for pc/console game)",
        "weight": 716
    },
    {
        "metric_code": "return_d2",
        "metric_code_name": "next_day_return_users_retention_rate_daily",
        "metric_desc": "Percentage of returned users who were active on day N and returned to be active again on day N+1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "day2 retention ratio（return）",
        "metric_name_cn": "回流用户2天留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 668
    },
    {
        "metric_code": "return_d3",
        "metric_code_name": "3_day_return_users_retention_rate_daily",
        "metric_desc": "Percentage of returned users who were active on day N and returned to be active again on day N+2",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "day3 retention ratio（return）",
        "metric_name_cn": "回流用户3天留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 669
    },
    {
        "metric_code": "return_d4",
        "metric_code_name": "4_day_return_users_retention_rate_daily",
        "metric_desc": "Percentage of returned users who were active on day N and returned to be active again on day N+3",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "day4 retention ratio（return）",
        "metric_name_cn": "回流用户4天留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 670
    },
    {
        "metric_code": "return_d5",
        "metric_code_name": "5_day_return_users_retention_rate_daily",
        "metric_desc": "Percentage of returned users who were active on day N and returned to be active again on day N+4",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "day5 retention ratio（return）",
        "metric_name_cn": "回流用户5天留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 671
    },
    {
        "metric_code": "return_d6",
        "metric_code_name": "6_day_return_users_retention_rate_daily",
        "metric_desc": "Percentage of returned users who were active on day N and returned to be active again on day N+5",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "day6 retention ratio（return）",
        "metric_name_cn": "回流用户6天留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 672
    },
    {
        "metric_code": "return_d7",
        "metric_code_name": "7_day_return_users_retention_rate_daily",
        "metric_desc": "Percentage of returned users who were active on day N and returned to be active again on day N+6",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "day7 retention ratio（return）",
        "metric_name_cn": "回流用户7天留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 673
    },
    {
        "metric_code": "return_d14",
        "metric_code_name": "14_day_return_users_retention_rate_daily",
        "metric_desc": "Percentage of returned users who were active on day N and returned to be active again on day N+13",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "day14 retention ratio（return）",
        "metric_name_cn": "回流用户14天留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 674
    },
    {
        "metric_code": "return_d30",
        "metric_code_name": "30_day_return_users_retention_rate_daily",
        "metric_desc": "Percentage of returned users who were active on day N and returned to be active again on day N+29",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "day30 retention ratio（return）",
        "metric_name_cn": "回流用户30天留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 675
    },
    {
        "metric_code": "w5",
        "metric_code_name": "5_week_new_users_retention_rate_weekly",
        "metric_desc": "5-week user retention rate of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "W5",
        "metric_name_cn": "5周留存",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "retention留存",
        "weight": 676,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "w6",
        "metric_code_name": "6_week_new_users_retention_rate_weekly",
        "metric_desc": "6-week user retention rate of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "W6",
        "metric_name_cn": "6周留存",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "retention留存",
        "weight": 677,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "w7",
        "metric_code_name": "7_week_new_users_retention_rate_weekly",
        "metric_desc": "7-week user retention rate of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "W7",
        "metric_name_cn": "7周留存",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/overview/weekly",
        "label": "retention留存",
        "weight": 678,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_w2",
        "metric_code_name": "next_week_active_users_retention_rate_weekly",
        "metric_desc": "Percentage of users who were active in week N and returned to be active again in week N+1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "w2 retention ratio (active)",
        "metric_name_cn": "活跃2周留存率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 679,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_w3",
        "metric_code_name": "3_week_active_users_retention_rate_weekly",
        "metric_desc": "Percentage of users who were active in week N and returned to be active again in week N+2",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "w3 retention ratio (active)",
        "metric_name_cn": "活跃3周留存率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 680,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_w4",
        "metric_code_name": "4_week_active_users_retention_rate_weekly",
        "metric_desc": "Percentage of users who were active in week N and returned to be active again in week N+3",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "w4 retention ratio (active)",
        "metric_name_cn": "活跃4周留存率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 681,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_w5",
        "metric_code_name": "5_week_active_users_retention_rate_weekly",
        "metric_desc": "Percentage of users who were active in week N and returned to be active again in week N+4",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "w5 retention ratio (active)",
        "metric_name_cn": "活跃5周留存率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 682,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_w6",
        "metric_code_name": "6_week_active_users_retention_rate_weekly",
        "metric_desc": "Percentage of users who were active in week N and returned to be active again in week N+5",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "w6 retention ratio (active)",
        "metric_name_cn": "活跃6周留存率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 683,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_w7",
        "metric_code_name": "7_week_active_users_retention_rate_weekly",
        "metric_desc": "Percentage of users who were active in week N and returned to be active again in week N+6",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "w7 retention ratio (active)",
        "metric_name_cn": "活跃7周留存率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 684,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "return_w2",
        "metric_code_name": "next_week_return_users_retention_rate_weekly",
        "metric_desc": "Percentage of returned users who were active in week N and returned to be active again in week N+1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "week2 retention ratio（return）",
        "metric_name_cn": "回流用户2周留存率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 685
    },
    {
        "metric_code": "return_w3",
        "metric_code_name": "3_week_return_users_retention_rate_weekly",
        "metric_desc": "Percentage of returned users who were active in week N and returned to be active again in week N+2",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "week3 retention ratio（return）",
        "metric_name_cn": "回流用户3周留存率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 686
    },
    {
        "metric_code": "return_w4",
        "metric_code_name": "4_week_return_users_retention_rate_weekly",
        "metric_desc": "Percentage of returned users who were active in week N and returned to be active again in week N+3",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "week4 retention ratio（return）",
        "metric_name_cn": "回流用户4周留存率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 687
    },
    {
        "metric_code": "return_w5",
        "metric_code_name": "5_week_return_users_retention_rate_weekly",
        "metric_desc": "Percentage of returned users who were active in week N and returned to be active again in week N+4",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "week5 retention ratio（return）",
        "metric_name_cn": "回流用户5周留存率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 688
    },
    {
        "metric_code": "return_w6",
        "metric_code_name": "6_week_return_users_retention_rate_weekly",
        "metric_desc": "Percentage of returned users who were active in week N and returned to be active again in week N+5",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "week6 retention ratio（return）",
        "metric_name_cn": "回流用户6周留存率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 689
    },
    {
        "metric_code": "return_w7",
        "metric_code_name": "7_week_return_users_retention_rate_weekly",
        "metric_desc": "Percentage of returned users who were active in week N and returned to be active again in week N+6",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "week7 retention ratio（return）",
        "metric_name_cn": "回流用户7周留存率",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 690
    },
    {
        "metric_code": "m5",
        "metric_code_name": "5_month_new_users_retention_rate_monthly",
        "metric_desc": "5-month user retention rate of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "M5",
        "metric_name_cn": "5月留存",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/overview/monthly",
        "label": "retention留存",
        "weight": 691,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "m6",
        "metric_code_name": "6_month_new_users_retention_rate_monthly",
        "metric_desc": "6-month user retention rate of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "M6",
        "metric_name_cn": "6月留存",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/overview/monthly",
        "label": "retention留存",
        "weight": 692,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "m7",
        "metric_code_name": "7_month_new_users_retention_rate_monthly",
        "metric_desc": "7-month user retention rate of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "M7",
        "metric_name_cn": "7月留存",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/overview/monthly",
        "label": "retention留存",
        "weight": 693,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_m2",
        "metric_code_name": "next_month_active_users_retention_rate_monthly",
        "metric_desc": "Percentage of users who were active in month N and returned to be active again in month N+1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "m2 retention ratio (active)",
        "metric_name_cn": "活跃2月留存率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 694,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_m3",
        "metric_code_name": "3_month_active_users_retention_rate_monthly",
        "metric_desc": "Percentage of users who were active in month N and returned to be active again in month N+2",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "m3 retention ratio (active)",
        "metric_name_cn": "活跃3月留存率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 695,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_m4",
        "metric_code_name": "4_month_active_users_retention_rate_monthly",
        "metric_desc": "Percentage of users who were active in month N and returned to be active again in month N+3",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "m4 retention ratio (active)",
        "metric_name_cn": "活跃4月留存率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 696,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_m5",
        "metric_code_name": "5_month_active_users_retention_rate_monthly",
        "metric_desc": "Percentage of users who were active in month N and returned to be active again in month N+4",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "m5 retention ratio (active)",
        "metric_name_cn": "活跃5月留存率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 697,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_m6",
        "metric_code_name": "6_month_active_users_retention_rate_monthly",
        "metric_desc": "Percentage of users who were active in month N and returned to be active again in month N+5",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "m6 retention ratio (active)",
        "metric_name_cn": "活跃6月留存率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 698,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "active_retention_m7",
        "metric_code_name": "7_month_active_users_retention_rate_monthly",
        "metric_desc": "Percentage of users who were active in month N and returned to be active again in month N+6",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "m7 retention ratio (active)",
        "metric_name_cn": "活跃7月留存率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/retention/index/activeUsers",
        "label": "retention留存",
        "weight": 699,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "return_m2",
        "metric_code_name": "next_month_return_users_retention_rate_monthly",
        "metric_desc": "Percentage of returned users who were active in month N and returned to be active again in month N+1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "month2 retention ratio（return）",
        "metric_name_cn": "回流用户2月留存率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 700
    },
    {
        "metric_code": "return_m3",
        "metric_code_name": "3_month_return_users_retention_rate_monthly",
        "metric_desc": "Percentage of returned users who were active in month N and returned to be active again in month N+1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "month3 retention ratio（return）",
        "metric_name_cn": "回流用户3月留存率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 701
    },
    {
        "metric_code": "return_m4",
        "metric_code_name": "4_month_return_users_retention_rate_monthly",
        "metric_desc": "Percentage of returned users who were active in month N and returned to be active again in month N+1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "month4 retention ratio（return）",
        "metric_name_cn": "回流用户4月留存率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 702
    },
    {
        "metric_code": "return_m5",
        "metric_code_name": "5_month_return_users_retention_rate_monthly",
        "metric_desc": "Percentage of returned users who were active in month N and returned to be active again in month N+1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "month5 retention ratio（return）",
        "metric_name_cn": "回流用户5月留存率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 703
    },
    {
        "metric_code": "return_m6",
        "metric_code_name": "6_month_return_users_retention_rate_monthly",
        "metric_desc": "Percentage of returned users who were active in month N and returned to be active again in month N+1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "month6 retention ratio（return）",
        "metric_name_cn": "回流用户6月留存率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 704
    },
    {
        "metric_code": "return_m7",
        "metric_code_name": "7_month_return_users_retention_rate_monthly",
        "metric_desc": "Percentage of returned users who were active in month N and returned to be active again in month N+1",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "month7 retention ratio（return）",
        "metric_name_cn": "回流用户7月留存率",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/retention/index/returnUsers",
        "label": "retention留存",
        "weight": 705
    },
    {
        "metric_code": "arpp",
        "metric_code_name": "average_single_payment_amount",
        "metric_desc": "Total amount actually paid by total players during the statistical period/Number of times the payment.",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "ARPP",
        "metric_name_cn": "单次付费收益",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "revenue收入",
        "weight": 165
    },
    {
        "metric_code": "avg_pay_amount",
        "metric_code_name": "average_pay_amount_weekly",
        "metric_desc": "Average total amount players paid during the statistical week",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "average weekly revenue",
        "metric_name_cn": "周平均付费金额",
        "granularity": [
            "weekly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "revenue收入",
        "weight": 166
    },
    {
        "metric_code": "avg_pay_amount",
        "metric_code_name": "average_pay_amount_monthly",
        "metric_desc": "Average total amount players paid during the statistical month",
        "metric_type": "mobile",
        "value_type": "float",
        "metric_name_en": "average monthly revenue",
        "metric_name_cn": "月平均付费金额",
        "granularity": [
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "revenue收入",
        "weight": 167
    },
    {
        "metric_code": "new_payer_rate",
        "metric_code_name": "new_player_pay_rate",
        "metric_desc": "Number of paid new players / Number of new players",
        "metric_type": "mobile",
        "value_type": "percent",
        "metric_name_en": "payer%(new users)",
        "metric_name_cn": "付费渗透率（新进用户）",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/monetization/revenue",
        "label": "revenue收入",
        "weight": 168,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "total_users",
        "metric_code_name": "lifetime_new_users_count",
        "metric_desc": "Total Users",
        "metric_type": "casual",
        "value_type": "numerical",
        "metric_name_en": "total new users",
        "metric_name_cn": "总新进用户数",
        "granularity": [
            "daily",
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "new user新进用户",
        "weight": 405,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean",
            "min",
            "max"
        ]
    },
    {
        "metric_code": "new_users",
        "metric_code_name": "new_users_count",
        "metric_desc": "New Register Users. newly-registered users, also known as downloads",
        "metric_type": "casual",
        "value_type": "numerical",
        "metric_name_en": "new users",
        "metric_name_cn": "新进用户",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "new user新进用户",
        "weight": 406,
        "active": 1
    },
    {
        "metric_code": "active_users",
        "metric_code_name": "active_users_count",
        "metric_desc": "Daily Active Users(DAU) or Weekly Active Users(WAU) or Monthly Active Users(MAU)",
        "metric_type": "casual",
        "value_type": "numerical",
        "metric_name_en": "Daily Active Users",
        "metric_name_cn": "日活跃",
        "granularity": [
            "daily",
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "active users活跃",
        "weight": 224,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "iaa_revenue",
        "metric_code_name": "advertisement_revenue",
        "metric_desc": "Total Ad Revenue Generated from Players' Ad Views",
        "metric_type": "casual",
        "value_type": "float",
        "metric_name_en": "IAA Revenue",
        "metric_name_cn": "广告收入",
        "granularity": [
            "daily",
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 169,
        "active": 1
    },
    {
        "metric_code": "cpi",
        "metric_code_name": "cost_per_install_cpi",
        "metric_desc": "Cost Per Install",
        "metric_type": "casual",
        "value_type": "float",
        "metric_name_en": "CPI",
        "metric_name_cn": "单用户安装成本",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "new user新进用户",
        "weight": 407,
        "active": 1
    },
    {
        "metric_code": "new_organic_rate",
        "metric_code_name": "organic_new_users_ratio",
        "metric_desc": "organic new users/new users",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "Organic",
        "metric_name_cn": "自然量占比",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "new user新进用户",
        "weight": 408,
        "active": 1
    },
    {
        "metric_code": "fraud_active_users_rate",
        "metric_code_name": "fake_active_users_rate",
        "metric_desc": "Fake Active User Count / DAU %",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "Fake DAU",
        "metric_name_cn": "假量DAU",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "active users活跃",
        "weight": 225,
        "active": 1
    },
    {
        "metric_code": "spend",
        "metric_code_name": "advertisement_spend",
        "metric_desc": "UA Spend",
        "metric_type": "casual",
        "value_type": "float",
        "metric_name_en": "Spend",
        "metric_name_cn": "UA花费",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "new user新进用户",
        "weight": 409,
        "active": 1
    },
    {
        "metric_code": "roi",
        "metric_code_name": "revenue_on_spend_roi",
        "metric_desc": "Revenue/Spend",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "Revenue/Spend",
        "metric_name_cn": "收入/花费",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 170,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "new_user_arpu",
        "metric_code_name": "new_user_average_revenue_per_users_arpu",
        "metric_desc": "Revenue generated by new users during the statistical period / Number of new users during the statistical period",
        "metric_type": "casual",
        "value_type": "float",
        "metric_name_en": "New User ARPU",
        "metric_name_cn": "新进ARPU",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入",
        "weight": 171,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "arpu",
        "metric_code_name": "average_revenue_per_users_arpu",
        "metric_desc": "Average Revenue Per Active Users, ARPU",
        "metric_type": "casual",
        "value_type": "float",
        "metric_name_en": "Active ARPU",
        "metric_name_cn": "活跃ARPU",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入",
        "weight": 172,
        "active": 1,
        "unsupported_aggregation": [
            "sum"
        ]
    },
    {
        "metric_code": "d2",
        "metric_code_name": "next_day_new_users_retention_rate_daily",
        "metric_desc": "the next day retention rate of new players, 次日留存",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "D2",
        "metric_name_cn": "D2留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 706,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d3",
        "metric_code_name": "3_day_new_users_retention_rate_daily",
        "metric_desc": "New 3-day user retention rate of new players, 三日留存",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "D3",
        "metric_name_cn": "D3留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 706,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d4",
        "metric_code_name": "4_day_new_users_retention_rate_daily",
        "metric_desc": "New 4-day user retention rate of new players, 四日留存",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "D4",
        "metric_name_cn": "D4留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 706,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d5",
        "metric_code_name": "5_day_new_users_retention_rate_daily",
        "metric_desc": "New 5-day user retention rate of new players, 五日留存",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "D5",
        "metric_name_cn": "D5留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 706,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d6",
        "metric_code_name": "6_day_new_users_retention_rate_daily",
        "metric_desc": "New 6-day user retention rate of new players, 六日留存",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "D6",
        "metric_name_cn": "D6留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 706,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d7",
        "metric_code_name": "7_day_new_users_retention_rate_daily",
        "metric_desc": "New 7-day user retention rate of new players, 七日留存",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "D7",
        "metric_name_cn": "D7留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 706,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d14",
        "metric_code_name": "14_day_new_users_retention_rate_daily",
        "metric_desc": "New 14-day user retention rate of new players, 十四日留存",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "D14",
        "metric_name_cn": "D14留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 706,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "d30",
        "metric_code_name": "30_day_new_users_retention_rate_daily",
        "metric_desc": "New 30-day user retention rate of new players, 三十日留存",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "D30",
        "metric_name_cn": "D30留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 706,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "roas1",
        "metric_code_name": "return_on_ad_spend_d1",
        "metric_desc": "Return on Ad Spend:SUM(Cohort Revenue from Install)/SUM(UA Spend)",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "ROAS1",
        "metric_name_cn": "1天投资回报率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 173,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "roas2",
        "metric_code_name": "return_on_ad_spend_d2",
        "metric_desc": "Return on Ad Spend:SUM(Cohort Revenue from Install)/SUM(UA Spend)",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "ROAS2",
        "metric_name_cn": "2天投资回报率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 173,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "roas3",
        "metric_code_name": "return_on_ad_spend_d3",
        "metric_desc": "Return on Ad Spend:SUM(Cohort Revenue from Install)/SUM(UA Spend)",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "ROAS3",
        "metric_name_cn": "3天投资回报率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 173,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "roas7",
        "metric_code_name": "return_on_ad_spend_d7",
        "metric_desc": "Return on Ad Spend:SUM(Cohort Revenue from Install)/SUM(UA Spend)",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "ROAS7",
        "metric_name_cn": "7天投资回报率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 173,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "roas14",
        "metric_code_name": "return_on_ad_spend_d14",
        "metric_desc": "Return on Ad Spend:SUM(Cohort Revenue from Install)/SUM(UA Spend)",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "ROAS14",
        "metric_name_cn": "14天投资回报率",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 173,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "iaa_impressions",
        "metric_code_name": "advertisement_impressions",
        "metric_desc": "Ad impressions refer to the number of times an advertisement is displayed to a user within a game.",
        "metric_type": "casual",
        "value_type": "numerical",
        "metric_name_en": "Impressions",
        "metric_name_cn": "广告展示次数",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 174,
        "active": 1,
    },
    {
        "metric_code": "impression_rate",
        "metric_code_name": "impression_rate",
        "metric_desc": "Impression Rate",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "Impression Rate",
        "metric_name_cn": "曝光率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 175,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "retention_users",
        "metric_code_name": "retention_users_count",
        "metric_desc": "Daily/weekly/monthly retention user",
        "metric_type": "casual",
        "value_type": "numerical",
        "metric_name_en": "DAU retention users",
        "metric_name_cn": "日活留存",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 707,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "churn_users",
        "metric_code_name": "active_users_churn_count",
        "metric_desc": "The number of churn users",
        "metric_type": "casual",
        "value_type": "numerical",
        "metric_name_en": "Churn Users",
        "metric_name_cn": "日流失",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "churn流失",
        "weight": 921,
        "active": 1
    },
    {
        "metric_code": "churn_rate",
        "metric_code_name": "active_users_churn_rate",
        "metric_desc": "Users churn rate",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "Churn",
        "metric_name_cn": "流失率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "churn流失",
        "weight": 922,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "return_users",
        "metric_code_name": "return_users_count",
        "metric_desc": "Daily/Weekly/Monthly Return Users",
        "metric_type": "casual",
        "value_type": "numerical",
        "metric_name_en": "DAU Return Users",
        "metric_name_cn": "日回流",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "return回流",
        "weight": 953,
        "active": 1
    },
    {
        "metric_code": "weighted_d2",
        "metric_code_name": "weighted_next_day_new_users_retention_rate_daily",
        "metric_desc": "Weighted 2-day retention rate for new arrivals",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "Weighted D2",
        "metric_name_cn": "加权D2留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 708,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "weighted_d3",
        "metric_code_name": "weighted_3_day_new_users_retention_rate_daily",
        "metric_desc": "Weighted 3-day retention rate for new arrivals",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "Weighted D3",
        "metric_name_cn": "加权D3留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 708,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "weighted_d7",
        "metric_code_name": "weighted_7_day_new_users_retention_rate_daily",
        "metric_desc": "Weighted 7-day retention rate for new arrivals",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "Weighted D7",
        "metric_name_cn": "加权D7留存率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "retention留存",
        "weight": 708,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "first_login_ratio",
        "metric_code_name": "first_login_ratio",
        "metric_desc": "1st tier login ratio, 一阶登录比",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "First order login",
        "metric_name_cn": "一阶登录比",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "login登录",
        "weight": 637,
        "active": 1,
    },
    {
        "metric_code": "second_login_ratio",
        "metric_code_name": "second_login_ratio",
        "metric_desc": "2nd tier login ratio, 二阶登录比",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "Second order login",
        "metric_name_cn": "二阶登录比",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "login登录",
        "weight": 638,
        "active": 1,
    },
    {
        "metric_code": "ug_ctr",
        "metric_code_name": "ua_ctr",
        "metric_desc": "The ratio of ad clicks to total impressions in UA",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "UA CTR",
        "metric_name_cn": "UA CTR",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 176,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "ug_cvr",
        "metric_code_name": "ua_conversion_rate",
        "metric_desc": "The number of installs based on device IDs (xwid)reported by Tencent SDK /The number of UA ad clicks",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "UA CVR",
        "metric_name_cn": "UA转化率",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 177,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "aot",
        "metric_code_name": "average_online_time",
        "metric_desc": "Daily average online time/Daily average online time per week/Daily average online time per month",
        "metric_type": "casual",
        "value_type": "float",
        "metric_name_en": "Realtime Avg.Playtime",
        "metric_name_cn": "平均在线时长",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "online time 在线",
        "weight": 223,
        "active": 1
    },
    {
        "metric_code": "ecpm",
        "metric_code_name": "effective_cost_per_mille_ecpm",
        "metric_desc": "effective Cost Per Mille：Average Revenue Per Thousand Ad Impressions",
        "metric_type": "casual",
        "value_type": "float",
        "metric_name_en": "eCPM",
        "metric_name_cn": "千次展示平均收入",
        "granularity": [
            "daily",
            "weekly",
            "monthly"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 178,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "ctr",
        "metric_code_name": "ctr",
        "metric_desc": "IAA CTR",
        "metric_type": "casual",
        "value_type": "percent",
        "metric_name_en": "IAA CTR",
        "metric_name_cn": "IAA CTR",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "revenue收入(for casual game)",
        "weight": 179,
        "active": 1,
        "unsupported_aggregation": [
            "sum",
            "mean"
        ]
    },
    {
        "metric_code": "imps_per_dau",
        "metric_code_name": "impressions_per_dau",
        "metric_desc": "Impression per DAU",
        "metric_type": "casual",
        "value_type": "float",
        "metric_name_en": "Impression per DAU",
        "metric_name_cn": "人均展示次数",
        "granularity": [
            "daily"
        ],
        "unit": "",
        "url": "/overview/daily",
        "label": "active users活跃",
        "weight": 226,
        "active": 1
    }
]