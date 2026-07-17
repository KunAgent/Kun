import asyncio
import json
import re
from itertools import islice
from typing import Any, Dict, List, Optional

from run_context_wrapper import RunContextWrapper
from exa_py import AsyncExa
from loguru import logger
from youtube_comment_downloader import SORT_BY_POPULAR, YoutubeCommentDownloader
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

import databrain.api
from opinion_common.config import globalvar as gl
from opinion_strategy.context import GameContext
from opinion_strategy.constants import ToolName, EXA_KEY
from opinion_tools.tool_common import get_tool_enabled, function_tool
from opinion_utils.helper import websearch_fallback_error_function
from opinion_utils.exceptions import NoResultException
from opinion_tools.opinion.utils.utils import truncate_output



def extract_youtube_video_id(url: str) -> str:
    """从多种YouTube链接格式中提取video_id。

    支持示例：
    - https://www.youtube.com/watch?v=VIDEO_ID
    - https://youtu.be/VIDEO_ID
    - https://www.youtube.com/embed/VIDEO_ID
    - https://www.youtube.com/shorts/VIDEO_ID
    """
    try:
        # 常见参数形式 v=VIDEO_ID
        match = re.search(r"[?&]v=([^&#]+)", url)
        if match:
            return match.group(1)

        # 短链形式 youtu.be/VIDEO_ID
        match = re.search(r"youtu\.be/([^?&#/]+)", url)
        if match:
            return match.group(1)

        # 嵌入形式 /embed/VIDEO_ID
        match = re.search(r"/embed/([^?&#/]+)", url)
        if match:
            return match.group(1)

        # shorts 形式 /shorts/VIDEO_ID
        match = re.search(r"/shorts/([^?&#/]+)", url)
        if match:
            return match.group(1)

        # 兜底：取最后一个路径段
        candidate = url.split("/")[-1].split("?")[0]
        if candidate and len(candidate) >= 8:  # 基本长度校验
            return candidate
        return ""
    except Exception:
        return ""


async def get_url_comments_from_downloader(url, url2comments, top_n=100):
    """获取YouTube视频评论"""
    try:
        # 验证是否为YouTube URL
        if not ("youtube.com" in url or "youtu.be" in url):
            error_msg = f"不支持的URL格式，仅支持YouTube链接: {url}"
            logger.error(error_msg)
            url2comments[url] = {"error": error_msg, "comments": []}
            return

        downloader = YoutubeCommentDownloader()
        comments = downloader.get_comments_from_url(url, sort_by=SORT_BY_POPULAR)
        comments_list = []
        for comment in islice(comments, top_n):
            comments_list.append(comment)
        url2comments[url] = {"comments": comments_list}
        logger.info(f"成功获取 {len(comments_list)} 条评论，来自: {url}")
    except Exception as e:
        error_msg = f"获取评论失败 {url}: {e}"
        logger.error(error_msg)
        url2comments[url] = {"error": error_msg, "comments": []}


@function_tool(
    failure_error_function=websearch_fallback_error_function,
    description_override="""
YouTube video and comment analysis tool based on url provided. 根据提供的YouTube视频链接进行"评论分析"或"字幕内容分析"。

Args:
- urls: List of YouTube video URLs
- analysis: Supported values: comments | video
- top_n: number of popular comments to fetch (for analysis='comments')

SUPPORTED URL FORMATS:
- https://www.youtube.com/watch?v=VIDEO_ID
- https://youtu.be/VIDEO_ID
- https://www.youtube.com/embed/VIDEO_ID
- https://www.youtube.com/shorts/VIDEO_ID

NOTES:
- Comments analysis only fetches the top N popular comments as a sample, not the entire dataset.
- Video analysis only returns text when the video has subtitles.
""",
    is_enabled=get_tool_enabled(ToolName.YoutubeUrlAnalysis.value),
    readable_name_map={
        "English": "YouTube URL Analysis Tool",
        "Chinese": "YouTube链接分析工具",
    }
)
async def youtube_url_analysis_tool(
    context: RunContextWrapper[GameContext],
    urls: List[str],
    analysis: str = "comments",
    top_n: int = 100
) -> Dict[str, Any]:
    if not urls:
        return {"error": "No URLs provided"}

    analysis = (analysis or "comments").strip().lower()

    # comments 分支
    if analysis == "comments":
        results: Dict[str, Any] = {}
        successful_results = 0

        for url in urls:
            try:
                # 预先验证URL格式
                if not ("youtube.com" in url or "youtu.be" in url):
                    results[url] = {
                        "success": False,
                        "error": f"不支持的URL格式，仅支持YouTube链接。检测到: {url}",
                        "comments": [],
                        "total": 0
                    }
                    continue

                # 验证是否为视频链接（排除频道链接、播放列表等）
                clean_url = url.split("&")[0]
                if any(pattern in clean_url for pattern in ["/channel/", "/c/", "/user/", "/@", "/playlist?list="]):
                    results[url] = {
                        "success": False,
                        "error": f"不支持的YouTube链接类型，仅支持视频链接。检测到: {clean_url}。请提供视频链接格式如 https://www.youtube.com/watch?v=VIDEO_ID",
                        "comments": [],
                        "total": 0
                    }
                    continue

                url2comments = {}
                await get_url_comments_from_downloader(clean_url, url2comments, top_n)

                result_data = url2comments.get(clean_url, {"comments": []})
                if "error" in result_data:
                    results[url] = {
                        "success": False,
                        "error": result_data.get("error", ""),
                        "comments": [],
                        "total": 0
                    }
                else:
                    comments_list = result_data.get("comments", [])
                    results[url] = {
                        "success": True,
                        "comments": comments_list,
                        "total": len(comments_list)
                    }
                    if comments_list:
                        successful_results += 1

            except Exception as e:
                results[url] = {
                    "success": False,
                    "error": str(e),
                    "comments": [],
                    "total": 0
                }

        if successful_results == 0:
            raise NoResultException(
                message=f"无法获取任何YouTube视频的评论数据。所有视频链接都处理失败或没有评论。视频链接: {', '.join(urls)}",
                search_query=context.context.planner_context.rephrased_question,
                use_web_search=True,
            )

        # 添加引用
        for url in urls:
            try:
                video_id = extract_youtube_video_id(url)
                if video_id:
                    reference = {
                        "url": url,
                        "type": "youtube",
                        "key": f"youtube_comments_{video_id}",
                        "name": "YouTube",
                        "title": f"YouTube_{video_id}",
                        "image_url": "https://www.youtube.com/favicon.ico",
                        "favicon": "https://www.youtube.com/favicon.ico",
                    }
                    context.context.references.append(reference)
            except Exception as e:
                logger.warning(f"解析YouTube URL时出错 {url}: {e}")

        if results:
            failed_urls = [u for u, r in results.items() if not r.get("success", False)]
            if failed_urls:
                summary_message = f"注意：此工具仅支持YouTube链接。有 {len(failed_urls)} 个链接处理失败，请检查URL格式。"
                if any("tiktok" in u.lower() for u in failed_urls):
                    summary_message += " 检测到TikTok链接，请使用专门的TikTok分析工具。"
                results["_tool_message"] = summary_message

        return truncate_output(results)

    # video 分支（字幕抓取）
    transcripts: Dict[str, str] = {}
    all_failed = True

    for url in urls:
        try:
            video_id = extract_youtube_video_id(url)
            if not video_id:
                logger.warning(f"无法从 URL 中提取 video_id: {url}")
                transcripts[url] = ""
                continue

            transcript = await get_video_content_from_exa(url)
            transcripts[url] = transcript
            if transcript and transcript.strip():
                all_failed = False
        except Exception as e:
            logger.error(f"处理视频链接时出错 {url}: {str(e)}")
            transcripts[url] = ""

    if all_failed:
        raise NoResultException(
            message=f"无法获取任何视频的字幕内容，可能是视频没有字幕或链接无效。视频链接: {', '.join(urls)}",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )

    # 添加引用
    for url in urls:
        try:
            video_id = extract_youtube_video_id(url)
            if video_id:
                reference = {
                    "url": url,
                    "type": "youtube",
                    "key": f"youtube_transcript_{video_id}",
                    "name": "YouTube",
                    "title": f"YouTube_{video_id}",
                    "image_url": "https://www.youtube.com/favicon.ico",
                    "favicon": "https://www.youtube.com/favicon.ico",
                }
                context.context.references.append(reference)
        except Exception as e:
            logger.warning(f"解析YouTube URL时出错 {url}: {e}")

    return truncate_output(transcripts)

# SELECT unified_edition_id, comment_parent_id, comment_id, content_url FROM `tencent-databrain.opinion.feeds` WHERE comment_time BETWEEN DATETIME("2025-04-16") AND DATETIME_ADD("2025-05-16", INTERVAL 1 DAY)
# AND channel_type = 'social'
# AND content_url LIKE  '%https://www.youtube.com/watch?v=BCCy-v8n4qg%'
# -- AND comment_parent_id = '-1'


async def get_video_content_from_transcript_api(video_id: str, max_words: int = 7168) -> str:
    """使用 youtube-transcript-api 获取 YouTube 视频字幕。

    优先使用手动字幕，其次使用自动生成字幕，支持多语言。
    """
    try:
        def _fetch() -> str:
            try:
                transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            except TranscriptsDisabled:
                logger.warning(f"[Transcript API] 视频已禁用字幕: {video_id}")
                return ""
            except Exception as e:
                logger.warning(f"[Transcript API] 无法列举字幕: {video_id} - {e}")
                return ""

            # 优先手动字幕，再自动生成字幕，尝试常见语言
            preferred_languages = ["en", "zh-Hans", "zh-Hant", "zh", "ja", "ko"]
            transcript = None

            # 先找手动字幕
            try:
                transcript = transcript_list.find_manually_created_transcript(preferred_languages)
            except NoTranscriptFound:
                pass

            # 再找自动字幕
            if transcript is None:
                try:
                    transcript = transcript_list.find_generated_transcript(preferred_languages)
                except NoTranscriptFound:
                    pass

            # 最后兜底取第一条可用字幕
            if transcript is None:
                try:
                    transcript = next(iter(transcript_list))
                except StopIteration:
                    logger.warning(f"[Transcript API] 没有可用字幕: {video_id}")
                    return ""

            entries = transcript.fetch()
            words = " ".join(entry.get("text", "") for entry in entries[:max_words])
            return words.strip()

        result = await asyncio.to_thread(_fetch)
        if result:
            logger.info(f"[Transcript API] 成功获取字幕，长度 {len(result)}: {video_id}")
        return result

    except Exception as e:
        logger.error(f"[Transcript API] 未知错误: {e}")
        return ""


async def get_video_content_from_exa(url: str, max_characters: int = 20000) -> str:
    """使用 youtube-transcript-api 获取字幕，失败时回退到 Exa Contents API 抓取页面内容。"""
    # 主路径：youtube-transcript-api（直接调用 YouTube 字幕接口，免费无需订阅）
    video_id = extract_youtube_video_id(url)
    if video_id:
        transcript = await get_video_content_from_transcript_api(video_id)
        if transcript:
            return transcript
        logger.warning(f"[Transcript API] 字幕获取失败，回退到 Exa Contents API: {url}")

    # 回退路径：Exa Contents API（抓取网页正文，含视频描述等元数据）
    try:
        exa: AsyncExa = gl.get_value(EXA_KEY, expected_type=AsyncExa)

        result = await asyncio.wait_for(
            exa.get_contents(
                [url],
                text={"max_characters": max_characters},
                livecrawl_timeout=12000,
            ),
            timeout=15,
        )

        if not result or not hasattr(result, "results") or not result.results:
            logger.error(f"[Exa Contents API] 未获取到结果: {url}")
            return ""

        if hasattr(result, "statuses") and result.statuses:
            for status in result.statuses:
                if getattr(status, "status", None) == "error":
                    error_tag = getattr(getattr(status, "error", None), "tag", "unknown")
                    logger.error(f"[Exa Contents API] URL 处理失败 {url}: {error_tag}")
                    return ""

        text_content = getattr(result.results[0], "text", "") or ""
        logger.info(f"[Exa Contents API] 成功获取内容，长度 {len(text_content)}: {url}")
        return text_content.strip()

    except asyncio.TimeoutError:
        logger.error(f"[Exa Contents API] 请求超时: {url}")
        return ""
    except Exception as e:
        logger.error(f"[Exa Contents API] 未知错误: {e}")
        return ""