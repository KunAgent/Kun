"""
话题内容服务 - 封装get_top_content_by_topic的核心逻辑
"""
import asyncio
import time
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Union

import pandas as pd
from loguru import logger
from urllib.parse import urlparse

from run_context_wrapper import RunContextWrapper
from opinion_strategy.context import GameContext
from opinion_tools.cube.cube_model import ExtendQuery, Filter, FilterGroup, TimeDimension
from opinion_tools.cube.cube_tools import read_cube_data
from opinion_tools.cube.transformers import DataTransformer
from opinion_tools.opinion.opinion_tools import _ensure_game_ids
from opinion_tools.opinion.topic_ratio_tool import fix_topic_prefix, categorize_topics_simple
from opinion_tools.opinion.utils.cube_helper import get_cube_client
from opinion_tools.opinion.utils.topics_helper import get_topics
from opinion_tools.opinion.utils.utils import truncate_output
from opinion_tools.opinion.utils.top_dimension_helper import get_top_dimensions
from opinion_utils.df_sampler import DataFrameSampler
from opinion_utils.exceptions import NoResultException

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


def _extract_cube_rows(result: Any) -> List[Dict[str, Any]]:
    """Extract rows from both normal and single-row cube transformer shapes."""
    if not isinstance(result, dict):
        return []
    data = result.get("data")
    if isinstance(data, dict):
        rows = data.get("data", [])
    elif isinstance(data, list):
        rows = data
    else:
        rows = []
    return rows if isinstance(rows, list) else []


def _is_cube_success(result: Any) -> bool:
    return isinstance(result, dict) and result.get("code") in (0, 2)

def is_valid_url(u: Any) -> bool:
    """严格 URL 校验：必须是 http/https 且有 netloc"""
    if not isinstance(u, str):
        return False
    u = u.strip()
    if not u:
        return False
    try:
        p = urlparse(u)
        if p.scheme not in ("http", "https"):
            return False
        if not p.netloc:
            return False
        return True
    except Exception:
        return False
    
def process_sentiment_analysis(grouped_data, topic_field):
    """
    处理情感分析数据（灵活展示）：
    1. 按情感分类分组，每组返回所有话题（不限制数量）
    2. 在代码层准确计算各情感分类的占比（保证数据准确性）
    3. 计算各话题的占比
    4. 让 LLM 根据数据灵活展示话题数量（通常 3-5 个，但可以更多或更少）
    """
    perf_start = time.time()
    logger.info(f"【process_sentiment_analysis】开始处理，输入数据量: {len(grouped_data)}")
    
    try:
        step_time = time.time()
        df = pd.DataFrame(grouped_data)
        logger.debug(f"【process_sentiment_analysis】DataFrame 创建耗时: {time.time() - step_time:.3f}秒")
        
        if df.empty:
            return grouped_data
        
        # 确保 engagement 和 count 列存在
        if 'engagement' not in df.columns or 'count' not in df.columns:
            logger.warning("数据中缺少 engagement 或 count 字段，跳过情感分析处理")
            return grouped_data
        
        # 计算总评论数
        total_count = df['count'].sum()
        
        # 按情感分类分组
        sentiment_groups = {
            'positive': df[df['sentiment_category'] == 'positive'].copy(),
            'negative': df[df['sentiment_category'] == 'negative'].copy(),
            'neutral': df[df['sentiment_category'] == 'neutral'].copy()
        }
        
        # 计算各情感分类的占比
        sentiment_percentages = {}
        for sentiment, group_df in sentiment_groups.items():
            if not group_df.empty:
                sentiment_count = group_df['count'].sum()
                sentiment_percentages[sentiment] = round((sentiment_count / total_count) * 100, 1) if total_count > 0 else 0
            else:
                sentiment_percentages[sentiment] = 0
        
        # 对每个情感分类按 engagement 排序，返回所有话题（不限制数量）
        processed_results = []
        
        for sentiment, group_df in sentiment_groups.items():
            if not group_df.empty:
                # 按 engagement 降序排序
                sorted_df = group_df.sort_values('engagement', ascending=False)
                
                # 返回该分类的所有话题（不限制 top3，让 LLM 根据数据灵活展示）
                for _, row in sorted_df.iterrows():
                    # 计算该话题的占比
                    topic_percentage = round((row['count'] / total_count) * 100, 1) if total_count > 0 else 0
                    
                    processed_results.append({
                        topic_field: row[topic_field],
                        "sentiment_category": sentiment,
                        "sentiment_percentage": sentiment_percentages[sentiment],  # 代码层精确计算的情感分类占比
                        "topic_percentage": topic_percentage,  # 话题占比
                        "engagement": row['engagement'],
                        "count": row['count'],
                        "content_list": row['content_list']
                    })
        
        logger.info(f"【process_sentiment_analysis】情感分类占比: {sentiment_percentages}")
        logger.info(f"【process_sentiment_analysis】各情感分类话题数: "
                   f"positive={len(sentiment_groups['positive'])}, "
                   f"negative={len(sentiment_groups['negative'])}, "
                   f"neutral={len(sentiment_groups['neutral'])}")
        logger.info(f"【process_sentiment_analysis】返回所有话题共 {len(processed_results)} 个，LLM 将根据数据灵活展示")
        
        # 数据质量检查：提醒只有一种情感分类的情况
        non_empty_sentiments = [s for s, g in sentiment_groups.items() if not g.empty]
        if len(non_empty_sentiments) == 1:
            logger.warning(f"【process_sentiment_analysis】注意：只有 {non_empty_sentiments[0]} 情感分类有数据，"
                          "这可能表示数据偏斜或筛选条件过于严格（如只查询了负面反馈）")
        
        logger.info(f"【process_sentiment_analysis】处理完成，总耗时: {time.time() - perf_start:.3f}秒")
        return processed_results
    except Exception as e:
        logger.error(f"【process_sentiment_analysis】处理情感分析数据时出错: {e}", exc_info=True)
        return grouped_data


def group_data_pandas(data_list, topic_field, content_field):
    """对数据按话题和情感分类进行分组，并添加 engagement 和 count 信息
    
    性能优化：
    1. 预处理字符串清理（批量操作）
    2. 使用 to_dict('records') 替代 iterrows()
    3. 向量化操作替代逐行处理
    """
    perf_start = time.time()
    
    content_field = content_field.split(".")[1]
    topic_field = topic_field.split(".")[1]
    logger.info(f"【group_data_pandas】开始处理，content_field: {content_field}, topic_field: {topic_field}, 数据量: {len(data_list)}")
    
    try:
        # 步骤1：创建 DataFrame（性能监控）
        step_time = time.time()
        df = pd.DataFrame(data_list)
        logger.debug(f"【group_data_pandas】DataFrame 创建耗时: {time.time() - step_time:.3f}秒")
        
        # 步骤2：字段检查和初始化
        step_time = time.time()
        required_fields = [topic_field, 'avg_sentiment', 'engagement', content_field, 'url']
        for field in required_fields:
            if field not in df.columns:
                if field == 'avg_sentiment':
                    df[field] = 0
                elif field == 'engagement':
                    df[field] = 0
                else:
                    df[field] = ''
        
        df['avg_sentiment'] = pd.to_numeric(df['avg_sentiment'], errors='coerce').fillna(0)
        df['engagement'] = pd.to_numeric(df['engagement'], errors='coerce').fillna(0)
        logger.debug(f"【group_data_pandas】字段初始化耗时: {time.time() - step_time:.3f}秒")
        
        # 步骤3：情感分类（向量化操作）
        step_time = time.time()
        df['sentiment_category'] = pd.cut(
            df['avg_sentiment'],
            bins=[-float('inf'), 2.8, 3.2, float('inf')],
            labels=['negative', 'neutral', 'positive']
        ).astype(str)
        logger.debug(f"【group_data_pandas】情感分类耗时: {time.time() - step_time:.3f}秒")
        
        # 步骤4：预处理字符串（批量操作，避免在循环中重复处理）
        step_time = time.time()
        # 过滤空内容
        df = df[df[content_field].notna() & (df[content_field] != '') & (df[content_field] != 'nan')]
        
        # 批量字符串清理
        df['cleaned_content'] = (
            df[content_field]
            .astype(str)
            .str.replace('\n', ' ', regex=False)
            .str.replace('\r', ' ', regex=False)
        )
        
        # 批量截断（向量化操作）
        df['display_content'] = df['cleaned_content'].apply(
            lambda x: x[:60] + "..." if len(x) > 60 else x
        )
        logger.debug(f"【group_data_pandas】字符串预处理耗时: {time.time() - step_time:.3f}秒")
        
        # 步骤5：分组聚合（使用更高效的方式）
        step_time = time.time()
        df_small = df[[topic_field, 'display_content', "url", "sentiment_category", "engagement"]]
        
        # 使用 agg 和 apply 结合，避免 iterrows
        result = []
        for (topic, sentiment), group in df_small.groupby([topic_field, "sentiment_category"]):
            # 直接使用 to_dict('records') 构建 content_list
            content_list = [
                {"content": row['display_content'], "url": row["url"]}
                for row in group[['display_content', 'url']].to_dict('records')
            ]
            
            result.append({
                topic_field: topic,
                "sentiment_category": sentiment,
                "engagement": group["engagement"].sum(),
                "count": len(group),
                "content_list": content_list
            })
        
        logger.debug(f"【group_data_pandas】分组聚合耗时: {time.time() - step_time:.3f}秒")
        logger.info(f"【group_data_pandas】处理完成，总耗时: {time.time() - perf_start:.3f}秒，返回 {len(result)} 个分组")
        
        return result
    except Exception as e:
        logger.error(f"【group_data_pandas】处理数据时出错: {e}", exc_info=True)
        return []


