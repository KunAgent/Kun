from __future__ import annotations
from utils.context import GameContext


MGMT_SENSITIVE_DATA_INFO = {"retrieved_data": True}


def set_sensitive_data_flag(game_context: GameContext):
    """Mark that MGMT sensitive data was actually retrieved.

    Dashboard stores per-game permission state in ``has_dashboard_data_list``.
    MGMT only needs a binary marker; ``common.permission_status`` converts this
    into ``{"mgmt_retrieved_data": true}`` in the final ``sensitive_data_info``.
    """
    if not isinstance(getattr(game_context, "has_mgmt_data", None), list):
        game_context.has_mgmt_data = []
    if not any(isinstance(item, dict) and item.get("retrieved_data") for item in game_context.has_mgmt_data):
        game_context.has_mgmt_data.append(dict(MGMT_SENSITIVE_DATA_INFO))


def get_mgmt_sensitive_data_info(game_context: GameContext) -> dict:
    """Return the aggregated MGMT marker shape used by the frontend."""
    has_data = any(
        isinstance(item, dict) and item.get("retrieved_data")
        for item in (getattr(game_context, "has_mgmt_data", None) or [])
    )
    return {"mgmt_retrieved_data": True} if has_data else {}
