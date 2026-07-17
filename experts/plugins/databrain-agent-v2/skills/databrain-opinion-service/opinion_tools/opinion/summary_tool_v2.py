"""
舆情总结报告工具 V2 - 重构版本
根据数据可用性智能选择处理策略
"""
from datetime import datetime, timedelta
from typing import List, Optional

from run_context_wrapper import RunContextWrapper
from loguru import logger

from opinion_strategy.context import GameContext
from opinion_strategy.constants import ToolName
from databrain.api import async_send_request_with_token, GPT_AVAILABILITY_API
from opinion_tools.opinion.opinion_tools import _ensure_game_ids, get_game_info
from opinion_tools.opinion.services.opinion_summary_service import _get_opinion_summary_report
from opinion_tools.opinion.services.topic_content_service import _get_top_content_by_topic
from opinion_tools.opinion.services.general_overview_service import execute_general_overview
from opinion_tools.tool_common import get_tool_enabled, function_tool
from opinion_tools.opinion.utils.param_validator import ParamValidator, ParamValidationError
from opinion_tools.opinion.data.language_map import map_languages_to_iso
from opinion_tools.opinion.data.channel_map import map_channels_to_code, get_channel_type
from opinion_utils.helper import websearch_fallback_with_rewrite_error_function
from opinion_utils.exceptions import NoResultException


# 网络搜索时的格式指导
WEBSEARCH_FORMAT_INSTRUCTION = """
请根据网络搜索结果，按以下格式输出舆情分析：

**摘要**：
<一段话总结主要发现，具体指出玩家关注的核心话题>

**热点话题与玩家关注点**：

**正面讨论**（X%）：
1. {具体话题标题}({占比}%)：{详细总结2-3句话，说明具体问题/特点/玩家观点}。例如，{引用1-2条真实评论内容，用引号括起来}[来源]({url})。
2. {下一个话题}...

**负面讨论**（X%）：
1. {具体话题标题}({占比}%)：{详细总结2-3句话，说明具体问题/玩家抱怨点}。例如，{引用1-2条真实评论内容，用引号括起来}[来源]({url})。
2. {下一个话题}...

**中性讨论**（X%）：
1. {具体话题标题}({占比}%)：{详细总结讨论内容}。例如，{引用1-2条真实评论内容，用引号括起来}[来源]({url})。
2. {下一个话题}...

**重要说明**：
1. **必须引用**网络搜索结果中的真实文本片段（title、text 字段），并附上来源链接（url 字段）
2. **话题标题要具体**：如"互动叙事体验优秀"、"定价偏高引发争议"，而非"游戏体验"、"价格"等简单词汇
3. **详细说明**：每个话题提供2-3句话，包含具体的问题/特点/玩家观点
4. **引用格式**：例如，有玩家评论"游戏剧情非常精彩"[来源](url)，还有人表示"价格有点贵"[来源](url)
5. **占比估算**：可以根据搜索结果中的讨论热度、出现频率进行估算
6. **灵活输出**：如果搜索结果不足以支持正面/负面/中性分类，只展示有明确证据的类别
"""


async def _select_strategy_and_execute(
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    game_ids: List[str],
    start_date: str,
    end_date: str,
    channel_category: Optional[str],
    sentiment: Optional[str],
    has_fine_grained_filters: bool,
    channel_code: Optional[List[str]],
    language_code: Optional[List[str]],
    is_official_account: Optional[bool],
) -> str:
    """
    策略选择和执行函数
    
    根据数据可用性和filter参数选择并执行最佳策略
    
    Args:
        game_names: 游戏名称列表
        game_ids: 游戏ID列表
        其他参数见函数签名
    
    Returns:
        str: 舆情报告内容
    """
    # Step 1: 检查数据可用性
    availability = await _check_opinion_data_availability(context, game_names, game_ids)
    
    has_pregenerated_summary = availability["has_pregenerated_summary"]
    has_opinion_data = availability["has_opinion_data"]
    
    logger.info(f"【_select_strategy_and_execute】数据可用性: 预生成总结={has_pregenerated_summary}, 舆情数据={has_opinion_data}")
    
    # 降级标记（用于日志区分是直接使用策略2还是从策略1降级）
    should_fallback_to_strategy2 = False
    
    # 内部辅助函数：构建 filter 列表（策略2使用）
    def _build_filters():
        from opinion_tools.cube.cube_model import Filter
        filters = []
        
        if channel_code:
            filters.append(Filter(
                member="feeds_topic.channel_code",
                operator="equals",
                values=channel_code
            ))
            logger.info(f"【_select_strategy_and_execute】添加channel_code filter: {channel_code}")
        
        if channel_category and (not channel_code or len(channel_code) == 0):
            channel_type_map = {
                "social": "Social Media",
                "game_store": "Game Store",
            }
            channel_type_value = channel_type_map.get(channel_category)
            if channel_type_value:
                filters.append(Filter(
                    member="feeds_topic.channel_type",
                    operator="equals",
                    values=[channel_type_value]
                ))
                logger.info(f"【_select_strategy_and_execute】添加channel_type filter: {channel_type_value}")
        
        if language_code:
            filters.append(Filter(
                member="feeds_topic.language_code",
                operator="equals",
                values=language_code
            ))
            logger.info(f"【_select_strategy_and_execute】添加language_code filter: {language_code}")
        
        if sentiment:
            filters.append(Filter(
                member="feeds_topic.sentiment",
                operator="equals",
                values=[sentiment]
            ))
            logger.info(f"【_select_strategy_and_execute】添加sentiment filter: {sentiment}")
        
        if is_official_account is not None:
            filters.append(Filter(
                member="feeds_topic.is_official_account",
                operator="equals",
                values=[str(is_official_account).lower()]
            ))
            logger.info(f"【_select_strategy_and_execute】添加is_official_account filter: {is_official_account}")
        
        return filters if filters else None
    
    # 内部辅助函数：执行策略2（策略2主分支和降级时复用）
    async def _execute_strategy2(log_prefix=""):
        logger.info(f"{log_prefix}调用 _get_top_content_by_topic 抽取热门内容")
        
        filters = _build_filters()
        
        strategy2_arguments = {
            "context": context,
            "topics": [],
            "game_names": game_names,
            "start_date": start_date,
            "end_date": end_date,
            "top_n": 10,
            "filters": filters
        }
        result = await _get_top_content_by_topic(**strategy2_arguments)
        
        # 验证返回结果
        if not result or (isinstance(result, dict) and not result.get("data")):
            logger.warning(f"{log_prefix}策略2返回空数据或无效结果")
            game_names_str = ', '.join(game_names) if game_names else '未知游戏'
            raise NoResultException(
                message=f"未能找到游戏 {game_names_str} 的舆情数据（话题内容查询返回空），尝试根据联网结果给出回答。{WEBSEARCH_FORMAT_INSTRUCTION}",
                search_query=context.context.planner_context.rephrased_question,
                use_web_search=True,
            )
        
        logger.info(f"{log_prefix}策略2执行成功")
        import json
        return json.dumps(result, ensure_ascii=False)
    
    # Step 2: 根据数据可用性和filter选择处理策略
    
    # 策略1: 有预生成的总结且没有细粒度filter -> 使用 get_opinion_summary_report
    if has_pregenerated_summary and not has_fine_grained_filters:
        logger.info(f"【_select_strategy_and_execute】使用策略1: 调用 _get_opinion_summary_report 获取预生成总结")
        
        # 策略1使用 channel_category 和 sentiment_category
        # 当参数为None时，使用"total"
        channel_category_param = channel_category if channel_category else "total"
        sentiment_category_param = sentiment if sentiment else "total"
        
        logger.info(f"【_select_strategy_and_execute】策略1参数: channel_category={channel_category_param}, sentiment={sentiment_category_param}")
        
        strategy1_arguments = {
            "context": context,
            "game_names": game_names,
            "game_ids": game_ids,
            "start_date": start_date,
            "end_date": end_date,
            "channel_category": channel_category_param,
            "sentiment_category": sentiment_category_param,
        }
        
        # 调用策略1
        result = await _get_opinion_summary_report(**strategy1_arguments)
        
        # 解析返回结果，检查 reports 内容
        import json
        try:
            result_data = json.loads(result) if isinstance(result, str) else result
            reports = result_data.get("reports", {})
            
            # 计算实际报告内容总长度
            total_content_length = 0
            for game_name, report_list in reports.items():
                if isinstance(report_list, list):
                    for report_item in report_list:
                        if isinstance(report_item, dict):
                            report_content = report_item.get("report", "")
                            total_content_length += len(report_content)
            
            logger.info(f"【策略降级检查】策略1返回 {len(reports)} 个游戏报告，总内容长度: {total_content_length}, 阈值: 100")
            
            # 判断是否需要降级到策略2，阈值暂定为100字符
            if not reports or total_content_length < 100:
                logger.warning(f"【策略降级】策略1返回空或过短（游戏数={len(reports)}, 内容长度={total_content_length}），降级到策略2")
                should_fallback_to_strategy2 = True
            else:
                logger.info(f"【_select_strategy_and_execute】策略1执行成功，内容充足")
                return result
        except Exception as e:
            logger.error(f"【策略降级检查】解析策略1结果失败: {e}，尝试降级到策略2")
            should_fallback_to_strategy2 = True
        
        # 如果需要降级到策略2，直接进入下面的策略2/3分支
    
    # 策略2b: 通用舆情全景（官方主贴 + 社区热帖 + 帖子评论三路链路）
    # 触发条件：有数据 + 非游戏商店查询 + 无 sentiment 细粒度filter
    # is_official_account 透传给 execute_general_overview，由其决定跳过 Task1 或 Task2
    # 支持 language_code / channel_code filter（会透传到 Cube 和 BQ 查询）
    use_general_overview = (
        has_opinion_data
        and channel_category != "game_store"
        and sentiment is None  # 有 sentiment filter 时走策略2做话题情感分析更准
    )
    if use_general_overview:
        log_prefix = "【策略降级→2b】" if should_fallback_to_strategy2 else "【_select_strategy_and_execute】"
        logger.info(f"{log_prefix}使用策略2b（通用舆情全景），is_official_account={is_official_account}")
        try:
            return await execute_general_overview(
                context=context,
                game_names=game_names,
                game_ids=game_ids,
                start_date=start_date,
                end_date=end_date,
                language_code=language_code,
                channel_code=channel_code,
                is_official_account=is_official_account,
            )
        except NoResultException:
            raise
        except Exception as e:
            # 策略2b 失败时降级到策略2，避免整体失败
            logger.warning(f"【策略降级2b→2】策略2b 执行异常，降级到策略2: {e}")

    # 策略2: 有舆情数据（没有预生成总结、使用了细粒度filter、或策略1返回空） -> 使用 get_top_content_by_topic
    if has_opinion_data:
        log_prefix = "【策略降级】" if should_fallback_to_strategy2 else "【_select_strategy_and_execute】"
        logger.info(f"{log_prefix}使用策略2")
        return await _execute_strategy2(log_prefix=log_prefix)

    # 策略3: 没有舆情主体数据 -> 触发网络搜索
    else:
        logger.warning(f"【_select_strategy_and_execute】使用策略3: 没有舆情数据，触发网络搜索")
        game_names_str = ', '.join(game_names) if game_names else '未知游戏'
        raise NoResultException(
            message=f"DataBrain 系统中未能找到游戏 {game_names_str} 的舆情数据，尝试根据联网结果给出回答。{WEBSEARCH_FORMAT_INSTRUCTION}",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )


async def _check_opinion_data_availability(
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    game_ids: List[str],
) -> dict:
    """
    检查游戏是否有提前生成的舆情总结数据
    
    Args:
        context: 运行上下文
        game_names: 游戏名称列表
        game_ids: 游戏ID列表
    
    Returns:
        dict: {
            "has_pregenerated_summary": bool,  # 是否有预生成的总结
            "has_opinion_data": bool,          # 是否有舆情主体数据
            "game_info": dict                  # 游戏详细信息
        }
    """
    logger.info(f"【check_opinion_data_availability】检查游戏数据可用性: {game_names}, game_ids={game_ids}")
    
    # 从context获取游戏信息
    game_info_dict = context.context.game_info_dict
    
    if not game_info_dict:
        logger.warning("【check_opinion_data_availability】game_info_dict为空，无法判断数据可用性")
        return {
            "has_pregenerated_summary": False,
            "has_opinion_data": False,
            "game_info": {}
        }
    
    # 判断逻辑：
    # 1. has_opinion_data: 检查游戏是否有game_id且opinion=2 (是否在我们的舆情系统中)
    # 2. has_pregenerated_summary: 通过API检查是否有预生成的GPT报告
    #    - 调用 OPINION_REPORT_AVAILABILITY_API 接口
    #    - 检查返回的 hot_event_v2_config 字段
    
    has_opinion_data = False
    has_pregenerated_summary = False
    
    # 检查每个游戏的状态（使用传入的game_names和game_ids，确保数据一致性）
    for game_name, game_id in zip(game_names, game_ids):
        game_info = None
        
        # 根据game_id在game_info_dict中查找游戏信息
        for info_name, info in game_info_dict.items():
            if info.get("game_id") == game_id:
                game_info = info
                break
        
        if not game_info:
            logger.warning(f"【check_opinion_data_availability】未找到game_id={game_id}的信息")
            continue
        
        # 检查是否在舆情系统中（有game_id且opinion=2）
        opinion = game_info.get("opinion", 0)
        
        if game_id and opinion == 2:
            has_opinion_data = True
            logger.info(f"【check_opinion_data_availability】游戏 {game_name}(game_id={game_id}) 在舆情系统中")
            
            # 通过API检查是否有预生成的总结
            entity_type = game_info.get("entity_type", "pc")
            
            try:
                request_data = {
                    "request_types": ["high_game_gpt_report_config"],
                    "edition_unified_id": game_id,
                    "entity_type": entity_type,
                    "id_type": "unified_id" if entity_type == "mobile" else "edition_id"
                }
                
                logger.info(f"【check_opinion_data_availability】调用API检查预生成报告: game_id={game_id}, entity_type={entity_type}")
                
                response = await async_send_request_with_token(
                    GPT_AVAILABILITY_API,
                    request_data,
                    context.context.token,
                    tries=2,
                    message_id=context.context.message_id
                )
                
                if response is not None and response.json().get("code") == 0:
                    data = response.json().get("data", {})
                    config = data.get("high_game_gpt_report_config", {})
                    if config.get("hot_event_v2_config", False):
                        has_pregenerated_summary = True
                        logger.info(f"【check_opinion_data_availability】游戏 {game_name}(game_id={game_id}) 有预生成报告")
                        break
                    
            except Exception as e:
                logger.warning(f"【check_opinion_data_availability】检查预生成报告时出错: {e}")
    
    result = {
        "has_pregenerated_summary": has_pregenerated_summary,
        "has_opinion_data": has_opinion_data,
        "game_info": game_info_dict
    }
    
    logger.info(f"【check_opinion_data_availability】检查结果: {result}")
    return result

# ---- Allowed Enumerations / 允许的枚举值 ----
ALLOWED_CHANNEL_CATEGORY: set[str] = {"social", "game_store"}
ALLOWED_SENTIMENT: set[str] = {"positive", "negative", "neutral"}

# channel_code 使用智能映射函数 map_channels_to_code 进行验证和规范化
# 支持多种输入格式：自然语言("Youtube")、标准代码("youtube_keyword")、别名("X" → "twitter")等
# 支持 112 种渠道代码，自动映射到标准格式

# language_code 使用智能映射函数 map_languages_to_iso 进行验证和规范化
# 支持多种输入格式：自然语言("Chinese")、ISO代码("zh")、别名("Simplified Chinese")等
# 自动映射到标准的 BCP 47 / IETF 语言标签格式

@function_tool(
    failure_error_function=websearch_fallback_with_rewrite_error_function,
    description_override="""
Fetch comprehensive opinion summaries WITHOUT specifying topics. 获取游戏的整体舆情总结（不需要指定具体话题）。

WHEN TO USE (Use this tool for general/broad questions):
- "What are players discussing about [game]?"  / "[游戏]玩家在讨论什么？"
- "Tell me about [game]'s recent opinion" / "告诉我[游戏]最近的舆情"
- "[Game]'s overall player feedback" / "[游戏]的整体玩家反馈"
- "玩家在游戏商店主要在吐槽什么内容？" 
- "目前的主要负面舆情"
- General analysis WITHOUT topics/keywords list

DO NOT USE (use opinion_data_query_tool instead):
- Metrics query, e.g. "哪个地区/国家/语种/渠道的负面声量最多？", "Top5地区负面声量"
- Any question that requires grouping/sorting by region/country/language/channel

HOW IT WORKS:
- Uses pre-generated summaries when available
- Falls back to topic-based content extraction when summaries are not available
- Uses web search as final fallback when no opinion data exists

CORE FEATURES:
Comprehensive opinion analysis: discover what topics players are discussing
Topic summary: automatic identification of hot topics
Complex topic analysis: positive/negative/neutral breakdown

Args:
- start_date, end_date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS): Date range that user wants to query
- channel_category: (Optional, default: None) Enums: [social, game_store]. Only set when explicitly mentioned.
- channel_code: (Optional, default: None) Enums: [youtube_keyword, steam, tiktok, twitter, etc]. Only set when explicitly mentioned.
  * IMPORTANT: channel_code must match channel_category:
    - If channel_category="social": only use social channels (youtube_keyword, tiktok, twitter, facebook, reddit, discord, etc.)
    - If channel_category="game_store": only use store channels (steam, google_play, app_store, etc.)
    - If unsure, do NOT set channel_category, only set channel_code
- sentiment: (Optional, default: None) Enums: [positive, negative, neutral]. Only set when explicitly mentioned.
- language_code: (Optional, default: None) Enums: [en, zh, zh-hant, ja, ko, tr, ru, de, fr]. Only set when explicitly mentioned.
- is_official_account: (Optional, default: None) Enums: [true, false]. Only set when the user EXPLICITLY asks for official or non-official content (e.g. "官方帖子" → true, "玩家/社区讨论" → false). For general sentiment queries like "舆情有哪些" or "玩家在讨论什么", leave as None.

EXAMPLES:
1. "Dying Light: The Beast近一周的舆情总结" -> Only set: game_names, start_date, end_date
2. "Steam上的负面反馈" -> Set: game_names, channel_category="game_store", sentiment="negative"
3. "YouTube和Twitter上的讨论" -> Set: game_names, channel_code=["youtube_keyword", "twitter"] 

OUTPUT:
Qualitative insights: key discussion topics, player concerns, positive/negative themes
Quantitative data: mention counts, engagement metrics
Hot topic analysis: trending discussion topics
Sentiment breakdown: positive/negative/neutral analysis with examples

FORMAT RULE:
Note to user: "The topic ratio is calculated using only representative comments".
When presenting the opinion analysis, you MUST follow this exact format for each opinion item:
{序号}. {主题描述}({百分比}%) : {内容说明}。
NEVER simplify or omit any opinion items. Keep all percentage numbers EXACTLY as provided in the data.""",
    is_enabled=get_tool_enabled(ToolName.OpinionSummaryTool.value),
    readable_name_map={
        "English": "Opinion Summary Report Tool",
        "Chinese": "舆情总结报告工具",
    }
)
async def get_opinion_summary_report(
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    channel_category: Optional[str] = None,
    channel_code: Optional[List[str]] = None,     # 细粒度filter参数,仅策略2支持
    sentiment: Optional[str] = None,
    language_code: Optional[List[str]] = None,     # 细粒度filter参数,仅策略2支持
    is_official_account: Optional[bool] = None,    # 细粒度filter参数,仅策略2支持
) -> str:
    """
    Get opinion summary report for games. Select the best strategy based on data availability.
    
    Args:
        game_names: List of game names to query
        start_date: Start date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS), default: 7 days ago
        end_date: End date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS), default: today
        channel_category: (Optional) Channel category - "social" or "game_store". Default: None (all channels)
        channel_code: (Optional) Specific channels - ["youtube_keyword", "steam", "tiktok", etc]. Default: None (all)
        sentiment: (Optional) Sentiment filter - "positive", "negative", or "neutral". Default: None (all sentiments)
        language_code: (Optional) Language filter - ["en", "zh", "zh-hant", etc]. Default: None (all languages)
        is_official_account: (Optional) Filter official accounts - true or false. Default: None (all accounts). Only set when user explicitly asks for official or community content; leave None for general sentiment queries.
    """
    logger.info(f"【get_opinion_summary_report_v2】开始执行，游戏: {game_names}")
    
    try:
        validation_messages = []  # 收集所有的参数调整信息
        
        # ---------- 参数验证和规范化 ----------
        # 验证 channel_category
        validated_channel_category = ParamValidator.validate_string(channel_category, ALLOWED_CHANNEL_CATEGORY, None, "channel_category", validation_messages)
        # 验证并规范化 channel_code (使用 map_channels_to_code 智能映射)，支持多种输入格式: "Youtube", "X", "Google Play" 等
        validated_channel_code = ParamValidator.validate_with_mapper(channel_code, map_channels_to_code, None, "channel_code", validation_messages)
        
        # 验证 channel_code 是否与 channel_category 一致
        # Note: Strategy 1 uses ['social', 'game_store'], Feeds Strategy 2 uses ['social', 'comments']
        # 'game_store' in Strategy 1 = 'comments' in Strategy 2
        if validated_channel_category and validated_channel_code:
            if validated_channel_category == "social":
                # 检查是否有非social渠道 (comments type)
                invalid_channels = [ch for ch in validated_channel_code if get_channel_type(ch) != "social"]
                if invalid_channels:
                    warn_msg = (
                        f"channel_category='social' but channel_code contains non-social channels: "
                        f"{invalid_channels}. Ignoring channel_category and using channel_code only."
                    )
                    validation_messages.append(f"参数冲突（已自动修复）: {warn_msg}")
                    logger.warning(f"【参数验证】{warn_msg}")
                    # 优先信任更具体的 channel_code，清除 channel_category 以避免工具调用失败
                    validated_channel_category = None
            
            elif validated_channel_category == "game_store":
                # 检查是否有social渠道 (应该全是comments type)
                invalid_channels = [ch for ch in validated_channel_code if get_channel_type(ch) == "social"]
                if invalid_channels:
                    warn_msg = (
                        f"channel_category='game_store' but channel_code contains social media channels: "
                        f"{invalid_channels}. Ignoring channel_category and using channel_code only."
                    )
                    validation_messages.append(f"参数冲突（已自动修复）: {warn_msg}")
                    logger.warning(f"【参数验证】{warn_msg}")
                    # 优先信任更具体的 channel_code，清除 channel_category 以避免工具调用失败
                    validated_channel_category = None
        
        # 验证 sentiment
        validated_sentiment = ParamValidator.validate_string(sentiment, ALLOWED_SENTIMENT, None, "sentiment", validation_messages)
        # 验证并规范化 language_code (使用 map_languages_to_iso 智能映射)，支持多种输入格式: "Chinese", "zh", "ZH-HANT", "Traditional Chinese" 等
        validated_language_code = ParamValidator.validate_with_mapper(language_code, map_languages_to_iso, None, "language_code", validation_messages)
        # 验证 is_official_account 
        validated_is_official_account = ParamValidator.validate_boolean(is_official_account, None, "is_official_account", validation_messages)
        
        # 使用验证后的参数
        channel_category = validated_channel_category
        sentiment = validated_sentiment
        channel_code = validated_channel_code
        language_code = validated_language_code
        is_official_account = validated_is_official_account
        
        # 如果有参数调整信息，记录到日志
        if validation_messages:
            logger.info(f"【get_opinion_summary_report_v2】参数验证信息: {validation_messages}")
        
        # ---------- 设置默认日期 ----------
        if not start_date:
            start_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        if not end_date:
            end_date = datetime.now().strftime("%Y-%m-%d")
        
        # ---------- 检查是否使用了细粒度filter ----------
        # 日期超过7天时，策略1性能较差，强制使用策略2
        try:
            date_range_days = (
                datetime.strptime(end_date[:10], "%Y-%m-%d") -
                datetime.strptime(start_date[:10], "%Y-%m-%d")
            ).days + 1
        except Exception:
            date_range_days = 1
        date_exceeds_7_days = date_range_days > 7

        has_fine_grained_filters = any([
            channel_code is not None,
            language_code is not None,
            is_official_account is not None,
            date_exceeds_7_days,
        ])
        
        if has_fine_grained_filters:
            reasons = []
            if channel_code is not None:
                reasons.append(f"channel_code={channel_code}")
            if language_code is not None:
                reasons.append(f"language_code={language_code}")
            if is_official_account is not None:
                reasons.append(f"is_official_account={is_official_account}")
            if date_exceeds_7_days:
                reasons.append(f"日期范围={date_range_days}天(>7天)")
            logger.info(f"【get_opinion_summary_report_v2】检测到细粒度filter，强制使用策略2，原因: {', '.join(reasons)}")
    
        # Step 1: 确保获取游戏信息和game_ids
        game_ids = await _ensure_game_ids(context, game_names)
        
        # 如果没有game_id，说明游戏不在舆情系统中，直接触发网络搜索
        if not game_ids:
            logger.warning(f"【get_opinion_summary_report_v2】游戏 {game_names} 没有game_id，触发网络搜索")
            raise NoResultException(
                message=f"DataBrain 系统中未能找到游戏 {', '.join(game_names)} 的舆情数据，尝试根据联网结果给出回答。{WEBSEARCH_FORMAT_INSTRUCTION}",
                search_query=context.context.planner_context.rephrased_question,
                use_web_search=True,
            )
        
        # Step 2: 策略选择和执行（封装在一个函数中）
        result = await _select_strategy_and_execute(
            context=context,
            game_names=game_names,
            game_ids=game_ids,
            start_date=start_date,
            end_date=end_date,
            channel_category=channel_category,
            sentiment=sentiment,
            has_fine_grained_filters=has_fine_grained_filters,
            channel_code=channel_code,
            language_code=language_code,
            is_official_account=is_official_account,
        )
        
        return result
    
    except ParamValidationError as e:
        # 参数验证错误，转换为NoResultException
        logger.warning(f"【get_opinion_summary_report_v2】参数验证失败: {e}")
        raise NoResultException(
            message=f"参数验证失败: {str(e)}。通过网络搜索获取结果。{WEBSEARCH_FORMAT_INSTRUCTION}",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )
    
    except NoResultException:
        # NoResultException需要向上传播，触发websearch_fallback_error_function
        logger.info(f"【get_opinion_summary_report_v2】触发NoResultException，启动网络搜索兜底")
        raise
    
    except Exception as e:
        logger.warning(f"【get_opinion_summary_report_v2】执行失败: {e}")
        # 其他异常也触发网络搜索兜底
        raise NoResultException(
            message=f"处理游戏 {', '.join(game_names)} 的舆情数据时发生错误: {str(e)}，尝试根据联网结果给出回答。{WEBSEARCH_FORMAT_INSTRUCTION}",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )
