import traceback
import re
from typing import Any, Dict, List, Optional
from functools import lru_cache
from async_lru import alru_cache
from urllib.parse import quote
from opinion_tools.opinion.utils.utils import truncate_output, handle_opinion_references
from typing_extensions import Callable

import requests
from agents import Agent, RunContextWrapper
from loguru import logger
from youtube_comment_downloader import SORT_BY_POPULAR, YoutubeCommentDownloader

import databrain.api
from opinion_strategy.context import GameContext
from opinion_strategy.constants import ToolName,DatabrainMode
from opinion_tools.tool_common import get_tool_enabled, function_tool
from opinion_utils.helper import default_tool_error_function
from opinion_utils.exceptions import NoResultException
from opinion_tools.opinion.utils.game_search import search_games_by_opinion


# Opinion reference
REFERENCE_TYPES = ["KeyMetrics", "KeyOpinions", "Feeds", "SteamRatings","GameStore"]
URL_PATTERNS = {
    "KeyMetrics": "v2/opinion/Overview/KeyMetrics?gameid={game_id}",
    "KeyOpinions": "v2/opinion/Overview/KeyOpinions?gameid={game_id}",
    "Feeds": "v2/opinion/Feeds/Feeds?gameid={game_id}",
    "SteamRatings": "v2/opinion/SteamPerformance/SteamRatings?gameid={game_id}",
    "GameStore": "v2/opinion/GameStore?gameid={game_id}",
}


def normalize_game_name(name: str) -> str:
    """
    标准化游戏名称，用于缓存查找和比较

    规则：
    1. 移除所有标点符号和空格
    2. 转换为小写（仅对英文字符）
    3. 保留所有字母和数字字符（包括中文、日文、韩文等）

    示例：
    - "PUBG Mobile" -> "pubgmobile"
    - "Call of Duty" -> "callofduty"
    - "Grand Theft Auto: V" -> "grandtheftautov"
    - "逆水寒" -> "逆水寒"
    - "原神：Genshin Impact" -> "原神genshinimpact"
    """
    if not name:
        return ""
    # 移除标点符号和空格，但保留所有字母数字字符（包括中文等）
    normalized = re.sub(r'[^\w]', '', name, flags=re.UNICODE)
    return normalized.lower()

def _build_normalized_mapping(game_info_dict: Dict) -> Dict[str, str]:
    """
    构建标准化名称到原始key的映射
    
    同时检查 key 和 entity_name，支持中英文双向匹配：
    - key: 通常是中文名或标准名（如：'暗区突围：无限'）
    - entity_name: 通常是英文名（如：'Arena Breakout: Infinite'）
    
    这样设计的好处：
    1. 用户输入中文名或英文名都能匹配到同一个游戏数据
    2. 避免因名称语言不同而重复查询
    
    示例：
    >>> game_info_dict = {
    ...     '暗区突围：无限': {
    ...         'game_id': 'e11000000333',
    ...         'entity_name': 'Arena Breakout: Infinite',
    ...         ...
    ...     }
    ... }
    >>> mapping = _build_normalized_mapping(game_info_dict)
    >>> # 结果：两个标准化名称都映射到同一个 key
    >>> # {'': '暗区突围：无限', 'arenabreakoutinfinite': '暗区突围：无限'}
    
    Returns:
        Dict: normalized_name -> original_key
    """
    normalized_to_original = {}
    for original_key, game_info in game_info_dict.items():
        # 映射 key（通常是中文名或标准名）
        normalized_key = normalize_game_name(original_key)
        if normalized_key and normalized_key not in normalized_to_original:
            normalized_to_original[normalized_key] = original_key
        
        # 映射 entity_name（通常是英文名）
        # 这样用户输入 "Arena Breakout: Infinite" 也能匹配到 key '暗区突围：无限'
        entity_name = game_info.get("entity_name", "")
        if entity_name:
            normalized_entity = normalize_game_name(entity_name)
            if normalized_entity and normalized_entity not in normalized_to_original:
                normalized_to_original[normalized_entity] = original_key
    
    return normalized_to_original


async def _ensure_game_ids(
    ctx: RunContextWrapper[GameContext], game_names: List[str]
) -> List[str]:
    """
    确保游戏ID已缓存，按需补充查询，并返回当前 game_names 对应的 game_ids

    逻辑流程：
    1. 从 ctx.context.game_info_dict 中提取已有的游戏信息
    2. 比较 game_names 和已有名称，找出需要补充查询的游戏
    3. 如果有未缓存的游戏，调用 search_games_by_opinion 查询
    4. 更新 game_info_dict 缓存（累积所有查询过的游戏）
    5. 从缓存中提取当前 game_names 对应的 game_ids
    6. 返回当前 game_names 对应的 game_ids 列表

    设计理念：
    - game_info_dict: 全局缓存，存储所有查询过的游戏信息
    - 返回值: 只返回当前 game_names 对应的 game_ids
    
    注意：此函数不修改 context.entity_ids 和 entity_names，
          这些由调用方根据返回的 result_ids 自行管理
    """
    # 参数校验
    if not game_names:
        return []

    token = ctx.context.token
    if not token:
        raise Exception("No token found in context, please login first")

    # 建立标准化名称映射
    normalized_to_original = _build_normalized_mapping(ctx.context.game_info_dict)

    # 找出需要补充查询的游戏（使用标准化名称比较）
    names_to_query = []
    for name in game_names:
        normalized_name = normalize_game_name(name)
        if normalized_name not in normalized_to_original:
            names_to_query.append(name)

    # 如果有需要查询的游戏，调用API
    if names_to_query:
        logger.info(f"_ensure_game_ids: need to query games: {names_to_query}")
        new_ids, new_names, new_info_dict = await search_games_by_opinion(
            tuple(sorted(names_to_query)), token
        )

        # 更新 game_info_dict 缓存（累积所有查询过的游戏）
        ctx.context.game_info_dict.update(new_info_dict)

        logger.info(f"_ensure_game_ids: query completed, added {len(new_ids)} game IDs")
        
        # 重新建立映射（包含新查询的游戏）
        normalized_to_original = _build_normalized_mapping(ctx.context.game_info_dict)
    else:
        logger.info(f"_ensure_game_ids: all games are already in context, no need to query")

    # 根据当前 game_names 从缓存中提取对应的 game_ids
    # 使用标准化名称查找，避免大小写和特殊字符导致的匹配失败
    result_ids = []
    missing_games = []
    
    for name in game_names:
        normalized_name = normalize_game_name(name)
        original_key = normalized_to_original.get(normalized_name)

        if original_key:
            game_info = ctx.context.game_info_dict.get(original_key)
            if game_info and game_info.get("game_id"):
                result_ids.append(game_info["game_id"])
                logger.info(f"_ensure_game_ids: matched '{name}' -> {game_info.get('game_id')} ({game_info.get('entity_type')})")
            else:
                missing_games.append(name)
                logger.warning(f"_ensure_game_ids: game_info found but no game_id for '{name}'")
        else:
            missing_games.append(name)
            logger.warning(f"_ensure_game_ids: game '{name}' (normalized: '{normalized_name}') not found in context")
    
    if missing_games:
        logger.warning(f"_ensure_game_ids: {len(missing_games)} game(s) not found: {missing_games}")

    return result_ids


@function_tool(
    failure_error_function=default_tool_error_function,
    description_override="""
Provide redirection URLs for opinion analysis tasks based on specific requirements. 分析任务跳转工具，根据定制需求提供任务跳转链接。

Select the analysis type:
- custom_ai_summary: for comprehensive custom reports
- keyword_analysis: for specific keyword analysis
- url_analysis: for analyzing specific posts/URLs
    """,
    is_enabled=get_tool_enabled(ToolName.OpinionRedirectTool.value),
    readable_name_map={
        "English": "Opinion Redirect Tool",
        "Chinese": "舆情任务跳转工具",
    }
)
async def opinion_redirect_tool(
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    analysis_type: str,  # "custom_ai_summary", "keyword_analysis", "url_analysis"
    keywords: List[str] = None,
    description: str = None
) -> str:
    """舆情分析任务跳转工具"""
    await _ensure_game_ids(context, game_names)
    if not game_names:
        return "Please confirm the games you want to query"
    if not context.context.entity_ids:
        raise NoResultException(
            message = f"DataBrain 系统中未能找到游戏 {context.context.game_names} 的舆情数据，尝试根据联网结果给出回答。",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )

    # 简单的URL和名称映射
    if analysis_type == "custom_ai_summary":
        url_path = "/v2/opinion/AIAnalysisHub/CustomAISummary"
        name = "高级舆情总结"
        suggestion = "You can create a comprehensive custom analysis report with specific focus areas and time ranges."
    elif analysis_type == "keyword_analysis":
        url_path = "/v2/opinion/AIAnalysisHub/KeywordAnalysis"
        name = "关键字分析"
        suggestion = "You can analyze the sentiment, volume and trends of specific keywords in social media discussions."
    elif analysis_type == "url_analysis":
        url_path = "/v2/opinion/AIAnalysisHub/URLAnalysis"
        name = "单贴/多贴总结"
        suggestion = "You can analyze specific posts or multiple posts to get detailed insights and summaries."
    else:
        return f"Invalid analysis_type: {analysis_type}. Please use 'custom_ai_summary', 'keyword_analysis', or 'url_analysis'."

    redirect_pages = []
    for _game_name, _game_id in zip(context.context.entity_names, context.context.entity_ids):
        full_url = f"https://databrain.woa.com{url_path}?gameid={_game_id}"

        task_description = f"{name} for {_game_name}"
        if keywords:
            task_description += f" - 关键词: {', '.join(keywords)}"
        if description:
            task_description += f" - {description}"

        redirect_pages.append(f"Please submit your task in the webpage: [{task_description}]({full_url})")

    result = "\n".join(redirect_pages)
    result += f"\n\n📊 **{name}**: {suggestion}"
    result += "\n\nAlternatively, you can also use web search to get opinion results from social media and game store comments."

    return truncate_output(result)


# def call_opinion_wordcloud_api(data):
#     logger.info(f"【Tool API Call】- 【get_opinion_wordcloud_data】: {data}")
#     api_start_time = time.time()
#     response = await databrain.api.async_send_request(databrain.api.WORDCLOUD_API, data)
#     api_time_cost = (round((time.time() - api_start_time) * 1000, 2),)
#     logger.info(
#         f"【Tool API Response】- 【Timecost={api_time_cost}】- 【get_opinion_wordcloud_data】:  {response.json()}"
#     )
#     return response


@function_tool(
    failure_error_function=default_tool_error_function,
    description_override="""
    Query opinion wordcloud with keywords sentiment and mentions from Databrain to generate wordcloud chart
    """,
    is_enabled=ToolName.OpinionWordcloud.value,
    readable_name_map={
        "English": "Opinion Wordcloud Tool",
        "Chinese": "舆情词云工具",
    }
)
async def opinion_wordcloud(
    # 补充具体需要的api数据格式
    context: RunContextWrapper[GameContext],
    game_names: Optional[List[str]] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    channel_type: str = "total",
    sentiment_type: str = "total",
) -> str:
    # Todo 约定词云协议，补全词云tool
    # 1 get the date parameter stored in game context or default value
    ctx_dates = (context.context.data or [{}])[0]
    start_date = start_date or ctx_dates.get("start_date")
    end_date = end_date or ctx_dates.get("end_date")
    # 2. set the other parameters
    # 3. call the api
    # 4. return the result and save to context
    return "Placeholder for opinion wordcloud tool"

async def get_game_info(
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    reference_type: str = REFERENCE_TYPES[0],
    token: str = None,
) -> Dict[str, Any]:
    """
    获取游戏的opinion信息，包括game_ids，reference URLs，图片，游戏信息等

    Args:
        context: 游戏上下文
        game_names: 游戏名称列表
        reference_type: Reference类型，对应不同的Opinion功能页面
        token: 可选的token，如果不提供则从context获取

    Returns:
        Dict包含game_ids、references、游戏详细信息等
    """
    game_ids = []
    game_names_result = []
    game_info_dict = {}

    token = token or context.context.token
    if not token:
        return {"error": "No token found in context, please login first"}

    logger.info(f"【get_game_info】: 开始获取游戏信息")

    try:
        # 合并 intelligence 侧回填的 additional_game_names
        additional_names = list(set(context.context.additional_game_names or []))
        base_names = list(set(game_names or []))
        merged_game_names = list(dict.fromkeys(base_names + additional_names))  # 保持顺序去重
        
        # 加载配置文件，用于指导平台选择
        from opinion_tools.opinion.data.game_id_map import GAME_ID_MAP
        
        # 第一层逻辑：直接从 context.entities 中提取所有游戏信息
        if context.context.entities and len(context.context.entities) > 0:
            logger.info(f"【get_game_info-第一层】: 从 context.entities 中提取所有游戏信息，entities 数量: {len(context.context.entities)}")

            for entity in context.context.entities:
                # 从multi_keyword中提取游戏名称信息
                multi_keyword = entity.get('multi_keyword', {})
                original_name = multi_keyword.get('original_name', '')
                standard_name = multi_keyword.get('standard_name', '')
                english_name = multi_keyword.get('english_name', '')

                # 优先使用standard_name，其次original_name，最后english_name
                game_name = standard_name or original_name or english_name

                # entity.list是一个数组，需要遍历处理每个元素
                entity_list = entity.get('list', [])
                if not isinstance(entity_list, list):
                    logger.warning(f"【get_game_info-第一层】: entity.list 不是数组类型: {type(entity_list)}")
                    continue

                # 遍历list数组中的每个游戏实体
                for entity_item in entity_list:
                    game_id = entity_item.get('game_id', '')
                    entity_id = entity_item.get('entity_id', '')
                    entity_type = entity_item.get('entity_type', '')
                    entity_name = entity_item.get('entity_name', '')
                    cover = entity_item.get('cover', '')
                    release_time = entity_item.get('release_time', '')
                    
                    # 如果game_name为空（multi_keyword不存在的情况），使用entity_name作为game_name
                    if not game_name and entity_name:
                        game_name = entity_name
                        logger.info(f"【get_game_info-第一层】: multi_keyword不存在，使用entity_name作为game_name: {game_name}")

                    # 提取opinion信息 - 当前实体
                    opinion = entity_item.get('opinion', 0)
                    opinion_info = entity_item.get('opinion_info', {})
                    spider_status = opinion_info.get('spider_status', 0) if opinion_info else 0
                    spider_priority = opinion_info.get('spider_priority', 'normal').lower() if opinion_info else 'normal'

                    # 提取各端opinion信息 - 各实体下各端opinion信息
                    pc_opinion = entity_item.get('pc_opinion', 0)
                    pc_id = entity_item.get('pc_id', '')
                    pc_opinion_info = entity_item.get('pc_opinion_info', {})
                    pc_spider_status = pc_opinion_info.get('spider_status', 0) if pc_opinion_info else 0
                    pc_spider_priority = pc_opinion_info.get('spider_priority', 'normal').lower() if pc_opinion_info else 'normal'
                    mobile_opinion = entity_item.get('mobile_opinion', 0)
                    mobile_id = entity_item.get('mobile_id', '')
                    mobile_opinion_info = entity_item.get('mobile_opinion_info', {})
                    mobile_spider_status = mobile_opinion_info.get('spider_status', 0) if mobile_opinion_info else 0
                    mobile_spider_priority = mobile_opinion_info.get('spider_priority', 'normal').lower() if mobile_opinion_info else 'normal'
                    console_opinion = entity_item.get('console_opinion', 0)
                    console_id = entity_item.get('console_id', '')
                    console_opinion_info = entity_item.get('console_opinion_info', {})
                    console_spider_status = console_opinion_info.get('spider_status', 0) if console_opinion_info else 0
                    console_spider_priority = console_opinion_info.get('spider_priority', 'normal').lower() if console_opinion_info else 'normal'

                    # 平台优先级
                    PLATFORM_PRIORITY_MAP = {"mobile": 2, "pc": 1, "console": 0}  # Mobile > PC > Console
                    SPIDER_PRIORITY_MAP = {"emergency": 3, "high": 2, "middle": 1, "normal": 0}

                    # 【配置优先】检查是否有配置文件指定的平台选择
                    config_entity_type = None
                    config_applied = False
                    
                    if game_name in GAME_ID_MAP:
                        config = GAME_ID_MAP[game_name]
                        opinions = config.get("opinions", [])
                        if opinions:
                            config_entity_type = opinions[0].get("entity_type")
                            logger.info(f"【配置指导】游戏 '{game_name}' 配置指定使用 {config_entity_type} 平台")
                            
                            # 根据配置强制选择指定平台（如果该平台可用）
                            if config_entity_type == 'pc' and pc_id and pc_opinion == 2:
                                entity_id = pc_id
                                entity_type = 'pc'
                                spider_status = pc_spider_status
                                spider_priority = pc_spider_priority
                                opinion = 2
                                config_applied = True
                                logger.info(f"【配置指导】选择 PC 平台: {pc_id}")
                            elif config_entity_type == 'mobile' and mobile_id and mobile_opinion == 2:
                                entity_id = mobile_id
                                entity_type = 'mobile'
                                spider_status = mobile_spider_status
                                spider_priority = mobile_spider_priority
                                opinion = 2
                                config_applied = True
                                logger.info(f"【配置指导】选择 Mobile 平台: {mobile_id}")
                            elif config_entity_type == 'console' and console_id and console_opinion == 2:
                                entity_id = console_id
                                entity_type = 'console'
                                spider_status = console_spider_status
                                spider_priority = console_spider_priority
                                opinion = 2
                                config_applied = True
                                logger.info(f"【配置指导】选择 Console 平台: {console_id}")
                            else:
                                logger.warning(f"【配置指导】配置指定的 {config_entity_type} 平台不可用，回退到自动选择")
                    
                    # 实体选择逻辑 - 根据各端opinion状态选择最佳实体（如果配置没有应用）
                    if opinion != 2 and not config_applied:
                        # 当前实体opinion不为2时，寻找opinion=2的平台
                        candidates = []

                        if pc_opinion == 2 and pc_id:
                            candidates.append((pc_id, 'pc', pc_spider_status, pc_spider_priority,
                                             SPIDER_PRIORITY_MAP.get(pc_spider_priority, 0), PLATFORM_PRIORITY_MAP.get('pc', 0)))

                        if mobile_opinion == 2 and mobile_id:
                            candidates.append((mobile_id, 'mobile', mobile_spider_status, mobile_spider_priority,
                                             SPIDER_PRIORITY_MAP.get(mobile_spider_priority, 0), PLATFORM_PRIORITY_MAP.get('mobile', 0)))

                        if console_opinion == 2 and console_id:
                            candidates.append((console_id, 'console', console_spider_status, console_spider_priority,
                                             SPIDER_PRIORITY_MAP.get(console_spider_priority, 0), PLATFORM_PRIORITY_MAP.get('console', 0)))

                        # 如果有可用的候选实体，选择最佳的
                        if candidates:
                            # 按优先级排序：spider_status > spider_priority > platform_priority
                            best_candidate = max(candidates, key=lambda x: (x[2], x[4], x[5]))
                            entity_id, entity_type, spider_status, spider_priority = best_candidate[:4]
                            opinion = 2

                    # 提取平台信息
                    platforms = []
                    if entity_item.get("pc_id", ""):
                        platforms.append("PC")
                    if entity_item.get("mobile_id", ""):
                        platforms.append("Mobile")
                    if entity_item.get("console_id", ""):
                        platforms.append("Console")

                    # 如果没有明确的平台ID，根据entity_type推断
                    if not platforms and entity_type:
                        if entity_type.lower() == 'mobile':
                            platforms.append("Mobile")
                        elif entity_type.lower() == 'pc':
                            platforms.append("PC")
                        elif entity_type.lower() == 'console':
                            platforms.append("Console")

                    # 处理舆情和爬虫状态，生成message search_result字段
                    if opinion == 2 and spider_status == 1 and spider_priority != "normal":
                        message = ""  # 爬虫运行且优先级正常
                        search_result = "normal"  # 正常可查询
                    elif opinion == 2 and spider_status == 1 and spider_priority == "normal":
                        message = f"当前游戏优先级低，舆情数据可能不全，可联系sophiaxwxu@tencent.com提高游戏优先级" if context.context.language == "Chinese" else "The game priority is low, databrain opinion data may not be complete, please contact sophiaxwxu@tencent.com to increase the game priority."
                        search_result = "low_priority"  # 优先级低
                    elif opinion == 2 and spider_status == 0:
                        message = "当前游戏页面访问低，暂无舆情拉取任务，可联系sophiaxwxu@tencent.com重启外部数据拉取" if context.context.language == "Chinese" else "The game pv is low, there is no opinion data collection task, please contact sophiaxwxu@tencent.com to restart the data crawler."
                        search_result = "spider_stopped"  # 爬虫已停止
                    elif opinion == 0:
                        message = "当前游戏页面访问低，暂无舆情拉取任务，可联系sophiaxwxu@tencent.com重启外部数据拉取" if context.context.language == "Chinese" else "The game pv is low, there is no opinion data collection task, please contact sophiaxwxu@tencent.com to restart the data crawler."
                        search_result = "no_opinion"  # 正常可查询
                    else:
                        message = "未搜索到游戏{game_names}，通过网络搜索获取舆情数据" if context.context.language == "Chinese" else " {game_names} info not found, use websearch_tool to query data."
                        search_result = "no_databrain"  # 情报舆情均无game_id，无法查询Databrain

                    # 构建游戏信息（包含search_result以保持兼容性）
                    game_info = {
                        "game_name": game_name,
                        "game_id": entity_id,
                        "entity_name": entity_name,
                        "entity_type": entity_type,
                        "image_url": cover,
                        "release_time": release_time,
                        "platform": platforms,
                        "spider_status": spider_status,
                        "spider_priority": spider_priority,
                        "opinion": opinion,
                        "message": message,
                        "search_result": search_result,  # 添加search_result字段
                        "pc_id": pc_id,
                        "mobile_id": mobile_id,
                        "console_id": console_id,
                    }

                    # 使用game_name作为key存储游戏信息，如果game_name仍为空则跳过
                    if game_name:
                        game_info_dict[game_name] = game_info
                    else:
                        logger.warning(f"【get_game_info-第一层】: game_name为空，entity_name={entity_name}，跳过存储")

                    # 有 game_id 就直接添加到结果列表
                    if game_id and game_name:
                        game_ids.append(game_id)
                        game_names_result.append(game_name)

                logger.info(f"【get_game_info-第一层】: 提取entity: {entity_name}")

            # 即便 entities 存在，也统一补充查询未覆盖的 merged_game_names
            # 使用标准化名称比较，避免因名称变体（中英文）导致的重复查询
            # 建立已有游戏的标准化名称集合（同时检查 key 和 entity_name）
            existing_normalized_names = set()
            for key, info in game_info_dict.items():
                # 添加 key 的标准化名称
                normalized_key = normalize_game_name(key)
                if normalized_key:
                    existing_normalized_names.add(normalized_key)
                # 添加 entity_name 的标准化名称
                entity_name = info.get("entity_name", "")
                if entity_name:
                    normalized_entity = normalize_game_name(entity_name)
                    if normalized_entity:
                        existing_normalized_names.add(normalized_entity)
            
            # 找出真正需要查询的游戏（标准化后不在已有集合中）
            names_to_resolve = []
            for name in merged_game_names:
                if not name:
                    continue
                normalized_name = normalize_game_name(name)
                if normalized_name and normalized_name not in existing_normalized_names:
                    names_to_resolve.append(name)
            
            if names_to_resolve:
                logger.info(f"【get_game_info-第一层】: 需要补充查询的游戏: {names_to_resolve}")
                extra_ids, extra_names, extra_info = await search_games_by_opinion(tuple(sorted(names_to_resolve)), token)
                game_ids = list(dict.fromkeys(game_ids + (extra_ids or [])))
                game_names_result = list(dict.fromkeys(game_names_result + (extra_names or [])))
                for k, v in (extra_info or {}).items():
                    if k not in game_info_dict:
                        game_info_dict[k] = v

            logger.info(f"【get_game_info-第一层】: 提取完成 {len(game_info_dict)} 个游戏（{len(game_ids)} 个有ID），已合并 additional_game_names")

        # 第二层逻辑：仅当第一层逻辑不生效时才触发，使用原有 API 作为 fallback
        else:
            if not merged_game_names:
                return {"error": "No game names provided"}
            logger.info(f"【get_game_info-第二层】: entities 为空，使用原有 API 查询游戏: {merged_game_names}")
            # 使用原有的完整API逻辑，保留所有search_result等处理
            if isinstance(merged_game_names, list):
                game_names_tuple = tuple(sorted(merged_game_names))  # 排序确保缓存键一致
            else:
                game_names_tuple = merged_game_names
            game_ids, game_names_result, game_info_dict = await search_games_by_opinion(game_names_tuple, token)

        # 检查是否有任何游戏信息（包括无舆情数据的游戏）
        # 枚举值包括：normal, no_opinion, fuzzy_match, no_databrain, spider_stopped, low_priority, error
        has_any_game_info = len(game_ids) > 0 or len(game_info_dict) > 0

        if not has_any_game_info:
            return {"error": f"No valid game information found for games: {game_names}，get data from websearch"}

        # 更新context（保持与其他模块的一致性，存储game_id）
        context.context.entity_ids = game_ids
        context.context.entity_names = game_names_result
        context.context.game_info_dict.update(game_info_dict)

        # 生成reference URLs（如果需要的话）
        reference_urls = []
        reference_urls_dict = {}
        try:
            if reference_type and game_ids:  # 只有当有有效game_ids时才生成reference URLs
                # 使用新的标准化reference生成函数
                reference_urls = handle_opinion_references(
                    game_info_dict=game_info_dict,
                    game_names=game_names_result,
                    game_ids=game_ids,
                    reference_type=reference_type,
                    context=context
                )
            if reference_urls:
                context.context.references.extend(reference_urls)

        except Exception as e:
            logger.warning(f"【get_game_info】生成引用链接时出错: {e}")

        # 构建game_ids映射
        game_ids_dict = {}
        if game_ids and game_names_result:
            game_ids_dict = dict(zip(game_names_result, game_ids))

        # 统一处理game_ids映射
        no_opinion_games_count = 0
        for game_name, game_info in game_info_dict.items():
            search_result = game_info.get("search_result", "")
            # 只有可以查询Databrain数据的类型才有有效的game_id
            # 可以查询Databrain：normal, fuzzy_match, low_priority, spider_stopped
            # 必须网络搜索：no_opinion, no_databrain, error
            if search_result not in ["normal", "fuzzy_match", "low_priority", "spider_stopped"] and game_name not in game_ids_dict:
                game_ids_dict[game_name] = None
                no_opinion_games_count += 1
                # 添加fallback_message用于下游处理
                if game_info.get("message"):
                    game_info["fallback_message"] = game_info["message"]

        total_games_found = len(game_ids) + no_opinion_games_count

        # 根据使用的逻辑层输出不同的日志
        if context.context.entities and len(context.context.entities) > 0:
            logger.info(f"【get_game_info-第一层】: 完成处理，共 {total_games_found} 个游戏（其中 {len(game_ids)} 个有舆情数据，{no_opinion_games_count} 个仅有基础信息）")
        else:
            logger.info(f"【get_game_info-第二层】: 完成处理，共 {total_games_found} 个游戏（其中 {len(game_ids)} 个有舆情数据，{no_opinion_games_count} 个仅有基础信息）")

        return {
            "success": True,
            "game_ids": game_ids_dict,
            "references": reference_urls_dict,
            "game_info": game_info_dict,
        }

    except Exception as e:
        msg = f"Error: in get_game_info, traceback: {traceback.format_exc()}"
        logger.error(msg)
        return {"error": f"Failed to get opinion info: {str(e)}"}


def get_deepthink_enabled() -> Callable[[RunContextWrapper[GameContext], Agent], bool]:
    def is_deepthink_mode(context: RunContextWrapper[GameContext], agent: Agent) -> bool:
        return context.context.mode == DatabrainMode.Deepthink.value
    return is_deepthink_mode

@function_tool(
    failure_error_function=default_tool_error_function,
    description_override="""
Get game_id by game_name. Use this tool if you don't have game_id. Search for competitor game_id by competitor game games.  通过game_name获取game_id, 当你需要查询竞品游戏id时使用。

FEATURES:
- Get game_id by game_name with detailed game information
- This tool supports BATCH processing - you can query MULTIPLE games in a single call for better efficiency
- When comparing games or analyzing multiple games, always pass ALL game names in one call instead of making separate calls
- Returns game IDs, release dates, and other essential game metadata
- Example: ["PUBGM", "Nikke", "GTA5"] - queries all games at once
""",
    is_enabled=get_tool_enabled(ToolName.GetGameInformation.value), # and get_deepthink_enabled()
    readable_name_map={
        "English": "Opinion Game Info Tool",
        "Chinese": "舆情游戏信息工具",
    }
)
async def get_game_information (
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    reference_type: str = REFERENCE_TYPES[0],
):
    """
    游戏信息查询工具：从游戏名称获取game_id和详细游戏信息

    Args:
        context: 游戏上下文
        game_names: 游戏名称列表
        reference_type: Reference类型，对应不同的数据页面

    Returns:
        Dict: 包含game_id和游戏信息的字典
    """
    if not game_names:
        return {"error": "No game names provided"}

    try:
        # 验证reference_type，确保数据一致性
        if reference_type not in REFERENCE_TYPES:
            reference_type = REFERENCE_TYPES[0]

        game_info_result = await get_game_info(context, game_names, reference_type)

        if not game_info_result.get("success"):
            # 构建搜索查询
            raise NoResultException(
                message = f"DataBrain 系统中未能找到游戏 {context.context.game_names} 的舆情数据，尝试根据联网结果给出回答。",
                search_query=context.context.planner_context.rephrased_question,
                use_web_search=True,
            )

        # 从get_game_info的结果中获取需要的信息
        game_ids_dict = game_info_result.get("game_ids", {})
        game_info_dict = game_info_result.get("game_info", {})

        # 检查是否找到任何游戏信息（包括无舆情数据的游戏）
        if not game_ids_dict and not game_info_dict:
            raise NoResultException(
                message = f"DataBrain 系统中未能找到游戏 {context.context.game_names} 的舆情数据，尝试根据联网结果给出回答。",
                search_query=context.context.planner_context.rephrased_question,
                use_web_search=True,
            )

        # Step 4: 返回结果，包含游戏详细信息供大模型判断
        return truncate_output({
            "success": True,
            "game_ids": game_ids_dict,
            "game_info": game_info_dict,  # 添加游戏详细信息，包含release_time等
        })

    except Exception as e:
        logger.error(f"【get_game_information】Error: {e}")
        return truncate_output({
            "error": f"Error get_game_information for games {game_names}: {str(e)}"
        })
