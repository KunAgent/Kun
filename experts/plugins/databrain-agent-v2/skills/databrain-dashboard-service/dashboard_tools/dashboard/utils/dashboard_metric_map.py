from .dashboard_metric_map_data import DASHBOARD_METRIC_MAP

# Original DASHBOARD_METRIC_MAP moved to dashboard_metric_map_data.py

DLTB_FEATURE_METRIC_MAP = [
    {
        "metric_code": "median_fps",
        "metric_desc": "帧率中位数",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Median FPS",
        "metric_name_cn": "帧率中位数",
        "url": "/datalab/customDashboard/FPS%20Analysis%20Hourly",
        "granularity": ["realtime"]
    },
    {
        "metric_code": "avg_fps",
        "metric_desc": "平均帧率. Total number of frames divided by total time.",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Average FPS",
        "metric_name_cn": "平均帧率",
        "url": "/datalab/customDashboard/FPS%20Analysis%20Hourly",
        "granularity": ["realtime"]
    },
    {
        "metric_code": "low_fps_percetage",
        "metric_desc": "低帧率占比. 计算逻辑是low_fps_count / total_fps_coun. Low FPS Threshold:Console with 30 FPS VSync, Low Spec PC is 27；Console with 60 FPS VSync, Med and High spec PC is 55",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Low FPS Percentage",
        "metric_name_cn": "低帧率占比",
        "url": "/datalab/customDashboard/FPS%20Analysis%20Hourly",
        "granularity": ["realtime"]
    },
    {
        "metric_code": "unplayable_fps_percetage",
        "metric_desc": "不可玩帧率占比，或掉帧占比. 计算逻辑是unplayable_fps_count / total_fps_count. Unplayable FPS Threshold is 20",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Unplayable FPS Percentage",
        "metric_name_cn": "不可玩帧率占比",
        "url": "/datalab/customDashboard/FPS%20Analysis%20Hourly",
        "granularity": ["realtime"]
    },
    {
        "metric_code": "cumulative_crash_rate",
        "metric_desc": "累计崩溃率。计算逻辑是每天从0点累计到当前小时的Total Crash Count / Total Session Count. (GTDR Benchmark=3%)",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Cumulative Crash Rate",
        "metric_name_cn": "累计崩溃率",
        "url": "/datalab/customDashboard/Crash%20Analysis%20Hourly",
        "granularity": ["realtime"]
    },
    {
        "metric_code": "mean_time_between_crash",
        "metric_desc": "崩溃间隔平均时长, 单位为小时，计算逻辑是Total Play Time / Total Crash Count",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Mean Time Between Crash",
        "metric_name_cn": "崩溃间隔平均时长",
        "url": "/datalab/customDashboard/Crash%20Analysis%20Hourly",
        "granularity": ["realtime"]
    },
    {
        "metric_code": "join_failure_rate",
        "metric_desc": "联机匹配（加入）失败率，从当天0点到当前小时的累计数据，计算逻辑是Failed Attempts / (Successful Attempts + Failed Attempts)",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Join Attempt Failure Rate",
        "metric_name_cn": "联机匹配（加入）失败率",
        "url": "/datalab/customDashboard/Coop%20Performance%20Hourly",
        "granularity": ["realtime"]
    },
    {
        "metric_code": "avg_join_success_duration",
        "metric_desc": "联机成功匹配加入耗时（秒），从当天0点到当前小时的累计数据",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Avg Join success Duration(seconds)",
        "metric_name_cn": "联机成功匹配加入耗时（秒）",
        "url": "/datalab/customDashboard/Coop%20Performance%20Hourly",
        "granularity": ["realtime"]
    },
    {
        "metric_code": "join_failure_user",
        "metric_desc": "联机匹配（加入）失败人数，从当天0点到当前小时的累计数据",
        "metric_type": "pc/console",
        "value_type": "numerical",
        "metric_name_en": "Join failure User",
        "metric_name_cn": "联机匹配（加入）失败人数",
        "url": "/datalab/customDashboard/Coop%20Performance%20Hourly",
        "granularity": ["realtime"]
    },
    {
        "metric_code": "coop_player_ratio",
        "metric_desc": "联机玩家占比，从当天0点到当前小时的累计数据，计算逻辑是Coop Players Count / Total Players Count",
        "metric_type": "pc/console",
        "value_type": "percent",
        "metric_name_en": "Coop Player Ratio",
        "metric_name_cn": "联机玩家占比",
        "url": "/datalab/customDashboard/Coop%20Performance%20Hourly",
        "granularity": ["realtime"]
    }
]