def keywords_filter_build(keywords_list):
    """构建关键词过滤器"""
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
    """聚合关键词统计数据"""
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
        topic = d.get(topic_field)
        channel = d.get("channel_code")
        key = (topic, channel)

        groups[key][topic_field] = keyword
        groups[key]["channel_code"] = channel
        groups[key]["items"].append({
            "content": d.get("content"),
            content_field: d.get(content_field),
            "url": d.get("url"),
            "validation": d.get("validation")
        })

        groups[key]["avg_sentiment"].append(d.get("avg_sentiment", 0) or 0)
        groups[key]["engagement"].append(d.get("engagement", 0) or 0)

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


async def _get_top_content_by_topic(
    context: RunContextWrapper[GameContext],
    topics: List[str],
    game_names: List[str],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    top_n: int = 10,
    filters: Optional[List[Filter]] = None,
    dimensions: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    内部服务函数：获取话题相关的热门内容
    
    这是对原 get_top_content_by_topic 的直接封装，用于在新的 v2 工具中复用
    
    Args:
        context: 运行上下文
        topics: 话题列表
        game_names: 游戏名称列表
        start_date: 开始日期 (YYYY-MM-DD)
        end_date: 结束日期 (YYYY-MM-DD)
        top_n: 每个话题返回的URL数量
        filters: 额外的过滤条件
        dimensions: 额外的维度字段
    
    Returns:
        Dict: 包含话题内容的字典
    """
    logger.info(f"【_get_top_content_by_topic】开始执行，话题: {topics}, 游戏: {game_names}")
    
    # Resolve game ids
    game_ids = await _ensure_game_ids(context, game_names)

    # 只有当topics不为空时才进行话题分类
    databrain_topics_list = []
    keywords_list = []
    
    if topics:  # 有指定话题
        # 判断是否需要关键词匹配
        topics_result = context.context.topics
        if not topics_result or not any(game_id in topics_result for game_id in game_ids):
            logger.warning(f"topics_result为空或game_id不在其中，重新获取话题数据")
            topics_result = await get_topics(tuple(game_ids))
            context.context.topics = topics_result
        
        logger.info(f"topic_content topics_result: {list(topics_result.keys())}")
        
        # 分类 topics
        for game_id in game_ids:
            if game_id in topics_result:
                game_topics_data = topics_result[game_id]
                topics = fix_topic_prefix(topics, game_topics_data)
                logger.info(f"修复后的topics: {topics}")
                existing_topics, not_existing_keywords = categorize_topics_simple(topics, game_topics_data)
                databrain_topics_list.extend(existing_topics)
                keywords_list.extend(not_existing_keywords)
        
        databrain_topics_list = list(set(databrain_topics_list))
        keywords_list = list(set(keywords_list))
        
        if not databrain_topics_list and not keywords_list and topics:
            keywords_list = topics
        if len(keywords_list) > 10:
            keywords_list = keywords_list[:10]
        logger.info(f"topic_content topics: {databrain_topics_list}")
        logger.info(f"topic_content keywords: {keywords_list}")
    else:  # 空列表，查询所有话题
        logger.info(f"topic_content: 查询所有话题（topics为空列表）")

    # Resolve dates from context if not provided
    ctx_dates = (context.context.data or [{}])[0]
    start_date = start_date or ctx_dates.get("start_date")
    end_date = end_date or ctx_dates.get("end_date")

    if not start_date:
        start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    if not end_date:
        end_date = datetime.now().strftime("%Y-%m-%d")

    # 标准化 topics 参数：支持 None、字符串、列表
    if topics is None:
        topics = []
    if isinstance(topics, str):
        topics = [topics]

    if topics:
        logger.info(f"Topics top-by-engagement for topics {topics} from {start_date} to {end_date}, top_n={top_n}")
    else:
        logger.info(f"Topics top-by-engagement for ALL topics from {start_date} to {end_date}, top_n={top_n}")

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
    
    # 准备 dimensions（你原来的逻辑）
    dimensions: List[str] = list(COMPULSORY_DIMENSIONS)
    if topic_field not in dimensions:
        dimensions.append(topic_field)
    if content_field not in dimensions:
        dimensions.append(content_field)

    # keyword 分支专用：去掉真实 topic_field，避免一条评论被多个topic拆多行
    kw_dimensions = [d for d in dimensions if d != topic_field]
    if content_field not in kw_dimensions:
        kw_dimensions.append(content_field)

    # Filters
    game_id_filter = Filter(
        member=f"{FEEDS_TOPIC}.game_id",
        operator="equals",
        values=game_ids
    )

    if len(game_ids) >= 2:
        dimensions.append(f"{FEEDS_TOPIC}.game_name")
        logger.info(f"检测到{len(game_ids)}个游戏，添加game_name维度进行区分")

    # 处理关键词查询
    if len(keywords_list) > 0:
        keywords_all_result = []
        keywords_success_template = None
        keywords_start_time = time.perf_counter()
        logger.info(f"【_get_top_content_by_topic】keywords 开始并发查询，数量: {len(keywords_list)}, 关键词: {keywords_list}")

        async def fetch_keyword_data(keyword: str):
            query_start = time.time()
            logger.debug(f"【_get_top_content_by_topic】开始查询 keyword: {keyword}")
            
            keywords_base_filters: List[Union[Filter, FilterGroup]] = [
                game_id_filter,
                keywords_filter_build([keyword]),
            ]
            if filters:
                keywords_base_filters.extend(filters)
            
            keywords_query = ExtendQuery(
                measures=measures,
                dimensions=kw_dimensions,
                timeDimensions=[time_dimension],
                filters=keywords_base_filters,
                order={f"{FEEDS_TOPIC}.engagement": "desc"},
                ungrouped=False,
                limit=100
            )
            keywords_data_result = await read_cube_data(cube_client, transformer, keywords_query, language)
            logger.debug(f"【_get_top_content_by_topic】keyword '{keyword}' 查询完成，耗时: {time.time() - query_start:.3f}秒，返回 {len(_extract_cube_rows(keywords_data_result))} 行")
            return keyword, keywords_data_result

        tasks = [asyncio.create_task(fetch_keyword_data(keyword)) for keyword in keywords_list]
        keywords_results = await asyncio.gather(*tasks, return_exceptions=True)
        keywords_end_time = time.perf_counter()
        keywords_total_time = (keywords_end_time - keywords_start_time) * 1000
        logger.info(f"【_get_top_content_by_topic】keywords 并发查询完成，总耗时: {keywords_total_time:.2f}ms，平均每个关键词: {keywords_total_time/len(keywords_list):.2f}ms")

        for keywords_result in keywords_results:
            if isinstance(keywords_result, Exception):
                logger.warning(f"topic content keywords 并发查询异常: {keywords_result}")
                continue

            keyword, kw_result = keywords_result
            if not _is_cube_success(kw_result):
                logger.warning(f"topic_content_tool 关键词话题数据查询失败: keywords_list -- {keywords_list} , keyword -- {keyword}")
                continue
            
            if keywords_success_template is None:
                keywords_success_template = kw_result
                
            keywords_data_result_dict = _extract_cube_rows(kw_result)
            if isinstance(keywords_data_result_dict, list) and keywords_data_result_dict:
                # 关键：让 keyword 替代 topic 写进行数据
                topic_key = topic_field.split(".")[1]  # topic_zh or topic
                for r in keywords_data_result_dict:
                    r[topic_key] = keyword
                # keywords_all_result += aggregate_keywords_stats(
                #     keyword, topic_field, content_field, keywords_data_result_dict
                # )
                # 直接并入明细行，走统一聚合链路
                keywords_all_result += keywords_data_result_dict
        keywords_cost_ms = (time.perf_counter() - keywords_start_time) * 1000
        logger.info(f"topic content keywords 并发查询完成，耗时: {keywords_cost_ms:.2f} ms")

    # 处理数据库话题查询
    # 条件: 有指定的databrain话题 或 没有指定任何话题（topics为None/[]）
    should_query_databrain_topics = len(databrain_topics_list) > 0 or not topics
    
    if should_query_databrain_topics:
        topics_data_result_data = []
        
        # 确定要查询的话题列表
        topics_to_query = databrain_topics_list  # 默认使用指定的话题
        
        if len(databrain_topics_list) == 0:
            # 没有指定话题（查询所有话题）
            # 策略：先使用 get_top_dimensions 获取 top10 热门话题
            logger.info(f"【_get_top_content_by_topic】空列表查询：先获取 top10 热门话题")
            
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
            
            logger.info(f"【_get_top_content_by_topic】获取到 {len(top_topic_names)} 个热门话题: {top_topic_names}")
            
            if not top_topic_names:
                logger.warning(f"【_get_top_content_by_topic】未获取到任何热门话题，游戏可能没有舆情数据")
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
            
            topics_query = ExtendQuery(
                measures=measures,
                dimensions=dimensions,
                timeDimensions=[time_dimension],
                filters=topic_base_filters,
                order={f"{FEEDS_TOPIC}.engagement": "desc"},
                ungrouped=False,
                limit=100
            )
            topics_data_result = await read_cube_data(cube_client, transformer, topics_query, language)
            if not _is_cube_success(topics_data_result):
                logger.warning(f"话题详细评论查询失败: {topics_data_result.get('data', '未知错误')}")
            if _is_cube_success(topics_data_result):
                topics_data_result_data = _extract_cube_rows(topics_data_result)

    # 合并结果
    all_data_result = []
    if should_query_databrain_topics:
        all_data_result = all_data_result + topics_data_result_data
    if len(keywords_list) > 0:
        all_data_result = all_data_result + keywords_all_result
    
    # ---- URL 质量过滤：在聚合前先剔除脏URL----
    before_cnt = len(all_data_result)
    all_data_result = [
        r for r in all_data_result
        if is_valid_url(r.get("url"))
    ]
    dropped = before_cnt - len(all_data_result)
    if dropped > 0:
        logger.info(f"【_get_top_content_by_topic】URL校验过滤：剔除 {dropped}/{before_cnt} 条非标准URL数据")

    # 如果所有查询都失败，则启动网络搜索
    if len(all_data_result) == 0:
        if topics:  # 如果有指定话题但查询失败
            logger.warning(f"话题内容码表和关键词查询都失败, 码表话题: {databrain_topics_list}, 关键词: {keywords_list}, 启动网络搜索")
            raise NoResultException(
                message=f"topic_content_tool 话题内容码表和关键词查询都失败, 码表话题: {databrain_topics_list}, 关键词: {keywords_list}, 启动网络搜索",
                search_query=context.context.planner_context.rephrased_question,
                use_web_search=True,
            )
        else:  # 如果是查询所有话题但没有数据
            logger.warning(f"游戏 {game_names} 没有任何舆情数据, 启动网络搜索")
            raise NoResultException(
                message=f"游戏 {', '.join(game_names)} 没有任何舆情数据, 启动网络搜索",
                search_query=context.context.planner_context.rephrased_question,
                use_web_search=True,
            )
            
    # ---- 构建结果（选择模板 + 填充 all_data_result）----

    # 选择模板优先级：
    # 1) 只要“走了 databrain topics”（包括 topics 为空触发的 ALL topics/top10 分支），就优先用 topics_data_result 作为模板
    # 2) 否则（纯 keywords），用 keywords_success_template 作为模板
    # 3) 再否则兜底空模板
    use_topics_template = (len(databrain_topics_list) > 0) or (
        len(keywords_list) == 0 and len(databrain_topics_list) == 0
    )

    if use_topics_template:
        if _is_cube_success(topics_data_result):
            result_data = topics_data_result.copy()
            logger.info("【_get_top_content_by_topic】使用 topics_data_result 作为返回结果模板")
        else:
            result_data = {"code": 0, "data": {"data": []}}
            logger.warning(
                "【_get_top_content_by_topic】topics_data_result 不可用，使用空模板")
    else:
        if _is_cube_success(keywords_success_template):
            result_data = keywords_success_template.copy()
            logger.info(
                "【_get_top_content_by_topic】使用 keywords_success_template 作为返回结果模板")
        else:
            result_data = {"code": 0, "data": {"data": []}}
            logger.warning(
                "【_get_top_content_by_topic】keywords_success_template 不可用，使用空模板")

    # 覆盖 data.data 为合并后的明细
    if not isinstance(result_data.get("data"), dict):
        result_data["data"] = {"data": _extract_cube_rows(result_data)}
    result_data.setdefault("data", {})
    result_data["data"]["data"] = all_data_result

    if "data" in result_data and "data" in result_data["data"]:
        result_data_list = result_data["data"]["data"]
        if not isinstance(result_data_list, list):
            logger.warning(f"Expected list for data.data but got {type(result_data_list)}, converting...")
            if isinstance(result_data_list, dict):
                result_data["data"]["data"] = [result_data_list]
            else:
                result_data["data"]["data"] = []
                logger.error(f"Cannot process non-dict/non-list data: {type(result_data_list)}")
        
        logger.info("【_get_top_content_by_topic】==================== 开始数据转换处理 ====================")
        perf_start = time.time()
        
        # 性能优化：移除不必要的数据拷贝，直接传递引用
        step_time = time.time()
        grouped_data = group_data_pandas(result_data_list, topic_field, content_field)
        logger.info(f"【_get_top_content_by_topic】group_data_pandas 耗时: {time.time() - step_time:.3f}秒")
        
        # 处理情感分析：筛选 top3、计算占比
        step_time = time.time()
        processed_data = process_sentiment_analysis(grouped_data, topic_field.split(".")[1] if "." in topic_field else topic_field)
        logger.info(f"【_get_top_content_by_topic】process_sentiment_analysis 耗时: {time.time() - step_time:.3f}秒")
        
        result_data["data"]["data"] = processed_data
        logger.info(f"【_get_top_content_by_topic】数据转换处理完成，总耗时: {time.time() - perf_start:.3f}秒")

    if "metrics_info" in result_data["data"]:
        result_data["data"]["metrics_info"] = []
    result_data["data_id"] = f"topic_content_{uuid.uuid4()}" #不需要data_id，仅bidata需要
    result_data["system"] = "opinion"
    
    # 设置prompt
    topic_content_tool_prompt = """你是游戏社群专家，擅长根据玩家对游戏的评论进行专业的解读和分析洞察。请根据目前游戏的玩家评论生成摘要报告，需要重点突出 Top 3 个最积极和最消极的游戏相关话题（如果有），并为每个话题提供具体的例子.
注意：所有内容必须根据提供的玩家评论进行回答，不要尝试编造话题结果和内容。使用 Markdown 文本格式输出。

**URL链接规则（严格遵守）**：
- 每条评论数据中已包含与其配对的 url 字段。引用评论时，只使用该评论记录中明确存在的 url。
- 严禁构造、推断或借用其他评论的 url。如果某条评论的 url 字段为空，则不添加任何链接；如果非空，必须在引用末尾输出 `[链接](url)`，不能丢弃。

**内容相关性规则（严格遵守）**：
- 仅展示与用户查询话题直接相关的评论。如果用户要求的是特定话题（如"剧情"、"氪金"等），过滤掉与该话题无关的评论，即使数据中包含它们。

**输出格式**：
**摘要**：
<一段话总结主要发现，需要具体指出玩家关注的核心话题，避免空洞表述>

**摘要撰写要求**：
- 具体信息：直接说明最主要的正面/负面话题是什么，包含具体的话题名称、占比、关键问题（如"负面反馈集中在战斗系统缺乏创新、游戏卡顿等方面"）
- 绝对不要说"两极分化"、"褒贬不一"、"评价不一"、"整体来看有正面有负面"等废话

**正面讨论**（{sentiment_percentage}%）：
   - 按 topic_percentage 降序展示 Top 3 话题
   - 每个话题格式：{序号}. {具体话题标题}({topic_percentage}%): {详细总结包含具体问题和讨论内容2-3句话}。例如，{引用1-2条真实评论内容，用引号括起来}[链接]({url，仅当该评论记录中存在url时才添加})。
   
**负面讨论**（{sentiment_percentage}%）：
   - 按 topic_percentage 降序展示 Top 3 话题
   - 每个话题格式：{序号}. {具体话题标题}({topic_percentage}%): {详细总结包含具体问题和讨论内容2-3句话}。例如，{引用1-2条真实评论内容，用引号括起来}[链接]({url，仅当该评论记录中存在url时才添加})。
   
**中性讨论**（{sentiment_percentage}%）：
   - 按 topic_percentage 降序展示 Top 3 话题
   - 每个话题格式：{序号}. {具体话题标题}({topic_percentage}%): {详细总结包含具体问题和讨论内容2-3句话}。例如，{引用1-2条真实评论内容，用引号括起来}[链接]({url，仅当该评论记录中存在url时才添加})。

**话题总结撰写要求（重要）**：
1. **必须引用真实评论**：每个话题必须引用 1-2 条 content_list 中的真实评论，用引号括起来；每条引用评论不超过20字，过长时截取核心内容。仅当该评论记录的 url 字段非空时，才在引用后附加链接。
   - 示例格式：例如，有评论指出"组队收益不砍，流放2必死"[链接](url)，并直言"下赛季组队不砍这游戏就凉透了"（此评论无链接，不附加）。
2. **总结要详细具体**：不要只说"玩家认为XXX好/不好"，要说明具体的问题、原因、影响
   - 差的总结：玩家认为战利品系统设计优秀
   - 好的总结：玩家普遍认为战利品系统设计优秀，获得稀有物品时的体验感强，掉落动画和音效让人满意
3. **话题标题要具体**：标题应该包含具体的问题或特点，而不只是话题名称
   - 不要只写"战利品"、"组队"等简单词汇，而要写"战利品获取方式讨论"、"组队机制体验分享"等具体描述
   - 差的标题：组队（15.4%）
   - 好的标题：组队收益过高导致游戏失衡（15.4%）

**重要说明**：
1. 使用 Markdown 链接格式引用评论：[链接]({url})，只在评论记录中 url 存在且非空时才添加链接
2. sentiment_percentage 已在代码层精确计算，直接使用即可，不要修改或重新计算
3. 每个情感分类展示的话题数量灵活：
   - 通常展示 Top 3-5 个最重要的话题（按 topic_percentage 或 engagement 排序）
   - 如果该分类话题少于 3 个，展示全部
   - 如果该分类话题很多且重要，可以展示更多（如 5-6 个）
   - 如果该分类只有 1 种情感（sentiment_percentage = 100%），可以展示更多话题
   - 仅输出数据中存在的情感分类，如果某个情感分类没有数据则跳过
4. 当 sentiment_percentage = 100% 时，说明查询只针对该情感（如只查"负面反馈"），此时改为"负面反馈集中在以下话题"等表述，不要说"负面讨论占比100%"
"""
    if language != "Chinese":
        topic_content_tool_prompt = """You are a game community expert skilled at professionally interpreting player feedback. Generate a brief actionable summary report highlighting the Top 3 most positive and negative game-related topics with specific examples.
Note: All content must be based on the provided player reviews. Use Markdown format.

**URL Link Rules (strictly enforced)**:
- Each comment record already contains a url field paired with that specific comment. When citing a comment, ONLY use the url that belongs to that same record.
- NEVER construct, infer, or borrow a url from another comment record. If a comment's url field is empty or missing, do NOT add any link; if it is non-empty, you MUST append `[Link](url)` after the quote — do not drop it.

**Content Relevance Rules (strictly enforced)**:
- Only present comments that are directly relevant to the user's requested topic. If the user asked about a specific topic (e.g., "story", "monetization"), filter out comments unrelated to that topic even if the tool returned them.

**Return format**：
**Summary**：
<One paragraph summarizing main findings, must specify core topics players focus on, avoid empty rhetoric>

**Summary Writing Requirements**：
- Specific: Directly state the main positive/negative topics, include specific topic names, percentages, key issues (e.g., "negative feedback focuses on lack of innovation in combat system, game stuttering, etc.")
- NEVER say "polarization", "mixed reviews", "opinions vary", "overall there are positives and negatives" - these are useless

**Positive Discussion** ({sentiment_percentage}%):
   - Show Top 3 topics ordered by topic_percentage descending
   - Format for each topic: {number}. {specific topic title} ({topic_percentage}%): {detailed summary including specific issues/features/controversies, 2-3 sentences}. For example, {quote 1-2 real comments in quotation marks}[Link]({url — only include if the url field is non-empty for that comment record}).
   
**Negative Discussion** ({sentiment_percentage}%):
   - Show Top 3 topics ordered by topic_percentage descending
   - Format for each topic: {number}. {specific topic title} ({topic_percentage}%): {detailed summary including specific issues/features/controversies, 2-3 sentences}. For example, {quote 1-2 real comments in quotation marks}[Link]({url — only include if the url field is non-empty for that comment record}).
   
**Neutral Discussion** ({sentiment_percentage}%):
   - Show Top 3 topics ordered by topic_percentage descending
   - Format for each topic: {number}. {specific topic title} ({topic_percentage}%): {detailed summary of main discussion content and direction, 2-3 sentences}. For example, {quote 1-2 real comments in quotation marks}[Link]({url — only include if the url field is non-empty for that comment record}).

**Topic Summary Writing Requirements (Important)**:
1. **Must quote real comments**: Each topic must quote 1-2 real comments from content_list, in quotation marks; keep each quoted comment under 20 words, extract the key point if too long. Only add a link after the quote if that comment record's url field is non-empty.
   - Example format: For example, one comment stated "party rewards are too high, PoE2 will die if not nerfed"[Link](url), and another bluntly said "if party rewards aren't nerfed next season, this game is dead" (no link — url was empty).
2. **Summary must be detailed and specific**: Don't just say "players think XXX is good/bad", explain specific issues, reasons, impacts
   - Bad summary: Players think the loot system is well designed
   - Good summary: Players generally believe the loot system is well designed, with strong satisfaction when obtaining rare items, and appreciate the drop animations and sound effects
3. **Topic titles must be specific**: Titles should include specific issues or features, not just topic names
   - Don't just write "loot", "party", use specific descriptions like "Low loot drop rate causes dissatisfaction", "Overpowered party rewards break game balance"
   - Bad title: Party (15.4%)
   - Good title: Overpowered party rewards break game balance (15.4%)

**Important Rules**:
1. Use Markdown link format: [Link]({url}). Only add the link when the comment record's url is explicitly present and non-empty.
2. sentiment_percentage is accurately calculated at code level; use it directly without modification or recalculation
3. Flexible number of topics to display for each sentiment category:
   - Usually display Top 3-5 most important topics (ordered by topic_percentage or engagement)
   - If the category has fewer than 3 topics, display all
   - If the category has many important topics, can display more (e.g., 5-6)
   - If only one sentiment exists (sentiment_percentage = 100%), can display more topics
   - Only output sentiment categories that exist in the data; skip categories with no data
4. When sentiment_percentage = 100%, it means the query was specifically for that sentiment (e.g., only "negative feedback"); use phrases like "negative feedback focuses on the following topics" instead of "negative discussion accounts for 100%"
"""
    
    result_data["instruction"] = topic_content_tool_prompt
    
    # 转换为 CSV 格式并返回
    if result_data.get("code") == 0 and "data" in result_data and "data" in result_data["data"]:
        df = pd.DataFrame(result_data["data"]["data"])

        final_result = {
            "data_id": result_data["data_id"],
            "system": result_data["system"],
            "instruction": topic_content_tool_prompt
        }

        # 数据采样
        if len(df) > 5000:
            try:
                dimension_info = result_data["data"].get("dimension_info", [])
                metrics_info = result_data["data"].get("metrics_info", [])

                group_by_fields = [d["data_key"]
                                   for d in dimension_info if d.get("data_key") != "date"]
                metrics = [m["data_key"]
                           for m in metrics_info if m.get("data_key")]

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
                csv_string = sampled_df.to_csv(index=False)
                final_result["data"] = truncate_output(csv_string)

                return final_result
            except Exception as e:
                logger.warning(f"数据采样失败，使用原始数据: {e}")

        csv_string = df.to_csv(index=False)
        final_result["data"] = truncate_output(csv_string)
        return final_result
    
    # 如果数据格式不符合预期，返回原始结果（保持字典格式）
    return result_data
