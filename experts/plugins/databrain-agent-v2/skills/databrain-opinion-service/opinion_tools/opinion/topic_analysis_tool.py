"""
话题综合分析工具 - Topic Analysis Tool
提供话题的综合分析：metrics + representative content
"""

import asyncio
import csv
import uuid
from datetime import datetime, timedelta
from io import StringIO
from typing import List, Dict, Any, Optional, Union
import time

from loguru import logger

from run_context_wrapper import RunContextWrapper
from opinion_strategy.context import GameContext
from opinion_tools.cube.cube_model import Filter, FilterGroup
from opinion_tools.opinion.opinion_tools import _ensure_game_ids
from opinion_tools.opinion.services.topic_metrics_service import _get_metrics_by_topic
from opinion_tools.opinion.services.topic_content_service import _get_top_content_by_topic
from opinion_tools.opinion.utils.utils import truncate_output
from opinion_tools.opinion.utils.metric_kb_injector import inject_metric_kb
from opinion_tools.tool_common import get_tool_enabled, function_tool
from opinion_strategy.constants import ToolName
from opinion_utils.helper import websearch_fallback_with_rewrite_error_function
from opinion_utils.exceptions import NoResultException

# 复用 summary_tool 的参数验证逻辑
from opinion_tools.opinion.utils.param_validator import ParamValidator, ParamValidationError
from opinion_tools.opinion.data.channel_map import map_channels_to_code, get_channel_type
from opinion_tools.opinion.data.language_map import map_languages_to_iso
from opinion_tools.opinion.services.opinion_report_card import OpinionReportCardCreator

# 常量定义
FEEDS_TOPIC = "feeds_topic"

# ---- Allowed Enumerations / 允许的枚举值 ----
ALLOWED_CHANNEL_CATEGORY: set[str] = {"social", "game_store"}
ALLOWED_SENTIMENT: set[str] = {"positive", "negative", "neutral"}
ALLOWED_CONTENT_TYPES: set[str] = {"metrics", "ratio", "comments"}

# channel_code 使用智能映射函数 map_channels_to_code 进行验证和规范化
# 支持多种输入格式：自然语言("Youtube")、标准代码("youtube_keyword")、别名("X" → "twitter")等
# 支持 112 种渠道代码，自动映射到标准格式

# language_code 使用智能映射函数 map_languages_to_iso 进行验证和规范化
# 支持多种输入格式：自然语言("Chinese")、ISO代码("zh")、别名("Simplified Chinese")等
# 自动映射到标准的 BCP 47 / IETF 语言标签格式


def _build_web_search_query(
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    topics: List[str],
    start_date: str,
    end_date: str,
) -> str:
    planner_context = getattr(context.context, "planner_context", None)
    query = (
        getattr(planner_context, "rephrased_question", "")
        or getattr(context.context, "user_input", "")
        or getattr(context.context, "query", "")
    )
    if query:
        return query
    return (
        f"{', '.join(game_names)} {' '.join(topics)} player opinions "
        f"{start_date} {end_date}"
    ).strip()


async def _execute_topic_analysis(
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    game_ids: List[str],
    topics: List[str],
    start_date: str,
    end_date: str,
    include_metrics: bool,
    include_ratio: bool,
    include_content: bool,
    include_trend: bool,
    time_granularity: str,
    top_n: int,
    measures: List[str],
    filters: Optional[List[Union[Filter, FilterGroup]]],
) -> Dict[str, Any]:
    """
    执行话题分析的内部编排函数（类似 summary_tool 的 _select_strategy_and_execute）
    
    并发调用两个基础服务：
    1. _get_metrics_by_topic - 获取话题指标
    2. _get_top_content_by_topic - 获取代表性内容
    
    Args:
        见主函数参数说明
        
    Returns:
        Dict: {
            "metrics_result": {...},  # metrics 服务的原始结果
            "content_result": {...},  # content 服务的原始结果
            "summary": "..."          # 简单总结
        }
    """
    logger.info(f"【_execute_topic_analysis】开始执行，话题: {topics}")
    
    # 必须至少包含 metrics/ratio/content 之一
    if not include_metrics and not include_ratio and not include_content:
        raise ValueError("content must include at least one of: metrics, ratio, or comments")
    
    # ============ 并发执行 metrics 和 content 查询 ============
    tasks = []
    task_names = []
    
    if include_metrics or include_ratio:
        logger.info(f"【_execute_topic_analysis】添加 metrics 任务（include_ratio={include_ratio}）")
        metrics_task = _get_metrics_by_topic(
            context=context,
            topics=topics,
            game_names=game_names,
            game_ids=game_ids,
            start_date=start_date,
            end_date=end_date,
            time_granularity=time_granularity,
            include_trend=include_trend,
            measures=measures,
            filters=filters,
        )
        tasks.append(metrics_task)
        task_names.append("metrics")
    
    if include_content:
        logger.info(f"【_execute_topic_analysis】添加 content 任务")
        content_task = _get_top_content_by_topic(
            context=context,
            topics=topics,
            game_names=game_names,
            start_date=start_date,
            end_date=end_date,
            top_n=top_n,
            filters=filters,
            dimensions=None, #自动按照COMPULSORY_DIMENSIONS查询
        )
        tasks.append(content_task)
        task_names.append("content")
    
    # 并发执行所有任务
    logger.info(f"【_execute_topic_analysis】开始并发执行: {task_names}")
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # 处理结果
    metrics_result = None
    content_result = None
    web_search_reasons = []
    web_search_missing_parts = set()
    
    for task_name, result in zip(task_names, results):
        if isinstance(result, Exception):
            logger.warning(f"【_execute_topic_analysis】{task_name} 查询失败: {result}")
            if isinstance(result, NoResultException):
                web_search_reasons.append(f"{task_name}: {result.message or str(result)}")
                web_search_missing_parts.add(task_name)
                continue
            if task_name == "metrics" and include_metrics:
                # metrics 失败则抛出异常
                raise result
            # content 失败可以容错
        else:
            # 验证 result 是字典类型
            if not isinstance(result, dict):
                logger.error(f"【_execute_topic_analysis】{task_name} 返回类型错误: 期望 dict，实际 {type(result).__name__}，值: {str(result)[:200]}")
                if task_name == "metrics" and include_metrics:
                    raise TypeError(f"{task_name} returned wrong type: expected dict, got {type(result).__name__}")
                continue  # content 可以容错，跳过
            
            if task_name == "metrics":
                metrics_result = result
                logger.info(f"【_execute_topic_analysis】metrics 查询成功，data_id: {result.get('data_id', 'N/A')}")
            elif task_name == "content":
                content_result = result
                logger.info(f"【_execute_topic_analysis】content 查询成功，data_id: {result.get('data_id', 'N/A')}")
    
    # ============ 生成简单总结 ============
    summary_parts = []
    summary_parts.append(f"Analyzed {len(topics)} topic(s): {', '.join(topics)}")
    
    # 只有当数据真正有效时才添加到 summary
    if (include_metrics or include_ratio) and metrics_result:
        data_field = metrics_result.get("data", "")
        if data_field and (not isinstance(data_field, str) or data_field.strip()):
            if include_ratio:
                summary_parts.append("Metrics data, ratio, and trend retrieved")
            else:
                summary_parts.append("Metrics data and trend retrieved")
    
    if include_content and content_result:
        data_field = content_result.get("data", "")
        if data_field and (not isinstance(data_field, str) or data_field.strip()):
            summary_parts.append("Representative comments retrieved")
    
    # 验证每个被请求的部分是否都有有效数据
    # 用于记录哪些部分失败了和成功
    failed_parts = []
    success_parts = []
    supplemental_parts = []
    
    # 验证 metrics 数据（如果被请求）
    has_valid_metrics = False
    if include_metrics or include_ratio:
        if not metrics_result:
            if "metrics" in web_search_missing_parts:
                supplemental_parts.append("metrics data unavailable from Databrain; web search supplement is needed")
            else:
                failed_parts.append("metrics data (query returned None)")
        elif not isinstance(metrics_result, dict):
            failed_parts.append("metrics data (wrong return type)")
        else:
            # 检查 data 字段是否有有效数据
            data_field = metrics_result.get("data", "")
            if not data_field or (isinstance(data_field, str) and not data_field.strip()):
                failed_parts.append("metrics data (data field is empty)")
            else:
                has_valid_metrics = True
                success_parts.append("metrics data")
    
    # 验证 content 数据（如果被请求）
    has_valid_content = False
    if include_content:
        if not content_result:
            if "content" in web_search_missing_parts:
                supplemental_parts.append("representative comments unavailable from Databrain; web search supplement is needed")
            else:
                failed_parts.append("representative comments (content query returned None)")
        elif not isinstance(content_result, dict):
            failed_parts.append("representative comments (wrong return type)")
        else:
            # 检查 data 字段是否有有效数据
            data_field = content_result.get("data", "")
            if not data_field or (isinstance(data_field, str) and not data_field.strip()):
                failed_parts.append("representative comments (data field is empty)")
            else:
                # 统计总评论数（使用 csv.DictReader，性能最优）
                try:
                    reader = csv.DictReader(StringIO(data_field))
                    total_comments = sum(int(row.get("count", 0)) for row in reader)
                    
                    if total_comments < 100:
                        has_valid_content = True
                        success_parts.append(f"representative comments ({total_comments} items, below 100 threshold)")
                        supplemental_parts.append(
                            f"representative comments below threshold (only {total_comments}, need >=100); web search supplement is needed"
                        )
                        logger.warning(f"【_execute_topic_analysis】insufficient comments, topics: {topics}, total: {total_comments}")
                    else:
                        has_valid_content = True
                        success_parts.append(f"representative comments ({total_comments} items)")
                        logger.info(f"【_execute_topic_analysis】content query succeeded, total comments: {total_comments}")
                except Exception as e:
                    # CSV解析失败，当作数据不足处理
                    logger.warning(f"【_execute_topic_analysis】unable to count comments: {e}, treating as insufficient")
                    failed_parts.append("representative comments (unable to count)")
    
    # 如果有任何被请求的部分失败，触发 websearch
    if failed_parts:
        failed_description = ", ".join(failed_parts)
        logger.warning(f"【_execute_topic_analysis】partial query failure, topics: {topics}, failed: {failed_description}")
        supplemental_parts.append(
            f"partial Databrain topic analysis data missing ({failed_description}); web search supplement is needed"
        )
        web_search_reasons.append(f"partial query failure: {failed_description}")
    
    summary = ". ".join(summary_parts)
    
    return {
        "metrics_result": metrics_result,
        "content_result": content_result,
        "supplemental_parts": supplemental_parts,
        "web_search_reasons": web_search_reasons,
        "summary": summary,
    }


@function_tool(
    failure_error_function=websearch_fallback_with_rewrite_error_function,
    description_override="""
Get comprehensive opinion analysis for SPECIFIC topics. 分析特定话题的舆情情况，获取指标和代表性评论。

WHEN TO USE:
- User asks about SPECIFIC topics/keywords (e.g., "外挂问题", "G-Dragon联名", "bugs discussion")
- Need comprehensive understanding of specific game aspects
- DO NOT use for general questions like "玩家评价如何" → use get_opinion_summary_report instead

CORE FEATURES:
Topic analysis: Metric and content analysis for specific topics/keywords.

Args:
- topics: **REQUIRED** A list of specific topics/keywords. NOT sentiment types (positive/negative/neutral)
  Examples: ["monetization", "server issues"], ["bug", "gameplay", "graphics"] for English;
  ["氪金", "服务器问题"], ["漏洞", "游戏玩法", "画面"] for Chinese.
  Examples:query["游戏难度"],should include["游戏难度", "战斗难度", "任务难度"...]
- game_names: Target games names.
- start_date/end_date: YYYY-MM-DD; defaults to last 30 days if omitted
- time_granularity: Time interval for trend, enums: ["day", "week", "month"], default: "day"
- content: Content types to return, enums: ["metrics", "ratio", "comments"]. Default: ["metrics", "comments"]
  * metrics: Basic topic performance indicators (mentions, negative_rate, avg_sentiment, brand_health)
  * ratio: Topic percentage vs. total discussions (requires additional 30s query, only request if needed)
  * comments: Representative user posts/comments with URLs (5 items per topic)
  Examples:
  - content=["metrics"]: Fast query (~10s), basic metrics only
  - content=["metrics", "ratio"]: Full metrics with percentage (~40s)
  - content=["metrics", "comments"]: Metrics + representative comments (~10s)
  - content=["metrics", "ratio", "comments"]: Complete analysis (~40s)
- channel_category: Channel category filter, enums: ["social", "game_store"]
- channel_code: Specific channel filter, enums: ["youtube_keyword", "steam", "tiktok", "twitter", "reddit", etc.]
  * IMPORTANT: channel_code must match channel_category:
    - If channel_category="social": only use social channels (youtube_keyword, tiktok, twitter, facebook, reddit, discord, etc.)
    - If channel_category="game_store": only use store channels (steam, google_play, app_store, etc.)
    - If unsure, do NOT set channel_category, only set channel_code
- sentiment: Sentiment filter, enums: ["positive", "negative", "neutral"]
- language_code: Language filter, enums: ["en", "zh", "zh-hant", "ja", "ko", "tr"]
  * Use when the user explicitly mentions a language (e.g. "日语讨论" → ["ja"])
  * Use region names directly (e.g. "北美区", "东南亚") — the system auto-expands them to the corresponding languages
- is_official_account: Filter by official account, enums: [true, false]

OUTPUT:
For each topic:
- Metrics data: mentions, negative_rate, avg_sentiment (1-5 scale, ~3.0=neutral), brand_health
  * `brand_health` here is TOPIC-level net sentiment (positive_rate − negative_rate). Label it as "话题健康度 / Topic Health Score" — NOT "品牌健康度 / Brand Health" (which is reserved for game-level data like `hotness.brand_health`).
  * When narrating a topic, use that topic's OWN numbers. If `negative_rate ≥ 25%` OR `avg_sentiment < 3.5`, do NOT use approval words ("高度认可" / "广受好评" / "highly approved" / "好评如潮"); also avoid vague hedges like "评价两极 / polarized / mixed". Instead, state the concrete figures (e.g. "负面占比 32%、平均情感 2.7、话题健康度 -30")  and summarize the dominant negative aspects from representative comments.
- Ratio data: topic percentage vs. total volume (if "ratio" in content)
- Representative comments: content, URL, engagement score, sentiment label (if "comments" in content)

RULES:
- Representative comments returned by this tool already include URLs paired with each comment from the data source. When presenting comments, only show the URL that is explicitly paired with that comment in the tool result. NEVER construct, infer, or substitute a URL for a comment that does not have one.
- If this tool returns `status="needs_web_search"` or `use_web_search=true`, call `llm_websearch` with `search_query` to supplement missing or low-sample Databrain opinion data before answering. Any returned Databrain metrics/comments are still valid and should be used together with web results.
- NO fabricated content - only use actual query results
- Ratio metric is OPTIONAL - only include if you need to compare topic proportion vs. total volume (adds query time)""",
    is_enabled=get_tool_enabled(ToolName.GetOpinionAnalysisByTopic.value),
    readable_name_map={
        "English": "Topic Opinion Analysis Tool",
        "Chinese": "话题舆情分析工具",
    }
)
async def get_opinion_analysis_by_topic(
    context: RunContextWrapper[GameContext],
    topics: List[str],
    game_names: List[str],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    time_granularity: str = "day",
    # 控制返回内容的参数
    content: List[str] = ["metrics", "comments"],
    # 业务过滤参数（与 get_opinion_summary_report 对齐）
    channel_category: Optional[str] = None,
    channel_code: Optional[List[str]] = None,
    sentiment: Optional[str] = None,
    language_code: Optional[List[str]] = None,
    region: Optional[List[str]] = None,
    is_official_account: Optional[bool] = None,
) -> Dict[str, Any]:
    """
    分析指定话题的舆情情况（指标 + 代表性评论）
    
    【适用场景】
    当需要了解特定话题（如"外挂"、"更新"等）的舆情时使用此工具
    
    【与其他工具的区别】
    - get_metrics_by_topic: 旧版话题指标工具
    - get_top_content_by_topic: 话题内容工具
    - get_opinion_analysis_by_topic: 新版综合分析工具
    
    Args:
        topics: 要分析的话题列表（如：["外挂", "BUG", "更新"]）
        game_names: 游戏名称列表
        start_date: 开始日期 (YYYY-MM-DD)，默认为30天前
        end_date: 结束日期 (YYYY-MM-DD)，默认为今天
        time_granularity: 时间粒度，enums: ["day", "week", "month"]，默认"day"
        content: 需要返回的内容类型，enums: ["metrics", "ratio", "comments"]
                 默认: ["metrics", "comments"]（返回完整分析，不包含 ratio）
                 Content Type Explanation:
                 - metrics: 话题的基础指标数据
                   mentions, negative_rate, avg_sentiment, brand_health
                 - ratio: 话题占比（相对于总讨论的百分比）
                   ratio metric is OPTIONAL - only include if you need to compare topic proportion vs. total volume (adds query time)
                 - comments: 话题的代表性评论
                   content, URL, engagement score, sentiment label
        channel_category: 渠道类别过滤，enums: ["social", "game_store"]
        channel_code: 具体渠道过滤，enums: ["youtube_keyword", "steam", "tiktok", "twitter", etc.]
        sentiment: 情感过滤，enums: ["positive", "negative", "neutral"]
        language_code: 语言过滤，enums: ["en", "zh", "zh-hant", "ja", "ko", etc.]
        is_official_account: 是否仅包含官方账号，enums: [true, false]
    """
    start_time = time.time()
    logger.info(f"【get_opinion_analysis_by_topic】开始执行，话题: {topics}, 游戏: {game_names}")
    
    # ============ 参数验证和规范化 ============
    validation_messages = []  # 收集所有的参数调整信息
    
    # ---------- 1. 验证必需参数 ----------
    # 验证 topics
    if not topics:
        return {"error": "Missing required parameter: topics list cannot be empty", "code": -1}
    
    # 如果传入的是单个字符串，转换为列表
    if isinstance(topics, str):
        topics = [topics]
    
    # ---------- 2. 验证和规范化业务过滤参数 ----------
    # 验证 channel_category
    validated_channel_category = ParamValidator.validate_string(
        channel_category, ALLOWED_CHANNEL_CATEGORY, None, 
        "channel_category", validation_messages
    )
    
    # 验证并规范化 channel_code (使用 map_channels_to_code 智能映射)
    validated_channel_code = ParamValidator.validate_with_mapper(
        channel_code, map_channels_to_code, None, 
        "channel_code", validation_messages
    )
    
    # 验证 channel_code 是否与 channel_category 一致（参考 summary_tool）
    if validated_channel_category and validated_channel_code:
        if validated_channel_category == "social":
            # 检查是否有非social渠道 (comments type)
            invalid_channels = [ch for ch in validated_channel_code if get_channel_type(ch) != "social"]
            if invalid_channels:
                error_msg = f"channel_category='social' but channel_code contains non-social channels: {invalid_channels}. Ignoring channel_category and using channel_code only."
                validation_messages.append(f"Parameter conflict (auto-fixed): {error_msg}")
                logger.warning(f"【参数验证】{error_msg}")
                validated_channel_category = None
        
        elif validated_channel_category == "game_store":
            # 检查是否有social渠道 (应该全是comments type)
            invalid_channels = [ch for ch in validated_channel_code if get_channel_type(ch) == "social"]
            if invalid_channels:
                error_msg = f"channel_category='game_store' but channel_code contains social media channels: {invalid_channels}. Ignoring channel_category and using channel_code only."
                validation_messages.append(f"Parameter conflict (auto-fixed): {error_msg}")
                logger.warning(f"【参数验证】{error_msg}")
                validated_channel_category = None
    
    # 验证 sentiment
    validated_sentiment = ParamValidator.validate_string(
        sentiment, ALLOWED_SENTIMENT, None,
        "sentiment", validation_messages
    )
    
    # 验证并规范化 language_code (使用 map_languages_to_iso 智能映射)
    validated_language_code = ParamValidator.validate_with_mapper(
        language_code, map_languages_to_iso, None, 
        "language_code", validation_messages
    )

    # region → language_code 展开：feeds_topic 不支持 region，将 region 映射为语言并合并进 language_code
    if region:
        region_expanded = map_languages_to_iso(region)
        if region_expanded:
            existing = set(validated_language_code or [])
            merged = sorted(existing | set(region_expanded))
            if merged != list(existing):
                validation_messages.append(
                    f"region {region} auto-expanded to language_code {region_expanded} and merged into language filter."
                )
            validated_language_code = merged if merged else validated_language_code

    # 验证 is_official_account
    validated_is_official_account = ParamValidator.validate_boolean(
        is_official_account, None, 
        "is_official_account", validation_messages
    )
    
    # 验证 content
    validated_content = ParamValidator.validate_string_list(
        content, ALLOWED_CONTENT_TYPES, ["metrics", "comments"],  # 默认不包含 ratio
        "content", validation_messages
    )
    
    # 使用验证后的参数（参考 summary_tool）
    channel_category = validated_channel_category
    channel_code = validated_channel_code
    sentiment = validated_sentiment
    language_code = validated_language_code
    is_official_account = validated_is_official_account
    content = validated_content
    
    # 转换为内部参数
    include_metrics = "metrics" in content
    include_ratio = "ratio" in content
    include_content = "comments" in content
    include_trend = include_metrics or include_ratio  # 如果包含metrics或ratio，自动包含trend
    top_n = 5  # 固定返回5条代表性内容
    
    logger.info(f"【get_opinion_analysis_by_topic】内容控制: metrics={include_metrics}, ratio={include_ratio}, comments={include_content}")
    
    # 如果有参数调整信息，记录到日志
    if validation_messages:
        logger.info(f"【get_opinion_analysis_by_topic】参数验证信息: {validation_messages}")
    
    # ---------- 4. Resolve game ids ----------
    game_ids = await _ensure_game_ids(context, game_names)
    
    # ---------- 设置默认日期 ----------
    if not start_date:
        start_date = (datetime.now() - timedelta(days=7)
                        ).strftime("%Y-%m-%d")
    if not end_date:
        end_date = datetime.now().strftime("%Y-%m-%d")

    # 创建关键词分析报告跳转卡片（在数据查询前执行，避免 NoResultException 跳过卡片创建）
    try:
        card_creator = OpinionReportCardCreator()
        await card_creator.create_and_store_cards(
            context=context,
            game_names=game_names,
            game_ids=game_ids,
            topics=topics,
            start_date=start_date,
            end_date=end_date,
            language_code=language_code,
            channel_code=channel_code,
            channel_category=channel_category,
            region=region,
        )
    except Exception as e:
        logger.warning(f"【get_opinion_analysis_by_topic】卡片创建失败（不影响主结果）: {e}")

    # ---------- 表与字段规则校验与过滤 ----------
    # 指定需要查询的 measures（基于 topic_metrics_service 中的 COMPULSORY_MEASURES）
    measures = []
    
    # 根据 content 参数决定包含哪些 measures
    if include_metrics or include_ratio:
        # 基础指标（metrics 和 ratio 都需要这些基础数据）
        measures.extend([
            f"{FEEDS_TOPIC}.mentions",
            f"{FEEDS_TOPIC}.negative_rate",
            f"{FEEDS_TOPIC}.avg_sentiment",
            f"{FEEDS_TOPIC}.brand_health",
        ])
    
    # 如果需要 ratio，添加 ratio measure（会触发 service 层的总体查询）
    if include_ratio:
        measures.append(f"{FEEDS_TOPIC}.ratio")
        logger.info(f"【get_opinion_analysis_by_topic】已添加 ratio 到 measures，将执行总体查询（约增加30秒）")
    
    # 规则1: sentiment 为 positive, negative, neutral 时，省略 avg_sentiment 和相关 rate 字段
    # 因为单一情感下这些字段无意义（都是100%或固定值）
    if sentiment in ["positive", "negative", "neutral"]:
        if f"{FEEDS_TOPIC}.avg_sentiment" in measures:
            measures = [m for m in measures if m != f"{FEEDS_TOPIC}.avg_sentiment"]
            validation_messages.append("When sentiment is positive/negative/neutral, avg_sentiment is omitted from measures")
        if f"{FEEDS_TOPIC}.positive_rate" in measures:
            measures = [m for m in measures if m != f"{FEEDS_TOPIC}.positive_rate"]
        if f"{FEEDS_TOPIC}.negative_rate" in measures:
            measures = [m for m in measures if m != f"{FEEDS_TOPIC}.negative_rate"]
            validation_messages.append("When sentiment is positive/negative/neutral, rate fields are omitted from measures")
        if f"{FEEDS_TOPIC}.neutral_rate" in measures:
            measures = [m for m in measures if m != f"{FEEDS_TOPIC}.neutral_rate"]

    # ============ 构建 filters（将业务参数转换为 Filter 对象） ============
    filters = []
    
    if validated_channel_code:
        filters.append(Filter(
            member=f"{FEEDS_TOPIC}.channel_code",
            operator="equals",
            values=validated_channel_code
        ))
    
    if validated_sentiment:
        filters.append(Filter(
            member=f"{FEEDS_TOPIC}.sentiment",
            operator="equals",
            values=[validated_sentiment]
        ))
    
    if validated_language_code:
        filters.append(Filter(
            member=f"{FEEDS_TOPIC}.language_code",
            operator="equals",
            values=validated_language_code
        ))
    
    if validated_is_official_account is not None:
        filters.append(Filter(
            member=f"{FEEDS_TOPIC}.is_official_account",
            operator="equals",
            values=[str(validated_is_official_account).lower()]
        ))
    
    # ============ 执行话题分析（并发调用 metrics + content 服务） ============
    analysis_result = await _execute_topic_analysis(
        context=context,
        game_names=game_names,
        game_ids=game_ids,
        topics=topics,
        start_date=start_date,
        end_date=end_date,
        include_metrics=include_metrics,
        include_ratio=include_ratio,
        include_content=include_content,
        include_trend=include_trend,
        time_granularity=time_granularity,
        top_n=top_n,
        measures=measures,
        filters=filters if filters else None,
    )
    
    # ============ 收集结果和 data_ids ============
    data_ids = {}
    
    metrics_result = analysis_result.get("metrics_result")
    content_result = analysis_result.get("content_result")
    supplemental_parts = analysis_result.get("supplemental_parts") or []
    web_search_reasons = analysis_result.get("web_search_reasons") or []
    
    # metrics 已在 service 层存储到 context（用于出图）
    if metrics_result:
        data_ids["metrics"] = metrics_result.get("data_id", "")
    
    # content 不需要存储到 context（不需要出图）
    # 所以不添加到 data_ids
    
    # ============ 格式化返回结果 ============
    # 构建返回结果，包含实际数据（参考 topic_ratio_tool 和 topic_content_service）
    final_result = {
        "code": 0,
        "system": "opinion",
        "tool": "get_opinion_analysis_by_topic",
        "topics": topics,
        "summary": analysis_result.get("summary", ""),
        "data_ids": data_ids,
    }

    if supplemental_parts or web_search_reasons:
        final_result.update({
            "status": "needs_web_search",
            "use_web_search": True,
            "search_query": _build_web_search_query(context, game_names, topics, start_date, end_date),
            "data_quality_notes": supplemental_parts,
            "web_search_reasons": web_search_reasons,
            "next_action": "Call llm_websearch with search_query to supplement missing or low-sample Databrain opinion data.",
        })
    
    # 添加 metrics 数据（已在 service 层转换为 CSV 格式）
    if metrics_result:
        final_result["metrics"] = metrics_result
        logger.info(f"【get_opinion_analysis_by_topic】已添加 metrics 数据到返回结果")
    
    # 添加 content 数据（保持 CSV 格式，instruction 保留在 content 内部）
    if content_result:
        final_result["content"] = content_result
        logger.info(f"【get_opinion_analysis_by_topic】已添加 content 数据到返回结果")
    
    # 添加详细说明
    content_desc = []
    if "metrics" in content:
        content_desc.append("metrics data")
    if "comments" in content:
        content_desc.append("representative comments")
    
    final_result["note"] = (
        f"Retrieved {' and '.join(content_desc)} for {len(topics)} topic(s)."
    )
    
    # 如果有参数验证消息，添加到结果中
    if validation_messages:
        final_result["validation_messages"] = validation_messages
    
    logger.info(f"【get_opinion_analysis_by_topic】执行完成, 耗时: {time.time() - start_time} s")

    # 参考 topic_ratio_tool 和 topic_content_service，返回完整数据
    inject_metric_kb(measures, final_result)
    return truncate_output(final_result)
