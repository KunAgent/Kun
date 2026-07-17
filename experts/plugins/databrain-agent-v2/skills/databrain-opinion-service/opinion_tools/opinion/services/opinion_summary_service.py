"""
舆情总结服务 - 封装get_opinion_summary_report的核心逻辑
"""
import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from run_context_wrapper import RunContextWrapper
from loguru import logger

import databrain.api
from opinion_strategy.context import GameContext
from opinion_tools.opinion.opinion_tools import _ensure_game_ids
from opinion_tools.opinion.summary_tool import (
    _process_multi_day_query,
    safe_parse_date,
    safe_parse_datetime,
    is_hourly_query,
)
from opinion_tools.opinion.utils.utils import truncate_output, handle_opinion_references
from opinion_utils.exceptions import NoResultException

# 设置prompt
opinion_summary_prompt_zh = """你是游戏舆情分析专家。请根据提供的舆情数据生成情感分析报告，按情感分类组织话题，总结核心观点。

**输出格式**：

**摘要**：
<一段话总结主要发现，具体指出最主要的正面/负面话题，包含话题名称、占比>

**正面讨论**（X%）：
**{序号}. {主题描述}({百分比}%)** : {内容说明}。

**负面讨论**（X%）：
**{序号}. {主题描述}({百分比}%)** : {内容说明}。

**中性讨论**（X%）：
**{序号}. {主题描述}({百分比}%)** : {内容说明}。

**摘要撰写要求**：
- 具体信息：直接说明最主要的正面/负面话题是什么，包含具体的话题名称、占比、关键问题（如"负面反馈集中在战斗系统缺乏创新、游戏卡顿等方面"）
- 绝对不要说"两极分化"、"褒贬不一"、"评价不一"、"整体来看有正面有负面"等废话

**注意**：
- 所有内容必须基于提供的数据，不要编造话题和内容
- 使用 Markdown 格式输出，所有结果按热度排序
- 仅输出数据中存在的情感分类，如果某个分类没有数据则跳过"""

comment_rules_zh = """**代表性评论要求**（数据中包含代表性评论时）：
- 在每个话题下引用 1-3 条对应的代表性评论，用引号括起来
- 若评论为非中文内容，请翻译成中文后再引用
- 使用 Markdown 链接格式：[查看详情]({url})
- 如果 url 不存在，则不显示链接；若 url 已存在，必须原样保留链接，不要丢弃。"""

opinion_summary_prompt_en = """You are a game sentiment analysis expert. Generate a sentiment analysis report based on the provided data, organized by sentiment category, summarizing core viewpoints.

**Output Format**:

**Summary**:
<One paragraph summarizing main findings, specifically identifying the most important positive/negative topics with names and percentages>

**Positive Discussion** (X%):
**{number}. {topic description}({percentage}%)** : {content description}.

**Negative Discussion** (X%):
**{number}. {topic description}({percentage}%)** : {content description}.

**Neutral Discussion** (X%):
**{number}. {topic description}({percentage}%)** : {content description}.

**Summary Writing Requirements**:
- Specific: Directly state the main positive/negative topics, include specific topic names, percentages, key issues (e.g., "negative feedback focuses on lack of innovation in combat system, game stuttering, etc.")
- NEVER say "polarization", "mixed reviews", "opinions vary", "overall there are positives and negatives" - these are useless

**Note**:
- All content must be based on the provided data. Do not fabricate topics or content
- Use Markdown format for output. All results ordered by engagement
- Only output sentiment categories that exist in the data; skip categories with no data"""

comment_rules_en = """**Representative Comments** (when comment data is included):
- Quote 1-3 representative comments for each topic, in quotation marks
- If comments are not in English, please translate them to English before quoting
- Use Markdown link format: [View Details]({url})
- If url does not exist, omit the link; if url is present, keep the link verbatim — do not drop it."""


async def _process_single_day_query(
    context: RunContextWrapper[GameContext],
    game_ids: List[str],
    game_names: List[str],
    start_date: str,
    end_date: str,
    language: str,
    channel_type: str,
    sentiment_type: str,
    game_info_dict: Dict[str, Any],
    is_hourly: bool,
    need_comments: bool = False
) -> Dict[str, Any]:
    """
    处理单天查询（包括小时级查询）
    
    Args:
        context: 运行上下文
        game_ids: 游戏ID列表
        game_names: 游戏名称列表
        start_date: 开始日期
        end_date: 结束日期
        language: 语言
        channel_type: 渠道类型
        sentiment_type: 情感类型
        game_info_dict: 游戏信息字典
        is_hourly: 是否为小时级查询
        need_comments: 是否需要返回代表性评论
    
    Returns:
        Dict[str, Any]: 包含报告的字典
    """
    logger.info(f"【_process_single_day_query】开始处理单天查询，need_comments={need_comments}")
    
    # 根据查询类型解析时间
    if is_hourly:
        # 小时级查询：解析为带时间的格式
        start_datetime = safe_parse_datetime(start_date)
        end_datetime = safe_parse_datetime(end_date)
        # 提取日期部分用于report的date字段
        report_date = safe_parse_date(start_date)
        # 用于错误信息的显示范围（保留原始格式）
        display_start = start_date
        display_end = end_date
    else:
        # 日级查询：解析为日期格式
        report_date = safe_parse_date(start_date)
        # 用于错误信息的显示范围
        display_start = report_date
        display_end = report_date
    
    # 构建API请求参数
    input_data = []
    for game_id, game_name in zip(game_ids, game_names):
        entity_type = ""
        for original_name, game_info in game_info_dict.items():
            # 优先使用 game_id 匹配（最可靠）
            if game_info.get("game_id") == game_id:
                entity_type = game_info.get("entity_type", "")
                break
            # 备选：使用名称匹配（兼容旧逻辑）
            if game_info.get("game_name") == game_name or original_name == game_name or game_info.get("entity_name") == game_name:
                entity_type = game_info.get("entity_type", "")
                break
        if not entity_type:
            entity_type = game_info_dict.get(game_name, {}).get("entity_type", "")
        
        # 如果仍然找不到 entity_type，记录警告
        if not entity_type:
            logger.warning(f"【_process_single_day_query】游戏 {game_name}(game_id={game_id}) 未找到 entity_type，可能导致API调用失败")

        if is_hourly:
            data = {
                "start_time": start_datetime,
                "end_time": end_datetime,
                "date_type": "daily",
                "game_name": game_name,
                "edition_unified_id": game_id,
                "entity_type": entity_type,
                "id_type": "unified_id" if entity_type == "mobile" else "edition_id",
                "sentiment_type": sentiment_type,
                "channel_type": channel_type,
                "language": language
            }
        else:
            data = {
                "start_time": f"{report_date} 00:00:00",
                "end_time": f"{report_date} 23:59:59",
                "date_type": "daily",
                "game_name": game_name,
                "edition_unified_id": game_id,
                "entity_type": entity_type,
                "id_type": "unified_id" if entity_type == "mobile" else "edition_id",
                "sentiment_type": sentiment_type,
                "channel_type": channel_type,
                "language": language
            }
        
        # 根据 need_comments 决定是否添加 topic_comments_top_n
        if need_comments:
            data["topic_comments_top_n"] = 3
            logger.info(f"【_process_single_day_query】启用代表性评论，添加 topic_comments_top_n=3")
        
        input_data.append(data)

    if is_hourly:
        logger.info(f"生成 {len(input_data)} 个小时级API请求，共 {len(game_names)} 个游戏")
    else:
        logger.info(f"生成 {len(input_data)} 个单天API请求，共 {len(game_names)} 个游戏")

    # 单天API调用
    all_outputs = []
    for i, data in enumerate(input_data):
        game_name = data["game_name"]
        logger.info(f"处理游戏 {game_name} ({i + 1}/{len(input_data)})")

        try:
            logger.info(f"【Tool API Call】- 【get_opinion_gpt_report】: {json.dumps(data, ensure_ascii=False)}")
            output = await databrain.api.async_send_request_with_token(databrain.api.GPT_API, data, context.context.token)
            all_outputs.append(output)
            logger.info(f"【Tool API Response】- 【get_opinion_gpt_report】: 成功")
        except Exception as e:
            logger.error(f"游戏 {game_name} API调用失败: {e}")
            continue

    # 构建reports结构
    reports = {}
    for input_value, output in zip(input_data[: len(all_outputs)], all_outputs):
        try:
            result_data = output.json()
            game_name = input_value["game_name"]

            if "data" in result_data:
                report_data = {
                    "date": report_date,
                    "api_type": "single_day"
                }

                # 兼容 API 返回字段名：优先使用 report_cn，回退到 report_zh
                report_content_zh = (
                    result_data.get("data", {}).get("report_cn") or 
                    result_data.get("data", {}).get("report_zh") or 
                    ""
                )
                report_content_en = result_data.get("data", {}).get("report_en", "")

                if language == "zh":
                    report_content = report_content_zh if report_content_zh and str(report_content_zh).strip() else report_content_en
                else:
                    report_content = report_content_en if report_content_en and str(report_content_en).strip() else report_content_zh

                if not report_content or not report_content.strip():
                    logger.warning(f"游戏 {game_name} 返回空的舆情报告（API返回 code=0 但 report 为空），跳过该游戏")
                    continue  # 跳过该游戏，不加入 reports

                # 提取并添加 top_comments（如果存在且 need_comments=True）
                if need_comments:
                    events = result_data.get("data", {}).get("events", [])
                    if events and isinstance(events, list):
                        comment_field = "content_to_zh" if language == "zh" else "content_to_en"
                        comment_section_title = "\n\n### 代表性评论\n" if language == "zh" else "\n\n### Representative Comments\n"
                        comments_parts = []
                        
                        for event in events[:30]:  # 最多处理前30个事件
                            if not isinstance(event, dict):
                                continue
                            
                            top_comments = event.get("top_comments", [])
                            if not top_comments or not isinstance(top_comments, list):
                                continue
                            
                            event_title = event.get("event_title_zh", event.get("event_title", "")) if language == "zh" else event.get("event_title_en", event.get("event_title", ""))
                            
                            if event_title and top_comments:
                                event_comments = []
                                for comment in top_comments[:3]:  # 每个事件最多3条评论
                                    if not isinstance(comment, dict):
                                        continue
                                    
                                    comment_content = comment.get(comment_field, comment.get("content", ""))
                                    comment_url = comment.get("content_url", "")
                                    
                                    if comment_content:
                                        # 截断过长的评论
                                        if len(comment_content) > 150:
                                            comment_content = comment_content[:150] + "..."
                                        
                                        # 添加链接
                                        if comment_url:
                                            event_comments.append(f'  - "{comment_content}" [查看详情]({comment_url})' if language == "zh" else f'  - "{comment_content}" [View Details]({comment_url})')
                                        else:
                                            event_comments.append(f'  - "{comment_content}"')
                                
                                if event_comments:
                                    comments_parts.append(f"**{event_title}**:\n" + "\n".join(event_comments))
                        
                        # 将评论附加到报告末尾
                        if comments_parts:
                            report_content += comment_section_title + "\n".join(comments_parts)
                            logger.info(f"【_process_single_day_query】已添加 {len(comments_parts)} 个话题的代表性评论")

                report_data["report"] = report_content
                reports[game_name] = [report_data]

        except NoResultException:
            raise
        except Exception as e:
            logger.error(f"处理游戏 {input_value['game_name']} 响应失败: {e}")

    # 生成引用链接
    try:
        reference_urls = handle_opinion_references(
            game_info_dict=game_info_dict,
            game_names=game_names,
            game_ids=game_ids,
            reference_type="KeyOpinions",
            context=context
        )
        if reference_urls:
            context.context.references.extend(reference_urls)
    except Exception as e:
        logger.error(f"【_process_single_day_query】生成引用链接时出错: {e}")

    # 根据语言选择prompt，need_comments=True时追加评论展示规则
    opinion_summary_prompt = opinion_summary_prompt_zh if language == "zh" else opinion_summary_prompt_en
    if need_comments:
        opinion_summary_prompt += "\n" + (comment_rules_zh if language == "zh" else comment_rules_en)
    
    final_result = {
        "instruction": opinion_summary_prompt,
        "reports": reports
    }

    # 统一的空结果处理：返回空字典，交由上层策略降级逻辑处理
    if not reports:
        game_names_str = ", ".join(game_names) if game_names else "所有游戏"
        logger.warning(f"所有游戏均无舆情数据: {game_names_str} ({display_start} 至 {display_end})，返回空字典")
        # 返回空字典，不抛异常
        return {
            "instruction": opinion_summary_prompt,
            "reports": {}
        }

    return final_result


async def _get_opinion_summary_report(
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    game_ids: Optional[List[str]],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    channel_category: Optional[str] = "total",
    sentiment_category: Optional[str] = "total",
) -> str:
    """
    服务函数：获取舆情总结报告
    
    这是对原 get_opinion_summary_report 的直接封装，用于在新的 v2 工具中复用
    
    Args:
        context: 运行上下文
        game_names: 游戏名称列表
        game_ids: 游戏ID列表（可选）
        start_date: 开始日期 (YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS)
        end_date: 结束日期 (YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS)
        channel_category: 渠道分类 ('total', 'social', 'game_store')
        sentiment_category: 情感分类 ('total', 'positive', 'negative', 'neutral')
    
    Returns:
        str: JSON格式的舆情报告
    """
    logger.info(f"【_get_opinion_summary_report】开始执行，游戏: {game_names}")
    
    # 设置默认日期
    if not start_date:
        start_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    if not end_date:
        end_date = datetime.now().strftime("%Y-%m-%d")

    # 参数校验
    language = context.context.language if context.context.language in ["zh", "en"] else "en"
    channel_type = channel_category if channel_category in ["total", "social", "game_store"] else "total"
    sentiment_type = sentiment_category if sentiment_category in ["total", "positive", "negative", "neutral"] else "total"

    # 确保获取game_id
    game_ids = await _ensure_game_ids(context, game_names)

    if not sentiment_type:
        sentiment_type = "total"
    if not channel_type:
        channel_type = "total"

    # 固定开启代表性评论
    need_comments = True
    # need_comments = is_deepthink(context.context)

    logger.info(f"【_get_opinion_summary_report】固定启用代表性评论")

    # 判断是否为小时级查询
    is_hourly = is_hourly_query(start_date, end_date)

    # 保存原始的日期/时间字符串，用于传递给子函数
    original_start = start_date
    original_end = end_date

    if is_hourly:
        logger.info(f"检测到小时级查询: {start_date} 至 {end_date}")
        start_datetime = safe_parse_datetime(start_date)
        end_datetime = safe_parse_datetime(end_date)
        total_hours = (datetime.strptime(end_datetime, "%Y-%m-%d %H:%M:%S") -
                      datetime.strptime(start_datetime, "%Y-%m-%d %H:%M:%S")).total_seconds() / 3600
        logger.info(f"小时级查询时长: {total_hours}小时")
        
        start_date = safe_parse_date(start_date)
        end_date = safe_parse_date(end_date)
        start_date_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_date_dt = datetime.strptime(end_date, "%Y-%m-%d")
        total_days = (end_date_dt - start_date_dt).days + 1
    else:
        start_date = safe_parse_date(start_date)
        end_date = safe_parse_date(end_date)
        start_date_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_date_dt = datetime.strptime(end_date, "%Y-%m-%d")
        total_days = (end_date_dt - start_date_dt).days + 1

    # 从context获取已缓存的游戏信息
    game_info_dict = context.context.game_info_dict
    if not game_info_dict:
        logger.warning("【_get_opinion_summary_report】context中缺少game_info_dict")

    # 判断是单天还是多天查询
    if total_days == 1:
        logger.info(f"使用单天API处理查询：{start_date}")
        single_day_result = await _process_single_day_query(
            context=context,
            game_ids=game_ids,
            game_names=game_names,
            start_date=original_start,  # 使用原始的日期/时间字符串
            end_date=original_end,       # 使用原始的日期/时间字符串
            language=language,
            channel_type=channel_type,
            sentiment_type=sentiment_type,
            game_info_dict=game_info_dict,
            is_hourly=is_hourly,
            need_comments=need_comments
        )
        return truncate_output(json.dumps(single_day_result, ensure_ascii=False))
        
    else:
        logger.info(f"使用多天API处理查询：{start_date} 至 {end_date} (共{total_days}天)")
        multi_day_result = await _process_multi_day_query(
            context=context,
            game_ids=game_ids,
            game_names=game_names,
            start_date=start_date,
            end_date=end_date,
            language=language,
            channel_type=channel_type,
            sentiment_type=sentiment_type,
            game_info_dict=game_info_dict,
            need_comments=need_comments
        )
        return truncate_output(json.dumps(multi_day_result, ensure_ascii=False))
