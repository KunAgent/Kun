"""Standalone entity-linking module for the databrain-dashboard skill.

Adapted from common/databrain/entity_linking.py so this skill can run
independently without the react agent's entity linking infrastructure.

Context arg only needs `.token` and `.message_id` — duck-typed.
"""
import re
import string
import time
import traceback
from typing import Any, Awaitable, Dict, List, Tuple

from loguru import logger
from pydantic import BaseModel

from dashboard_common.config import globalvar as gl
from databrain.api import (
    DASHBOARD_GAME_DETAIL_API,
    GAME_SEARCH_API,
    ALL_STUDIO_PROJECT_API,
    INTELLIGENCE_GET_GAME_GENRES_API,
    async_send_request_with_token,
)
from dashboard_data.roblox_game_lists import ROBLOX_LISTS

# 10 minute cache TTL (seconds)
_STUDIO_PROJECT_CACHE_TTL = 10 * 60
_GAME_GENRES_CACHE_TTL = 10 * 60

_studio_project_cache: Dict = None  # {"data": dict, "ts": float}
_game_genres_cache: Dict = None  # {"data": list, "ts": float}


class EntityNames(BaseModel):
    standard_name: str
    english_name: str
    original_name: str
    type: str = ""

    _entity_name: str = ""
    _entity: dict = {}


def get_fixed_entities(entity_names_list: List[EntityNames]):
    config_entities = gl.get_value("rb_strategy_json", expected_type=dict).get("entities", [])
    for entity_names in entity_names_list:
        name = entity_names.original_name
        for entity in config_entities:
            if name.lower() in entity.get("names", []):
                entity_names._entity = entity.get("data", {})
                entity_names._entity_name = entity["data"]["list"][0].get("entity_name", "")
                break


def _is_roblox_game(entity_names: EntityNames) -> bool:
    is_roblox = any([
        entity_names.original_name.lower() in ROBLOX_LISTS,
        entity_names.standard_name.lower() in ROBLOX_LISTS,
        entity_names.english_name.lower() in ROBLOX_LISTS
    ])
    if is_roblox:
        logger.info(f"Item {entity_names} is a Roblox game, skip entity linking")
    return is_roblox


def separate_roblox_entities(entity_names_list: List[EntityNames]) -> Tuple[List[EntityNames], List[EntityNames]]:
    roblox_entities = []
    filtered_entity_names = []
    for entity_names in entity_names_list:
        if _is_roblox_game(entity_names):
            roblox_entities.append(entity_names)
        else:
            filtered_entity_names.append(entity_names)
    return roblox_entities, filtered_entity_names


def _remove_common_suffixes(name: str) -> str:
    if not name:
        return name
    common_suffixes = ["国服", "国际服", "台服", "日服", "韩服", "美服", "欧服", "亚服", "全球服"]
    for suffix in common_suffixes:
        if name.endswith(suffix):
            name = name[:-len(suffix)]
            break
    return name.strip()


def _create_cleaned_entity(ner_entity: Dict[str, str]) -> Dict[str, str]:
    original_name = ner_entity.get("original_name", "")
    standard_name = ner_entity.get("standard_name", "")
    english_name = ner_entity.get("english_name", "")
    cleaned_original = _remove_common_suffixes(original_name)
    cleaned_standard = _remove_common_suffixes(standard_name) if standard_name else standard_name
    if cleaned_original != original_name or cleaned_standard != standard_name:
        return {
            "original_name": cleaned_original,
            "standard_name": cleaned_standard,
            "english_name": english_name
        }
    return None


def game_entity_linking_json(context: Any, ner_entity_names_json: List[Dict[str, str]], threshold: float = 0.75) -> Awaitable[Tuple[List[str], List[str], List[Dict[str, any]], bool]]:
    ner_entity_names = [EntityNames(**entity_names) for entity_names in ner_entity_names_json]
    return game_entity_linking(context, ner_entity_names, threshold=threshold)


def company_entity_linking_json(context: Any, ner_entity_names_json: List[Dict[str, str]], threshold: float = 0.75) -> Awaitable[Tuple[List[str], List[str], List[Dict[str, any]], bool]]:
    ner_entity_names = [EntityNames(**entity_names) for entity_names in ner_entity_names_json]
    return company_entity_linking(context, ner_entity_names, threshold=threshold)


