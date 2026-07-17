from run_context_wrapper import RunContextWrapper
from datetime import datetime, timedelta, timezone
from loguru import logger
import time
import traceback
import json
import pandas as pd
from typing import Dict, List, Tuple, Any, Literal, Optional, Union

from pydantic import BaseModel, Field

from dashboard_common.cls import log_metrics

from databrain.api import DASHBOARD_GAME_DETAIL_API, DASHBOARD_METRIC_API, async_send_request_with_token, DASHBOARD_DIMEMSION_TOP_API, DASHBOARD_PC_REALTIME_ACC_SALES_UNITS_REVENUE_API, DASHBOARD_METRIC_PERCENTAGE_API
from dashboard_strategy.context import GameContext, ReferenceItem
from dashboard_data.region_code_map import COUNTRY_MAP_INTEL, REGION_MAP_INTEL
from dashboard_strategy.constants import ToolName
from dashboard_strategy.sensitive_data import add_sensitive_dashboard_data
from dashboard_common.config import globalvar as gl
from dashboard_tools.tool_common import get_tool_enabled, function_tool
from dashboard_tools.dashboard.utils.dashboard_metric_map import DASHBOARD_METRIC_MAP, DASHBOARD_METRIC_URL_BY_TYPE, DASHBOARD_METRIC_URL_BY_TYPE_REALTIME, DASHBOARD_METRIC_URL_BY_TYPE_MCP
from dashboard_utils.helper import default_tool_error_function
from dashboard_tools.dashboard.utils.dashboard_tools_util import map_country_name, update_input, get_bi_data, str_to_dt, dt_to_str, update_date, convert_to_csv, sort_query_data, sort_mcp_query_data, get_mcp_bi_data, apply_metric_code_to_name_mapping, get_metric_percentage_bi_data


class DashboardException(Exception):
    """Custom exception for dashboard agent."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class DashboardWrongTokenException(DashboardException):
    """Custom exception for dashboard wrong token issues."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class DashboardEmptyDataException(DashboardException):
    """Custom exception for dashboard empty data issues."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class DashboardPermissionException(DashboardException):
    """Custom exception for dashboard permission issues."""

    def __init__(self, game):
        super().__init__(
            f"User does not have permission to access dashboard info for game {game}. "
        )
        self.game = game


async def get_metric_percentage_filter(
    game_code: str,
    start_date: str,
    end_date: str,
    metrics: List[str],
    granularity: str,
    group_by_dimension: str,
    zone: List[str],
    country: List[str],
    os: List[str],
    channel: List[str],
    region: List[str],
    lang: List[str],
    token: str,
    is_xiaohao: bool = False,
) -> List[str]:
    """
    Call the DASHBOARD_METRIC_PERCENTAGE_API to retrieve the metric percentage for a specified metric.

    Parameters:
        game_code (str): The game's unique code identifier.
        start_date (str): Query start date in YYYYMMDD format.
        end_date (str): Query end date in YYYYMMDD format.
        metrics (List[str]): List of metric keys to consider.
        granularity (str): Time granularity, e.g., daily, weekly, or monthly.
        group_by_dimension (str): The dimension to group by. Must be one of ["zone", "country", "os", "channel", "region", "lang"].
        zone (List[str]): list of zones to query. Sometimes are called 区服, for example 日本服. If not specify or query for total data, defaults to []. If query to group by zones, use ["255"].
        country (List[str]): list of country to query, in the format of two digits english country code, or full english or chinese name. If not specify or query for total data, defaults to [].
        os (List[str]): list of os names to query, for example Steam, IOS, XBox. Sometimes are called platform/平台 codes. If not specify or query for total data, defaults to []. If query group by os, use ["255"].
        channel (List[str]): list of channels to query. If not specify or query for total data, defaults to []. If query to group by channels, use ["255"].
        region (List[str]): list of regions to query. If not specify or query for total data, defaults to []. If query to group by regions, use ["255"].
        lang (List[str]): list of languages to query. If not specify or query for total data, defaults to []. If query to group by languages, use ["255"].
        token (str): User authentication token for API access.

    Returns:
        List[str]: A list of metric percentage values as strings.
                Returns an empty list if the API call fails, returns no data,
                or if the specified metric is missing in the response.

    Exceptions:
        Catches and suppresses all exceptions, returning an empty list on failure.
    """
    api_data = {
        "game_code": game_code,
        "start_date": start_date,
        "end_date": end_date,
        "metrics": metrics,
        "granularity": granularity,
        "group_by": [group_by_dimension] if group_by_dimension else [],
        "filters": {
            "zone": zone,
            "country": country,
            "os": os,
            "channel": channel,
            "region": region,
            "lang": lang
        }
    }
    if is_xiaohao:
        api_data["is_xiaohao"] = True
    logger.info(
        f"【Tool API Call】- get_metric_percentage_filter: Querying metrics for game {game_code} from {start_date} to {end_date} with granularity {granularity}, metrics {metrics}, group by dimension {group_by_dimension}, zone {zone}, country {country}, os {os}, channel {channel}, region {region}, lang {lang}."
    )
    # print(
    #     f"\033[93m get_metric_percentage_filter: {DASHBOARD_METRIC_PERCENTAGE_API} with data: {api_data}\033[0m"
    # )

    resp = await async_send_request_with_token(DASHBOARD_METRIC_PERCENTAGE_API, api_data, token)
    resp_json = resp.json()
    code = resp_json.get("code", -1)

    logger.info(
        f"【API Return】- DASHBOARD_METRIC_PERCENTAGE_API: {resp_json}. "
    )
    # print(
    #     f"\033[93m Get response from DASHBOARD_METRIC_PERCENTAGE_API with data: {resp_json}\033[0m"
    # )
    # handle api outputs
    if code == 0:
        try:
            data_dict = resp_json.get("data", {})


            logger.info(
                f"【API return】-【DASHBOARD_METRIC_PERCENTAGE_API】: data_dict: {data_dict}. ")

            # # Check if no countries were found in any metric
            # has_data = False
            # for metric_key, entries in data_dict.items():
            #     if entries and len(entries) > 0:
            #         has_data = True
            #         break

            return data_dict
        except DashboardEmptyDataException:
            raise
        except Exception:
            logger.error(traceback.format_exc())
            raise
    elif code == 200051:  # no data permission on given games
        raise DashboardPermissionException(game_code)
    elif code == 20011:  # no data found in date range
        raise DashboardEmptyDataException(
            "No data found in provided date range. ")
    elif code == 4001:  # token is expired or wrong version of token is used
        raise DashboardWrongTokenException(
            "Token used is expired or wrong version of the token is used. Try using the latest token. ")
    else:
        raise DashboardException(resp_json.get("msg", "Unknown error. "))


async def get_metric_percentage_filter_with_fallback(
    game_code: str,
    start_date: str,
    end_date: str,
    metrics: List[str],
    granularity: str,
    group_by_dimension: str,
    zone: List[str],
    country: List[str],
    os: List[str],
    channel: List[str],
    region: List[str],
    lang: List[str],
    token: str,
    fall_back=True,
    is_xiaohao: bool = False,
):
    """
    Call the DASHBOARD_METRIC_PERCENTAGE_API with fallback logic similar to query_dashboard_metrics_with_fallback.

    Parameters:
        game_code (str): The game's unique code identifier.
        start_date (str): Query start date in YYYYMMDD format.
        end_date (str): Query end date in YYYYMMDD format.
        metrics (List[str]): List of metric keys to consider.
        granularity (str): Time granularity, e.g., daily, weekly, or monthly.
        group_by_dimension (str): The dimension to group by. Must be one of ["zone", "country", "os", "channel", "region", "lang"].
        zone (List[str]): list of zones to query. Sometimes are called 区服, for example 日本服. If not specify or query for total data, defaults to []. If query to group by zones, use ["255"].
        country (List[str]): list of country to query, in the format of two digits english country code, or full english or chinese name. If not specify or query for total data, defaults to [].
        os (List[str]): list of os names to query, for example Steam, IOS, XBox. Sometimes are called platform/平台 codes. If not specify or query for total data, defaults to []. If query group by os, use ["255"].
        channel (List[str]): list of channels to query. If not specify or query for total data, defaults to []. If query to group by channels, use ["255"].
        region (List[str]): list of regions to query. If not specify or query for total data, defaults to []. If query to group by regions, use ["255"].
        lang (List[str]): list of languages to query. If not specify or query for total data, defaults to []. If query to group by languages, use ["255"].
        token (str): User authentication token for API access.
        fall_back (bool): Whether to use fallback logic. Defaults to True.

    Returns:
        dict: A dictionary containing the result data and fallback information.
    """

    if not fall_back:
        result = await get_metric_percentage_filter(
            game_code, start_date, end_date, metrics, granularity, group_by_dimension, zone, country, os, channel, region, lang, token, is_xiaohao
        )
        return {"data": result, "fallback_info": []}

    logger.info(
        f"【Tool call】-【get_metric_percentage_filter_with_fallback】: Found input: {game_code}, {start_date}, {end_date}, {metrics}, {granularity}, {group_by_dimension}, {zone}, {country}, {os}, {channel}, {region}, {lang}. ")

    fallback_info_list = []

    try:
        result = await get_metric_percentage_filter(
            game_code, start_date, end_date, metrics, granularity, group_by_dimension, zone, country, os, channel, region, lang, token, is_xiaohao
        )

        logger.info(
            f"【Tool return】-【get_metric_percentage_filter_with_fallback】: data: {result}, fallback_info: {fallback_info_list}. ")

        return {
            "data": result,
            "fallback_info": fallback_info_list
        }

    except DashboardEmptyDataException:

        delta = str_to_dt(end_date) - str_to_dt(start_date)

        # Step 1: fallback end_date to current year
        if str_to_dt(end_date).year != datetime.now().year and (not granularity or granularity.lower() != "realtime"):
            fallback_end_dt = str_to_dt(end_date).replace(
                year=datetime.now().year)
            fallback_start_dt = fallback_end_dt - delta
            fallback_info_list.append(
                f"Time fallback: end_date switched to current year ({dt_to_str(fallback_start_dt)} ~ {dt_to_str(fallback_end_dt)}). "
            )

            new_result = await get_metric_percentage_filter_with_fallback(
                game_code, dt_to_str(
                    fallback_start_dt), dt_to_str(fallback_end_dt),
                metrics, granularity, group_by_dimension, zone, country, os, channel, region, lang, token, is_xiaohao=is_xiaohao
            )
        # Step 2: if range < 30 days, expand to 30-day window
        elif delta.days < 30 and (not granularity or granularity.lower() != "realtime"):
            new_start_dt = str_to_dt(end_date) - timedelta(days=30)
            fallback_info_list.append(
                f"Time fallback: range < 30d, expanded to 30-day window ({dt_to_str(new_start_dt)} ~ {end_date}). "
            )

            new_result = await get_metric_percentage_filter_with_fallback(
                game_code, dt_to_str(new_start_dt), end_date,
                metrics, granularity, group_by_dimension, zone, country, os, channel, region, lang, token, is_xiaohao=is_xiaohao
            )

        # Step 3: fallback from weekly/monthly to daily with 30-day window
        elif granularity in ("weekly", "monthly"):
            fallback_info_list.append(
                f"Granularity fallback: no data for granularity={granularity}; retry with daily over past 30 days. "
            )
            new_end_dt = str_to_dt(end_date)
            new_start_dt = new_end_dt - timedelta(days=30)

            new_result = await get_metric_percentage_filter_with_fallback(
                game_code, dt_to_str(new_start_dt), dt_to_str(new_end_dt),
                metrics, "daily", group_by_dimension, zone, country, os, channel, region, lang, token, is_xiaohao=is_xiaohao
            )

        else:
            # Step 4: no more fallback options
            fallback_info_list.append(
                "Fallback failed: no additional strategy available. ")
            return {
                "data": {},
                "fallback_info": fallback_info_list
            }

        # 合并下一层 fallback_info
        if isinstance(new_result, dict) and "fallback_info" in new_result:
            fallback_info_list.extend(
                new_result["fallback_info"]
                if isinstance(new_result["fallback_info"], list)
                else [new_result["fallback_info"]]
            )

        logger.info(
            f"【Tool return】-【get_metric_percentage_filter_with_fallback】: result: {new_result}, fallback_info_list: {fallback_info_list}. ")

        return {
            "data": new_result["data"] if isinstance(new_result, dict) and "data" in new_result else new_result,
            "fallback_info": fallback_info_list
        }


@function_tool(
    failure_error_function=default_tool_error_function,
    is_enabled=get_tool_enabled(ToolName.DashboardMetricPercentageTool.value),
    readable_name_map={
        "English": "Dashboard Metric Percentage Tool",
        "Chinese": "经分游戏指标占比工具",
    }
)
async def dashboard_metric_percentage_tool(
    context: RunContextWrapper[GameContext],
    game_names: List[str] = [],
    start_date: str | None = None,
    end_date: str | None = None,
    metrics: List[str] = [],
    granularity: str | None = None,
    group_by_dimension: str | None = None,
    zone: List[str] = [],
    country: List[str] = [],
    os: List[str] = [],
    channel: List[str] = [],
    region: List[str] = [],
    lang: List[str] = []

) -> str:
    """Query the metric percentage for specific metrics using the metric percentage filter API. This tool is used when the user question includes metric percentage request by certain zone/country/os/channel/region/lang.
    若请求除zone, country, os, channel, region and lang这几个纬度之外的占比计算，仍需使用dashboard_metrics_query_tool。注意区分一些本身就表示某种占比的指标(通常metric name自带rate,ratio，比如自然量占比、付费用户占比)不适用于本tool，需要通过dashboard_metrics_query_tool获取。
    The tool returns a dictionary with results per game, where each game contains its game_code and metric_percentage_dict mapping metric keys to metric percentages.
    If any of the input variables is not specified by the user, do not ask them, use default values. Note that length of game_names, game_codes should be the same, i.e. one game_code for each game_name.
    You can input only one granularity and one filters (zone, country, os, channel, region, lang) per tool call.
    Choose correct filter name with corresponding code, do not use os codes in channel filter or verse versa, do not use country codes in region filter or verse versa. However if no country codes provided, can use appropriate region code with region filter to select target country data.
    Args:
        game_names (List[str]): The names of games to query. Defaults to [].
        start_date (str | None, optional): The start date to query. If granularity is realtime, start_date should be prior or equal to today. format: YYYYMMDD. Defaults to None.
        end_date (str | None, optional): The end date to query. If granularity is realtime, end_date should equal to start_date. format: YYYYMMDD. Defaults to None.
        metrics (List[str]): List of metrics to query. Default is all supported metrics. max size of metrics is 20.
        granularity (str | None, optional): The granularity to query. Use realtime If metric is realtime, otherwise choose from daily/weekly/monthly. For realtime granularity, end_date should equal to start_date. For monthly granularity, the day of start_date and end_date should be 01, use daily granularity if user specifies day other than 01. Defaults to None.
        group_by_dimension (str | None, optional): The dimension to group by. Must be one of ["zone", "country", "os", "channel", "region", "lang"].
        zone (List[str], optional): list of zones to query. Sometimes are called 区服, for example 日本服. If not specify or query for total data, defaults to [].
        country (List[str], optional): list of country to query, in the format of two digits english country code, or full english or chinese name. If not specify or query for total data, defaults to []. 注意！全球数据等于total数据，也用[].
        os (List[str], optional): list of os names to query, for example Steam, IOS, XBox. Sometimes are called platform/平台/商店/store codes. If not specify or query for total data, defaults to []. 注意！全平台/所有平台数据等于total data，也用[].
        channel (List[str], optional): list of channels to query. If not specify or query for total data, defaults to [].
        region (List[str], optional): list of regions to query. If not specify or query for total data, defaults to [].
        lang (List[str], optional): list of languages to query. If not specify or query for total data, defaults to [].
        category (List[str], optional): list of categories to query. Only apply to pc/console games. If not specify or query for total data, defaults to [].
        product (List[str], optional): list of products to query. Only apply to pc/console games. Sometimes are called version/版本 codes.If not specify or query for total data, defaults to []. Only non-realtime sales metric has by product filters, do not use this filter for other metric, can set as [].
    Supported metrics: [
    {"name": "active users活跃", "metrics": ["active_users_count", "average_concurrent_users_count", "average_daily_active_users_in_week_or_month", "peak_concurrent_users_count","peak_daily_active_users","average_session_count","fake_active_users_rate","impressions_per_dau"]},
    {"name": "churn流失", "metrics": ["churn","active_users_churn_count", "active_users_churn_rate", "next_day_new_users_churn_count_daily", "next_day_new_users_churn_rate_daily", "next_month_new_users_churn_count_monthly", "next_month_new_users_churn_rate_monthly", "next_week_new_users_churn_count_weekly", "next_week_new_users_churn_rate_weekly"]},
    {"name": "in-game revenue游戏内收入(for pc/console game)", "metrics": ["in_game_paying_users_ratio", "in_game_paying_users_count", "in_game_revenue", "lifetime_in_game_paying_users_ratio", "lifetime_in_game_paying_users_count", "lifetime_in_game_revenue"]},
    {"name": "ltv生命周期总值(for mobile game)", "metrics": ["ltv","average_14_day_revenue_ltv_daily", "average_180_day_revenue_ltv_daily", "average_1_day_revenue_ltv_daily", "average_2_day_revenue_ltv_daily", "average_30_day_revenue_ltv_daily", "average_360_day_revenue_ltv_daily", "average_3_day_revenue_ltv_daily", "average_60_day_revenue_ltv_daily", "average_7_day_revenue_ltv_daily", "average_90_day_revenue_ltv_daily"]},
    {"name": "revenue收入(for casual game)"}, "metrics": ["advertisement_ua_ctr","advertisement_impressions","advertisement_revenue","ctr","effective_cost_per_mille_ecpm","impression_rate","return_on_ad_spend_d1","return_on_ad_spend_d14","return_on_ad_spend_d2","return_on_ad_spend_d3","return_on_ad_spend_d7","revenue_on_spend_roi","ua_conversion_rate"]},
    {"name": "new user新进用户", "metrics": ["new_users_count","lifetime_new_users_count", "new_users_count_online_time_over_2_hours","advertisement_spend","cost_per_install_cpi","organic_new_users_ratio"]},
    {"name": "online time 在线", "metrics": ["average_online_time", "median_online_time"]},
    {"name": "realtime实时类", "metrics": ["3_day_new_users_retention_rate_realtime", "7_day_new_users_retention_rate_realtime", "active_users_count_realtime", "full_game_units_after_refund_realtime", "gross_full_game_units_realtime", "gross_revenue_after_refund_realtime", "lifetime_full_game_units_realtime", "lifetime_revenue_realtime", "revenue_after_tax_and_refund_realtime", "new_users_count_realtime", "next_day_new_users_retention_rate_realtime", "online_users_count_realtime", "refund_rate_realtime", "revenue_realtime", "steam_concurrent_users_ccu_realtime", "lifetime_base_game_gross_units_sold_realtime", "lifetime_base_game_units_sold_after_refund_realtime", "lifetime_refund_rate_realtime", "lifetime_revenue_after_refund_realtime", "units_sold_after_refund_realtime"]},
    {"name": "refund退款(for pc/console game)", "metrics": ["base_game_refund_rate", "base_game_refund_units", "lifetime_refund_rate", "refund_rate", "refund_units"]},
    {"name": "refund退款(for mobile game)", "metrics": ["paying_users_count", "paying_users_rate"]},
    {"name": "retention留存", "metrics": ["retention","14_day_active_users_retention_rate_daily", "14_day_new_users_retention_rate_daily", "2_day_active_users_retention_rate_daily", "2_day_new_users_retention_rate_daily", "30_day_active_users_retention_rate_daily", "30_day_new_users_retention_rate_daily", "3_day_active_users_retention_rate_daily", "3_day_new_users_retention_rate_daily", "3_month_active_users_retention_rate_monthly", "3_month_new_users_retention_rate_monthly", "3_week_active_users_retention_rate_weekly", "3_week_new_users_retention_rate_weekly", "4_day_active_users_retention_rate_daily", "4_day_new_users_retention_rate_daily", "4_month_active_users_retention_rate_monthly", "4_month_new_users_retention_rate_monthly", "4_week_active_users_retention_rate_weekly", "4_week_new_users_retention_rate_weekly", "5_day_active_users_retention_rate_daily", "5_day_new_users_retention_rate_daily", "5_month_active_users_retention_rate_monthly", "5_month_new_users_retention_rate_monthly", "5_week_active_users_retention_rate_weekly", "5_week_new_users_retention_rate_weekly", "6_day_active_users_retention_rate_daily", "6_day_new_users_retention_rate_daily", "6_month_active_users_retention_rate_monthly", "6_month_new_users_retention_rate_monthly", "6_week_active_users_retention_rate_weekly", "6_week_new_users_retention_rate_weekly", "7_day_active_users_retention_rate_daily", "7_day_new_users_retention_rate_daily", "7_month_active_users_retention_rate_monthly", "7_month_new_users_retention_rate_monthly", "7_week_active_users_retention_rate_weekly", "7_week_new_users_retention_rate_weekly", "next_day_active_users_retention_rate_daily", "next_day_new_users_retention_rate_daily", "next_month_active_users_retention_rate_monthly", "next_month_new_users_retention_rate_monthly", "next_week_active_users_retention_rate_weekly", "next_week_new_users_retention_rate_weekly", "weighted_14_day_new_users_retention_rate_daily", "weighted_30_day_new_users_retention_rate_daily" "weighted_3_day_new_users_retention_rate_daily", "weighted_3_month_new_users_retention_rate_monthly", "weighted_3_week_new_users_retention_rate_weekly", "weighted_4_month_new_users_retention_rate_monthly", "weighted_4_week_new_users_retention_rate_weekly", "weighted_7_day_new_users_retention_rate_daily", "weighted_next_day_new_users_retention_rate_daily", "weighted_next_month_new_users_retention_rate_monthly", "weighted_next_week_new_users_retention_rate_weekly"]},
    {"name": "return回流", "metrics": ["return_users_count"]},
    {"name": "login登录", "metrics": ["first_login_ratio","second_login_ratio"]},
    {"name": "revenue收入", "metrics": ["average_revenue_per_users_arpu","average_revenue_per_paying_users_arppu","new_user_average_revenue_per_users_arpu","base_game_gross_revenue", "base_game_gross_revenue_ratio", "base_game_revenue_after_refund_and_tax", "gross_revenue", "lifetime_gross_revenue", "lifetime_pay_amount", "lifetime_revenue_after_refund", "new_player_pay_rate", "pay_amount", "refund_revenue", "revenue_after_refund"]},
    {"name": "sale销量(for pc/console game)", "metrics": ["average_selling_price","base_game_average_selling_price", "units_sold_after_refund", "gross_base_game_units_sold", "gross_units_sold", "lifetime_base_game_gross_units_sold", "lifetime_base_game_units_sold_after_refund", "lifetime_gross_units_sold", "third_party_units", "units_sold_after_refund_for_product"]},
    {"name": "technical技术性能(for pc/console game)", "metrics": ["0_to_60_ms_ping_player_rate", "120_to_150_ms_ping_player_rate", "150_to_200_ms_ping_player_rate", "200_to_300_ms_ping_player_rate", "60_to_80_ms_ping_player_rate", "80_percentile_ping", "80_to_120_ms_ping_player_rate", "95_percentile_ping", "average_lowest_1_percent_fps", "crash_count", "crash_rate", "cumulative_crash_count", "mean_time_between_crashes", "median_fps", "median_ping"]},
    {"name": "wishlist 愿望单(for pc/console game)", "metrics": ["wishlist","daily_wishlist_add_count_without_delete_purchase_gift_daily", "daily_wishlist_delete_count_daily", "lifetime_steam_wishlist_conversion_count", "lifetime_steam_wishlist_deletes", "lifetime_steam_wishlist_gifts", "lifetime_steam_wishlist_purchases_activations", "new_wishlist_add_count_daily", "lifetime_wishlist_add_count_daily", "lifetime_wishlist_count", "lifetime_wishlist_coversion_rate"]},
    ]
    *IMPORTANT metrics choice rules*: 1. When asked for realtime metrics, must choose from the 'realtime实时类指标' metrics over daily metrics, other metrics don't support realtime granularity. “实时累计销量”用lifetime_base_game_units_sold_after_refund_realtime，“当日实时销量”用units_sold_after_refund_realtime，“实时累计收入”用lifetime_revenue_after_refund_realtime。
    2. pc/console游戏针对sales销量(游戏产品购买人数)的metric理解，判断用户是否提及特定的时间范围内或特定日期/月份的销量（如今年/上个月/12月/7号/近一周/按月销量），如果不是，默认查累计销量lifetime_base_game_units_sold_after_refund（累计销量是从游戏发行或内购开始的到查询日期截止的所有销量加总，通常只查某一天的，没有monthly和yearly的概念)。 如果提及了特定的时间范围内或特定日期/月份，默认查单日本体销量指标units_sold_after_refund+daily/monthly/yearly granularity，除非用户提及dlc、版本升级、分产品、分版本、升级版的销量，或有多少玩家做了升级，这种情况则要用units_sold_after_refund_for_product。
    3. 问mobile游戏的收入/销量，使用pay_amount；问pc/console游戏的收入，判断用户是否提及特定的时间范围内或特定日期/月份的收入（如今年/上个月/12月/7号/近一周/按月收入），如果不是，默认查累计收入lifetime_revenue_after_refund（通常只查某一天的，没有monthly和yearly的概念)。 如果提及了特定的时间范围内或特定日期/月份，查询单日收入revenue_after_refunddaily/monthly/yearly granularity。
    4. PCU对应指标是peak_concurrent_users_count. CCU/实时在线对应online_users_count_realtime. ACU(平均同时在线)对应average_concurrent_users_count.
    5. 问留存默认用new user retention而不是active user retention。
    6. 问活跃的时候，明确问每个月的日活跃的峰值(月峰值dau)才使用peak_daily_active_users，用户明确提及平均的情况下使用average_daily_active_users_in_week_or_month， 其他情况下问dau、wau和mau（包括“峰值MAU/最高MAU/峰值WAU/最高WAU/非按月统计的有明确日期的峰值dau，如x月x号到x月x号的dau峰值”）都用active_users_count（DAU=daily、WAU=weekly、MAU=monthly）。
    7. pc/console游戏的付费用户query使用in_game_paying_users相关指标
    8. 每活跃用户在线时长用average_online_time。每活跃用户session数用average_session_count。
    9. 问ua的广告点击率/转化率，要使用ua_ctr/ua_conversion_rate(ua_cvr), ua是个专用term，要注意区分。
    10. tnu是total new users的缩写，对应lifetime_new_users_count。
    Returns: A string containing the results per game with metric_percentage_dict mapping metric keys to percentage, or fallback results from dashboard_metrics_query_tool if metric percentage query fails. The response will clearly indicate when fallback behavior was used.
    """
    logger.info(
        f"【Functool Call】-【dashboard_metric_percentage_tool】: game_names {game_names}, start_date {start_date}, end_date {end_date}, metrics {metrics}, granularity {granularity}, group_by_dimension {group_by_dimension}, zone {zone}, country {country}, os {os}, channel {channel}, region {region}, lang {lang}."
    )

    start_time = time.time()

    if not game_names:
        msg = "empty game_names. Retry with valid inputs. "
        logger.warning(msg)
        return msg

    message = ""
    data_results = None

    for i in range(len(game_names)):
        try:
            # get game name, game code, and game type
            game_name = game_names[i]
            game_type = context.context.dashboard_game_code_and_filters[game_name]["game_type"]
            game_code = context.context.dashboard_game_code_and_filters[game_name]["game_code"]
            is_nikke_xiaohao_query = False

            # default input if not specified
            retry_info_list = []
            try:
                update_flags = {}
                update_list, game_name, game_code, metrics, realtime_metrics, daily_metrics, non_realtime_daily_metrics, granularity, start_date, end_date, zone, country, os, channel, region, lang, category, product, metric_code_to_name_mapping, retry_info_list, _ = update_input(
                    game_name, game_code, game_type, metrics, granularity, start_date, end_date, context.context.user_input, "dashboard_metric_percentage_tool", context.context.dashboard_game_code_and_filters[game_name], zone, country, os, channel, region, lang, extra_flags=update_flags)
                is_nikke_xiaohao_query = bool(update_flags.get("is_xiaohao", False))
                message += "".join(update_list)
                #check if group_by_dimension is valid
                valid_group_by_dimensions = ["zone", "country", "os", "channel", "region", "lang"]
                if group_by_dimension and group_by_dimension not in valid_group_by_dimensions:
                    retry_info_list.append(
                        f"Invalid group_by_dimension: {group_by_dimension}. Must be one of {valid_group_by_dimensions}. "
                    )

                if not group_by_dimension:
                    dim_filters = {
                        "zone": zone,
                        "country": country,
                        "os": os,
                        "channel": channel,
                        "region": region,
                        "lang": lang,
                    }

                    # Infer group_by_dimension from which filter list is non-empty.
                    # Convention: ["255"] inside a filter list means "group by this dimension / all values".
                    candidate_dims = [dim for dim, vals in dim_filters.items() if vals]
                    if len(candidate_dims) == 1:
                        group_by_dimension = candidate_dims[0]
                    elif len(candidate_dims) == 0:
                        retry_info_list.append(
                            "No group_by_dimension provided and no dimension filter specified. "
                            "Please provide group_by_dimension or set exactly one dimension filter "
                            "(e.g. zone=['255'] to group by zone). "
                        )
                    else:
                        dims_with_255 = [dim for dim, vals in dim_filters.items() if isinstance(vals, list) and "255" in vals]
                        if len(dims_with_255) == 1:
                            group_by_dimension = dims_with_255[0]
                        else:
                            retry_info_list.append(
                                f"Multiple dimension filters provided: {candidate_dims}. "
                                "Please provide only one (zone/country/os/channel/region/lang) per tool call. "
                            )

                message += "".join(update_list)
            except Exception as e:
                logger.error(
                    f"Error in updating input for dashboard_metric_percentage_tool: {str(e)}")
                message += f"\n[Error] Failed to update input parameters: {str(e)}. Using default values."
                if not metrics:
                    metrics = ["active_users"]
                if not granularity:
                    granularity = "daily"
            if retry_info_list:
                logger.warning(
                    f"【Functool Warning】-【dashboard_metric_percentage_tool】: {retry_info_list}")
                message += "".join(retry_info_list)
                return message

            # Call get_metric_percentage_filter_with_fallback to get metric percentage for each metric
            try:
                query_results = await get_metric_percentage_filter_with_fallback(
                    game_code, start_date, end_date, metrics, granularity, group_by_dimension, zone, country, os, channel, region, lang, context.context.token, is_xiaohao=is_nikke_xiaohao_query
                )
                metric_percentage_dict = query_results.get("data")

                if query_results.get("fallback_info", ""):
                    message += "\n" + \
                        "\n".join(
                            f"[fallback_info]: {x}" for x in query_results["fallback_info"])

                print(
                    f"\033[93m Get metric percentage result for game {game_name}: {metric_percentage_dict}\033[0m"
                )

                # Check if we got any data from metric percentage query
                has_data = False
                if metric_percentage_dict:
                    for metric_data in metric_percentage_dict.values():
                        if metric_data and len(metric_data) > 0:
                            has_data = True
                            break

                if has_data:
                    # message += f" For granularity: {granularity}, the data is queried from {start_date} to {end_date}. "

                    # Handle reference urls
                    valid_keys = list(metric_percentage_dict.keys())
                    cover_url = context.context.game_icon_mapping.get(game_code, "")
                    url_map = gl.get_value("rb_url_map_json", expected_type=dict) or {}
                    references_list = []
                    dashboard_name = "经分" if context.context.language.lower() == "chinese" else "Dashboard"
                    for m in metrics:
                        if m in valid_keys:
                            url_pattern = f"v2/dashboard/game/{game_code}{DASHBOARD_METRIC_URL_BY_TYPE.get(game_type.lower(), {}).get(m, '/overview/daily')}"
                            url_pattern_for_mobile = "v2/dashboard/game/{game_code}" + \
                                f"{DASHBOARD_METRIC_URL_BY_TYPE.get(game_type.lower(), {}).get(m, '/overview/daily')}"
                            type_string = "m_mobile_url" if game_type.lower() == "mobile" else "pc_mobile_url"
                            mobile_url_pattern = url_map.get(url_pattern_for_mobile, {})
                            mobile_url_pattern = {} if mobile_url_pattern == "" else mobile_url_pattern
                            mobile_url = mobile_url_pattern.get(
                                type_string, "").format(game_code=game_code)
                            ref = ReferenceItem(
                                title=f"{game_name} - {DASHBOARD_METRIC_URL_BY_TYPE.get(game_type.lower(), {}).get(m, '/overview/daily')[1:]} - {dashboard_name}",
                                url=url_pattern,
                                mobile_url=mobile_url,
                                image_url=cover_url,
                                type="databrain",
                                name=f"{game_name} - {DASHBOARD_METRIC_URL_BY_TYPE.get(game_type.lower(), {}).get(m, '/overview/daily')[1:]} - {dashboard_name}",
                                favicon=cover_url
                            ).to_dict()
                            references_list.append(ref)
                            if context.context.references is None:
                                context.context.references = [references_list]
                            else:
                                if len(context.context.references) != 0 and isinstance(context.context.references[0], dict):
                                    url_set = set([x.get("url", "")
                                                  for x in context.context.references])
                                else:
                                    url_set = set()
                                if f"v2/dashboard/game/{game_code}{DASHBOARD_METRIC_URL_BY_TYPE.get(game_type.lower(), {}).get(m, '/overview/daily')}" not in url_set:
                                    context.context.references.append(ref)

                    # Handle bi data
                    # Check if any metric has more than 2 data points
                    # has_enough_data = any(len(metric_list) > 2 for metric_list in metric_percentage_dict.values() if isinstance(metric_list, list))

                    # bi_data, bi_data_id = get_metric_percentage_bi_data(metric_percentage_dict, metrics, game_name, game_type,
                    #                       True if context.context.language is None or "english" in context.context.language.lower() else False)

                    # Do not show bi_data if no metric has more than 2 data points
                    # if not has_enough_data:
                    #     bi_data_id = ""

                    # Initialize data_results and other variables
                    data_results = {}
                    data_csv = ""
                    description_str = ""

                    # Initialize valid_metrics to include both metric and metric_percent
                    valid_metrics = []
                    for m in metrics:
                        if m in valid_keys:
                            valid_metrics.append(m)
                            valid_metrics.append(m + "_percent")

                    # Apply metric code to name mapping to valid_metrics
                    if metric_code_to_name_mapping:
                        mapped_valid_metrics = []
                        for metric in valid_metrics:
                            # For _percent metrics, map the base metric name
                            base_metric = metric.replace("_percent", "")
                            if base_metric in metric_code_to_name_mapping:
                                mapped_base = metric_code_to_name_mapping[base_metric]
                                mapped_metric = mapped_base + "_percent" if "_percent" in metric else mapped_base
                                mapped_valid_metrics.append(mapped_metric)
                            else:
                                mapped_valid_metrics.append(metric)
                        valid_metrics = mapped_valid_metrics

                    # if bi_data is not None and bi_data:
                    #     context.context.data.append(bi_data)

                    # Apply metric code to name mapping before converting to CSV
                    raw_data = metric_percentage_dict
                    raw_data = apply_metric_code_to_name_mapping(
                        raw_data, metric_code_to_name_mapping)
                    print(f"mapped_data:{raw_data}")
                    print(f"valid_metrics:{valid_metrics}")

                    # Convert metric_percentage_dict to list format for convert_to_csv
                    # Flatten the dict structure to list of dicts
                    flattened_data = []
                    for metric_key, metric_list in raw_data.items():
                        for item in metric_list:
                            flattened_data.append(item)

                    # data_csv, description_str = convert_to_csv(flattened_data, valid_metrics)
                    data_results = {
                        "game_name": game_name,
                        # "data_id": bi_data_id,
                        "references": references_list,
                        "data": flattened_data,
                        "unit_info": [f"{x.get('metric_code', '')} has unit of {x.get('unit', '')}. " for x in DASHBOARD_METRIC_MAP if x.get("metric_code", "") in [m.replace("_percent", "") for m in valid_metrics] and x.get("metric_type", "").lower() == game_type.lower() and x.get("unit", "")]
                    }

                    # Keep results separate for each game
                    # all_games_metric_percentage_dict[game_name] = {
                    #     "game_code": game_code,
                    #     "metric_percentage_dict": metric_percentage_dict,
                    #     "data_results": data_results
                    # }

                    logger.info(
                        f"【Functool Return】-【dashboard_metric_percentage_tool】: Get metric percentage for game {game_name} with data: {data_results}. Clearly list the original value(use % to display if the original metric is a ratio itself) and ratio when output.")
                else:
                    message += f"No data found for {game_name} metric percentage query. "

            except DashboardPermissionException as e:
                logger.warning(str(e))
                message += f"User does not have permission to access {game_name} metric percentage data: " + str(
                    e) + ". Can handoff to Intelligence agent to get data."
                continue
            except DashboardEmptyDataException as e:
                logger.warning(str(e))
                message += f"No data found for {game_name} metric percentage query. "
                continue
            except Exception as e:
                logger.error(
                    f"Error getting metric percentage for {game_name}: {str(e)}")
                message += f"Encounter error in retrieving {game_name} metric percentage data: " + str(
                    e) + ". "
                continue

        except Exception as e:
            logger.error(f"Error processing {game_names[i]}: {str(e)}")
            message += f"Encounter error in processing {game_names[i]}: " + str(
                e) + ". "
            continue

    log_metrics("dashboard_metric_percentage_tool", "0",
                round((time.time() - start_time) * 1000, 2))
    # update context.has_dashboard_data_list for sensitive data label
    if data_results:
        add_sensitive_dashboard_data(context.context, game_names)
    return f"Querying metric percentage for metrics {metrics} from {start_date} to {end_date} with granularity {granularity}, the results is {data_results}. {message}. Show both the original values and the percentage when output."[:8000000]
