"""
通用舆情全景服务
三路链路：官方主贴（Cube）+ 社区热帖（Cube）+ 帖子高赞评论（BigQuery）
仅在无细粒度filter的通用舆情查询时触发，作为 Strategy 2b
"""
import asyncio
import json
import time
from typing import Any, Dict, List, Optional

from run_context_wrapper import RunContextWrapper
from loguru import logger

from opinion_strategy.context import GameContext
from opinion_tools.cube.cube_model import ExtendQuery, Filter, TimeDimension
from opinion_tools.cube.cube_tools import read_cube_data
from opinion_tools.cube.transformers import DataTransformer
from opinion_tools.opinion.utils.cube_helper import get_cube_client
from opinion_tools.bigquery.bq_client import execute_read_only_sql, get_bq_agent_config
from opinion_utils.exceptions import NoResultException

_OFFICIAL = "official_account_content"
_COMMUNITY = "video_and_posts_content"
_BQ_TABLE = "tencent-databrain-prod.opinion.feeds"
_BQ_PROJECT = "tencent-databrain-prod"

# ---- LLM Instruction Prompts ----

GENERAL_OVERVIEW_PROMPT_ZH = """你是游戏社群专家，擅长根据玩家评论进行专业的解读和分析洞察。你要讲清楚本期最重要的事、玩家的总体反应，以及值得关注的负面痛点（如有）。语言自然流畅，像一个社群分析师写给产品团队的简报。
以下数据分三个部分：
1. **official_posts**：本期官方账号发布的热门主贴（按互动量排序），代表「官方推送了哪些事件」
2. **community_posts**：本期社区玩家发布的热门主贴（按互动量排序），代表「玩家在围绕什么讨论」
3. **comments**：以上热门主贴下的高赞评论（每贴 top15），代表「玩家对这些内容的具体反应」

请生成一份综合舆情报告，格式如下：

**摘要**：
<一段话总结本期核心事件和玩家反应，直接点名最重要的事件和玩家情绪，避免「有正面有负面」等空洞表述>

**本期核心事件**（按热度排序）：
**序号. 话题标题**（互动量 真实数值）：
- 一句话描述官方发了什么 [链接](url)
- "玩家评论原文" [链接](url)

按此格式列出 Top 5-8 个官方事件。

**玩家热议内容**（来自社区热帖）：
**序号. 话题标题**（互动量 真实数值）：
- 一句话描述玩家在传播什么 [链接](url)
- "玩家评论原文" [链接](url)

按此格式列出 Top 5-8 个社区热帖。

**舆情总体**：
从声量、情感分布、热度趋势三个角度评价，要有具体数字和平台依据，结尾用一句话点出当前最值得关注的机会或风险。

**规则**：
- 评论只选有实质内容的（具体看法、情绪或反馈）；跳过纯祝贺/表情/单词回复（如 "Congratulations"、"👍"、"❤️"）
- 链接 inline 嵌在 bullet 末尾；url 为空时省略，严禁构造或借用其他记录的链接
- 严格基于数据，不编造内容；official_posts / community_posts / comments 是数据中的 key
"""

GENERAL_OVERVIEW_PROMPT_EN = f"""You are a game community expert skilled at analyzing player discussions.
The data below has three sections:
1. **official_posts**: Top official account posts this period (by engagement) — "what events the official pushed"
2. **community_posts**: Top community posts this period (by engagement) — "what players are going viral about"
3. **comments**: Top-liked comments under those hot posts (top 15 per post) — "how players specifically reacted"

Generate a comprehensive sentiment report in this format:

**Summary**: <one paragraph naming the most important events and overall player sentiment. Be direct; avoid vague phrases like "mixed reviews">

**Key Official Events** (by popularity):
**N. Topic title** (engagement: real value):
- One sentence describing the official content [Link](url)
- "Player comment verbatim" [Link](url)

List Top 5-8 events in this format.

**Player Viral Content** (from community posts):
**N. Topic title** (engagement: real value):
- One sentence describing what players are sharing [Link](url)
- "Player comment verbatim" [Link](url)

List Top 5-8 posts in this format.

**Overall Sentiment**:
Assess volume, sentiment breakdown, and trend with specific numbers and platforms. Close with one sentence on the most important opportunity or risk.

**Rules**:
- Only quote comments with substantive content (specific opinions, feedback, emotions); skip pure reactions like "Congratulations", "👍", "❤️", or single-word replies
- Links inline at end of bullet; omit if url is empty, never fabricate or borrow links
- Base all content strictly on data; field names official_posts / community_posts / comments are the keys
"""


# channel_code 展示名称映射
_CHANNEL_DISPLAY_NAME: Dict[str, str] = {
    "youtube_keyword": "youtube",
    "youtube_channel": "youtube",
}

def _normalize_channel(rows: List[Dict], channel_key: str) -> List[Dict]:
    """将 channel_code 中的内部标识替换为用户友好的展示名称"""
    for row in rows:
        val = row.get(channel_key)
        if val and val in _CHANNEL_DISPLAY_NAME:
            row[channel_key] = _CHANNEL_DISPLAY_NAME[val]
    return rows


# ---- Helper Functions ----

def _build_cube_filters(
    game_ids: List[str],
    table: str,
    channel_code: Optional[List[str]] = None,
    language_code: Optional[List[str]] = None,
) -> List[Filter]:
    """构建 Cube 查询的 filter 列表"""
    filters = [Filter(member=f"{table}.game_id", operator="equals", values=game_ids)]
    if channel_code:
        filters.append(Filter(member=f"{table}.channel_code", operator="equals", values=channel_code))
    if language_code:
        filters.append(Filter(member=f"{table}.language_code", operator="equals", values=language_code))
    return filters


def _extract_cube_rows(result: Dict) -> List[Dict]:
    """
    从 Cube 返回结果中提取行数据，兼容两种格式：
    - code=0（grouped）：data 在 result['data']['data']
    - code=2（ungrouped）：data 直接在 result['data'] 作为 list
    """
    code = result.get("code")
    if code == 0:
        data = result.get("data", {})
        return data.get("data", []) if isinstance(data, dict) else []
    elif code == 2:
        data = result.get("data", [])
        return data if isinstance(data, list) else []
    return []


def _extract_urls(rows: List[Dict], table: str) -> List[str]:
    """从 Cube 查询结果里提取 URL 列表，去重保序"""
    url_key = f"{table}.url"
    seen = set()
    urls = []
    for row in rows:
        url = row.get(url_key) or row.get("url")
        if url and isinstance(url, str) and url.startswith("http") and url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def _build_comments_sql(
    game_ids: List[str],
    start_date: str,
    end_date: str,
    urls: List[str],
    language_code: Optional[List[str]],
) -> str:
    """
    构建 BigQuery CTE SQL：
    - Step A：通过 content_url 匹配主贴，取出 comment_id
    - Step B：通过 comment_parent_id 找子评论，每贴取 top10 高赞评论
    性能优化：同时带 unified_edition_id 和时间戳 filter
    """
    def _escape(s: str) -> str:
        return s.replace("'", "\\'")

    game_ids_sql = ", ".join(f"'{_escape(g)}'" for g in game_ids)
    clean_urls = [u for u in urls if isinstance(u, str) and u.startswith("http")][:30]
    if not clean_urls:
        return ""
    urls_sql = ", ".join(f"'{_escape(u)}'" for u in clean_urls)

    language_filter = ""
    if language_code:
        lang_sql = ", ".join(f"'{l}'" for l in language_code)
        language_filter = f"AND f.language IN ({lang_sql})"

    return f"""
WITH matched_posts AS (
    -- Step A: 用 content_url 匹配 Task1+Task2 返回的主贴，取其 comment_id 及 url（用于评论回退溯源）
    SELECT comment_id, content_url AS post_url
    FROM `{_BQ_TABLE}`
    WHERE unified_edition_id IN ({game_ids_sql})
      AND comment_time BETWEEN TIMESTAMP('{start_date}') AND TIMESTAMP('{end_date}')
      AND comment_parent_id = '-1'
      AND content_url IN ({urls_sql})
),
ranked_comments AS (
    -- Step B: 找这些主贴下的子评论，按点赞量排序取 top10
    -- url 优先取子贴自身链接，没有时回退到父帖链接（TikTok/YouTube 评论无独立 permalink）
    SELECT
        f.comment_parent_id,
        COALESCE(NULLIF(f.content_url, ''), p.post_url) AS url,
        f.content_to_zh,
        f.content_to_en,
        f.content,
        f.sentiment_rating,
        COALESCE(f.tweets_like, 0) + COALESCE(f.tweets_retweet, 0) AS engagement,
        ROW_NUMBER() OVER (
            PARTITION BY f.comment_parent_id
            ORDER BY COALESCE(f.tweets_like, 0) + COALESCE(f.tweets_retweet, 0) DESC
        ) AS rn
    FROM `{_BQ_TABLE}` f
    INNER JOIN matched_posts p ON f.comment_parent_id = p.comment_id
    WHERE f.unified_edition_id IN ({game_ids_sql})
      AND f.comment_time BETWEEN TIMESTAMP('{start_date}') AND TIMESTAMP('{end_date}')
      {language_filter}
)
SELECT
    comment_parent_id,
    url,
    content_to_zh,
    content_to_en,
    content,
    sentiment_rating,
    engagement
FROM ranked_comments
WHERE rn <= 10
ORDER BY comment_parent_id, engagement DESC
"""


# ---- Task Functions ----

async def _query_official_posts_cube(
    context: RunContextWrapper[GameContext],
    game_ids: List[str],
    start_date: str,
    end_date: str,
    language_code: Optional[List[str]],
    channel_code: Optional[List[str]],
) -> List[Dict]:
    """Task1: 查官方主贴 top10（official_account_content via Cube）"""
    t0 = time.perf_counter()
    cube_client = get_cube_client()
    transformer = DataTransformer()
    language = getattr(context.context, "language", None) or "English"
    content_field = f"{_OFFICIAL}.content_zh" if language == "Chinese" else f"{_OFFICIAL}.content_en"

    filters = _build_cube_filters(game_ids, _OFFICIAL, channel_code, language_code)
    # 只查主贴，不查评论
    filters.append(Filter(
        member=f"{_OFFICIAL}.content_type",
        operator="equals",
        values=["Text Posts", "Video Titles"],
    ))

    query = ExtendQuery(
        measures=[
            f"{_OFFICIAL}.engagement",
            f"{_OFFICIAL}.likes",
            f"{_OFFICIAL}.shares",
            f"{_OFFICIAL}.comments",
        ],
        dimensions=[
            f"{_OFFICIAL}.url",
            content_field,
            f"{_OFFICIAL}.channel_code",
        ],
        timeDimensions=[TimeDimension(
            dimension=f"{_OFFICIAL}.date",
            dateRange=[start_date, end_date],
        )],
        filters=filters,
        order={f"{_OFFICIAL}.engagement": "desc"},
        ungrouped=True,
        limit=10,
    )

    result = await read_cube_data(cube_client, transformer, query, language)
    elapsed = (time.perf_counter() - t0) * 1000
    rows = _extract_cube_rows(result)
    if not rows and result.get("code") not in (0, 2):
        logger.warning(f"【general_overview】Task1 官方主贴查询失败（{elapsed:.0f}ms）code={result.get('code')}")
        return []

    logger.info(f"【general_overview】Task1 官方主贴: {len(rows)} 条，耗时 {elapsed:.0f}ms")
    return rows


async def _query_community_posts_cube(
    context: RunContextWrapper[GameContext],
    game_ids: List[str],
    start_date: str,
    end_date: str,
    language_code: Optional[List[str]],
    channel_code: Optional[List[str]],
) -> List[Dict]:
    """Task2: 查社区热帖 top10（video_and_posts_content via Cube）"""
    t0 = time.perf_counter()
    cube_client = get_cube_client()
    transformer = DataTransformer()
    language = getattr(context.context, "language", None) or "English"
    content_field = f"{_COMMUNITY}.content_zh" if language == "Chinese" else f"{_COMMUNITY}.content_en"

    filters = _build_cube_filters(game_ids, _COMMUNITY, channel_code, language_code)
    # 只查主贴，不查评论
    filters.append(Filter(
        member=f"{_COMMUNITY}.content_type",
        operator="equals",
        values=["Text Posts", "Video Titles"],
    ))

    query = ExtendQuery(
        measures=[f"{_COMMUNITY}.engagement"],
        dimensions=[
            f"{_COMMUNITY}.url",
            content_field,
            f"{_COMMUNITY}.channel_code",
        ],
        timeDimensions=[TimeDimension(
            dimension=f"{_COMMUNITY}.date",
            dateRange=[start_date, end_date],
        )],
        filters=filters,
        order={f"{_COMMUNITY}.engagement": "desc"},
        ungrouped=True,
        limit=10,
    )

    result = await read_cube_data(cube_client, transformer, query, language)
    elapsed = (time.perf_counter() - t0) * 1000
    rows = _extract_cube_rows(result)
    if not rows and result.get("code") not in (0, 2):
        logger.warning(f"【general_overview】Task2 社区热帖查询失败（{elapsed:.0f}ms）code={result.get('code')}")
        return []

    logger.info(f"【general_overview】Task2 社区热帖: {len(rows)} 条，耗时 {elapsed:.0f}ms")
    return rows


async def _query_comments_bq(
    game_ids: List[str],
    start_date: str,
    end_date: str,
    urls: List[str],
    language_code: Optional[List[str]],
) -> List[Dict]:
    """Task3: 查指定帖子下的高赞评论（feeds via BigQuery）"""
    if not urls:
        logger.warning("【general_overview】Task3 URLs 为空，跳过评论查询")
        return []

    config = get_bq_agent_config()
    if not config.get("bq_config"):
        logger.warning("【general_overview】BigQuery 未配置，跳过评论查询")
        return []

    sql = _build_comments_sql(game_ids, start_date, end_date, urls, language_code)
    if not sql:
        logger.warning("【general_overview】Task3 URL 列表为空，跳过")
        return []

    t0 = time.perf_counter()
    try:
        loop = asyncio.get_event_loop()
        rows = await loop.run_in_executor(
            None,
            lambda: execute_read_only_sql(
                sql,
                project_id=_BQ_PROJECT,
                max_rows=500,
                config=config,
            ),
        )
        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(f"【general_overview】Task3 BQ 评论: {len(rows)} 条，耗时 {elapsed:.0f}ms")
        return rows
    except Exception as e:
        elapsed = (time.perf_counter() - t0) * 1000
        # 评论查询失败不影响主流程，降级返回空
        logger.warning(f"【general_overview】Task3 BQ 查询失败（{elapsed:.0f}ms），忽略评论数据: {e}")
        return []


# ---- Main Orchestrator ----

async def execute_general_overview(
    context: RunContextWrapper[GameContext],
    game_names: List[str],
    game_ids: List[str],
    start_date: str,
    end_date: str,
    language_code: Optional[List[str]] = None,
    channel_code: Optional[List[str]] = None,
    is_official_account: Optional[bool] = None,
) -> str:
    """
    通用舆情全景链路（Strategy 2b）
    Step1+Step2 并发 → 官方主贴 + 社区热帖（Cube）
    Step3 → 基于 URL 查帖子高赞评论（BigQuery feeds 表）
    三路数据合并后返回给 LLM 综合分析

    is_official_account:
        None  → Task1 + Task2 均执行（默认全景）
        True  → 只执行 Task1（官方主贴），跳过 Task2
        False → 只执行 Task2（社区热帖），跳过 Task1
    """
    logger.info(
        f"【general_overview】开始执行，games={game_names}, "
        f"dates={start_date}~{end_date}, language={language_code}, "
        f"is_official_account={is_official_account}"
    )
    t_total = time.perf_counter()

    # Step 1+2: 按 is_official_account 决定执行哪些任务
    run_task1 = is_official_account is not False  # None 或 True 时执行
    run_task2 = is_official_account is not True   # None 或 False 时执行

    tasks = []
    if run_task1:
        tasks.append(_query_official_posts_cube(context, game_ids, start_date, end_date, language_code, channel_code))
    if run_task2:
        tasks.append(_query_community_posts_cube(context, game_ids, start_date, end_date, language_code, channel_code))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    idx = 0
    if run_task1:
        official_rows = results[idx] if not isinstance(results[idx], Exception) else []
        if isinstance(results[idx], Exception):
            logger.warning(f"【general_overview】Task1 异常: {results[idx]}")
        idx += 1
    else:
        official_rows = []

    if run_task2:
        community_rows = results[idx] if not isinstance(results[idx], Exception) else []
        if isinstance(results[idx], Exception):
            logger.warning(f"【general_overview】Task2 异常: {results[idx]}")
    else:
        community_rows = []

    logger.info(
        f"【general_overview】Step1+2 完成，耗时 {(time.perf_counter()-t_total)*1000:.0f}ms，"
        f"官方贴={len(official_rows)}，社区贴={len(community_rows)}"
    )

    # 两路均空 → 无数据，走网络搜索兜底
    if not official_rows and not community_rows:
        logger.warning(f"【general_overview】官方主贴和社区热帖均为空")
        raise NoResultException(
            message=f"未找到 {', '.join(game_names)} 的舆情数据，尝试联网搜索。",
            search_query=context.context.planner_context.rephrased_question,
            use_web_search=True,
        )

    # Step 3: 提取 URL → 查 BQ 评论
    all_urls = _extract_urls(official_rows, _OFFICIAL) + _extract_urls(community_rows, _COMMUNITY)
    comment_rows = await _query_comments_bq(game_ids, start_date, end_date, all_urls, language_code)

    logger.info(
        f"【general_overview】全部完成，总耗时 {(time.perf_counter()-t_total)*1000:.0f}ms，"
        f"官方贴={len(official_rows)}，社区贴={len(community_rows)}，评论={len(comment_rows)}"
    )

    # channel_code 规范化（如 youtube_keyword → youtube）
    _normalize_channel(official_rows, f"{_OFFICIAL}.channel_code")
    _normalize_channel(community_rows, f"{_COMMUNITY}.channel_code")

    # 组装返回结果
    language = getattr(context.context, "language", None) or "English"
    result = {
        "official_posts": official_rows,
        "community_posts": community_rows,
        "comments": comment_rows,
        "instruction": GENERAL_OVERVIEW_PROMPT_ZH if language == "Chinese" else GENERAL_OVERVIEW_PROMPT_EN,
    }
    return json.dumps(result, ensure_ascii=False)
