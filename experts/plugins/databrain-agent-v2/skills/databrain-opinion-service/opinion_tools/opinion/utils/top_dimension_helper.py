from run_context_wrapper import RunContextWrapper
from loguru import logger
from typing import List

from opinion_strategy.context import GameContext
from opinion_tools.cube.cube_model import Query
from opinion_tools.cube.cube_client import CubeClient
from opinion_common.config import globalvar as gl


async def get_top_dimensions(context: RunContextWrapper[GameContext], base_query: Query, target_dimension: str, top_n: int = 10) -> List[str]:
    """根据当前查询与上下文，获取指定维度（国家/语言/渠道/话题）的 Top N 值。

    约束：
    - 使用 base_query 的 timeDimensions，但在实际请求中移除 granularity 字段
    - 默认 limit 使用 10（可通过参数覆盖）
    - 复用 base_query 的 filters 和 measures（若未提供 measures，则基于表前缀推断默认 measure）
    - 仅支持单一维度场景（base_query.dimensions[0]）
    - 当目标维度是 game_name 时，直接查询 game_id 维度
    """
    try:
        cube_client = _get_cube_client()

        dimension_field = target_dimension

        # 推断表前缀
        def _infer_table_prefix() -> str:
            if '.' in dimension_field:
                return dimension_field.split('.')[0]
            for field in (base_query.measures or []):
                if '.' in field:
                    return field.split('.')[0]
            for f in (base_query.filters or []):
                member = getattr(f, 'member', None)
                if member and '.' in member:
                    return member.split('.')[0]
            return 'hotness'

        table_prefix = _infer_table_prefix()

        # 选择 measures：优先使用传入的，其次按表类型默认
        measures = list(base_query.measures) if base_query.measures else None
        order = base_query.order if base_query.order else None
        if not measures:
            default_measures = {
                # read_data 工具需要的表
                'hotness': ['hotness.mentions'],
                'kol_stats': ['kol_stats.influencers'],
                'news_stats': ['news_stats.views'],
                'official_account_stats': ['news_stats.views'],
                'video_and_posts_stats': ['video_and_posts_stats.views'],
                'streaming_stats': ['streaming_stats.hours_watched'],
                'feeds_topic': ['feeds_topic.engagement'],
                # get_game_score 工具需要的表
                'appstore_score': ['appstore_score.all_reviews_count'],
                'steam_score': ['steam_score.all_reviews_count'],
                'steam_score_by_language': ['steam_score_by_language.total_reviews_by_language'],
                'feeds': ['feeds.game_store_reviews'],
            }
            measures = default_measures.get(table_prefix, [f"{table_prefix}.mentions"])

        # 对于评分表，如果查询分语言/分国家维度且没有按该维度排序，使用 all_reviews_count
        score_tables = {'appstore_score', 'steam_score', 'steam_score_by_language', 'googleplay_score', 'feeds'}
        fallback_score_tables = {'steam_score_by_language', 'googleplay_score', 'feeds'}
        language_country_suffixes = {'.language_code', '.language_en', '.language_zh', '.language',
                                     '.country_code', '.country_en', '.country_zh'}

        # 判断是否需要特殊处理：评分表 + 语言/国家维度 + 无该维度排序
        is_score_table = table_prefix in score_tables
        is_lang_country_dim = any(target_dimension.endswith(suffix) for suffix in language_country_suffixes)
        has_dim_order = order and any(target_dimension in key for key in order.keys()) if order else False

        if is_score_table and is_lang_country_dim and not has_dim_order:
            # 强制使用 all_reviews_count 作为排序依据
            if table_prefix in {'appstore_score', 'steam_score'}:
                order_measures = f"{table_prefix}.all_reviews_count"
            elif table_prefix in {'steam_score_by_language'}:
                order_measures = "steam_score_by_language.total_reviews_by_language"
            else:
                order_measures = "feeds.game_store_reviews"
            if order_measures != measures[0]:
                measures = [order_measures]
                logger.info(f"【get_top_dimensions】评分表分语言/国家查询，添加排序字段: {order_measures}")

        # timeDimensions：复制并移除 granularity
        time_dimensions: List[dict] = []
        for td in (base_query.timeDimensions or []):
            try:
                td_dict = {
                    'dimension': td.dimension,
                    'dateRange': td.dateRange,
                }
                time_dimensions.append(td_dict)
            except Exception:
                continue

        # 复制 filters
        filters: List[dict] = []
        for f in (base_query.filters or []):
            try:
                filters.append({
                    'member': getattr(f, 'member', None) if not isinstance(f, dict) else f.get('member'),
                    'operator': getattr(f, 'operator', None) if not isinstance(f, dict) else f.get('operator'),
                    'values': getattr(f, 'values', None) if not isinstance(f, dict) else f.get('values'),
                })
            except Exception:
                continue

        # 如果目标维度是 game_name，直接查询 game_id 维度
        query_dimension = dimension_field
        if dimension_field.endswith('.game_name'):
            query_dimension = dimension_field.replace('.game_name', '.game_id')
            logger.info(f"【get_top_dimensions】将查询维度从 {dimension_field} 改为 {query_dimension}")

        # 构建 TopN 查询
        top_query = {
            'measures': measures,
            'dimensions': [query_dimension],
            'timeDimensions': time_dimensions,
            'filters': filters,
            'limit': top_n,
            'order': {measures[0]: 'desc'} if measures else {},
        }

        logger.info(f"【get_top_dimensions】query: {top_query}")
        resp = await cube_client.query(top_query)
        if not isinstance(resp, dict):
            return []
        if resp.get('error'):
            logger.warning(f"【get_top_dimensions】error: {resp.get('error')}")
            return []

        rows = resp.get('data', []) or []
        values: List[str] = []

        # 提取查询结果
        for item in rows:
            val = item.get(query_dimension)
            if val is not None and val != '':
                values.append(val)

        logger.info(f"【get_top_dimensions】维度 {query_dimension} TopN 数量: {len(values)}")
        return values
    except Exception as e:
        logger.warning(f"【get_top_dimensions】失败: {e}")
        return []


def _get_cube_client():
    """获取 Opinion Cube Client"""
    rb_system_json = gl.get_value("rb_system_json", expected_type=dict)
    cube_config = rb_system_json["opinion_cube"]
    return CubeClient(
        endpoint=f"{cube_config['host']}/cubejs-api/v1",
        api_secret=cube_config["api_secret"],
        security_context={},
    )

