import os
import re
import uuid
import requests
import pandas as pd
import json
from datetime import datetime, timedelta, timezone
from loguru import logger
from typing import Any, Dict, List, Optional, Tuple
import copy

from dashboard_common.config import globalvar as gl

from databrain.api import send_request_with_headers
from dashboard_data.region_code_map import COUNTRY_MAP_INTEL
from dashboard_tools.dashboard.utils.dashboard_metric_map import DASHBOARD_METRIC_MAP_BY_NAME_REALTIME, DASHBOARD_METRIC_NAME_CODE_MAPPING_BY_TYPE,DASHBOARD_DEFAULT_METRIC_MAP_BY_QUERY, DASHBOARD_MCP_METRIC_MAP_BY_NAME, get_dashboard_metric_info
from dashboard_tools.dashboard.utils.dim_country_info_data import DIM_COUNTRY_INFO
from dashboard_utils.df_sampler import DataFrameSampler
from dashboard_utils.df_analyzer import DataFrameAnalyzer

# 缓存 dim_country_info 中 area_name_en -> area_code 的映射（小写 key）
_AREA_NAME_EN_TO_CODE_CACHE: Optional[Dict[str, str]] = None


def _get_area_name_en_to_code_map() -> Dict[str, str]:
    """从 dim_country_info_data 模块加载 area_name_en -> area_code 映射（key 为 area_name_en 小写）。"""
    global _AREA_NAME_EN_TO_CODE_CACHE
    if _AREA_NAME_EN_TO_CODE_CACHE is not None:
        return _AREA_NAME_EN_TO_CODE_CACHE
    try:
        # 按 area_name_en 去重，保留首次出现的 area_code
        seen = set()
        result = {}
        for item in DIM_COUNTRY_INFO:
            en = str(item.get("area_name_en", "")).strip().lower()
            if en and en not in seen:
                seen.add(en)
                result[en] = str(item.get("area_code", ""))
        _AREA_NAME_EN_TO_CODE_CACHE = result
        return _AREA_NAME_EN_TO_CODE_CACHE
    except Exception as e:
        logger.warning(f"Failed to load area_name_en->area_code mapping from dim_country_info_data: {e}")
        _AREA_NAME_EN_TO_CODE_CACHE = {}
        return _AREA_NAME_EN_TO_CODE_CACHE


def sort_query_data(query_data, granularity):
    if not query_data:
        raise Exception("API returned empty result back. ")
    if granularity is None or granularity.lower() != "realtime":
        if "metric_value" not in query_data:
            logger.error(f"Got data with no metric_value key: {query_data}. ")
            raise Exception("error getting non-realtime data from metric query api. ")
        query_data["metric_value"] = sorted(query_data["metric_value"], key=lambda x: x.get("date", "0"))
    else:
        for x in query_data:
            query_data[x] = sorted(query_data[x], key=lambda x: x.get("time", "0"))
    return query_data


def sort_mcp_query_data(query_data, time_column_name):
    if not query_data:
        raise Exception("MCP returned empty result back. ")
    
    # Handle nested structure: if query_data is a dict with a "data" key, unwrap it
    if isinstance(query_data, dict) and "data" in query_data:
        query_data = query_data["data"]
        if not query_data:
            raise Exception("MCP returned empty result back. ")
    
    logger.info(f"【Tool util call】-【dashboard_sort_mcp_query_data】: Found input: query_data: {query_data}, time_column_name: {time_column_name}.")
    
    # Check if all elements are dictionaries
    if not all(isinstance(x, dict) for x in query_data):
        logger.warning(f"Not all elements in query_data are dictionaries. Returning unsorted data. Type of first element: {type(query_data[0])}")
        return query_data
    
    query_data = sorted(query_data, key=lambda x: x.get(time_column_name, "0"))

    return query_data


def process_dataframe(df, metrics, max_length=2000, **kwargs):
    try:
        # df = df.drop(columns=['date', 'time'], errors='ignore')
        # print(f"process_dataframe metrics: {metrics}")
        group_by_fields = [x for x in list(df.columns) if x not in metrics and x != "date" and x != "time"]
        # print(f"process_dataframe group_by_fields: {group_by_fields}")
        # 当 product==['255'] 且只有一个 metric 且 game_name=='dying light' 时，按 metric 的 sum/mean 排序
        sort_by_metric_value = None
        if (
            kwargs.get("product",[]) == ["255"]
            and len(metrics) == 1
            and (kwargs.get("game_name") or "").lower() in ["dying light","dying light 2: stay human"]
        ):
            sort_by_metric_value = metrics[0]
        grouped = DataFrameAnalyzer(df)
        grouped_str = grouped.describe(
            group_by_fields=group_by_fields,
            agg_functions=kwargs.get("agg_functions", None),
            system="dashboard",
            sort_by_metric_value=sort_by_metric_value,
        )

        # print(f"grouped_by_fields: {group_by_fields}")
        # print(f"metrics: {metrics}")

        if len(df) <= max_length:
            return df, grouped_str
        else:
            sampler = DataFrameSampler(df)
            sampled_df = sampler.head_tail(
                group_by_fields=group_by_fields,
                keep_count=max_length,
                head_tail_count=7,
                peak_valley_count=3,
                metrics=None,
                auto_plot=False
            )
            return sampled_df, grouped_str

    except Exception as e:
        # print(f"ABCDEF {e}")
        logger.warning(f"(process_dataframe)处理df失败, 使用原始数据: {e}")
        return df, ""


def convert_to_csv(data, metrics, **kwargs):
    """将数据转换为CSV格式"""
    # print(f"convert_to_csv metrics: {metrics}")
    try:
        if isinstance(data, list):
            df = pd.DataFrame(data)
            # df = df.drop(columns=['date', 'time'], errors='ignore')
            sample_df, description_str = process_dataframe(df, metrics, **kwargs)
            return sample_df.to_csv(index=False), description_str
        elif isinstance(data, dict):
            sample_dic, description_dic = {}, {}
            for k, v in data.items():
                if isinstance(v, list):
                    sample_csv, description_str = convert_to_csv(v, metrics, **kwargs)
                    sample_dic[k] = sample_csv
                    description_dic[k] = description_str
                else:
                    sample_dic[k] = v
                    description_dic[k] = ""
            return sample_dic, description_dic
        else:
            return data, ""
    except Exception as e:
        # print(f"ABCDEF {e}")
        logger.warning(f"(convert_to_csv)采样失败, 使用原始数据: {e}")
        return data, ""


def convert_to_csv_full(data, metrics, **kwargs):
    """将数据转换为完整 CSV（不采样），供 Analyst Agent 沙箱使用。返回 (csv_string, description_str) 或 (dict, dict)。"""
    try:
        if isinstance(data, list):
            df = pd.DataFrame(data)
            description_str = ""
            try:
                group_by_fields = [x for x in list(df.columns) if x not in (metrics or []) and x not in ("date", "time")]
                grouped = DataFrameAnalyzer(df)
                description_str = grouped.describe(group_by_fields=group_by_fields, agg_functions=kwargs.get("agg_functions", None), system="dashboard")
            except Exception as e:
                logger.warning(f"(convert_to_csv_full) describe 失败: {e}")
            return df.to_csv(index=False), description_str
        elif isinstance(data, dict):
            full_dic, description_dic = {}, {}
            for k, v in data.items():
                if isinstance(v, list):
                    full_csv, description_str = convert_to_csv_full(v, metrics, **kwargs)
                    full_dic[k] = full_csv
                    description_dic[k] = description_str
                else:
                    full_dic[k] = v
                    description_dic[k] = ""
            return full_dic, description_dic
        else:
            return data, ""
    except Exception as e:
        logger.warning(f"(convert_to_csv_full) 失败, 使用原始数据: {e}")
        return data, ""


def str_to_dt(s):
    return datetime.strptime(s, "%Y%m%d")


def dt_to_str(d):
    return d.strftime("%Y%m%d")


def update_date(d):

    logger.info(f"【Tool util call】-【dashboard_update_date】: Found date: {d}. ")

    try:
        d = str(d)
        d = re.sub(r"\D", "", d)
        d = d.lstrip("0")
        if len(d) == 8:
            return d
        if len(d) == 7:
            d = d + "1"
        elif len(d) == 6:
            d = d + "01"
        elif len(d) == 5:
            d = d + "101"
        elif len(d) == 4:
            d = d + "0101"
        datetime.strptime(d, "%Y%m%d")
    except Exception:
        d = datetime.today().strftime("%Y%m%d")

    logger.info(f"【Tool util return】-【dashboard_update_date】: Parsed date: {d}. ")

    return d


def get_filter_name_to_code_map_from_context(context: Any, game_code: str, filter_name: str) -> Dict[str, str]:
    """
    Build filter name->code map from raw dashboard_info in context.entities.
    Used by special grouped-query logic before API invocation.
    """
    entities = getattr(context, "entities", None) or []
    for entity in entities:
        item = (entity or {}).get("list", [{}])[0] if isinstance(entity, dict) else {}
        dashboard_info = item.get("dashboard_info") or item.get("pc_dashboard_info") or {}
        if (dashboard_info.get("game_code", "") or "").lower() != (game_code or "").lower():
            continue
        filter_list = dashboard_info.get(filter_name, []) or []
        if not isinstance(filter_list, list):
            continue
        name_key = f"{filter_name}_name"
        code_key = f"{filter_name}_code"
        mapping: Dict[str, str] = {}
        for row in filter_list:
            if not isinstance(row, dict):
                continue
            name = str(row.get(name_key, "")).strip()
            code = str(row.get(code_key, "")).strip()
            if name and code and "255" not in row.values():
                mapping[name.lower()] = code
        if mapping:
            return mapping
    return {}


def convert_filter_values_to_codes(values: List[str], name_to_code_map: Dict[str, str]) -> List[str]:
    """Convert filter names to codes using case-insensitive mapping, keep unknowns as-is."""
    if not values:
        return []
    converted: List[str] = []
    for v in values:
        raw = str(v).strip()
        if not raw:
            continue
        converted.append(name_to_code_map.get(raw.lower(), raw))
    # Deduplicate while preserving order.
    return list(dict.fromkeys(converted))


def map_filter_values_with_available_codes(values: List[str], available_filter_map: Dict[str, str]) -> Tuple[List[str], List[str]]:
    """
    Map input values to filter codes using available filter dict ({name: code}) with case-insensitive name matching.
    Returns (mapped_codes, invalid_values).
    """
    if not values:
        return [], []
    if not available_filter_map:
        return [], [str(v) for v in values]

    name_lower_map = {str(k).lower(): k for k in available_filter_map}
    mapped_codes: List[str] = []
    invalid_values: List[str] = []
    for value in values:
        value_str = str(value)
        value_lower = value_str.lower()
        if value_lower in name_lower_map:
            mapped_codes.append(available_filter_map[name_lower_map[value_lower]])
        else:
            invalid_values.append(value_str)
    return mapped_codes, invalid_values


def map_country_name(country, user_input):
    """
    Given country names, map each to correct country code that api could identify

    Args:
        country (list): list of country names
        user_input (str): user input for multi-agents

    Returns:
        tuple: (update_country (list), should_use_top_country_tool (bool))
            - update_country: list of country codes
            - should_use_top_country_tool: True if user mentioned countries but provided no specific countries
    """

    logger.info(f"【Tool util call】-【dashboard_map_country_name】: Found country list: {country}. ")

    update_country = []
    should_use_top_country_tool = False
    country_map_keys = set(COUNTRY_MAP_INTEL.keys())
    country_map_values = set(COUNTRY_MAP_INTEL.values())

    for c in country:
        if c.lower() in country_map_keys:
            update_country.append(COUNTRY_MAP_INTEL.get(c.lower(), ""))
        elif c.lower() in country_map_values:
            update_country.append(c.lower())
        else:
            for k in country_map_keys:
                if c.lower() in k or k in c.lower():
                    update_country.append(COUNTRY_MAP_INTEL.get(k, ""))
                #
                # else:
                #     update_country.append(c.lower())


    update_country = set(update_country)
    update_country.discard("")
    update_country = list(update_country)

    logger.info(f"【Tool util return】-【dashboard_map_country_name】: Parsed country list: {update_country}, should_use_top_country_tool: {should_use_top_country_tool}. ")

    return update_country, should_use_top_country_tool


def map_language_name(language):
    """
    Given language names, map each to correct language code that api could identify

    Args:
        language (list): list of language names

    Returns:
        update_language: list of language codes
    """

    logger.info(f"【Tool util call】-【dashboard_map_language_name】: Found country list: {language}. ")

    update_language = []
    language_map_keys = set(COUNTRY_MAP_INTEL.keys())
    language_map_values = set(COUNTRY_MAP_INTEL.values())

    if language:
        for c in language:
            if c.lower() in language_map_keys:
                update_language.append(COUNTRY_MAP_INTEL.get(c.lower(), ""))
            elif c.lower() in language_map_values:
                update_language.append(c.lower())
            else:
                for k in language_map_keys:
                    if c.lower() in k or k in c.lower():
                        update_language.append(COUNTRY_MAP_INTEL.get(k, ""))

    update_language = set(update_language)
    update_language.discard("")
    update_language = list(update_language)

    logger.info(
        f"【Tool util return】-【dashboard_map_country_name】: Parsed country list: {update_language} ")

    return update_language


def update_input(game_name, game_code, game_type, metrics, granularity, start_date, end_date, user_input, tool_name, game_code_and_filters, zone = [], country = [], os = [], channel = [], region = [], lang = [], category = [], product = [], key_country = None, top_countries_rank_by_metric = None, extra_flags: dict | None = None):
    """
    Given inputs, update it given circumstances

    Args:
        metrics (list): list of metric codes
        ...
        game_type (str): type of game
        user_input (str): user input for multi-agents

    Returns:
        update_list (list): list of update messages
        metrics (list): list of metric codes
        ...
        metric_code_to_name_mapping (dict): mapping from metric codes to names
    """

    logger.info(
        f"【Tool util call】-【dashboard_update_input】: Found input: game_name {game_name}, game_code {game_code}, metrics {metrics}, granularity {granularity}, zone {zone}, country {country}, os {os}, channel {channel}, region {region}, lang {lang}, category {category}, product {product}, game_type {game_type}, start_date {start_date}, end_date {end_date}, user_input {user_input}, key_country {key_country}. ")
    

    update_list = []
    retry_info_list = []
    processed_top_countries_rank_by_metric = top_countries_rank_by_metric
    try:

        # default game_type to mobile is not provided
        if game_type is not None and ("pc" in game_type.lower() or "console" in game_type.lower()):
            game_type = "pc/console"
        
        # Session 1: handle granularity and date inputs
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        # handle None inputs
        if not granularity:
            granularity = "daily"
            update_list.append("Granularity missing; defaulted to daily. ")
        elif granularity in ["quarterly", "yearly", "month"]:
            granularity = "monthly"
        elif granularity in ["week"]:
            granularity = "weekly"
        elif granularity in ['hour', 'hourly', 'minutely', 'secondly']:
            granularity = "realtime"
            update_list.append(f"Granularity {granularity} not supported; changed to realtime. ")        
        if not start_date:  # default to today
            if granularity == "realtime":
                start_date = today
                update_list.append("Start date missing; defaulted to today (realtime). ")
            elif game_type == "mobile":
                if granularity == "daily":
                    start_date = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
                    update_list.append("Start date missing; defaulted to 30 days ago. ")
                elif granularity == "weekly":
                    start_date = (datetime.now() - timedelta(days=35)).strftime("%Y%m%d")
                    update_list.append("Start date missing; defaulted to 5 weeks ago. ")
                else:
                    start_date = (datetime.now() - timedelta(days=120)).strftime("%Y%m01")
                update_list.append("Start date missing; defaulted to 4 months ago (month start). ")
        if not end_date:  # default to today
            end_date = datetime.now().strftime("%Y%m%d")
            update_list.append("End date missing; defaulted to today. ")

        # handle invalid start_date and end_date
        start_date, end_date = update_date(start_date), update_date(end_date)
        orig_start_date, orig_end_date = start_date, end_date
        

        # --- realtime granularity fallback comes BEFORE generic clamping ---
        if granularity and granularity.lower() == "realtime":
            if orig_end_date and orig_end_date > today:
                end_date = today
                update_list.append(
                    f"Realtime fallback: end_date {orig_end_date} is in the future; fallback to today {today}. "
                )

            # realtime must be a single day
            if start_date and end_date and start_date != end_date:
                start_date = end_date
                update_list.append(
                    f"Realtime fallback: start_date != end_date ({orig_start_date} ~ {orig_end_date}); fallback to same day {start_date}. "
                )

        else:
            # generic future-date clamping (non-realtime)
            if start_date and start_date > today:
                start_date = today
            if end_date and end_date > today:
                end_date = today
            # if granularity == 'monthly':
            #     if len(start_date) > 6:
            #         if datetime.strptime(start_date, '%Y%m%d').day !=1:
            #             granularity = 'daily'
            #     if len(end_date) > 6:
            #         if datetime.strptime(end_date, '%Y%m%d').day != 1:
            #             granularity = 'daily'

        # # hard granularity cutoff
        # if abs((datetime.strptime(end_date, "%Y%m%d") - datetime.strptime(start_date, "%Y%m%d")).days) >= 365:
        #     granularity = "monthly"
        #     update_list.append("Date range > 365 days; granularity set to monthly. ")
    except Exception as e:
        logger.error(f"Error in updating input: {str(e)}")

    # Session 2: map filter names to filter codes,["channel", "os", "zone", "region", "lang", "category", "product"]
    if os:
        if 'os' not in game_code_and_filters:
            retry_info_list.append("There is no os codes/names for the game, please retry without os codes/names.")
        else:
            os, os_filtered_codes = map_filter_values_with_available_codes(os, game_code_and_filters['os'])
            if os_filtered_codes:
                update_list.append(f"os codes: {os_filtered_codes} are not valid for the game, has been eliminated in the tool call.")

    if channel:
        if 'channel' not in game_code_and_filters:
            retry_info_list.append("There is no channel codes/names for the game, please retry without channel codes/names.")
        else:
            # Create lowercase mappings for case-insensitive lookup
            os_lower_map = {k.lower(): k for k in game_code_and_filters.get('os', {})}
            channel_lower_map = {k.lower(): k for k in game_code_and_filters['channel']}
            new_channel = []
            channel_filtered_codes = []
            for k in channel:
                k = str(k)
                if k.lower() in channel_lower_map:
                    new_channel.append(game_code_and_filters['channel'][channel_lower_map[k.lower()]])
                elif k.lower() in os_lower_map:
                    os.append(game_code_and_filters['os'][os_lower_map[k.lower()]])
                else:
                    channel_filtered_codes.append(k)
            channel = new_channel
            if channel_filtered_codes:
                update_list.append(f"channel codes: {channel_filtered_codes} are not valid for the game, has been eliminated in the tool call.")


    if zone:
        if 'zone' not in game_code_and_filters:
            retry_info_list.append("There is no zone codes/names for the game, please retry without zone codes/names.")
        else:
            zone, zone_filtered_codes = map_filter_values_with_available_codes(zone, game_code_and_filters['zone'])

            if zone_filtered_codes:
                update_list.append(
                    f"zone codes: {zone_filtered_codes} are not valid for the game, has been eliminated in the tool call.")

    if region:
        if 'region' not in game_code_and_filters:
            retry_info_list.append("There is no region codes/names for the game, please retry without region codes/names.")
        else:
            # Create lowercase mapping for case-insensitive lookup
            region_lower_map = {k.lower(): k for k in game_code_and_filters['region']}
            area_name_en_to_code = _get_area_name_en_to_code_map()
            new_region = []
            region_filtered_codes = []
            for k in region:
                k_str = str(k)
                k_lower = k_str.lower()
                if k_lower in region_lower_map:
                    new_region.append(game_code_and_filters['region'][region_lower_map[k_lower]])
                else:
                    # 若不在 region_lower_map 中，尝试通过 area_name_en -> area_code 映射
                    area_code = area_name_en_to_code.get(k_lower)
                    if area_code is not None and str(area_code).lower() in region_lower_map:
                        new_region.append(game_code_and_filters['region'][region_lower_map[str(area_code).lower()]])
                    else:
                        region_filtered_codes.append(k_str)
            region = new_region

            if region_filtered_codes:
                update_list.append(
                    f"region codes: {region_filtered_codes} are not valid for the game, has been eliminated in the tool call.")

    if lang:
        if 'lang' not in game_code_and_filters:
            retry_info_list.append("There is no lang codes/names for the game, please retry without lang codes/names.")
        else:
            lang, lang_filtered_codes = map_filter_values_with_available_codes(lang, game_code_and_filters['lang'])

            if lang_filtered_codes:
                update_list.append(
                    f"lang codes: {lang_filtered_codes} are not valid for the game, has been eliminated in the tool call.")

    if category:
        if 'category' not in game_code_and_filters:
            retry_info_list.append("There is no category codes/names for the game, please retry without category codes/names.")
        else:
            category, category_filtered_codes = map_filter_values_with_available_codes(category, game_code_and_filters['category'])
            if category_filtered_codes:
                update_list.append(
                    f"category codes: {category_filtered_codes} are not valid for the game, has been eliminated in the tool call.")

    if product:
        if 'product' not in game_code_and_filters:
            retry_info_list.append("There is no product codes/names for the game, please retry without product codes/names.")
        else:
            product, product_filtered_codes = map_filter_values_with_available_codes(product, game_code_and_filters['product'])
            if product_filtered_codes:
                update_list.append(
                    f"product codes: {product_filtered_codes} are not valid for the game, has been eliminated in the tool call.")

    # Session 3: filters inputs
    try:
        if len(country) == 1 and country[0] == "255":
            retry_info_list.append("Remove country filter and retry with by_country_topn_only=True.")

        country_code, _ = map_country_name(country, user_input)
        
        if len(country_code) > 10:
            country_code = country_code[:10]
            update_list.append("Country list too long, max 10 countries allowed, truncated to 10 countries.")
        
        if country and not country_code:
            migrated_region = []
            if 'region' in game_code_and_filters:
                region_lower_map = {k.lower(): k for k in game_code_and_filters['region']}
                area_name_en_to_code = _get_area_name_en_to_code_map()
                remained_country = []
                for c in country:
                    c_str = str(c)
                    c_lower = c_str.lower()
                    if c_lower in region_lower_map:
                        migrated_region.append(game_code_and_filters['region'][region_lower_map[c_lower]])
                        continue
                    area_code = area_name_en_to_code.get(c_lower)
                    if area_code is not None and str(area_code).lower() in region_lower_map:
                        migrated_region.append(game_code_and_filters['region'][region_lower_map[str(area_code).lower()]])
                    else:
                        remained_country.append(c)

                if migrated_region:
                    region = list(dict.fromkeys((region or []) + migrated_region))
                    country = remained_country
                    update_list.append(
                        "Detected region values in country filter, auto moved them from country to region.")

            if not migrated_region:
                retry_info_list.append("Unvalid country code detected, please retry with valid country codes.")
    except Exception as e:
        logger.warning(f"【Tool util】-【dashboard_map_country_name】: {str(e)}")

    try:
        # add channel to filter if not recognized by agent
        if not channel and ("channel" in user_input.lower() or "渠道" in user_input):
            channel = ['255']

        # deal with region = global
        test = False
        for r in region:
            if "global" in r.lower() or "area" in r.lower() or "unkonwn" in r.lower():
                test = True
                break
        if test:
            region = ["255"]
            
        if os:
            if len(os) == 1 and '255' in os and ('全平台' in user_input or '全平台' in user_input.replace(" ","") or 'all platform' in user_input.lower()):
                os = []
            for o in os:
                if o == "100" or o.lower() == "mobile":
                    os.remove(o)
                    os.append("mobile")
                elif o == "200" or o.lower() == "pc":
                    os.remove(o)
                    os.append("pc")
                elif o == "300" or o.lower() == "console":
                    os.remove(o)
                    os.append("console")

        # if granularity is realtime, carefully choose filters
        if granularity.lower() == "realtime":
            if "zone" not in user_input.lower() and "区" not in user_input:
                zone = [x for x in zone if '255' not in x]
            if "countr" not in user_input.lower() and "国" not in user_input:
                country_code = [x for x in country_code if '255' not in x]
            if "os" not in user_input.lower() and "系" not in user_input:
                os = [x for x in os if '255' not in x]
            if "channel" not in user_input.lower() and "渠" not in user_input:
                channel = [x for x in channel if '255' not in x]
            if "region" not in user_input.lower() and "地" not in user_input:
                region = [x for x in region if '255' not in x]
            if "lang" not in user_input.lower() and "语" not in user_input:
                lang = [x for x in lang if '255' not in x]
            if "categor" not in user_input.lower() and "类" not in user_input and "dlc" not in user_input:
                category = [x for x in category if '255' not in x]
            if "product" not in user_input.lower() and "品" not in user_input and "dlc" not in user_input:
                product = [x for x in product if '255' not in x]
    except Exception as e:
        logger.error(f"Error in updating input: {str(e)}")



    # -------------------------------- Session 4: handle metrics inputs --------------------------------
    # Save original metrics input for later validation
    original_metrics_input = metrics if metrics else []
    
    try:
        # ---- helpers ----
        def is_realtime(name: str) -> bool:
            return "realtime" in name.lower().split("_")

        def is_daily(name: str) -> bool:
            return "daily" in name.lower().split("_")
        
        # alias differences by game type
        alias_by_type = {
            "pc/console": {
                "pay_amount": "revenue_after_refund",
                "lifetime_pay_amount": "lifetime_revenue_after_refund",
                "lifetime_new_users_count": "new_users_count",
            },
            "mobile": {
                "revenue_after_refund": "pay_amount",
                "lifetime_revenue_after_refund": "lifetime_pay_amount",
                "2_day_new_users_retention_rate_daily": "next_day_new_users_retention_rate_realtime",
                "lifetime_new_users_count": "new_users_count",
            },
            "casual": {
                "pay_amount": "advertisement_revenue",
                "revenue_after_refund": "advertisement_revenue",
            }
        }
        alias_by_game = {
            "dl2": {
                "average_revenue_per_users_arpu": "platform_arpu",
                "average_revenue_per_paying_users_arppu": "platform_arppu",
                "revenue_after_refund":"gross_revenue"
            },
            "dl": {
                "revenue_after_refund": "gross_revenue"
            },
        }
        alias_map = alias_by_type.get(game_type, {})
        alias_map_game = alias_by_game.get(game_code, {})

        name_to_code = DASHBOARD_METRIC_NAME_CODE_MAPPING_BY_TYPE[game_type]
        code_to_name_known = {v: k for k, v in name_to_code.items()}
        defaults_map = DASHBOARD_DEFAULT_METRIC_MAP_BY_QUERY.get(game_type, {})
        
        # Handle None metrics
        if metrics is None:
            metrics = []
        name_set = set(metrics)
        
        #3.1 pre-process metrics
        # handle default metrics
        macros = {m for m in list(name_set) if m in defaults_map}
        for macro in macros:
            name_set.discard(macro)
            name_set.update(defaults_map[macro])
        
        # handle alias differences, first use default transfer, then use game specific transfer. game specific transfer is of higher priority
        name_set = {alias_map.get(m, m) for m in name_set}
        name_set = {alias_map_game.get(m, m) for m in name_set}

        # # expand lifetime → add the non-lifetime counterpart
        lifetime_names = {m for m in name_set if "lifetime" in m.lower().split("_")}
        lifetime_expanded_metrics = []
        for m in lifetime_names:
            if m == 'lifetime_base_game_units_sold_after_refund':
                base = "units_sold_after_refund"
            else:
                base = m.replace("lifetime_", "", 1)
            if base in name_to_code:
                name_set.add(base)
                lifetime_expanded_metrics.append(base)

        has_lifetime_metric = len(lifetime_names) > 0
        
        
        # 3.2 map metrics to its metric codes and create reverse mapping
        all_codes = set()
        realtime_codes = set()
        daily_codes = set()
        non_realtime_daily_codes = set()
        metric_code_to_name_mapping = {}
        invalid_metrics = []  # Track invalid metrics
        dl_sales_revenue_codes = set()  # dl1/dl2: sale/revenue metrics queried separately with Paid only filter

        #handle special metric change cases
        if "peak_daily_active_users" in name_set and ("mau" in user_input.lower() or "wau" in user_input.lower()) and ("peak" in user_input.lower() or "峰值" in user_input.lower()) and not ("dau" in user_input.lower() or "日活" in user_input.lower()):
            name_set.remove("peak_daily_active_users")
            name_set.add("active_users_count")

        if len(product) > 0 and "255" not in product and "units_sold_after_refund" in name_set:
            name_set.remove("units_sold_after_refund")
            name_set.add("units_sold_after_refund_for_product")

        for m in name_set:
            # If it's a known metric *name*
            if m in name_to_code:
                code = name_to_code[m]
                name = m
            # If it's already a known *code*
            elif m in code_to_name_known:
                code = m
                # Find all names that map to this code
                all_names_for_code = [name for name, c in name_to_code.items() if c == code]
                # Filter to get non-realtime names
                non_realtime_names = [n for n in all_names_for_code if not is_realtime(n)]
                # Choose non-realtime name if available, otherwise fall back to any name
                if non_realtime_names:
                    name = non_realtime_names[0]
                else:
                    name = code_to_name_known[m]
            else:
                # Unknown token; record as invalid metric
                invalid_metrics.append(m)
                continue
        
            if not code:
                continue

            all_codes.add(code)
            metric_code_to_name_mapping[code] = name

            if is_realtime(name):
                realtime_codes.add(code)
                # For every realtime metric, automatically add _dod and _dod_count variants
                dod_code = code + "_dod"
                dod_count_code = code + "_dod_count"
                dod_name = name + "_dod"
                dod_count_name = name + "_dod_count"
                
                metric_code_to_name_mapping[dod_code] = dod_name
                metric_code_to_name_mapping[dod_count_code] = dod_count_name
                
            elif is_daily(name):
                daily_codes.add(code)
            elif game_code and str(game_code).lower() in ("dl", "dl2") and ("units" in name.lower() or "revenue" in name.lower() or "average_selling_price" in name.lower()):
                dl_sales_revenue_codes.add(code)
            else:
                non_realtime_daily_codes.add(code)
        
        # Add retry info for invalid metrics
        if invalid_metrics and len(invalid_metrics) == len(name_set):
            invalid_metrics_str = ", ".join(invalid_metrics)
            retry_info_list.append(f"Invalid metrics detected: {invalid_metrics_str}. Please use different valid metrics and retry.")
        elif invalid_metrics:
            invalid_metrics_str = ", ".join(invalid_metrics)
            update_list.append(
                f"Invalid metrics detected: {invalid_metrics_str}, they have been eliminated in the tool call.")

        # Process top_countries_rank_by_metric with same name/code resolution as metrics (for by_country_topn_only)
        processed_top_countries_rank_by_metric = top_countries_rank_by_metric
        if isinstance(top_countries_rank_by_metric, list) and len(top_countries_rank_by_metric) > 0:
            rank_name_set = set(top_countries_rank_by_metric)
            for macro in list(rank_name_set):
                if macro in defaults_map:
                    rank_name_set.discard(macro)
                    rank_name_set.update(defaults_map[macro])
            rank_name_set = {alias_map.get(m, m) for m in rank_name_set}
            rank_name_set = {alias_map_game.get(m, m) for m in rank_name_set}
            rank_codes = []
            for m in rank_name_set:
                if m in name_to_code:
                    code = name_to_code[m]
                elif m in code_to_name_known:
                    code = m
                else:
                    continue
                if code:
                    rank_codes.append(code)
            processed_top_countries_rank_by_metric = rank_codes if rank_codes else top_countries_rank_by_metric
            
    except Exception as e:
        logger.error(f"Error in updating input: {str(e)}")
        # Initialize metrics variables if not defined due to exception
        try:
            _ = all_codes
        except NameError:
            all_codes = set()
        try:
            _ = realtime_codes
        except NameError:
            realtime_codes = set()
        try:
            _ = daily_codes
        except NameError:
            daily_codes = set()
        try:
            _ = non_realtime_daily_codes
        except NameError:
            non_realtime_daily_codes = set()
        try:
            _ = metric_code_to_name_mapping
        except NameError:
            metric_code_to_name_mapping = {}
        try:
            _ = invalid_metrics
        except NameError:
            invalid_metrics = []
        try:
            _ = lifetime_expanded_metrics
        except NameError:
            lifetime_expanded_metrics = []
        try:
            _ = dl_sales_revenue_codes
        except NameError:
            dl_sales_revenue_codes = set()
        try:
            _ = processed_top_countries_rank_by_metric
        except NameError:
            processed_top_countries_rank_by_metric = top_countries_rank_by_metric
        
    
    # Initialize metrics_to_remove_from_data_result set
    metrics_to_remove_from_data_result = set()
    
    try:
        if "pcu" in user_input.lower():
            all_codes.add("pcu")
            non_realtime_daily_codes.add("pcu")
            metric_code_to_name_mapping = update_metric_mapping_for_new_metrics(["pcu"], game_type, metric_code_to_name_mapping)

        if "active_users_max" in all_codes:
            # Check if active_users was already present before this step
            active_users_existed_before = "active_users" in daily_codes
            # non_realtime_daily_codes.discard("active_users")  # Remove active_users from non_realtime_daily_codes if it was already there
            daily_codes.add("active_users")
            all_codes.add("active_users")
            metric_code_to_name_mapping = update_metric_mapping_for_new_metrics(["active_users"], game_type, metric_code_to_name_mapping)
            
            # If active_users was added in this step and granularity is daily, mark it for removal from data result
            if not active_users_existed_before:
                metrics_to_remove_from_data_result.add("active_users")
        
        # Ensure avg_active_users is in non_realtime_daily_codes (not daily_codes) since it only supports weekly/monthly granularity
        if "avg_active_users" in all_codes:
            daily_codes.discard("avg_active_users")
            non_realtime_daily_codes.add("avg_active_users")
        
        # 3.3.1 Check for d7 metrics and expand date range if needed
        has_d7_metric = False
        # Check all codes collected (including those added in 3.3)
        for code in all_codes:
            if "d7" in code.lower():
                has_d7_metric = True
                break
        
        if has_d7_metric and granularity != "realtime":
            # Calculate date range in days
            start_dt = datetime.strptime(start_date, "%Y%m%d")
            end_dt = datetime.strptime(end_date, "%Y%m%d")
            date_range_days = (end_dt - start_dt).days
            
            # If range is less than 8 days, expand to 8 days
            if date_range_days < 8:
                # Adjust start_date backwards to make it at least 8 days
                new_start_dt = end_dt - timedelta(days=8)
                # Make sure we don't go before today (only if end_date is today or in the future)
                today_dt = datetime.strptime(today, "%Y%m%d")
                if new_start_dt < today_dt and end_dt >= today_dt:
                    # If we can't go back 8 days and end_date is today/future, use today as the limit
                    new_start_dt = today_dt
                
                # Only update if it actually expands the range (moves start_date backwards)
                if new_start_dt < start_dt:
                    new_start_date = new_start_dt.strftime("%Y%m%d")
                    start_date = new_start_date
                    new_range_days = (end_dt - new_start_dt).days
                    update_list.append(f"Date range expanded for d7 metric from {date_range_days} days to {new_range_days} days.")
            
        # 3.5 remove duplicate metrics
        metrics = list(all_codes)
        realtime_metrics = list(realtime_codes)
        daily_metrics = list(daily_codes)
        non_realtime_daily_metrics = list(non_realtime_daily_codes)
        dl_sales_revenue_codes = list(dl_sales_revenue_codes)

        #change granularity for certain metrics
        if ("avg_active_users" in metrics or "avg_net_revenue" in metrics or "avg_units_number" in metrics) and granularity == "daily":
            granularity = "weekly"
        
        #--------end of Session 3: handle metrics inputs --------

        # Session 4: special case for nikke
        if "nikke" in game_name.lower() and any(kw in user_input.lower() for kw in ["港澳台", "hmt", "港澳台服", "hk", "h.k.", "香港", "澳门", "台湾"]): # 港澳台服
            update_list.append("Special case: Detected Nikke 港澳台; switched game_code to nikke_hmt, cleared zone, removed HK/MO/TW countries.")
            game_code = "nikke_hmt"
            game_name = "nikke_hmt"
            zone = []  # 清除 zone 过滤器
            # 如果有 country=HK/MO/TW 也清空
            country_code = [c for c in country_code if c not in ["hk", "mo", "tw", "hmt"]]            
    
        
    except Exception as e:
        logger.error(f"Error in dealing with additional metric codes: {str(e)}")
        # Initialize metrics variables if not defined due to exception
        try:
            _ = all_codes
        except NameError:
            all_codes = set()
        try:
            _ = realtime_codes
        except NameError:
            realtime_codes = set()
        try:
            _ = daily_codes
        except NameError:
            daily_codes = set()
        try:
            _ = non_realtime_daily_codes
        except NameError:
            non_realtime_daily_codes = set()
        try:
            _ = metrics_to_remove_from_data_result
        except NameError:
            metrics_to_remove_from_data_result = set()
        try:
            _ = dl_sales_revenue_codes
        except NameError:
            dl_sales_revenue_codes = set()
        # Initialize final metrics lists
        metrics = list(all_codes)
        realtime_metrics = list(realtime_codes)
        daily_metrics = list(daily_codes)
        non_realtime_daily_metrics = list(non_realtime_daily_codes)

    # Check if original input metrics are empty (only check at the beginning)
    # If metrics were provided but all were invalid, invalid_metrics retry info was already added above
    if len(original_metrics_input) == 0:
        retry_info_list.append("Metrics are empty. Please retry with valid metrics.")

    # If granularity is daily, move all non_realtime_daily_metrics to daily_metrics
    if granularity == "daily":
        daily_metrics.extend(non_realtime_daily_metrics)
        # Remove duplicates while preserving order
        seen = set()
        daily_metrics = [x for x in daily_metrics if not (x in seen or seen.add(x))]
        non_realtime_daily_metrics = []

    if isinstance(extra_flags, dict):
        normalized_user_input = (user_input or "").replace(" ", "")
        extra_flags["is_xiaohao"] = (
            game_name == "NIKKE：胜利女神"
            and ("去小号" in normalized_user_input)
            and ("不去小号" not in normalized_user_input)
        )
        extra_flags["lifetime_expanded_metrics"] = list(lifetime_expanded_metrics or [])
        extra_flags["metrics_to_remove_from_data_result"] = set(metrics_to_remove_from_data_result or set())
        extra_flags["dl_sales_revenue_codes"] = list(dl_sales_revenue_codes or [])
        extra_flags["use_paid_only_filters"] = bool(dl_sales_revenue_codes)
    logger.info(f"【Tool util return】-【dashboard_update_input】: Parsed input: game_name {game_name}, game_code {game_code}, metrics {metrics}, realtime_metrics {realtime_metrics}, daily_metrics {daily_metrics}, non_realtime_daily_metrics {non_realtime_daily_metrics}, dl_sales_revenue_codes {dl_sales_revenue_codes}, granularity {granularity}, zone {zone}, country_code {country_code}, os {os}, channel {channel}, region {region}, lang {lang}, category {category}, product {product}, start_date {start_date}, end_date {end_date}, processed_top_countries_rank_by_metric {processed_top_countries_rank_by_metric}. ")
    # logger.info(f"update_list: {update_list}")
    logger.info(f"metric_code_to_name_mapping: {metric_code_to_name_mapping}")
    return update_list, game_name, game_code, metrics, realtime_metrics, daily_metrics, non_realtime_daily_metrics, granularity, start_date, end_date, zone, country_code, os, channel, region, lang, category, product, metric_code_to_name_mapping, retry_info_list, processed_top_countries_rank_by_metric


def update_bi_data_input(data, metrics):

    # logger.info(f"【Tool util call】-【dashboard_update_bi_data_input】: Found input: data: {data}, metrics: {metrics}.")

    # deal with realtime data
    if "metric_value" not in data:

        # deal with no metric value time
        for m in data:
            toRemove = set()
            for d in data.get(m, []):
                if not d.get(m, "") and not d.get(m + "_dod", ""):
                    toRemove.add(d.get("time", ""))
            data[m] = [x for x in data.get(m, []) if x.get("time", "") not in toRemove]

    # deal with regular data
    else:

        # deal with no metric value date
        hasResult = set()
        for x in data["metric_value"]:
            if any([x.get(d, "") for d in x.keys() if d != "date"]):
                hasResult.add(x.get("date", ""))
        hasResult.discard("")
        data["metric_value"] = [x for x in data["metric_value"] if x.get("date", "") in hasResult]

    # logger.info(f"【Tool util return】-【dashboard_update_bi_data_input】: Parsed data: {data}.")

    return data


def get_bi_data(data, metrics, game_name, entity_type, is_english=True, metrics_to_remove_from_data_result=None):
    """
    Given data queried, format bi data for front end visualization

    Args:
        data (dict): query result returned from query_dashboard_metrics in its original format
        metrics (list): list of metrics queried
        game_name (str): name of the game queried
        entity_type (str): the entity type of the game queried, either mobile or pc/console
        is_english (bool, optional): whether the metrics should be in English (or Chinese). Defaults to True.

    Returns:
        bi_data (dict): a json in the format listed in this doc: https://doc.weixin.qq.com/doc/w3_AGUAAAaAACcCNAN2q3ftWRhaeLOeB?scode=AJEAIQdfAAoz0Scb8OAWYArgY3AG0
    """

    # logger.info(f"【Tool util call】-【dashboard_get_bi_data】: Found input: data: {data}, metrics: {metrics}, game_name: {game_name}, entity_type: {entity_type}, is_english: {is_english}.")

    result = {
        "code": 0,
        "msg": "ok",
        "ext_info": {},
        "system": "dashboard",
    }
    data_result = {
        "version": "2.0",
        "xAxis": ["date"],
        "yAxis": ["value"],
        "chat_type": "trend",
    }

    # Case #1 deal with realtime data:
    if "metric_value" not in data:

        # invalid data
        valid_metrics = list(data.keys())
        if not valid_metrics:
            return None, None

        # deal with invalid time and too many filters
        data = update_bi_data_input(data, metrics)

        result["auto_hide_metric"] = True
        data_result["xAxis"] = ["time"]

        additional_metrics = [x + '_dod' for x in valid_metrics]
        # additional_metrics.extend([x + '_dod_count' for x in valid_metrics])
        valid_metrics.extend(additional_metrics)

        all_data = []
        for x in data.values():
            all_data.extend(x)

        metrics_info = [
            {
                "name": DASHBOARD_METRIC_MAP_BY_NAME_REALTIME.get(m, {}).get("metric_name_en" if is_english else "metric_name_cn", m),
                "data_key": m,
                "type": DASHBOARD_METRIC_MAP_BY_NAME_REALTIME.get(m, {}).get("value_type", "numerical"),
            }
            for m in valid_metrics
        ]
        data_result["metrics_info"] = metrics_info

        dimension_info = []
        dimension_info.append(
            {
                "name": "Metric",
                "data_key": "realtime_metric",
                "value": [DASHBOARD_METRIC_MAP_BY_NAME_REALTIME.get(x, {}).get("metric_name_en" if is_english else "metric_name_cn", x) for x in valid_metrics]
            }
        )
        dimensions = set()
        for x in all_data:
            for k in x:
                if k not in valid_metrics and k not in dimensions and "_dod_count" not in k:
                    dimensions.add(k)
        for d in dimensions:
            dimension_info.append(
                {
                    "name": d,
                    "data_key": d,
                    "value": list(set([x[d] for x in all_data if d in x])),
                }
            )
        dimensions.add("game_name")
        dimension_info.append(
            {
                "name": "game_name",
                "data_key": "game_name",
                "value": [game_name]
            }
        )
        dimensions.add("game_type")
        dimension_info.append(
            {
                "name": "game_type",
                "data_key": "game_type",
                "value": [entity_type]
            }
        )
        dimensions.add("source")
        dimension_info.append(
            {
                "name": "source",
                "data_key": "source",
                "value": ["dashboard"]
            }
        )
        dimensions.add("granularity")
        dimension_info.append(
            {
                "name": "granularity",
                "data_key": "granularity",
                "value": ["realtime"],
            }
        )
        data_result["dimension_info"] = dimension_info

        # xAxis = date
        dimensions.discard("time")

        # legends = keys of data_value - metrics - xAxis - ["game_name", "game_type", "source", "granularity"]
        legends = ["game_name"]
        dimensions.discard("game_name")
        for x in all_data:
            for k in x:
                if (
                    k not in valid_metrics
                    and k in dimensions
                    and k not in ["game_name", "game_type", "source", "granularity"]
                ):
                    legends.append(k)
                    dimensions.discard(k)
        data_result["legends"] = legends[::-1]

        # filter_info = dimension_info - xAxis - legends
        filter_info = []
        for d in dimensions:
            filter_info.append(
                {
                    "name": d,
                    "data_key": d,
                    "filter_type": "normal"
                }
            )
        filter_info.append(
            {
                "name": "",
                "data_key": "realtime_metric",
                "filter_type": "cascade",
                "has_metric": True,
                "value": [DASHBOARD_METRIC_MAP_BY_NAME_REALTIME.get(x, {}).get("metric_name_en" if is_english else "metric_name_cn", x) for x in valid_metrics],
                "display_info": ["realtime_metric"],
                "display_value": {DASHBOARD_METRIC_MAP_BY_NAME_REALTIME.get(x, {}).get("metric_name_en" if is_english else "metric_name_cn", x) : [x] for x in valid_metrics}
            }
        )
        data_result["filter_info"] = filter_info

        # keys of data_value = dimension_info + metrics
        data_values = []
        valid_keys = set(y for x in all_data for y in x if any([z.get(y, "") for z in all_data]) and "_dod" not in y)
        # valid_keys_v2 = set()
        # for x in all_data:
        #     for y, z in x.items():
        #         if z and "_dod" not in y:
        #             valid_keys_v2.add(y)
        for x in data:
            for y in data[x]:

                temp1 = {k: y.get(k, "") for k in valid_keys}
                temp1["realtime_metric"] = DASHBOARD_METRIC_MAP_BY_NAME_REALTIME.get(x, {}).get("metric_name_en" if is_english else "metric_name_cn", x)
                temp1["granularity"] = "realtime"
                temp1["game_name"] = game_name
                temp1["game_type"] = entity_type
                temp1["source"] = "dashboard"
                data_values.append(temp1)

                temp2 = {k: y.get(k, "") for k in valid_keys if k != x}
                temp2[x + "_dod"] = y.get(x + "_dod", "")
                temp2["realtime_metric"] = DASHBOARD_METRIC_MAP_BY_NAME_REALTIME.get(x + "_dod", {}).get("metric_name_en" if is_english else "metric_name_cn", x + "_dod")
                temp2["granularity"] = "realtime"
                temp2["game_name"] = game_name
                temp2["game_type"] = entity_type
                temp2["source"] = "dashboard"
                data_values.append(temp2)
        data_result["data"] = data_values

        result["data"] = data_result
        # print(f"RETURNING BI DATA RESULT: {result}")
        data_id = "DashboardAgent_" + str(uuid.uuid4())
        result["data_id"] = data_id

        # logger.info(f"【Tool util return】-【dashboard_get_bi_data】: Return output: result: {result}, data_id: {data_id}.")

        return result, data_id

    # Case #2 deal with non-realtime data
    else:

        # deal with invalid date and too many filters
        data = update_bi_data_input(data, metrics)

        metrics_info = [
            {
                "name": get_dashboard_metric_info(m, entity_type).get("metric_name_en" if is_english else "metric_name_cn", m),
                "data_key": m,
                "type": get_dashboard_metric_info(m, entity_type).get("value_type", "numerical"),
            }
            for m in metrics
            if any(x.get(m, "") for x in data["metric_value"])
        ]
        metrics_info = sorted(metrics_info, key=lambda x: get_dashboard_metric_info(x["data_key"], entity_type).get("weight", 999999))
        data_result["metrics_info"] = metrics_info

        # xAxis + legends + filter_info = dimension_info
        # dimension_info = keys of data_value - metrics
        dimension_info = []
        dimensions = set()
        for x in data["metric_value"]:
            for k in x:
                if k not in metrics and k not in dimensions:
                    dimensions.add(k)
        for d in dimensions:
            dimension_info.append(
                {
                    "name": d,
                    "data_key": d,
                    "value": list(set([x[d] for x in data["metric_value"] if d in x])),
                }
            )
        dimensions.add("game_name")
        dimension_info.append(
            {
                "name": "game_name",
                "data_key": "game_name",
                "value": [game_name]
            }
        )
        dimensions.add("game_type")
        dimension_info.append(
            {
                "name": "game_type",
                "data_key": "game_type",
                "value": [entity_type]
            }
        )
        dimensions.add("source")
        dimension_info.append(
            {
                "name": "source",
                "data_key": "source",
                "value": ["dashboard"]
            }
        )
        dimensions.add("granularity")
        dimension_info.append(
            {
                "name": "granularity",
                "data_key": "granularity",
                "value": [data.get("granularity", "daily")],
            }
        )
        data_result["dimension_info"] = dimension_info

        # xAxis = date
        dimensions.discard("date")

        # legends = keys of data_value - metrics - xAxis - ["game_name", "game_type", "source", "granularity"]
        legends = ["game_name"]
        dimensions.discard("game_name")
        for x in data["metric_value"]:
            for k in x:
                if (
                    k not in metrics
                    and k in dimensions
                    and k not in ["game_name", "game_type", "source", "granularity"]
                ):
                    legends.append(k)
                    dimensions.discard(k)
        data_result["legends"] = legends

        # filter_info = dimension_info - xAxis - legends
        filter_info = []
        for d in dimensions:
            filter_info.append(
                {
                    "name": d,
                    "data_key": d,
                    "filter_type": "normal"
                }
            )
        data_result["filter_info"] = filter_info

        # keys of data_value = dimension_info + metrics
        data_values = []
        valid_keys = [x for x in data["metric_value"][0] if any([y.get(x, "") for y in data["metric_value"]])]
        # Remove metrics that should be discarded from data result (only daily granularity)
        if metrics_to_remove_from_data_result and data.get("granularity", "daily") == "daily":
            metrics_to_remove = set(metrics_to_remove_from_data_result)
            valid_keys = [k for k in valid_keys if k not in metrics_to_remove]
        for x in data["metric_value"]:
            temp = {k: x[k] for k in valid_keys}
            temp["granularity"] = data.get("granularity", "daily")
            temp["game_name"] = game_name
            temp["game_type"] = entity_type
            temp["source"] = "dashboard"
            data_values.append(temp)
        data_result["data"] = data_values

        result["data"] = data_result
        # print(f"RETURNING BI DATA RESULT: {result}")
        data_id = "DashboardAgent_" + str(uuid.uuid4())
        result["data_id"] = data_id

        # logger.info(f"【Tool util return】-【dashboard_get_bi_data】: Return output: result: {result}, data_id: {data_id}.")

        return result, data_id


def send_request_with_token(
    api_url: str, data: dict, token: str, method: str = "POST", **kwargs
) -> requests.Response:
    """
    Given data and token, send post request to target url

    Args:
        api_url (str): url to send request
        data (dict): json to send to url
        token (str): user token for api call
        method (str, optional): request method for url. Defaults to "POST".

    Returns:
        resp (requests.Response): the response returned from url
    """

    rb_system_json = gl.get_value("rb_system_json", expected_type=dict)
    databrain_config = rb_system_json["databrain_config"]
    headers = {
        "Authorization": f"Bearer {token.strip()}",
        "Content-Type": "application/json",
    }

    url = databrain_config["host"] + api_url
    # url = "https://databrain-pre.intlgame.com" + api_url
    logger.info(
        f"【send_request】 Call api with url: {url}, method: {method}, data: {data}"
    )
    resp = send_request_with_headers("POST", url, headers, data, **kwargs)
    logger.info(
        f"【send_request】 Call api with url: {url}, method: {method}, data: {data}\n response: {resp}"
    )
    return resp


def _format_value_by_type(value: Any, value_type: str) -> Any:
    """
    Format a value based on its value_type.
    
    Args:
        value: The value to format
        value_type: The type of the value ("percent", "float", "numerical", etc.)
        
    Returns:
        Formatted value
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return value
    
    try:
        # Normalize value_type to lowercase for case-insensitive comparison
        value_type_lower = str(value_type).lower() if value_type else ""
        
        if value_type_lower == "percent":
            # Format as percentage: multiply by 100 and add %
            num_value = float(value)
            return f"{num_value * 100:.2f}%"
        elif value_type_lower == "float":
            # Round float values to 2 decimal places
            num_value = float(value)
            return round(num_value, 2)
        elif value_type_lower == "numerical":
            # For numerical, try to convert to int if it's a whole number, otherwise keep as float
            num_value = float(value)
            if num_value.is_integer():
                return int(num_value)
            return num_value
        else:
            # For other types or unknown types, return as is
            return value
    except (ValueError, TypeError):
        # If conversion fails, return original value
        return value


def get_mcp_bi_data(data, metrics, game_name, entity_type, metric_map, time_column_name, granularity, is_english=True):
    """
    Given data queried, format bi data for front end visualization

    Args:
        data (dict): query result returned from mcp
        metrics (list): list of metrics queried
        game_name (str): name of the game queried
        entity_type (str): the entity type of the game queried, either mobile or pc/console
        metric_map (dict): metric map containing metric info such as english/chinese name, format should be similar to DASHBOARD_METRIC_MAP_BY_NAME
        time_column_name (str): name of the column in data that represents time
        is_english (bool, optional): whether the metrics should be in English (or Chinese). Defaults to True.

    Returns:
        bi_data (dict): a json in the format listed in this doc: https://doc.weixin.qq.com/doc/w3_AGUAAAaAACcCNAN2q3ftWRhaeLOeB?scode=AJEAIQdfAAoz0Scb8OAWYArgY3AG0
    """

    # logger.info(f"【Tool util call】-【dashboard_get_mcp_bi_data】: Found input: data: {data}, metrics: {metrics}, time_column_name: {time_column_name}, metric_map: {metric_map}, is_english: {is_english}.")

    result = {
        "code": 0,
        "msg": "ok",
        "ext_info": {},
        "system": "dashboard",
        "auto_hide_metric": True
    }
    data_result = {
        "version": "2.0",
        "xAxis": ["time"],
        "yAxis": ["value"],
        "chat_type": "trend",
    }
    
    for x in data:
        x['time'] = x.get(time_column_name, "")
        if not x['time']:
            continue  # maybe not the best practice
        x_dt = datetime.strptime(x['time'], "%Y-%m-%dT%H:%M:%S.%f")
        x['time'] = x_dt.strftime("%Y-%m-%d %H:%M:%S")
        if time_column_name in x:
            del x[time_column_name]
        
        # Create a list of keys to avoid "dictionary changed size during iteration" error
        keys_to_delete = []
        for k in x:
            # want to del table.dtstathour.hour
            if len(k.split('.')) >= 3:
                keys_to_delete.append(k)
        
        # Delete keys after iteration
        for k in keys_to_delete:
            del x[k]

    # sort query data
    data = sorted(data, key=lambda x: x.get('time', "0"))

    # deal with invalid date and too many filters
    # data = update_bi_data_input(data, metrics)
    metrics_info = [
        {
            "name": metric_map.get(m.split('.')[-1], {}).get("metric_name_en" if is_english else "metric_name_cn", m),
            "data_key": m,
            "type": metric_map.get(m.split('.')[-1], {}).get("value_type", "float"),
        }
        for m in metrics
        if any(x.get(m, "") for x in data)
    ]
    # metrics_info = sorted(metrics_info, key=lambda x: metric_map.get(x["data_key"], {}).get("weight", 999999))
    data_result["metrics_info"] = metrics_info

    # xAxis + legends + filter_info = dimension_info
    # dimension_info = keys of data_value - metrics
    dimension_info = []
    dimensions = set()
    for x in data:
        for k in x:
            if k not in metrics and k not in dimensions:
                dimensions.add(k)
    for d in dimensions:
        dimension_info.append(
            {
                "name": d,
                "data_key": d,
                "value": list(set([x[d] for x in data if d in x])),
            }
        )
    dimensions.add("game_name")
    dimension_info.append(
        {
            "name": "game_name",
            "data_key": "game_name",
            "value": [game_name]
        }
    )
    dimensions.add("game_type")
    dimension_info.append(
        {
            "name": "game_type",
            "data_key": "game_type",
            "value": [entity_type]
        }
    )
    dimensions.add("source")
    dimension_info.append(
        {
            "name": "source",
            "data_key": "source",
            "value": ["dashboard"]
        }
    )
    dimensions.add("granularity")
    dimension_info.append(
        {
            "name": "granularity",
            "data_key": "granularity",
            "value": [granularity],
        }
    )
    data_result["dimension_info"] = dimension_info

    # xAxis = date
    dimensions.discard("time")

    # legends = keys of data_value - metrics - xAxis - ["game_name", "game_type", "source", "granularity"]
    legends = ["game_name"]
    dimensions.discard("game_name")
    for x in data:
        for k in x:
            if (
                k not in metrics
                and k in dimensions
                and k not in ["game_name", "game_type", "source", "granularity"]
            ):
                legends.append(k)
                dimensions.discard(k)
    data_result["legends"] = legends

    # filter_info = dimension_info - xAxis - legends
    filter_info = []
    for d in dimensions:
        filter_info.append(
            {
                "name": d,
                "data_key": d,
                "filter_type": "normal"
            }
        )
    data_result["filter_info"] = filter_info

    # keys of data_value = dimension_info + metrics
    # Build metric to value_type mapping for formatting using DASHBOARD_METRIC_MAP_BY_NAME
    metric_to_value_type = {}
    for m in metrics:
        metric_code = m.split('.')[-1]
        # Try DASHBOARD_MCP_METRIC_MAP_BY_NAME first (for MCP metrics), then DASHBOARD_METRIC_MAP_BY_NAME
        metric_info = DASHBOARD_MCP_METRIC_MAP_BY_NAME.get(metric_code) or get_dashboard_metric_info(metric_code, entity_type)
        value_type = metric_info.get("value_type", "float")
        print(f"metric_info: {metric_info}, value_type: {value_type}")
        metric_to_value_type[m] = value_type
        # Also map by metric code for easier lookup
        metric_to_value_type[metric_code] = value_type

    data_values = []
    valid_keys = [k for k in data[0] if any([x.get(k, "") for x in data])]
    for x in data:
        temp = {}
        for k in valid_keys:
            # Format metric values based on their value_type
            if k in metric_to_value_type:
                temp[k] = _format_value_by_type(x[k], metric_to_value_type[k])
            else:
                # Also check if the key ends with a metric code (for cases like "table.metric")
                metric_code = k.split('.')[-1] if '.' in k else k
                if metric_code in metric_to_value_type:
                    temp[k] = _format_value_by_type(x[k], metric_to_value_type[metric_code])
                else:
                    temp[k] = x[k]
        temp["granularity"] = granularity
        temp["game_name"] = game_name
        temp["game_type"] = entity_type
        temp["source"] = "dashboard"
        data_values.append(temp)
    data_result["data"] = data_values

    result["data"] = data_result
    print(f"RETURNING BI DATA RESULT: {result}")
    data_id = "DashboardAgent_" + str(uuid.uuid4())
    result["data_id"] = data_id

    # logger.info(f"【Tool util return】-【dashboard_get_mcp_bi_data】: Return output: result: {result}, data_id: {data_id}.")

    return result, data_id


def get_metric_percentage_bi_data(data, metrics, game_name, entity_type, is_english=True):
    """
    Given metric percentage data queried, format bi data for front end visualization.
    Similar to get_bi_data but adapted for metric percentage format which has _percent fields.

    Args:
        data (dict): query result returned from metric percentage API in format {metric: [{metric: value, metric_percent: value, ...}, ...]}
        metrics (list): list of metrics queried
        game_name (str): name of the game queried
        entity_type (str): the entity type of the game queried, either mobile or pc/console
        is_english (bool, optional): whether the metrics should be in English (or Chinese). Defaults to True.

    Returns:
        bi_data (dict): a json in the format listed in this doc: https://doc.weixin.qq.com/doc/w3_AGUAAAaAACcCNAN2q3ftWRhaeLOeB?scode=AJEAIQdfAAoz0Scb8OAWYArgY3AG0
    """

    result = {
        "code": 0,
        "msg": "ok",
        "ext_info": {},
        "system": "dashboard",
        "auto_hide_metric": True
    }
    data_result = {
        "version": "2.0",
        "xAxis": ["dimension"],
        "yAxis": ["value"],
        "chat_type": "trend",
    }

    # invalid data check
    valid_metrics = list(data.keys())
    if not valid_metrics:
        return None, None

    # Build valid_metrics including both metric and metric_percent
    valid_metrics_with_percent = []
    for m in valid_metrics:
        valid_metrics_with_percent.append(m)
        valid_metrics_with_percent.append(m + "_percent")

    all_data = []
    for x in data.values():
        all_data.extend(x)

    # Build metrics_info
    metrics_info = []
    for m in valid_metrics_with_percent:
        metric_name = get_dashboard_metric_info(m.replace("_percent", ""), entity_type).get("metric_name_en" if is_english else "metric_name_cn", m)
        if "_percent" in m:
            metric_name = metric_name + " (%)" if is_english else metric_name + " (%)"
        metrics_info.append({
            "name": metric_name,
            "data_key": m,
            "type": "percent" if "_percent" in m else "numerical",
        })
    data_result["metrics_info"] = metrics_info

    # Build dimension_info
    dimension_info = []
    dimension_info.append(
        {
            "name": "Metric",
            "data_key": "metric_percentage_metric",
            "value": [get_dashboard_metric_info(m.replace("_percent", ""), entity_type).get("metric_name_en" if is_english else "metric_name_cn", m) + (" (%)" if "_percent" in m else "") for m in valid_metrics_with_percent]
        }
    )
    dimensions = set()
    for x in all_data:
        for k in x:
            if k not in valid_metrics_with_percent and k not in dimensions and "_percent" not in k:
                dimensions.add(k)
    for d in dimensions:
        dimension_info.append(
            {
                "name": d,
                "data_key": d,
                "value": list(set([x[d] for x in all_data if d in x])),
            }
        )
    dimensions.add("game_name")
    dimension_info.append(
        {
            "name": "game_name",
            "data_key": "game_name",
            "value": [game_name]
        }
    )
    dimensions.add("game_type")
    dimension_info.append(
        {
            "name": "game_type",
            "data_key": "game_type",
            "value": [entity_type]
        }
    )
    dimensions.add("source")
    dimension_info.append(
        {
            "name": "source",
            "data_key": "source",
            "value": ["dashboard"]
        }
    )
    dimensions.add("granularity")
    dimension_info.append(
        {
            "name": "granularity",
            "data_key": "granularity",
            "value": ["percentage"],
        }
    )
    data_result["dimension_info"] = dimension_info

    # Build legends
    legends = ["game_name"]
    dimensions.discard("game_name")
    for x in all_data:
        for k in x:
            if (
                k not in valid_metrics_with_percent
                and k in dimensions
                and k not in ["game_name", "game_type", "source", "granularity"]
            ):
                legends.append(k)
                dimensions.discard(k)
    data_result["legends"] = legends[::-1]

    # Build filter_info
    filter_info = []
    for d in dimensions:
        filter_info.append(
            {
                "name": d,
                "data_key": d,
                "filter_type": "normal"
            }
        )
    filter_info.append(
        {
            "name": "",
            "data_key": "metric_percentage_metric",
            "filter_type": "cascade",
            "has_metric": True,
            "value": [get_dashboard_metric_info(m.replace("_percent", ""), entity_type).get("metric_name_en" if is_english else "metric_name_cn", m) + (" (%)" if "_percent" in m else "") for m in valid_metrics_with_percent],
            "display_info": ["metric_percentage_metric"],
            "display_value": {get_dashboard_metric_info(m.replace("_percent", ""), entity_type).get("metric_name_en" if is_english else "metric_name_cn", m) + (" (%)" if "_percent" in m else ""): [m] for m in valid_metrics_with_percent}
        }
    )
    data_result["filter_info"] = filter_info

    # Build data_values - create separate rows for metric and metric_percent (similar to realtime pattern)
    data_values = []
    valid_keys = set(y for x in all_data for y in x if any([z.get(y, "") for z in all_data]) and "_percent" not in y)
    for x in data:
        for y in data[x]:
            # Create entry for metric value
            temp1 = {k: y.get(k, "") for k in valid_keys}
            temp1["metric_percentage_metric"] = get_dashboard_metric_info(x, entity_type).get("metric_name_en" if is_english else "metric_name_cn", x)
            temp1["granularity"] = "percentage"
            temp1["game_name"] = game_name
            temp1["game_type"] = entity_type
            temp1["source"] = "dashboard"
            data_values.append(temp1)

            # Create entry for metric_percent value
            temp2 = {k: y.get(k, "") for k in valid_keys if k != x}
            temp2[x + "_percent"] = y.get(x + "_percent", "")
            temp2["metric_percentage_metric"] = get_dashboard_metric_info(x, entity_type).get("metric_name_en" if is_english else "metric_name_cn", x) + " (%)"
            temp2["granularity"] = "percentage"
            temp2["game_name"] = game_name
            temp2["game_type"] = entity_type
            temp2["source"] = "dashboard"
            data_values.append(temp2)
    data_result["data"] = data_values

    result["data"] = data_result
    data_id = "DashboardAgent_" + str(uuid.uuid4())
    result["data_id"] = data_id

    return result, data_id


def update_metric_mapping_for_new_metrics(new_metrics, game_type, metric_code_to_name_mapping):
    """
    Update metric_code_to_name_mapping when new metrics are added.
    
    Args:
        new_metrics (list): List of new metric codes to add
        game_type (str): Game type (mobile or pc/console)
        metric_code_to_name_mapping (dict): Current mapping dictionary to update
    
    Returns:
        dict: Updated metric_code_to_name_mapping
    """
    for metric_code in new_metrics:
        if metric_code not in metric_code_to_name_mapping:
            # Find the corresponding name for this metric code
            for name, code in DASHBOARD_METRIC_NAME_CODE_MAPPING_BY_TYPE[game_type].items():
                if code == metric_code:
                    metric_code_to_name_mapping[metric_code] = name
                    break
            else:
                # If no mapping found, use the metric code as the name
                metric_code_to_name_mapping[metric_code] = metric_code
    
    return metric_code_to_name_mapping


def apply_metric_code_to_name_mapping(data, metric_code_to_name_mapping):
    """
    Apply metric code to name mapping to data structures.
    
    Args:   
        data: The data structure (dict or list of dicts)
        metric_code_to_name_mapping: Dictionary mapping metric codes to names
    
    Returns:
        The data with metric codes replaced by names
    """
    if not data or not metric_code_to_name_mapping:
        return data
    
    if isinstance(data, list):
        # Handle list of dictionaries (metric_value format)
        mapped_data = []
        for item in data:
            mapped_item = {}
            for key, value in item.items():
                if key in metric_code_to_name_mapping:
                    mapped_item[metric_code_to_name_mapping[key]] = value
                else:
                    mapped_item[key] = value
            mapped_data.append(mapped_item)
        return mapped_data
    
    elif isinstance(data, dict):
        # Handle dictionary format
        # For realtime data: dict where keys are metric codes, values are lists of dicts
        # Need to map both the top-level keys and the keys inside the list items
        mapped_data = {}
        for key, value in data.items():
            # Map the top-level key (metric code to name)
            mapped_key = metric_code_to_name_mapping.get(key, key)
            
            # If value is a list, recursively map keys inside each dict item
            if isinstance(value, list):
                mapped_value = []
                for item in value:
                    if isinstance(item, dict):
                        mapped_item = {}
                        for item_key, item_value in item.items():
                            # Map keys inside the dict items (e.g., _dod, _dod_count variants)
                            if item_key in metric_code_to_name_mapping:
                                mapped_item[metric_code_to_name_mapping[item_key]] = item_value
                            else:
                                mapped_item[item_key] = item_value
                        mapped_value.append(mapped_item)
                    else:
                        mapped_value.append(item)
                mapped_data[mapped_key] = mapped_value
            else:
                mapped_data[mapped_key] = value
        return mapped_data
    
    return data


def remove_redundant_metric(data, redundant_metric_names):
    """
    Apply metric code to name mapping to data structures.

    Args:
        data: The data structure (dict or list of dicts)
        metric_code_to_name_mapping: Dictionary mapping metric codes to names

    Returns:
        The data with metric codes replaced by names
    """
    if not data or not redundant_metric_names:
        return data

    if isinstance(data, list):
        # Handle list of dictionaries (metric_value format)
        mapped_data = []
        for item in data:
            mapped_item = {key:value for key,value in item.items() if key not in redundant_metric_names}
            mapped_data.append(mapped_item)
        return mapped_data

    elif isinstance(data, dict):
        # Handle dictionary format
        # For realtime data: dict where keys are metric codes, values are lists of dicts
        # Need to map both the top-level keys and the keys inside the list items
        mapped_data = {}
        for key, value in data.items():
            # If value is a list, recursively map keys inside each dict item
            if isinstance(value, list):
                mapped_value = []
                for item in value:
                    if isinstance(item, dict):
                        mapped_item = {key:value for key,value in item.items() if key not in redundant_metric_names}
                        mapped_value.append(mapped_item)
                    else:
                        mapped_value.append(item)
                mapped_data[key] = mapped_value
            else:
                mapped_data[key] = value
        return mapped_data

    return data
