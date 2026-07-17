from run_context_wrapper import RunContextWrapper
from datetime import datetime, timedelta, timezone
from loguru import logger
import time
import traceback
import json
import pandas as pd
import copy
from typing import Dict, List, Tuple, Any, Optional, Iterable

# Default metric used to rank top countries when user asks "头部国家的X" (X of top countries) without "按X排序"
DEFAULT_TOP_COUNTRY_RANK_METRIC_MOBILE = "active_users"
DEFAULT_TOP_COUNTRY_RANK_METRIC_CASUAL = "active_users"
DEFAULT_TOP_COUNTRY_RANK_METRIC_PC_CONSOLE = "units_number"
# dl1/dl2: custom_filters for Paid only (shared by handle_data and get_top_dimension_filter_with_fallback)
PAID_ONLY_CUSTOM_FILTERS = [{"key": "payment_type", "filter_list": ["Paid only"]}]
from collections import defaultdict

from dashboard_common.cls import log_metrics

from databrain.api import DASHBOARD_METRIC_API, async_send_request_with_token, DASHBOARD_PC_REALTIME_ACC_SALES_UNITS_REVENUE_API, DASHBOARD_DIMEMSION_TOP_API
from dashboard_strategy.context import GameContext, ReferenceItem, BiDataCsvEntry
from dashboard_data.region_code_map import COUNTRY_MAP_INTEL, REGION_MAP_INTEL
from dashboard_strategy.constants import ToolName
from dashboard_strategy.sensitive_data import add_sensitive_dashboard_data
from dashboard_common.config import globalvar as gl
from dashboard_tools.tool_common import get_tool_enabled, function_tool
from dashboard_tools.dashboard.utils.dashboard_metric_map import DASHBOARD_METRIC_MAP, DASHBOARD_METRIC_URL_BY_TYPE, DASHBOARD_METRIC_URL_BY_TYPE_REALTIME, DASHBOARD_METRIC_URL_BY_TYPE_MCP, DASHBOARD_MCP_METRIC_MAP_BY_NAME, DASHBOARD_METRIC_MAP_BY_NAME, get_dashboard_metric_info

from dashboard_utils.helper import default_tool_error_function
from dashboard_tools.dashboard.utils.dashboard_tools_util import remove_redundant_metric, update_input, get_bi_data, str_to_dt, dt_to_str, update_date, convert_to_csv, convert_to_csv_full, sort_query_data, sort_mcp_query_data, get_mcp_bi_data, apply_metric_code_to_name_mapping, _format_value_by_type, get_filter_name_to_code_map_from_context, convert_filter_values_to_codes
from dashboard_tools.dashboard.utils.pubgm_special_grouping import (
    PUBGM_SPECIAL_CHANNEL_GROUP_CODE_TO_LABEL,
    PUBGM_SPECIAL_CHANNEL_GROUP_UNGROUP_MAP,
    PUBGM_SPECIAL_GAME_CODES,
    PUBGM_SPECIAL_GROUP_USER_IDS,
    PUBGM_SPECIAL_REGION_GROUP_CODE_TO_LABEL,
    PUBGM_SPECIAL_REGION_GROUP_UNGROUP_MAP,
)


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


def _is_pubgm_special_group_query(context: RunContextWrapper[GameContext], game_code: str) -> bool:
    return (
        (getattr(context.context, "user_id", "") or "").lower() in PUBGM_SPECIAL_GROUP_USER_IDS
        and (game_code or "").lower() in PUBGM_SPECIAL_GAME_CODES
    )


def _attach_group_dimension_label(data: Any, dimension: str, label: str) -> Any:
    if not data:
        return data
    if isinstance(data, dict):
        if isinstance(data.get("metric_value"), list):
            for row in data["metric_value"]:
                if isinstance(row, dict):
                    row[dimension] = label
            return data
        for value in data.values():
            _attach_group_dimension_label(value, dimension, label)
        return data
    if isinstance(data, list):
        for row in data:
            if isinstance(row, dict):
                row[dimension] = label
        return data
    return data


def _merge_query_data(base_data: Any, incoming_data: Any) -> Any:
    if not base_data:
        return incoming_data
    if not incoming_data:
        return base_data
    if isinstance(base_data, dict) and isinstance(incoming_data, dict):
        if isinstance(base_data.get("metric_value"), list) and isinstance(incoming_data.get("metric_value"), list):
            base_data["metric_value"].extend(incoming_data["metric_value"])
            return base_data
        for key, value in incoming_data.items():
            if key not in base_data:
                base_data[key] = value
            else:
                if isinstance(base_data[key], list) and isinstance(value, list):
                    base_data[key].extend(value)
                elif isinstance(base_data[key], dict) and isinstance(value, dict):
                    base_data[key] = _merge_query_data(base_data[key], value)
                else:
                    base_data[key] = value
        return base_data
    if isinstance(base_data, list) and isinstance(incoming_data, list):
        base_data.extend(incoming_data)
        return base_data
    return incoming_data


def _merge_query_results_for_pubgm_region(
    query_results_list: List[Dict[str, Any]],
    requested_regions: List[str],
    requested_channels: List[str],
) -> Dict[str, Any]:
    if not query_results_list:
        return {
            "data": {},
            "fallback_info": [],
            "mcp_fallback_required": False,
            "asp_data_no_date": None,
            "actual_params": {"region": requested_regions, "channel": requested_channels},
        }
    merged = copy.deepcopy(query_results_list[0])
    for item in query_results_list[1:]:
        merged["data"] = _merge_query_data(merged.get("data"), item.get("data"))
        merged["asp_data_no_date"] = _merge_query_data(
            merged.get("asp_data_no_date"), item.get("asp_data_no_date")
        )
        merged["fallback_info"] = list(merged.get("fallback_info") or []) + list(item.get("fallback_info") or [])
        merged["mcp_fallback_required"] = bool(
            merged.get("mcp_fallback_required", False) or item.get("mcp_fallback_required", False)
        )
    if not isinstance(merged.get("actual_params"), dict):
        merged["actual_params"] = {}
    merged["actual_params"]["region"] = requested_regions
    merged["actual_params"]["channel"] = requested_channels
    return merged


async def get_top_dimension_filter(
    game_code: str,
    start_date: str,
    end_date: str,
    metrics: List[str],
    granularity: str,
    top_num: int,
    token: str,
    custom_filters: Any = None,
    is_xiaohao: bool = False,
) -> Dict[str, List[str]]:
    """
    Call the DASHBOARD_DIMEMSION_TOP_API to retrieve the top country values per metric.
    Returns dict mapping metric_key -> list of top country codes.
    """
    api_data = {
        "game_code": game_code,
        "start_date": start_date,
        "end_date": end_date,
        "metrics": metrics,
        "top_num": top_num,
        "granularity": granularity,
    }
    if custom_filters:
        api_data["filters"] = {"custom_filters": custom_filters}
        api_data["logical_flag"] = "platform_revenue_v2,platform_lifetime_revenue_v2"
    if is_xiaohao:
        api_data["is_xiaohao"] = True
    logger.info(
        f"【Tool API Call】- get_top_dimension_filter: Querying for {game_code}, {start_date}, {end_date}, {metrics}, {top_num}, {granularity}."
    )
    resp = await async_send_request_with_token(DASHBOARD_DIMEMSION_TOP_API, api_data, token)
    resp_json = resp.json()
    code = resp_json.get("code", -1)
    logger.info(f"【API Return】- DASHBOARD_DIMEMSION_TOP_API: {resp_json}. ")
    if code == 0:
        try:
            data_dict = resp_json.get("data", {})
            metric_country_dict = {}
            for metric_key, entries in data_dict.items():
                if isinstance(entries, list):
                    countries = []
                    seen = set()
                    for entry in entries:
                        country = entry.get("country")
                        if country and country not in seen:
                            seen.add(country)
                            countries.append(country)
                    metric_country_dict[metric_key] = countries
            logger.info(f"【API return】-【DASHBOARD_DIMEMSION_TOP_API】: metric_country_dict: {metric_country_dict}. ")
            has_countries = any(c and len(c) > 0 for c in metric_country_dict.values())
            if not has_countries:
                raise DashboardEmptyDataException("No data found in provided date range. ")
            return metric_country_dict
        except DashboardEmptyDataException:
            raise
        except Exception:
            logger.error(traceback.format_exc())
            raise
    elif code == 200051:
        raise DashboardPermissionException(game_code)
    elif code == 20011:
        raise DashboardEmptyDataException("No data found in provided date range. ")
    elif code == 4001:
        raise DashboardWrongTokenException("Token used is expired or wrong version of the token is used. Try using the latest token. ")
    else:
        raise DashboardException(resp_json.get("msg", "Unknown error. "))


async def get_top_dimension_filter_with_fallback(
    game_code: str,
    start_date: str,
    end_date: str,
    metrics: List[str],
    granularity: str,
    top_num: int,
    token: str,
    fall_back: bool = True,
    custom_filters: Any = None,
    is_xiaohao: bool = False,
) -> Dict[str, Any]:
    """
    Call DASHBOARD_DIMEMSION_TOP_API with fallback logic.
    Returns dict with "data" (metric_country_dict) and "fallback_info" (list of strings).
    """
    if not fall_back:
        result = await get_top_dimension_filter(
            game_code, start_date, end_date, metrics, granularity, top_num, token, custom_filters, is_xiaohao
        )
        return {"data": result, "fallback_info": []}
    logger.info(f"【Tool call】-【get_top_dimension_filter_with_fallback】: {game_code}, {start_date}, {end_date}, {metrics}, {granularity}, {top_num}. ")
    fallback_info_list = []
    try:
        result = await get_top_dimension_filter(
            game_code, start_date, end_date, metrics, granularity, top_num, token, custom_filters, is_xiaohao
        )
        logger.info(f"【Tool return】-【get_top_dimension_filter_with_fallback】: data: {result}, fallback_info: {fallback_info_list}. ")
        return {"data": result, "fallback_info": fallback_info_list}
    except DashboardEmptyDataException:
        delta = str_to_dt(end_date) - str_to_dt(start_date)
        if str_to_dt(end_date).year != datetime.now().year and (not granularity or granularity.lower() != "realtime"):
            fallback_end_dt = str_to_dt(end_date).replace(year=datetime.now().year)
            fallback_start_dt = fallback_end_dt - delta
            fallback_info_list.append(
                f"Time fallback: end_date switched to current year ({dt_to_str(fallback_start_dt)} ~ {dt_to_str(fallback_end_dt)}). "
            )
            new_result = await get_top_dimension_filter_with_fallback(
                game_code, dt_to_str(fallback_start_dt), dt_to_str(fallback_end_dt),
                metrics, granularity, top_num, token, custom_filters=custom_filters, is_xiaohao=is_xiaohao
            )
        elif delta.days < 30 and (not granularity or granularity.lower() != "realtime"):
            new_start_dt = str_to_dt(end_date) - timedelta(days=30)
            fallback_info_list.append(
                f"Time fallback: range < 30d, expanded to 30-day window ({dt_to_str(new_start_dt)} ~ {end_date}). "
            )
            new_result = await get_top_dimension_filter_with_fallback(
                game_code, dt_to_str(new_start_dt), end_date,
                metrics, granularity, top_num, token, custom_filters=custom_filters, is_xiaohao=is_xiaohao
            )
        elif granularity in ("weekly", "monthly"):
            fallback_info_list.append(
                f"Granularity fallback: no data for granularity={granularity}; retry with daily over past 30 days. "
            )
            new_end_dt = str_to_dt(end_date)
            new_start_dt = new_end_dt - timedelta(days=30)
            new_result = await get_top_dimension_filter_with_fallback(
                game_code, dt_to_str(new_start_dt), dt_to_str(new_end_dt),
                metrics, "daily", top_num, token, custom_filters=custom_filters, is_xiaohao=is_xiaohao
            )
        else:
            fallback_info_list.append("Fallback failed: no additional strategy available. ")
            return {"data": {}, "fallback_info": fallback_info_list}
        if isinstance(new_result, dict) and "fallback_info" in new_result:
            fallback_info_list.extend(
                new_result["fallback_info"] if isinstance(new_result["fallback_info"], list) else [new_result["fallback_info"]]
            )
        logger.info(f"【Tool return】-【get_top_dimension_filter_with_fallback】: result: {new_result}, fallback_info_list: {fallback_info_list}. ")
        return {
            "data": new_result["data"] if isinstance(new_result, dict) and "data" in new_result else new_result,
            "fallback_info": fallback_info_list
        }
    except (DashboardPermissionException, DashboardWrongTokenException, DashboardException):
        raise

