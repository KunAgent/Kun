import asyncio
import json
import re
import time
import traceback
from collections import defaultdict
from datetime import datetime, timedelta
from itertools import islice
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from run_context_wrapper import RunContextWrapper
from loguru import logger
from youtube_comment_downloader import SORT_BY_POPULAR, YoutubeCommentDownloader

import databrain.api
from opinion_strategy.context import GameContext
from opinion_strategy.constants import ToolName
from opinion_tools.opinion.opinion_tools import _ensure_game_ids
from opinion_utils.helper import default_tool_error_function, websearch_fallback_error_function
from opinion_utils.exceptions import NoResultException
from opinion_tools.opinion.utils.utils import truncate_output, handle_opinion_references
from opinion_tools.tool_common import get_tool_enabled, function_tool

FORMAT_RULE = """
<FORMAT_RULE>
**舆情分析报告格式规范 - 严格按照以下格式:**

## 1. 标题格式
- **主标题**: ## {游戏名称} 舆情分析 ({日期范围} )
- **副标题**: {情感类型}观点 ({数量}条, 互动量:{数字}, 点赞量:{数字})

## 2. 数据概览
**总评论**: {总数量} | **负面**: {数量} | **正面**: {数量} | **中性**: {数量}

## 3. 观点条目格式 (核心要求)
*必须*提醒用户“话题占比仅使用代表性评论计算”
**严格格式**: {序号}. {主题描述}({百分比}%) : {详细内容说明}。

**重要**:
- 占比百分比放在括号内：({占比%})
- 主题描述要简洁明确，突出关键问题
- 详细内容说明要简洁明了，不要添加换行符

**示例格式**:
1. 作弊与机器人问题(占比%): 游戏在作弊和机器人问题上存在缺陷，一些玩家反应遭到盗号攻击导致使用不公平优势的黑客，另一些玩家测试比较中用黑人过多表示不满。
2. 设备性能与优化问题(占比%): 游戏在设备性能和优化方面存在挑战，尤其是在低端设备上，问题包括帧率下降、过热和游戏过程中崩溃。

## 4. 内容要求
- **内容完整性**: 必须包含所有观点条目，不遗漏任何数据
- **数据准确性**: 确保占比百分比与源数据完全一致
- **描述客观性**: 避免夸大词汇，保持中性描述
- **格式一致性**: 严格按照上述格式模板执行

## 5. 特别注意
- 保留所有原始链接和HTML标签
- 占比百分比必须准确反映实际数据
- 每个条目的描述要基于实际评论内容
- 不允许省略任何观点条目，占比数字必须与源数据完全一致！
</FORMAT_RULE>
"""

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

**代表性评论**（数据中包含代表性评论时）：
- 在每个话题下引用 1-3 条对应的代表性评论，用引号括起来
- 若评论为非中文内容，请翻译成中文后再引用
- 使用 Markdown 链接格式：[查看详情]({url})
- 如果 url 不存在，则不显示链接

**注意**：
- 所有内容必须基于提供的数据，不要编造话题和内容
- 使用 Markdown 格式输出，所有结果按热度排序
- 仅输出数据中存在的情感分类，如果某个分类没有数据则跳过"""

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

**Representative Comments** (when comment data is included):
- Quote 1-3 representative comments for each topic, in quotation marks
- If comments are not in English, please translate them to English before quoting
- Use Markdown link format: [View Details]({url})
- If url does not exist, omit the link

**Note**:
- All content must be based on the provided data. Do not fabricate topics or content
- Use Markdown format for output. All results ordered by engagement
- Only output sentiment categories that exist in the data; skip categories with no data"""


async def format_multi_day_report(api_response, game_name, start_date, end_date, game_id, language="zh"):
    """
    为多天API返回数据创建简洁报告格式，保留颜色用于展示,利用llm_topic构建标题链接
    """
    def _return_no_data(reason=""):
        """统一的无数据返回函数"""
        if reason:
            logger.debug(f"游戏 {game_name} 在 {start_date} 至 {end_date} 期间无数据: {reason}")
        no_data_msg = "暂无数据" if language == "zh" else "No data available"
        return {
            "data": {"report": no_data_msg},
            "query_date": f"{start_date} to {end_date}",
            "api_type": "date_range",
            "no_data": True
        }

    try:
        # 统一的API响应有效性检查
        if (not api_response or
            not isinstance(api_response, dict) or
            api_response.get("code") != 0 or
            not api_response.get("data") or
            not isinstance(api_response.get("data"), dict)):
            return _return_no_data(f"无效API响应: {api_response}")

        api_data = api_response["data"]
        sentiment_data = api_data.get("list", {})
        stats_data = api_data.get("stats", {})

        if not stats_data:
            return _return_no_data("无统计数据")

        # 计算事件层面的总数（negative/positive/neutral 三类事件展示出来的 count 总和）
        try:
            total_event_count = 0
            for sentiment in ["negative", "positive", "neutral"]:
                for event in sentiment_data.get(sentiment, []) or []:
                    total_event_count += int((event or {}).get("count", 0) or 0)
        except Exception:
            total_event_count = 0

        # 统计摘要
        total_count = stats_data.get("total_count", 0)
        pos_count = stats_data.get("positive_count", 0)
        pos_engagement = stats_data.get("positive_engagement", 0)
        pos_likes = stats_data.get("positive_likes", 0)
        pos_ratio = round(stats_data.get("positive_ratio", 0) * 100,3)
        neg_count = stats_data.get("negative_count", 0)
        neg_engagement = stats_data.get("negative_engagement", 0)
        neg_likes = stats_data.get("negative_likes", 0)
        neg_ratio = round(stats_data.get("negative_ratio", 0) * 100,3)
        neu_count = stats_data.get("neutral_count", 0)
        neu_engagement = stats_data.get("neutral_engagement", 0)
        neu_likes = stats_data.get("neutral_likes", 0)
        neu_ratio = round(stats_data.get("neutral_ratio", 0) * 100,3)

        # 舆情报告标题（包含基本统计信息）
        if language == "zh":
            title = f"""## {game_name} 舆情分析 ({start_date} ~ {end_date})

**总评论**: {total_count:,} | <span style=\"color: #dc3545;\">**负面**: {neg_count:,}</span> | <span style=\"color: #28a745;\">**正面**: {pos_count:,}</span> | <span style=\"color: #6c757d;\">**中性**: {neu_count:,}</span>"""
        else:
            title = f"""## {game_name} Opinion Overview ({start_date} ~ {end_date})

**Total Comments**: {total_count:,} | <span style=\"color: #dc3545;\">**Negative**: {neg_count:,}</span> | <span style=\"color: #28a745;\">**Positive**: {pos_count:,}</span> | <span style=\"color: #6c757d;\">**Neutral**: {neu_count:,}</span>"""

        report_sections = [title]

        # 简化的情感数据处理
        sentiment_config = {
            "negative": {"color": "#dc3545", "zh": "负面观点", "en": "Negative"},
            "positive": {"color": "#28a745", "zh": "正面观点", "en": "Positive"},
            "neutral": {"color": "#6c757d", "zh": "中性观点", "en": "Neutral"}
        }

        for sentiment in ["negative", "positive", "neutral"]:
            events = sentiment_data.get(sentiment, [])
            if not events:
                continue

            config = sentiment_config[sentiment]
            label = config["zh"] if language == "zh" else config["en"]

            # 获取对应情感的统计数据
            if sentiment == "positive":
                count, ratio, engagement, likes = pos_count, pos_ratio, pos_engagement, pos_likes
            elif sentiment == "negative":
                count, ratio, engagement, likes = neg_count, neg_ratio, neg_engagement, neg_likes
            elif sentiment == "neutral":
                count, ratio, engagement, likes = neu_count, neu_ratio, neu_engagement, neu_likes
            else:
                continue

            # 格式化统计信息
            if language == "zh":
                stats_info = f"({count}条, 占比{ratio:.1f}%, 互动量:{engagement:,}, 点赞量:{likes:,})"
            else:
                stats_info = f"({count} posts, {ratio:.1f}%, engagement:{engagement:,}, likes:{likes:,})"

            # 该情感分类下的所有topics
            topics = []
            for event in events:
                topic = event.get("llm_topic", "")
                if topic and topic not in topics:
                    topics.append(topic)

            # 生成对应情感分类的链接
            encoded_start = start_date + "%2000%3A00%3A00"
            encoded_end = end_date + "%2023%3A59%3A59"

            # 转换情感类型为数字编码
            sentiment_mapping = {
                "negative": "1",
                "neutral": "3",
                "positive": "5"
            }
            sentiment_code = sentiment_mapping.get(sentiment, sentiment)

            # 如果有topics，则添加到链接中
            if topics:
                # 处理topics：去重、清理、编码
                cleaned_topics = []
                for topic in topics:
                    # 先替换分隔符，然后去重
                    cleaned_topic = topic.lower().replace("|", ",")
                    if cleaned_topic not in cleaned_topics:
                        cleaned_topics.append(cleaned_topic)

                # 使用urllib.parse.quote进行完整URL编码
                topics_param = quote(",".join(cleaned_topics), safe='')
                sentiment_link_url = f"v2/opinion/Feeds/Feeds?gameid={game_id}&by=engagement&order=desc&date_type=daily&end_time={encoded_end}&start_time={encoded_start}&sentiment={sentiment_code}&topic={topics_param}"
            else:
                sentiment_link_url = f"v2/opinion/Feeds/Feeds?gameid={game_id}&by=engagement&order=desc&date_type=daily&end_time={encoded_end}&start_time={encoded_start}&sentiment={sentiment_code}"

            # 添加可点击的情感分类标题
            clickable_label = f"[{label}]({sentiment_link_url})"
            section_title = f"\n### <span style='color: {config['color']};'>{clickable_label}</span>"
            report_sections.append(section_title)

            # 显示前10个事件
            for i, event in enumerate(events[:10], 1):
                event_count = int(event.get("count", 0) or 0)
                topic = event.get("llm_topic", "")

                # 使用language参数简化字段选择
                title = event.get(f"event_title_{language}", event.get("event_title", ""))
                content = event.get(f"event_content_{language}", event.get("event_content", ""))

                # 将数量显示为占比：事件 count / 全部事件 count 之和
                ratio_pct = (event_count / total_event_count * 100) if total_event_count > 0 else 0.0
                count_label = f"({ratio_pct:.1f}%)" if language == "zh" else f"({ratio_pct:.1f}%)"

                # 保留完整内容，让大模型自己决定如何总结（1000字符以上才截断）
                MAX_CONTENT_LEN = 200
                if len(content) > MAX_CONTENT_LEN:
                    display_content = content[:MAX_CONTENT_LEN] + "..."
                else:
                    display_content = content

                # 简化事件格式，专注保留标题、数量和内容
                event_text = f"{i}. **{title}** **{count_label}**: {display_content}\n"
                
                # 提取并添加 top_comments（如果存在）
                top_comments = event.get("top_comments", [])
                if top_comments and isinstance(top_comments, list):
                    # 根据语言选择评论字段
                    comment_field = "content_to_zh" if language == "zh" else "content_to_en"
                    comment_label = "代表性评论" if language == "zh" else "Representative Comments"
                    
                    comments_text = []
                    for j, comment in enumerate(top_comments[:3], 1):  # 最多显示3条
                        if not isinstance(comment, dict):
                            continue
                        
                        comment_content = comment.get(comment_field, comment.get("content", ""))
                        comment_url = comment.get("content_url", "")
                        
                        if comment_content:
                            # 截断过长的评论
                            if len(comment_content) > 150:
                                comment_content = comment_content[:150] + "..."
                            
                            # 如果有URL，添加链接
                            if comment_url:
                                comment_item = f'   - "{comment_content}" [查看详情]({comment_url})' if language == "zh" else f'   - "{comment_content}" [View Details]({comment_url})'
                            else:
                                comment_item = f'   - "{comment_content}"'
                            
                            comments_text.append(comment_item)
                    
                    # 如果有评论，添加到事件文本中
                    if comments_text:
                        event_text += f"  *{comment_label}*:\n" + "\n".join(comments_text) + "\n"

                report_sections.append(event_text)

        full_report = "\n".join(report_sections)

        return {
            "data": {"report": full_report},
            "query_date": f"{start_date} to {end_date}",
            "api_type": "date_range"
        }

    except Exception as e:
        logger.error(f"格式化多天报告时出错: {e}")
        error_msg = f"报告生成失败: {str(e)}" if language == "zh" else f"Report generation failed: {str(e)}"
        return {
            "data": {"report": error_msg},
            "query_date": f"{start_date} to {end_date}",
            "api_type": "date_range_error"
        }

async def _process_multi_day_query(
    context: RunContextWrapper[GameContext],
    game_ids: List[str],
    game_names: List[str],
    start_date: str,
    end_date: str,
    language: Optional[str],
    channel_type: str,
    sentiment_type: str,
    game_info_dict: Dict[str, Any],
    need_comments: bool = False
) -> Dict[str, Any]:
    """
    处理多天查询，使用新的date range API
    
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
        need_comments: 是否需要返回代表性评论
    
    Returns:
        Dict[str, Any]: 包含报告的字典
    """
    logger.info(f"【多天API处理】开始处理 {len(game_names)} 个游戏的多天查询，need_comments={need_comments}")

    # 构建API请求参数
    input_data = []
    for game_id, game_name in zip(game_ids, game_names):
        # 在game_info_dict中查找对应的游戏信息（使用game_id匹配，更可靠）
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
            logger.warning(f"【多天API处理】游戏 {game_name}(game_id={game_id}) 未找到 entity_type，可能导致API调用失败")

        data = {
            "start_time": f"{start_date} 00:00:00",
            "end_time": f"{end_date} 23:59:59",
            "sentiment_type": sentiment_type,
            "channel_type": channel_type,
            "date_type": "daily",
            "edition_unified_id": game_id,
            "entity_type": entity_type,
            "id_type": "unified_id" if entity_type == "mobile" else "edition_id",
            "top_n": 10,  # 每个情感类型返回前10个事件
            "sample_number": 10,  # 每个事件的样本数量
            "need_count_data": False  # 需要统计数据
        }
        
        # 根据 need_comments 决定是否添加 topic_comments_top_n
        if need_comments:
            data["topic_comments_top_n"] = 3  # 返回每个话题的前3条代表性评论
            logger.info(f"【多天API处理】启用代表性评论，添加 topic_comments_top_n=3")
        
        input_data.append((data, game_name))

    # 并发调用新API
    logger.info(f"【多天API处理】将并发调用 {len(input_data)} 个新API请求")

    try:
        # 顺序处理API请求
        all_outputs = []

        for i, (data, game_name) in enumerate(input_data):
            logger.info(f"【多天API处理】处理游戏 {game_name} ({i + 1}/{len(input_data)})")

            try:
                logger.info(f"【Tool API Call】- 【get_opinion_gpt_date_range】: {json.dumps(data, ensure_ascii=False)}")
                response = await databrain.api.async_send_request_with_token(databrain.api.GPT_API_DATE_RANGE, data, context.context.token)
                if response is None:
                    logger.error(f"【多天API处理】游戏 {game_name} API返回None响应")
                    all_outputs.append(None)
                else:
                    output = response.json()
                    all_outputs.append(output)
                    logger.info(f"【Tool API Response】- 【get_opinion_gpt_date_range】: {output}")
            except Exception as e:
                logger.error(f"【多天API处理】游戏 {game_name} API调用失败: {e}")
                all_outputs.append(e)

        # 简化：直接构建reports结构，移除冗余层级
        reports = {}

        for (data, game_name), output in zip(input_data, all_outputs):
            try:
                if isinstance(output, Exception) or output is None:
                    logger.error(f"【多天API处理】游戏 {game_name} API调用失败: {output}")
                    continue

                # 获取当前游戏的game_id
                current_game_id = data["edition_unified_id"]

                # 生成舆情报告
                converted_result = await format_multi_day_report(
                    output, game_name, start_date, end_date, current_game_id, language
                )

                # 检查是否无数据，跳过该游戏
                if converted_result.get("no_data", False):
                    logger.warning(f"游戏 {game_name} 多天查询无统计数据，跳过该游戏")
                    continue  # 跳过该游戏，不加入 reports

                # 提取核心报告数据
                if "data" in converted_result:
                    report_data = {
                        "date": f"{start_date} to {end_date}",
                        "api_type": "date_range"
                    }

                    # 简化报告处理：统一使用"report"字段
                    if "report" in converted_result["data"]:
                        report_content = converted_result["data"]["report"]

                        # 检查多天API报告内容是否为空，跳过该游戏
                        if not report_content or not report_content.strip():
                            logger.warning(f"游戏 {game_name} 多天查询返回空的舆情报告，跳过该游戏")
                            continue  # 跳过该游戏，不加入 reports

                        report_data["report"] = report_content
                        reports[game_name] = [report_data]

            except NoResultException:
                # NoResultException需要向上传播，立即触发websearch
                raise
            except Exception as e:
                logger.error(f"【多天API处理】处理游戏 {game_name} 响应时出错: {e}")
                continue

        # 根据语言选择prompt
        opinion_summary_prompt = opinion_summary_prompt_zh if language == "zh" else opinion_summary_prompt_en
        
        # 简化：直接返回核心结构
        final_result = {
            "reports": reports,  # 只保留大模型需要的核心数据
            "instruction": opinion_summary_prompt
        }

        # 简化：使用标准化的引用链接生成
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
            logger.error(f"【多天API处理】生成引用链接时出错: {e}")
            # 兜底：使用原有逻辑
            for game_name, game_id in zip(game_names, game_ids):
                try:
                    context.context.references.append({
                        "url": f"v2/opinion/Overview/KeyOpinions?gameid={game_id}",
                        "type": "databrain",
                        "key": f"Opinion_{game_name}",
                        "name": f"{game_name}_Opinion",
                        "title": f"{game_name}_Opinion",
                        "image_url": "",
                        "favicon": "",
                    })
                except Exception as ref_error:
                    logger.error(f"【多天API处理】添加游戏 {game_name} 的引用链接时出错: {ref_error}")
                    continue

        # # 导出调试数据
        # json_path = "./output_multi_day.json"
        # with open(json_path, "w", encoding="utf-8") as f:
        #     json.dump(final_result, f, indent=4, ensure_ascii=False)
        # logger.info(f"【多天API处理】数据导出成功：{json_path}")

        # FORMAT_RULE 不应该包含在最终输出中，它只是格式指导文档

        return final_result

    except NoResultException:
        # NoResultException需要向上传播，立即触发websearch
        raise
    except Exception as e:
        logger.error(f"【多天API处理】处理过程中出现错误: {e}")
        return {
            "error": f"多天查询处理失败: {str(e)}",
            "reports": {}
        }

def safe_parse_date(date_str: str) -> str:
    """
    解析日期字符串，支持带时间和不带时间的格式，返回标准YYYY-MM-DD格式
    """
    try:
        parsed_dt = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
        return parsed_dt.strftime("%Y-%m-%d")
    except ValueError:
        parsed_dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
        return parsed_dt.strftime("%Y-%m-%d")

def safe_parse_datetime(date_str: str) -> str:
    """
    解析日期时间字符串，保留时间信息，返回标准YYYY-MM-DD HH:MM:SS格式
    """
    try:
        # 尝试解析完整的日期时间格式
        parsed_dt = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
        return parsed_dt.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            # 如果只有日期，添加默认时间
            parsed_dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
            return parsed_dt.strftime("%Y-%m-%d 00:00:00")
        except ValueError:
            # 兜底处理
            return date_str

def is_hourly_query(start_date: str, end_date: str) -> bool:
    """
    判断是否为小时级查询
    如果输入包含具体小时信息且不是整天查询，则认为是小时级查询
    """
    try:
        # 检查是否包含时间信息
        has_start_time = " " in start_date and ":" in start_date
        has_end_time = " " in end_date and ":" in end_date

        if not (has_start_time and has_end_time):
            return False

        # 解析时间
        start_dt = datetime.strptime(start_date, "%Y-%m-%d %H:%M:%S")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d %H:%M:%S")

        # 如果是跨天查询，不使用小时级
        if start_dt.date() != end_dt.date():
            return False

        # 如果不是从00:00:00到23:59:59的整天查询，则认为是小时级查询
        is_full_day = (start_dt.time() == datetime.min.time() and
                      end_dt.time() == datetime.max.time().replace(microsecond=0))

        return not is_full_day

    except Exception as e:
        logger.warning(f"判断小时级查询时发生错误: {e}")
        return False