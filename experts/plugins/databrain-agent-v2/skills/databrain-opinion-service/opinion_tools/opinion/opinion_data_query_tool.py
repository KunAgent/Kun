from run_context_wrapper import RunContextWrapper
from loguru import logger
import pandas as pd
from typing import Any, Dict, List, Optional
import json
import uuid
import re
import time
from contextvars import ContextVar
from dateutil import parser

from opinion_tools.cube.cube_model import TimeDimension, Filter
from datetime import datetime, timedelta, timezone
from opinion_strategy.context import GameContext, BiDataCsvEntry
from opinion_strategy.constants import ToolName
from opinion_tools.opinion.utils.utils import truncate_output, validate_query_fields, check_table_has_date_field, validate_feeds_performance, calculate_dynamic_limit
from opinion_tools.cube.cube_model import Query
from opinion_tools.cube.cube_tools import read_cube_data
from datetime import datetime
from opinion_tools.cube.transformers import DataTransformer
from opinion_tools.tool_common import get_tool_enabled, function_tool
from opinion_utils.helper import websearch_fallback_with_rewrite_error_function
from opinion_utils.df_sampler import DataFrameSampler
from opinion_utils.exceptions import NoResultException
from opinion_tools.opinion.utils.steam_reviews_helper import get_steam_reviews as _get_steam_reviews
from opinion_tools.opinion.opinion_tools import _ensure_game_ids
from opinion_tools.opinion.utils.top_dimension_helper import get_top_dimensions
from opinion_tools.opinion.utils.cube_helper import _describe_data, get_cube_client
from opinion_tools.opinion.utils.metric_kb_injector import inject_metric_kb


@function_tool(
    failure_error_function=websearch_fallback_with_rewrite_error_function,
    description_override="""
Query game opinion metrics, comments, and news from the analytics database. 从舆情分析数据库查询舆情统计、原始内容、新闻更新、游戏竞品。

Args:
- game_names (required): Games to query. For comparison queries (对比/分别/vs), include ALL explicitly mentioned games — never omit any. Example: ["game1", "game2"].
  - For creator/KOL/account-specific queries where the user does NOT explicitly mention a game, pass an empty list [].
- query (required):
  - table prefix: Use exactly ONE table per call. If multiple tables are needed, call this tool multiple times.
  - timeDimensions: [{dimension, granularity, dateRange}]. Unless user explicitly specifies a granularity, infer it from dateRange span so the chart has a reasonable number of points (roughly 10–60). Do NOT pick granularity based on user wording like "月"/"month".
  - measures: Numeric fields only (from "measures" list in metadata).
  - dimensions: Categorical grouping fields only (from "dimensions" list). Never put date/time fields here.
  - filters: Filter by ANY field from the table's dimensions or measures. Format: [{member: "<table>.field", operator: "equals"|"gte"|"lte"|"contains"|..., values: [...]}]. Use for platform (channel_code), region (region_code/country_code), language (language_code), topic, content_type, etc.
  - order: JSON object for sorting. Example: {"<table>.views": "desc"}. Required for ranked queries. Must be an object, NOT an array.
  - limit: Required only for ungrouped=True queries.
  - ungrouped: Row-level detail mode. If true → MUST include measures (for ORDER BY), detail dimensions (title/content/url), order, and limit.
  - legends: Exactly ONE dimension for multi-series comparison (e.g. game_id, channel_code).

CRITICAL:
- All fields in one query must share the same table prefix. Never mix fields from different tables.
- ONLY use field names explicitly listed in the table metadata below. Never invent or derive field names.
- measures: numeric fields only; never use text/categorical fields (title, content, etc.) as measures.
- dimensions: grouping only; never put date/time fields here; for ungrouped=True use detail fields (title/content/url).
- order: JSON object, not an array. Example: {"<table>.views": "desc"}.
- timeDimensions: must include dimension + granularity + dateRange in every call.
- filters (MANDATORY): When user mentions channel/region/language/country/market etc., you MUST add the corresponding filter — no exceptions, applies to ALL query types and ALL tables (including hotness).
  - BAD — user says "在TikTok的播放量" but query = {"measures": ["<table>.video_views"], "timeDimensions": [...]} with no filters → WRONG
  - GOOD → add filters=[{"member": "<table>.channel_code", "operator": "equals", "values": ["tiktok"]}]
  - BAD — user says "日韩市场的声量" but query = {"measures": ["<table>.mentions"], "timeDimensions": [...]} with no country_code filter or dimension → WRONG
  - GOOD → add filters=[{"member": "<table>.country_code", "operator": "equals", "values": ["jp","kr"]}] AND add dimensions=["<table>.country_code"]

BEST PRACTICES:
- Multiple games: include all in game_names and add game_name as a dimension for per-game breakdown.
- Content/URL queries: set ungrouped=True, include title/content/url as dimensions, set order + limit.
- Skip adding channel_code when user explicitly says "所有平台" / "全平台" / "all platforms" — meaning they want aggregated cross-platform data with no grouping.
- PLATFORM FILTER: platform → channel_code: YouTube/Youtube官号→"youtube_keyword" | TikTok→"tiktok" | Twitter/X→"twitter" | Facebook→"facebook" | Instagram→"instagram" | Discord→"discord" | Twitch→"twitch_keyword" | Bilibili→"bilibili" | Reddit→"reddit"
- COUNTRY/REGION: 日韩→["jp","kr"] | 中日韩美→["cn","jp","kr","us"] | 东南亚→region_code "sea". See CRITICAL filters rule above.
- REGION FILTER: check metadata for available fields:
  • has region_code → SEA/东南亚→"sea" | MEA/中东→"mea" | LATAM→"latam" | EU→"eu" | NA→"na"
  • has country_code → use country codes directly: cn, us, jp, kr, uk, de, fr, etc.
  • only language_code → SEA→["id","ms","th","vi","tl"] | Middle East→["ar","fa","he","tr"] | Japan→["ja"] | Korea→["ko"] | China→["zh","zh-hant"]
- Topics: use topic filters listed in the metadata when user asks about specific topics.

FIELD METADATA USAGE:
- measures: numeric metrics — use in measures or as filter values.
- dimensions: categorical/grouping fields — use in dimensions or in filters.
- STRICT: every field name must exactly match a name in the metadata. If no matching field exists for a concept, omit it.

<TABLE AND FIELD METADATA>
---
### Table: `hotness`
> 游戏综合汇总指标，包含声量、讨论数、整体互动量、平均情感、正负面情感占比、潜在曝光、网红发帖数等。**默认为全平台汇总**，但支持通过 channel_code filter 缩小到特定平台。若用户指定了平台（如"在TikTok"），必须加 channel_code filter。示例问题：•「最近 Dune 的整体舆情表现如何？」•「过去一周原神全平台声量变化？」•「Dune在TikTok渠道的互动量是多少？」•「正面情感占比是多少？」•「负面讨论数量是多少？」•「全平台的网红发帖数是多少？」

**Measures:**
- `hotness.mentions` — 声量
- `hotness.positive_mentions` — 正面声量
- `hotness.neutral_mentions` — 中性声量
- `hotness.negative_mentions` — 负面声量
- `hotness.avg_sentiment` — 平均情感分（0-5分制）
- `hotness.brand_health` — 品牌健康度
- `hotness.positive_rate` — 正面情感比例
- `hotness.negative_rate` — 负面情感比例
- `hotness.creators` — 发帖人数量
- `hotness.views` — 观看量，视频播放量
- `hotness.engagement` — 互动量，热度问题按照engagement排序
- `hotness.potential_impressions` — 潜在曝光
- `hotness.publications` — 游戏相关的发帖总数，包括图文贴和视频贴，支持按照content_type筛选
- `hotness.official_account_publications` — 官号发帖量
- `hotness.kol_publications` — KOL网红发帖数量、网红发帖总数，用于统计全平台网红为该游戏发布的帖子数量
- `hotness.video_views` — 视频观看量
- `hotness.text_views` — 图文帖观看量
- `hotness.steam_purchase_mentions` — Steam上直接购买游戏的用户发布的评论数
- `hotness.steam_free_played_mentions` — Steam上免费游玩该游戏的用户发布的评论数
- `hotness.steam_early_access_mentions` — Steam上游戏EA（抢先体验）阶段期间发布的评论数

**Dimensions:**
- `hotness.game_id` — 游戏ID
- `hotness.date` — 评论日期，注意date精确到时间，不要使用equals筛选
- `hotness.channel_code` — 渠道代码: youtube_keyword,tiktok,twitter,facebook,instagram,discord,twitch_keyword,bilibili,reddit,google play,app store,navergame...
- `hotness.country_code` — 国家代码: cn,us,jp,kr,uk,de,fr,es...  用于按国家/市场维度拆分数据
- `hotness.language_code` — 语言: tr,ru,en,zh,zh-hant,ms,pt,ga,kha,ha,om,fi,ro,ve,tl,uz,ur...，中文应该同时包含zh,zh-hant
---
""",
    strict_mode=False,
    is_enabled=get_tool_enabled(ToolName.OpinionDataQueryTool.value),
    readable_name_map={
        "English": "Opinion Data Query Tool",
        "Chinese": "舆情数据查询工具",
    }
)
async def opinion_data_query_tool(
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    table: str = None,
    query: Query = None
) -> Dict[str, Any]:
    """
    Query game opinion metrics and contents from the database, including opinion statistics, raw posts/videos/comments, news updates and game competitors.
    
    Args:
        game_names: List of game names to query
        table: Table name to query(REQUIRED)
        query: Query object (REQUIRED), including measures, dimensions, filters, timeDimensions, order, limit, ungrouped
    """
    cube_client = get_cube_client()
    transformer = DataTransformer()
    # Get language from context, default to 'English' if not specified
    language = getattr(context.context, "language", None) or "English"

    # 统一 query 入参类型：兼容 Query / dict / JSON string
    if query is None:
        logger.warning("【read_data】query 参数为 None，创建默认的空 Query 对象")
        query = Query(
            measures=[],
            dimensions=[],
            filters=[],
            timeDimensions=[],
            limit=1000,
            ungrouped=False,
        )
    elif isinstance(query, str):
        try:
            query = json.loads(query)
        except Exception as e:
            logger.warning("【read_data】query JSON 字符串解析失败，使用空 Query：{}", e)
            query = {}

    if isinstance(query, dict):
        try:
            query = Query.model_validate(query)
        except Exception as e:
            logger.warning("【read_data】query dict 解析为 Query 失败，使用空 Query：{}", e)
            query = Query(
                measures=[],
                dimensions=[],
                filters=[],
                timeDimensions=[],
                limit=1000,
                ungrouped=False,
            )

    # 检测同一维度出现多个 timeDimension（不同 dateRange）的情况
    # 这通常是 LLM 错误地将"每个游戏的不同时间段"合并为一次查询
    if query.timeDimensions and len(query.timeDimensions) > 1:
        dimension_counts: Dict[str, int] = {}
        for td in query.timeDimensions:
            dim = getattr(td, 'dimension', None) or ''
            dimension_counts[dim] = dimension_counts.get(dim, 0) + 1
        duplicated_dims = [d for d, cnt in dimension_counts.items() if cnt > 1]
        if duplicated_dims:
            return {
                "error": (
                    f"Invalid query: timeDimensions contains {len(query.timeDimensions)} entries for the same "
                    f"dimension(s) {duplicated_dims} with different dateRanges. "
                    "This tool does NOT support multiple dateRanges in a single call. "
                    "When each game has its own date range (e.g., first N days after launch), "
                    "you MUST make SEPARATE PARALLEL tool calls — one call per game with its own dateRange and game_names."
                )
            }

    # 使用传入的 table 参数
    table_name = table
    if not table_name:
        # 推断表前缀
        def _infer_table_prefix() -> str:
            # 从 dimensions 推断
            for field in (query.dimensions or []):
                if '.' in field:
                    return field.split('.')[0]
            # 从 measures 推断
            for field in (query.measures or []):
                if '.' in field:
                    return field.split('.')[0]
            # 从 filters 推断
            for f in (query.filters or []):
                member = getattr(f, 'member', None)
                if member and '.' in member:
                    return member.split('.')[0]
            return 'hotness'
        table_name = _infer_table_prefix()

    # 构造 game_id filter
    game_ids = await _ensure_game_ids(context, game_names)
    if table_name and game_ids:  # 只有当 game_ids 不为空时才添加 filter
        game_id_filter = Filter(
            member=f"{table_name}.game_id",
            operator="equals",
            values=game_ids
        )
    else:
        game_id_filter = None

    # 重构query中game_id相关的filter
    cleaned_filters = []
    if hasattr(query, 'filters') and query.filters:
        for filter_item in query.filters:
            # 检查是否是game_id或game_name相关的filter，如果是则先清理掉
            if isinstance(filter_item, Filter) and not (
                filter_item.member.endswith(".game_id")
                or filter_item.member.endswith(".game_name")
            ):
                cleaned_filters.append(filter_item)
    if game_id_filter:
        query.filters = (
            cleaned_filters +
            [game_id_filter] if cleaned_filters else [game_id_filter]
        )
        logger.info(
            f"【read_data】自动添加 game_id filter: {table_name}.game_id = {game_ids}"
        )
    elif table_name and not game_ids:
        logger.info("【read_data】未识别到有效 game_ids，保留原始 filters，不自动添加 game_id filter")

    # 自动补齐 dimensions：当 filter 中包含 country_code 但 dimensions 中缺失时，自动添加
    if hasattr(query, 'filters') and query.filters and hasattr(query, 'dimensions') and query.dimensions is not None:
        country_suffixes = {'.country_code', '.country_en', '.country_zh'}
        filter_has_country = any(
            isinstance(f, Filter) and any(getattr(f, 'member', '').endswith(s) for s in country_suffixes)
            for f in query.filters
        )
        dims_has_country = any(
            any(d.endswith(s) for s in country_suffixes)
            for d in query.dimensions
        )
        if filter_has_country and not dims_has_country:
            country_dim = f"{table_name}.country_code" if table_name else "hotness.country_code"
            query.dimensions.append(country_dim)
            logger.info(
                f"【read_data】自动补齐 dimension: filter 含 country_code 但 dimensions 缺失，已添加 {country_dim}"
            )

    # 自动注入 game_id 到 dimensions，确保返回数据带有游戏维度（data transformer 会把 game_id 列替换为 game_name）。
    # 原因：
    #   1. 单次调用也可能被下游与其他调用合并 / 与其他游戏横向对比，没有 game_name 列时 LLM 无法区分来源；
    #   2. 对比类查询（multi-game）缺少 game 维度时，前端会把多个游戏的数据折叠成一条线，导致图表只显示单线的 bug。
    # 仅在以下条件下注入：
    #   - 存在可用的 table_name 且 game_ids 非空；
    #   - 非 ungrouped（明细行模式不需要聚合维度）；
    #   - dimensions 中尚未显式包含 game_id/game_name 维度（避免重复与覆盖用户/LLM 显式意图）。
    try:
        if (
            table_name
            and game_ids
            and not getattr(query, "ungrouped", False)
        ):
            existing_dims = list(getattr(query, "dimensions", None) or [])
            has_game_dim = any(
                isinstance(d, str) and (
                    d.lower().endswith(".game_id") or d.lower().endswith(".game_name")
                )
                for d in existing_dims
            )
            if not has_game_dim:
                injected_field = f"{table_name}.game_id"
                query.dimensions = existing_dims + [injected_field]
                logger.info(
                    f"【read_data】自动注入 game 维度到 dimensions: {injected_field} "
                    f"(game_ids={game_ids})，确保返回数据含 game_name 列"
                )
    except Exception as e:
        logger.warning(f"【read_data】自动注入 game 维度失败，跳过: {e}")

    # 验证query字段的有效性（传入 table_name）
    validation_result = await validate_query_fields(cube_client, table_name, query, language)
    if validation_result.get("error"):
        logger.error(f"【read_data】字段验证失败: {validation_result['error']}")
        return validation_result

    # 提取字段修改信息
    field_modifications = validation_result.get("field_modifications")

    # 检查timeDimensions是否为空，如果为空则检查表是否包含date字段
    if not hasattr(query, 'timeDimensions') or not query.timeDimensions:
        # 从query中推断使用的表名
        target_table = None
        all_fields = []
        if query.measures:
            all_fields.extend(query.measures)
        if query.dimensions:
            all_fields.extend(query.dimensions)
        # 获取第一个带前缀的字段的表名
        for field in all_fields:
            if '.' in field:
                target_table = field.split('.')[0]
                break

        # 当 timeDimensions 为空时，若 filters 中已包含任何 date 相关过滤，则不再设置默认 timeDimensions
        has_date_filter = False
        if hasattr(query, 'filters') and query.filters:
            for f in query.filters:
                try:
                    member = f.get('member') if isinstance(
                        f, dict) else getattr(f, 'member', None)
                    if member and (member.endswith('.date') or member == 'date'):
                        has_date_filter = True
                        break
                except Exception:
                    continue

        if target_table:
            # 检查表是否包含date字段
            has_date_field = await check_table_has_date_field(cube_client, target_table)
            if has_date_filter:
                logger.debug(
                    f"【read_data】filters 中已包含 date 相关条件，跳过设置默认 timeDimensions")
            elif has_date_field:
                logger.debug(
                    f"【read_data】表 {target_table} 包含date字段，timeDimensions为空且filters无date条件，设置默认值：30天数据（包含今天），粒度day")
                # 计算30天前的日期（包含今天），使用北京时间（UTC+8）
                beijing_tz = timezone(timedelta(hours=8))
                today = datetime.now(beijing_tz).date()
                default_time_dim = TimeDimension(
                    dimension=f"{target_table}.date",
                    granularity="day",
                    dateRange=[
                        (today - timedelta(days=29)).strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")]
                )
                query.timeDimensions = [default_time_dim]
            else:
                logger.debug(
                    f"【read_data】表 {target_table} 不包含date字段，跳过设置默认timeDimensions")
        else:
            logger.debug("【read_data】无法推断目标表名，跳过设置默认timeDimensions")

    # 处理timeDimensions中的"last x <unit>"格式，替换为具体日期范围（支持days/weeks/years）
    # 支持字符串格式（如"last 7 days"）和列表格式（如["last 7 days"]）
    if hasattr(query, 'timeDimensions') and query.timeDimensions:
        for time_dim in query.timeDimensions:
            if hasattr(time_dim, 'dateRange') and time_dim.dateRange:
                # 提取需要处理的字符串
                date_range_str = None
                if isinstance(time_dim.dateRange, str) and time_dim.dateRange.startswith("last "):
                    date_range_str = time_dim.dateRange
                elif isinstance(time_dim.dateRange, list) and len(time_dim.dateRange) == 1:
                    # 处理 ['last 7 days'] 格式
                    if isinstance(time_dim.dateRange[0], str) and time_dim.dateRange[0].startswith("last "):
                        date_range_str = time_dim.dateRange[0]

                if date_range_str:
                    # 解析"last x <unit>"格式，支持hours, days, weeks, months, years
                    match = re.match(
                        r"last (\d+) (hours?|days?|weeks?|months?|years?)", date_range_str, re.IGNORECASE)
                    if match:
                        number = int(match.group(1))
                        unit = match.group(2).lower()
                        # 使用北京时间（UTC+8）计算当前时间
                        beijing_tz = timezone(timedelta(hours=8))
                        now_beijing = datetime.now(beijing_tz)

                        if unit.startswith('hour'):
                            # 小时级别处理：向上取整到下一个小时作为end_time
                            if now_beijing.minute == 0 and now_beijing.second == 0 and now_beijing.microsecond == 0:
                                # 如果当前时间正好是整点，使用当前时间
                                end_time = now_beijing
                            else:
                                # 向上取整到下一个小时
                                end_time = now_beijing.replace(
                                    minute=0, second=0, microsecond=0) + timedelta(hours=1)

                            start_time = end_time - timedelta(hours=number)

                            # 格式化为 YYYY-MM-DDTHH:mm:ss 格式
                            start_datetime_str = start_time.strftime(
                                '%Y-%m-%dT%H:%M:%S')
                            end_datetime_str = end_time.strftime(
                                '%Y-%m-%dT%H:%M:%S')

                            logger.debug(
                                f"【read_data】将 '{date_range_str}' 替换为具体时间范围（基于北京时间）: "
                                f"[{start_datetime_str}, {end_datetime_str}]"
                            )
                            time_dim.dateRange = [
                                start_datetime_str, end_datetime_str]
                            continue
                        else:
                            # 日期级别处理：保持原有逻辑
                            today = now_beijing.date()

                            if unit.startswith('day'):
                                start_date = today - \
                                    timedelta(days=number - 1)  # 包含今天
                                end_date = today
                            elif unit.startswith('week'):
                                start_date = today - \
                                    timedelta(days=number * 7 - 1)  # 包含今天
                                end_date = today
                            elif unit.startswith('month'):
                                # 计算几个月前的日期，处理月末边界
                                year = today.year
                                month = today.month - number
                                while month <= 0:
                                    year -= 1
                                    month += 12

                                # 处理月末边界情况（如3月31日往前推1个月应该是2月28/29日）
                                try:
                                    start_date = today.replace(
                                        year=year, month=month)
                                except ValueError:
                                    # 如果目标月份没有对应的日期，使用该月最后一天
                                    if month == 2:
                                        # 2月特殊处理
                                        if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0):
                                            start_date = today.replace(
                                                year=year, month=2, day=29)
                                        else:
                                            start_date = today.replace(
                                                year=year, month=2, day=28)
                                    else:
                                        # 其他月份，找到该月最后一天
                                        if month in [4, 6, 9, 11]:  # 30天月份
                                            start_date = today.replace(
                                                year=year, month=month, day=30)
                                        else:  # 31天月份
                                            start_date = today.replace(
                                                year=year, month=month, day=31)
                                end_date = today
                            elif unit.startswith('year'):
                                # 安全减去年份，处理2月29日等边界
                                target_year = today.year - number
                                try:
                                    start_date = today.replace(
                                        year=target_year)
                                except ValueError:
                                    # 如遇2月29日，回退到2月28日
                                    if today.month == 2 and today.day == 29:
                                        start_date = today.replace(
                                            year=target_year, month=2, day=28)
                                    else:
                                        # 其他极端情况，退回到该月最后一天
                                        # 找到下个月1号再减1天
                                        first_of_next_month = (today.replace(
                                            day=1) + timedelta(days=32)).replace(day=1)
                                        last_day_of_month = first_of_next_month - \
                                            timedelta(days=1)
                                        start_date = last_day_of_month.replace(
                                            year=target_year)
                                end_date = today
                            else:
                                # 未识别的单位，保持原样
                                continue

                            # 日期级别的格式化输出
                            logger.debug(
                                f"【read_data】将 '{date_range_str}' 替换为具体日期范围（基于北京时间）: "
                                f"[{start_date.strftime('%Y-%m-%d')}, {end_date.strftime('%Y-%m-%d')}]"
                            )
                            time_dim.dateRange = [start_date.strftime(
                                '%Y-%m-%d'), end_date.strftime('%Y-%m-%d')]

    # 检查并修改时间维度：当dateRange范围大于180天时，强制设置granularity为month
    date_range_days = 0  # 用于动态limit计算
    for time_dim in query.timeDimensions:
        if time_dim.dateRange and isinstance(time_dim.dateRange, list) and len(time_dim.dateRange) == 2:
            try:
                start_date = parser.parse(time_dim.dateRange[0])
                end_date = parser.parse(time_dim.dateRange[1])
                current_date_range_days = (end_date - start_date).days

                # ungrouped=True 时 timeDimensions.granularity 与 Cube.js 的 ungrouped 模式冲突
                # （granularity 会产生 GROUP BY，而 ungrouped 明确要求无 GROUP BY），清除后跳过自动调整
                if getattr(query, 'ungrouped', False):
                    if getattr(time_dim, 'granularity', None):
                        logger.debug("【read_data】ungrouped=true，清除 timeDimensions.granularity 避免 Cube.js 冲突")
                        time_dim.granularity = None
                    # 保留 date_range_days 计算供 limit 使用，不 continue
                    date_range_days = current_date_range_days + 1
                    continue  # 跳过后续 granularity 自动调整逻辑

                # 超过3年才强制降为month，确保用户明确要求日粒度时（1~3年范围）可以正常生效
                if current_date_range_days >= 1095:
                    logger.debug(
                        f"【read_data】日期范围({current_date_range_days}天)超过3年，强制设置granularity为month")
                    time_dim.granularity = "month"

                if current_date_range_days <= 7 and time_dim.granularity not in (
                    "hour",
                    "minute",
                    "second",
                ):
                    logger.debug(
                        f"【read_data】日期范围({current_date_range_days}天)小于7天，强制设置granularity为day")
                    time_dim.granularity = "day"

                if time_dim.granularity in ("minute", "second"):
                    logger.debug(
                        f"【read_data】时间粒度({time_dim.granularity})太小，强制设置granularity为hour"
                    )
                    time_dim.granularity = "hour"

                # 保存date_range_days用于动态limit计算（包含开始和结束日期）
                ratio = 24 if time_dim.granularity == "hour" else 1
                date_range_days = (current_date_range_days + 1) * ratio

            except (ValueError, TypeError) as e:
                logger.debug(f"【read_data】解析日期范围失败: {e}")
                continue
    # 当 order 按指标排序时，说明用户想要「排行榜/TopN」而不是「时间趋势」，因此去掉时间粒度。这个逻辑不应该这样静默处理，暂时去掉
    # # 处理timeDimensions中granularity的情况
    # if hasattr(query, 'timeDimensions') and query.timeDimensions:
    #     for time_dim in query.timeDimensions:

    #         if hasattr(query, 'order') and query.order is not None:
    #             # 检查order是否包含非date字段的排序
    #             has_non_date_order = False
    #             for order_field in query.order:
    #                 if not order_field.endswith('.date'):
    #                     has_non_date_order = True
    #                     break

    #             if has_non_date_order:
    #                 if hasattr(time_dim, 'granularity'):
    #                     try:
    #                         delattr(time_dim, 'granularity')
    #                     except Exception:
    #                         pass

    # 处理dimensions中的date字段
    if hasattr(query, 'dimensions') and query.dimensions:
        # 创建一个新的dimensions列表，排除所有date字段
        new_dimensions = []
        for dimension in query.dimensions:
            if not dimension.endswith('.date'):
                new_dimensions.append(dimension)

        # 更新query的dimensions
        query.dimensions = new_dimensions

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

        if hasattr(query, 'dimensions') and query.dimensions and not query.ungrouped:
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
                    from opinion_tools.cube.cube_model import Filter as CubeFilter

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

    # 根据时间粒度调整date_range_days，并记录是否存在granularity
    has_time_granularity = False
    if date_range_days > 0 and hasattr(query, 'timeDimensions') and query.timeDimensions:
        for time_dim in query.timeDimensions:
            # 同时兼容对象/字典两种形态
            gran = None
            if isinstance(time_dim, dict):
                gran = time_dim.get('granularity')
            elif hasattr(time_dim, 'granularity'):
                gran = getattr(time_dim, 'granularity', None)

            if gran:
                has_time_granularity = True
                if gran == 'month':
                    date_range_days = max(1, date_range_days // 30)
                elif gran == 'week':
                    date_range_days = max(1, date_range_days // 7)
                break

    # measure为空时，设置ungrouped
    if not getattr(query, "measures", None) and not getattr(query, "ungrouped", None):
        logger.info("【read_data】measures为空，设置ungrouped=true")
        query.ungrouped = True

    # ungrouped=True 时 order 为空：自动用第一个 measure 降序，确保 limit 取到最相关的行
    if getattr(query, 'ungrouped', False) and not query.order:
        default_order_field = (query.measures or [])[0] if query.measures else None
        if default_order_field:
            query.order = {default_order_field: "desc"}
            logger.info(f"【read_data】ungrouped=true 且 order 为空，自动设置默认排序: {query.order}")

    # 处理ungrouped和动态limit设置
    if getattr(query, 'ungrouped', None) is False:
        if hasattr(query, 'order') and query.order is not None:
            logger.info("【read_data】ungrouped=false，清空order字段")
            query.order = {}

        # 当不存在 granularity 时，不修改 limit
        if has_time_granularity and hasattr(query, 'limit'):
            dynamic_limit = calculate_dynamic_limit(query, date_range_days)
            query.limit = dynamic_limit
            logger.info(
                f"【read_data】使用计算的limit: {dynamic_limit} (date_range_days={date_range_days})")

    # 最后验证是否满足feeds表的性能
    performance_result = validate_feeds_performance(query)
    if performance_result.get("error"):
        logger.warning(
            f"【read_data】feeds performance check failed: {performance_result['error']}")
        return performance_result

    # logger.info(f"【Tool API Call】-【read_data】: language: {language}")
    data = await read_cube_data(cube_client, transformer, query, language=language)
    if data.get("code") == 0 and not query.ungrouped:
        data["data_id"] = f"opinion_cube_{uuid.uuid4()}"
        data["system"] = "opinion"
        # Store full CSV for Analyst Agent sandbox
        try:
            raw_rows = data.get("data") and data["data"].get("data")
            if isinstance(raw_rows, list) and raw_rows and data.get("data_id"):
                full_csv = pd.DataFrame(raw_rows).to_csv(index=False)
                context.context.bi_data_for_sandbox.append(BiDataCsvEntry(data_id=data["data_id"], full_csv=full_csv))
        except Exception as e:
            logger.warning(f"[opinion_data_query_tool] Failed to append full CSV to bi_data_for_sandbox: {e}")
        context.context.data.append(data)

    # 如果数据为空或code为1，则抛出异常或NoResultException进行网络搜索
    if not data or data.get("code") not in [0, 2]:
        steam_data_text = ""
        if "steam" in str(query) or "score" in str(query):
            # 获取游戏的基础ID（去除平台后缀）
            base_game_ids = [
                re.sub(r"_(pc|console|mobile|combine)$", "", game_id) for game_id in game_ids]
            token = getattr(context.context, 'token', None)

            # 获取steam数据并添加到context，然后进行网络搜索
            try:
                data_steam_reviews = await _get_steam_reviews(base_game_ids, message_id=context.context.message_id, token=token)
                if data_steam_reviews:
                    full_csv = df.to_csv(index=False)
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
        _no_data_warning = (
            "WARNING: No structured metrics data was returned. You MUST NOT fabricate or estimate any numeric values "
            "(such as sentiment scores, mention counts, percentages, or ratings). Only describe qualitative insights "
            "from the web search results below. If no quantitative data is available, explicitly state that."
        )
        raise NoResultException(
            message=f"DataBrain未能找到游戏 {context.context.game_names} 的全部舆情数据，尝试结合联网结果给出回答。{_no_data_warning}{steam_data_text}",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )

    # 如果code为2，或为非grouped数据，添加NO_CHART_PROMPT
    base_instruction = "Answer in markdown table format. Don't need to generate chart for this part of data. Do not generate chart for this Section"
    if data.get("code") == 2 or query.ungrouped:
        data['instruction'] = base_instruction
        if table == "news_content":
            data['instruction'] = base_instruction + \
                "Please exclude the news that is not related to the user question and game name."

    # 转成csv格式以减少token
    if data.get("code") == 0:
        df = pd.DataFrame(data["data"]["data"])

        # 新增采样功能
        if len(df) > 5000:  # 只有当数据量超过5000时才进行采样
            try:
                # 获取分组字段和指标字段
                dimension_info = data["data"].get("dimension_info", [])
                metrics_info = data["data"].get("metrics_info", [])

                group_by_fields = [d["data_key"]
                                   for d in dimension_info if d.get("data_key") != "date"]
                metrics = [m["data_key"]
                           for m in metrics_info if m.get("data_key")]

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
                logger.info(
                    f"【read_data】数据采样完成：原始数据量 {len(data['data']['data'])} -> 采样后 {len(sampled_df)}")

                # 生成数据描述信息
                data_description = _describe_data(df, group_by_fields)

                # 构建返回结果
                result = {
                    "data": {
                        "Sample Data in CSV format": truncate_output(sampled_df.to_csv(index=False)),
                        "Data Statistics": data_description
                    },
                    "data_id": data.get("data_id"),
                    "system": data.get("system")
                }

                # 如果有字段修改信息，添加到返回结果中
                if field_modifications:
                    result["field_modifications"] = field_modifications

                # 如果自动应用了TopN维度过滤，追加说明
                if 'topn_explanations' in locals() and topn_explanations:
                    result.setdefault("notes", []).extend(topn_explanations)

                inject_metric_kb(query.measures if query else None, result)
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
        if field_modifications:
            result["field_modifications"] = field_modifications

        # 如果自动应用了TopN维度过滤，追加说明
        if 'topn_explanations' in locals() and topn_explanations:
            result.setdefault("notes", []).extend(topn_explanations)

        inject_metric_kb(query.measures if query else None, result)
        return result

    return truncate_output(data)


# ──────────────────────────────────────────────────────────────────────────────
# Per-request 动态 schema 注入（ContextVar + property 子类）
#
# 设计目标：
#   1. schema 信息闭环在 tool 内部，不依赖 agent system prompt
#   2. 并发安全：asyncio ContextVar 提供 per-Task 隔离，不同请求互不干扰
#   3. 任何 agent 调用此 tool 时自动生效，无需改 agent 代码
#
# 原理：
#   - _opinion_table_schema_var 是模块级 ContextVar，由 custom_hook.on_start 在
#     每个请求的 asyncio Task 上下文中调用 .set()
#   - FunctionTool 是普通 dataclass（非 frozen），可在子类中将 `description` 字段
#     重写为 property，通过 __class__ 替换让已创建的 tool 实例使用新行为
#   - SDK 在 on_start 执行完之后才读取 tool.description 来组装 LLM API 请求，
#     因此 ContextVar 已被当前 Task 设置，property 能返回正确的 per-request schema
# ──────────────────────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────────────
# per-request 可变容器 ContextVar（方案 C：在 agent_common.run_streamed 预设）
#
# 设计目标：
#   1. schema 信息闭环在 tool 内部，不依赖 agent system prompt
#   2. 并发安全：ContextVar 本身是 per-Task 隔离的；
#      但 on_start 在 asyncio.gather 子 Task 中执行，直接 .set() 不会传回父 Task。
#      解决方案：存储一个【可变 dict】作为 ContextVar 的值。
#      父 Task 在 Runner.run_streamed 前调用 .set({}) 建立容器，子 Task 继承相同
#      dict 引用（context 浅拷贝），对 dict 的修改对父 Task 可见。
#
# 执行顺序：
#   agent_common.run_streamed  →  _opinion_schema_container.set({})   (父 Task)
#   asyncio.create_task(_run_impl)  →  Task R 继承 {} 引用
#   asyncio.gather(on_start)        →  Task T1 继承同一 {} 引用
#   T1: container["schema"] = schema                                   (T1 改 dict)
#   Task R: model.get_response(tools) → tool.description → getter 读 dict ✓
# ──────────────────────────────────────────────────────────────────────────────

# 值为 Optional[dict]；None = 当前请求未经 run_streamed 初始化（兜底用静态描述）
_opinion_schema_container: ContextVar[Optional[dict]] = ContextVar(
    "_opinion_schema_container", default=None
)

# tool description 中的 schema 分隔符，用于区分静态前缀和动态 schema 部分
_SCHEMA_MARKER = "<TABLE AND FIELD METADATA>"


from agents.tool import FunctionTool as _FunctionTool


class _DynamicDescriptionFunctionTool(_FunctionTool):
    """FunctionTool 子类：将 description 字段重写为 property，从 per-request 容器读取 schema。"""

    @property
    def description(self) -> str:  # type: ignore[override]
        container = _opinion_schema_container.get(None)
        if container is not None:
            schema = container.get("schema", "")
            if schema:
                return f"{self._base_description}{_SCHEMA_MARKER}\n{schema}"
        # 容器未初始化或 schema 为空：返回含默认 hotness 表的完整静态描述
        return self._full_static_description

    @description.setter
    def description(self, value: str) -> None:
        # [Why] dataclass __init__ 会调用 self.description = ...，setter 负责接收并拆分存储
        self._full_static_description = value
        marker_pos = value.rfind(_SCHEMA_MARKER)  # rfind: 取最后一次出现，避免 prose 中同名引用导致截断
        if marker_pos != -1:
            self._base_description = value[:marker_pos]
        else:
            self._base_description = value


# 将已创建的 opinion_data_query_tool 实例的 __class__ 替换为动态子类
# [Why] @function_tool 装饰器在模块加载时就创建了 FunctionTool 实例，此时还没有 schema，
#       通过 __class__ 替换可以在不重新创建实例的前提下为其赋予动态 description 能力
#
# [Why 先取值再替换] __class__ 替换后 description 变为 data descriptor（property），
#   getter 依赖 _base_description，而 _base_description 尚未初始化；
#   必须先从 instance __dict__ 取出原始字符串，再通过 setter 完成初始化。
try:
    _static_desc: str = opinion_data_query_tool.__dict__.get("description", "")  # 替换前安全读取
    opinion_data_query_tool.__class__ = _DynamicDescriptionFunctionTool
    opinion_data_query_tool.description = _static_desc  # type: ignore[assignment]  # 触发 setter 初始化
except TypeError:
    # In react agent subprocess, @function_tool is a no-op decorator returning a plain function.
    # __class__ assignment is not supported on functions — skip dynamic description injection.
    pass

try:
    logger.info(
        f"[opinion_data_query_tool] 已启用可变容器 ContextVar 动态 schema 注入（方案 C），"
        f"静态前缀长度={len(opinion_data_query_tool._base_description)} chars"  # type: ignore[attr-defined]
    )
except AttributeError:
    pass