async def query_asp_metrics_without_date_grouping(
    token,
    game_code,
    start_date,
    end_date,
    metrics,
    granularity,
    zone,
    country,
    os,
    channel,
    region,
    lang,
    category,
    product,
    campaign,
    ua_network,
    exclude_region_group_by: bool = False,
    exclude_channel_group_by: bool = False,
) -> Optional[Dict[str, Any]]:
    """
    Helper function to query ASP metrics without date grouping when conditions are met.
    
    Conditions:
    - Metrics include "asp" or "full_game_asp" (or their mapped names)
    - One or more filters are not empty
    
    Args:
        token: User token for API call
        game_code: Game code to query
        start_date: Start date for query
        end_date: End date for query
        metrics: List of metrics to query
        granularity: Granularity for query
        zone, country, os, channel, region, lang, category, product: Filter lists
    
    Returns:
        Dict containing the API response data if successful, None otherwise
    """
    print(f"\033[93m[DEBUG] query_asp_metrics_without_date_grouping called - game_code={game_code}, metrics={metrics}\033[0m")
    
    # Check if metrics include "asp" or "full_game_asp" (or their mapped names)
    asp_metrics = ["asp", "full_game_asp",
                   "average_selling_price", "base_game_average_selling_price"]
    metrics_lower = [m.lower() for m in metrics]
    has_asp_metric = any(
        asp_m in metrics or asp_m in metrics_lower for asp_m in asp_metrics)
    # Check if filters are not empty
    filters_not_empty = bool(
        (zone and len(zone) > 0) or
        (country and len(country) > 0) or
        (os and len(os) > 0) or
        (channel and len(channel) > 0) or
        (region and len(region) > 0) or
        (lang and len(lang) > 0) or
        (category and len(category) > 0) or
        (product and len(product) > 0) or
        (campaign and len(campaign) > 0) or
        (ua_network and len(ua_network) > 0)
    )
    print(f"\033[93m[DEBUG] query_asp_metrics_without_date_grouping - has_asp_metric={has_asp_metric}, filters_not_empty={filters_not_empty}\033[0m")
    
    if not (has_asp_metric and filters_not_empty):
        print(f"\033[93m[DEBUG] query_asp_metrics_without_date_grouping - conditions not met, returning None\033[0m")
        return None
    try:
        # Build group_by without date
        group_by_no_date = []
        if zone:
            group_by_no_date.append("zone")
        if country:
            group_by_no_date.append("country")
        if os:
            group_by_no_date.append("os")
        if channel and not exclude_channel_group_by:
            group_by_no_date.append("channel")
        if region and not exclude_region_group_by:
            group_by_no_date.append("region")
        if lang:
            group_by_no_date.append("lang")
        if category:
            group_by_no_date.append("category")
        if product:
            group_by_no_date.append("product")
        if campaign:
            group_by_no_date.append("campaign")
        if ua_network:
            group_by_no_date.append("ua_network")
        # Prepare data for API call (same input but no group by date)
        data = {
            "game_code": game_code,
            "start_date": start_date,
            "end_date": end_date,
            "metrics": metrics,
            "granularity": granularity or "daily",
            "filters": {
                "zone": zone or [],
                "country": country or [],
                "os": os or [],
                "channel": channel or [],
                "region": region or [],
                "lang": lang or [],
                "category": category or [],
                "product": product or [],
                "campaign": campaign or [],
                "ua_network": ua_network or [],
            },
            "logical_flag": "query_total_by_dimension",
            "group_by": group_by_no_date
        }
        logger.info(
            f"[query_asp_metrics_without_date_grouping] Making additional API call for ASP metrics without date grouping: {data}")
        response = await async_send_request_with_token(DASHBOARD_METRIC_API, data, token)
        response_json = response.json()
        code = response_json.get("code", -1)
        if code == 0:
            asp_data_no_date = response_json.get("data")
            logger.info(
                f"[query_asp_metrics_without_date_grouping] Additional API call completed successfully")
            print(f"\033[93m[DEBUG] query_asp_metrics_without_date_grouping - API call successful, returning data\033[0m")
            return asp_data_no_date
        else:
            logger.warning(
                f"[query_asp_metrics_without_date_grouping] Additional API call failed with code: {code}")
            return None
    except Exception as e:
        logger.warning(
            f"[query_asp_metrics_without_date_grouping] Failed to make additional API call for ASP metrics: {e}")
        logger.warning(traceback.format_exc())
        return None



#API call for dashboard metrics
async def query_dashboard_metrics(
    token,
    game_code,
    start_date,
    end_date,
    metrics,
    granularity,
    zone,
    country,
    os,
    channel,
    region,
    lang,
    category,
    product,
    campaign,
    ua_network,
    entity_type,
    key_country,
    custom_filters=None,
    is_xiaohao: bool = False,
    exclude_region_group_by: bool = False,
    exclude_channel_group_by: bool = False,
):

    logger.info(
        f"【Tool call】-【dashboard_query_dashboard_metrics】: Found input: {game_code}, {start_date}, {end_date}, {metrics}, {granularity}, {zone}, {country}, {os}, {channel}, {region}, {lang}, {category}, {product}, {entity_type}, {key_country}. ")

    group_by = ["date"]
    if zone:
        group_by.append("zone")
    if country:
        group_by.append("country")
    if os:
        group_by.append("os")
    if channel and not exclude_channel_group_by:
        group_by.append("channel")
    if region and not exclude_region_group_by:
        group_by.append("region")
    if lang:
        group_by.append("lang")
    if category:
        group_by.append("category")
    if product:
        group_by.append("product")
    if campaign:
        group_by.append("campaign")
    if ua_network:
        group_by.append("ua_network")

    logger.info(
        f"【Tool API Call】- query_dashboard_metrics: Querying metrics for {game_code}, {metrics}, {start_date}, {end_date}, {granularity}, {zone}, {country}, {region}, {os}, {channel}, {lang}, {category}, {product}, {group_by}, {entity_type}."
    )

    # retrieve metrics
    data = {
        "game_code": game_code,
        "start_date": start_date,
        "end_date": end_date,
        "metrics": metrics,
        "granularity": granularity,
        "filters": {
            "zone": zone,
            "country": country,
            "os": os,
            "channel": channel,
            "region": region,
            "lang": lang,
            "category": category,
            "product": product,
            "campaign": campaign,
            "ua_network": ua_network,
        },
        "logical_flag": "query_total_by_dimension",
        "group_by": group_by
    }
    if is_xiaohao:
        data["is_xiaohao"] = True
    if custom_filters:
        data["logical_flag"] ="platform_revenue_v2,platform_lifetime_revenue_v2"
        data["filters"]["custom_filters"] = custom_filters

    print(
        f"\033[93m Call query_dashboard_metrics with url: {DASHBOARD_METRIC_API} with data: {data}\033[0m"
    )

    # response = send_request_with_token(DASHBOARD_METRIC_API, data, token)
    response = await async_send_request_with_token(DASHBOARD_METRIC_API, data, token)

    response_json = response.json()
    code = response_json.get("code", -1)

    # logger.info(
    #     f"【Tool API Return】- query_dashboard_metrics: {response_json}. "
    # )

    # handle api outputs
    if code == 0:
        try:

            logger.info(
                f"【Tool return】-【dashboard_query_dashboard_metrics】: response_json['data']: {response_json['data']}. ")

            return response_json["data"]
        except Exception:
            logger.error(traceback.format_exc())
            raise
    elif code == 200051:  # no data permission on given games
        raise DashboardPermissionException(game_code)
    elif code == 20011:  # no data found in date range
        raise DashboardEmptyDataException(
            "No data found in provided date range. MCP fallback will be attempted to search alternative data sources.")
    elif code == 4001:  # token is expired or wrong version of token is used
        raise DashboardWrongTokenException(
            "Token used is expired or wrong version of the token is used. Try using the latest token. ")
    else:
        raise DashboardException(response_json.get("msg", "Unknown error. "))


# TODO： 删除 补丁API call for dashboard pc realtime acc sales units revenue
async def query_dashboard_pc_realtime_acc_sales_units_revenue(
    token: str,
    game_code: str,
    os: List[str] = None,
    category: List[str] = None,
    product: List[str] = None,
    zone: List[str] = None,
    channel: List[str] = None,
    lang: List[str] = None
) -> Dict[str, any]:
    """
    Query PC realtime accumulated sales units revenue data for a specific game.

    Args:
        token (str): User token for API call
        game_code (str): Game code to query data for
        os (List[str], optional): OS filters. Defaults to ["255"] if empty.
        category (List[str], optional): Category filters. Defaults to ["255"] if empty.
        product (List[str], optional): Product filters. Defaults to ["255"] if empty.
        zone (List[str], optional): Zone filters. Defaults to ["255"] if empty.
        channel (List[str], optional): Channel filters. Defaults to ["255"] if empty.
        lang (List[str], optional): Language filters. Defaults to ["255"] if empty.

    Returns:
        Dict[str, any]: API response data containing accumulated sales units revenue information
    """

    # Set default values for empty filters
    os = os if os else ["255"]
    category = category if category else ["255"]
    product = product if product else ["255"]
    zone = zone if zone else ["255"]
    channel = channel if channel else ["255"]
    lang = lang if lang else ["255"]

    # Hardcode market_list to ["255"]
    filters = {
        "market_list": ["255"],
        "os_list": os,
        "category_list": category,
        "product_list": product,
        "zone_list": zone,
        "channel_list": channel,
        "lang_list": lang
    }
    date = "2021-01-01"  # 这个接口无论输入什么日期，都只会返回最新一天最近一小时的数据，占位符hard code
    contrast_day = "2021-01-01"  # 这个接口无论输入什么日期，都只会返回最新一天最近一小时的数据，占位符hard code

    logger.info(
        f"【Tool call】-【dashboard_query_pc_realtime_acc_sales_units_revenue】: Found input: {game_code}, {filters}, {date}, {contrast_day}. ")

    try:
        # Prepare API request data
        data = {
            "game_code": game_code,
            "filters": filters,
            "date": date,
            "contrast_day": contrast_day
        }

        logger.info(
            f"【Tool API Call】- query_dashboard_pc_realtime_acc_sales_units_revenue: Querying realtime data for {game_code}, {date}, {contrast_day}, {filters}.")

        print(
            f"\033[93m Call query_dashboard_pc_realtime_acc_sales_units_revenue with url: {DASHBOARD_PC_REALTIME_ACC_SALES_UNITS_REVENUE_API} with data: {data}.\033[0m")

        # Make API call
        response = await async_send_request_with_token(DASHBOARD_PC_REALTIME_ACC_SALES_UNITS_REVENUE_API, data, token)

        response_json = response.json()
        code = response_json.get("code", -1)

        logger.info(
            f"【Tool API Return】- query_dashboard_pc_realtime_acc_sales_units_revenue: {response_json}. ")

        print(
            f"\033[93m Get response from query_dashboard_pc_realtime_acc_sales_units_revenue with data: {response_json}\033[0m")

        # Handle API response
        if code == 0:
            try:
                logger.info(
                    f"【Tool return】-【dashboard_query_pc_realtime_acc_sales_units_revenue】: response_json['data']: {response_json['data']}. ")
                return response_json["data"]
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
            raise DashboardException(
                response_json.get("msg", "Unknown error. "))

    except Exception as e:
        logger.warning(
            f"【Tool return】-【dashboard_query_pc_realtime_acc_sales_units_revenue】: Error occurred: {e}, returning: {str(e)}. ")
        logger.warning(traceback.format_exc())
        raise

async def query_dashboard_metrics_with_fallback(
    token,
    game_code,
    start_date,
    end_date,
    metrics,
    granularity,
    zone,
    country,
    os,
    channel,
    region,
    lang,
    category,
    product,
    campaign,
    ua_network,
    entity_type,
    key_country,
    fall_back=True,
    custom_filters=None,
    is_xiaohao: bool = False,
    exclude_region_group_by: bool = False,
    exclude_channel_group_by: bool = False,
):

    if not fall_back:
        result = await query_dashboard_metrics(
            token, game_code, start_date, end_date,
            metrics, granularity, zone, country, os, channel, region, lang, category, product, campaign, ua_network, entity_type, key_country, custom_filters, is_xiaohao, exclude_region_group_by, exclude_channel_group_by
        )
        
                # Check if we need to make an additional API call for ASP metrics without date grouping
        asp_data_no_date = await query_asp_metrics_without_date_grouping(
            token, game_code, start_date, end_date, metrics, granularity,
            zone, country, os, channel, region, lang, category, product, campaign, ua_network, exclude_region_group_by, exclude_channel_group_by
        )   
        return {"data": result,  "fallback_info": [],
                "asp_data_no_date": asp_data_no_date,
                "actual_params": {
                    "start_date": start_date,
                    "end_date": end_date,
                    "granularity": granularity,
                    "os": os,
                    "zone": zone,
                    "country": country,
                    "channel": channel,
                    "region": region,
                    "lang": lang,
                    "category": category,
                    "product": product,
                    "campaign": campaign,
                    "ua_network": ua_network,
                }}

    logger.info(
        f"【Tool call】-【dashboard_query_dashboard_metrics_with_fallback】: Found input: {game_code}, {start_date}, {end_date}, {metrics}, {granularity}, {zone}, {country}, {os}, {channel}, {region}, {lang}, {category}, {product}, {entity_type}. ")

    fallback_info_list = []

    try:
        result = await query_dashboard_metrics(
            token, game_code, start_date, end_date,
            metrics, granularity, zone, country, os, channel, region, lang, category, product, campaign, ua_network, entity_type, key_country, custom_filters, is_xiaohao, exclude_region_group_by, exclude_channel_group_by
        )

        # Check if we need to make an additional API call for ASP metrics without date grouping
        asp_data_no_date = await query_asp_metrics_without_date_grouping(
            token, game_code, start_date, end_date, metrics, granularity,
            zone, country, os, channel, region, lang, category, product, campaign, ua_network, exclude_region_group_by, exclude_channel_group_by
        )

        logger.info(
            f"【Tool return】-【dashboard_query_dashboard_metrics_with_fallback】: data: {result}, fallback_info: {fallback_info_list}. ")

        return {
            "data": result,
            "fallback_info": fallback_info_list,
            "asp_data_no_date": asp_data_no_date,
            "actual_params": {
                "start_date": start_date,
                "end_date": end_date,
                "granularity": granularity,
                "os": os,
                "zone": zone,
                "country": country,
                "channel": channel,
                "region": region,
                "lang": lang,
                "category": category,
                "product": product,
                "campaign": campaign,
                "ua_network": ua_network,
            }
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

            new_result = await query_dashboard_metrics_with_fallback(
                token, game_code,
                dt_to_str(fallback_start_dt),
                dt_to_str(fallback_end_dt),
                metrics, granularity, zone, country, os, channel, region, lang, category, product, campaign, ua_network, entity_type, key_country,
                fall_back=True, custom_filters=custom_filters, is_xiaohao=is_xiaohao, exclude_region_group_by=exclude_region_group_by, exclude_channel_group_by=exclude_channel_group_by
            )

        # Step 2: if range < 30 days, expand to 30-day window
        elif delta.days < 30 and (not granularity or granularity.lower() != "realtime"):
            new_start_dt = str_to_dt(end_date) - timedelta(days=30)
            fallback_info_list.append(
                f"Time fallback: range < 30d, expanded to 30-day window ({dt_to_str(new_start_dt)} ~ {end_date}). "
            )

            new_result = await query_dashboard_metrics_with_fallback(
                token, game_code,
                dt_to_str(new_start_dt),
                end_date,
                metrics, granularity, zone, country, os, channel, region, lang, category, product, campaign, ua_network, entity_type, key_country,
                fall_back=True, custom_filters=custom_filters, is_xiaohao=is_xiaohao, exclude_region_group_by=exclude_region_group_by, exclude_channel_group_by=exclude_channel_group_by
            )

        # Step 3: fallback from weekly/monthly to daily with 30-day window
        elif granularity in ("weekly", "monthly"):
            fallback_info_list.append(
                f"Granularity fallback: no data for granularity={granularity}; retry with daily over past 30 days. "
            )
            new_end_dt = str_to_dt(end_date)
            new_start_dt = new_end_dt - timedelta(days=30)

            new_result = await query_dashboard_metrics_with_fallback(
                token, game_code,
                dt_to_str(new_start_dt),
                dt_to_str(new_end_dt),
                metrics, "daily", zone, country, os, channel, region, lang, category, product, campaign, ua_network, entity_type, key_country,
                fall_back=True, custom_filters=custom_filters, is_xiaohao=is_xiaohao, exclude_region_group_by=exclude_region_group_by, exclude_channel_group_by=exclude_channel_group_by
            )

        # Step 4: fallback by clearing filters
        elif zone or country or os or channel or region or lang or category or product or campaign or ua_network:
            if ua_network:
                removed_filter = {'ua_network': ua_network}
                ua_network = []
            elif campaign:
                removed_filter = {'campaign': campaign}
                campaign = []
            elif channel:
                removed_filter = {'channel': channel}
                channel = []
            elif product:
                removed_filter = {'product': product}
                product = []
            elif category:
                removed_filter = {'category': category}
                category = []
            elif lang:
                removed_filter = {'lang': lang}
                lang = []
            elif zone:
                removed_filter = {'zone': zone}
                zone = []
            elif region:
                removed_filter = {'region': region}
                region = []
            elif os:
                removed_filter = {'os': os}
                os = []
            else:
                removed_filter = {'country': country}
                country = []

            # Create more specific messaging for country filters
            if 'country' in removed_filter:
                country_names = ", ".join(country) if isinstance(
                    country, list) else str(country)
                fallback_info_list.append(
                    f"Country filter fallback: No data found for specified countries ({country_names}), showing global data instead. ")
            else:
                removed_desc = ", ".join(
                    [f"{k}: {v}" for k, v in removed_filter.items()])
                fallback_info_list.append(
                    f"{removed_filter.keys()} Filter fallback: removed filters — {removed_desc}. ")

            new_result = await query_dashboard_metrics_with_fallback(
                token, game_code,
                start_date,
                end_date,
                metrics, granularity,
                zone, country, os, channel, region, lang, category, product, campaign, ua_network,  # clear filters
                entity_type, key_country,
                fall_back=True, custom_filters=custom_filters, is_xiaohao=is_xiaohao, exclude_region_group_by=exclude_region_group_by, exclude_channel_group_by=exclude_channel_group_by
            )

        else:  # Step 5: no more fallback options - try MCP tools
            if game_code == "dl_the_beast":
                print(
                    f"\033[93m no more fallback options, try MCP tools\033[0m"
                )

                fallback_info_list.append(
                    "Fallback failed: no additional strategy available. ")
                fallback_info_list.append(
                    "MCP fallback: Attempting to search using MCP tools for alternative data sources. ")
                return {
                    "data": {},
                    "fallback_info": fallback_info_list,
                    "mcp_fallback_required": True,
                    "actual_params": {
                        "start_date": start_date,
                        "end_date": end_date,
                        "granularity": granularity,
                        "os": os,
                        "zone": zone,
                        "country": country,
                        "channel": channel,
                        "region": region,
                        "lang": lang,
                        "category": category,
                        "product": product,
                        "campaign": campaign,
                        "ua_network": ua_network,
                    }
                }
            else:
                fallback_info_list.append(
                    "Fallback failed: no additional strategy available. ")
            new_result = {}

        # 合并下一层 fallback_info
        if isinstance(new_result, dict) and "fallback_info" in new_result:
            fallback_info_list.extend(
                new_result["fallback_info"]
                if isinstance(new_result["fallback_info"], list)
                else [new_result["fallback_info"]]
            )

        logger.info(
            f"【Tool return】-【dashboard_query_dashboard_metrics_with_fallback】: result: {new_result}, fallback_info_list: {fallback_info_list}. ")

        # Get actual_params from nested fallback result, or use current params if not available
        actual_params = new_result.get("actual_params") if isinstance(new_result, dict) and "actual_params" in new_result else {
            "start_date": start_date,
            "end_date": end_date,
            "granularity": granularity,
            "os": os,
            "zone": zone,
            "country": country,
            "channel": channel,
            "region": region,
            "lang": lang,
            "category": category,
            "product": product,
            "campaign": campaign,
            "ua_network": ua_network,
        }

        return {
            "data": new_result["data"] if isinstance(new_result, dict) and "data" in new_result else new_result,
            "fallback_info": fallback_info_list,
            "mcp_fallback_required": new_result.get("mcp_fallback_required", False) if isinstance(new_result, dict) else False,
            "asp_data_no_date": new_result.get("asp_data_no_date") if isinstance(new_result, dict) else None,
            "actual_params": actual_params
        }	       


def filter_zero_products_from_api_result(
    api_result: Dict[str, Any],
    valid_metrics: List[str],
    granularity: str | None,
) -> Dict[str, Any]:
    """
    Post-process API result:
    - When product breakdown (by product) exists, filter out products whose metric values are all zero across the selected time range.
    - Supports both realtime and non-realtime data structures.

    Args:
        api_result: Full API response with top-level "data" key.
        valid_metrics: Metric keys to check for zero values.
        granularity: "realtime", "daily", "weekly", "monthly", etc.

    Returns:
        A new API result with zero-only products removed.
    """
    if not api_result or "data" not in api_result:
        return api_result

    data = api_result["data"]
    if not isinstance(data, dict):
        return api_result

    api_result["data"] = _filter_zero_products_in_data(
        data=data,
        valid_metrics=valid_metrics,
        granularity=granularity,
    )
    return api_result


async def _query_dashboard_metrics_with_special_pubgm_region_grouping(
    context: RunContextWrapper[GameContext],
    token,
    game_code,
    start_date,
    end_date,
    metrics,
    granularity,
    zone,
    country,
    os,
    channel,
    region,
    lang,
    category,
    product,
    campaign,
    ua_network,
    entity_type,
    key_country,
    fall_back=True,
    custom_filters=None,
    is_xiaohao: bool = False,
) -> Dict[str, Any]:
    if not _is_pubgm_special_group_query(context, game_code):
        return await query_dashboard_metrics_with_fallback(
            token, game_code, start_date, end_date, metrics, granularity,
            zone, country, os, channel, region, lang, category, product, campaign, ua_network,
            entity_type, key_country, fall_back=fall_back,
            custom_filters=custom_filters, is_xiaohao=is_xiaohao
        )

    grouped_region_codes = [r for r in (region or []) if r in PUBGM_SPECIAL_REGION_GROUP_UNGROUP_MAP]
    grouped_channel_codes = [c for c in (channel or []) if c in PUBGM_SPECIAL_CHANNEL_GROUP_UNGROUP_MAP]
    if not grouped_region_codes and not grouped_channel_codes:
        return await query_dashboard_metrics_with_fallback(
            token, game_code, start_date, end_date, metrics, granularity,
            zone, country, os, channel, region, lang, category, product, campaign, ua_network,
            entity_type, key_country, fall_back=fall_back,
            custom_filters=custom_filters, is_xiaohao=is_xiaohao
        )

    # Convert grouped member names to raw API codes before calling metrics API.
    region_name_to_code_map = get_filter_name_to_code_map_from_context(context.context, game_code, "region")
    channel_name_to_code_map = get_filter_name_to_code_map_from_context(context.context, game_code, "channel")

    region_variants = []
    normal_regions = [r for r in (region or []) if r not in PUBGM_SPECIAL_REGION_GROUP_UNGROUP_MAP]
    if normal_regions:
        region_variants.append((normal_regions, None, False))
    for region_group_code in grouped_region_codes:
        region_members = PUBGM_SPECIAL_REGION_GROUP_UNGROUP_MAP.get(region_group_code, [])
        if region_members:
            region_member_codes = convert_filter_values_to_codes(region_members, region_name_to_code_map)
            region_variants.append(
                (region_member_codes, PUBGM_SPECIAL_REGION_GROUP_CODE_TO_LABEL.get(region_group_code, region_group_code), True)
            )
    if not region_variants:
        region_variants = [(region, None, False)]

    channel_variants = []
    normal_channels = [c for c in (channel or []) if c not in PUBGM_SPECIAL_CHANNEL_GROUP_UNGROUP_MAP]
    if normal_channels:
        channel_variants.append((normal_channels, None, False))
    for channel_group_code in grouped_channel_codes:
        channel_members = PUBGM_SPECIAL_CHANNEL_GROUP_UNGROUP_MAP.get(channel_group_code, [])
        if channel_members:
            channel_member_codes = convert_filter_values_to_codes(channel_members, channel_name_to_code_map)
            channel_variants.append(
                (channel_member_codes, PUBGM_SPECIAL_CHANNEL_GROUP_CODE_TO_LABEL.get(channel_group_code, channel_group_code), True)
            )
    if not channel_variants:
        channel_variants = [(channel, None, False)]

    query_results_list = []
    for region_member_list, region_label, region_grouped in region_variants:
        for channel_member_list, channel_label, channel_grouped in channel_variants:
            grouped_result = await query_dashboard_metrics_with_fallback(
                token, game_code, start_date, end_date, metrics, granularity,
                zone, country, os, channel_member_list, region_member_list, lang, category, product, campaign, ua_network,
                entity_type, key_country, fall_back=fall_back,
                custom_filters=custom_filters, is_xiaohao=is_xiaohao,
                exclude_region_group_by=region_grouped,
                exclude_channel_group_by=channel_grouped,
            )
            if region_label:
                _attach_group_dimension_label(grouped_result.get("data"), "region", region_label)
                _attach_group_dimension_label(grouped_result.get("asp_data_no_date"), "region", region_label)
            if channel_label:
                _attach_group_dimension_label(grouped_result.get("data"), "channel", channel_label)
                _attach_group_dimension_label(grouped_result.get("asp_data_no_date"), "channel", channel_label)
            query_results_list.append(grouped_result)

    logger.info(
        f"PUBGM special grouped query executed. input_region={region}, input_channel={channel}, grouped_region_codes={grouped_region_codes}, grouped_channel_codes={grouped_channel_codes}"
    )
    return _merge_query_results_for_pubgm_region(
        query_results_list,
        requested_regions=region,
        requested_channels=channel,
    )


def _filter_zero_products_in_data(
    data: Dict[str, Any],
    valid_metrics: List[str],
    granularity: str | None,
) -> Dict[str, Any]:
    if not data or not valid_metrics:
        return data

    is_realtime = granularity is not None and granularity.lower() == "realtime"
    valid_metrics_set = set(valid_metrics)

    def is_zero_value(value: Any) -> bool:
        """
        Check whether a value is effectively zero:
        - None
        - empty string
        - "None"
        - numeric 0 (after float conversion)
        """
        if value is None:
            return True
        if isinstance(value, str):
            if value.strip() in ("", "None"):
                return True
        try:
            return float(value) == 0.0
        except (ValueError, TypeError):
            # If it can't be converted to float, treat it as non-zero.
            return False

    def detect_product_field(records: List[Dict[str, Any]]) -> str | None:
        """Return product field name if present ('product_name' or 'product')."""
        if not records:
            return None
        sample = records[0]
        if "product_name" in sample:
            return "product_name"
        if "product" in sample:
            return "product"
        return None

    def group_by_product(
        records: List[Dict[str, Any]],
        product_field: str,
    ) -> Dict[Any, List[Dict[str, Any]]]:
        """Group records by the given product field."""
        grouped: Dict[Any, List[Dict[str, Any]]] = defaultdict(list)
        for r in records:
            grouped[r.get(product_field, "")].append(r)
        return grouped

    def product_all_zero(product_records: Iterable[Dict[str, Any]]) -> bool:
        """
        Return True if a product's metric values are all zero across all records,
        considering only metrics in valid_metrics_set.
        """
        for record in product_records:
            for key, value in record.items():
                if key not in valid_metrics_set:
                    continue
                if not is_zero_value(value):
                    return False
        return True

    def has_real_product(records: List[Dict[str, Any]], product_field: str) -> bool:
        """
        Check whether we truly have 'by product' data:
        - At least one product_name is not ("", None, "All").
        """
        for r in records:
            name = r.get(product_field)
            if name not in (None, "", "All"):
                return True
        return False

    def filter_records_by_product(
        records: List[Dict[str, Any]],
    ) -> Tuple[List[Dict[str, Any]], List[Any]]:
        """
        Core logic: group by product and remove products whose metrics
        are all zero across the entire time range.

        Returns:
            filtered_records: flattened list of kept records
            removed_products: list of product identifiers that were removed
        """
        if not records:
            return records, []

        product_field = detect_product_field(records)
        if product_field is None:
            # No product dimension; nothing to do.
            return records, []

        if not has_real_product(records, product_field):
            # Only "All" (or empty) exists; do not filter.
            return records, []

        grouped = group_by_product(records, product_field)

        filtered_records: List[Dict[str, Any]] = []
        removed_products: List[Any] = []

        for product_value, product_records in grouped.items():
            # Keep the "All" aggregate (and empty / None) no matter what.
            if product_value in ("All", "", None):
                filtered_records.extend(product_records)
                continue

            if product_all_zero(product_records):
                removed_products.append(product_value)
            else:
                filtered_records.extend(product_records)

        return filtered_records, removed_products

    # ---------- realtime: data = { metric_name: [records...] } ----------
    if is_realtime:
        new_data: Dict[str, Any] = {}

        for metric_key, metric_records in data.items():
            # Pass through non-list values as-is.
            if not isinstance(metric_records, list):
                new_data[metric_key] = metric_records
                continue

            filtered_records, removed_products = filter_records_by_product(
                metric_records)

            if removed_products:
                logger.info(
                    "[Filter Zero Products] realtime metric=%s, "
                    "removed %d products with all-zero values: %s",
                    metric_key,
                    len(removed_products),
                    removed_products,
                )

            new_data[metric_key] = filtered_records

        return new_data

    # ---------- non-realtime: data = { ..., "metric_value": [records...] } ----------
    metric_value_list = data.get("metric_value")
    if not isinstance(metric_value_list, list) or not metric_value_list:
        return data

    filtered_records, removed_products = filter_records_by_product(
        metric_value_list)

    if removed_products:
        logger.info(
            "[Filter Zero Products] non-realtime, "
            "removed %d products with all-zero values: %s",
            len(removed_products),
            removed_products,
        )

    data["metric_value"] = filtered_records
    return data

async def handle_data_for_dashboard_metrics_query_tool(
    context: RunContextWrapper[GameContext],
    game_name: str = "",
    game_code: str = "",
    game_type: str = "",
    key_country: str = "",
    start_date: str | None = None,
    end_date: str | None = None,
    metrics: List[str] = [],
    granularity: str | None = None,
    zone: List[str] = [],
    country: List[str] = [],
    os: List[str] = [],
    channel: List[str] = [],
    region: List[str] = [],
    lang: List[str] = [],
    category: List[str] = [],
    product: List[str] = [],
    campaign: List[str] = [],
    ua_network: List[str] = [],
    metric_code_to_name_mapping: dict = {},
    redundant_metric_names: List[str] = [],
    metrics_to_remove_from_data_result: set | None = None,
    dl_sales_revenue_codes: list | None = None,
    is_xiaohao: bool = False,
) -> str:  # sort result json by date

    # Initialize message variable
    message = ""

    # Initialize metrics_to_remove_from_data_result if not provided
    if metrics_to_remove_from_data_result is None:
        metrics_to_remove_from_data_result = set()
    if dl_sales_revenue_codes is None:
        dl_sales_revenue_codes = []

    peak_dau_test = False
    if "active_users_max" in metrics:
        metrics = [x for x in metrics if x != "active_users_max"]
        peak_dau_test = True

    # call data query function
    if metrics:
        query_results = await _query_dashboard_metrics_with_special_pubgm_region_grouping(
            context,
            context.context.token, game_code, start_date, end_date, metrics, granularity,
            zone, country, os, channel, region, lang, category, product, campaign, ua_network, game_type, key_country,
            is_xiaohao=is_xiaohao
        )
        query_data = query_results.get("data")
    else:
        query_data = {}

    # dl1/dl2: query sale/revenue metrics separately with Paid only filter, then merge into query_data
    if dl_sales_revenue_codes and len(dl_sales_revenue_codes) > 0:
        dl_query_results = await _query_dashboard_metrics_with_special_pubgm_region_grouping(
                context,
                context.context.token, game_code, start_date, end_date,
                dl_sales_revenue_codes, granularity, zone, country, os, channel, region, lang, category, product, campaign, ua_network,
                game_type, key_country, custom_filters=PAID_ONLY_CUSTOM_FILTERS, is_xiaohao=is_xiaohao
            )
        dl_query_data = dl_query_results.get("data")
        if dl_query_data and dl_query_data.get("metric_value"):
            if not query_data or not query_data.get("metric_value"):
                query_data = dl_query_data
                query_results = dl_query_results
            else:
                # match rows by date + dimension columns (not metric columns)
                dl_metric_set = set(dl_sales_revenue_codes)
                main_metric_set = set(metrics)
                sample = query_data["metric_value"][0]
                dimension_keys = [k for k in sample.keys() if k not in main_metric_set and k not in dl_metric_set]
                # build lookup: tuple(dim_values) -> index in query_data["metric_value"]
                key_to_idx = {}
                for idx, row in enumerate(query_data["metric_value"]):
                    key = tuple(row.get(k, "") for k in dimension_keys)
                    key_to_idx[key] = idx
                for dl_row in dl_query_data["metric_value"]:
                    key = tuple(dl_row.get(k, "") for k in dimension_keys)
                    if key in key_to_idx:
                        idx = key_to_idx[key]
                        for m in dl_sales_revenue_codes:
                            if m in dl_row:
                                query_data["metric_value"][idx][m] = dl_row[m]
                    else:
                        # add dl-only row to query_data so dl query results are fully included
                        new_row = {k: dl_row.get(k, "") for k in dimension_keys}
                        for m in metrics:
                            new_row[m] = None
                        for m in dl_sales_revenue_codes:
                            new_row[m] = dl_row.get(m)
                        query_data["metric_value"].append(new_row)
                # merge dl fallback_info into query_results so it appears in message
                dl_fallback = dl_query_results.get("fallback_info") or []
                if dl_fallback:
                    existing = query_results.get("fallback_info") or []
                    query_results["fallback_info"] = list(existing) + list(dl_fallback)
                # merge dl mcp_fallback_required: if either query required MCP fallback, set it
                if dl_query_results.get("mcp_fallback_required", False):
                    query_results["mcp_fallback_required"] = True
            metrics = list(metrics) + list(dl_sales_revenue_codes)
    # Get ASP data without date grouping for later use in description
    asp_data_no_date = query_results.get("asp_data_no_date")
    
    # Use actual_params from fallback if available, otherwise use original params
    actual_params = query_results.get("actual_params", {})
    actual_granularity = actual_params.get("granularity", granularity)
    actual_start_date = actual_params.get("start_date", start_date)
    actual_end_date = actual_params.get("end_date", end_date)
    
    message += f" For granularity: {actual_granularity}, the data is queried from {actual_start_date} to {actual_end_date}. "

    if query_results.get("fallback_info", ""):
        message += "\n" + \
            "\n".join(
                f"[fallback_info]: {x}" for x in query_results["fallback_info"])

    # deal with active_users_max
    monthly_peak_info = {}
    if peak_dau_test:

        logger.info(
            f"【Functool Info】-【dashboard_metrics_query_tool】: Found metrics active_users_max, get monthly data manually.")

        metrics.append("active_users_max")
        start_date_dt = datetime.strptime(start_date, "%Y%m%d")
        end_date_dt = datetime.strptime(end_date, "%Y%m%d")
        current = start_date_dt.replace(day=1)

        while current <= end_date_dt:

            if current.month == 12:
                next_month = current.replace(
                    year=current.year + 1, month=1, day=1)
            else:
                next_month = current.replace(month=current.month + 1, day=1)
            first_day = current
            last_day = next_month - timedelta(days=1)

            try:
                temp_query_results = await _query_dashboard_metrics_with_special_pubgm_region_grouping(
                    context,
                    context.context.token, game_code, first_day.strftime("%Y%m%d"), last_day.strftime("%Y%m%d"),
                    ["active_users"], "daily", zone, country, os, channel, region, lang, category, product, campaign, ua_network,
                    game_type, key_country, fall_back=False, is_xiaohao=is_xiaohao
                )
                temp_metric_values = temp_query_results.get(
                    "data").get("metric_value")
                _, temp_description_str = convert_to_csv(
                    temp_metric_values, ["active_users"], agg_functions=["max"])
                if not isinstance(temp_description_str, str):
                    assert isinstance(temp_description_str, pd.DataFrame)
                    temp_description_str = temp_description_str.to_json(
                        orient='records', force_ascii=False)
                temp_description_json = json.loads(temp_description_str)

                for temp_data_dic in temp_description_json:

                    assert isinstance(temp_data_dic, dict)
                    if "active_users" in temp_data_dic:
                        temp_data_dic["active_users_max"] = temp_data_dic["active_users"]
                        del temp_data_dic["active_users"]
                    assert "active_users_max" in temp_data_dic, f"active_users_max not found in {temp_data_dic}"
                    for query_data_dic in query_data["metric_value"]:

                        # print(f"Comparing query_data_dic: {query_data_dic} with temp_data_dic: {temp_data_dic}")

                        if query_data_dic.get("date", "") != first_day.strftime("%Y%m"):
                            # print(f"Wrong date of {first_day.strftime('%Y%m')}, trying another...")
                            continue

                        temp_test = True
                        for temp_data_key in temp_data_dic:
                            if temp_data_key == "active_users_max":
                                continue
                            if query_data_dic.get(temp_data_key, "abc") != temp_data_dic[temp_data_key]:
                                temp_test = False
                                break

                        if temp_test:
                            # print("Found!!!")
                            query_data_dic["active_users_max"] = str(
                                temp_data_dic["active_users_max"])

                monthly_peak_info[first_day.strftime(
                    "%Y%m")] = temp_description_str

            except Exception as e:
                # logger.error(f"Traceback: {traceback.format_exc()}")
                print(
                    f"Exception found processing monthly peak dau: {e}, from {traceback.format_exc()}")

            current = next_month

    query_data = sort_query_data(query_data, granularity)

    # Calculate valid_metrics (used for filtering and later for CSV conversion)
    if granularity is None or granularity.lower() != "realtime":
        valid_metrics = metrics
    else:
        valid_metrics = []
        for m in metrics:
            valid_metrics.append(m)
            valid_metrics.append(m + "_dod")
            valid_metrics.append(m + "_dod_count")

    # Filter out products with all zero values when product filter is not empty
    if not product or product == ["255"]:
        query_data = _filter_zero_products_in_data(query_data, valid_metrics, granularity)

    # handle reference urls
    valid_keys = [x for x in query_data["metric_value"][0] if any([y.get(
        x, "") for y in query_data["metric_value"]])] if granularity is None or granularity.lower() != "realtime" else list(query_data.keys())
    cover_url = context.context.game_icon_mapping.get(game_code, "")

    url_map = gl.get_value("rb_url_map_json", expected_type=dict) or {}
    # reference_urls = set()
    references_list = []
    dashboard_name = "经分" if context.context.language.lower() == "chinese" else "Dashboard"
    for m in metrics:
        if m in valid_keys:
            if granularity is None or granularity.lower() != "realtime":
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
                # reference_urls.add(f"v2/dashboard/game/{game_code}{DASHBOARD_METRIC_URL_BY_TYPE.get(game_type.lower(), {}).get(m, '/overview/daily')}")
                references_list.append(ref)
            else:
                url_pattern = f"v2/dashboard/game/{game_code}{DASHBOARD_METRIC_URL_BY_TYPE_REALTIME.get(game_type.lower(), {}).get(m, '/overview/daily')}"
                url_pattern_for_mobile = "v2/dashboard/game/{game_code}" + \
                    f"{DASHBOARD_METRIC_URL_BY_TYPE_REALTIME.get(game_type.lower(), {}).get(m, '/overview/daily')}"
                type_string = "m_mobile_url" if game_type.lower() == "mobile" else "pc_mobile_url"
                mobile_url_pattern = url_map.get(url_pattern_for_mobile, {})
                mobile_url_pattern = {} if mobile_url_pattern == "" else mobile_url_pattern
                mobile_url = mobile_url_pattern.get(
                    type_string, "").format(game_code=game_code)
                ref = ReferenceItem(
                    title=f"{game_name} - {DASHBOARD_METRIC_URL_BY_TYPE_REALTIME.get(game_type.lower(), {}).get(m, '/overview/daily')[1:]} - {dashboard_name}",
                    url=url_pattern,
                    mobile_url=mobile_url,
                    image_url=cover_url,
                    type="databrain",
                    name=f"{game_name} - {DASHBOARD_METRIC_URL_BY_TYPE_REALTIME.get(game_type.lower(), {}).get(m, '/overview/daily')[1:]} - {dashboard_name}",
                    favicon=cover_url
                ).to_dict()
                # reference_urls.add(f"v2/dashboard/game/{game_code}{DASHBOARD_METRIC_URL_BY_TYPE_REALTIME.get(game_type.lower(), {}).get(m, '/overview/daily')}")
                references_list.append(ref)
            if context.context.references is None:
                context.context.references = [references_list]
            else:
                if len(context.context.references) != 0 and isinstance(context.context.references[0], dict):
                    url_set = set([x.get("url", "")
                                  for x in context.context.references])
                else:
                    url_set = set()

                if granularity is None or granularity.lower() != "realtime":
                    if f"v2/dashboard/game/{game_code}{DASHBOARD_METRIC_URL_BY_TYPE.get(game_type.lower(), {}).get(m, '/overview/daily')}" not in url_set:
                        context.context.references.append(ref)
                else:
                    if f"v2/dashboard/game/{game_code}{DASHBOARD_METRIC_URL_BY_TYPE_REALTIME.get(game_type.lower(), {}).get(m, '/overview/daily')}" not in url_set:
                        context.context.references.append(ref)

    # handle bi data
    # do not get bi_data for plotting if only 1d data is queried
    dates = set([x.get("date", "") for x in query_data["metric_value"]]
                ) if granularity.lower() != "realtime" else {"1", "2", "3"}
    dates.discard("")
    bi_data, bi_data_id = get_bi_data(query_data, metrics, game_name, game_type,
                                      True if context.context.language is None or "english" in context.context.language.lower() else False,
                                      metrics_to_remove_from_data_result=list(metrics_to_remove_from_data_result) if metrics_to_remove_from_data_result else None)
    # 单点数据和峰值dau不出bi data
    if len(dates) < 2 or "active_users_max" in metrics or "lifetime_revenue_after_refund_realtime" in metrics or "lifetime_full_game_net_units_realtime" in metrics:
        bi_data_id = ""

    # Initialize data_results and other variables
    data_results = {}
    data_csv = ""
    description_str = ""

    # Apply metric code to name mapping to valid_metrics
    if metric_code_to_name_mapping:
        mapped_valid_metrics = []
        for metric in valid_metrics:
            mapped_metric = metric_code_to_name_mapping.get(metric, metric)
            mapped_valid_metrics.append(mapped_metric)
        valid_metrics = mapped_valid_metrics

    if bi_data is not None and bi_data:
        context.context.data.append(bi_data)

        # Apply metric code to name mapping before converting to CSV
        raw_data = query_data["metric_value"] if granularity is None or granularity.lower(
        ) != "realtime" else query_data
        raw_data = apply_metric_code_to_name_mapping(
            raw_data, metric_code_to_name_mapping)

        # Map metrics_to_remove_from_data_result from code to name and remove from data
        if metrics_to_remove_from_data_result:
            # Map metric codes to their names
            metrics_to_remove_names = []
            for metric_code in metrics_to_remove_from_data_result:
                metric_name = metric_code_to_name_mapping.get(metric_code, metric_code)
                metrics_to_remove_names.append(metric_name)
            # Remove mapped metric names from raw_data
            raw_data = remove_redundant_metric(raw_data, metrics_to_remove_names)
            # Remove from valid_metrics as well
            valid_metrics = [metric for metric in valid_metrics if metric not in metrics_to_remove_names]

        raw_data = remove_redundant_metric(raw_data,redundant_metric_names)
        valid_metrics = [metric for metric in valid_metrics if metric not in redundant_metric_names]

        # Remove peak_daily_active_users from valid_metrics as it's a special metric
        if "peak_daily_active_users" in valid_metrics:
            valid_metrics = [metric for metric in valid_metrics if metric != "peak_daily_active_users"]

        print(f"mapped_data:{raw_data}")
        print(f"valid_metrics:{valid_metrics}")

        # Format values based on value_type before converting to CSV
        if raw_data and valid_metrics:
            # Build metric to value_type mapping: get metric_code from metric_name, then lookup value_type
            name_to_code = {name: code for code, name in (metric_code_to_name_mapping or {}).items()}
            metric_to_value_type = {}
            for metric_name in valid_metrics:
                # Get metric_code (metric_name might be code or mapped name)
                metric_code = metric_name if metric_name in DASHBOARD_MCP_METRIC_MAP_BY_NAME or metric_name in DASHBOARD_METRIC_MAP_BY_NAME else name_to_code.get(metric_name, metric_name)
                # Lookup value_type using metric_code
                metric_info = DASHBOARD_MCP_METRIC_MAP_BY_NAME.get(metric_code) or get_dashboard_metric_info(metric_code, game_type)
                metric_to_value_type[metric_name] = metric_info.get("value_type", "float")

            # Format values in raw_data
            def format_item(item):
                if isinstance(item, dict):
                    for metric_name in valid_metrics:
                        if metric_name in item and metric_name in metric_to_value_type:
                            item[metric_name] = _format_value_by_type(item[metric_name], metric_to_value_type[metric_name])

            if isinstance(raw_data, list):
                for item in raw_data:
                    format_item(item)
            elif isinstance(raw_data, dict):
                for metric_list in raw_data.values():
                    if isinstance(metric_list, list):
                        for item in metric_list:
                            format_item(item)

        # If valid_metrics is empty after removal, set data to empty
        if not valid_metrics:
            data_csv = ""
            description_str = ""
        else:
            data_csv, description_str = convert_to_csv(
                raw_data, valid_metrics, product=product, game_name=game_name
            )
            # Store full CSV for Analyst Agent sandbox (no sampling)
            full_csv_result, _ = convert_to_csv_full(raw_data, valid_metrics)
            full_csv_str = full_csv_result if isinstance(full_csv_result, str) else ""
            if bi_data_id and full_csv_str:
                context.context.bi_data_for_sandbox.append(BiDataCsvEntry(data_id=bi_data_id, full_csv=full_csv_str))

        # Append ASP data without date grouping to description when mean aggregation is used
        # Check if we have ASP data and if mean is in the description (indicating mean aggregation was used)
        if asp_data_no_date:
            try:
                asp_data_str = json.dumps(
                    asp_data_no_date, indent=2, ensure_ascii=False)
                if description_str:
                    description_str += f"\n\nWeighted average asp data(different from average asp data over dates):\n{asp_data_str}"
                else:
                    description_str = f"Weighted average asp data(different from average asp data over dates):\n{asp_data_str}"
            except Exception as e:
                logger.warning(
                    f"[handle_data_for_dashboard_metrics_query_tool] Failed to append ASP data to description: {e}")

        data_results = {
            "game_name": game_name,
            "data_id": bi_data_id,
            "references": references_list,
            "data": data_csv,
            "description": description_str,
            "unit_info": [f"{x.get('metric_code', '')} has unit of {x.get('unit', '')}. " for x in DASHBOARD_METRIC_MAP if x.get("metric_code", "") in valid_metrics and x.get("metric_type", "").lower() == game_type.lower() and x.get("unit", "")]
        }
        if monthly_peak_info:
            data_results["monthly_peak_dau_info"]= monthly_peak_info


    mcp_fallback_required = query_results.get("mcp_fallback_required", False)

    logger.info(
        f"【Functool Return】-【dashboard_metrics_query_tool】: Get data for game {game_name} with data: {data_results}. ")
    return data_results, mcp_fallback_required, message


@function_tool(
    failure_error_function=default_tool_error_function,
    is_enabled=get_tool_enabled(ToolName.DashboardMetricsQueryTool.value),
    readable_name_map={
        "English": "Dashboard Game Metrics Query Tool",
        "Chinese": "经分游戏指标查询工具",
    }
)
async def dashboard_metrics_query_tool(
    context: RunContextWrapper[GameContext],
    game_names: List[str] = [],
    start_date: str | None = None,
    end_date: str | None = None,
    metrics: List[str] = [],
    granularity: str | None = None,
    zone: List[str] = [],
    country: List[str] = [],
    os: List[str] = [],
    channel: List[str] = [],
    region: List[str] = [],
    lang: List[str] = [],
    category: List[str] = [],
    product: List[str] = [],
    campaign: List[str] = [],
    ua_network: List[str] = [],
    by_country_topn_only: bool = False,
    top_countries_num: int = 10,
    top_countries_rank_by_metric: List[str] = [],
) -> str:
    """Query the metrics for game_names. Support metrics like active users, pay, revenue, sales, retention, churn, concurrent users, return users, wishlist, crash etc.
    If any of the input variables is not specify by the user, do not ask them, use default values.
    When user asks for game data by country / top country / 头部国家 / 分国家 / 国家排名, set by_country_topn_only=True; use top_countries_num to control how many countries (see below).
    Use top_countries_rank_by_metric if user explicitly mentioned rank-by metric, for example, 按metric_a排的头部国家/metric_a贡献Top国家/top countries by metric_a. But for queries like 头部国家的metric_a, with no intention of ranking countries by metric_a, set top_countries_rank_by_metric to default.
    You can input only one granularity but multiple filters (zone, country, os, channel, region, lang, campaign, ua_network) per tool call.
    Note that most of the args should be in the format of a list, not a string input. And the date format is YYYYMMDD instead of YYYY-MM-DD.
    Choose correct filter name with corresponding code, do not use os codes in channel filter or verse versa, do not use country codes in region filter or verse versa. However if no country codes provided, can use appropriate region code with region filter to select target country data.
    Only non-realtime sales metric has by product filters, do not use this filter for other metric, can set as [].
    For daily granularity, if no specific time period is provided, retrieve recent 7 days data.
    Args:
        game_names (List[str]): The names of games to query. Defaults to [].
            Special case: pass game_names=["iegg"] to auto-expand into all available IEGG online games from context.
        start_date (str | None, optional): The start date to query. If granularity is realtime, start_date should be prior or equal to today. format: YYYYMMDD. Defaults to None.
        end_date (str | None, optional): The end date to query. If granularity is realtime, end_date should equal to start_date. format: YYYYMMDD. Defaults to None.
        metrics (List[str]): List of metrics to query. Default is all supported metrics. max size of metrics is 20.
        granularity (str | None, optional): The granularity to query. Use realtime If metric is realtime, otherwise choose from daily/weekly/monthly. For realtime granularity, end_date should equal to start_date. For monthly granularity, the day of start_date and end_date should be 01, use daily granularity if user specifies day other than 01. Defaults to None.
        zone (List[str], optional): list of zones to query. Sometimes are called 区服, for example 日本服. If not specify or query for total data, defaults to []. If query to group by zones, use ["255"].
        country (List[str], optional): list of country to query, in the format of two digits english country code, or full english or chinese name. If not specify or query for total data, defaults to []. 注意！全球数据等于total数据，也用[].
        os (List[str], optional): list of os names to query, for example Steam, IOS, XBox. Sometimes are called platform/平台/商店/store codes. If not specify or query for total data, defaults to []. If query group by os/platform, use ["255"]. 注意！全平台/所有平台数据等于total data，也用[].
        channel (List[str], optional): list of channels to query. If not specify or query for total data, defaults to []. If query to group by channels, use ["255"].
        region (List[str], optional): list of regions to query. If not specify or query for total data, defaults to []. If query to group by regions, use ["255"].
        lang (List[str], optional): list of languages to query. If not specify or query for total data, defaults to []. If query to group by languages, use ["255"].
        category (List[str], optional): list of categories to query. Only apply to pc/console games. If not specify or query for total data, defaults to []. If query to group by categories, use ["255"].
        product (List[str], optional): list of products to query. Only apply to pc/console games. Sometimes are called version/版本 codes.If not specify or query for total data, defaults to []. If query to group by products, use ["255"].
        campaign (List[str], optional): campaign dimension for casual games only. For non-casual games this filter is ignored. If query to group by campaign, use ["255"].
        ua_network (List[str], optional): UA network (买量渠道) dimension for casual games only. For non-casual games this filter is ignored. If query to group by ua_network, use ["255"].
        by_country_topn_only (bool, optional): Set True whenever user asks for data 分国家/各国/国家维度/国家分布/头部国家/国家排名/by country. Returns top N countries instead of all (N = top_countries_num). Defaults to False.
        top_countries_num (int, optional): When by_country_topn_only is True, number of top countries to return (TopN, e.g. 10/20/50). Must be >= 1. If user didn't mention an explicit top number, keep default 10.
        top_countries_rank_by_metric (List[str], optional): Set when by_country_topn_only is True. User explicitly asks rank-by metric (e.g. 按收入排序) → set to [that metric]. User asks 头部国家/分国家 but no explicit rank metric (e.g. 头部国家的xx指标是多少) → set to []. Defaults to [].
    Supported metrics: [
    {"name": "active users活跃", "metrics": ["active_users_count", "average_concurrent_users_count", "average_daily_active_users_in_week_or_month", "peak_concurrent_users_count","peak_daily_active_users","average_session_count","fake_active_users_rate","impressions_per_dau"]},
    {"name": "churn流失", "metrics": ["churn","active_users_churn_count", "active_users_churn_rate", "next_day_new_users_churn_count_daily", "next_day_new_users_churn_rate_daily", "next_month_new_users_churn_count_monthly", "next_month_new_users_churn_rate_monthly", "next_week_new_users_churn_count_weekly", "next_week_new_users_churn_rate_weekly"]},
    {"name": "in-game revenue游戏内收入(for pc/console game)", "metrics": ["in_game_paying_users_ratio", "in_game_paying_users_count", "in_game_revenue", "lifetime_in_game_paying_users_ratio", "lifetime_in_game_paying_users_count", "lifetime_in_game_revenue"]},
    {"name": "ltv生命周期总值(for mobile game)", "metrics": ["ltv","average_14_day_revenue_ltv_daily", "average_180_day_revenue_ltv_daily", "average_1_day_revenue_ltv_daily", "average_2_day_revenue_ltv_daily", "average_30_day_revenue_ltv_daily", "average_360_day_revenue_ltv_daily", "average_3_day_revenue_ltv_daily", "average_60_day_revenue_ltv_daily", "average_7_day_revenue_ltv_daily", "average_90_day_revenue_ltv_daily"]},
    {"name": "revenue收入(for casual game)", "metrics": ["ua_ctr","advertisement_impressions","advertisement_revenue","ctr","effective_cost_per_mille_ecpm","impression_rate","return_on_ad_spend_d1","return_on_ad_spend_d14","return_on_ad_spend_d2","return_on_ad_spend_d3","return_on_ad_spend_d7","revenue_on_spend_roi","ua_conversion_rate"]},
    {"name": "new user新进用户", "metrics": ["new_users_count","lifetime_new_users_count", "new_users_count_online_time_over_2_hours","advertisement_spend","cost_per_install_cpi","organic_new_users_ratio"]},
    {"name": "online time 在线", "metrics": ["average_online_time", "median_online_time"]},
    {"name": "realtime实时类", "metrics": ["3_day_new_users_retention_rate_realtime", "7_day_new_users_retention_rate_realtime", "active_users_count_realtime", "full_game_units_after_refund_realtime", "gross_full_game_units_realtime", "gross_revenue_after_refund_realtime", "lifetime_full_game_units_realtime", "lifetime_revenue_realtime", "revenue_after_tax_and_refund_realtime", "new_users_count_realtime", "next_day_new_users_retention_rate_realtime", "online_users_count_realtime", "refund_rate_realtime", "revenue_realtime", "steam_concurrent_users_ccu_realtime", "lifetime_base_game_gross_units_sold_realtime", "lifetime_base_game_units_sold_after_refund_realtime", "lifetime_refund_rate_realtime", "lifetime_revenue_after_refund_realtime", "units_sold_after_refund_realtime"]},
    {"name": "refund退款(for pc/console game)", "metrics": ["base_game_refund_rate", "base_game_refund_units", "lifetime_refund_rate", "refund_rate", "refund_units"]},
    {"name": "refund退款(for mobile game)", "metrics": ["paying_users_count", "paying_users_rate"]},
    {"name": "retention留存", "metrics": ["retention","14_day_active_users_retention_rate_daily", "14_day_new_users_retention_rate_daily", "2_day_active_users_retention_rate_daily", "2_day_new_users_retention_rate_daily", "30_day_active_users_retention_rate_daily", "30_day_new_users_retention_rate_daily", "3_day_active_users_retention_rate_daily", "3_day_new_users_retention_rate_daily", "3_month_active_users_retention_rate_monthly", "3_month_new_users_retention_rate_monthly", "3_week_active_users_retention_rate_weekly", "3_week_new_users_retention_rate_weekly", "4_day_active_users_retention_rate_daily", "4_day_new_users_retention_rate_daily", "4_month_active_users_retention_rate_monthly", "4_month_new_users_retention_rate_monthly", "4_week_active_users_retention_rate_weekly", "4_week_new_users_retention_rate_weekly", "5_day_active_users_retention_rate_daily", "5_day_new_users_retention_rate_daily", "5_month_active_users_retention_rate_monthly", "5_month_new_users_retention_rate_monthly", "5_week_active_users_retention_rate_weekly", "5_week_new_users_retention_rate_weekly", "6_day_active_users_retention_rate_daily", "6_day_new_users_retention_rate_daily", "6_month_active_users_retention_rate_monthly", "6_month_new_users_retention_rate_monthly", "6_week_active_users_retention_rate_weekly", "6_week_new_users_retention_rate_weekly", "7_day_active_users_retention_rate_daily", "7_day_new_users_retention_rate_daily", "7_month_active_users_retention_rate_monthly", "7_month_new_users_retention_rate_monthly", "7_week_active_users_retention_rate_weekly", "7_week_new_users_retention_rate_weekly", "next_day_active_users_retention_rate_daily", "next_day_new_users_retention_rate_daily", "next_month_active_users_retention_rate_monthly", "next_month_new_users_retention_rate_monthly", "next_week_active_users_retention_rate_weekly", "next_week_new_users_retention_rate_weekly", "weighted_14_day_new_users_retention_rate_daily", "weighted_30_day_new_users_retention_rate_daily", "weighted_3_day_new_users_retention_rate_daily", "weighted_3_month_new_users_retention_rate_monthly", "weighted_3_week_new_users_retention_rate_weekly", "weighted_4_month_new_users_retention_rate_monthly", "weighted_4_week_new_users_retention_rate_weekly", "weighted_7_day_new_users_retention_rate_daily", "weighted_next_day_new_users_retention_rate_daily", "weighted_next_month_new_users_retention_rate_monthly", "weighted_next_week_new_users_retention_rate_weekly"]},
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
    Returns:
        str: A string containing data results.
    """
    return await _dashboard_metrics_query_tool(
        context,
        game_names=game_names,
        start_date=start_date,
        end_date=end_date,
        metrics=metrics,
        granularity=granularity,
        zone=zone,
        country=country,
        os=os,
        channel=channel,
        region=region,
        lang=lang,
        category=category,
        product=product,
        campaign=campaign,
        ua_network=ua_network,
        by_country_topn_only=by_country_topn_only,
        top_countries_num=top_countries_num,
        top_countries_rank_by_metric=top_countries_rank_by_metric,
    )


async def _dashboard_metrics_query_tool(
    context: RunContextWrapper[GameContext],
    game_names: List[str] = [],
    start_date: str | None = None,
    end_date: str | None = None,
    metrics: List[str] = [],
    granularity: str | None = None,
    zone: List[str] = [],
    country: List[str] = [],
    os: List[str] = [],
    channel: List[str] = [],
    region: List[str] = [],
    lang: List[str] = [],
    category: List[str] = [],
    product: List[str] = [],
    campaign: List[str] = [],
    ua_network: List[str] = [],
    by_country_topn_only: bool = False,
    top_countries_num: int = 10,
    top_countries_rank_by_metric: List[str] = [],
) -> str:
    """Query the metrics for game_names. Support metrics like active users, pay, revenue, sales, retention, churn, concurrent users, return users, wishlist, crash etc.
    If any of the input variables is not specify by the user, do not ask them, use default values.
    You can input only one granularity but multiple filters (zone, country, os, channel, region, lang, campaign, ua_network) per tool call.
    Note that most of the args should be in the format of a list, not a string input. And the date format is YYYYMMDD instead of YYYY-MM-DD.
    Choose correct filter name with corresponding code, do not use os codes in channel filter or verse versa, do not use country codes in region filter or verse versa. However if no country codes provided, can use appropriate region code with region filter to select target country data.
    For daily granularity, if no specific time period is provided, retrieve recent 7 days data.
    Args:
        game_names (List[str]): The names of games to query. Defaults to [].
        start_date (str | None, optional): The start date to query. If granularity is realtime, start_date should be prior or equal to today. format: YYYYMMDD. Defaults to None.
        end_date (str | None, optional): The end date to query. If granularity is realtime, end_date should equal to start_date. format: YYYYMMDD. Defaults to None.
        metrics (List[str]): List of metrics to query. Default is all supported metrics. max size of metrics is 20.
        granularity (str | None, optional): The granularity to query. Use realtime If metric is realtime, otherwise choose from daily/weekly/monthly. For realtime granularity, end_date should equal to start_date. For monthly granularity, the day of start_date and end_date should be 01, use daily granularity if user specifies day other than 01. Defaults to None.
        zone (List[str], optional): list of zones to query. Sometimes are called 区服, for example 日本服. If not specify or query for total data, defaults to []. If query to group by zones, use ["255"].
        country (List[str], optional): list of country to query, in the format of two digits english country code, or full english or chinese name. If not specify or query for total data, defaults to []. 注意！全球数据等于total数据，也用[].
        os (List[str], optional): list of os names to query, for example Steam, IOS, XBox. Sometimes are called platform/平台/商店/store codes. If not specify or query for total data, defaults to []. If query group by os/platform, use ["255"]. 注意！全平台/所有平台数据等于total data，也用[].
        channel (List[str], optional): list of channels to query. If not specify or query for total data, defaults to []. If query to group by channels, use ["255"].
        region (List[str], optional): list of regions to query. If not specify or query for total data, defaults to []. If query to group by regions, use ["255"].
        lang (List[str], optional): list of languages to query. If not specify or query for total data, defaults to []. If query to group by languages, use ["255"].
        category (List[str], optional): list of categories to query. Only apply to pc/console games. If not specify or query for total data, defaults to []. If query to group by categories, use ["255"].
        product (List[str], optional): list of products to query. Only apply to pc/console games. Sometimes are called version/版本 codes.If not specify or query for total data, defaults to []. If query to group by products, use ["255"]. Only non-realtime sales metric has by product filters, do not use this filter for other metric, can set as [].
        campaign (List[str], optional): campaign dimension for casual games only. For non-casual games this filter is ignored. If query to group by campaign, use ["255"].
        ua_network (List[str], optional): ua_network dimension for casual games only. For non-casual games this filter is ignored. If query to group by ua_network, use ["255"].
    Supported metrics: [
    {"name": "active users活跃", "metrics": ["active_users_count", "average_concurrent_users_count", "average_daily_active_users_in_week_or_month", "peak_concurrent_users_count","peak_daily_active_users","average_session_count","fake_active_users_rate","impressions_per_dau"]},
    {"name": "churn流失", "metrics": ["churn","active_users_churn_count", "active_users_churn_rate", "next_day_new_users_churn_count_daily", "next_day_new_users_churn_rate_daily", "next_month_new_users_churn_count_monthly", "next_month_new_users_churn_rate_monthly", "next_week_new_users_churn_count_weekly", "next_week_new_users_churn_rate_weekly"]},
    {"name": "in-game revenue游戏内收入(for pc/console game)", "metrics": ["in_game_paying_users_ratio", "in_game_paying_users_count", "in_game_revenue", "lifetime_in_game_paying_users_ratio", "lifetime_in_game_paying_users_count", "lifetime_in_game_revenue"]},
    {"name": "ltv生命周期总值(for mobile game)", "metrics": ["ltv","average_14_day_revenue_ltv_daily", "average_180_day_revenue_ltv_daily", "average_1_day_revenue_ltv_daily", "average_2_day_revenue_ltv_daily", "average_30_day_revenue_ltv_daily", "average_360_day_revenue_ltv_daily", "average_3_day_revenue_ltv_daily", "average_60_day_revenue_ltv_daily", "average_7_day_revenue_ltv_daily", "average_90_day_revenue_ltv_daily"]},
    {"name": "revenue收入(for casual game)", "metrics": ["advertisement_ua_ctr","advertisement_impressions","advertisement_revenue","ctr","effective_cost_per_mille_ecpm","impression_rate","return_on_ad_spend_d1","return_on_ad_spend_d14","return_on_ad_spend_d2","return_on_ad_spend_d3","return_on_ad_spend_d7","revenue_on_spend_roi","ua_conversion_rate"]},
    {"name": "new user新进用户", "metrics": ["new_users_count","lifetime_new_users_count","new_users_count_online_time_over_2_hours","advertisement_spend","cost_per_install_cpi","organic_new_users_ratio"]},
    {"name": "online time 在线", "metrics": ["average_online_time", "median_online_time"]},
    {"name": "realtime实时类", "metrics": ["3_day_new_users_retention_rate_realtime", "7_day_new_users_retention_rate_realtime", "active_users_count_realtime", "full_game_units_after_refund_realtime", "gross_full_game_units_realtime", "gross_revenue_after_refund_realtime", "lifetime_full_game_units_realtime", "lifetime_revenue_realtime", "revenue_after_tax_and_refund_realtime", "new_users_count_realtime", "next_day_new_users_retention_rate_realtime", "online_users_count_realtime", "refund_rate_realtime", "revenue_realtime", "steam_concurrent_users_ccu_realtime", "lifetime_base_game_gross_units_sold_realtime", "lifetime_base_game_units_sold_after_refund_realtime", "lifetime_refund_rate_realtime", "lifetime_revenue_after_refund_realtime", "units_sold_after_refund_realtime"]},
    {"name": "refund退款(for pc/console game)", "metrics": ["base_game_refund_rate", "base_game_refund_units", "lifetime_refund_rate", "refund_rate", "refund_units"]},
    {"name": "refund退款(for mobile game)", "metrics": ["paying_users_count", "paying_users_rate"]},
    {"name": "retention留存", "metrics": ["retention","14_day_active_users_retention_rate_daily", "14_day_new_users_retention_rate_daily", "2_day_active_users_retention_rate_daily", "2_day_new_users_retention_rate_daily", "30_day_active_users_retention_rate_daily", "30_day_new_users_retention_rate_daily", "3_day_active_users_retention_rate_daily", "3_day_new_users_retention_rate_daily", "3_month_active_users_retention_rate_monthly", "3_month_new_users_retention_rate_monthly", "3_week_active_users_retention_rate_weekly", "3_week_new_users_retention_rate_weekly", "4_day_active_users_retention_rate_daily", "4_day_new_users_retention_rate_daily", "4_month_active_users_retention_rate_monthly", "4_month_new_users_retention_rate_monthly", "4_week_active_users_retention_rate_weekly", "4_week_new_users_retention_rate_weekly", "5_day_active_users_retention_rate_daily", "5_day_new_users_retention_rate_daily", "5_month_active_users_retention_rate_monthly", "5_month_new_users_retention_rate_monthly", "5_week_active_users_retention_rate_weekly", "5_week_new_users_retention_rate_weekly", "6_day_active_users_retention_rate_daily", "6_day_new_users_retention_rate_daily", "6_month_active_users_retention_rate_monthly", "6_month_new_users_retention_rate_monthly", "6_week_active_users_retention_rate_weekly", "6_week_new_users_retention_rate_weekly", "7_day_active_users_retention_rate_daily", "7_day_new_users_retention_rate_daily", "7_month_active_users_retention_rate_monthly", "7_month_new_users_retention_rate_monthly", "7_week_active_users_retention_rate_weekly", "7_week_new_users_retention_rate_weekly", "next_day_active_users_retention_rate_daily", "next_day_new_users_retention_rate_daily", "next_month_active_users_retention_rate_monthly", "next_month_new_users_retention_rate_monthly", "next_week_active_users_retention_rate_weekly", "next_week_new_users_retention_rate_weekly", "weighted_14_day_new_users_retention_rate_daily", "weighted_30_day_new_users_retention_rate_daily", "weighted_3_day_new_users_retention_rate_daily", "weighted_3_month_new_users_retention_rate_monthly", "weighted_3_week_new_users_retention_rate_weekly", "weighted_4_month_new_users_retention_rate_monthly", "weighted_4_week_new_users_retention_rate_weekly", "weighted_7_day_new_users_retention_rate_daily", "weighted_next_day_new_users_retention_rate_daily", "weighted_next_month_new_users_retention_rate_monthly", "weighted_next_week_new_users_retention_rate_weekly"]},
    {"name": "return回流", "metrics": ["return_users_count"]},
    {"name": "login登录", "metrics": ["first_login_ratio","second_login_ratio"]},
    {"name": "revenue收入", "metrics": ["average_revenue_per_users_arpu","average_revenue_per_paying_users_arppu","new_user_average_revenue_per_users_arpu","base_game_gross_revenue", "base_game_gross_revenue_ratio", "base_game_revenue_after_refund_and_tax", "gross_revenue", "lifetime_gross_revenue", "lifetime_pay_amount", "lifetime_revenue_after_refund", "new_player_pay_rate", "pay_amount", "refund_revenue", "revenue_after_refund"]},
    {"name": "sale销量(for pc/console game)", "metrics": ["average_selling_price","base_game_average_selling_price", "units_sold_after_refund", "gross_base_game_units_sold", "gross_units_sold", "lifetime_base_game_gross_units_sold", "lifetime_base_game_units_sold_after_refund", "lifetime_gross_units_sold", "third_party_units", "units_sold_after_refund_for_product"]},
    {"name": "technical技术性能(for pc/console game)", "metrics": ["0_to_60_ms_ping_player_rate", "120_to_150_ms_ping_player_rate", "150_to_200_ms_ping_player_rate", "200_to_300_ms_ping_player_rate", "60_to_80_ms_ping_player_rate", "80_percentile_ping", "80_to_120_ms_ping_player_rate", "95_percentile_ping", "average_lowest_1_percent_fps", "crash_count", "crash_rate", "cumulative_crash_count", "mean_time_between_crashes", "median_fps", "median_ping"]},
    {"name": "wishlist 愿望单(for pc/console game)", "metrics": ["wishlist","daily_wishlist_add_count_without_delete_purchase_gift_daily", "daily_wishlist_delete_count_daily", "lifetime_steam_wishlist_conversion_count", "lifetime_steam_wishlist_deletes", "lifetime_steam_wishlist_gifts", "lifetime_steam_wishlist_purchases_activations", "new_wishlist_add_count_daily", "lifetime_wishlist_add_count_daily", "lifetime_wishlist_count", "lifetime_wishlist_coversion_rate"]},
    ]
    *IMPORTANT metrics choice rules*: 1. When asked for realtime metrics, must choose from the 'realtime实时类指标' metrics over daily metrics, other metrics don't support realtime granularity。 如果没有提及实时，不要用实时指标。 “实时累计销量”用lifetime_base_game_units_sold_after_refund_realtime，“当日实时销量”用units_sold_after_refund_realtime，“实时累计收入”用lifetime_revenue_after_refund_realtime。
    2. pc/console游戏针对sales销量(游戏产品购买人数)的metric理解，判断用户是否提及特定的时间范围内或特定日期/月份的销量（如今年/上个月/12月/7号/近一周/按月销量），如果不是，默认查累计销量lifetime_base_game_units_sold_after_refund（累计销量是从游戏发行或内购开始的到查询日期截止的所有销量加总，通常只查某一天的，没有monthly和yearly的概念)。 如果提及了特定的时间范围内或特定日期/月份，默认查单日本体销量指标units_sold_after_refund+daily/monthly/yearly granularity，除非用户提及dlc、版本升级、分产品、分版本、升级版的销量，或有多少玩家做了升级，这种情况则要用units_sold_after_refund_for_product。
    3. 问mobile游戏的收入/销量，使用pay_amount；问pc/console游戏的收入，判断用户是否提及特定的时间范围内或特定日期/月份的收入（如今年/上个月/12月/7号/近一周/按月收入），如果不是，默认查累计收入lifetime_revenue_after_refund（通常只查某一天的，没有monthly和yearly的概念)。 如果提及了特定的时间范围内或特定日期/月份，查询单日收入revenue_after_refunddaily/monthly/yearly granularity。
    4. PCU对应指标是peak_concurrent_users_count. CCU/实时在线对应online_users_count_realtime. ACU(平均同时在线)对应average_concurrent_users_count.
    5. 问留存默认用new user retention而不是active user retention。
    6. 问活跃的时候，明确问每个月的日活跃的峰值(月峰值dau)才使用peak_daily_active_users，用户明确提及平均的情况下使用average_daily_active_users_in_week_or_month， 其他情况下问dau、wau和mau（包括“峰值MAU/最高MAU/峰值WAU/最高WAU/非按月统计的有明确日期的峰值dau，如x月x号到x月x号的dau峰值”）都用active_users_count（DAU=daily、WAU=weekly、MAU=monthly）。
    7. pc/console游戏的付费用户query使用in_game_paying_users相关指标
    8. 每活跃用户在线时长用average_online_time。每活跃用户session数用average_session_count。
    9. 问ua的广告点击率/转化率，要使用ua_ctr/ua_conversion_rate(ua_cvr), ua是个专用term，要注意区分。
    10. tnu是total new users的缩写，对应lifetime_new_users_count。
    Returns:
        str: A string containing data results.
    """

    logger.info(
        f"【Functool Call】-【dashboard_metrics_query_tool】: game_names={game_names}, {start_date}, {end_date}, {metrics}, {granularity}, {zone}, {country}, {os}, {channel}, {region}, {lang}, {category}, {product}."
    )

    start_time = time.time()

    raw_items = context.context.dashboard_pc_enable_game_list_raw or []
    if not isinstance(raw_items, list):
        raw_items = []

    def _parse_iegg_raw_items(items: Any) -> tuple[Dict[str, str], Dict[str, dict], List[str]]:
        code_to_name: Dict[str, str] = {}
        name_to_info: Dict[str, dict] = {}
        all_codes: List[str] = []
        seen_codes = set()
        if isinstance(items, list):
            for item in items:
                if not isinstance(item, dict):
                    continue
                code = str(item.get("game_code") or "").strip()
                if not code:
                    continue
                game_name = str(
                    item.get("game_name_en")
                    or item.get("game_name_cn")
                ).strip()
                data_frame = str(item.get("data_frame") or "").strip().lower()
                game_type = "mobile" if data_frame == "mobile" else "pc/console"
                code_to_name[code] = game_name
                if game_name:
                    name_to_info[game_name] = {"game_code": code, "game_type": game_type}
                game_name_cn = str(item.get("game_name_cn") or "").strip()
                if game_name_cn:
                    name_to_info[game_name_cn] = {"game_code": code, "game_type": game_type}
                game_name_en = str(item.get("game_name_en") or "").strip()
                if game_name_en:
                    name_to_info[game_name_en] = {"game_code": code, "game_type": game_type}
                if code not in seen_codes:
                    seen_codes.add(code)
                    all_codes.append(code)
        return code_to_name, name_to_info, all_codes

    code_to_name, name_to_info, all_iegg_codes = _parse_iegg_raw_items(raw_items)

    iegg_auto_expand_message = ""
    # Special placeholder: game_names=["iegg"] means "query all IEGG online games".
    if any(str(name or "").strip().lower() == "iegg" for name in game_names):
        base_game_names = [name for name in game_names if str(name or "").strip().lower() != "iegg"]
        expanded_game_names = [code_to_name.get(code) or code for code in all_iegg_codes]
        seen_names = set()
        game_names = []
        for name in base_game_names + expanded_game_names:
            n = str(name or "").strip()
            if not n or n in seen_names:
                continue
            seen_names.add(n)
            game_names.append(n)
        iegg_auto_expand_message = (
            f"[IEGG Auto Expanded] Detected game_names=['iegg']; automatically expanded to {len(game_names)} games "
            f"and returning metrics for these games: {game_names}. "
        )
        logger.info(
            "dashboard_metrics_query_tool expanded iegg placeholder to {} game_names",
            len(game_names),
        )

    for game_name in game_names:
        if game_name in context.context.dashboard_game_code_and_filters:
            continue
        game_info = name_to_info.get(str(game_name).strip())
        if not isinstance(game_info, dict):
            continue
        context.context.dashboard_game_code_and_filters[game_name] = {
            "game_name": game_name,
            "game_code": str(game_info.get("game_code") or ""),
            "game_type": str(game_info.get("game_type") or "mobile"),
        }

    if not game_names:
        msg = "empty game_names. Retry with valid inputs. "
        logger.warning(msg)
        return msg

    data_results = []
    message = iegg_auto_expand_message
    for i in range(len(game_names)):

        try:

            # get game name, game code, and game type
            game_name = game_names[i]
            if game_name.endswith('国服'):
                game_name = game_name[:-2]
            if game_name not in context.context.dashboard_game_code_and_filters:
                logger.info(f"[tool] game_name '{game_name}' not in dashboard_game_code_and_filters keys: {list(context.context.dashboard_game_code_and_filters.keys())}")
                # Try fuzzy match: check if any key contains or is contained in game_name
                matched = False
                for item_key in context.context.dashboard_game_code_and_filters:
                    if item_key in game_name or game_name in item_key or item_key.lower() == game_name.lower():
                        logger.info(f"[tool] Fuzzy matched: '{game_name}' -> '{item_key}'")
                        game_name = item_key
                        matched = True
                        break
                if not matched:
                    message = f"{game_name} not found in dashboard. Available games: {list(context.context.dashboard_game_code_and_filters.keys())}"
                    logger.warning(f"[tool] {message}")
                    return message
            game_type = context.context.dashboard_game_code_and_filters[game_name]["game_type"]
            game_code = context.context.dashboard_game_code_and_filters[game_name]["game_code"]
            key_country = context.context.key_country.get(game_code)

            # 新增维度仅保留campaign和ua_network，且仅适用于casual游戏，其他类型自动忽略（不报错）
            game_campaign = list(campaign or [])
            game_ua_network = list(ua_network or [])
            if (game_type or "").strip().lower() != "casual":
                game_campaign = []
                game_ua_network = []
            else:
                campaign_name_to_code = get_filter_name_to_code_map_from_context(
                    context.context, game_code, "campaign"
                )
                game_campaign = convert_filter_values_to_codes(game_campaign, campaign_name_to_code)
                ua_network_name_to_code = get_filter_name_to_code_map_from_context(
                    context.context, game_code, "ua_network"
                )
                game_ua_network = convert_filter_values_to_codes(game_ua_network, ua_network_name_to_code)

            update_flags = {}
            is_nikke_xiaohao_query = False
            use_paid_only_filters = False
            lifetime_expanded_metrics = []
            metrics_to_remove_from_data_result = set()
            dl_sales_revenue_codes = []
            # default input if not specified
            try:
                updated_inputs = update_input(
                    game_name, game_code, game_type, metrics, granularity, start_date, end_date,
                    context.context.user_input, "dashboard_metrics_query_tool",
                    context.context.dashboard_game_code_and_filters[game_name],
                    zone, country, os, channel, region, lang, category, product,
                    key_country, top_countries_rank_by_metric, update_flags,
                )
                is_nikke_xiaohao_query = bool(update_flags.get("is_xiaohao", False))
                use_paid_only_filters = bool(update_flags.get("use_paid_only_filters", False))
                lifetime_expanded_metrics = list(update_flags.get("lifetime_expanded_metrics", []))
                metrics_to_remove_from_data_result = set(update_flags.get("metrics_to_remove_from_data_result", set()))
                dl_sales_revenue_codes = list(update_flags.get("dl_sales_revenue_codes", []))
                (
                    update_list, game_name, game_code, metrics, realtime_metrics,
                    daily_metrics, non_realtime_daily_metrics, granularity, start_date,
                    end_date, zone, country, os, channel, region, lang, category,
                    product, metric_code_to_name_mapping, retry_info_list,
                    processed_top_countries_rank_by_metric
                ) = updated_inputs
                message += "".join(update_list)

            except Exception as e:
                logger.error(
                    f"Error in updating input for dashboard_metrics_query_tool: {str(e)}")
                message += f"\n[Error] Failed to update input parameters: {str(e)}. Using default values."
                if not metrics:
                    metrics = ["active_users", "pcu", "pay_amount"] if game_type == "mobile" else [
                        "active_users", "gross_revenue", "gross_full_game_units"]
                # Set fallback values for all required variables to prevent NameError
                realtime_metrics = []
                daily_metrics = metrics.copy()  # Use metrics as non-realtime fallback
                # Use metrics as non-realtime fallback
                non_realtime_daily_metrics = metrics.copy()
                metric_code_to_name_mapping = {}  # Fallback empty mapping
                lifetime_expanded_metrics = []
                metrics_to_remove_from_data_result = set()  # Initialize empty set
                dl_sales_revenue_codes = []  # Fallback empty list
                processed_top_countries_rank_by_metric = top_countries_rank_by_metric
                is_nikke_xiaohao_query = False
                use_paid_only_filters = False
                if not granularity:
                    granularity = "daily"
            if retry_info_list:
                logger.warning(
                    f"【Functool Warning】-【dashboard_metrics_query_tool】: {retry_info_list}")
                message += "".join(retry_info_list)
                return message

            # When user asks for data by country / top country, resolve to top N countries and filter
            if by_country_topn_only:
                _top_num = max(1, int(top_countries_num))  # allow TopN (e.g., 10/20/50); keep default 10 when unspecified
                _start = start_date
                _end = end_date
                _gran = granularity or "daily"
                if any("lifetime" in (m or "").lower() for m in metrics):
                    _start = end_date
                    message += "Start date set to end date for lifetime metrics (top countries mode). "
                if (_gran or "").lower() == "realtime":
                    _gran = "daily"
                    message += "Realtime not supported for top countries, using daily. "
                # Rank metric: use processed list from update_input (names resolved to codes); "default" or None/[] → use default (活跃/销量)
                if isinstance(processed_top_countries_rank_by_metric, list) and len(processed_top_countries_rank_by_metric) > 0:
                    rank_metrics_for_api = list(processed_top_countries_rank_by_metric)
                    logger.info(f"【dashboard_metrics_query_tool】top_countries: ranking by user-specified metric(s) {rank_metrics_for_api}. ")
                else:
                    gt = (game_type or "").strip().lower()
                    if gt == "mobile":
                        rank_metrics_for_api = [DEFAULT_TOP_COUNTRY_RANK_METRIC_MOBILE]
                    elif gt == "casual":
                        rank_metrics_for_api = [DEFAULT_TOP_COUNTRY_RANK_METRIC_CASUAL]
                    else:
                        rank_metrics_for_api = [DEFAULT_TOP_COUNTRY_RANK_METRIC_PC_CONSOLE]
                    message += f"Top countries determined by default rank metric ({rank_metrics_for_api[0]}) for this game type; then returning requested metrics for those countries. "
                    logger.info(f"【dashboard_metrics_query_tool】top_countries: ranking by default metric {rank_metrics_for_api}. ")
                try:
                    # Same custom_filters as handle_data_for_dashboard_metrics_query_tool (dl1/dl2 Paid only)
                    _custom_filters = PAID_ONLY_CUSTOM_FILTERS if use_paid_only_filters else None
                    query_results = await get_top_dimension_filter_with_fallback(
                        game_code, _start, _end, rank_metrics_for_api, _gran, _top_num, context.context.token,
                        custom_filters=_custom_filters, is_xiaohao=is_nikke_xiaohao_query
                    )
                    metric_country_dict = query_results.get("data") or {}
                    if query_results.get("fallback_info"):
                        message += "\n" + "\n".join(f"[fallback_info]: {x}" for x in query_results["fallback_info"])
                    # Merge per-metric top countries into one list (union, order preserved, cap at _top_num)
                    seen = set()
                    country_list = []
                    for _countries in metric_country_dict.values():
                        if not isinstance(_countries, list):
                            continue
                        for c in _countries:
                            if c and c not in seen and len(country_list) < _top_num:
                                seen.add(c)
                                country_list.append(c)
                    if country_list:
                        country = country_list
                        message += f"Using top {len(country)} countries for {game_name}: {country}. "
                        logger.info(f"【dashboard_metrics_query_tool】by_country_topn_only: using top {len(country)} countries: {country}. ")
                    else:
                        message += f"No top country data found for {game_name}; returning without country filter. "
                except DashboardPermissionException:
                    raise
                except (DashboardEmptyDataException, DashboardException, DashboardWrongTokenException) as e:
                    logger.warning(f"Top country resolution failed for {game_name}: {e}. Proceeding without country filter.")
                    message += f"Top country query failed for {game_name}: {e}. Showing data without country filter. "
                    country = []

            if realtime_metrics:
                try:
                    realtime_data_results, realtime_mcp_fallback_required, realtime_message = await handle_data_for_dashboard_metrics_query_tool(
                        context, game_name, game_code, game_type, key_country, start_date, end_date,
                        realtime_metrics, "realtime", zone, country, os, channel, region, lang, category, product, game_campaign, game_ua_network,
                        metric_code_to_name_mapping, is_xiaohao=is_nikke_xiaohao_query
                    )
                    data_results.append(realtime_data_results)
                    message += realtime_message
                except Exception as e:
                    message += f"\n[Warning] Failed to retrieve realtime metrics for {game_name}: {str(e)}. Continuing with daily and non-realtime daily metrics."
                    realtime_mcp_fallback_required = True
            else:
                realtime_mcp_fallback_required = False

            if daily_metrics:
                try:
                    daily_data_results, daily_mcp_fallback_required, daily_message = await handle_data_for_dashboard_metrics_query_tool(
                        context, game_name, game_code, game_type, key_country, start_date, end_date,
                        daily_metrics, "daily", zone, country, os, channel, region, lang, category, product, game_campaign, game_ua_network,
                        metric_code_to_name_mapping, redundant_metric_names=lifetime_expanded_metrics,
                        metrics_to_remove_from_data_result=metrics_to_remove_from_data_result,
                        is_xiaohao=is_nikke_xiaohao_query
                    )
                    data_results.append(daily_data_results)
                    message += daily_message
                except Exception as e:
                    message += f"\n[Warning] Failed to retrieve daily metrics for {game_name}: {str(e)}. Continuing with non-realtime daily metrics."
                    daily_mcp_fallback_required = True
            else:
                daily_mcp_fallback_required = False

            if non_realtime_daily_metrics or dl_sales_revenue_codes:
                if granularity.lower() == "realtime":
                    granularity = "daily"
                try:
                    non_realtime_data_results, non_realtime_mcp_fallback_required, non_realtime_message = await handle_data_for_dashboard_metrics_query_tool(
                        context, game_name, game_code, game_type, key_country, start_date, end_date,
                        non_realtime_daily_metrics, granularity, zone, country, os, channel, region, lang, category, product, game_campaign, game_ua_network,
                        metric_code_to_name_mapping, lifetime_expanded_metrics,
                        dl_sales_revenue_codes=dl_sales_revenue_codes, is_xiaohao=is_nikke_xiaohao_query
                    )
                    data_results.append(non_realtime_data_results)
                    message += non_realtime_message
                except Exception as e:
                    message += f"\n[Warning] Failed to retrieve non-realtime daily metrics for {game_name}: {str(e)}. Continuing with non-realtime daily metrics."
                    non_realtime_mcp_fallback_required = True
            else:
                non_realtime_mcp_fallback_required = False

            # Check if MCP fallback is required
            mcp_fallback_required = realtime_mcp_fallback_required or daily_mcp_fallback_required or non_realtime_mcp_fallback_required

            if mcp_fallback_required:
                logger.info(
                    f"【Functool MCP Fallback】-【dashboard_metrics_query_tool】: All dashboard fallbacks failed for {game_name}, triggering MCP fallback.")
                message += f"\n[MCP Fallback] Dashboard framework data not available for {game_name}, attempting to search using MCP tools for alternative data sources."
                # Set a flag to indicate MCP fallback is needed
                context.context.mcp_fallback_required = True
                context.context.mcp_fallback_game_info = {
                    "game_name": game_name,
                    "game_code": game_code,
                    "game_type": game_type,
                    "metrics": metrics,
                    "start_date": start_date,
                    "end_date": end_date,
                    "granularity": granularity,
                    "filters": {
                        "zone": zone,
                        "country": country,
                        "os": os,
                        "channel": channel,
                        "region": region,
                        "lang": lang,
                        "category": category,
                        "product": product,
                        "campaign": game_campaign,
                        "ua_network": game_ua_network,
                    }
                }
                continue  # Skip to next game, MCP will handle this
            else:
                logger.info(
                    f"【Functool Success】-【dashboard_metrics_query_tool】: Dashboard framework data found for {game_name}, proceeding with normal data processing.")
                message += f"\n[Dashboard Success] Data found for {game_name}, processing dashboard results."

        except DashboardPermissionException as e:
            logger.warning(str(e))
            message += f"User does not have permission to access {game_names[i]} dashboard data: " + str(
                e) + ". \n"
            continue

        except Exception as e:
            # logger.error(traceback.format_exc())
            message += f"Encounter error in retrieving {game_names[i]} dashboard data: " + str(
                e) + ". \n"
            continue

    log_metrics("dashboard_metrics_query_tool", "0",
                round((time.time() - start_time) * 1000, 2))
    # update context.has_dashboard_data_list for sensitive data label
    if data_results:
        add_sensitive_dashboard_data(context.context, game_names)
    return f"Querying metrics for {game_names} from {start_date} to {end_date} with granularity {granularity}, the results is {data_results}. {message}"[:8000000]