async def game_entity_linking(context: Any, ner_entity_names: List[EntityNames], threshold: float = 0.75) -> Awaitable[Tuple[List[str], List[str], List[Dict[str, any]], List[Dict[str, any]]]]:
    ner_entity_names, roblox_entities = await entity_linking(context, ner_entity_names, "pc,console,mobile", threshold=threshold)
    entities = [entity_names._entity for entity_names in ner_entity_names if len(entity_names._entity.get("list") or []) > 0]
    entity_names = [entity_name for entity_list in entities if (entity_name := entity_list["list"][0].get("entity_name"))]
    ner_entity_names_json = [entity_names.model_dump() for entity_names in ner_entity_names]
    roblox_entities_json = [entity_names.model_dump() for entity_names in roblox_entities]
    return ner_entity_names_json, entity_names, entities, roblox_entities_json


async def company_entity_linking(context: Any, ner_entity_names: List[EntityNames], threshold: float = 0.75) -> Awaitable[Tuple[List[str], List[str], List[Dict[str, any]], List[Dict[str, any]]]]:
    ner_entity_names, roblox_entities = await entity_linking(context, ner_entity_names, "company", threshold=threshold)
    entities = [entity_names._entity for entity_names in ner_entity_names if len(entity_names._entity.get("list") or []) > 0]
    entity_names = [entity_name for entity_list in entities if (entity_name := entity_list["list"][0].get("entity_name"))]
    ner_entity_names_json = [entity_names.model_dump() for entity_names in ner_entity_names]
    roblox_entities_json = [entity_names.model_dump() for entity_names in roblox_entities]
    return ner_entity_names_json, entity_names, entities, roblox_entities_json


async def entity_linking(context: Any, ner_entity_names: List[EntityNames], entity_type: str, threshold: float = 0.75) -> Tuple[List[EntityNames], List[EntityNames]]:
    roblox_entities, ner_entity_names = separate_roblox_entities(ner_entity_names)
    get_fixed_entities(ner_entity_names)
    unmatched_entity_names = [entity_names for entity_names in ner_entity_names if len(entity_names._entity) == 0]
    if len(unmatched_entity_names) == 0:
        return ner_entity_names, roblox_entities
    await entity_linking_api(context, unmatched_entity_names, entity_type, threshold=threshold)

    for entity_names in ner_entity_names:
        if entity_names._entity_name == "":
            logger.warning("entity_linking empty, {}".format(entity_names))
        else:
            game_id = ""
            if len(entity_data := entity_names._entity.get("list") or []) > 0:
                game_id = entity_data[0].get("game_id", "")
            logger.info("entity {}, entity_name {}, game_id {}".format(entity_names.original_name, entity_names._entity_name, game_id))
    return ner_entity_names, roblox_entities


# PC/Console Demo uses Dashboard API, not GAME_SEARCH_API
PC_CONSOLE_DEMO_ORIGINAL_NAME = "PC/Console Demo"


def _pc_console_demo_query_names(entity_names: "EntityNames") -> List[str]:
    def _norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", (s or "").strip().lower())

    candidates = [
        getattr(entity_names, "original_name", ""),
        getattr(entity_names, "standard_name", ""),
        getattr(entity_names, "english_name", ""),
    ]
    keys = [_norm(x) for x in candidates if isinstance(x, str) and x.strip()]
    hit = any(("demo" in k and ("pc" in k or "console" in k)) for k in keys)
    if not hit:
        return []
    return [PC_CONSOLE_DEMO_ORIGINAL_NAME]


def _dashboard_detail_to_entity_list(detail_data: List[Dict]) -> List[Dict]:
    entity_list: List[Dict] = []
    for item in detail_data or []:
        if not isinstance(item, dict):
            continue
        game_name = item.get("game_name", "") or ""
        dashboard = item.get("dashboard") or {}
        if not isinstance(dashboard, dict):
            dashboard = {}
        game_code = dashboard.get("game_code", "") or game_name
        game_type = (dashboard.get("game_type") or "").lower()
        dashboard_info = dashboard
        has_permission = bool(dashboard_info.get("has_permission", False))
        dashboard_status = 2 if (game_code and has_permission) else (1 if game_code else 0)
        entity_list.append(
            {
                "game_id": game_code,
                "entity_id": "",
                "entity_name": game_name,
                "entity_type": game_type,
                "similarity": 1.0,
                "combine_id": "",
                "pc_id": "",
                "mobile_id": "",
                "console_id": "",
                "opinion": 0,
                "opinion_info": None,
                "pc_opinion": 0,
                "pc_opinion_info": None,
                "console_opinion": 0,
                "console_opinion_info": None,
                "mobile_opinion": 0,
                "mobile_opinion_info": None,
                "dashboard": dashboard_status,
                "dashboard_info": dashboard_info,
                "pc_dashboard": dashboard_status,
                "pc_dashboard_info": dashboard_info,
            }
        )
    return entity_list


async def entity_linking_api(context: Any, ner_entity_names: List[EntityNames], entity_type: str, threshold: float = 0.75):
    try:
        pc_demo_entities = [e for e in ner_entity_names if _pc_console_demo_query_names(e)]
        other_entities = [e for e in ner_entity_names if not _pc_console_demo_query_names(e)]
        ner_entity_names_dict = {e.original_name: e for e in ner_entity_names}

        rsp_entities: List[Dict] = []

        if other_entities:
            multi_keywords = [{
                "original_name": e.original_name,
                "standard_name": e.standard_name,
                "english_name": e.english_name,
            } for e in other_entities]
            data = {
                "multi_keywords": multi_keywords,
                "entity_type": entity_type,
                "system": "dashboard",
                "top": 1,
            }
            logger.info("entity_linking req: {}".format(data))
            rsp = await async_send_request_with_token(GAME_SEARCH_API, data, context.token, tries=2, message_id=context.message_id)
            if rsp is not None:
                rsp_json = rsp.json()
                rsp_entities = rsp_json.get("data") or []

        for entity_names in pc_demo_entities:
            try:
                game_names_to_query = _pc_console_demo_query_names(entity_names)
                detail_data = {"game_names": game_names_to_query, "entity_type": ["pc", "console"]}
                rsp_dashboard = await async_send_request_with_token(
                    DASHBOARD_GAME_DETAIL_API, detail_data, context.token, tries=2, message_id=context.message_id
                )
                if rsp_dashboard is None:
                    logger.warning("entity_linking DASHBOARD_GAME_DETAIL_API response is None for PC/Console Demo")
                    continue
                detail_json = rsp_dashboard.json()
                if detail_json.get("code", -1) != 0:
                    logger.warning("entity_linking DASHBOARD_GAME_DETAIL_API code != 0: {}".format(detail_json))
                    continue
                detail_list = detail_json.get("data") or []
                entity_list = _dashboard_detail_to_entity_list(detail_list)
                if not entity_list:
                    continue
                pseudo_entity = {
                    "multi_keyword": {
                        "original_name": entity_names.original_name,
                        "standard_name": entity_names.standard_name,
                        "english_name": entity_names.english_name,
                    },
                    "list": entity_list,
                }
                rsp_entities.append(pseudo_entity)
                logger.info("entity_linking PC/Console Demo filled from DASHBOARD_GAME_DETAIL_API, list len={}".format(len(entity_list)))
            except Exception as e:
                logger.warning("entity_linking DASHBOARD_GAME_DETAIL_API error for PC/Console Demo: {}".format(e))

        for entity in rsp_entities:
            if entity is None:
                continue
            entity_list = []
            for entry in entity.get("list", []):
                logger.info("found game_id {}".format(entry.get("game_id", "")))
                similarity = entry.get("similarity", 0)
                if similarity >= threshold:
                    entity_list.append(entry)
                else:
                    logger.warning("[low_similarity {}] {}".format(similarity, entry))
            entity["list"] = entity_list
            entity_names = ner_entity_names_dict[entity["multi_keyword"]["original_name"]]
            logger.info(entity_names)
            entity_names._entity = entity
            if len(entity["list"]) > 0:
                entity_names._entity_name = entity["list"][0].get("entity_name", "")

    except:
        logger.error("entity_linking error: {}".format(traceback.format_exc()))


async def fetch_all_studio_project(token: str, message_id: str = "") -> Dict:
    global _studio_project_cache
    if not token:
        return {}
    now = time.time()
    if _studio_project_cache is not None:
        if now - _studio_project_cache.get("ts", 0) < _STUDIO_PROJECT_CACHE_TTL:
            return _studio_project_cache.get("data") or {}
    try:
        rsp = await async_send_request_with_token(
            ALL_STUDIO_PROJECT_API, {}, token, method="POST", message_id=message_id, tries=2
        )
        if rsp is None:
            logger.warning("fetch_all_studio_project failed: response is None")
            return {}
        rsp_json = rsp.json()
        if rsp_json.get("code") != 0:
            logger.warning("fetch_all_studio_project failed: code={}".format(rsp_json.get("code")))
            return {}
        raw = rsp_json.get("data") or {}
        data = {
            "studio": [
                {"studio": s.get("studio"), "other_name": s.get("other_name") or []}
                for s in (raw.get("studio") or [])
                if s.get("studio")
            ],
            "project": [
                {"name": p.get("name"), "other_name": p.get("other_name") or []}
                for p in (raw.get("project") or [])
                if p.get("name") and p.get("name") != "其他" and p.get("other_name") != "其他"
            ],
        }
        _studio_project_cache = {"data": data, "ts": time.time()}
        return data
    except Exception:
        logger.warning("fetch_all_studio_project error: {}".format(traceback.format_exc()))
        return {}


async def fetch_game_genres(token: str, message_id: str = "") -> List[str]:
    global _game_genres_cache
    if not token:
        return []
    now = time.time()
    if _game_genres_cache is not None:
        if now - _game_genres_cache.get("ts", 0) < _GAME_GENRES_CACHE_TTL:
            return _game_genres_cache.get("data") or []
    try:
        _GAME_GENRES_REQUEST = {
            "source": ["iegg", "app_magic"],
            "entity_type": ["pc", "console", "mobile"],
        }
        rsp = await async_send_request_with_token(
            INTELLIGENCE_GET_GAME_GENRES_API,
            _GAME_GENRES_REQUEST,
            token,
            method="POST",
            message_id=message_id,
            tries=2,
        )
        if rsp is None:
            logger.warning("fetch_game_genres failed: response is None")
            return []
        rsp_json = rsp.json()
        if rsp_json.get("code") != 0:
            logger.warning("fetch_game_genres failed: code={}".format(rsp_json.get("code")))
            return []
        data = rsp_json.get("data") or {}
        names = set()
        for _et, by_source in data.items():
            if not isinstance(by_source, dict):
                continue
            for _src, items in by_source.items():
                if not isinstance(items, list):
                    continue
                for item in items:
                    main = item.get("main_genre") or {}
                    for key in ("genre", "genre_cn", "genre_en"):
                        if main.get(key):
                            names.add(main.get(key).strip())
                    for sub in item.get("sub_genre") or []:
                        for key in ("genre", "genre_cn", "genre_en"):
                            if sub.get(key):
                                names.add(sub.get(key).strip())
        result = [n for n in names if n]
        result_set = set(result)
        for n in list(result_set):
            cleaned = n
            for p in string.punctuation:
                cleaned = cleaned.replace(p, "")
            cleaned = cleaned.strip()
            if cleaned and cleaned != n:
                result_set.add(cleaned)
        result = [x for x in result_set if x]
        _game_genres_cache = {"data": result, "ts": time.time()}
        return result
    except Exception:
        logger.warning("fetch_game_genres error: {}".format(traceback.format_exc()))
        return []


def get_ner_rules(
    rule_type: str,
    user_input: str,
    entity_list: Dict = None,
    genre_list: List[str] = None,
    **kwargs,
) -> str:
    rules = gl.get_value("rb_strategy_json", expected_type=dict).get("agent_rules", {}).get("Game Entity", [])
    user_input_lower = user_input.lower()
    output: List[str] = []
    for rule in rules:
        if any(substr.lower() in user_input_lower for substr in rule.get("contains", []) if substr != ""):
            output.append(rule.get(rule_type, "").format(agent_name="Game Entity", **kwargs))

    if entity_list and rule_type == "prompt":
        studios = entity_list.get("studio") or []
        projects = entity_list.get("project") or []
        for s in studios:
            names_to_check = [s.get("studio")] + list(s.get("other_name") or [])
            names_to_check = [n for n in names_to_check if n and n.strip()]
            for name in names_to_check:
                if name.lower() in user_input_lower:
                    hit_name = s.get("studio")
                    output.append(f"- if user ask for studio {name} data, it is a company entity, use {hit_name} as the standard name.")
                    break
        for p in projects:
            names_to_check = [p.get("name")] + list(p.get("other_name") or [])
            names_to_check = [n for n in names_to_check if n and n.strip()]
            for name in names_to_check:
                if name.lower() in user_input_lower:
                    hit_name = p.get("name")
                    output.append(f"- if user ask for project {name} data, it is a game entity, use {hit_name} as the standard name.")
                    break

    if rule_type == "prompt" and genre_list:
        for genre_name in genre_list:
            if not genre_name or not genre_name.strip():
                continue
            if genre_name.lower() in user_input_lower:
                hit_genre = genre_name.strip()
                output.append(
                    "- {hit_genre} is a game Genre.".format(hit_genre=hit_genre)
                )
    return "\n".join(output)
