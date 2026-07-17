"""
舆情关键词分析报告跳转卡片创建模块

职责：
  1. 调用 agent_summary/create 接口，获取 short_url（shortid）
  2. 根据用户输入语言拼接多语种展示文案
  3. 将卡片数据写入 context.opinion_report_card，供后续 artifact 输出到前端

卡片触发场景：get_opinion_analysis_by_topic 工具执行成功后

语言字段说明（两者用途完全不同，请勿混淆）：
  - context.context.language：用户当轮输入的语言（pycountry 语言全名，如 "Chinese"、"Japanese"）。
    用于决定 displaytext / button_text 用什么语言展示给用户，与内容查询语言无关。
    默认值 "the same language as the user's input" 表示尚未检测；此时回退到 system_language。
  - language_code（validated_language_code）：用户要求的话题内容语言（ISO 639-1 代码列表，如 ["ja"]）。
    仅透传给 agent_summary/create 接口的 language 字段，用于筛选报告内容语言，与界面文案无关。
    例：用户用中文问"pubgm 日语讨论中的性能问题" → language="Chinese"，language_code=["ja"]，
    界面文案显示中文，但报告内容筛选日语。
"""

import uuid
from typing import List, Optional
from urllib.parse import parse_qs, urlparse

from run_context_wrapper import RunContextWrapper
from loguru import logger

import databrain.api
from opinion_strategy.context import GameContext
from opinion_tools.opinion.data.channel_map import CHANNEL_TYPE_MAP

# 前端识别卡片类型的固定字符串，需与前端保持一致
CARD_TYPE = "opinion_report_card"

# 多语种展示文案（界面文案），key 为内部语言标识
# 显示语言由 context.context.language（用户输入语言）决定，与内容筛选语言 language_code 无关
_CARD_TEXTS: dict = {
    "zh": {
        "display_text": "全量精细分析，可前往关键词分析功能页",
        "button_text": "查看分析报告",
    },
    "en": {
        "display_text": "For comprehensive and detailed analysis, visit the Keyword Analysis page",
        "button_text": "View Analysis Report",
    },
    "ja": {
        "display_text": "全量の詳細分析は、キーワード分析ページをご覧ください",
        "button_text": "分析レポートを見る",
    },
    "ko": {
        "display_text": "전체 정밀 분석은 키워드 분석 기능 페이지를 방문하세요",
        "button_text": "분석 보고서 보기",
    },
    "ru": {
        "display_text": "Для полного и детального анализа перейдите на страницу анализа ключевых слов",
        "button_text": "Просмотреть отчёт",
    },
    "de": {
        "display_text": "Für eine umfassende und detaillierte Analyse besuchen Sie die Keyword-Analyse-Seite",
        "button_text": "Bericht ansehen",
    },
    "fr": {
        "display_text": "Pour une analyse complète et détaillée, accédez à la page d'analyse des mots-clés",
        "button_text": "Voir le rapport",
    },
    "tr": {
        "display_text": "Kapsamlı ve ayrıntılı analiz için Anahtar Kelime Analizi sayfasını ziyaret edin",
        "button_text": "Raporu görüntüle",
    },
}

# context.context.language（pycountry 语言全名） → _CARD_TEXTS 内部 key
# pycountry 返回的 name 通常首字母大写，此处 key 统一转小写后匹配
_LANGUAGE_NAME_TO_TEXT_KEY: dict = {
    "chinese": "zh",
    "simplified chinese": "zh",
    "traditional chinese": "zh",
    "english": "en",
    "japanese": "ja",
    "korean": "ko",
    "russian": "ru",
    "german": "de",
    "french": "fr",
    "turkish": "tr",
}

# system_language（前端传入，如 "zh-CN"、"en-US"） → _CARD_TEXTS 内部 key（备用回退）
_SYSTEM_LANGUAGE_TO_TEXT_KEY: dict = {
    "zh-CN": "zh",
    "en-US": "en",
}

# tool 的 channel_category 值 → API 的 channel_type 值（仅在无具体渠道时使用）
_CHANNEL_CATEGORY_TO_API_TYPE: dict = {
    "social": "social",
    "game_store": "comments",
}

# CHANNEL_TYPE_MAP 值 → API 字段名
_CHANNEL_TYPE_TO_FIELD: dict = {
    "social": "channel_social",
    "comments": "channel_comments",
    "news": "channel_news",
}


def _split_channels_by_type(channels: List[str]) -> dict:
    """
    将渠道列表按 CHANNEL_TYPE_MAP 拆分为 channel_social / channel_comments / channel_news。
    未知类型渠道默认归入 channel_social。
    """
    buckets: dict = {}
    for ch in channels:
        ch_lower = ch.lower()
        ch_type = CHANNEL_TYPE_MAP.get(ch_lower, "social")  # 未知渠道默认 social
        field = _CHANNEL_TYPE_TO_FIELD.get(ch_type, "channel_social")
        buckets.setdefault(field, []).append(ch_lower)
    return buckets

# 地区名称/别名 → (region_type, [region_codes])
# region_type: "market"（国家级）或 "region"（大区级）
_REGION_NAME_MAP: dict = {
    # 北美
    "northamerica": ("region", ["NA"]),
    "na": ("region", ["NA"]),
    "北美": ("region", ["NA"]),
    "北美区": ("region", ["NA"]),
    "北美地区": ("region", ["NA"]),
    # 拉丁美洲
    "latinamerica": ("region", ["LATAM"]),
    "latam": ("region", ["LATAM"]),
    "拉丁美洲": ("region", ["LATAM"]),
    "拉美": ("region", ["LATAM"]),
    "拉美区": ("region", ["LATAM"]),
    # 欧洲
    "europe": ("region", ["EU"]),
    "eu": ("region", ["EU"]),
    "欧洲": ("region", ["EU"]),
    "欧洲地区": ("region", ["EU"]),
    # 东南亚
    "southeastasia": ("region", ["SEA"]),
    "sea": ("region", ["SEA"]),
    "东南亚": ("region", ["SEA"]),
    "东南亚地区": ("region", ["SEA"]),
    # 中东
    "middleeast": ("region", ["ME"]),
    "me": ("region", ["ME"]),
    "中东": ("region", ["ME"]),
    "中东地区": ("region", ["ME"]),
    # 亚太
    "apac": ("region", ["APAC"]),
    "asiapacific": ("region", ["APAC"]),
    "亚太": ("region", ["APAC"]),
    "亚太区": ("region", ["APAC"]),
}

def _resolve_region(
    region: Optional[List[str]],
    region_type: Optional[str] = None,
) -> tuple[Optional[str], Optional[List[str]]]:
    """
    将工具层的 region 参数转换为 API 需要的 (region_type, region_codes)。

    规则：
    - 若 region 包含已知地区名（如 "北美区"），查映射表获取 region_type
    - 若 region 为纯 2 字母大写（ISO-2 国家码），默认 region_type="market"
    - 否则默认 region_type="region"
    """
    if not region:
        return None, None

    resolved_codes: List[str] = []
    resolved_type: Optional[str] = None

    for r in region:
        key = r.strip().lower().replace(" ", "").replace("_", "").replace("-", "")
        if key in _REGION_NAME_MAP:
            rt, codes = _REGION_NAME_MAP[key]
            resolved_codes.extend(codes)
            if not resolved_type:
                resolved_type = rt
        else:
            # 原样保留（如 "US", "JP" 等 ISO 国家码）
            resolved_codes.append(r.strip())
            if not resolved_type:
                # 全部为 2 字母大写则推断为 market
                if all(len(c.strip()) == 2 and c.strip().isupper() for c in region):
                    resolved_type = "market"
                else:
                    resolved_type = "region"

    return resolved_type or "market", resolved_codes if resolved_codes else None


class OpinionReportCardCreator:
    """
    舆情关键词分析报告跳转卡片创建器

    使用方式（在 topic_analysis_tool 内调用）：
        creator = OpinionReportCardCreator()
        await creator.create_and_store_cards(context, game_names, game_ids, topics, ...)
    """

    def _get_display_texts(self, user_language: str, system_language: str = "") -> dict:
        """
        返回界面展示文案，优先级：
          1. user_language（context.context.language，pycountry 语言全名，如 "Chinese"）
          2. system_language（context.context.system_language，如 "zh-CN"），当 user_language 为默认值时使用
          3. 回退到英文

        注意：此处的语言仅控制界面文案（displaytext / button_text），
              与内容查询语言 language_code 完全无关。
        """
        # 尝试 user_language（pycountry 全名，不区分大小写）
        text_key = _LANGUAGE_NAME_TO_TEXT_KEY.get(user_language.lower())
        if text_key:
            return _CARD_TEXTS[text_key]

        # user_language 为默认值或未命中时，尝试 system_language
        text_key = _SYSTEM_LANGUAGE_TO_TEXT_KEY.get(system_language)
        if text_key:
            return _CARD_TEXTS[text_key]

        # 最终回退：英文
        return _CARD_TEXTS["en"]

    async def _call_agent_summary_create(
        self,
        token: str,
        message_id: str,
        game_id: str,
        entity_type: str,
        start_date: str,
        end_date: str,
        language_code: Optional[List[str]],
        channel_code: Optional[List[str]],
        channel_category: Optional[str],
        topics: List[str],
        region: Optional[List[str]] = None,
    ) -> Optional[dict]:
        """
        调用 agent_summary/create 接口，返回 {"short_url": ..., "opinion_path": ...}。
        任何错误均记录日志后返回 None（卡片为非核心功能，不影响主流程）。

        字段覆盖情况：
          ✅ message_id / edition_unified_id / id_type / entity_type
          ✅ date_type / start_time / end_time
          ✅ language（来自 language_code，内容语言过滤）
          ✅ channel / channel_type（来自 channel_code / channel_category）
          ✅ keyword_input（来自 topics，用 | 拼接；不发 topic 字段，避免预定义话题标签混入）
          ✅ region_type / region（来自工具层新增的 region 参数，经 _resolve_region 展开）
        """
        payload: dict = {
            "message_id": message_id,
            "edition_unified_id": game_id,
            # mobile 使用 unified_id，pc/console 使用 edition_id（与 opinion_summary_service 保持一致）
            "id_type": "unified_id" if entity_type == "mobile" else "edition_id",
            "date_type": "daily",
            "start_time": f"{start_date} 00:00:00",
            "end_time": f"{end_date} 23:59:59",
        }

        if entity_type:
            payload["entity_type"] = entity_type
        if language_code:
            # 内容语言过滤，与界面文案语言无关
            payload["language"] = language_code
        if channel_code:
            # 按渠道类型拆分为 channel_social / channel_comments / channel_news
            for field, codes in _split_channels_by_type(channel_code).items():
                payload[field] = codes
        elif channel_category:
            # 无具体渠道时用 channel_type 传大类（报告页按大类预填）
            payload["channel_type"] = _CHANNEL_CATEGORY_TO_API_TYPE.get(
                channel_category, channel_category
            )
        if topics:
            # 不传 topic（API 的 topic 字段用于预定义话题标签如 gameplay/update，不适合用户关键词）
            # 用 keyword_input 传递关键词，多个关键词用 ";" 拼接（OR 关系）
            payload["keyword_input"] = ";".join(topics)
        # 地区过滤，region_type 由 _resolve_region 自动推断
        resolved_region_type, resolved_region = _resolve_region(region, None)
        if resolved_region:
            payload["region_type"] = resolved_region_type
            payload["region"] = resolved_region

        try:
            resp = await databrain.api.async_send_request(
                databrain.api.OPINION_AGENT_SUMMARY_CREATE_API,
                payload,
                token=token,
                message_id=message_id or "",
            )
            if resp is None:
                logger.warning("【OpinionReportCard】agent_summary/create 返回 None")
                return None

            data = resp.json()
            if data.get("code") != 0:
                logger.warning(f"【OpinionReportCard】agent_summary/create 业务错误: {data}")
                return None

            opinion_path = data.get("data", {}).get("opinion_path", "")
            params = parse_qs(urlparse(opinion_path).query)
            short_url = params.get("shortid", [""])[0]
            if not short_url:
                logger.warning(
                    f"【OpinionReportCard】shortid 未在 opinion_path 中找到: {opinion_path}"
                )
                return None

            logger.info(f"【OpinionReportCard】获取成功: short_url={short_url}, opinion_path={opinion_path}")
            return {"short_url": short_url, "opinion_path": opinion_path}

        except Exception as e:
            logger.warning(f"【OpinionReportCard】agent_summary/create 调用异常: {e}")
            return None

    async def create_and_store_cards(
        self,
        context: RunContextWrapper[GameContext],
        game_names: List[str],
        game_ids: List[str],
        topics: List[str],
        start_date: str,
        end_date: str,
        language_code: Optional[List[str]] = None,
        channel_code: Optional[List[str]] = None,
        channel_category: Optional[str] = None,
        region: Optional[List[str]] = None,
    ) -> None:
        """
        为每个游戏创建关键词分析报告卡片并写入 context.opinion_report_card

        Args:
            context:          运行上下文
            game_names:       游戏名称列表（与 game_ids 一一对应，用于从 game_info_dict 取 entity_type）
            game_ids:         游戏 ID 列表（_ensure_game_ids 的返回值）
            topics:           话题/关键词列表（传入 API 的 topic + keyword_input）
            start_date:       开始日期，格式 YYYY-MM-DD
            end_date:         结束日期，格式 YYYY-MM-DD
            language_code:    语言过滤（工具层已验证），透传给 API
            channel_code:     渠道过滤（工具层已验证），透传给 API
            channel_category: 渠道类别（"social" 或 "game_store"），映射后传给 API channel_type
        """
        token = context.context.token
        if not token:
            logger.warning("【OpinionReportCard】token 为空，跳过卡片创建")
            return

        message_id = context.context.message_id or ""
        # user_language：用户输入语言（pycountry 全名），决定界面文案语言
        # system_language：前端语言设置，作为 user_language 未命中时的备用
        user_language = context.context.language or ""
        system_language = context.context.system_language or ""
        texts = self._get_display_texts(user_language, system_language)

        for game_name, game_id in zip(game_names, game_ids):
            # entity_type 从已缓存的游戏信息中取；取不到时留空（API 该字段可选）
            game_info = context.context.game_info_dict.get(game_name, {})
            entity_type = game_info.get("entity_type", "")

            result = await self._call_agent_summary_create(
                token=token,
                message_id=message_id,
                game_id=game_id,
                entity_type=entity_type,
                start_date=start_date,
                end_date=end_date,
                language_code=language_code,
                channel_code=channel_code,
                channel_category=channel_category,
                topics=topics,
                region=region,
            )
            if not result:
                # API 调用失败时跳过该游戏的卡片，不影响其他游戏和主流程
                continue

            card_data = {
                "type": CARD_TYPE,
                "short_url": result["short_url"],
                # opinion_path 原始路径，前端可直接使用（含 gameid 和 shortid）
                "opinion_path": result["opinion_path"],
                "message_id": message_id,
                "display_text": texts["display_text"],
                "button_text": texts["button_text"],
            }
            context.context.opinion_report_card.append(card_data)
            logger.info(
                f"【OpinionReportCard】卡片创建成功: game={game_name}, short_url={result['short_url']}"
            )
