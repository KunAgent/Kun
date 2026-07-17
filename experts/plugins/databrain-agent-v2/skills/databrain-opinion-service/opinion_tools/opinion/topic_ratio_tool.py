import asyncio
import time
import uuid
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple, Union
from loguru import logger
from run_context_wrapper import RunContextWrapper

from opinion_strategy.context import GameContext, BiDataCsvEntry
from opinion_strategy.constants import ToolName
from opinion_tools.cube.cube_client import CubeClient
from opinion_tools.cube.cube_model import ExtendQuery, Filter, FilterGroup, TimeDimension, Query
from opinion_tools.cube.cube_tools import read_cube_data
from opinion_tools.cube.transformers import DataTransformer
from opinion_tools.tool_common import get_tool_enabled, function_tool
from opinion_utils.helper import default_tool_error_function, websearch_fallback_error_function
from opinion_utils.exceptions import NoResultException
from opinion_common.config import globalvar as gl
from opinion_tools.opinion.utils.cube_helper import get_cube_client
from opinion_tools.opinion.utils.topics_helper import get_topics
from opinion_tools.opinion.utils.utils import truncate_output
from opinion_tools.opinion.utils.metric_kb_injector import inject_metric_kb
from opinion_tools.opinion.opinion_tools import _ensure_game_ids
from opinion_utils.df_sampler import DataFrameSampler


def fix_topic_prefix(topics_list, topics_data):
    """
    自动修复topic的前缀问题
    例当用户输入 'Bug & Issues' 但实际数据中是 '[USP] Bug & Issues' 时，自动补充前缀以匹配正确的topic

    Args:
        topics_list: 用户输入的topic列表，可能缺少前缀
        topics_data: 完整的topic数据，包含正确的前缀

    Returns:
        修复后的topics列表，如果发生异常则返回原始输入
    """
    try:
        if not topics_list or not topics_data:
            return topics_list

        # 提取所有实际存在的topics（带前缀的）
        all_topics_with_prefix = []
        for categories in topics_data.values():
            if isinstance(categories, list):
                for topic_item in categories:
                    if isinstance(topic_item, dict):
                        if "topic" in topic_item:
                            all_topics_with_prefix.append(topic_item["topic"])
                        if "topic_zh" in topic_item:
                            all_topics_with_prefix.append(topic_item["topic_zh"])
            elif isinstance(categories, dict):
                for topics_in_category in categories.values():
                    if isinstance(topics_in_category, list):
                        for topic_item in topics_in_category:
                            if isinstance(topic_item, dict):
                                if "topic" in topic_item:
                                    all_topics_with_prefix.append(topic_item["topic"])
                                if "topic_zh" in topic_item:
                                    all_topics_with_prefix.append(topic_item["topic_zh"])

        if not all_topics_with_prefix:
            return topics_list

        # 修复topics列表
        fixed_topics = []
        for topic in topics_list:
            # 首先检查是否完全匹配
            if topic in all_topics_with_prefix:
                fixed_topics.append(topic)
                continue

            # 尝试查找带前缀的版本
            found = False
            for full_topic in all_topics_with_prefix:
                # 检查是否是去掉前缀后的匹配（支持 [] 和 【】）
                if ']' in full_topic:
                    suffix = full_topic.split(']', 1)[1].strip()
                    if suffix == topic or suffix == topic.strip():
                        fixed_topics.append(full_topic)
                        found = True
                        logger.info(f"自动修复topic前缀: '{topic}' -> '{full_topic}'")
                        break
            if not found:
                # 如果找不到，保持原样（可能是关键词）
                fixed_topics.append(topic)

        return fixed_topics

    except Exception as e:
        # 异常兜底：返回原始输入
        logger.warning(f"fix_topic_prefix 发生异常: {e}，返回原始输入")
        return topics_list


def categorize_topics_simple(topics_list, topics_data):
    # 提取所有存在的topic
    all_topics = []
    for categories in topics_data.values():
        # categories 可能是列表或字典
        # logger.info(f"topic ratio categories : ----- {categories} ----- Type: {type(categories)}")
        if isinstance(categories, list):
            # 如果是列表，直接遍历
            for topic_item in categories:
                if isinstance(topic_item, dict):
                    if "topic" in topic_item:
                        all_topics.append(topic_item["topic"])
                    if "topic_zh" in topic_item:
                        all_topics.append(topic_item["topic_zh"])
        elif isinstance(categories, dict):
            # 如果是字典，遍历其值
            for topics_in_category_key in categories.keys():
                # logger.info(f"topic ratio topics_in_category : ----- {topics_in_category_key} ----- ")
                if isinstance(categories[topics_in_category_key], list):
                    for topic_item in categories[topics_in_category_key]:
                        # logger.info(f"topic_item : ----- {topic_item} ----- ")
                        if "topic" in topic_item:
                            all_topics.append(topic_item["topic"])
                        if "topic_zh" in topic_item:
                            all_topics.append(topic_item["topic_zh"])
        # 使用列表推导式分类
    topics_list_exist = [topic for topic in topics_list if topic in all_topics]
    keywords_list_not_exist = [topic for topic in topics_list if topic not in all_topics]
    return topics_list_exist, keywords_list_not_exist

def keywords_filter_build(keywords_list):
    # fitler must include topic field
    member_st = f"{FEEDS_TOPIC}.content"
    keyword_filter_content = Filter(
        member=member_st,
        operator="contains",
        values=keywords_list
    )
    member_st = f"{FEEDS_TOPIC}.content_zh"
    keyword_filter_content_zh = Filter(
        member=member_st,
        operator="contains",
        values=keywords_list
    )
    member_st = f"{FEEDS_TOPIC}.content_en"
    keyword_filter_content_en = Filter(
        member=member_st,
        operator="contains",
        values=keywords_list
    )
    keyword_filter = FilterGroup(
        **{
            "or": [
                keyword_filter_content,
                keyword_filter_content_zh,
                keyword_filter_content_en,
            ]
        }
    )
    return keyword_filter

FEEDS_TOPIC = "feeds_topic"

# Compulsory measures that must always be included
COMPULSORY_MEASURES = [
    f"{FEEDS_TOPIC}.mentions",
    # f"{FEEDS_TOPIC}.positive_mentions",
    # f"{FEEDS_TOPIC}.negative_mentions",
    # f"{FEEDS_TOPIC}.neutral_mentions",
    # f"{FEEDS_TOPIC}.positive_rate",
    f"{FEEDS_TOPIC}.engagement",
    f"{FEEDS_TOPIC}.negative_rate",
    f"{FEEDS_TOPIC}.avg_sentiment",
    f"{FEEDS_TOPIC}.brand_health",
]

# Compulsory dimensions that must always be included
COMPULSORY_DIMENSIONS = [
    # f"{FEEDS_TOPIC}.validation",
]


@function_tool(
    failure_error_function=websearch_fallback_error_function,
    description_override="""
Get metrics for SPECIFIC topics or keywords. 计算特定讨论话题或关键词的表现指标和占比。

WHEN TO USE:
- User asks about SPECIFIC topics/keywords (e.g., "战利品", "组队", "monetization", "bugs")
- User wants to track/compare specific aspects of the game
- DO NOT use for general questions like "what are players discussing?" or "overall opinion"

CORE FEATURES:
1. Query topic performance metrics like ratio, mentions, positive rate, negative rate, etc.
2. Track specific topics' growth/decline trend over time
3. Supports comparing multiple topics in a single request

Args:
- topics: **REQUIRED** A list of specific topics/keywords. NOT sentiment types (positive/negative/neutral)
  Examples: ["monetization", "server issues"], ["bug", "gameplay", "graphics"] for English;
  ["氪金", "服务器问题"], ["漏洞", "游戏玩法", "画面"] for Chinese.
  Examples:query["游戏难度"],should include["游戏难度", "战斗难度", "任务难度"...]
- start_date/end_date: YYYY-MM-DD; defaults to last 30 days if omitted
- time_granularity: The time interval for trend analysis (e.g., "day", "week", "month").
- include_trend: Whether to include trend data in the result (default: True).
- measures: Additional metrics to query (optional). The following measures are ALWAYS included as compulsory: feeds_topic.mentions, feeds_topic.positive_mentions, feeds_topic.negative_mentions, feeds_topic.neutral_mentions, feeds_topic.positive_rate, feeds_topic.negative_rate, feeds_topic.avg_sentiment, feeds_topic.engagement.
- filters: Optional extra filters selected by the LLM to narrow down scope, applied to both topic and total queries (topic-only filters are excluded from total query).
- Always use fields from the same table prefix: "feeds_topic.*" (e.g., "feeds_topic.language_code", "feeds_topic.channel_code").
- Do NOT set feeds_topic.game_id in filters;
- Do NOT include topic field filters here; this tool will add topic filters internally according to the "topics" parameter.
- Never set feeds_topic.avg_sentiment in filters for negative or positive sentiment, use negative_rate and positive_rate in measures instead;
- Typical operators: "equals", "in", "contains".
- Examples:
    - English: [{"member": "feeds_topic.language_code", "operator": "equals", "values": ["en"]}]
    - 中文: [{"member": "feeds_topic.channel_code", "operator": "in", "values": ["youtube_keyword", "tiktok"]}]
""",
    is_enabled=get_tool_enabled(ToolName.TopicRatioAnalysis.value),
    readable_name_map={
        "English": "Topic Metrics Analysis Tool",
        "Chinese": "话题指标分析工具",
    }
)
async def get_metrics_by_topic(
    context: RunContextWrapper[GameContext],
    topics: List[str],
    game_names: List[str],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    time_granularity: str = "day",
    include_trend: bool = True,
    measures: List[str] = [f"{FEEDS_TOPIC}.mentions"],
    filters: Optional[List[Union[Filter, FilterGroup]]] = None,
    # topics_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    分析多个话题在总体声量中的占比

    Args:
        context: 上下文包装器
        topics: 要分析的话题列表，可以传入多个话题进行对比
        start_date: 开始日期，格式YYYY-MM-DD
        end_date: 结束日期，格式YYYY-MM-DD
        time_granularity: 时间粒度，可选"day"、"week"、"month"
        include_trend: 是否包含趋势数据
        measures: 额外要查询的指标（可选）。以下指标将始终作为必填项包含：feeds_topic.mentions, feeds_topic.positive_mentions, feeds_topic.negative_mentions, feeds_topic.neutral_mentions, feeds_topic.positive_rate, feeds_topic.negative_rate, feeds_topic.avg_sentiment, feeds_topic.engagement。以下维度将始终作为必填项包含：feeds_topic.validation
        filters: 由大模型自动选择的额外过滤条件（可选）。会应用于话题查询与总体查询，但会自动从总体查询中剔除仅针对话题字段的过滤条件。
        topics_result: topics_result in opinion_agent.py，用来传递databrain的码表信息。
    Returns:
        包含多个话题占比数据的结果，符合前端图表展示格式
    """
    # Resolve game ids
    game_ids = await _ensure_game_ids(context, game_names)
    validation_messages = []

    # 判断是否需要关键词匹配
    # 如果 context 中没有话题数据，或 game_id 不在其中，则主动获取
    topics_result = context.context.topics
    if not topics_result or not any(game_id in topics_result for game_id in game_ids):
        logger.warning(f"topics_result为空或game_id不在其中，重新获取话题数据")
        topics_result = await get_topics(tuple(game_ids))
        context.context.topics = topics_result
    
    logger.info(f"topics_ratio topics_result: {list(topics_result.keys())}")
    
    databrain_topics_list = []
    keywords_list = []
    
    # 分类 topics：区分 databrain 话题和关键词
    for game_id in game_ids:
        if game_id in topics_result:
            game_topics_data = topics_result[game_id]
            # 首先修复topic前缀问题（如 'Bug & Issues' -> '[USP] Bug & Issues'）
            topics = fix_topic_prefix(topics, game_topics_data)
            logger.info(f"修复后的topics: {topics}")
            # 分类话题和关键词
            existing_topics, not_existing_keywords = categorize_topics_simple(topics, game_topics_data)
            databrain_topics_list.extend(existing_topics)
            keywords_list.extend(not_existing_keywords)
    
    # 去重
    databrain_topics_list = list(set(databrain_topics_list))
    keywords_list = list(set(keywords_list))
    
    # 兜底：如果没有分类出任何结果，将所有 topics 作为关键词
    if not databrain_topics_list and not keywords_list and topics:
        keywords_list = topics  
    # 最多10个关键词
    if len(keywords_list) > 10:
        keywords_list = keywords_list[:10]
    logger.info(f"topics_ratio topics: {databrain_topics_list}")
    logger.info(f"topics_ratio keywords: {keywords_list}")



    # 0. 获取上下文中的日期参数或使用默认值
    ctx_dates = (context.context.data or [{}])[0]
    start_date = start_date or ctx_dates.get("start_date")
    end_date = end_date or ctx_dates.get("end_date")

    # 确保日期不为空，设置默认值
    from datetime import datetime, timedelta
    if not start_date:
        start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    if not end_date:
        end_date = datetime.now().strftime("%Y-%m-%d")

    # 参数验证
    if not topics:
        return {"error": "缺少话题参数，请提供要分析的话题列表", "code": -1}

    # 如果传入的是单个字符串，转换为列表
    if isinstance(topics, str):
        topics = [topics]

    # Merge user-provided measures with compulsory measures (no duplicates)
    all_measures = list(COMPULSORY_MEASURES)
    if measures:
        for measure in measures:
            if measure not in all_measures:
                all_measures.append(measure)
    measures = all_measures

    logger.info(f"Topic ratio analysis for topics {topics} from {start_date} to {end_date}, measures={measures}")

    # 1. 创建Cube客户端和转换器
    cube_client = get_cube_client()
    transformer = DataTransformer()
    language = getattr(context.context, "language", None) or "English"

    # 2. 构建查询参数
    # 2.1 构建时间维度
    try:
        time_dimension = TimeDimension(
            dimension=f"{FEEDS_TOPIC}.date",
            granularity=time_granularity,
            dateRange=[start_date, end_date]
        )
        time_dimension_no_granularity = TimeDimension(
            dimension=f"{FEEDS_TOPIC}.date",
            granularity=time_granularity,
            dateRange=[start_date, end_date]
        )
        logger.info(f"成功创建TimeDimension: dimension={FEEDS_TOPIC}.date, granularity={time_granularity}, dateRange=[{start_date}, {end_date}]")
    except Exception as e:
        logger.error(f"创建TimeDimension失败: {e}")
        raise Exception(f"创建时间维度失败，请确保日期格式正确 (YYYY-MM-DD): {str(e)}")

    # 2.2 构建基础查询参数
    base_dimensions = list(COMPULSORY_DIMENSIONS)  # 包含必需的维度

    # 2.3 构建游戏ID过滤器
    game_id_filter = Filter(
        member=f"{FEEDS_TOPIC}.game_id",
        operator="equals",
        values=game_ids
    )

    topic_field = f"{FEEDS_TOPIC}.topic_zh" if language == "Chinese" else f"{FEEDS_TOPIC}.topic"
    dimensions = base_dimensions.copy()

    # 如果游戏数量大于等于2，添加游戏名称维度以区分不同游戏
    if len(game_ids) >= 2:
        dimensions.append(f"{FEEDS_TOPIC}.game_name")
        logger.info(f"检测到{len(game_ids)}个游戏，添加game_name维度进行区分")

    # 3. 执行两个查询：一个是话题数据，一个是总体数据
    # 初始化所有结果变量，避免 NameError
    keywords_all_result = []
    all_data_result = []
    topics_data_result = None  # 在外部初始化，确保作用域覆盖后续检查

    try:
        # 3.1 使用所有话题作为filter的values执行查询
        logger.info(f"执行所有话题({topics})查询")
        # 合并外部filters（如有）
        extra_filters: List[Union[Filter, FilterGroup]] = []

        if filters:
            try:
                for f in filters:
                    if isinstance(f, Filter):
                        # 忽略任何 game_id 相关的外部过滤
                        if getattr(f, "member", "").endswith(".game_id") or getattr(f, "member", "").endswith(".avg_sentiment"):
                            continue
                        extra_filters.append(f)
                    elif isinstance(f, dict):
                        # 忽略任何 game_id 相关的外部过滤
                        if str(f.get("member", "")).endswith(".game_id"):
                            continue
                        extra_filters.append(Filter(**f))
            except Exception as e:
                logger.warning
                (f"合并外部filters失败: {e}")
        # 话题查询filters
        # topic_filters: List[Filter] = [
        #     game_id_filter,
        #     Filter(
        #         member=topic_field,
        #         operator="equals",
        #         values=databrain_topics_list
        #     )
        # ]
        # topic field and dimensions
        # keyword_field = f"{FEEDS_TOPIC}.content_zh" if language == "Chinese" else f"{FEEDS_TOPIC}.content_en"
        if len(keywords_list) > 0:
            keywords_all_result = []
            keywords_start_time = time.perf_counter()
            logger.info(f"topic ratio keywords 开始并发查询，数量: {len(keywords_list)}")

            async def fetch_keyword_data(keyword: str):
                keywords_base_filters: List[Union[Filter, FilterGroup]] = [
                    game_id_filter,
                    keywords_filter_build([keyword]),
                ]
                if extra_filters:
                    keywords_base_filters.extend(extra_filters)
                logger.info("------------------" + f"topic ratio keywords 执行查询 fitler: {keywords_base_filters}" + "------------------")
                logger.info("------------------" + f"topic ratio keywords 执行查询 dimensions: {dimensions}" + "------------------")
                logger.info("------------------" + f"topic ratio keywords 执行查询 measures: {measures}" + "------------------")
                keywords_query = ExtendQuery(
                    measures=measures,
                    dimensions=dimensions,  # 加入话题维度
                    timeDimensions=[time_dimension] if include_trend else [time_dimension_no_granularity],
                    filters=keywords_base_filters,
                    order={f"{FEEDS_TOPIC}.date": "asc"} if include_trend else {},
                    ungrouped=False,
                )
                logger.info("------------------" + f"topic ratio keywords 执行查询 keywords_query: {keywords_query}" + "------------------")
                keywords_data_result = await read_cube_data(cube_client, transformer, keywords_query, language)
                return keyword, keywords_data_result

            tasks = [asyncio.create_task(fetch_keyword_data(keyword)) for keyword in keywords_list]
            keywords_results = await asyncio.gather(*tasks, return_exceptions=True)

            for keywords_result in keywords_results:
                if isinstance(keywords_result, Exception):
                    logger.warning(f"topic ratio keywords 并发查询异常: {keywords_result}")
                    continue
                keyword, keywords_data_result = keywords_result
                if keywords_data_result.get("code") != 0:
                    logger.warning(f"topic ratio keywords 话题数据查询失败: {keywords_data_result.get('data', '未知错误')}")
                    continue

                keywords_data_result_dict_list = keywords_data_result.get("data", {}).get("data", []) if keywords_data_result.get("code") == 0 else []
                if keywords_data_result_dict_list:
                    logger.info("------------------" + f"topic ratio keywords 执行查询 keywords_data_result_dict_list: {keywords_data_result_dict_list}" + "------------------")
                    for keywords_data_result_dict in keywords_data_result_dict_list:
                        keywords_data_result_dict[topic_field.split(".")[1]] = keyword
                        keywords_all_result.append(keywords_data_result_dict)

            keywords_cost_ms = (time.perf_counter() - keywords_start_time) * 1000
            logger.info(f"topic ratio keywords 并发查询完成，耗时: {keywords_cost_ms:.2f} ms")
            # logger.info("------------------" + f"topic ratio keywords 执行查询 keywords_all_result: {keywords_all_result}" + "------------------")
    except Exception as e:
        logger.warning(f"topic ratio keywords 执行查询失败: {e}")
        pass

        # 添加话题维度到查询中, 当查询并非关键词查询时
    try:
        dimensions.append(topic_field)  # 添加话题维度
        # topic_query only once
        topic_filter = Filter(
            member=topic_field,
            operator="equals",
            values=databrain_topics_list
        )

        if len(databrain_topics_list) > 0:
            topic_base_filters: List[Union[Filter, FilterGroup]] = [
                game_id_filter,
                topic_filter,
            ]

        if len(keywords_list) == 0 and len(databrain_topics_list) == 0:
            topic_base_filters: List[Union[Filter, FilterGroup]] = [
                game_id_filter,
            ]

        if extra_filters:
            if len(databrain_topics_list) > 0 or (len(keywords_list) == 0 and len(databrain_topics_list) == 0):
                topic_base_filters.extend(extra_filters)

        if len(databrain_topics_list) > 0 or (len(keywords_list) == 0 and len(databrain_topics_list) == 0):
            logger.info("------------------" + f"topic ratio topics 执行查询 fitler: {topic_base_filters}" + "------------------")
            logger.info("------------------" + f"topic ratio topics 执行查询 dimensions: {dimensions}" + "------------------")
            logger.info("------------------" + f"topic ratio topics 执行查询 measures: {measures}" + "------------------")
            topics_query = ExtendQuery(
                measures=measures,
                dimensions=dimensions,  # 加入话题维度
                timeDimensions=[time_dimension] if include_trend else [time_dimension_no_granularity],
                filters=topic_base_filters,
                order={f"{FEEDS_TOPIC}.date": "asc"} if include_trend else {},
                ungrouped=False,
            )
            logger.info("------------------" + f"topic ratio topics 执行查询: {topics_query}" + "------------------")
            topics_data_result = await read_cube_data(cube_client, transformer, topics_query, language)

            if topics_data_result.get("code") != 0:
                logger.warning(f"topic ratio topics话题数据查询失败: {topics_data_result.get('data', '未知错误')}")

        # merge keywords_all_result and topics_data_result
        all_data_result = []
        if topics_data_result and topics_data_result.get("code") == 0:
            all_data_result.extend(topics_data_result.get("data", {}).get("data", []))
        if len(keywords_all_result) > 0:
            all_data_result.extend(keywords_all_result)
        logger.info("------------------" + f"topic ratio topics all_data_result: {all_data_result}" + "------------------")
    except Exception as e:
        logger.error(f"topic ratio topics 执行查询失败: {e}")
        raise NoResultException(
            message=f"topic ratio topics 执行查询失败: {', '.join(databrain_topics_list)}",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )

    # 统一判断：只有当所有查询都没有数据时才走网络搜索
    # 检查是否所有查询都失败或者没有返回任何数据
    has_valid_data = False
    
    # 检查 topics 查询是否成功且有数据
    if topics_data_result and topics_data_result.get("code") == 0:
        topic_data_list = topics_data_result.get("data", {}).get("data", [])
        if len(topic_data_list) > 0:
            has_valid_data = True
            logger.info(f"topic ratio: databrain topics 查询成功，返回 {len(topic_data_list)} 条数据")
        else:
            logger.warning(f"topic ratio: databrain topics 查询返回 code=0 但数据为空")
    elif topics_data_result:
        logger.warning(f"topic ratio: databrain topics 查询失败，code={topics_data_result.get('code')}, msg={topics_data_result.get('msg')}")
    else:
        logger.info(f"topic ratio: topics_data_result 为 None，未执行 topics 查询")
    
    # 检查 keywords 查询是否有数据
    if len(keywords_all_result) > 0:
        has_valid_data = True
        logger.info(f"topic ratio: keywords 查询成功，返回 {len(keywords_all_result)} 条数据")
    else:
        logger.info(f"topic ratio: keywords 查询未返回数据")
    
    logger.info(f"topic ratio: has_valid_data = {has_valid_data}")
    
    # 如果所有查询都没有返回有效数据，触发网络搜索
    if not has_valid_data:
        all_query_targets = []
        if len(keywords_list) > 0:
            all_query_targets.extend(keywords_list)
        if len(databrain_topics_list) > 0:
            all_query_targets.extend(databrain_topics_list)
        
        # 构建详细的错误信息
        error_details = []
        if len(databrain_topics_list) > 0:
            error_details.append(f"databrain topics: {', '.join(databrain_topics_list[:5])}")
        if len(keywords_list) > 0:
            error_details.append(f"keywords: {', '.join(keywords_list[:5])}")
        
        error_message = "无法获取任何数据进行话题占比分析"
        if error_details:
            error_message += f" ({'; '.join(error_details)})"
        
        logger.warning(f"topic ratio: {error_message}")
        raise NoResultException(
            message=error_message,
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )

    try:
        # 3.2 执行总体查询
        logger.info("执行总体查询")
        # 为总体查询准备维度（包含必需维度，如果游戏数量大于等于2，也需要包含游戏名称）
        total_dimensions = list(COMPULSORY_DIMENSIONS)  # 包含必需的维度
        if len(game_ids) >= 2:
            total_dimensions.append(f"{FEEDS_TOPIC}.game_name")

        # 总体查询需要去除与topic字段相关的过滤器
        total_filters: List[Union[Filter, FilterGroup]] = [game_id_filter]
        if extra_filters:
            for f in extra_filters:
                try:
                    member = getattr(f, "member", "")
                    if member not in {topic_field, f"{FEEDS_TOPIC}.topic", f"{FEEDS_TOPIC}.topic_zh"}:
                        total_filters.append(f)
                except Exception:
                    continue

        total_query = ExtendQuery(
            measures=measures,
            dimensions=total_dimensions,
            timeDimensions=[time_dimension] if include_trend else [time_dimension_no_granularity],
            filters=total_filters,
            order={f"{FEEDS_TOPIC}.date": "asc"} if include_trend else {},
            ungrouped=False,
        )

        total_data_result = await read_cube_data(cube_client, transformer, total_query, language)

        if not total_data_result or not isinstance(total_data_result, dict) or total_data_result.get("code") not in [0, 2]:
            logger.warning(f"无法获取总体数据进行话题占比分析")
        logger.info("所有查询完成，处理数据结果")
    except Exception as e:
        logger.warning(f"topic ratio total 执行查询失败: {e}")
        raise NoResultException(
            message=f"无法获取总体数据进行话题占比分析: {', '.join(topics)}",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )

    # 4. 处理数据并计算占比
    logger.info("processing all and total and calculate the ratio")
    # 4.1 获取数据和指标名称
    measure_key = measures[0].split(".")[-1] if measures else "mentions"
    topics_data = all_data_result # all data result is the []

    # 安全地提取 total_data
    if isinstance(total_data_result, dict) and total_data_result.get("code") == 0:
        total_data = total_data_result.get("data", {}).get("data", [])
    elif isinstance(total_data_result, dict) and total_data_result.get("code") == 2:
        total_data = total_data_result.get("data", [])

    # 4.2 创建日期到总数的映射
    # 如果游戏数量大于等于2，需要考虑游戏名称
    date_to_total = {}
    for item in total_data:
        date = item.get("date")
        total_count = item.get(measure_key, 0)

        if len(game_ids) >= 2:
            # 多游戏情况下，使用游戏名称+日期作为键
            game_name = item.get("game_name", "")
            key = f"{game_name}_{date}" if game_name and date else (game_name or date or "")
        else:
            # 单个游戏情况下，只使用日期
            key = date or ""

        date_to_total[key] = total_count

    # 4.3 为每条话题数据添加占比
    for item in topics_data:
        date = item.get("date")
        topic_count = item.get(measure_key, 0)

        if len(game_ids) >= 2:
            # 多游戏情况下，使用游戏名称+日期作为键
            game_name = item.get("game_name", "")
            key = f"{game_name}_{date}" if game_name and date else (game_name or date or "")
        else:
            # 单个游戏情况下，只使用日期
            key = date or ""

        total_count = date_to_total.get(key, 0)
        ratio = (topic_count / total_count) if total_count > 0 else 0
        item["ratio"] = round(ratio, 5)

    # 4.4 更新结果数据
    # only leverage the structure, as long as one of them has structure, then it is good enough.
    if len(databrain_topics_list) > 0 or (len(keywords_list) == 0 and len(databrain_topics_list) == 0):
        result_data = topics_data_result.copy()
    elif len(keywords_list) > 0:
        result_data = keywords_data_result.copy()
    else:
        result_data = {"code": 0, "data": {"data": []}}
    if "data" in result_data and "data" in result_data["data"]:
        result_data["data"]["data"] = topics_data

    # 4.5 添加比例指标信息
    if "data" in result_data and "metrics_info" in result_data["data"]:
        has_ratio = any(info.get("data_key") == "ratio" for info in result_data["data"]["metrics_info"])
        if not has_ratio:
            result_data["data"]["metrics_info"].append({
                "name": "占比" if language == "Chinese" else "Ratio",
                "data_key": "ratio",
                "type": "percent",
                "chart_type": ["line", "table"]
            })

    # 5. 数据格式验证和标准化
    # 确保 result_data 的格式正确，包含 data 字段且 data 字段为列表
    if "data" in result_data and "data" in result_data["data"]:
        result_data_list = result_data["data"]["data"]
        if not isinstance(result_data_list, list):
            logger.warning(f"Expected list for data.data but got {type(result_data_list)}, converting...")
            if isinstance(result_data_list, dict):
                result_data["data"]["data"] = [result_data_list]
            else:
                # 如果无法转换，创建一个默认的空列表
                result_data["data"]["data"] = []
                logger.warning(f"Cannot process non-dict/non-list data: {type(result_data_list)}")

    # legends
    # {
    #     'code': 0, 'msg': 'ok',
    #     'data':
    #     {
    #         'version': '2.0',
    #         'xAxis': [{'date_key': 'date', 'show_type': 'normal', 'format': 'date'}],
    #         'yAxis': ['value'],
    #         'legends': [],
    #         'chat_type': 'trend',
    #         'metrics_info': [...]
    #     }
    # }
    # 只有当 result_data["data"] 是字典时才设置 legends（code=0 的情况）
    # 当 code=2 时，result_data["data"] 是列表，不需要设置 legends
    if result_data.get("code") == 0 and isinstance(result_data.get("data"), dict):
        result_data["data"]["legends"] = [topic_field.split(".")[1]]
    
        # 添加标识信息
        result_data["data_id"] = f"topic_ratio_{uuid.uuid4()}"
        result_data["system"] = "opinion"

        logger.info(f" ------ result_data: {result_data} ------- ")
        # Store full CSV for Analyst Agent sandbox
        try:
            raw_rows = result_data.get("data") and result_data["data"].get("data")
            if isinstance(raw_rows, list) and raw_rows and result_data.get("data_id"):
                full_csv = pd.DataFrame(raw_rows).to_csv(index=False)
                context.context.bi_data_for_sandbox.append(BiDataCsvEntry(data_id=result_data["data_id"], full_csv=full_csv))
        except Exception as e:
            logger.warning(f"[topic_ratio_tool] Failed to append full CSV to bi_data_for_sandbox: {e}")
        # 将结果存储到上下文中
        context.context.data.append(result_data)

    # 6. 转换为 CSV 格式并返回（减少 token 消耗）
    if result_data.get("code") == 0 and "data" in result_data and "data" in result_data["data"]:
        df = pd.DataFrame(result_data["data"]["data"])

        # 构建基础返回结果
        final_result = {
            "data_id": result_data["data_id"],
            "system": result_data["system"]
        }

        # 如果有字段修改信息，添加到返回结果中
        if validation_messages:
            final_result["field_modifications"] = validation_messages

        # 数据采样（仅当数据量超过5000时）
        if len(df) > 5000:
            try:
                # 获取分组字段和指标字段
                dimension_info = result_data["data"].get("dimension_info", [])
                metrics_info = result_data["data"].get("metrics_info", [])

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

                logger.info(f"数据采样完成：原始数据量 {len(df)} -> 采样后 {len(sampled_df)}")

                # 使用采样后的数据
                final_result["data"] = {
                    "Sample Data in CSV format": truncate_output(sampled_df.to_csv(index=False)),
                    "Data Statistics": validation_messages
                }

                inject_metric_kb(measures, final_result)
                return final_result
            except Exception as e:
                logger.warning(f"数据采样失败，使用原始数据: {e}")

        # 使用原始数据（未采样或采样失败）
        final_result["data"] = truncate_output(df.to_csv(index=False))
        inject_metric_kb(measures, final_result)
        return final_result

    # 7. 返回原始结果（如果无法转换为 CSV）
    if isinstance(result_data, dict):
        inject_metric_kb(measures, result_data)
    return truncate_output(result_data)