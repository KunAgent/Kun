"""
Industry Video Tool - 查询行业热门视频/博主排行

Data source: industry_video Cube view (marketing_hub_video)
Channels: tiktok, youtube
Modes:
  - group_by="video"   : 每行一条视频，适合"哪些视频最火"
  - group_by="creator" : 按博主聚合，适合"哪些博主/KOL最火"

Key SQL insight: The underlying measure uses IF(COUNT(DISTINCT video_url)=1, MAX(), SUM()).
Including video_url in dimensions ensures one row per video → MAX path (no double counting).
Excluding video_url aggregates multiple videos per creator → SUM path (correct rollup).

Enum values sourced by querying Cube from 2025-01-01 to 2026-02-18.
"""

import re
import uuid
import pandas as pd
from typing import Dict, Any, List, Optional, Literal
from datetime import datetime, timedelta, timezone
from loguru import logger

from run_context_wrapper import RunContextWrapper
from opinion_strategy.context import GameContext
from opinion_strategy.constants import ToolName
from opinion_tools.tool_common import get_tool_enabled, function_tool
from opinion_utils.helper import websearch_fallback_with_rewrite_error_function
from opinion_tools.opinion.utils.utils import truncate_output
from opinion_tools.opinion.utils.cube_helper import get_cube_client
from opinion_tools.cube.cube_tools import read_cube_data
from opinion_tools.cube.transformers import DataTransformer
from opinion_tools.cube.cube_model import Query, Filter as CubeFilter, TimeDimension
from opinion_utils.exceptions import NoResultException
from opinion_tools.opinion.utils.param_validator import ParamValidator, ParamValidationError
from opinion_tools.opinion.data.country_map import map_countries_to_iso


# ---- 枚举常量 ----
CUBE_VIEW = "industry_video"

ALLOWED_CHANNELS: set[str] = {"tiktok", "youtube"}

ALLOWED_SORT_BY: set[str] = {"views", "engagement", "likes"}

ALLOWED_METRICS: set[str] = {"views", "engagement", "likes"}

ALLOWED_GROUP_BY: set[str] = {"video", "creator"}

# ISO 两字母 country_code 枚举（239个，来自 Cube 2025-01-01~2026-02-18 实际数据，已排除聚合词）
# 注：'cn' (中国大陆) 已排除，TikTok/YouTube 在大陆不可用，实际数据仅 113 views
ALLOWED_COUNTRIES: set[str] = {
    'ad', 'ae', 'af', 'ag', 'ai', 'al', 'am', 'ao', 'aq', 'ar', 'at', 'au', 'aw', 'az',
    'ba', 'bb', 'bd', 'be', 'bf', 'bg', 'bh', 'bi', 'bj', 'bl', 'bm', 'bn', 'bo', 'bq',
    'br', 'bs', 'bt', 'bv', 'bw', 'by', 'bz', 'ca', 'cc', 'cd', 'cf', 'cg', 'ch', 'ci',
    'ck', 'cl', 'cm', 'co', 'cr', 'cv', 'cw', 'cx', 'cy', 'cz', 'de', 'dj', 'dk',
    'dm', 'do', 'dz', 'ec', 'ee', 'eg', 'eh', 'er', 'es', 'et', 'fi', 'fj', 'fk', 'fm',
    'fo', 'fr', 'ga', 'gb', 'gd', 'ge', 'gf', 'gg', 'gh', 'gi', 'gl', 'gm', 'gn', 'gp',
    'gq', 'gr', 'gt', 'gu', 'gw', 'gy', 'hk', 'hn', 'hr', 'ht', 'hu', 'id', 'ie', 'il',
    'im', 'in', 'io', 'iq', 'ir', 'is', 'it', 'je', 'jm', 'jo', 'jp', 'ke', 'kg', 'kh',
    'ki', 'km', 'kn', 'kp', 'kr', 'kw', 'ky', 'kz', 'la', 'lb', 'lc', 'li', 'lk', 'lr',
    'ls', 'lt', 'lu', 'lv', 'ly', 'ma', 'mc', 'md', 'me', 'mf', 'mg', 'mh', 'mk', 'ml',
    'mm', 'mn', 'mo', 'mp', 'mq', 'mr', 'ms', 'mt', 'mu', 'mv', 'mw', 'mx', 'my', 'mz',
    'na', 'nc', 'ne', 'nf', 'ng', 'ni', 'nl', 'no', 'np', 'nr', 'nu', 'nz', 'om', 'pa',
    'pe', 'pf', 'pg', 'ph', 'pk', 'pl', 'pm', 'pn', 'pr', 'ps', 'pt', 'pw', 'py', 'qa',
    're', 'ro', 'rs', 'ru', 'rw', 'sa', 'sb', 'sc', 'sd', 'se', 'sg', 'sh', 'si', 'sj',
    'sk', 'sl', 'sm', 'sn', 'so', 'sr', 'st', 'sv', 'sy', 'sz', 'tc', 'td', 'tg', 'th',
    'tj', 'tk', 'tl', 'tm', 'tn', 'to', 'tr', 'tt', 'tv', 'tw', 'tz', 'ua', 'ug', 'us',
    'uy', 'uz', 'va', 'vc', 've', 'vg', 'vi', 'vn', 'vu', 'ws', 'xk', 'ye', 'yt', 'za',
    'zm', 'zw',
}

# region_code 枚举（13个，来自 Cube 2025-01-01~2026-02-18 实际数据，已排除 NULL）
# 注：'chn'(113 views) 和 'as'(7362 views) 数据量极少，疑为无效映射，已排除
ALLOWED_REGIONS: set[str] = {
    'af', 'an', 'eur', 'hmt', 'in', 'jpn', 'kr',
    'me', 'na', 'oa', 'other asia', 'sa', 'sea',
}

# category 枚举（11个）
ALLOWED_CATEGORIES: set[str] = {
    "Comedy", "Entertainment", "Film & Animation", "Games",
    "Howto & Style", "Music", "Nonprofits & Activism", "Now",
    "Other", "People & Blogs", "Sports & Outdoor",
}

GLOBAL_AGGREGATE_TERMS: set[str] = {
    "global", "worldwide", "all", "all countries",
    "全球", "全世界", "所有国家", "世界",
}

SortBy = Literal["views", "engagement", "likes"]
GroupBy = Literal["video", "creator"]


def _m(field: str) -> str:
    """给字段名加上 cube view 前缀"""
    return f"{CUBE_VIEW}.{field}"


def _normalize_creator_name(name: str) -> str:
    """
    规范化博主名，用于大小写+分隔符不敏感匹配。
    - 去除分隔符：. _ - 及各类空白（用户输入可能用空格代替点/下划线）
    - 统一小写（处理 TikTok 全小写、YouTube 混合大小写）
    - 保留数字（数字是 handle 唯一性的一部分，去掉会引发误判）
    - 保留非拉丁字符（泰文/阿拉伯文/汉字等本身无大小写，.lower() 为 no-op）
    """
    return re.sub(r'[._\-\s]+', '', name.lower())


def _build_dimensions(group_by: str, language: str) -> List[str]:
    """
    根据 group_by 模式和语言构建 dimensions 列表。

    video 模式：包含 video_url，触发底层 SQL 的 MAX 路径（每行一个视频，无双计数）。
    creator 模式：只用 anchor_name，不加 channel/region/country/category。
                 channel 由调用方通过 channels 参数作为 filter 控制（每次只传一个平台）；
                 加 region/country/category 会导致同一博主按地区/分类拆成多行，views 不是真实总量。
    """
    title_field = "video_title_zh" if language == "Chinese" else "video_title_en"
    country_field = "country_zh" if language == "Chinese" else "country_en"
    region_field = "region_zh" if language == "Chinese" else "region_en"

    if group_by == "video":
        # 维度顺序决定前端表格列顺序：博主 → 标题 → 链接 → 上下文
        return [
            _m("anchor_name"),
            _m(title_field),
            _m("video_url"),
            _m("channel"),
            _m("category"),
            _m("country_code"),
            _m(country_field),
            _m("region_code"),
            _m(region_field),
        ]
    else:  # creator
        # channel 通过 channels 参数作为 filter 传入（每次调用只查一个平台），
        # 不作为聚合维度——每次 creator 查询强制指定单一平台，无需在 GROUP BY 里区分。
        return [
            _m("anchor_name"),
        ]


@function_tool(
    failure_error_function=websearch_fallback_with_rewrite_error_function,
    description_override="""
Query industry-wide top videos or top creators (KOLs) ONLY on TikTok/YouTube across ALL content categories — NOT game-only, do NOT default to categories=["Games"].

WHEN TO USE: 
- Use this tool when the user asks about top/trending/hot videos or top KOLs/creators/bloggers/博主 on TikTok/YouTube WITHOUT specifying a particular game. e.g., "上周互动量最高的YouTube视频有哪些？", "TikTok最热门的10个视频", "全平台播放量最高的视频有哪些？", "最近最火的YouTube博主是谁？", "过去一个月TikTok上播放量最高的博主是哪些？" → use this tool with group_by="creator"
- For creator/博主/KOL ranking queries (no game name): ALWAYS use group_by="creator". If no platform specified, call TWICE (channels=["tiktok"] and channels=["youtube"]) and report separately.

- If the user's question mentions a SPECIFIC GAME NAME or a SPECIFIC GAME HASHTAG → DO NOT use this tool. Use opinion_data_query_tool instead.
  This tool has NO hashtag filter — it cannot filter results by #hashtag. Any likes/views returned are industry-wide, NOT specific to a hashtag.
  Examples that must go to opinion_data_query_tool:
  - "原神在TikTok的视频播放量是多少？"
  - "Valorant最近在YouTube上的视频表现如何？"
  - "某游戏的KOL发帖数量"
  - "这款游戏在各平台的视频观看量趋势"
  - "where does #mlbb get most likes?" → #mlbb is a game hashtag; use opinion_data_query_tool (group by country, metric=likes)
  - "which country likes #honorofkings videos the most?" → game hashtag query; use opinion_data_query_tool
- This tool is ONLY for industry-wide rankings where NO specific game or game hashtag is named.

Args:
- start_date, end_date (YYYY-MM-DD): Publish date range. Defaults to last 30 days.
- channels: ["tiktok"] / ["youtube"] / ["tiktok","youtube"]. Default: both. NOTE: use "youtube" here (NOT "youtube_keyword" — that is only for opinion_data_query_tool).
  ONLY TikTok and YouTube are supported. Other platforms (e.g. bilibili, instagram, twitter) are NOT available in this dataset — do NOT pass them.
- countries: Specific country filter. Supports ISO2 and common country aliases
  (country names / case variants) and normalizes to ISO2 before validation.
  Use ONLY for a specific country (e.g. "jp","us").
  Do NOT pass "global"/"worldwide"/"all" — omit countries entirely for global results.
  AMBIGUOUS codes — use `regions` instead for geographic areas:
    "na"=Namibia, "sa"=Saudi Arabia, "af"=Afghanistan, "me"=Montenegro in countries.
- regions: For broad geographic areas (ignored if countries is set). Available (13):
  "sea","eur","na","me","sa","af","in","jpn","kr","oa","hmt","other asia","an".
- categories: "Games","Entertainment","Music","Comedy","Film & Animation","Howto & Style",
  "People & Blogs","Sports & Outdoor","Now","Nonprofits & Activism","Other".
  RULE: Only set if user EXPLICITLY mentions a content type. Never infer "Games" from context.
  Do NOT set when creator_names is specified (wrong category silently excludes the creator).
- sort_by: "最火"/"火"/"热"/"热门"/"popular"/"trending"/"viral" all → "views" (default).
  Only use "engagement" (likes+comments+shares) or "likes" when user says those exact words.
- metrics: Subset of ["views","engagement","likes"]. Omit to return all three (recommended).
- group_by: "video" (one row per video, default) or "creator" (one row per creator, totals).
- top_n: Default 10, max 50.
- creator_names: Filter by creator name(s), case-insensitive (handles dots/underscores/case).
  Use when user asks "Is [creator] one of the top creators?". Searches top 100, returns
  matching rows with `rank` position. If not found, report not in top 100.
  Do NOT set for general top-N queries.
  CRITICAL: Do NOT set categories together with this unless user explicitly states a category.
  CRITICAL: When group_by="creator" and user does NOT specify a platform, ALWAYS call this
  tool TWICE — once with channels=["tiktok"], once with channels=["youtube"] — and report
  results for each platform separately. TikTok and YouTube view counts are NOT comparable
  (short-video vs long-video), so a combined ranking is always misleading.
    - General KOL query (no creator_names): report top-N for each platform separately.
    - Specific creator query (creator_names set): report the creator's rank on each platform.

SPECIAL CASES:
- China: no TikTok/YouTube data → do NOT call this tool, fall back to web search.
- Asia broadly: regions=["sea","jpn","kr","in","hmt","other asia"] (no single Asia code).

Examples (non-obvious cases only):
- Top videos in North America: regions=["na"] (NOT countries=["na"])
- Top videos in Middle East: regions=["me"] (NOT countries=["me"])
- Top videos in Asia: regions=["sea","jpn","kr","in","hmt","other asia"]
- Top KOLs recently? (no platform → call twice):
  call 1: channels=["tiktok"], group_by="creator"
  call 2: channels=["youtube"], group_by="creator"
- Is MrBeast a top KOL recently? (no platform → call twice):
  call 1: channels=["tiktok"], group_by="creator", creator_names=["MrBeast"]
  call 2: channels=["youtube"], group_by="creator", creator_names=["MrBeast"]

OUTPUT FORMAT RULE (CRITICAL):
When presenting results from this tool, ALWAYS include ALL available metrics (views/观看数, engagement/互动量, likes/点赞数) as separate columns in the table.
Do NOT drop any metric column. The table must include Views (播放量/观看数) as a prominent column.
Example correct table header: | Creator | Content | URL | Views | Engagement | Likes
""",
    is_enabled=get_tool_enabled(ToolName.GetIndustryTopVideos.value),
    readable_name_map={
        "English": "Industry Top Videos Tool",
        "Chinese": "行业热门视频工具",
    },
)
async def get_industry_top_videos(
    context: RunContextWrapper[GameContext],
    start_date: str = "",
    end_date: str = "",
    channels: Optional[List[str]] = None,
    countries: Optional[List[str]] = None,
    regions: Optional[List[str]] = None,
    categories: Optional[List[str]] = None,
    sort_by: Optional[SortBy] = None,
    metrics: Optional[List[str]] = None,
    group_by: Optional[GroupBy] = None,
    top_n: int = 10,
    creator_names: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    查询行业热门视频或热门博主数据。

    Args:
        context: 运行上下文
        start_date: 视频发布开始日期 (YYYY-MM-DD)
        end_date: 视频发布结束日期 (YYYY-MM-DD)
        channels: 渠道过滤，支持 tiktok / youtube
        countries: ISO 两字母国家码过滤列表（不接受聚合词）
        regions: 地区代码过滤列表（countries 为空时生效）
        categories: 视频分类过滤列表
        sort_by: 排序指标，views / engagement / likes
        metrics: 返回的指标列表，可选 views/engagement/likes 的任意子集，空则返回全部
        group_by: 聚合粒度，video（每行一条视频）/ creator（按博主聚合，每博主一行）
        top_n: 返回前 N 条，最大 50
        creator_names: 按博主名过滤（大小写不敏感）。指定后内部查询前500名再做 Python
                       侧不敏感匹配，返回行带 rank 排名列，适合"某博主是否在头部"类问题。
    """
    try:
        validation_messages: List[str] = []
        beijing_tz = timezone(timedelta(hours=8))
        now = datetime.now(beijing_tz)
        user_language = getattr(context.context, "language", None) or "English"

        # ========== 参数验证 ==========

        # sort_by
        final_sort_by: SortBy = ParamValidator.validate_string(
            sort_by, ALLOWED_SORT_BY, "views", "sort_by", validation_messages
        ) or "views"

        # group_by
        final_group_by: GroupBy = ParamValidator.validate_string(
            group_by, ALLOWED_GROUP_BY, "video", "group_by", validation_messages
        ) or "video"

        # top_n
        final_top_n = ParamValidator.validate_number(
            top_n, 10, "top_n", validation_messages, min_value=1, max_value=50, is_integer=True
        )

        # 时间范围（默认最近 30 天）
        default_start = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        default_end = now.strftime("%Y-%m-%d")

        if not start_date:
            start_date = default_start
            validation_messages.append(f"start_date 未指定，默认使用30天前: {start_date}")
        else:
            start_date = ParamValidator.validate_datetime(
                start_date, default_start, "start_date", validation_messages,
                required_format="%Y-%m-%d",
            )

        if not end_date:
            end_date = default_end
            validation_messages.append(f"end_date 未指定，默认使用今天: {end_date}")
        else:
            end_date = ParamValidator.validate_datetime(
                end_date, default_end, "end_date", validation_messages,
                required_format="%Y-%m-%d",
            )

        if start_date and end_date and start_date > end_date:
            start_date, end_date = end_date, start_date
            validation_messages.append("start_date > end_date，已自动交换")

        # channels
        channel_filters = ParamValidator.validate_string_list(
            channels, ALLOWED_CHANNELS, [], "channels", validation_messages,
            transform_func=str.lower,
        )

        # countries（先剥离聚合词，再做变体归一化，最后严格 ISO 两字母枚举校验）
        raw_countries = list(countries) if countries else []
        filtered_countries = [
            c for c in raw_countries
            if c.strip().lower() not in GLOBAL_AGGREGATE_TERMS
        ]
        if raw_countries and not filtered_countries:
            validation_messages.append(
                f"countries 参数包含全局聚合词 {raw_countries}，视为不过滤国家"
            )
        raw_countries = filtered_countries
        countries_for_validation = map_countries_to_iso(raw_countries, ALLOWED_COUNTRIES)
        if raw_countries and countries_for_validation != raw_countries:
            validation_messages.append(
                f"countries 参数已归一化: {raw_countries} -> {countries_for_validation}"
            )
            
        try:
            country_filters = ParamValidator.validate_string_list(
                countries_for_validation, ALLOWED_COUNTRIES, [], "countries", validation_messages,
                transform_func=str.lower,
            )
        except ParamValidationError:
            country_filters = []
            validation_messages.append(
                f"countries 参数的值 {countries_for_validation} 不受支持，视为不过滤国家"
            )

        # regions（countries 为空时才用，严格枚举校验）
        region_filters: List[str] = []
        if not country_filters:
            region_filters = ParamValidator.validate_string_list(
                regions, ALLOWED_REGIONS, [], "regions", validation_messages,
                transform_func=str.lower,
            )
        elif regions:
            validation_messages.append("countries 已指定，regions 参数被忽略")

        # categories
        category_filters = ParamValidator.validate_string_list(
            categories, ALLOWED_CATEGORIES, [], "categories", validation_messages,
        )

        # metrics（用户指定返回哪些指标，空则全返回；sort_by 对应指标始终包含）
        try:
            requested_metrics = ParamValidator.validate_string_list(
                metrics, ALLOWED_METRICS, [], "metrics", validation_messages,
                transform_func=str.lower,
            )
        except ParamValidationError:
            requested_metrics = []
            validation_messages.append(
                f"metrics 参数的值 {metrics} 不受支持，已使用默认值: views, engagement, likes"
            )
        if not requested_metrics:
            requested_metrics = ["views", "engagement", "likes"]
        if final_sort_by not in requested_metrics:
            requested_metrics.insert(0, final_sort_by)

        # creator_names — 自由字符串，不做枚举校验，仅去除空白
        final_creator_names: List[str] = [
            n.strip() for n in (creator_names or []) if n and n.strip()
        ]
        if final_creator_names:
            validation_messages.append(
                f"creator_names 过滤（大小写不敏感）: {final_creator_names}"
            )

        # ========== 构建 Cube Query ==========

        cube_client = get_cube_client()
        transformer = DataTransformer()

        # dimensions（顺序决定前端表格列顺序）
        dimensions_list = _build_dimensions(final_group_by, user_language)

        # measures（sort_by 指标排第一）
        measures_list = [_m(final_sort_by)]
        for m in requested_metrics:
            if _m(m) not in measures_list:
                measures_list.append(_m(m))

        # timeDimensions（发布日期 filter，不加 granularity）
        time_dimensions = [
            TimeDimension(
                dimension=_m("date"),
                dateRange=[start_date, end_date],
            )
        ]

        # filters
        filters_list: List[CubeFilter] = []

        if channel_filters:
            filters_list.append(CubeFilter(
                member=_m("channel"),
                operator="equals" if len(channel_filters) == 1 else "in",
                values=channel_filters,
            ))
            validation_messages.append(f"过滤渠道: {', '.join(channel_filters)}")

        if country_filters:
            filters_list.append(CubeFilter(
                member=_m("country_code"),
                operator="equals" if len(country_filters) == 1 else "in",
                values=country_filters,
            ))
            validation_messages.append(f"过滤国家: {', '.join(country_filters)}")
        elif region_filters:
            filters_list.append(CubeFilter(
                member=_m("region_code"),
                operator="equals" if len(region_filters) == 1 else "in",
                values=region_filters,
            ))
            validation_messages.append(f"过滤地区: {', '.join(region_filters)}")

        if category_filters:
            filters_list.append(CubeFilter(
                member=_m("category"),
                operator="equals" if len(category_filters) == 1 else "in",
                values=category_filters,
            ))
            validation_messages.append(f"过滤分类: {', '.join(category_filters)}")

        # 当 creator_names 指定时，固定拉取 top 100 供 Python 侧匹配
        CREATOR_LOOKUP_LIMIT = 100
        cube_limit = CREATOR_LOOKUP_LIMIT if final_creator_names else final_top_n

        query = Query(
            measures=measures_list,
            dimensions=dimensions_list,
            timeDimensions=time_dimensions,
            filters=filters_list,
            limit=cube_limit,
            order={_m(final_sort_by): "desc"},
        )

        # ========== 执行查询 ==========

        logger.info(
            f"[get_industry_top_videos] group_by={final_group_by} sort_by={final_sort_by} "
            f"top_n={final_top_n} date={start_date}~{end_date}"
        )

        data = await read_cube_data(cube_client, transformer, query, language=user_language)

        # ========== 处理结果 ==========

        if data.get("code") == 0:
            data_id = f"industry_video_{uuid.uuid4()}"

            raw_data = data["data"]["data"]

            # 标题字段中的 | 会被 LLM/前端渲染为 Markdown 表格分隔符导致列错位
            # 在 raw_data 上原地替换，context.context.data 存的也是同一引用，同步生效
            for record in raw_data:
                for key, value in record.items():
                    if isinstance(value, str) and "title" in key.lower():
                        record[key] = value.replace("|", "｜")

            df = pd.DataFrame(raw_data)

            logger.info(
                f"[get_industry_top_videos] transformer返回列: {list(df.columns)}, 行数: {len(df)}"
            )
            logger.info(
                f"[get_industry_top_videos] metrics_info: {data['data'].get('metrics_info')}"
            )

            if df.empty:
                raise NoResultException(
                    message="未找到符合条件的行业视频数据，尝试通过网络搜索获取信息。",
                    search_query=context.context.planner_context.rephrased_question,
                    use_web_search=True,
                )

            # 先加排名列（基于 Cube 已按 sort_by desc 排序的结果）
            df.insert(0, "rank", range(1, len(df) + 1))

            if final_creator_names:
                # 规范化匹配：去除分隔符(./_/-/空白) + 小写，数字和非拉丁字符保留
                # 例：用户传 "isa belle stoll" 可命中 DB 里的 "isa.belle_stoll"
                name_set = {_normalize_creator_name(n) for n in final_creator_names}
                df = df[df["anchor_name"].apply(
                    lambda x: _normalize_creator_name(x) in name_set
                )]
                if df.empty:
                    searched = len(raw_data)
                    raise NoResultException(
                        message=(
                            f"在 {final_sort_by} 排名前 100 名中未找到创作者 {final_creator_names}，"
                            "请确认名称拼写或尝试通过网络搜索获取信息。"
                        ),
                        search_query=context.context.planner_context.rephrased_question,
                        use_web_search=True,
                    )
            else:
                df = df.head(final_top_n)

            # 按可读性重排列顺序（DataTransformer._preprocess_dataframe 已剥离列名前缀）
            desired_order = [col for col in [
                "rank",
                "anchor_name",
                "video_title_zh", "video_title_en", "video_title",
                "video_url",
                "channel", "category",
                "country_code", "country_zh", "country_en",
                "region_code", "region_zh", "region_en",
                "views", "likes", "engagement",
            ] if col in df.columns]
            remaining = [c for c in df.columns if c not in desired_order]
            df = df[desired_order + remaining]

            context.context.data.append({
                "data": data,
                "data_id": data_id,
                "system": "industry_video",
            })

            result = {
                "data": truncate_output(df.to_csv(index=False)),
                "data_id": data_id,
                "system": "industry_video",
                "summary": {
                    "total_rows": len(df),
                    "group_by": final_group_by,
                    "sort_by": final_sort_by,
                    "date_range": f"{start_date} to {end_date}",
                    "channels": channel_filters or ["tiktok", "youtube"],
                    "countries": country_filters or "all",
                    "regions": region_filters or "all",
                    "categories": category_filters or "all",
                    "creator_names": final_creator_names or "all",
                    "note": (
                        "数据按视频发布日期过滤。group_by=video时每行为一条视频；"
                        "group_by=creator时按博主聚合，每博主一行，指标为该博主所有视频之和。"
                    ) if user_language == "Chinese" else (
                        "Filtered by video publish date. "
                        "group_by=video: one row per video. "
                        "group_by=creator: one row per creator, metrics are totals across all their videos."
                    ),
                },
            }

            if validation_messages:
                result["field_modifications"] = validation_messages

            logger.info(f"[get_industry_top_videos] 查询成功，返回 {len(df)} 条记录")
            return result

        elif data.get("code") == 1:
            raise NoResultException(
                message=f"行业视频数据查询失败: {data.get('data', {}).get('error', '未知错误')}，尝试通过网络搜索获取信息。",
                search_query=context.context.planner_context.rephrased_question,
                use_web_search=True,
            )

        else:
            return truncate_output(data)

    except NoResultException:
        raise

    except Exception as e:
        logger.error(f"[get_industry_top_videos] 执行失败: {e}")
        raise NoResultException(
            message=f"行业视频数据查询异常: {str(e)}，尝试通过网络搜索获取信息。",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )
