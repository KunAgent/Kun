import asyncio
import time
from collections import defaultdict
import re
import json
import pandas as pd
import uuid
from typing import Dict, List, Optional, Any, Tuple, Union
from loguru import logger

from run_context_wrapper import RunContextWrapper
from opinion_strategy.context import GameContext
from opinion_strategy.constants import ToolName
from opinion_tools.cube.cube_model import ExtendQuery, Filter, FilterGroup, TimeDimension
from opinion_tools.cube.cube_tools import read_cube_data
from opinion_tools.cube.transformers import DataTransformer
from opinion_tools.tool_common import get_tool_enabled, function_tool
from opinion_utils.exceptions import NoResultException
from opinion_utils.helper import default_tool_error_function, websearch_fallback_error_function
from opinion_tools.opinion.utils.cube_helper import get_cube_client
from opinion_tools.opinion.utils.topics_helper import get_topics
from opinion_tools.opinion.utils.utils import truncate_output
from opinion_tools.opinion.utils.metric_kb_injector import inject_metric_kb
from opinion_tools.opinion.utils.top_dimension_helper import get_top_dimensions
from opinion_tools.opinion.opinion_tools import _ensure_game_ids
from opinion_tools.opinion.topic_ratio_tool import fix_topic_prefix, categorize_topics_simple
from opinion_utils.df_sampler import DataFrameSampler


FEEDS_TOPIC = "feeds_topic"

# Compulsory measures that must always be included
COMPULSORY_MEASURES = [
    f"{FEEDS_TOPIC}.engagement",
    f"{FEEDS_TOPIC}.avg_sentiment",
]

# Compulsory dimensions that must always be included
COMPULSORY_DIMENSIONS = [
    f"{FEEDS_TOPIC}.channel_code",
    f"{FEEDS_TOPIC}.content",
    f"{FEEDS_TOPIC}.validation",
    f"{FEEDS_TOPIC}.url",
]


def sanitize_markdown_text(text):
    """
    清理字符串，避免破坏Markdown格式
    """
    if not text:
        return ""

    # 1. 转义Markdown特殊字符
    markdown_special_chars = r'([\\\`\*\_\{\}\[\]\(\)\#\+\-\.\!])'
    sanitized = re.sub(markdown_special_chars, r'\\\1', text)

    # 2. 处理HTML标签（避免在Markdown中意外渲染）
    sanitized = re.sub(r'<[^>]+>', lambda m: m.group(0).replace('<',
                       '&lt;').replace('>', '&gt;'), sanitized)

    # 3. 处理URL中的特殊字符
    sanitized = re.sub(r'(https?://[^\s]+)', r'<\1>', sanitized)  # 将URL用<>包裹

    # 4. 处理换行符，确保Markdown兼容
    sanitized = sanitized.replace('\r\n', '\n').replace('\r', '\n')

    # 5. 处理表格分隔符冲突
    sanitized = sanitized.replace('|', '\\|')

    return sanitized

def ensure_markdown_safe_truncation(text):
    """
    确保截断位置不会破坏Markdown格式
    """
    # 检查常见的Markdown标记是否被截断
    markdown_patterns = [
        (r'\*\*[^*]*$', '**'),  # 粗体标记
        (r'\*[^*]*$', '*'),     # 斜体标记
        (r'`[^`]*$', '`'),       # 代码标记
        (r'\[[^\]]*$', ']'),     # 链接文本
        (r'\([^)]*$', ')'),      # 链接URL
    ]

    for pattern, closing_char in markdown_patterns:
        if re.search(pattern, text):
            # 找到最后一个安全位置（标记之前）
            last_safe_pos = text.rfind(closing_char)
            if last_safe_pos > 0:
                text = text[:last_safe_pos]

    return text


def safe_markdown_truncate(text, max_length=50):
    """
    安全截取字符串，避免破坏Markdown格式
    """
    if not text:
        return ""

    # 先清理文本
    sanitized = sanitize_markdown_text(text)

    # 如果文本长度小于等于最大长度，直接返回
    if len(sanitized) <= max_length:
        return sanitized

    # 截取前max_length个字符
    truncated = sanitized[:max_length]

    # 检查截断位置是否在Markdown标记中间
    # 如果截断在特殊标记中，回退到上一个安全位置
    truncated = ensure_markdown_safe_truncation(truncated)

    return truncated + "..." if len(sanitized) > max_length else truncated


def group_data_pandas(data_list, topic_field, content_field):
    content_field = content_field.split(".")[1]
    topic_field = topic_field.split(".")[1]
    logger.info("content_type_in_group: " + content_field)
    logger.info("topic_type_in_group: " + topic_field)
    # build the dataframe
    try:
        df = pd.DataFrame(data_list)
        # 检查必要字段是否存在，如果不存在则创建空字段
        required_fields = [topic_field, 'avg_sentiment', content_field, 'url']
        for field in required_fields:
            if field not in df.columns:
                if field == 'avg_sentiment':
                    df[field] = 0  # 为情感值设置默认值
                else:
                    df[field] = ''  # 为其他字段设置空字符串
        # logger.info(f"------------ topic content data list {df.head(5)} -----------")
        # topic_zh     channel_code  avg_sentiment  engagement                                              items
        # 0     游戏玩法  youtube_keyword       3.476190   16.246032  [{'content': 'Gameplay Changes That Just Make ...
        # 1     游戏玩法  youtube_keyword       3.000000   15.973333  [{'content': 'Gameplay Changes That Just Make ...
        # 2     游戏玩法  youtube_keyword       3.307692   14.717949  [{'content': 'Gameplay Changes That Just Make ...
        # 3     游戏玩法           reddit       2.714286    6.685714  [{'content': '10/10 in gameplay yeah. Definite...
        # 4     游戏玩法           reddit       3.571429    4.534249  [{'content': 'I found Bozak Horde fun to play, ...
        # group by topic and channel_code
        # grouped = df.groupby([f"{topic_field}", 'channel_code']).apply(lambda x: [{f"{content_field}": row[f"{content_field}"], 'url': row['url']} for _, row in x.iterrows()]).reset_index(name='content_list')
        # logger.info("------------------ grouped: " + "------------------" + str(grouped) + "------------------")
        # targets
        # 确保数据类型正确
        if 'avg_sentiment' in df.columns:
            df['avg_sentiment'] = pd.to_numeric(
                df['avg_sentiment'], errors='coerce').fillna(0)

        # 根据情感分数分类
        def get_sentiment_category(sentiment):
            if sentiment > 4:
                return "positive"
            elif sentiment < 2:
                return "negative"
            else:
                return "neutral"

        # 添加情感分类列
        df['sentiment_category'] = df['avg_sentiment'].apply(get_sentiment_category)

        # -------- 只保留需要的字段 ----------
        df_small = df[[topic_field, content_field, "url", "sentiment_category"]]

        # -------- 分组并构建 content_list ----------
        result = (
            df_small.groupby([topic_field, "sentiment_category"])
            .apply(lambda x: {
                topic_field: x.name[0],
                "sentiment_category": x.name[1],
                "content_list": [
                    {
                        "content": (str(row[content_field]).replace('\n', ' ').replace('\r', ' ')[:100] + "..." 
                                   if len(str(row[content_field])) > 100 
                                   else str(row[content_field]).replace('\n', ' ').replace('\r', ' ')),
                        "url": row["url"]
                    }
                    for _, row in x.iterrows()
                    if row[content_field] and str(row[content_field]).strip() and row[content_field] != 'nan'
                ]
            })
            .tolist()
        )

        return result
    except Exception as e:
        print(f"处理数据时出错: {e}")
        return []


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

def aggregate_keywords_stats(keyword, topic_field, content_field, data):
    content_field = content_field.split(".")[1]
    topic_field = topic_field.split(".")[1]
    groups = defaultdict(lambda: {
        f"{topic_field}": None,
        "channel_code": None,
        "items": [],
        "avg_sentiment": [],
        "engagement": []
    })

    for d in data:
        # logger.info(f"-------- data.d {d} --------")
        topic = d.get(topic_field)
        channel = d.get("channel_code")
        key = (topic, channel)
        # logger.info(f"-------- data topic channel {topic}  {channel}--------")

        groups[key][topic_field] = keyword
        groups[key]["channel_code"] = channel
        # logger.info(f"-------- data topic groups[key] {groups[key]}--------")
        # append content/url/validation list
        groups[key]["items"].append({
            "content": d.get("content"),
            content_field: d.get(content_field),
            "url": d.get("url"),
            "validation": d.get("validation")
        })

        # accumulate for averaging
        groups[key]["avg_sentiment"].append(d.get("avg_sentiment", 0) or 0)
        groups[key]["engagement"].append(d.get("engagement", 0) or 0)

    # convert to final list
    result = []
    for key, g in groups.items():
        result.append({
            topic_field: g[topic_field],
            "channel_code": g["channel_code"],
            "avg_sentiment": sum(g["avg_sentiment"]) / len(g["avg_sentiment"]) if g["avg_sentiment"] else 0,
            "engagement": sum(g["engagement"]) / len(g["engagement"]) if g["engagement"] else 0,
            "items": g["items"]
        })

    return result


@function_tool(
    failure_error_function=websearch_fallback_error_function,
    description_override=
    """
Get representative comment examples for SPECIFIC topics. 获取特定话题的代表性评论示例和链接。

WHEN TO USE:
- User asks about SPECIFIC topics/keywords (e.g., "战利品相关评论", "bugs的具体例子", "monetization comments")
- User wants to see actual comment examples/links
- DO NOT use for general questions like "what are players discussing?" → use get_opinion_summary_report instead

CORE FEATURES:
- Get representative examples/links for topics, sorted by impact
- Get top posts/videos/articles per topic
- Returns actual comment content with URLs

Args:
- topics: **REQUIRED** List of specific topics/keywords. NOT sentiment types (positive/negative/neutral)
  Use topic_zh for Chinese, topic for English
- game_names: Target games; game_id will be auto-resolved from context
- start_date/end_date: YYYY-MM-DD; defaults to last 30 days if omitted
- top_n: Number of URLs per topic to return (default 10)
- filters: Optional extra filters for feeds_topic.* fields (language/channel, etc.)
- dimensions: There is compulsory dimensions that must always be included, and arguments dimensions are optional which can be included.

RULES:
- All fields use the same table prefix: "feeds_topic.*"
- Do NOT put game_id in filters (auto-applied)
- Topic filters are applied internally using the provided topics

OUTPUT COLUMNS:
- topic, content, url, engagement, (optional) validation
    """,
    is_enabled=get_tool_enabled(ToolName.GetTopContentByTopic.value),
    readable_name_map={
        "English": "Topic Top Content Tool",
        "Chinese": "话题热门内容工具",
    }
)
async def get_top_content_by_topic(
    context: RunContextWrapper[GameContext],
    topics: List[str],
    game_names: List[str],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    top_n: int = 10,
    filters: Optional[List[Filter]] = None,
    dimensions: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Get top-N URLs per topic ordered by engagement desc (tie-break by validation if available)."""

    # Resolve game ids
    game_ids = await _ensure_game_ids(context, game_names)


    # 判断是否需要关键词匹配
    # 如果 context 中没有话题数据，或 game_id 不在其中，则主动获取
    topics_result = context.context.topics
    if not topics_result or not any(game_id in topics_result for game_id in game_ids):
        logger.warning(f"topics_result为空或game_id不在其中，重新获取话题数据")
        topics_result = await get_topics(tuple(game_ids))
        context.context.topics = topics_result
    
    logger.info(f"topic_content topics_result: {list(topics_result.keys())}")
    
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
    logger.info(f"topic_content topics: {databrain_topics_list}")
    logger.info(f"topic_content keywords: {keywords_list}")

    # Resolve dates from context if not provided
    ctx_dates = (context.context.data or [{}])[0]
    start_date = start_date or ctx_dates.get("start_date")
    end_date = end_date or ctx_dates.get("end_date")

    from datetime import datetime, timedelta
    if not start_date:
        start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    if not end_date:
        end_date = datetime.now().strftime("%Y-%m-%d")

    # 标准化 topics 参数（topic_content_tool 不支持空列表，必须有话题）
    if not topics:
        return {"error": "缺少话题参数，请提供要分析的话题列表", "code": -1}
    if isinstance(topics, str):
        topics = [topics]

    logger.info(f"Topics top-by-engagement for topics {topics} from {start_date} to {end_date}, top_n={top_n}")

    cube_client = get_cube_client()
    transformer = DataTransformer()
    language = getattr(context.context, "language", None) or "English"

    # Build time dimension
    try:
        time_dimension = TimeDimension(
            dimension=f"{FEEDS_TOPIC}.date",
            dateRange=[start_date, end_date],
        )
    except Exception as e:
        logger.error(f"创建TimeDimension失败: {e}")
        raise Exception(f"创建时间维度失败，请确保日期格式正确 (YYYY-MM-DD): {str(e)}")

    # 准备 measures
    measures: List[str] = []
    for comp_measure in COMPULSORY_MEASURES:
        if comp_measure not in measures:
            measures.append(comp_measure)

    # 准备 dimensions（根据语言选择字段）
    topic_field = f"{FEEDS_TOPIC}.topic_zh" if language == "Chinese" else f"{FEEDS_TOPIC}.topic"
    content_field = f"{FEEDS_TOPIC}.content_zh" if language == "Chinese" else f"{FEEDS_TOPIC}.content_en"
    
    # 复制基础维度列表，添加语言相关的字段
    dimensions: List[str] = list(COMPULSORY_DIMENSIONS)  # 复制，避免修改全局常量
    if topic_field not in dimensions:
        dimensions.append(topic_field)
    if content_field not in dimensions:
        dimensions.append(content_field)

    # Filters
    game_id_filter = Filter(
        member=f"{FEEDS_TOPIC}.game_id",
        operator="equals",
        values=game_ids
    )

    if len(game_ids) >= 2:
        dimensions.append(f"{FEEDS_TOPIC}.game_name")
        logger.info(f"检测到{len(game_ids)}个游戏，添加game_name维度进行区分")

    if len(keywords_list) > 0:
        keywords_all_result = []
        keywords_start_time = time.perf_counter()
        logger.info(f"topic content keywords 开始并发查询，数量: {len(keywords_list)}")

        async def fetch_keyword_data(keyword: str):
            keywords_base_filters: List[Union[Filter, FilterGroup]] = [
                game_id_filter,
                keywords_filter_build([keyword]),
            ]
            # 添加用户传入的额外过滤条件
            if filters:
                keywords_base_filters.extend(filters)
            logger.info("------------------" + f"topic content keywords 执行查询 fitler: {keywords_base_filters}" + "------------------")
            logger.info("------------------" + f"topic content keywords 执行查询 dimensions: {dimensions}" + "------------------")
            logger.info("------------------" + f"topic content keywords 执行查询 measures: {measures}" + "------------------")
            keywords_query = ExtendQuery(
                measures=measures,
                dimensions=dimensions,  # 加入话题维度
                timeDimensions=[time_dimension],
                filters=keywords_base_filters,
                order={f"{FEEDS_TOPIC}.engagement": "desc"},
                ungrouped=False,
                limit=100
            )
            logger.info("------------------" + f"topic content keywords 执行查询 keywords_query: {keywords_query}" + "------------------")
            keywords_data_result = await read_cube_data(cube_client, transformer, keywords_query, language)
            return keyword, keywords_data_result

        tasks = [asyncio.create_task(fetch_keyword_data(keyword)) for keyword in keywords_list]
        keywords_results = await asyncio.gather(*tasks, return_exceptions=True)

        for keywords_result in keywords_results:
            if isinstance(keywords_result, Exception):
                logger.warning(f"topic content keywords 并发查询异常: {keywords_result}")
                continue

            keyword, keywords_data_result = keywords_result
            if keywords_data_result.get("code") != 0:
                logger.warning(f"topic_content_tool 关键词话题数据查询失败: keywords_list -- {keywords_list} , keyword -- {keyword}")
                continue

            keywords_data_result_dict = keywords_data_result.get("data", {}).get("data", []) if keywords_data_result.get("code") == 0 else []
            if keywords_data_result_dict:
                keywords_all_result += aggregate_keywords_stats(keyword, topic_field, content_field, keywords_data_result_dict)

        keywords_cost_ms = (time.perf_counter() - keywords_start_time) * 1000
        logger.info(f"topic content keywords 并发查询完成，耗时: {keywords_cost_ms:.2f} ms")

    # 处理数据库话题查询（注意：topic_content_tool 要求必须有 topics，所以这里总是会有话题）
    should_query_databrain_topics = len(databrain_topics_list) > 0 or (len(keywords_list) == 0 and len(databrain_topics_list) == 0)
    
    if should_query_databrain_topics:
        topics_data_result_data = []
        
        # 确定要查询的话题列表
        topics_to_query = databrain_topics_list  # 默认使用指定的话题
        
        if len(databrain_topics_list) == 0:
            # 没有指定话题（查询所有话题）
            # 策略：先使用 get_top_dimensions 获取 top10 热门话题
            logger.info(f"【get_top_content_by_topic】空列表查询：先获取 top10 热门话题")
            
            # 构建 base_query 用于 get_top_dimensions
            base_filters = [game_id_filter]
            if filters:
                base_filters.extend(filters)
            
            base_query = ExtendQuery(
                measures=[f"{FEEDS_TOPIC}.engagement"],
                dimensions=[topic_field],
                timeDimensions=[time_dimension],
                filters=base_filters,
                order={f"{FEEDS_TOPIC}.engagement": "desc"},
            )
            
            # Step 1: 使用 get_top_dimensions 获取 top10 话题
            top_topic_names = await get_top_dimensions(
                context=context,
                base_query=base_query,
                target_dimension=topic_field,
                top_n=10
            )
            
            logger.info(f"【get_top_content_by_topic】获取到 {len(top_topic_names)} 个热门话题: {top_topic_names}")
            
            if not top_topic_names:
                logger.warning(f"【get_top_content_by_topic】未获取到任何热门话题")
            else:
                topics_to_query = top_topic_names
        
        # Step 2: 查询话题的详细评论（统一处理）
        if topics_to_query:
            topic_filter = Filter(
                member=topic_field,
                operator="equals",
                values=topics_to_query
            )
            topic_base_filters: List[Union[Filter, FilterGroup]] = [
                game_id_filter,
                topic_filter,
            ]
            # 统一添加用户传入的额外过滤条件
            if filters:
                topic_base_filters.extend(filters)
            
            logger.info("------------------" + f"topic content topics 执行查询 fitler: {topic_base_filters}" + "------------------")
            logger.info("------------------" + f"topic content topics 执行查询 dimensions: {dimensions}" + "------------------")
            logger.info("------------------" + f"topic content topics 执行查询 measures: {measures}" + "------------------")
            topics_query = ExtendQuery(
                measures=measures,
                dimensions=dimensions,
                timeDimensions=[time_dimension],
                filters=topic_base_filters,
                order={f"{FEEDS_TOPIC}.engagement": "desc"},
                ungrouped=False,
                limit=100
            )
            logger.info("------------------" + f"topic content topics 执行查询: {topics_query}" + "------------------")
            topics_data_result = await read_cube_data(cube_client, transformer, topics_query, language)
            if topics_data_result.get("code") != 0:
                logger.warning(f"话题详细评论查询失败: {topics_data_result.get('data', '未知错误')}")
            if topics_data_result.get("code") == 0:
                topics_data_result_data = topics_data_result["data"]["data"]

    # 合并结果
    all_data_result = []
    if should_query_databrain_topics:
        all_data_result = all_data_result + topics_data_result_data
    if len(keywords_list) > 0:
        all_data_result = all_data_result + keywords_all_result

    # 如果所有查询都失败，则启动网络搜索
    if len(all_data_result) == 0:
        logger.warning(f"话题内容码表和关键词查询都失败, 码表话题: {databrain_topics_list}, 关键词: {keywords_list}, 启动网络搜索")
        raise NoResultException(
            message=f"topic_content_tool 话题内容码表和关键词查询都失败, 码表话题: {databrain_topics_list}, 关键词: {keywords_list}, 启动网络搜索",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )

    #logger.info("------------------" + f"topic content topics all_data_result: {all_data_result}" + "------------------")

    # 使用结构（只要其中一个有结构就足够了）
    if should_query_databrain_topics:
        result_data = topics_data_result.copy()
    else:
        result_data = keywords_data_result.copy()
    if "data" in result_data and "data" in result_data["data"]:
        result_data["data"]["data"] = all_data_result
# "data": [
#     {
#         "topic": "Character",
#         "channel_code": "reddit",
#         "content": "Real life kyle crane\n\nGot in other sub can't do crosspost :) \nCan't find flair for it 😐",
#         "content_en": "Real life kyle crane\n\nGot in other sub can't do crosspost :) \nCan't find flair for it 😐",
#         "content_zh": "现实生活中的凯尔·克莱恩\n\n进入<other>子版块无法进行交叉发布:)\n找不到它的标签😐",
#         "validation": "low",
#         "topic_zh": "角色",
#         "engagement": 1934,
#         "avg_sentiment": 3
#     },
#     {
#         "topic": "Weapon",
#         "channel_code": "youtube_keyword",
#         "content": "The New Rifle in Dying Light The Beast is a BEAST",
#         "content_en": "The New Rifle in Dying Light The Beast is a BEAST",
#         "content_zh": "在<dying light>消逝的光芒</dying> <the beast>困兽</the beast>中的<new>新</new><rifle>步枪</rifle>是<the beast>困兽</the beast>",
#         "validation": "low",
#         "topic_zh": "武器",
#         "engagement": 784.5,
#         "avg_sentiment": 5
#     },
#     {
#         "topic": "Character",
#         "channel_code": "reddit",
#         "content": "My Kyle Crane cosplay\n\nTechland announced cosplay contest and I decided to take part in it   \n  \nhere is link where you can see all the participants (me too) - [cosplay contest ](https://pilgrimoutpost.techlandgg.com/goodies/the-beast-versus-the-baron?fbclid=IwY2xjawN7Hf5leHRuA2FlbQIxMABicmlkETFvekZZTU9IZkJ0aTNFTWJ5c3J0YwZacHBfaWQQMjIyMDM5MTc4ODIwMDg5MgABHts4_gFGlvXguLZIeR2LVrXlt8KZB_Em-phRF8V2yEBw5RAR-dmgyDFtGwiK_aem_L128y-JCvX-O6vVFl-jnqg)",
#         "content_en": "My Kyle Crane cosplay\n\nTechland announced cosplay contest and I decided to take part in it   \n  \nhere is link where you can see all the participants (me too) - [cosplay contest ](https://pilgrimoutpost.techlandgg.com/goodies/the-beast-versus-the-baron?fbclid=IwY2xjawN7Hf5leHRuA2FlbQIxMABicmlkETFvekZZTU9IZkJ0aTNFTWJ5c3J0YwZacHBfaWQQMjIyMDM5MTc4ODIwMDg5MgABHts4_gFGlvXguLZIeR2LVrXlt8KZB_Em-phRF8V2yEBw5RAR-dmgyDFtGwiK_aem_L128y-JCvX-O6vVFl-jnqg)",
#         "content_zh": "我 凯尔 起重机 角色扮演\n\ntechland 宣布 角色扮演 竞赛 和 我 决定 去 拿取 部分 在 推\n  \n这里 是 链接 在哪里 你 生命值 看到 全部 推 参与者 （我 也） - [角色扮演 竞赛](https://pilgrimoutpost.techlandgg.com/goodies/the-beast-versus-the-baron?fbclid=iwy2xjawn7hf5lehrua2flbqixmabicmlketfvekzztu9izkj0atnftwj5c3j0ywzhchbfawqqmjiymdm5mtc4odiwmdg5mgabhts4_gfglvxgulzier2lvrxlt8kzb_em-phrf8v2yebw5rar-dmgydftgwik_aem_l128y-jcvx-o6vvfl-jnqg)",
#         "validation": "high",
#         "topic_zh": "角色",
#         "engagement": 701,
#         "avg_sentiment": 5
#     },

    # 确保result_data的格式正确，包含data字段且data字段为列表
    if "data" in result_data and "data" in result_data["data"]:
        # 确保每个数据项都是字典
        result_data_list = result_data["data"]["data"]
        if not isinstance(result_data_list, list):
            logger.warning(f"Expected list for data.data but got {type(result_data_list)}, converting...")
            if isinstance(result_data_list, dict):
                result_data["data"]["data"] = [result_data_list]
            else:
                # 如果无法转换，创建一个默认的空列表
                result_data["data"]["data"] = []
                logger.error(f"Cannot process non-dict/non-list data: {type(result_data_list)}")
        # transfer the data into group by format
        logger.info("------------------" + "Transferring the data" + "------------------")
        to_transfer_data = result_data_list.copy()
        # group by topic and avg_sentiment
        result_data["data"]["data"] = group_data_pandas(to_transfer_data, topic_field, content_field)
        # {'topic': 'Server',
        # 'sentiment_category': 'positive',
        # 'content_list': [
            # {'content': \"i really enjoyed it. i would burst into hordes of zombies and smash their faces. it was especially nice at the start when i would join the guys' servers and they would drop me clothing recipes)\",
            # 'url': 'https: // steamcommunity.com/profiles/76561198086095318/recommended/3008130/'},
            # {'content': \"i really loved that techland is listing to the community and fixing stuff without any delay i been keeping up with the game through the discord server really wanted to buy it on the black friday sale but i had to save my paycheck cause i need for college travelling and for all other supplies would love to play i can't lie 💚\",
            # 'url': 'https://www.youtube.com/watch?v=Ti2xa0YABWo&lc=Ugz67XwsFhJuLLYWQ3R4AaABAg'},
            # {'content': \"I'd love to see you, Sour & Muller play Arc Raiders. With all that Dayz experience, you guys would own servers constantly (with the right guns&gear obviously).\",
            # 'url': 'https: // www.youtube.com/watch?v = Tv6hEuAHkQs & lc = UgzrT2HoqFx_Gmvg7xB4AaABAg'}
        # ]
        logger.info("------------------ transferred result data: ------------------" +f"{result_data}" + "------------------")
    # Don't need metric info
    if "metrics_info" in result_data["data"]:
        result_data["data"]["metrics_info"] = []
    result_data["data_id"] = f"topic_content_{uuid.uuid4()}"
    result_data["system"] = "opinion"
    # context.context.data.append(result_data) 不需要在上下文中存储结果，不需出图
    topic_content_tool_prmopt = """As a game community expert, you are skilled at professionally interpreting and analyzing insights based on player reviews of games. Please generate a brief actionable summary report based on the current player reviews of the game, with a particular focus on the top 3 most positive and most negative game-related topics (if any), and provide specific examples for each topic. Finally, conclude the report with a concise, executive summary that is as detailed as possible and provides relevant reviews examples.
Note: All content must be answered based on the provided player reviews, do not attempt to fabricate topic results and content. Do not use Markdown text format. **IMPORTANT**:Please provide the corresponding URL for each representative comment and output it in the form of a clickable hyperlink.

Return format:
Summary:
<Summary>
Positive Topics:
<Positive topic list format. No. Topic Name: Main player opinions, and key detailed reviews>
Negative Topics:
<Negative topic list format. No. Topic Name: Main player opinions, and key detailed reviews>
Neutral Topics:
<Neutral topic list format. No. Topic Name: Main player opinions, and key detailed reviews>
Executive Summary Report:
<Overview of player opinions, and actionable suggestions>

"""
    if language == "Chinese":
        topic_content_tool_prmopt = """你是游戏社群专家，擅长根据玩家对游戏的评论进行专业的解读和分析洞察。请根据目前游戏的玩家评论生成简要可执行的摘要报告，需要重点突出 Top 3 个最积极和最消极的游戏相关话题（如果有），并为每个话题提供具体的例子。最后以简洁的可执行的摘要来结束报告，需要尽可能详细，并提供相关的评论示例。
注意：所有内容必须根据提供的玩家评论进行回答，不要尝试编造话题结果和内容。使用 Markdown 文本格式输出。**IMPORTANT**:请为每条代表性评论提供对应的URL，并用可以点击的超链接形式输出。

返回格式：
摘要：
<摘要＞
正面话题：
<正面话题列表格式。编号．主题名称：玩家的主要意见，以及重点细节评论＞
负面话题：
<负面话题格式列表。编号．主题名称：玩家主要意见，以及重点细节评论＞
可执行的摘要报告：
中性话题：
<中性话题格式列表。编号．主题名称：玩家主要意见，以及重点细节评论＞
可执行的摘要报告：
<玩家意见概述，以及可执行性的建议＞
        """
    result_data["instruction"] = topic_content_tool_prmopt
    # 6. 转换为 CSV 格式并返回（减少 token 消耗，并且保证URL和content都在）
    if result_data.get("code") == 0 and "data" in result_data and "data" in result_data["data"]:
        df = pd.DataFrame(result_data["data"]["data"])

        # 构建基础返回结果
        final_result = {
            "data_id": result_data["data_id"],
            "system": result_data["system"],
            "instruction": topic_content_tool_prmopt
        }

        # 数据采样（仅当数据量超过5000时）
        if len(df) > 5000:
            try:
                # 获取分组字段和指标字段
                dimension_info = result_data["data"].get("dimension_info", [])
                metrics_info = result_data["data"].get("metrics_info", [])

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

                logger.info(f"数据采样完成：原始数据量 {len(df)} -> 采样后 {len(sampled_df)}")

                # 使用采样后的数据
                csv_string = sampled_df.to_csv(index=False)
                final_result["data"] = csv_string

                inject_metric_kb(measures, final_result)
                return final_result
            except Exception as e:
                logger.warning(f"数据采样失败，使用原始数据: {e}")

        # 使用原始数据（未采样或采样失败）
        csv_string = df.to_csv(index=False)
        final_result["data"] = csv_string
        inject_metric_kb(measures, final_result)
        return final_result
    if isinstance(result_data, dict):
        inject_metric_kb(measures, result_data)
    return truncate_output(result_data)

