import pandas as pd
import uuid
import json
import re
from run_context_wrapper import RunContextWrapper
from opinion_tools.tool_common import get_tool_enabled, function_tool
from opinion_strategy.constants import ToolName
from opinion_utils.helper import websearch_fallback_with_rewrite_error_function
from opinion_tools.opinion.utils.utils import truncate_output
from opinion_tools.opinion.utils.metric_kb_injector import inject_metric_kb
from opinion_strategy.context import GameContext, BiDataCsvEntry
from typing import List, Optional, Dict, Any
from loguru import logger
from datetime import datetime, timedelta, timezone
from dateutil import parser
from opinion_tools.opinion.utils.cube_helper import get_cube_client
from opinion_tools.opinion.utils.top_dimension_helper import get_top_dimensions
from opinion_tools.opinion.opinion_tools import _ensure_game_ids

from opinion_utils.df_sampler import DataFrameSampler

from opinion_tools.cube.cube_tools import read_cube_data
from opinion_tools.cube.transformers import DataTransformer
from opinion_tools.opinion.data.language_map import map_languages_to_steam, map_languages_to_iso
from opinion_tools.opinion.data.country_language_map import map_countries_to_iso_languages
from opinion_tools.opinion.utils.steam_reviews_helper import get_steam_reviews as _get_steam_reviews
from opinion_tools.opinion.utils.param_validator import ParamValidator, ParamValidationError
from opinion_tools.cube.cube_model import Query, Filter as CubeFilter, TimeDimension
from opinion_utils.exceptions import NoResultException
from opinion_tools.opinion.utils.query_optimizer import QueryOptimizer


# ---- Allowed Enumerations / 允许的枚举值 ----
ALLOWED_METRICS: set[str] = {"score", "review_count", "positive_reviews_count", "negative_reviews_count"}
ALLOWED_PERIODS: set[str] = {"cumulative", "incremental"}
ALLOWED_GROUP_BY: set[str] = {"language", "country", "region", "date", "game"}  # 统一维度命名(由路由层映射到具体字段)
ALLOWED_ORDER_BY: set[str] = {"score", "review_count", "positive_reviews_count", "negative_reviews_count"}  # 统一维度命名(由路由层映射到具体字段)
ALLOWED_PLATFORMS: set[str] = {"steam", "app_store", "google_play"}
ALLOWED_GRANULARITY: set[str] = {"hour", "day", "week", "month", "aggregate"}

@function_tool(
    failure_error_function=websearch_fallback_with_rewrite_error_function,
    description_override="""
Query game score (positive rate) and store review count across platforms.(查询游戏商店评分/好评率与商店评论数等舆情表现)

WHEN TO USE: 
- Use this tool for any query about game store review scores, positive rates, or store review counts on Steam/AppStore/Google Play. Includes: new/incremental reviews (新增评论/今日新增评论/今天的评论), cumulative score trends, per-language/country score distribution, real-time score changes. e.g., "今天Steam新增评论多吗？反馈如何？", "游戏好评率变化如何？", "AppStore分国家评分".

Args:
- game_names: List of game names to query. For multiple games, always pass ALL game names in one call instead of making separate calls
- metrics: List of metrics, multiple values allowed. Supported values: score (game rating, positive rate, 评分/好评率), review_count (store reviews)
- period: Metric scope (required, single-select). cumulative = cumulative lifetime snapshot历史累计评论的表现,incremental = added reviews新增评论的表现
- start_date, end_date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS): Time range to query, consider user question, game release date, and today's date to select the appropriate time.
- granularity: Time granularity of results. Supported values: hour | day | week | month
  - hour | day | week | month: return time series data
  - Select granularity based on the queried time range and the user’s intent:  >180d → month; 60–180d → week; <60d → day; <1d → hour.
- platform: Platform enums; ["steam", "app_store", "google_play"]. Only select platforms that you know the game is released on. PC - steam, Mobile - app_store/google_play.
- filters: When users ask for the score of a specific language, country, use ISO standard code
 - review_language: List of ISO language codes (examples: ["zh"], ["en", "zh-hant"], ["ru", "pt"])
 - review_country: List of ISO country codes (examples: ["us"], ["cn", "jp"], ["uk", "kr"])
 - review_region: List of region names. Examples: ["China(HK,MO,TW)"], ["North America", "Europe"]
- group_by: List of dimensions for grouping. enum: [language, country, region, game]. Examples: ["language"], ["country"], ["game"]. Use group_by only for comparison query. For score of specific language, country, region, use filters instead.

Examples:
- Latest/Recent/Realtime/最近/近期/今天: call [period=cumulative, granularity=day] for score trend and summarize the latest day's data as overall score and reviews,
- Only use [period=incremental] when users ask for the 新增/每日 in a specific time range, otherwise use [period=cumulative] for life time aggregated score and reviews.

RULES:
- When period=cumulative: granularity must be day/week/month; hour is not allowed.
- app_store / google_play: language is not allowed as a dimension/filter; use review_countries, review_regions instead.
- steam cumulative data: country/region is not allowed; use review_languages instead. Example: when users ask for the score of "中国区", "国区" → review_languages="zh"
""",
    is_enabled=get_tool_enabled(ToolName.GetGameScore.value),
    readable_name_map={
        "English": "Game Store Score Tool",
        "Chinese": "游戏商店评分工具",
    }
)
async def get_game_score(
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    metrics: Optional[List[str]] = None,
    period: str = "cumulative",
    start_date: str = "",      # YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS
    end_date: str = "",        # 同上
    granularity: Optional[str] = None,
    platform: Optional[str] = None,
    review_language: Optional[List[str]] = None,              # 语言：zh/zh-hant/en/...(由路由映射 language_code)
    review_country: Optional[List[str]] = None,
    review_region: Optional[List[str]] = None,
    group_by: Optional[List[str]] = None,              # none→[]；或 ["language"] / ["country"] / ["region"] / ["date"]
) -> Dict[str, Any]:
    """
    Get opinion summary report for games. Select the best strategy based on data availability.
    
    Args:
        game_names: List of game names to query
        metrics: List of metrics, multiple values allowed. example: [score, review_count]
        period: Metric scope (required, single-select). enum: [cumulative, incremental]
        start_date: Start date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)
        end_date: End date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)
        granularity: Time granularity of results. enum: [hour, day, week, month]
        platform: Platform enum: [steam, app_store, google_play]. Only select platform that you know the game is released on. PC - steam, Mobile - app_store/google_play.
        review_language: List of ISO language codes, enums: [en, zh, zh-hant, ja, ko, tr, ru, de, fr]
        review_country: List of ISO country codes, enums: [us,uk,kr,jp,kr,ma,jp,bo,pk,tw,sa,ly,iq,fi,tr,ye,my,sg,np,ph,etc]
        review_region:List of region names, enums: [Africa,China(HK,MO,TW),Europe,India,Japan,Middle East,North America,Oceania,Other Asia,South America,South Korea,Southeast Asia]
        group_by: List of dimensions for grouping. enum: [language, country, region, game]. Use group_by only for comparison query. For score of specific language, country, region, use filters instead.
    """
    #检查参数是否存在,兜底默认值
    #检查platform,路由到不同的平台函数处理
    #根据不同的平台检查参数是否合规,部分参数有平台限制
    #参数兜底,针对不同平台进行兜底
    #mapping参数,部分参数映射规则
    #查询数据,根据不同的平台查询数据
    #返回数据,无数据情况的websearch兜底
    #reference处理

    try:
        validation_messages = []  # 收集所有的参数调整信息
        # ---------- 基础兜底,处理空值与参数验证 ----------
        beijing_tz = timezone(timedelta(hours=8))
        now = datetime.now(beijing_tz)
        user_language = getattr(context.context, "language", None) or "English"

        # 从context中获取game_ids，如果为空则使用entity_ids
        requested_game_ids: List[str] = await _ensure_game_ids(context, game_names)
    
        if not requested_game_ids:
            validation_messages.append(f"未能获取到游戏ID，")
        # 兜底矫正 game_ids（若工具提供了纠偏映射）

        # 验证并设置metrics默认值
        req_metrics = ParamValidator.validate_string_list(
            metrics, ALLOWED_METRICS, ["score", "review_count"], "metrics", validation_messages
        )

        # 验证并设置period默认值
        req_period = ParamValidator.validate_string(
            period, ALLOWED_PERIODS, "cumulative", "period", validation_messages
        )

        # 验证并设置platform默认值
        req_platform = ParamValidator.validate_string(
            platform, ALLOWED_PLATFORMS, "steam", "platform", validation_messages
        )

        # 验证并设置group_by默认值
        group_by = ParamValidator.validate_string_list(
            group_by, ALLOWED_GROUP_BY, [], "group_by", validation_messages
        )

        # # 验证并设置order_by默认值
        # order_by = ParamValidator.validate_string_list(
        #     order_by, ALLOWED_ORDER_BY, [], "order_by", validation_messages
        # )
        order_by = []

        # 验证并设置granularity默认值
        granularity = ParamValidator.validate_string(
            granularity, ALLOWED_GRANULARITY, "day", "granularity", validation_messages
        )

        # 使用ParamValidator生成时间范围
        date_range = ParamValidator.generate_time_range(
            start_date, end_date, granularity, "date_range", validation_messages, beijing_tz
        )

        # 验证并设置languages, countries, regions默认值
        language_filters = ParamValidator.validate_string_list(
            review_language, None, [], "language_filters", validation_messages, transform_func=str.lower
        )

        country_filters = ParamValidator.validate_string_list(
            review_country, None, [], "country_filters", validation_messages, transform_func=str.lower
        )

        region_filters = ParamValidator.validate_string_list(
            review_region, None, [], "region_filters", validation_messages
        )

        # ---------- 表与字段规则校验与过滤 ----------
        # 规则1: Google Play的review_count不支持country维度
        if req_platform == "google_play" and "review_count" in req_metrics:
            if ("country" in group_by) or country_filters:
                # 从group_by中移除country
                if "country" in group_by:
                    group_by = [g for g in group_by if g != "country"]
                    validation_messages.append("Google Play的review_count不支持country维度拆分，已从group_by中移除country")

        # 规则2: Steam和Feeds不支持country/region维度，映射到语言维度
        if  (region_filters or country_filters or "country" in group_by or "region" in group_by) and (req_platform == "steam" or req_period == "incremental"):
            try:
                mapped_langs = map_countries_to_iso_languages(country_filters)
                if mapped_langs:
                    language_filters = sorted(list({*(language_filters or []), *mapped_langs}))
                    validation_messages.append(f"Steam评分不支持按国家查询，已映射为语言过滤: {mapped_langs}")
                if "country" in group_by or "region" in group_by:
                    group_by = [g for g in group_by if g not in ["country", "region"]]
                    group_by = ["language"]
                    validation_messages.append("Steam/Feeds 不支持group_by , 已映射到语言维度 group_by=language")
            except Exception as e:
                logger.debug(f"国家到语言映射兜底失败: {e}")

            # 清空不支持的过滤条件和维度
            original_group_by = group_by.copy()
            group_by = [g for g in group_by if g not in ["country", "region"]]
            removed_dimensions = [g for g in original_group_by if g not in group_by]
            if removed_dimensions:
                validation_messages.append(f"Steam和Incremental不支持{'/'.join(removed_dimensions)}维度，已移除")
            if country_filters:
                country_filters = []
                validation_messages.append("Feeds平台不支持country过滤，已清空countries参数")
            if region_filters:
                region_filters = []
                validation_messages.append("Feeds平台不支持region过滤，已清空regions参数")

        # 规则3: 日期范围驱动的时间粒度强制调整（aggregate 不参与自动调整）
        try:
            if isinstance(date_range, list) and len(date_range) == 2:
                start_dt = parser.parse(date_range[0])
                end_dt = parser.parse(date_range[1])
                delta = end_dt - start_dt
                delta_days = delta.days
                if granularity != "aggregate":
                    # 仅 incremental 支持小时粒度；cumulative 强制回落为 day
                    if req_period == "cumulative" and granularity == "hour":
                        granularity = "day"
                    if delta_days >= 180:
                        granularity = "month"
                    # elif delta.total_seconds() < 24 * 3600:
                    #     granularity = "hour"

        except Exception as e:
            logger.debug(f"日期粒度规则调整失败，保持原值: {e}")

        # 规则4: 扩展时间范围以确保足够的数据点（使用QueryOptimizer）
        optimizer = QueryOptimizer(min_data_points=3)
        date_range, was_expanded = optimizer.optimize_time_range(
            date_range, granularity, validation_messages
        )

        cube_client = get_cube_client()
        transformer = DataTransformer()

        # ---------- 子查询构建 ----------

        # ---------- 新的 Query 生成函数（只返回 Query，不执行查询） ----------
        def _ensure_game_name_dimension(dimensions_list: List[str], field_name: str) -> List[str]:
            if field_name not in dimensions_list:
                dimensions_list.append(field_name)
            return dimensions_list

        def build_steam_cumulative_by_language_query() -> Query:
            measures: List[str] = []
            if "score" in req_metrics:
                measures.append("steam_score_by_language.positive_rate_by_language")
            if "review_count" in req_metrics:
                measures.append("steam_score_by_language.total_reviews_by_language")
            if "positive_reviews_count" in req_metrics:
                measures.append("steam_score_by_language.positive_reviews_by_language")
            if "negative_reviews_count" in req_metrics:
                measures.append("steam_score_by_language.negative_reviews_by_language")
            if not measures:
                measures = [
                    "steam_score_by_language.positive_rate_by_language",
                    "steam_score_by_language.total_reviews_by_language",
                ]
            dimensions_list: List[str] = ["steam_score_by_language.language"]
            dimensions_list = _ensure_game_name_dimension(
                dimensions_list, "steam_score_by_language.game_name"
            )
            filters_list: List[CubeFilter] = [CubeFilter(member="steam_score_by_language.game_id", operator="equals", values=requested_game_ids)]
            if language_filters:
                iso_codes, steam_lang_values = map_languages_to_steam(language_filters)
                if steam_lang_values:
                    filters_list.append(CubeFilter(member="steam_score_by_language.language", operator="equals", values=steam_lang_values))
            if granularity == "aggregate":
                td = TimeDimension(dimension="steam_score_by_language.date", dateRange=date_range)
            else:
                td = TimeDimension(dimension="steam_score_by_language.date", granularity=granularity, dateRange=date_range)
            order = {}
            if "review_count" in order_by:
                order = {"steam_score_by_language.total_reviews_by_language": "desc"}
            elif "score" in order_by:
                order = {"steam_score_by_language.positive_rate_by_language": "desc"}
            q = Query(
                measures=measures,
                dimensions=dimensions_list,
                timeDimensions=[td],
                filters=filters_list,
                order= order,
            )
            # 显式指定图例为语言，避免维度顺序不稳定导致legend错位
            q.legends = "steam_score_by_language.language"
            return q

        def build_steam_cumulative_query() -> Query:
            measures: List[str] = []
            if "score" in req_metrics:
                measures.append("steam_score.all_reviews_positive_rate")
                measures.append("steam_score.recent_reviews_positive_rate")
                validation_messages.append(f"recent_reviews_positive_rate: Steam Metric, 30-day windowed positive rate")
            if "review_count" in req_metrics:
                measures.append("steam_score.all_reviews_count")
                measures.append("steam_score.recent_reviews_count")
                validation_messages.append(f"recent_reviews_count: Steam Metric, 30-day windowed review count")
            if not measures:
                measures = [
                    "steam_score.all_reviews_positive_rate",
                    "steam_score.all_reviews_count",
                ]
            if "positive_reviews_count" in req_metrics:
                measures.append("steam_score.positive_reviews_count")
            if "negative_reviews_count" in req_metrics:
                measures.append("steam_score.negative_reviews_count")
            dims: List[str] = []
            dims = _ensure_game_name_dimension(dims, "steam_score.game_name")
            filters_list: List[CubeFilter] = [CubeFilter(member="steam_score.game_id", operator="equals", values=requested_game_ids)]
            if granularity == "aggregate":
                td = TimeDimension(dimension="steam_score.date", dateRange=date_range)
            else:
                td = TimeDimension(dimension="steam_score.date", granularity=granularity, dateRange=date_range)
            order = {}
            if "review_count" in order_by:
                order = {"steam_score.all_reviews_count": "desc"}
            elif "score" in order_by:
                order = {"steam_score.all_reviews_positive_rate": "desc"}
            q = Query(
                measures=measures,
                dimensions=dims,
                timeDimensions=[td],
                filters=filters_list,
                order= order,
            )
            return q

        def build_app_store_cumulative_query() -> Query:
            measures: List[str] = []
            if "score" in req_metrics:
                measures.append("appstore_score.score")
            if "review_count" in req_metrics:
                measures.append("appstore_score.all_reviews_count")
            if not measures:
                measures = ["appstore_score.score", "appstore_score.all_reviews_count"]
            dimensions_list: List[str] = []
            if "country" in group_by:
                dimensions_list.append("appstore_score.country_zh" if user_language == "Chinese" else "appstore_score.country_en")
            dimensions_list = _ensure_game_name_dimension(
                dimensions_list, "appstore_score.game_name"
            )
            filters_list: List[CubeFilter] = [CubeFilter(member="appstore_score.game_id", operator="equals", values=requested_game_ids)]
            if country_filters:
                filters_list.append(CubeFilter(member="appstore_score.country_code", operator="equals", values=country_filters))
            if granularity == "aggregate":
                td = TimeDimension(dimension="appstore_score.date", dateRange=date_range)
            else:
                td = TimeDimension(dimension="appstore_score.date", granularity=granularity, dateRange=date_range)
            order = {}
            if "review_count" in order_by:
                order = {"appstore_score.all_reviews_count": "desc"}
            elif "score" in order_by:
                order = {"appstore_score.score": "desc"}
            q = Query(
                measures=measures,
                dimensions=dimensions_list,
                timeDimensions=[td],
                filters=filters_list,
                order= order,
            )
            return q

        def build_google_play_cumulative_query() -> Query:
            measures: List[str] = []
            if "score" in req_metrics:
                measures.append("googleplay_score.score")
            if "review_count" in req_metrics:
                measures.append("googleplay_score.all_reviews_count")
            if not measures:
                measures = ["googleplay_score.score", "googleplay_score.all_reviews_count"]
            dimensions_list: List[str] = []
            if "country" in group_by:
                dimensions_list.append("googleplay_score.country_zh" if user_language == "Chinese" else "googleplay_score.country_en")
            if "region" in group_by:
                dimensions_list.append("googleplay_score.region_zh" if user_language == "Chinese" else "googleplay_score.region_en")
            dimensions_list = _ensure_game_name_dimension(
                dimensions_list, "googleplay_score.game_name"
            )
            filters_list: List[CubeFilter] = [CubeFilter(member="googleplay_score.game_id", operator="equals", values=requested_game_ids)]
            if country_filters:
                filters_list.append(CubeFilter(member="googleplay_score.country_code", operator="equals", values=country_filters))
            if granularity == "aggregate":
                td = TimeDimension(dimension="googleplay_score.date", dateRange=date_range)
            else:
                td = TimeDimension(dimension="googleplay_score.date", granularity=granularity, dateRange=date_range)
            order = {}
            if "score" in order_by:
                order = {"googleplay_score.score": "desc"}
            q = Query(
                measures=measures,
                dimensions=dimensions_list,
                timeDimensions=[td],
                filters=filters_list,
                order= order,
            )
            return q

        def build_feeds_incremental_query() -> Query:
            start_dt = datetime.fromisoformat(date_range[0] + (" 00:00:00" if len(date_range[0]) == 10 else ""))
            end_dt = datetime.fromisoformat(date_range[1] + (" 23:59:59" if len(date_range[1]) == 10 else ""))
            delta = end_dt - start_dt
            # 当需要小时级别时，确保传递完整的 ISO 日期时间范围
            time_range = date_range
            if granularity == "hour" or delta.total_seconds() < 86400:
                gran = "hour"
                time_range = [
                    start_dt.strftime('%Y-%m-%dT%H:%M:%S'),
                    end_dt.strftime('%Y-%m-%dT%H:%M:%S')
                ]
            else:
                gran = granularity
            measures: List[str] = []
            if "score" in req_metrics:
                if req_platform == "steam":
                    measures.append("feeds.steam_recommend_rate")
                elif req_platform in ("app_store", "google_play"):
                    measures.append("feeds.avg_mobile_rating")
            if "review_count" in req_metrics:
                measures.append("feeds.game_store_reviews")
            if not measures:
                measures = ["feeds.game_store_reviews", "feeds.avg_mobile_rating"]
            dimensions_list: List[str] = []
            if "language" in group_by:
                dimensions_list.append("feeds.language_zh" if user_language == "Chinese" else "feeds.language_en")
            dimensions_list = _ensure_game_name_dimension(
                dimensions_list, "feeds.game_name"
            )
            filters_list: List[CubeFilter] = [CubeFilter(member="feeds.game_id", operator="equals", values=requested_game_ids)]
            # 渠道筛选: 根据所选平台映射到 feeds.channel_code（单平台）
            if req_platform == "steam":
                filters_list.append(CubeFilter(member="feeds.channel_code", operator="equals", values=["steam"]))
            elif req_platform == "app_store":
                filters_list.append(CubeFilter(member="feeds.channel_code", operator="equals", values=["app store"]))
            elif req_platform == "google_play":
                filters_list.append(CubeFilter(member="feeds.channel_code", operator="equals", values=["google play"]))
            if language_filters:
                iso_codes = map_languages_to_iso(language_filters)
                if iso_codes:
                    filters_list.append(CubeFilter(member="feeds.language_code", operator="equals", values=iso_codes))
            if granularity == "aggregate":
                td = TimeDimension(dimension="feeds.date", dateRange=time_range)
            else:
                td = TimeDimension(dimension="feeds.date", granularity=gran, dateRange=time_range)
            order = {}
            if "review_count" in order_by:
                order = {"feeds.game_store_reviews": "desc"}
            elif "score" in order_by:
                order = {"feeds.avg_mobile_rating": "desc"}
            q = Query(
                measures=measures,
                dimensions=dimensions_list,
                timeDimensions=[td],
                filters=filters_list,
                order= order,
            )
            return q

        # ---------- 统一选择 Query 构造器并执行 read_cube_data ----------
        def pick_query_builder() -> Query:
            # steam + 按语言拆分
            if req_period == "cumulative" and (("language" in group_by) or language_filters):
                return build_steam_cumulative_by_language_query()
            if req_period == "cumulative" and req_platform == "steam":
                return build_steam_cumulative_query()
            if req_period == "cumulative" and req_platform == "app_store":
                return build_app_store_cumulative_query()
            if req_period == "cumulative" and req_platform == "google_play":
                return build_google_play_cumulative_query()
            if req_period == "incremental":
                return build_feeds_incremental_query()
            # fallback（不应到达）
            return build_steam_cumulative_query()
        query = pick_query_builder()

        # ---------- 通用函数：补充常量维度 ----------
        def _append_dimension_to_result(
            data_obj: Dict[str, Any],
            dim_key: str,
            dim_name: str,
            dim_value: str,
        ) -> None:
            if not isinstance(data_obj, dict):
                return
            code = data_obj.get("code")
            if code == 0 and isinstance(data_obj.get("data"), dict):
                chart_data = data_obj["data"]
                for row in chart_data.get("data", []):
                    row[dim_key] = dim_value
                dimension_info = chart_data.get("dimension_info", [])
                for dim in dimension_info:
                    if dim.get("data_key") == dim_key:
                        values = dim.get("value", [])
                        if dim_value not in values:
                            values.append(dim_value)
                        dim["value"] = values
                        break
                else:
                    dimension_info.append({
                        "name": dim_name,
                        "data_key": dim_key,
                        "value": [dim_value],
                    })
                chart_data["dimension_info"] = dimension_info
            elif code == 2 and isinstance(data_obj.get("data"), list):
                for row in data_obj["data"]:
                    row[dim_key] = dim_value

        # legends 逻辑交给 DataTransformer 处理（未显式设置时取第一个维度）
        # 当 query.dimensions 含有任一国家/语言/渠道维度，且未在 filters 中指定对应维度时，为该维度自动获取 Top N 并作为过滤条件
        try:
            channel_suffixes = {'.channel_code', '.channel_dispaly_name'}
            country_suffixes = {'.country_code', '.country_en', '.country_zh'}
            language_suffixes = {'.language_code',
                                '.language_en', '.language_zh', '.language'}
            topic_suffixes = {'.topic', '.topic_zh'}
            game_suffixes = {'.game_id', '.game_name'}

            def _get_family(field: str) -> str | None:
                lower = (field or '').lower()
                if any(lower.endswith(s) for s in channel_suffixes):
                    return 'channel'
                if any(lower.endswith(s) for s in country_suffixes):
                    return 'country'
                if any(lower.endswith(s) for s in language_suffixes):
                    return 'language'
                if any(lower.endswith(s) for s in topic_suffixes):
                    return 'topic'
                if any(lower.endswith(s) for s in game_suffixes):
                    return 'game'
                return None

            # 收集TopN说明，供结果返回时展示
            topn_explanations: List[str] = []

            def _is_target_dimension(field: str) -> bool:
                return _get_family(field) in {'channel', 'country', 'language', 'topic', 'game'}

            def _has_family_filter(filters_list: List[Any], family: str) -> bool:
                if not filters_list:
                    return False
                family_suffixes = {
                    'channel': channel_suffixes,
                    'country': country_suffixes,
                    'language': language_suffixes,
                    'topic': topic_suffixes,
                    'game': game_suffixes,
                }.get(family, set())
                for f in filters_list:
                    try:
                        member = getattr(f, 'member', None)
                        if member is None and isinstance(f, dict):
                            member = f.get('member')
                        if not member:
                            continue
                        lower = member.lower()
                        if any(lower.endswith(s) for s in family_suffixes):
                            return True
                    except Exception:
                        continue
                return False

            if hasattr(query, 'dimensions') and query.dimensions:
                for dimension_field in list(query.dimensions):
                    if not _is_target_dimension(dimension_field):
                        continue
                    family = _get_family(dimension_field)
                    if _has_family_filter(getattr(query, 'filters', None), family):
                        # 已存在该家族的具体过滤（如 channel_code 或 channel_dispaly_name），跳过 TopN
                        continue
                    # 计算本次TopN数量（与调用参数保持一致）
                    used_top_n = query.limit if (
                        getattr(query, 'limit', None) is not None and query.limit <= 10) else 10

                    top_values = await get_top_dimensions(
                        context,
                        query,
                        target_dimension=dimension_field,
                        top_n=used_top_n
                    )
                    if top_values:

                        # 如果目标维度是 game_id，则需要将 game_id 替换为 game_name
                        # 如果目标维度是 game_name，直接创建 game_id 的 filter
                        filter_member = dimension_field
                        if dimension_field.endswith('.game_name'):
                            filter_member = dimension_field.replace(
                                '.game_name', '.game_id')
                            logger.info(
                                f"【read_data】为 game_name 维度创建 game_id filter: {filter_member}")

                        new_filter = CubeFilter(
                            member=filter_member,
                            operator='equals',
                            values=top_values
                        )
                        if hasattr(query, 'filters') and query.filters:
                            query.filters.append(new_filter)
                        else:
                            query.filters = [new_filter]
                        logger.info(
                            f"【read_data】为维度 {dimension_field} 自动添加 Top 过滤，数量: {len(top_values)}")
                        # 增加用户可读的说明
                        topn_explanations.append(f"查询Top {used_top_n} 数据")
        except Exception as e:
            logger.warning(f"【read_data】自动为目标维度添加 Top 过滤失败: {e}")
        logger.debug(f"[get_game_score] Final Query => {query.model_dump(by_alias=True, exclude_none=True)}")
        data = await read_cube_data(cube_client, transformer, query, language=user_language)

        # 补充平台维度（常量）
        platform_display = {
            "app_store": "App Store",
            "google_play": "Google Play",
            "steam": "Steam",
        }.get(req_platform, req_platform)
        dim_name = "平台" if user_language == "Chinese" else "Platform"
        _append_dimension_to_result(data, "platform", dim_name, platform_display)

        # 如果code为0，使用QueryOptimizer检查数据点质量并决定是否分配data_id
        if data.get("code") == 0:
            optimizer.check_data_quality(
                data,
                data_id_prefix="opinion_cube",
                system_name="opinion",
                validation_messages=validation_messages
            )
            # Store full CSV for Analyst Agent sandbox
            try:
                raw_rows = data.get("data") and data["data"].get("data")
                if isinstance(raw_rows, list) and raw_rows and data.get("data_id"):
                    full_csv = pd.DataFrame(raw_rows).to_csv(index=False)
                    context.context.bi_data_for_sandbox.append(BiDataCsvEntry(data_id=data["data_id"], full_csv=full_csv))
            except Exception as e:
                logger.warning(f"[score_tool] Failed to append full CSV to bi_data_for_sandbox: {e}")
            context.context.data.append(data)

        # 如果code为1，则抛出异常或NoResultException进行网络搜索
        if data.get("code") not in [0, 2]:
            steam_data_text = ""
            if req_platform == "steam":
                # 获取游戏的基础ID（去除平台后缀）
                base_game_ids = [re.sub(r"_(pc|console|mobile|combine)$", "", game_id) for game_id in requested_game_ids]
                token = getattr(context.context, 'token', None)

                # 获取steam数据并添加到context，然后进行网络搜索
                try:
                    data_steam_reviews = await _get_steam_reviews(base_game_ids, message_id=context.context.message_id, token=token)
                    if data_steam_reviews:
                        full_csv = pd.DataFrame(data_steam_reviews).to_csv(index=False)
                        result = {
                            "data": truncate_output(full_csv),
                            "data_id": f"opinion_cube_{uuid.uuid4()}",
                            "system": "opinion",
                        }
                        if result.get("data_id") and full_csv:
                            context.context.bi_data_for_sandbox.append(BiDataCsvEntry(data_id=result["data_id"], full_csv=full_csv))
                        context.context.data.append(result)
                        # 将Steam数据格式化为文本，以便在NoResultException的message中包含
                        steam_data_text = f"Steam平台评分查询结果:{json.dumps(data_steam_reviews, ensure_ascii=False, indent=2)}"
                except Exception as e:
                    logger.warning(f"获取Steam数据失败: {e}")
                    # 进行网络搜索（Steam数据已添加到context中）
            raise NoResultException(
                message = f"DataBrain未能找到游戏 {context.context.game_names} 的全部舆情数据，尝试结合联网结果给出回答。{steam_data_text}",
                search_query=context.context.planner_context.rephrased_question,
                use_web_search=True,
            )

        # 转成csv格式以减少token
        if data.get("code") == 0:
            df = pd.DataFrame(data["data"]["data"])

            # 新增采样功能
            if len(df) > 5000:  # 只有当数据量超过5000时才进行采样
                try:
                    # 获取分组字段和指标字段
                    dimension_info = data["data"].get("dimension_info", [])
                    metrics_info = data["data"].get("metrics_info", [])

                    group_by_fields = [d["data_key"] for d in dimension_info if d.get("data_key") != "date"]
                    metrics = [m["data_key"] for m in metrics_info if m.get("data_key")]

                    # 执行采样
                    sampler = DataFrameSampler(df)
                    sampled_df = sampler.head_tail(
                        group_by_fields=group_by_fields,
                        keep_count=2000,
                        head_tail_count=7,
                        peak_valley_count=3,
                        metrics=metrics,
                        auto_plot=False
                    )
                    logger.info(f"【read_data】数据采样完成：原始数据量 {len(data['data']['data'])} -> 采样后 {len(sampled_df)}")

                    # 生成数据描述信息
                    data_description = validation_messages

                    # 构建返回结果
                    result = {
                        "data" : {
                            "Sample Data in CSV format": truncate_output(sampled_df.to_csv(index=False)),
                            "Data Statistics": data_description
                        },
                        "data_id": data.get("data_id"),
                        "system": data.get("system")
                    }

                    # 如果有字段修改信息，添加到返回结果中
                    if validation_messages:
                        result["field_modifications"] = validation_messages

                    # 如果自动应用了TopN维度过滤，追加说明
                    # if 'topn_explanations' in locals() and topn_explanations:
                    #     result.setdefault("notes", []).extend(topn_explanations)

                    inject_metric_kb(getattr(query, "measures", None), result)
                    return result
                except Exception as e:
                    logger.warning(f"【read_data】采样失败，使用原始数据: {e}")

            # 构建返回结果
            result = {
                "data": truncate_output(df.to_csv(index=False)),
                "data_id": data.get("data_id"),
                "system": data.get("system"),
            }

            # 如果有字段修改信息，添加到返回结果中
            if validation_messages:
                result["field_modifications"] = validation_messages

            # 如果自动应用了TopN维度过滤，追加说明
            # if 'topn_explanations' in locals() and topn_explanations:
            #     result.setdefault("notes", []).extend(topn_explanations)

            inject_metric_kb(getattr(query, "measures", None), result)
            return result

        return truncate_output(data)

    except ParamValidationError as e:
        # 参数验证错误，转换为NoResultException并包含具体的错误信息
        logger.warning(f"参数验证失败: {e}")
        raise NoResultException(
            message=f"{str(e)}通过网络搜索获取结果",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )
    except Exception as e:
        logger.warning(f"get_game_score失败: {e}")
        # 进行网络搜索（Steam数据已添加到context中）
        raise NoResultException(
            message = f"未能找到游戏 {context.context.game_names} 的评分数据，尝试结合联网结果给出回答。",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )
