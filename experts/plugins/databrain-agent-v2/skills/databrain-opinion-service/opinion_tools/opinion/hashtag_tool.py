"""
TikTok Hashtag Trending Tool - 获取TikTok热门标签的峰值观看量和视频数（30天）

This tool queries the industry_hashtag view from Cube to get:
- Peak views count (last 30 days) - dedup ranked by this metric
- Videos count (last 30 days) - only when explicitly requested
- Peak date (peck_date) - always included
- By category, country, and hashtag
"""

import pandas as pd
import uuid
from typing import List, Optional, Dict, Any, Literal
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


# ---- 允许的枚举值 ----
# 只支持最近30天的数据, 因为去重逻辑中排序是按照views_last_30_days进行的, 所以只能支持最近30天的数据
ALLOWED_METRICS: set[str] = {
    "videos_last_30_days",
    "views_last_30_days",
}
# 去重完以后的排序方式
RankBy = Literal["views_30d", "videos_30d"]

# cube view name
CUBE_MEMBER_PREFIX = "industry_hashtag"


def _validate_metrics(metrics: Optional[List[str]], validation_messages: List[str]) -> List[str]:
    """
    Validate metrics for this tool.

    Default: only views_last_30_days (peak views). videos_last_30_days is only added
    when LLM explicitly passes it (user asked about video count).

    IMPORTANT: Do NOT use ParamValidator.validate_string_list here because its normalization
    strips digits (e.g. `views_last_30_days` vs `videos_last_30_days`) and would collapse them.
    """
    default_metrics = ["views_last_30_days"]

    if metrics is None:
        validation_messages.append(f"参数 metrics 未提供，使用默认值: {default_metrics}")
        return list(default_metrics)

    if not isinstance(metrics, list):
        validation_messages.append(f"参数 metrics 类型无效({type(metrics)})，使用默认值: {default_metrics}")
        return list(default_metrics)

    cleaned: List[str] = []
    invalid: List[str] = []
    for m in metrics:
        if not isinstance(m, str) or not m.strip():
            invalid.append(str(m))
            continue
        m2 = m.strip()
        if m2 in ALLOWED_METRICS:
            cleaned.append(m2)
        else:
            invalid.append(m2)

    # de-duplicate while preserving order
    deduped = list(dict.fromkeys(cleaned))

    if invalid:
        validation_messages.append(f"参数 metrics 中的无效值 [{', '.join(invalid)}] 已被忽略")

    if not deduped:
        validation_messages.append(f"参数 metrics 全部无效，使用默认值: {default_metrics}")
        return list(default_metrics)

    return deduped


def _normalize_hashtags(values: List[str]) -> List[str]:
    """
    Normalize hashtag inputs to increase match rate.

    Data may store hashtags with or without '#'. For each input, try both forms:
    - raw (trimmed)
    - raw without leading '#'
    - raw with leading '#'
    """
    out: List[str] = []
    for v in values or []:
        if not isinstance(v, str):
            continue
        s = v.strip()
        if not s:
            continue
        base = s.lstrip("#").strip().lower()
        if not base:
            continue
        s_lower = s.lower() if not s.startswith("#") else f"#{base}"
        candidates = [s_lower, base, f"#{base}"]
        for c in candidates:
            c2 = c.strip()
            if c2 and c2 not in out:
                out.append(c2)
    return out


def _infer_rank_by_from_metrics(metrics: List[str]) -> RankBy:
    """
    Infer rank_by from the selected metrics as a language-agnostic fallback.

    Simplified: only 30-day metrics exist now.
    - If only videos metric is present (no views) -> videos_30d
    - Otherwise -> views_30d (default, matches dedup ordering)
    """
    metrics = metrics or []
    has_views = any(m.startswith("views_") for m in metrics)
    has_videos = any(m.startswith("videos_") for m in metrics)

    if has_videos and not has_views:
        return "videos_30d"
    return "views_30d"


def _rank_by_to_metric(rank_by: RankBy) -> str:
    """Map rank_by token to cube measure name."""
    mapping = {
        "views_30d": "views_last_30_days",
        "videos_30d": "videos_last_30_days",
    }
    return mapping.get(rank_by, "views_last_30_days")


@function_tool(
    failure_error_function=websearch_fallback_with_rewrite_error_function,
    description_override="""
Query TikTok hashtag trending data: rankings, views, video counts, and peak dates by country. (查询TikTok平台热门标签排名数据)

WHEN TO USE:
- User asks any TikTok hashtag ranking/trending/popularity query without a specific game name.
- User asks whether a specific game hashtag is trending on TikTok (e.g., "#hok").
- Users asks about the general trending hashtags on Tiktok
    Example:
    - "最近TikTok上最热门的标签是什么？"
    - "今天美国top10的标签有哪些？"
    - "最近#mlbb标签在tiktok的火热程度如何？"

WHEN NOT TO USE — CRITICAL, route to the correct tool based on what the user needs:
- User asks about likes, shares, engagement rate, followers, saves, interaction rate for a hashtag → use opinion_data_query_tool (hotness table has these metrics; get_opinion_analysis_by_topic does NOT have likes/shares).
- User asks which country/region/language gets most engagement/likes for a hashtag → use opinion_data_query_tool (group by country/language, metric=likes or engagement).
- User asks WHO IS discussing, breakdown by country/region/language/channel → use opinion_data_query_tool (supports group by country, language, channel_code).
- User asks about demographic segments (age, gender, player level) — NO tool has true demographic data; use opinion_data_query_tool for region/language breakdown as closest approximation.
- User asks for sentiment, user opinions, representative posts/comments, or deep content analysis → use get_opinion_analysis_by_topic.
- When a game is mentioned, use other tools instead (unless user explicitly asks about TikTok view count / video count trending for that game's hashtag).
- Need comprehensive understanding and analysis of a specific game hashtag's content aspects → use get_opinion_analysis_by_topic.
    
DATA NOTE: Data is deduplicated by views_last_30_days — each hashtag per country keeps only the snapshot with the highest 30-day views. peck_date = date when 30-day views peaked (always returned automatically). In every answer, tell the user: "数据按最近30天观看量进行去重排序", and mention peck_date.

Args:
- countries: ISO 2-letter codes. Available (31): "global","id","us","vn","br","pk","fr","de","es","gb","it","nl","pl","tr","mx","co","ar","ca","eg","sa","ae","qa","th","my","ph","jp","kr","au","nz","sg","ng". Default: ["global"].
- top_n: Number of top hashtags to return. Default: 10, Max: 100.
- hashtags: Filter to specific hashtags, e.g. ["#gaming"]. Auto-normalizes case and #-prefix. Leave empty for top trending. For comparisons, pass ALL tags in one call: ["#hok", "#mlbb"].
- rank_by: "views_30d" (default) or "videos_30d". Controls Top-N sort order.
- metrics: ["views_last_30_days"] (default) or add "videos_last_30_days" only when user asks for video count.
- start_date, end_date (YYYY-MM-DD): Time range filter. Defaults to last 30 days.
- categories: NON-FUNCTIONAL — ignore if provided.

Examples:
- Top 10 globally: countries=["global"], top_n=10
- Top 50 in US: countries=["us"], top_n=50
- Specific hashtag: hashtags=["#pubgm"], countries=["global"]
- Compare hashtags: hashtags=["#honorofkings", "#mlbb"], countries=["global"]
- Rank by video count: rank_by="videos_30d"
- With video count metric: metrics=["views_last_30_days", "videos_last_30_days"]

RULES:
- Only call this tool when the user's intent is STRICTLY about hashtag view count ranking or video count ranking or if this is a trending hashtag. If the query mentions any other metric not listed in Args above, skip this tool entirely.
- If this tool returns no data or fails, use websearch (llm_websearch_tool) as fallback.
- rank_by="videos_30d" when user asks for video-volume ranking (视频数最多/most videos).
- For comparisons, put ALL hashtags in ONE call; never make separate calls per hashtag.
- In every final answer: explain dedup logic ("数据按最近30天观看量进行去重排序") and mention peck_date.
""",
    is_enabled=get_tool_enabled(ToolName.GetHashtagTrending.value),
    readable_name_map={
        "English": "TikTok Hashtag Trending Tool",
        "Chinese": "TikTok标签趋势工具",
    }
)
async def get_tiktok_hashtag_trending(
    context: RunContextWrapper[GameContext],
    metrics: Optional[List[str]] = None,
    start_date: str = "",
    end_date: str = "",
    rank_by: Optional[RankBy] = None,
    categories: Optional[List[str]] = None,
    countries: Optional[List[str]] = None,
    hashtags: Optional[List[str]] = None,
    top_n: int = 10,
) -> Dict[str, Any]:
    """
    获取TikTok热门标签的峰值观看量（30天）和视频数数据
    
    Args:
        context: 运行上下文
        metrics: 指标列表，支持 views_last_30_days, videos_last_30_days（peck_date 始终自动包含）
        start_date: 开始日期 (YYYY-MM-DD)
        end_date: 结束日期 (YYYY-MM-DD)
        categories: 分类过滤列表
        countries: 国家代码过滤列表
        hashtags: 特定标签过滤列表
        top_n: 返回Top N个标签，默认10（数据按 views_last_30_days 降序固定排序）
    
    Note:
        - 去重逻辑基于 views_last_30_days，因此该指标最准确
        - peck_date（峰值日期）始终返回，不受 metrics 参数控制
        - TopN 的排序口径由 rank_by 控制（工具内部固定下推到 Cube order），不对外暴露自由 order_by
    """
    
    try:
        validation_messages = []
        beijing_tz = timezone(timedelta(hours=8))
        now = datetime.now(beijing_tz)
        user_language = getattr(context.context, "language", None) or "English"
        
        # ========== 参数验证和默认值设置 ==========
        
        # 验证并设置 metrics 默认值（不能用 ParamValidator.validate_string_list：会把 7/30 的数字都去掉导致冲突）
        req_metrics = _validate_metrics(metrics, validation_messages)

        # Decide ranking metric (Top-N ordering).
        # Prefer explicit rank_by; fallback to metrics-based inference (language-agnostic); final default views_30d.
        final_rank_by: RankBy = rank_by or _infer_rank_by_from_metrics(req_metrics) or "views_30d"
        rank_metric = _rank_by_to_metric(final_rank_by)

        if rank_metric not in req_metrics:
            req_metrics.append(rank_metric)
            validation_messages.append(
                f"为保证TopN排序，已自动补充排序指标: {rank_metric} (rank_by={final_rank_by})"
            )
        
        # 设置时间范围（默认最近30天），并校验/纠正日期格式
        default_start = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        default_end = now.strftime("%Y-%m-%d")

        if not start_date:
            start_date = default_start
            validation_messages.append(f"start_date未指定，默认使用30天前: {start_date}")
        else:
            start_date = ParamValidator.validate_datetime(
                start_date,
                default_start,
                "start_date",
                validation_messages,
                required_format="%Y-%m-%d",
            )

        if not end_date:
            end_date = default_end
            validation_messages.append(f"end_date未指定，默认使用今天: {end_date}")
        else:
            end_date = ParamValidator.validate_datetime(
                end_date,
                default_end,
                "end_date",
                validation_messages,
                required_format="%Y-%m-%d",
            )

        # 纠正 start_date > end_date
        if start_date and end_date and start_date > end_date:
            validation_messages.append(
                f"start_date({start_date}) 大于 end_date({end_date})，已自动交换"
            )
            start_date, end_date = end_date, start_date

        date_range = [start_date, end_date]
        
        # 验证 top_n 范围
        if top_n <= 0 or top_n > 100:
            top_n = 100
            validation_messages.append("top_n超出范围(1-100)，默认使用100")
        
        # 验证并清理 categories, countries, hashtags 列表
        category_filters = ParamValidator.validate_string_list(
            categories, None, [], "categories", validation_messages
        )
        
        country_filters = ParamValidator.validate_string_list(
            countries, None, [], "countries", validation_messages, transform_func=str.lower
        )
        
        hashtag_filters = ParamValidator.validate_string_list(
            hashtags, None, [], "hashtags", validation_messages
        )

        # ---- Apply business semantics & safer defaults ----
        # 1) categories are currently non-functional; do NOT push down to Cube to avoid empty results.
        if category_filters:
            validation_messages.append(
                f"categories 当前数据不支持（仅有 All Categories），已忽略: {', '.join(category_filters)}"
            )
            category_filters = []

        # 2) Default country scope: global (avoid mixing countries with MAX-based measures).
        if not country_filters:
            country_filters = ["global"]
            validation_messages.append("countries 未指定，默认使用 ['global']（避免多国家混合导致语义不稳定）")

        # 3) Normalize hashtags to match stored forms with/without leading '#'.
        if hashtag_filters:
            normalized_hashtags = _normalize_hashtags(hashtag_filters)
            if normalized_hashtags != hashtag_filters:
                validation_messages.append(
                    f"hashtags 已自动规范化（兼容带#或不带#）: {', '.join(hashtag_filters)} -> {', '.join(normalized_hashtags)}"
                )
            hashtag_filters = normalized_hashtags
        
        # ========== 构建 Cube 查询 ==========
        
        cube_client = get_cube_client()
        transformer = DataTransformer()
        
        # 构建 measures 列表（映射到 cube 中的字段名）
        # 注意：按照UI的顺序（views在前，videos在后），确保与UI查询完全一致
        measures_list = []
        # 先添加 views 指标
        views_metrics = [m for m in req_metrics if 'views' in m]
        # 再添加 videos 指标
        videos_metrics = [m for m in req_metrics if 'videos' in m]
        # 按 views → videos 顺序添加
        for metric in views_metrics + videos_metrics:
            measures_list.append(f"{CUBE_MEMBER_PREFIX}.{metric}")
        
        # 始终包含峰值日期（peck_date）—— 不受 metrics 参数控制，每次查询都返回
        measures_list.append(f"{CUBE_MEMBER_PREFIX}.peck_date")
        
        # 构建 dimensions 列表
        dimensions_list = [
            f"{CUBE_MEMBER_PREFIX}.hashtag",  # 标签名称（必需）
        ]
        
        # 根据是否需要区分国家来决定是否添加到 dimensions（多国家才输出 country_code 列）
        if len(country_filters) > 1:
            dimensions_list.append(f"{CUBE_MEMBER_PREFIX}.country_code")
        
        # 构建 filters 列表
        # 注意：按照UI的顺序（date在前，country在后），确保与UI查询完全一致
        filters_list: List[CubeFilter] = []
        
        # 1. 添加 date 过滤（使用 inDateRange 而非 timeDimensions，以匹配 UI 查询方式）
        # 这样可以确保 Cube 的条件聚合逻辑 COUNT(DISTINCT date) 计算方式与 UI 一致
        filters_list.append(
            CubeFilter(
                member=f"{CUBE_MEMBER_PREFIX}.date",
                operator="inDateRange",
                values=date_range
            )
        )
        
        # 2. 添加 country 过滤
        if country_filters:
            filters_list.append(
                CubeFilter(
                    member=f"{CUBE_MEMBER_PREFIX}.country_code",
                    operator="equals" if len(country_filters) == 1 else "in",
                    values=country_filters
                )
            )
            validation_messages.append(f"过滤国家: {', '.join(country_filters)}")
        
        # 3. 添加 hashtag 过滤（如果有）
        if hashtag_filters:
            filters_list.append(
                CubeFilter(
                    member=f"{CUBE_MEMBER_PREFIX}.hashtag",
                    operator="in",
                    values=hashtag_filters
                )
            )
            validation_messages.append(f"过滤标签: {', '.join(hashtag_filters)}")
        
        # 构建 Query 对象
        # 注意：使用空的 timeDimensions 数组，日期过滤通过 filters 实现（与 UI 一致）
        query = Query(
            measures=measures_list,
            dimensions=dimensions_list,
            timeDimensions=[],
            filters=filters_list,
            limit=10000,  # 这边和cube配置的limit保持一致
            order={f"{CUBE_MEMBER_PREFIX}.{rank_metric}": "desc"},
        )
        
        # ========== 执行查询 ==========
        
        data = await read_cube_data(cube_client, transformer, query, language=user_language)
        
        # 检查返回状态
        if data.get("code") == 0:
            # 查询成功，分配 data_id
            data_id = f"hashtag_cube_{uuid.uuid4()}"
            
            # 转换为 CSV 格式
            df = pd.DataFrame(data["data"]["data"])
            
            if len(df) == 0:
                raise NoResultException(
                    message=f"未找到符合条件的TikTok标签数据，尝试通过网络搜索获取信息。",
                    search_query=context.context.planner_context.rephrased_question,
                    use_web_search=True,
                )
            
            # 格式化 peck_date：Cube 返回的是 UTC 时间（如 "2026-02-09 16:00:00"），
            # 需要先转换为北京时间（UTC+8），再截取日期部分（"2026-02-10"）。
            # 注意：DataTransformer._preprocess_dataframe 会把列名前缀去掉，
            # 所以此处列名是 "peck_date" 而非 "industry_hashtag.peck_date"。
            peck_date_col = "peck_date"
            if peck_date_col in df.columns:
                df[peck_date_col] = (
                    pd.to_datetime(df[peck_date_col], errors="coerce", utc=True)
                    .dt.tz_convert("Asia/Shanghai")
                    .dt.strftime("%Y-%m-%d")
                )
            
            # 截取top_n条记录（因为query的limit设置为10000，需要手动截取）
            df = df.head(top_n)
            
            # 添加到 context
            context.context.data.append({
                "data": data,
                "data_id": data_id,
                "system": "opinion_hashtag",
            })
            
            # 构建返回结果
            result = {
                "data": truncate_output(df.to_csv(index=False)),
                "data_id": data_id,
                "system": "opinion_hashtag",
                "summary": {
                    "total_hashtags": len(df),
                    "date_range": f"{date_range[0]} to {date_range[1]}",
                    "date_range_semantics": "Date range filter using inDateRange operator (matches UI query structure; multi-day ranges trigger Cube conditional logic)",
                    "rank_by": final_rank_by,
                    "rank_metric": rank_metric,
                    "metrics_queried": req_metrics,
                    "countries": country_filters,
                    "sorted_by": f"{rank_metric} desc (tool-fixed via rank_by={final_rank_by})",
                    "dedup_explanation": (
                        "数据基于最近30天观看量(views_last_30_days)进行去重排序，"
                        "每个hashtag在每个国家下仅保留观看量最高的一条快照数据。"
                        "因此views_last_30_days是最准确的指标，videos_last_30_days仅供参考。"
                    ) if user_language == "Chinese" else (
                        "Data is deduplicated and ranked by views_last_30_days (30-day views). "
                        "Each hashtag per country keeps only the snapshot with the highest 30-day views. "
                        "Therefore views_last_30_days is the most accurate metric; videos_last_30_days is approximate."
                    ),
                    "peak_date_note": (
                        "peck_date表示该hashtag在查询时间范围内30天观看量达到峰值的日期，请在回复中告知用户该日期。"
                    ) if user_language == "Chinese" else (
                        "peck_date indicates the date when 30-day views peaked for that hashtag "
                        "within the queried time range. Please mention this date in your reply to the user."
                    ),
                },
            }
            
            # 添加参数调整信息
            if validation_messages:
                result["field_modifications"] = validation_messages
            
            logger.info(f"[get_tiktok_hashtag_trending] 查询成功，返回 {len(df)} 条记录")
            return result
        
        elif data.get("code") == 1:
            # 查询失败：仅在明确无数据时返回无数据文案，其余统一未知错误
            error_data = data.get("data") if isinstance(data.get("data"), dict) else {}
            raw_error = (
                data.get("message")
                or data.get("msg")
                or error_data.get("error")
                or ""
            )
            error_text = str(raw_error)

            is_no_data = "No data found" in error_text
            display_error = "未找到符合条件的TikTok标签数据" if is_no_data else "未知错误"

            raise NoResultException(
                message=f"TikTok标签数据查询失败: {display_error}，尝试通过网络搜索获取信息。",
                search_query=context.context.planner_context.rephrased_question,
                use_web_search=True,
            )
        
        else:
            # 其他状态码，返回原始数据
            return truncate_output(data)
    
    except NoResultException:
        # 直接抛出 NoResultException
        raise
    
    except Exception as e:
        logger.error(f"[get_tiktok_hashtag_trending] 执行失败: {e}")
        raise NoResultException(
            message=f"TikTok标签数据查询异常: {str(e)}，尝试通过网络搜索获取信息。",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )
