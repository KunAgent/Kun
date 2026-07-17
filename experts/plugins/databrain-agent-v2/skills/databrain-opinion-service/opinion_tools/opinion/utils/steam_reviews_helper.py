"""Standalone Steam reviews helper for opinion skill.

Extracted from tools/intelligence/intelligence_service/steam_reviews.py + steam_base.py
so that opinion skill no longer depends on the intelligence folder.
"""
import asyncio
import json
import logging
import requests
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor

import databrain.api

logger = logging.getLogger(__name__)


class SteamServiceError(Exception):
    pass


class SteamReviewsService:
    LANGS = {
        "english": "英文", "schinese": "简体中文", "tchinese": "繁体中文",
        "japanese": "日语", "koreana": "韩语", "russian": "俄语",
        "french": "法语", "german": "德语", "spanish": "西班牙语",
        "brazilian": "巴西葡萄牙语", "latam": "拉丁美洲西班牙语", "arabic": "阿拉伯语",
    }
    PRIORITY_LANGS = ["english", "schinese", "japanese", "koreana", "russian", "arabic"]

    def __init__(self, timeout: float = 1, max_workers: int = 10):
        self.timeout = timeout
        self.max_workers = max_workers

    async def _fetch_entity_info(self, entity_ids: List[str], message_id: str, token: str = None) -> Dict:
        response = await databrain.api.async_send_request(
            databrain.api.INTELLIGENCE_ENTITY_DETAIL_API,
            {"entity_type": "auto", "level": "custom", "ids": entity_ids, "custom_fields": ["steam_id", "entity_name"]},
            message_id=message_id, token=token,
        )
        response_json = response.json()
        if not response or not response_json.get("data"):
            return {}
        return response_json.get("data", {})

    def _build_steam_id_mapping(self, data_dict: Dict) -> Dict[int, List[str]]:
        steam_id_to_entity = {}
        for _, item in data_dict.items():
            steam_id = item.get("steam_id")
            entity_name = item.get("entity_name", "未知游戏")
            if steam_id and str(steam_id).strip() not in ("None", "none", "null", ""):
                try:
                    steam_id_int = int(steam_id)
                except (ValueError, TypeError):
                    continue
                steam_id_to_entity.setdefault(steam_id_int, []).append(entity_name)
        return steam_id_to_entity

    def _parse_summary(self, data: dict, lang: str) -> Dict:
        s = data.get("query_summary", {}) or {}
        total_reviews = s.get("total_reviews")
        total_positive = s.get("total_positive")
        return {
            "lang_code": lang,
            "lang_name": "全部" if lang == "all" else self.LANGS.get(lang, lang),
            "total_reviews": total_reviews,
            "total_positive": total_positive,
            "total_negative": s.get("total_negative"),
            "review_score": s.get("review_score"),
            "review_score_desc": s.get("review_score_desc"),
            "review_percent": round(total_positive * 100.0 / total_reviews, 2) if total_reviews else None,
        }

    def _fetch_single(self, appid: int, lang: str) -> Dict:
        url = f"https://store.steampowered.com/appreviews/{appid}"
        params = {"json": 1, "language": lang, "num_per_page": 0, "filter": "all", "review_type": "all", "purchase_type": "steam"}
        try:
            headers = {"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"}
            resp = requests.get(url, params=params, timeout=self.timeout, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            if not data:
                return {"steam_id": appid, "error": "API返回空数据"}
            return self._parse_summary(data, lang)
        except requests.exceptions.Timeout:
            return {"steam_id": appid, "error": f"请求超时 (appid={appid})"}
        except Exception as e:
            return {"steam_id": appid, "error": str(e)}

    def fetch_reviews(self, appid: int, entity_name: str = "") -> List[Dict]:
        languages = ["all"] + self.PRIORITY_LANGS
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = [executor.submit(self._fetch_single, appid, lang) for lang in languages]
            results = [f.result() for f in futures]
        for r in results:
            if entity_name:
                r["entity_name"] = entity_name
        return results

    async def fetch_reviews_by_entity_ids(self, entity_ids: List[str], message_id: str = "", token: str = None) -> List[Dict]:
        if not entity_ids:
            raise SteamServiceError("entity_ids不能为空")
        data_dict = await self._fetch_entity_info(entity_ids, message_id, token)
        if not data_dict:
            return []
        steam_id_to_entity = self._build_steam_id_mapping(data_dict)
        if not steam_id_to_entity:
            return []
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            tasks = [
                loop.run_in_executor(executor, self.fetch_reviews, steam_id, names[0])
                for steam_id, names in steam_id_to_entity.items()
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
        final = []
        for r in results:
            if isinstance(r, Exception):
                final.append({"error": str(r)})
            elif isinstance(r, list):
                final.extend(r)
            else:
                final.append(r)
        return final


async def get_steam_reviews(game_ids: List[str], message_id: str, token: Optional[str] = None) -> Dict[str, Any]:
    """获取Steam游戏评价数据（独立函数，替代 MetricsService._get_steam_reviews）"""
    try:
        service = SteamReviewsService()
        reviews_data = await service.fetch_reviews_by_entity_ids(entity_ids=game_ids, message_id=message_id, token=token)
        return {"code": 0, "msg": "success", "no_reference": True, "data": {"data": reviews_data}, "source": ["steam_reviews"]}
    except Exception as e:
        logger.error(f"获取Steam评价数据失败: {e}")
        return {"code": -1, "msg": f"Steam评价查询失败: {e}", "data": {"data": []}, "source": ["steam_reviews"]}