DASHBOARD_METRIC_NAME_BY_TYPE_AND_LABEL = {
    x: [
        {"name": y, "metrics": [h for _, h in sorted([(z["weight"], z["metric_code_name"]) for z in DASHBOARD_METRIC_MAP if
                                  z.get("metric_type", "") == x and "label" in z and z[
                                      "label"] == y and "weight" in z])]}
        for y in set([z["label"] for z in DASHBOARD_METRIC_MAP if z.get("metric_type", "") == x and "label" in z and "active" in z])
    ]
    for x in ["mobile", "pc/console","casual"]
}


DASHBOARD_METRIC_NAME_CODE_MAPPING_BY_TYPE = {}
for x in ["mobile", "pc/console","casual"]:
    code_name_map = {}
    for y in DASHBOARD_METRIC_MAP:
        if y.get("metric_type", "") == x and "metric_code_name" in y and "metric_code" in y:
            code_name_map[y["metric_code_name"]] = y["metric_code"]
            # if '(default' in y["metric_code_name"]:
            #     code_name_map[y["metric_code_name"].split('(default')[0]] = y["metric_code"]
    DASHBOARD_METRIC_NAME_CODE_MAPPING_BY_TYPE[x] = code_name_map


DASHBOARD_METRIC_URL_BY_TYPE = {
    x: {
        y["metric_code"]: y["url"]
        for y in DASHBOARD_METRIC_MAP
        if y.get("metric_type", "") == x
           and "metric_code" in y
           and "url" in y
           and y["url"]
           and "granularity" in y
           and "realtime" not in y["granularity"]
    }
    for x in ["mobile", "pc/console","casual"]
}

DASHBOARD_METRIC_AGGREGATION_BY_NAME = {
    x["metric_code_name"]: x.get("unsupported_aggregation", "")
    for x in DASHBOARD_METRIC_MAP
    if "metric_code_name" in x
}


DASHBOARD_METRIC_URL_BY_TYPE_REALTIME = {
    x: {
        y["metric_code"]: y["url"]
        for y in DASHBOARD_METRIC_MAP
        if y.get("metric_type", "") == x
           and "metric_code" in y
           and "url" in y
           and y["url"]
           and "granularity" in y
           and "realtime" in y["granularity"]
    }
    for x in ["mobile", "pc/console","casual"]
}

DASHBOARD_METRIC_URL_BY_TYPE_MCP = {
    x: {
        y["metric_code"]: y["url"]
        for y in DLTB_FEATURE_METRIC_MAP
        if y.get("metric_type", "") == x
           and "metric_code" in y
           and "url" in y
           and y["url"]
    }
    for x in ["mobile", "pc/console","casual"]
}

DASHBOARD_METRIC_QUERY_TYPES = set([",".join(y['query_names']) for y in DASHBOARD_METRIC_MAP if 'query_names' in y])


DASHBOARD_METRIC_MAP_BY_NAME = {
    x["metric_code"]: {
        "metric_name_en": x["metric_name_en"],
        "metric_name_cn": x["metric_name_cn"],
        "value_type": x["value_type"],
        "weight": x.get("weight", 999999),
        "unit": x.get("unit", ''),
    }
    for x in DASHBOARD_METRIC_MAP
    if "metric_code" in x
       and "metric_name_en" in x
       and "metric_name_cn" in x
       and "value_type" in x
       and "unit" in x
       and "granularity" in x
       and "realtime" not in x["granularity"]
}

DASHBOARD_METRIC_MAP_BY_TYPE_AND_CODE = {
    metric_type: {
        x["metric_code"]: {
            "metric_name_en": x["metric_name_en"],
            "metric_name_cn": x["metric_name_cn"],
            "value_type": x["value_type"],
            "weight": x.get("weight", 999999),
            "unit": x.get("unit", ''),
        }
        for x in DASHBOARD_METRIC_MAP
        if x.get("metric_type", "") == metric_type
           and "metric_code" in x
           and "metric_name_en" in x
           and "metric_name_cn" in x
           and "value_type" in x
           and "unit" in x
           and "granularity" in x
           and "realtime" not in x["granularity"]
    }
    for metric_type in ["mobile", "pc/console", "casual"]
}


def get_dashboard_metric_info(metric_code: str, metric_type: str = ""):
    if metric_type:
        info = DASHBOARD_METRIC_MAP_BY_TYPE_AND_CODE.get(metric_type, {}).get(metric_code)
        if info:
            return info
    return DASHBOARD_METRIC_MAP_BY_NAME.get(metric_code, {})

DASHBOARD_MCP_METRIC_MAP_BY_NAME = {
    x["metric_code"]: {
        "metric_name_en": x["metric_name_en"],
        "metric_name_cn": x["metric_name_cn"],
        "value_type": x["value_type"]
    }
    for x in DLTB_FEATURE_METRIC_MAP
    if "metric_code" in x
       and "metric_name_en" in x
       and "metric_name_cn" in x
       and "value_type" in x
       and ("realtime" in x["granularity"] or "daily" in x["granularity"])
}

DASHBOARD_METRIC_MAP_BY_NAME_REALTIME = dict()
for x in DASHBOARD_METRIC_MAP:
    if "metric_code" in x and "metric_name_en" in x and "metric_name_cn" in x and "value_type" in x and "unit" in x and "granularity" in x and "realtime" in \
            x["granularity"]:
        DASHBOARD_METRIC_MAP_BY_NAME_REALTIME[x["metric_code"]] = {
            "metric_name_en": x["metric_name_en"],
            "metric_name_cn": x["metric_name_cn"],
            "value_type": x["value_type"],
            "weight": x.get("weight", 999999),
            "unit": x.get("unit", ''),
        }
        DASHBOARD_METRIC_MAP_BY_NAME_REALTIME[x["metric_code"] + '_dod'] = {
            "metric_name_en": x["metric_name_en"] + "(day-over-day)",
            "metric_name_cn": x["metric_name_cn"] + "(日同比)",
            "value_type": "percent",
            "weight": x.get("weight", 999999),
            "unit": x.get("unit", ''),
        }
        # DASHBOARD_METRIC_MAP_BY_NAME_REALTIME[x["metric_code"] + '_dod_count'] = {
        #     "metric_name_en": x["metric_name_en"],
        #     "metric_name_cn": x["metric_name_cn"],
        #     "value_type": x["value_type"],
        # }

DASHBOARD_METRIC_MAP_BY_CODE_GRANULARITY = {
    x["metric_code"]: x["granularity"]
    for x in DASHBOARD_METRIC_MAP
    if "metric_code" in x and "granularity" in x
}


DASHBOARD_DEFAULT_METRIC_MAP_BY_QUERY = {
    "pc/console":{
        "revenue":["lifetime_revenue_after_refund"],
        "sales":["lifetime_base_game_units_sold_after_refund"],
        "retention":["next_day_new_users_retention_rate_daily","3_day_new_users_retention_rate_daily","7_day_new_users_retention_rate_daily","next_day_active_users_retention_rate_daily","3_day_active_users_retention_rate_daily","7_day_active_users_retention_rate_daily"],
        "wishlist":["total_wishlist_count","total_wishlist_coversion_rate_daily"],
        "churn":["active_users_churn_rate","active_users_churn_count"],
        "1_day_new_users_retention_rate_daily":["next_day_new_users_retention_rate_daily"],
        "1_day_active_users_retention_rate_daily":["next_day_active_users_retention_rate_daily"]
    },
    "mobile":{
        "revenue":["pay_amount"],
        "sales":["pay_amount"],
        "gross_revenue": ["pay_amount"],
        "ltv":["average_2_day_revenue_ltv_daily","average_3_day_revenue_ltv_daily","average_7_day_revenue_ltv_daily"],
        "retention":["next_day_new_users_retention_rate_daily","3_day_new_users_retention_rate_daily","7_day_new_users_retention_rate_daily","next_day_active_users_retention_rate_daily","3_day_active_users_retention_rate_daily","7_day_active_users_retention_rate_daily"],
        "churn":["active_users_churn_rate","active_users_churn_count"],
        "1_day_new_users_retention_rate_daily":["next_day_new_users_retention_rate_daily"],
        "1_day_active_users_retention_rate_daily":["next_day_active_users_retention_rate_daily"]
    },
    "casual": {
        "revenue": ["advertisement_revenue"],
        "gross_revenue": ["advertisement_revenue"],
        "sales": ["advertisement_revenue"],
        "retention": ["next_day_new_users_retention_rate_daily", "3_day_new_users_retention_rate_daily", "7_day_new_users_retention_rate_daily"],
        "churn": ["active_users_churn_rate", "active_users_churn_count"],
        "1_day_new_users_retention_rate_daily": ["next_day_new_users_retention_rate_daily"],
    }
}

if __name__ == "__main__":

    assert all("metric_code" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has metric_code. "
    assert all("metric_code_name" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has metric_code_name. "
    assert all("metric_desc" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has metric_desc. "
    assert all("metric_type" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has metric_type. "
    assert all("value_type" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has value_type. "
    assert all("metric_name_en" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has metric_name_en. "
    assert all("metric_name_cn" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has metric_name_cn. "
    assert all("granularity" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has granularity. "
    assert all("unit" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has unit. "
    assert all("url" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has url. "
    assert all("query_names" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has query_names. "
    assert all("label" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has label. "
    assert all("weight" in x for x in DASHBOARD_METRIC_MAP), "Not all metric has weight. "

    for x in ["mobile", "pc/console"]:
        l = [y["metric_code_name"] for y in DASHBOARD_METRIC_MAP if y.get("metric_type", "") == x]
        assert len(l) == len(set(l)), f"Duplicate metric code name found in {x}. "