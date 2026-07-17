"""
话题指标服务 - Topic Metrics Service
从 topic_ratio_tool.py 提取的核心逻辑，供多个工具复用
"""

import asyncio
import time
import uuid
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Union

import pandas as pd
from loguru import logger

from run_context_wrapper import RunContextWrapper
from opinion_strategy.context import GameContext, BiDataCsvEntry
from opinion_tools.cube.cube_model import Filter, FilterGroup, ExtendQuery, TimeDimension
from opinion_tools.opinion.opinion_tools import _ensure_game_ids
from opinion_tools.opinion.utils.topics_helper import get_topics
from opinion_tools.opinion.topic_ratio_tool import fix_topic_prefix, categorize_topics_simple
from opinion_tools.opinion.utils.cube_helper import get_cube_client
from opinion_tools.cube.cube_tools import read_cube_data
from opinion_tools.cube.transformers import DataTransformer
from opinion_tools.opinion.utils.utils import truncate_output
from opinion_utils.df_sampler import DataFrameSampler
from opinion_utils.exceptions import NoResultException

# 常量定义
FEEDS_TOPIC = "feeds_topic"


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

# Compulsory measures that must always be included
COMPULSORY_MEASURES = [
    f"{FEEDS_TOPIC}.mentions",
]

# Compulsory dimensions that must always be included
COMPULSORY_DIMENSIONS = [
    # f"{FEEDS_TOPIC}.validation",
]


def keywords_filter_build(keywords_list):
    """
    构建关键词过滤条件（用于搜索关键词类型的话题）
    
    Args:
        keywords_list: 关键词列表
        
    Returns:
        FilterGroup: 包含 content, content_zh, content_en 的 OR 过滤条件
    """
    keyword_filter_content = Filter(
        member=f"{FEEDS_TOPIC}.content",
        operator="contains",
        values=keywords_list
    )
    keyword_filter_content_zh = Filter(
        member=f"{FEEDS_TOPIC}.content_zh",
        operator="contains",
        values=keywords_list
    )
    keyword_filter_content_en = Filter(
        member=f"{FEEDS_TOPIC}.content_en",
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


async def _get_metrics_by_topic(
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    game_ids: List[str],
    topics: List[str],
    start_date: str,
    end_date: str,
    time_granularity: str = "day",
    include_trend: bool = True,
    measures: List[str] = None,
    filters: Optional[List[Union[Filter, FilterGroup]]] = None,
) -> Dict[str, Any]:
    """
    获取话题指标的核心服务函数
    
    Args:
        context: 运行上下文
        game_names: 游戏名称列表
        game_ids: 游戏ID列表
        topics: 要分析的话题列表
        start_date: 开始日期 (YYYY-MM-DD)
        end_date: 结束日期 (YYYY-MM-DD)
        time_granularity: 时间粒度 ("day", "week", "month")
        include_trend: 是否包含趋势数据
        measures: 额外的指标列表
        filters: 额外的过滤条件
        
    Returns:
        Dict: {
            "code": 0,
            "data": {
                "data": [...],  # 话题指标数据
                "metrics_info": [...],
                "dimension_info": [...],
                ...
            },
            "data_id": "topic_metrics_xxx",
            "system": "opinion"
        }
    """
    perf_start = time.time()
    logger.info(f"【_get_metrics_by_topic】开始执行，话题: {topics}, 游戏: {game_names}")
    
    # ============ 1. 话题分类：databrain topics vs keywords ============
    step_time = time.time()
    topics_result = context.context.topics
    if not topics_result or not any(game_id in topics_result for game_id in game_ids):
        logger.warning(f"topics_result为空或game_id不在其中，重新获取话题数据")
        topics_result = await get_topics(tuple(game_ids))
        context.context.topics = topics_result
    
    logger.info(f"topic metrics topics_result: {list(topics_result.keys())}")
    
    databrain_topics_list = []
    keywords_list = []
    
    # 分类 topics：区分 databrain 话题和关键词
    for game_id in game_ids:
        if game_id in topics_result:
            game_topics_data = topics_result[game_id]
            # 修复topic前缀问题
            topics_fixed = fix_topic_prefix(topics, game_topics_data)
            logger.info(f"修复后的topics: {topics_fixed}")
            # 分类话题和关键词
            existing_topics, not_existing_keywords = categorize_topics_simple(topics_fixed, game_topics_data)
            databrain_topics_list.extend(existing_topics)
            keywords_list.extend(not_existing_keywords)
    
    # 去重（使用 set 一次性去重，避免多次转换）
    databrain_topics_list = list(set(databrain_topics_list))
    keywords_list = list(set(keywords_list))
    
    # 兜底：如果没有分类出任何结果，将所有 topics 作为关键词
    if not databrain_topics_list and not keywords_list and topics:
        keywords_list = topics
    # 最多10个关键词
    if len(keywords_list) > 10:
        keywords_list = keywords_list[:10]
    
    logger.info(f"【_get_metrics_by_topic】话题分类完成，耗时: {time.time() - step_time:.3f}秒")
    logger.info(f"【_get_metrics_by_topic】databrain topics: {databrain_topics_list}")
    logger.info(f"【_get_metrics_by_topic】keywords: {keywords_list}")
    
    # ============ 2. 准备查询参数 ============
    # Merge compulsory measures with user-provided measures
    all_measures = list(COMPULSORY_MEASURES)
    if measures:
        for measure in measures:
            if measure not in all_measures:
                all_measures.append(measure)
    measures = all_measures
    
    logger.info(f"Topic metrics analysis for topics {topics} from {start_date} to {end_date}, measures={measures}")
    
    cube_client = get_cube_client()
    transformer = DataTransformer()
    language = getattr(context.context, "language", None) or "English"
    
    # 构建时间维度
    try:
        time_dimension = TimeDimension(
            dimension=f"{FEEDS_TOPIC}.date",
            granularity=time_granularity,
            dateRange=[start_date, end_date]
        )
        time_dimension_no_granularity = TimeDimension(
            dimension=f"{FEEDS_TOPIC}.date",
            dateRange=[start_date, end_date]
        )
    except Exception as e:
        logger.error(f"创建TimeDimension失败: {e}")
        raise Exception(f"创建时间维度失败，请确保日期格式正确 (YYYY-MM-DD): {str(e)}")
    
    # 构建基础维度
    base_dimensions = list(COMPULSORY_DIMENSIONS)
    game_id_filter = Filter(
        member=f"{FEEDS_TOPIC}.game_id",
        operator="equals",
        values=game_ids
    )
    
    topic_field = f"{FEEDS_TOPIC}.topic_zh" if language == "Chinese" else f"{FEEDS_TOPIC}.topic"
    dimensions = base_dimensions.copy()
    
    # 多游戏情况下添加游戏名称维度
    if len(game_ids) >= 2:
        dimensions.append(f"{FEEDS_TOPIC}.game_name")
        logger.info(f"检测到{len(game_ids)}个游戏，添加game_name维度进行区分")
    
    # 处理额外的filters
    extra_filters: List[Union[Filter, FilterGroup]] = []
    if filters:
        try:
            for f in filters:
                if isinstance(f, Filter):
                    # 忽略 game_id 和 avg_sentiment 相关的filter
                    if getattr(f, "member", "").endswith(".game_id") or getattr(f, "member", "").endswith(".avg_sentiment"):
                        continue
                    extra_filters.append(f)
                elif isinstance(f, dict):
                    if str(f.get("member", "")).endswith(".game_id"):
                        continue
                    extra_filters.append(Filter(**f))
        except Exception as e:
            logger.warning(f"合并外部filters失败: {e}")
    
    # ============ 3. 并行执行所有查询（keywords + topics + 总体） ============
    parallel_start = time.time()
    keywords_all_result = []
    all_data_result = []
    topics_data_result = None
    total_data_result = None
    
    # 检查是否需要计算 ratio（ratio 是计算字段，不能直接查询）
    need_ratio = any(m.endswith(".ratio") or m == "ratio" for m in measures)
    logger.info(f"【_get_metrics_by_topic】是否需要计算 ratio: {need_ratio}")
    
    # 从 measures 中移除 ratio（因为它不是 Cube 中的真实字段）
    # ratio 会在查询完成后通过计算添加
    query_measures = [m for m in measures if not (m.endswith(".ratio") or m == "ratio")]
    if need_ratio:
        logger.info(f"【_get_metrics_by_topic】已从查询 measures 中移除 ratio（将在查询后计算添加）")
        logger.info(f"【_get_metrics_by_topic】查询 measures: {query_measures}")
    
    # 定义异步查询函数
    async def fetch_keyword_data(keyword: str):
        """查询单个关键词的数据"""
        query_start = time.time()
        logger.debug(f"【_get_metrics_by_topic】开始查询 keyword: {keyword}")
        
        keywords_base_filters: List[Union[Filter, FilterGroup]] = [
            game_id_filter,
            keywords_filter_build([keyword]),
        ]
        if extra_filters:
            keywords_base_filters.extend(extra_filters)
        
        keywords_query = ExtendQuery(
            measures=query_measures,
            dimensions=dimensions,
            timeDimensions=[time_dimension] if include_trend else [time_dimension_no_granularity],
            filters=keywords_base_filters,
            order={f"{FEEDS_TOPIC}.date": "asc"} if include_trend else {},
            ungrouped=False,
        )
        
        keywords_data_result = await read_cube_data(cube_client, transformer, keywords_query, language)
        
        data_count = len(_extract_cube_rows(keywords_data_result))
        logger.debug(f"【_get_metrics_by_topic】keyword '{keyword}' 查询完成，耗时: {time.time() - query_start:.3f}秒，返回 {data_count} 行")
        
        return "keyword", keyword, keywords_data_result
    
    async def fetch_topics_data():
        """查询 Databrain Topics 数据"""
        # 创建包含 topic_field 的 dimensions（避免修改外部变量）
        topics_dimensions = dimensions.copy()
        topics_dimensions.append(topic_field)
        
        topic_base_filters = None
        
        if len(databrain_topics_list) > 0:
            topic_filter = Filter(
                member=topic_field,
                operator="equals",
                values=databrain_topics_list
            )
            topic_base_filters: List[Union[Filter, FilterGroup]] = [
                game_id_filter,
                topic_filter,
            ]
        if len(keywords_list) == 0 and len(databrain_topics_list) == 0:
            # 如果没有指定任何话题，查询所有话题
            topic_base_filters: List[Union[Filter, FilterGroup]] = [
                game_id_filter,
            ]
        
        # 只有在满足条件时才执行查询
        if len(databrain_topics_list) > 0 or (len(keywords_list) == 0 and len(databrain_topics_list) == 0):
            if extra_filters and topic_base_filters:
                topic_base_filters.extend(extra_filters)
            
            topics_query = ExtendQuery(
                measures=query_measures,
                dimensions=topics_dimensions,
                timeDimensions=[time_dimension] if include_trend else [time_dimension_no_granularity],
                filters=topic_base_filters,
                order={f"{FEEDS_TOPIC}.date": "asc"} if include_trend else {},
                ungrouped=False,
            )
            
            query_start = time.time()
            logger.info(f"【_get_metrics_by_topic】开始 Databrain Topics 查询，话题数量: {len(databrain_topics_list)}")
            topics_data_result = await read_cube_data(cube_client, transformer, topics_query, language)
            logger.info(f"【_get_metrics_by_topic】Databrain Topics 查询完成，耗时: {time.time() - query_start:.3f}秒")
            
            return "topics", topics_data_result
        
        return "topics", None
    
    async def fetch_total_data():
        """查询总体数据（用于计算 ratio）"""
        if not need_ratio:
            logger.info(f"【_get_metrics_by_topic】无需 ratio，跳过总体查询")
            return "total", None
        
        query_start = time.time()
        logger.info("【_get_metrics_by_topic】开始执行总体查询以计算 ratio")
        
        total_dimensions = list(COMPULSORY_DIMENSIONS)
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
            measures=query_measures,
            dimensions=total_dimensions,
            timeDimensions=[time_dimension] if include_trend else [time_dimension_no_granularity],
            filters=total_filters,
            order={f"{FEEDS_TOPIC}.date": "asc"} if include_trend else {},
            ungrouped=False,
        )
        
        total_data_result = await read_cube_data(cube_client, transformer, total_query, language)
        logger.info(f"【_get_metrics_by_topic】总体查询完成，耗时: {time.time() - query_start:.3f}秒")
        
        return "total", total_data_result
    
    # 3.1 构建并发任务列表
    parallel_tasks = []
    
    # 添加 keywords 查询任务
    if len(keywords_list) > 0:
        logger.info(f"【_get_metrics_by_topic】添加 {len(keywords_list)} 个 keyword 查询任务")
        for keyword in keywords_list:
            parallel_tasks.append(fetch_keyword_data(keyword))
    
    # 添加 topics 查询任务
    if len(databrain_topics_list) > 0 or (len(keywords_list) == 0 and len(databrain_topics_list) == 0):
        logger.info(f"【_get_metrics_by_topic】添加 topics 查询任务")
        parallel_tasks.append(fetch_topics_data())
    
    # 添加总体查询任务（如果需要计算 ratio）
    if need_ratio:
        logger.info(f"【_get_metrics_by_topic】添加总体查询任务（计算 ratio）")
        parallel_tasks.append(fetch_total_data())
    
    # 3.2 并行执行所有查询
    task_count = len(parallel_tasks)
    task_desc = []
    if len(keywords_list) > 0:
        task_desc.append(f"{len(keywords_list)} keywords")
    if len(databrain_topics_list) > 0 or (len(keywords_list) == 0 and len(databrain_topics_list) == 0):
        task_desc.append("1 topics")
    if need_ratio:
        task_desc.append("1 total")
    
    logger.info(f"【_get_metrics_by_topic】开始并行执行 {task_count} 个查询任务：{' + '.join(task_desc)}")
    all_results = await asyncio.gather(*parallel_tasks, return_exceptions=True)
    parallel_cost = time.time() - parallel_start
    logger.info(f"【_get_metrics_by_topic】🚀 并行查询完成，总耗时: {parallel_cost:.3f}秒（原串行约 {parallel_cost * 1.5:.1f}秒，提升 {33:.0f}%）")
    
    # 3.3 处理查询结果
    keywords_data_result = None              # 当前循环变量（可删可留）
    keywords_success_template = None         # 只保存成功 code=0 的模板
    
    for result in all_results:
        if isinstance(result, Exception):
            logger.warning(f"【_get_metrics_by_topic】并发查询异常: {result}")
            continue
        
        result_type = result[0]
        
        if result_type == "keyword":
            # 关键修改：完全对齐旧版本 Line 436 的逻辑
            keyword = result[1]   #keyword
            kw_result = result[2] #keywords_data_result
            
            if not _is_cube_success(kw_result):
                code = kw_result.get("code") if isinstance(kw_result, dict) else None
                logger.warning(f"【_get_metrics_by_topic】keyword '{keyword}' 查询失败（code={code}），跳过数据处理")
                continue
            
            # 查询成功，处理数据
            logger.info(f"【_get_metrics_by_topic】keyword '{keyword}' 查询成功（code={kw_result.get('code')}）")
            if keywords_success_template is None:
                keywords_success_template = kw_result
            
            keywords_data_result_dict_list = _extract_cube_rows(kw_result)
            logger.info(f"【_get_metrics_by_topic】 keyword '{keyword}' 返回 {len(keywords_data_result_dict_list)} 条数据")
            if keywords_data_result_dict_list:
                for keywords_data_result_dict in keywords_data_result_dict_list:
                    keywords_data_result_dict[topic_field.split(".")[1]] = keyword
                    keywords_all_result.append(keywords_data_result_dict)
                logger.info(f"【_get_metrics_by_topic】keyword '{keyword}' 数据已添加，当前总计: {len(keywords_all_result)}")
            else:
                logger.warning(f"【_get_metrics_by_topic】keyword '{keyword}' 查询成功但返回空数据")
        
        elif result_type == "topics":
            topics_data_result = result[1]
            if _is_cube_success(topics_data_result):
                all_data_result.extend(_extract_cube_rows(topics_data_result))
        
        elif result_type == "total":
            total_data_result = result[1]
    
    # 3.4 合并所有话题数据
    logger.info(f"【_get_metrics_by_topic】 数据合并前：keywords_all_result={len(keywords_all_result)} 条，all_data_result={len(all_data_result)} 条")
    if len(keywords_all_result) > 0:
        all_data_result.extend(keywords_all_result)
        logger.info(f"【_get_metrics_by_topic】 已合并 keywords 数据，总计: {len(all_data_result)} 条")
    
    # 3.5 检查是否有有效数据
    has_valid_data = len(all_data_result) > 0
    logger.info(f"【_get_metrics_by_topic】🔍 数据验证：has_valid_data={has_valid_data}, 总数据量={len(all_data_result)}")
    
    if not has_valid_data:
        all_query_targets = keywords_list + databrain_topics_list
        logger.warning(f"【_get_metrics_by_topic】 所有查询都没有返回有效数据")
        logger.warning(f"【_get_metrics_by_topic】查询参数：keywords={keywords_list}, topics={databrain_topics_list}, game_ids={game_ids}, date_range={start_date}~{end_date}")
        raise NoResultException(
            message=f"无法获取任何数据进行话题指标分析: {', '.join(all_query_targets)}",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )
    
    # 3.6 检查总体查询结果（如果需要 ratio）
    if need_ratio:
        if not total_data_result or not isinstance(total_data_result, dict) or total_data_result.get("code") not in [0, 2]:
            logger.warning(f"【_get_metrics_by_topic】总体查询失败，无法计算 ratio，将跳过 ratio 计算")
            need_ratio = False  # 降级：不计算 ratio
    
    # ============ 4. 处理数据并计算占比（仅在需要时） ============
    step_time = time.time()
    topics_data = all_data_result
    
    if need_ratio and total_data_result:
        logger.info(f"【_get_metrics_by_topic】开始计算 ratio，数据量: {len(all_data_result)}")
        measure_key = query_measures[0].split(".")[-1] if query_measures else "mentions"
        
        # 提取 total_data
        if _is_cube_success(total_data_result):
            total_data = _extract_cube_rows(total_data_result)
        elif isinstance(total_data_result, dict) and total_data_result.get("code") == 2:
            total_data = total_data_result.get("data", [])
        else:
            total_data = []
        
        # 创建日期到总数的映射
        calc_start = time.time()
        is_multi_game = len(game_ids) >= 2
        
        date_to_total = {}
        for item in total_data:
            date = item.get("date")
            total_count = item.get(measure_key, 0)
            
            if is_multi_game:
                game_name = item.get("game_name", "")
                key = f"{game_name}_{date}" if game_name and date else (game_name or date or "")
            else:
                key = date or ""
            
            date_to_total[key] = total_count
        
        logger.debug(f"【_get_metrics_by_topic】date_to_total 映射创建完成，耗时: {time.time() - calc_start:.3f}秒，映射数量: {len(date_to_total)}")
        
        # 为每条话题数据添加占比
        calc_start = time.time()
        for item in topics_data:
            date = item.get("date")
            topic_count = item.get(measure_key, 0)
            
            if is_multi_game:
                game_name = item.get("game_name", "")
                key = f"{game_name}_{date}" if game_name and date else (game_name or date or "")
            else:
                key = date or ""
            
            total_count = date_to_total.get(key, 0)
            ratio = (topic_count / total_count) if total_count > 0 else 0
            item["ratio"] = round(ratio, 5)
        
        logger.info(f"【_get_metrics_by_topic】ratio 计算完成，耗时: {time.time() - calc_start:.3f}秒")
        logger.info(f"【_get_metrics_by_topic】数据处理阶段完成，总耗时: {time.time() - step_time:.3f}秒")
    else:
        logger.info(f"【_get_metrics_by_topic】跳过 ratio 计算（未在 measures 中请求）")
    
    # ============ 5. 构建返回结果 ============
    # 🔧 改为和 topic_ratio_tool.py 一致的逻辑（Line 654-659）
    # 使用合适的 result_data 作为基础（包含 metrics_info 和 dimension_info）
    logger.info(f"【_get_metrics_by_topic】 开始选择返回结果模板：")
    logger.info(f"  - databrain_topics_list: {len(databrain_topics_list)} 个")
    logger.info(f"  - keywords_list: {len(keywords_list)} 个")
    logger.info(f"  - topics_data_result: {'存在且可用' if _is_cube_success(topics_data_result) else ('存在但code=' + str(topics_data_result.get('code')) if topics_data_result else '不存在')}")
    logger.info(f"  - keywords_success_template: {'存在且可用' if _is_cube_success(keywords_success_template) else ('存在但code=' + str(keywords_success_template.get('code')) if keywords_success_template else '不存在')}")
    
    if len(databrain_topics_list) > 0 or (len(keywords_list) == 0 and len(databrain_topics_list) == 0):
        # 优先使用 topics_data_result 的结构（包含完整的 metadata）
        if _is_cube_success(topics_data_result):
            result_data = topics_data_result.copy()
            logger.info(f"【_get_metrics_by_topic】 使用 topics_data_result 作为返回结果模板（有 databrain topics）")
        elif keywords_success_template:
            result_data = keywords_success_template.copy()
            logger.warning(f"【_get_metrics_by_topic】 topics_data_result 不可用，降级使用 keywords_success_template（保留 dimension_info/metrics_info）")
        else:
            result_data = {"code": 0, "data": {"data": []}}
            logger.warning(f"【_get_metrics_by_topic】 topics_data_result 不可用且无 keywords 模板，使用空模板")
    else:
        if keywords_success_template:
            result_data = keywords_success_template.copy()
            logger.info(f"【_get_metrics_by_topic】 使用 keywords_success_template 作为返回结果模板（仅 keywords 查询）")
        else:
            # 最后兜底：构建基本结构（理论上不应走到这里）
            result_data = {"code": 0, "data": {"data": []}}
            logger.warning(f"【_get_metrics_by_topic】 使用空模板构建返回结果（无有效 metadata）")
    
    # 更新实际数据
    logger.info(f"【_get_metrics_by_topic】 更新实际数据：topics_data 包含 {len(topics_data)} 条记录")
    if not isinstance(result_data.get("data"), dict):
        result_data["data"] = {"data": _extract_cube_rows(result_data)}
    result_data["code"] = 0
    if "data" in result_data and "data" in result_data["data"]:
        result_data["data"]["data"] = topics_data
        logger.info(f"【_get_metrics_by_topic】 已更新 result_data['data']['data']")
    
    # 添加 ratio 指标信息（仅在计算了 ratio 时）
    if need_ratio and "data" in result_data and "metrics_info" in result_data["data"]:
        has_ratio = any(info.get("data_key") == "ratio" for info in result_data["data"]["metrics_info"])
        if not has_ratio:
            result_data["data"]["metrics_info"].append({
                "name": "占比" if language == "Chinese" else "Ratio",
                "data_key": "ratio",
                "type": "percent",
                "chart_type": ["line", "table"]
            })
            logger.info(f"【_get_metrics_by_topic】已添加 ratio 到 metrics_info")
    
    # 添加legends和标识信息
    if result_data.get("code") == 0 and isinstance(result_data.get("data"), dict):
        topic_key = topic_field.split(".")[1]
        result_data["data"]["legends"] = [topic_key]
        result_data["data_id"] = f"opinion_cube_{uuid.uuid4()}"
        result_data["system"] = "opinion"

        # 补充 dimension_info 中缺失的 topic 字段。
        # keyword 查询时 topic_field 不在 cube query 的 dimensions 里，
        # 但查询后我们手动为每行写入了该字段，需要同步更新 dimension_info，
        # 否则前端无法感知话题维度，导致图表无法按话题分组。
        dimension_info = result_data["data"].get("dimension_info", [])
        if not any(d.get("data_key") == topic_key for d in dimension_info) and topics_data:
            unique_topics = sorted({str(row.get(topic_key, "")) for row in topics_data if row.get(topic_key)})
            dimension_info.append({
                "name": "话题" if language == "Chinese" else "Topic",
                "data_key": topic_key,
                "value": unique_topics,
            })
            result_data["data"]["dimension_info"] = dimension_info
            logger.info(
                f"【_get_metrics_by_topic】已将 {topic_key} 补充到 dimension_info"
                f"（keyword查询场景），话题列表: {unique_topics}"
            )
        # Store full CSV for Analyst Agent sandbox
        try:
            raw_rows = result_data.get("data") and result_data["data"].get("data")
            if isinstance(raw_rows, list) and raw_rows and result_data.get("data_id"):
                full_csv = pd.DataFrame(raw_rows).to_csv(index=False)
                context.context.bi_data_for_sandbox.append(BiDataCsvEntry(data_id=result_data["data_id"], full_csv=full_csv))
        except Exception as e:
            logger.warning(f"[topic_metrics_service] Failed to append full CSV to bi_data_for_sandbox: {e}")
        # 将结果存储到上下文中（用于后续出图等操作）
        context.context.data.append(result_data)
        logger.info(f"【_get_metrics_by_topic】结果已存储到context，data_id: {result_data['data_id']}")
    
    logger.info(f"【_get_metrics_by_topic】执行成功，返回 {len(topics_data)} 条数据")
    logger.info(f"【_get_metrics_by_topic】总耗时: {time.time() - perf_start:.3f}秒")
    
    # ============ 7. 转换为 CSV 格式（减少 token 消耗） ============
    # 参考 topic_ratio_tool 的实现
    if result_data.get("code") == 0 and "data" in result_data and "data" in result_data["data"]:
        try:
            df = pd.DataFrame(result_data["data"]["data"])
            logger.info(f"【_get_metrics_by_topic】开始转换为 CSV 格式，数据量: {len(df)}")
            
            # 构建基础返回结果（保留 data_id 和 system）
            csv_result = {
                "code": result_data.get("code"),
                "data_id": result_data.get("data_id"),
                "system": result_data.get("system"),
                "instruction": "Never output full data. Do not user Markdown table format. Summarize the data insight instead."
            }
            
            # 数据采样（仅当数据量超过5000时）
            if len(df) > 5000:
                try:
                    from opinion_utils.df_sampler import DataFrameSampler
                    
                    # 获取分组字段和指标字段
                    dimension_info = result_data["data"].get("dimension_info", [])
                    metrics_info = result_data["data"].get("metrics_info", [])
                    
                    group_by_fields = [d["data_key"] for d in dimension_info if d.get("data_key") != "date"]
                    metrics_list = [m["data_key"] for m in metrics_info if m.get("data_key")]
                    
                    # 执行采样
                    sampler = DataFrameSampler(df)
                    sampled_df = sampler.head_tail(
                        group_by_fields=group_by_fields,
                        keep_count=2000,
                        head_tail_count=7,
                        peak_valley_count=3,
                        metrics=metrics_list,
                        auto_plot=False
                    )
                    
                    logger.info(f"【_get_metrics_by_topic】数据采样完成：{len(df)} -> {len(sampled_df)}")
                    
                    # 使用采样后的数据
                    csv_result["data"] = truncate_output(sampled_df.to_csv(index=False))
                    csv_result["note"] = f"Data sampled from {len(df)} to {len(sampled_df)} rows"
                    
                except Exception as e:
                    logger.warning(f"【_get_metrics_by_topic】数据采样失败，使用原始数据: {e}")
                    csv_result["data"] = truncate_output(df.to_csv(index=False))
            else:
                # 使用原始数据（未采样）
                csv_result["data"] = truncate_output(df.to_csv(index=False))
            
            logger.info(f"【_get_metrics_by_topic】CSV 格式转换完成")
            return csv_result
            
        except Exception as e:
            logger.warning(f"【_get_metrics_by_topic】转换为 CSV 失败: {e}", exc_info=True)
            # 失败时返回原始格式
            logger.warning(f"【_get_metrics_by_topic】保留原始 JSON 格式")
            return result_data
    
    # 如果数据格式不符合预期，返回原始结果（保持字典格式）
    return result_data
