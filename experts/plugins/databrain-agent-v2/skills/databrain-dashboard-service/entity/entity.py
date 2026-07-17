"""Standalone Entity Linking + Dashboard permission resolution.

No LLM calls. Game names are passed directly, linked via search API,
then dashboard permissions are resolved.
"""
from loguru import logger
import traceback
from typing import Dict, List, Tuple

from dashboard_common.cls import log_metrics
from databrain.api import (
    ENTITY_DETAIL_API,
    DASHBOARD_PC_ENABLE_GAME_LIST_API,
    async_send_request_with_token,
)
from entity.entity_linking import (
    EntityNames,
    game_entity_linking,
)
from dashboard_strategy.context import AgentContext


def _token_fingerprint(token: str) -> str:
    if not token:
        return "empty"
    token = str(token)
    if len(token) <= 10:
        return f"{token[:2]}***{token[-2:]}(len={len(token)})"
    return f"{token[:6]}...{token[-4:]}(len={len(token)})"


async def get_entity_names_simple(game_names: List[str]) -> List[EntityNames]:
    """Create EntityNames directly from a list of game name strings (no LLM)."""
    entity_names_list = []
    for name in game_names:
        entity_names_list.append(EntityNames(
            original_name=name,
            standard_name=name,
            english_name=name,
            type="game",
        ))
    return entity_names_list


async def query_dashboard_game_detail_v2(context: AgentContext) -> Tuple[Dict, Dict]:
    """Extract dashboard permission info from context.entities (white_games / black_games / error_games)."""
    from dashboard_strategy.constants import DashboardType

    try:
        assert context.entities, "AgentContext.entities is required"
        assert context.game_names, "AgentContext.game_names is required"

        results: Dict = {}
        has_dashboard_data: Dict = {"white_games": [], "black_games": [], "error_games": [], "retrieved_data_games": []}
        key_country: Dict = {}
        game_icon_mapping: Dict = {}

        for game_name in context.game_names:
            game_entity = None
            for e in context.entities:
                if (e.get("keyword", "") == game_name
                        or e.get("list", [{}])[0].get("game_name", "") == game_name
                        or e.get("list", [{}])[0].get("entity_name", "") == game_name):
                    game_entity = e.get("list", [{}])[0]
                    break
            if not game_entity:
                continue
            dashboard_info = (game_entity.get("dashboard_info") or game_entity.get("pc_dashboard_info") or {})
            if not dashboard_info:
                logger.info(
                    "Dashboard permission check: token={} game={} has_permission=False status=no_dashboard_info",
                    _token_fingerprint(getattr(context, "token", "")),
                    game_name,
                )
                continue

            curr: Dict = {}
            curr["game_name"] = game_name
            curr["game_code"] = dashboard_info["game_code"]
            curr["game_type"] = dashboard_info["game_type"]
            filter_names = (
                ["channel", "os", "region", "lang", "category", "product"]
                if curr["game_code"] == "nikke_cn"
                else ["channel", "os", "zone", "region", "lang", "category", "product"]
            )
            os_types: set = set()
            for k in filter_names:
                filter_codes = dashboard_info.get(k, [])
                if not filter_codes:
                    continue
                if k == "os":
                    os_types = {item["os_type"].lower() for item in filter_codes if "255" not in item.values() and len(item["os_type"]) > 0}
                    os_names = {item["os_name"].lower() for item in filter_codes if "255" not in item.values()}
                    new_filter_codes = {item["os_name"]: item["os_code"] for item in filter_codes if "255" not in item.values()}
                    if "mobile" in os_types or "android" in os_names or "ios" in os_names:
                        new_filter_codes["Mobile"] = "mobile"
                    if "pc" in os_types or "Steam" in os_names:
                        new_filter_codes["PC"] = "pc"
                    if "console" in os_types or "xbox" in os_names or "playstation" in os_names:
                        new_filter_codes["Console"] = "console"
                    for alias, key in [("Heybox", "小黑盒"), ("heybox", "小黑盒"), ("Official Website", "官网"), ("official website", "官网")]:
                        if alias in new_filter_codes:
                            new_filter_codes[key] = new_filter_codes[alias]
                else:
                    name_key = "category_en_name" if k == "category" else "product_en_name" if k == "product" else f"{k}_name"
                    new_filter_codes = {item[name_key]: item[f"{k}_code"] for item in filter_codes if "255" not in item.values()}
                new_filter_codes["255"] = "255"
                curr[k] = new_filter_codes
            if len(os_types) > 1:
                curr["has_multiple_os_types"] = os_types
            results[game_name] = curr
            key_country[curr["game_code"]] = [y.get("country_code") for y in dashboard_info.get("key_country", [])]
            game_icon_mapping[curr["game_code"]] = dashboard_info.get("cover", "")

            game_code = dashboard_info.get("game_code", "")
            has_permission = bool(dashboard_info.get("has_permission"))
            if game_code and has_permission:
                has_dashboard_data["white_games"].append(game_name)
            elif game_code and not has_permission:
                has_dashboard_data["black_games"].append(game_name)
            else:
                has_dashboard_data["error_games"].append(game_name)

        if not results:
            has_dashboard_data["type"] = DashboardType.Dashboard_1.value
        elif len(results) == len(has_dashboard_data["white_games"]):
            has_dashboard_data["type"] = DashboardType.Dashboard_4.value
        elif len(has_dashboard_data["white_games"]) >= 1:
            has_dashboard_data["type"] = DashboardType.Dashboard_3.value
        elif len(results) == len(has_dashboard_data["black_games"]):
            has_dashboard_data["type"] = DashboardType.Dashboard_2.value
        else:
            has_dashboard_data["type"] = DashboardType.Dashboard_1.value

        context.game_icon_mapping = game_icon_mapping
        context.key_country = key_country
        logger.info(
            "Dashboard permission summary: white_games={} black_games={} error_games={}",
            has_dashboard_data.get("white_games", []),
            has_dashboard_data.get("black_games", []),
            has_dashboard_data.get("error_games", []),
        )
        return results, has_dashboard_data

    except Exception as e:
        logger.info(f"query_dashboard_game_detail_v2 error: {e}")
        return {}, {"white_games": [], "black_games": [], "error_games": [], "retrieved_data_games": []}


async def resolve_game_entities(context: AgentContext, game_names: List[str]) -> Tuple[Dict, Dict]:
    """End-to-end entity resolution: Entity Linking → Dashboard Permission.

    Args:
        context: AgentContext to populate.
        game_names: List of game names to resolve.

    Returns:
        Tuple of (dashboard_game_code_and_filters, has_dashboard_data).
    """
    # Step 1: Build EntityNames from game_names directly (no LLM)
    ner_game_entities = await get_entity_names_simple(game_names)

    if not ner_game_entities:
        logger.warning("No game entities found")
        return {}, {"white_games": [], "black_games": [], "error_games": [], "retrieved_data_games": []}

    # Step 2: Entity Linking
    logger.info(f"[resolve] Step 2: Running entity linking for {len(ner_game_entities)} entities: {[e.original_name for e in ner_game_entities]}")
    ner_json, entity_names, entities, roblox_entities = await game_entity_linking(
        context, ner_game_entities, threshold=0.75
    )
    logger.info(f"[resolve] Entity linking result: entity_names={entity_names}, entities_count={len(entities)}, roblox={len(roblox_entities)}")
    for i, ent in enumerate(entities):
        ent_list = ent.get("list", [])
        if ent_list:
            logger.info(f"[resolve]   entity[{i}]: keyword={ent.get('keyword','')}, entity_name={ent_list[0].get('entity_name','')}, game_id={ent_list[0].get('game_id','')}, dashboard={ent_list[0].get('dashboard','')}")

    # Step 3: Populate context
    context.game_names = entity_names if entity_names else game_names
    context.entities = entities
    context.ner_game_names = ner_json
    if roblox_entities:
        context.roblox_games = roblox_entities
    logger.info(f"[resolve] Step 3: context.game_names={context.game_names}")

    # Step 4: Query dashboard permissions
    if context.entities:
        dashboard_game_code_and_filters, has_dashboard_data = await query_dashboard_game_detail_v2(context)
        context.dashboard_game_code_and_filters = dashboard_game_code_and_filters
        context.has_dashboard_data_list = [has_dashboard_data] if has_dashboard_data else []
        logger.info(f"[resolve] Step 4: dashboard keys={list(dashboard_game_code_and_filters.keys())}, white={has_dashboard_data.get('white_games')}, black={has_dashboard_data.get('black_games')}")
        return dashboard_game_code_and_filters, has_dashboard_data
    else:
        logger.warning("[resolve] No entities found after entity linking")
        return {}, {"white_games": [], "black_games": [], "error_games": [], "retrieved_data_games": []}
