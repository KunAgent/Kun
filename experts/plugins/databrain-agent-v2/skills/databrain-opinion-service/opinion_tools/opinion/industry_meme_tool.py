"""
Industry Meme Tool - 查询 TikTok/Bilibili 行业热梗排行

Data source: industry_meme_list Cube view
Channels: tiktok, bilibili
Each row represents a meme (梗) with aggregated metrics across all videos using that meme.

Key fields:
  - meme_id: unique identifier (the meme's English title)
  - content / content_zh: detailed description of the meme format and how it spreads
  - meme_type: categorical classification (17 types, e.g. "Gaming Viral Moments")
  - meme_elements: format classification (e.g. "AUDIO_SIGNATURE", "NARRATIVE_DRIVEN")
  - region_code: language/region area (8 values, e.g. "GLOBAL", "EN", "ZH_CN", "KR")
  - hot_time: when the meme became trending (string, not time type)

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
from opinion_tools.cube.cube_model import Query, Filter as CubeFilter
from opinion_utils.exceptions import NoResultException
from opinion_tools.opinion.utils.param_validator import ParamValidator


# ---- Cube view ----
CUBE_VIEW = "industry_meme_list"

# ---- 枚举常量 ----
ALLOWED_CHANNELS: set[str] = {"tiktok", "bilibili"}

ALLOWED_SORT_BY: set[str] = {"views", "likes", "video_count", "shares", "comments"}

SORT_BY_TO_MEASURE: dict[str, str] = {
    "views": "total_views",
    "likes": "total_likes",
    "comments": "total_comments",
    "shares": "total_shares",
    "video_count": "video_count",
}

ALLOWED_REGION_CODES: set[str] = {
    "GLOBAL", "EN", "ZH_CN", "ES", "EN_NA",
    "SEA_MULTI", "LATAM_MULTI", "KR",
}

REGION_ALIAS_MAP: dict[str, str] = {
    "global": "GLOBAL",
    "全球": "GLOBAL",
    "全球通用": "GLOBAL",
    "en": "EN",
    "english": "EN",
    "英语区": "EN",
    "zh_cn": "ZH_CN",
    "chinese": "ZH_CN",
    "中文": "ZH_CN",
    "中文区": "ZH_CN",
    "中文简体区": "ZH_CN",
    "es": "ES",
    "spanish": "ES",
    "西语区": "ES",
    "en_na": "EN_NA",
    "north america": "EN_NA",
    "北美": "EN_NA",
    "北美英语区": "EN_NA",
    "sea_multi": "SEA_MULTI",
    "sea": "SEA_MULTI",
    "southeast asia": "SEA_MULTI",
    "东南亚": "SEA_MULTI",
    "东南亚多语区": "SEA_MULTI",
    "latam_multi": "LATAM_MULTI",
    "latam": "LATAM_MULTI",
    "latin america": "LATAM_MULTI",
    "拉美": "LATAM_MULTI",
    "拉美混合语区": "LATAM_MULTI",
    "kr": "KR",
    "korea": "KR",
    "korean": "KR",
    "韩国": "KR",
    "韩语区": "KR",
}

ALLOWED_MEME_TYPES: set[str] = {
    "Absurd & Remix Meme Culture",
    "Lifestyle & Cultural Trends",
    "Gaming Viral Moments",
    "Entertainment & Media Trends",
    "Meme & Internet Culture",
    "Pop Music Trends",
    "Audio Memes",
    "Dance & Movement Trends",
    "Challenge & Participation",
    "Seasonal & Holiday Trends",
    "Shock / Curiosity Driven Trends",
    "Pet & Animal Content",
    "Emotional Trends",
    "Technology Trends",
    "Beautiful Scenery & Aesthetics",
    "Parent and Child",
    "Emotional & Quotes",
}

MEME_TYPE_ALIAS_MAP: dict[str, str] = {
    "gaming": "Gaming Viral Moments",
    "游戏": "Gaming Viral Moments",
    "游戏热点": "Gaming Viral Moments",
    "music": "Pop Music Trends",
    "音乐": "Pop Music Trends",
    "流行音乐": "Pop Music Trends",
    "dance": "Dance & Movement Trends",
    "舞蹈": "Dance & Movement Trends",
    "challenge": "Challenge & Participation",
    "挑战": "Challenge & Participation",
    "pet": "Pet & Animal Content",
    "萌宠": "Pet & Animal Content",
    "动物": "Pet & Animal Content",
    "audio": "Audio Memes",
    "音频": "Audio Memes",
    "音频梗": "Audio Memes",
    "tech": "Technology Trends",
    "科技": "Technology Trends",
    "抽象": "Absurd & Remix Meme Culture",
    "鬼畜": "Absurd & Remix Meme Culture",
    "玩梗": "Absurd & Remix Meme Culture",
    "lifestyle": "Lifestyle & Cultural Trends",
    "流行趋势": "Lifestyle & Cultural Trends",
    "entertainment": "Entertainment & Media Trends",
    "文娱": "Entertainment & Media Trends",
    "meme": "Meme & Internet Culture",
    "模因": "Meme & Internet Culture",
    "亚文化": "Meme & Internet Culture",
    "holiday": "Seasonal & Holiday Trends",
    "节日": "Seasonal & Holiday Trends",
    "猎奇": "Shock / Curiosity Driven Trends",
    "emotion": "Emotional Trends",
    "情绪": "Emotional Trends",
    "aesthetics": "Beautiful Scenery & Aesthetics",
    "美景": "Beautiful Scenery & Aesthetics",
    "美学": "Beautiful Scenery & Aesthetics",
    "parent": "Parent and Child",
    "亲子": "Parent and Child",
}

ALLOWED_MEME_ELEMENTS: set[str] = {
    "ABSTRACT_HYBRID",
    "VISUAL_IDENTITY",
    "AUDIO_SIGNATURE",
    "ACTION_GESTURE",
    "TEXT_EXPRESSION",
    "NARRATIVE_DRIVEN",
}

MEME_ELEMENT_ALIAS_MAP: dict[str, str] = {
    "abstract / hybrid memes": "ABSTRACT_HYBRID",
    "abstract": "ABSTRACT_HYBRID",
    "hybrid": "ABSTRACT_HYBRID",
    "抽象": "ABSTRACT_HYBRID",
    "iconic visual appearance": "VISUAL_IDENTITY",
    "visual": "VISUAL_IDENTITY",
    "形象": "VISUAL_IDENTITY",
    "外观": "VISUAL_IDENTITY",
    "signature audio & sound": "AUDIO_SIGNATURE",
    "audio": "AUDIO_SIGNATURE",
    "音频": "AUDIO_SIGNATURE",
    "signature actions & gestures": "ACTION_GESTURE",
    "action": "ACTION_GESTURE",
    "gesture": "ACTION_GESTURE",
    "动作": "ACTION_GESTURE",
    "text": "TEXT_EXPRESSION",
    "文字": "TEXT_EXPRESSION",
    "narrative": "NARRATIVE_DRIVEN",
    "剧情": "NARRATIVE_DRIVEN",
}

SortBy = Literal["views", "likes", "video_count", "shares", "comments"]


def _m(field: str) -> str:
    return f"{CUBE_VIEW}.{field}"


def _normalize_meme_name(name: str) -> str:
    """Normalize meme name for case-insensitive + separator-insensitive matching."""
    return re.sub(r'[._\-\s]+', '', name.lower())


def _resolve_region_codes(
    raw_values: Optional[List[str]], validation_messages: List[str]
) -> List[str]:
    """Resolve user-provided region codes via case normalization + alias mapping."""
    if not raw_values:
        return []
    resolved: List[str] = []
    invalid: List[str] = []
    for v in raw_values:
        if not isinstance(v, str) or not v.strip():
            continue
        key_raw = v.strip()
        key_upper = key_raw.upper()
        key_lower = key_raw.lower()

        if key_raw in ALLOWED_REGION_CODES:
            resolved.append(key_raw)
        elif key_upper in ALLOWED_REGION_CODES:
            resolved.append(key_upper)
        elif key_lower in REGION_ALIAS_MAP:
            mapped = REGION_ALIAS_MAP[key_lower]
            resolved.append(mapped)
            validation_messages.append(
                f"region_codes '{key_raw}' 已映射为 '{mapped}'"
            )
        else:
            invalid.append(key_raw)
    if invalid:
        validation_messages.append(
            f"region_codes 中的无效值 {invalid} 已忽略，"
            f"可用值: {sorted(ALLOWED_REGION_CODES)}"
        )
    return list(dict.fromkeys(resolved))


def _resolve_meme_types(
    raw_values: Optional[List[str]], validation_messages: List[str]
) -> List[str]:
    """Resolve user-provided meme types via alias mapping + fuzzy matching."""
    if not raw_values:
        return []
    resolved: List[str] = []
    invalid: List[str] = []
    type_lower_map = {t.lower(): t for t in ALLOWED_MEME_TYPES}
    for v in raw_values:
        if not isinstance(v, str) or not v.strip():
            continue
        key = v.strip()
        if key in ALLOWED_MEME_TYPES:
            resolved.append(key)
        elif key.lower() in type_lower_map:
            resolved.append(type_lower_map[key.lower()])
        elif key.lower() in MEME_TYPE_ALIAS_MAP:
            mapped = MEME_TYPE_ALIAS_MAP[key.lower()]
            resolved.append(mapped)
            validation_messages.append(f"meme_types '{key}' 已映射为 '{mapped}'")
        else:
            invalid.append(key)
    if invalid:
        validation_messages.append(f"meme_types 中的无效值 {invalid} 已忽略")
    return list(dict.fromkeys(resolved))


def _resolve_meme_elements(
    raw_values: Optional[List[str]], validation_messages: List[str]
) -> List[str]:
    """Resolve user-provided meme elements via alias mapping."""
    if not raw_values:
        return []
    resolved: List[str] = []
    invalid: List[str] = []
    for v in raw_values:
        if not isinstance(v, str) or not v.strip():
            continue
        key = v.strip()
        upper = key.upper()
        if upper in ALLOWED_MEME_ELEMENTS:
            resolved.append(upper)
        elif key.lower() in MEME_ELEMENT_ALIAS_MAP:
            mapped = MEME_ELEMENT_ALIAS_MAP[key.lower()]
            resolved.append(mapped)
            validation_messages.append(f"meme_elements '{key}' 已映射为 '{mapped}'")
        else:
            invalid.append(key)
    if invalid:
        validation_messages.append(f"meme_elements 中的无效值 {invalid} 已忽略")
    return list(dict.fromkeys(resolved))


def _build_dimensions(language: str) -> List[str]:
    """Build dimension list based on user language preference."""
    title_field = "title_zh" if language == "Chinese" else "title"
    content_field = "content_zh" if language == "Chinese" else "content"
    meme_type_field = "meme_type_zh" if language == "Chinese" else "meme_type"
    meme_elements_field = "meme_elements_zh" if language == "Chinese" else "meme_elements"
    region_field = "region_code_zh" if language == "Chinese" else "region_code"

    return [
        _m("meme_id"),
        _m(title_field),
        _m(content_field),
        _m("first_channel"),
        _m(meme_type_field),
        _m(meme_elements_field),
        _m(region_field),
        _m("tags"),
        _m("raw_url"),
        _m("hot_time"),
    ]


@function_tool(
    failure_error_function=websearch_fallback_with_rewrite_error_function,
    description_override="""
Query trending memes / viral cultural trends across ALL categories on TikTok and Bilibili. This is a cross-industry market-wide tool covering memes in music, dance, lifestyle, pets, tech, entertainment, and more — NOT limited to gaming. (查询TikTok和Bilibili平台的全行业热梗/文化趋势排行，覆盖所有品类)

DEFAULT BEHAVIOR — IMPORTANT:
- When the user asks a GENERAL meme/trend question without mentioning a specific category, do NOT set meme_types. Leave it null to return ALL categories.
- Only add filters (meme_types, region_codes, channels, etc.) that the user EXPLICITLY requests. Never guess or infer filters from the agent context.
- "What are the trending memes?" → meme_types=null (return all)
- "最近有什么热梗?" → meme_types=null (return all)
- "TikTok上最火的梗是什么?" → meme_types=null, channels=["tiktok"]

WHEN TO USE:
- User asks about trending memes, viral trends, cultural trends, internet culture on TikTok or Bilibili
- Keywords: 热梗, 梗, meme, 文化趋势, 流行梗, 火的梗, viral trend, cultural trend, internet culture
- User asks about content inspiration for social media marketing
- User wants to understand cultural topics beyond video format for content creative ideas

WHEN NOT TO USE:
- User asks about a SPECIFIC GAME's opinion/sentiment/hashtag → use opinion_data_query_tool or get_opinion_analysis_by_topic
- User asks about top videos or top KOLs/creators (NOT memes) → use get_industry_top_videos
- User asks about TikTok hashtag rankings (NOT memes) → use get_tiktok_hashtag_trending
- User asks about game store scores → use get_game_score

Args:
- start_date, end_date (YYYY-MM-DD): Filter by hot_time (when meme became trending). Defaults to last 30 days.
- channels: ["tiktok"] / ["bilibili"] / omit for all. ONLY TikTok and Bilibili are available.
- region_codes: Filter by language/region area. Only set when user explicitly mentions a region/country.
  Available (8): "GLOBAL", "EN", "ZH_CN", "ES", "EN_NA", "SEA_MULTI", "LATAM_MULTI", "KR".
  Supports aliases: "韩国"→KR, "东南亚"→SEA_MULTI, "北美"→EN_NA, "中文区"→ZH_CN, etc.
  Omit for all regions.
- meme_types: Filter by meme category. Only set when user EXPLICITLY mentions a category keyword.
  Keyword → meme_types mapping (use ONLY when user mentions these keywords):
  "音乐"/"流行音乐"/"music" → ["Pop Music Trends"]
  "舞蹈"/"dance" → ["Dance & Movement Trends"]
  "挑战"/"challenge" → ["Challenge & Participation"]
  "萌宠"/"动物"/"pet" → ["Pet & Animal Content"]
  "抽象"/"鬼畜"/"absurd" → ["Absurd & Remix Meme Culture"]
  "科技"/"tech" → ["Technology Trends"]
  "文娱"/"娱乐"/"entertainment" → ["Entertainment & Media Trends"]
  "音频梗"/"audio" → ["Audio Memes"]
  "游戏"/"游戏圈"/"gaming" → ["Gaming Viral Moments"]
  "流行趋势"/"lifestyle" → ["Lifestyle & Cultural Trends"]
  Available (17): "Absurd & Remix Meme Culture", "Audio Memes", "Beautiful Scenery & Aesthetics",
  "Challenge & Participation", "Dance & Movement Trends", "Emotional & Quotes", "Emotional Trends",
  "Entertainment & Media Trends", "Gaming Viral Moments", "Lifestyle & Cultural Trends",
  "Meme & Internet Culture", "Parent and Child", "Pet & Animal Content", "Pop Music Trends",
  "Seasonal & Holiday Trends", "Shock / Curiosity Driven Trends", "Technology Trends".
- meme_elements: Filter by meme format type. Available (6):
  "ABSTRACT_HYBRID", "VISUAL_IDENTITY", "AUDIO_SIGNATURE", "ACTION_GESTURE", "TEXT_EXPRESSION", "NARRATIVE_DRIVEN".
  Supports aliases: "audio"→AUDIO_SIGNATURE, "剧情"→NARRATIVE_DRIVEN, etc.
- meme_names: Search for specific meme(s) by name (case-insensitive). e.g. ["AI Cat Stories", "Red Carpet Boy"].
  Searches top 200, returns matching rows with rank. If not found, reports not in top 200.
- sort_by: "views" (default) / "likes" / "video_count" / "shares" / "comments".
- top_n: Default 10, max 50.

Examples (query → parameters):
- "What are the trending memes recently?" → (no filters, meme_types=null) ← general query, return ALL types
- "最近有什么热梗?" → (no filters, meme_types=null) ← general query, return ALL types
- "最近分享最多的梗是什么?" → sort_by="shares", meme_types=null
- "韩国最近流行什么梗?" → region_codes=["KR"], meme_types=null
- "韩国TikTok上最火的梗top20" → channels=["tiktok"], region_codes=["KR"], top_n=20
- "B站最近什么梗最火?" → channels=["bilibili"], meme_types=null
- "最近有什么音乐相关的梗?" → meme_types=["Pop Music Trends"] ← user explicitly said "音乐"
- "游戏圈最近有什么梗?" → meme_types=["Gaming Viral Moments"] ← user explicitly said "游戏圈"
- "B站上有什么游戏梗?" → channels=["bilibili"], meme_types=["Gaming Viral Moments"]
- "AI Cat Stories这个梗排第几?" → meme_names=["AI Cat Stories"]

OUTPUT FORMAT RULE:
When presenting results, ALWAYS include: rank, meme title, description (content), platform, type, region, views, likes, video_count.
Include the meme description (content field) so users understand what the meme is about.
Include raw_url when available so users can see an example video.
""",
    is_enabled=get_tool_enabled(ToolName.GetIndustryMemeTrending.value),
    readable_name_map={
        "English": "Industry Meme Trending Tool",
        "Chinese": "行业热梗趋势工具",
    },
)
async def get_industry_meme_trending(
    context: RunContextWrapper[GameContext],
    start_date: str = "",
    end_date: str = "",
    channels: Optional[List[str]] = None,
    region_codes: Optional[List[str]] = None,
    meme_types: Optional[List[str]] = None,
    meme_elements: Optional[List[str]] = None,
    meme_names: Optional[List[str]] = None,
    sort_by: Optional[SortBy] = None,
    top_n: int = 10,
) -> Dict[str, Any]:
    """
    查询行业热梗/文化趋势排行数据。

    Args:
        context: 运行上下文
        start_date: 热门时间范围起始 (YYYY-MM-DD)，默认最近14天
        end_date: 热门时间范围结束 (YYYY-MM-DD)
        channels: 渠道过滤 ["tiktok"] / ["bilibili"]
        region_codes: 地区/语言区过滤
        meme_types: 梗类型过滤
        meme_elements: 梗元素/格式过滤
        meme_names: 按梗名搜索（大小写不敏感）
        sort_by: 排序指标
        top_n: 返回前N条，最大50
    """
    try:
        validation_messages: List[str] = []
        beijing_tz = timezone(timedelta(hours=8))
        now = datetime.now(beijing_tz)
        user_language = getattr(context.context, "language", None) or "English"

        # ========== 参数验证 ==========

        final_sort_by: SortBy = ParamValidator.validate_string(
            sort_by, ALLOWED_SORT_BY, "views", "sort_by", validation_messages
        ) or "views"

        final_top_n = ParamValidator.validate_number(
            top_n, 10, "top_n", validation_messages,
            min_value=1, max_value=50, is_integer=True,
        )

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

        try:
            channel_filters = ParamValidator.validate_string_list(
                channels, ALLOWED_CHANNELS, [], "channels", validation_messages,
                transform_func=str.lower,
            )
        except Exception:
            channel_filters = []
            validation_messages.append(
                f"channels 参数值无效，已忽略，将返回所有渠道数据。"
                f"可用渠道: {', '.join(sorted(ALLOWED_CHANNELS))}"
            )

        region_filters = _resolve_region_codes(region_codes, validation_messages)
        type_filters = _resolve_meme_types(meme_types, validation_messages)
        element_filters = _resolve_meme_elements(meme_elements, validation_messages)

        final_meme_names: List[str] = [
            n.strip() for n in (meme_names or []) if n and n.strip()
        ]
        if final_meme_names:
            validation_messages.append(
                f"meme_names 过滤（大小写不敏感）: {final_meme_names}"
            )

        # ========== 构建 Cube Query ==========

        cube_client = get_cube_client()
        transformer = DataTransformer()

        sort_measure = SORT_BY_TO_MEASURE[final_sort_by]

        measures_list = [_m(sort_measure)]
        for measure_name in ["total_views", "total_likes", "total_comments",
                             "total_shares", "video_count"]:
            if _m(measure_name) not in measures_list:
                measures_list.append(_m(measure_name))

        dimensions_list = _build_dimensions(user_language)

        filters_list: List[CubeFilter] = []

        # hot_time is stored as string "YYYY-MM-DD HH:MM:SS", use gte/lte for range filter
        if start_date:
            filters_list.append(CubeFilter(
                member=_m("hot_time"),
                operator="gte",
                values=[f"{start_date} 00:00:00"],
            ))
        if end_date:
            filters_list.append(CubeFilter(
                member=_m("hot_time"),
                operator="lte",
                values=[f"{end_date} 23:59:59"],
            ))

        if channel_filters:
            filters_list.append(CubeFilter(
                member=_m("first_channel"),
                operator="equals" if len(channel_filters) == 1 else "in",
                values=channel_filters,
            ))
            validation_messages.append(f"过滤渠道: {', '.join(channel_filters)}")

        if region_filters:
            filters_list.append(CubeFilter(
                member=_m("region_code"),
                operator="equals" if len(region_filters) == 1 else "in",
                values=region_filters,
            ))
            validation_messages.append(f"过滤地区: {', '.join(region_filters)}")

        if type_filters:
            filters_list.append(CubeFilter(
                member=_m("meme_type"),
                operator="equals" if len(type_filters) == 1 else "in",
                values=type_filters,
            ))
            validation_messages.append(f"过滤梗类型: {', '.join(type_filters)}")

        if element_filters:
            filters_list.append(CubeFilter(
                member=_m("meme_elements"),
                operator="equals" if len(element_filters) == 1 else "in",
                values=element_filters,
            ))
            validation_messages.append(f"过滤梗元素: {', '.join(element_filters)}")

        MEME_LOOKUP_LIMIT = 200
        cube_limit = MEME_LOOKUP_LIMIT if final_meme_names else final_top_n

        query = Query(
            measures=measures_list,
            dimensions=dimensions_list,
            timeDimensions=[],
            filters=filters_list,
            limit=cube_limit,
            order={_m(sort_measure): "desc"},
        )

        # ========== 执行查询 ==========

        logger.info(
            f"[get_industry_meme_trending] sort_by={final_sort_by} "
            f"top_n={final_top_n} hot_time={start_date}~{end_date}"
        )

        data = await read_cube_data(cube_client, transformer, query, language=user_language)

        # ========== 处理结果 ==========

        if data.get("code") == 0:
            data_id = f"industry_meme_{uuid.uuid4()}"

            raw_data = data["data"]["data"]

            for record in raw_data:
                for key, value in record.items():
                    if isinstance(value, str) and ("title" in key.lower() or "content" in key.lower()):
                        record[key] = value.replace("|", "｜")

            df = pd.DataFrame(raw_data)

            logger.info(
                f"[get_industry_meme_trending] transformer返回列: {list(df.columns)}, 行数: {len(df)}"
            )

            if df.empty:
                raise NoResultException(
                    message="未找到符合条件的行业热梗数据，尝试通过网络搜索获取信息。",
                    search_query=context.context.planner_context.rephrased_question,
                    use_web_search=True,
                )

            df.insert(0, "rank", range(1, len(df) + 1))

            if final_meme_names:
                name_set = {_normalize_meme_name(n) for n in final_meme_names}
                df = df[df["meme_id"].apply(
                    lambda x: _normalize_meme_name(str(x)) in name_set
                )]
                if df.empty:
                    raise NoResultException(
                        message=(
                            f"在 {final_sort_by} 排名前 {MEME_LOOKUP_LIMIT} 名中未找到梗 {final_meme_names}，"
                            "请确认名称拼写或尝试通过网络搜索获取信息。"
                        ),
                        search_query=context.context.planner_context.rephrased_question,
                        use_web_search=True,
                    )
            else:
                df = df.head(final_top_n)

            desired_order = [col for col in [
                "rank",
                "meme_id",
                "title", "title_zh",
                "content", "content_zh",
                "first_channel",
                "meme_type", "meme_type_zh",
                "meme_elements", "meme_elements_zh",
                "region_code", "region_code_zh",
                "tags",
                "hot_time",
                "raw_url",
                "total_views", "total_likes", "total_comments",
                "total_shares", "video_count",
            ] if col in df.columns]
            remaining = [c for c in df.columns if c not in desired_order]
            df = df[desired_order + remaining]

            context.context.data.append({
                "data": data,
                "data_id": data_id,
                "system": "industry_meme",
            })

            result = {
                "data": truncate_output(df.to_csv(index=False)),
                "data_id": data_id,
                "system": "industry_meme",
                "summary": {
                    "total_rows": len(df),
                    "sort_by": final_sort_by,
                    "date_range": f"{start_date} to {end_date}",
                    "channels": channel_filters or ["tiktok", "bilibili"],
                    "region_codes": region_filters or "all",
                    "meme_types": type_filters or "all",
                    "meme_elements": element_filters or "all",
                    "meme_names": final_meme_names or "all",
                    "note": (
                        "每行代表一个热门梗/文化趋势，包含梗的描述、覆盖平台、类型、地区和聚合指标。"
                        "hot_time 表示该梗成为热门的时间。content 字段包含梗的详细解读。"
                    ) if user_language == "Chinese" else (
                        "Each row represents a trending meme/cultural trend with description, platform, type, "
                        "region, and aggregated metrics. hot_time indicates when the meme became trending. "
                        "The content field contains detailed explanation of the meme."
                    ),
                },
            }

            if validation_messages:
                result["field_modifications"] = validation_messages

            logger.info(f"[get_industry_meme_trending] 查询成功，返回 {len(df)} 条记录")
            return result

        elif data.get("code") == 1:
            raise NoResultException(
                message=f"行业热梗数据查询失败: {data.get('data', {}).get('error', '未知错误')}，尝试通过网络搜索获取信息。",
                search_query=context.context.planner_context.rephrased_question,
                use_web_search=True,
            )

        else:
            return truncate_output(data)

    except NoResultException:
        raise

    except Exception as e:
        logger.error(f"[get_industry_meme_trending] 执行失败: {e}")
        raise NoResultException(
            message=f"行业热梗数据查询异常: {str(e)}，尝试通过网络搜索获取信息。",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )
