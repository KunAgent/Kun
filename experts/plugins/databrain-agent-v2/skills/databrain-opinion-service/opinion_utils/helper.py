"""Stub: utils.helper — simplified helpers for react agent skills."""
from loguru import logger
from typing import List


def default_tool_error_function(error: Exception, **kwargs) -> str:
    logger.error("Tool error: {}", error)
    return str(error)


def websearch_fallback_error_function(error: Exception, **kwargs) -> str:
    logger.error("Tool error (websearch fallback): {}", error)
    return str(error)


def websearch_fallback_with_rewrite_error_function(error: Exception, **kwargs) -> str:
    logger.error("Tool error (websearch fallback with rewrite): {}", error)
    return str(error)


def update_id_map_from_game_context(game_context):
    pass


async def post_databrain_game_info(
    entity_names: List[str],
    user_id: str,
    entity_types: list = [],
    token: str = None,
    message_id: str = None,
    game_context=None,
):
    """Resolve entity names to game_ids using id_map and context entities."""
    game_ids = []
    game_names_out = []

    try:
        from opinion_data.id_map import GAME_CODE_MAP, COMPANY_CODE_MAP
    except ImportError:
        GAME_CODE_MAP = {}
        COMPANY_CODE_MAP = {}

    id_map = COMPANY_CODE_MAP if "company" in entity_types else GAME_CODE_MAP
    if "company" in entity_types:
        id_map = {k.strip().lower(): v for k, v in id_map.items()}

    expanded = []
    for et in (entity_types or []):
        if et and et.lower() == "pc/console":
            expanded.extend(["pc", "console"])
        else:
            expanded.append(et)
    entity_types = list(dict.fromkeys(et for et in expanded if et in ["pc", "console", "mobile", "company", "combine"]))

    for name in entity_names:
        key = name.strip().lower()
        if key in id_map:
            id_result = id_map[key]
            if isinstance(id_result, dict):
                for gd in id_result.get("intelligence", []):
                    gc = gd.get("game_code", "")
                    gt = gd.get("game_type", "")
                    if gt in entity_types or not entity_types:
                        if gt in ["combine", "pc", "console"] and gc.startswith("c"):
                            gt = "combine"
                        game_ids.append(f"{gc}_{gt}")
                        game_names_out.append(name)
            else:
                game_ids.append(f"{id_result}_company")
                game_names_out.append(name)
        else:
            if game_context and hasattr(game_context, "entities"):
                for e in game_context.entities:
                    elist = e.get("list", [])
                    if elist and (e.get("keyword", "").lower() == key or elist[0].get("entity_name", "").lower() == key):
                        for gd in elist:
                            cid = gd.get("combine_id", "")
                            if cid:
                                game_ids.append(f"{cid}_combine")
                                game_names_out.append(name)
                                break
                        break

    return game_ids, game_names_out
