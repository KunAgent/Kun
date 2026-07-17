from loguru import logger
from typing import Any, Dict, List

from dashboard_strategy.constants import DashboardType
from dashboard_strategy.context import GameContext


def add_sensitive_dashboard_data(game_context: GameContext, game_names: List[str]):
    if len(game_context.has_dashboard_data_list) > 0:
        last = game_context.has_dashboard_data_list[-1]
        # query_dashboard_game_detail_v2 may append {} on API error; ensure key exists
        if "retrieved_data_games" not in last:
            last["retrieved_data_games"] = []
        last["retrieved_data_games"].extend(game_names)
        if "type" not in last and len(last["retrieved_data_games"]) > 0:
            last["type"] = DashboardType.Dashboard_3.value
    else:
        game_context.has_dashboard_data_list.append(
            {"white_games": [], "black_games": [], "error_games": [], "retrieved_data_games": list(game_names), "type": DashboardType.Dashboard_3.value})


def get_dashboard_white_games(game_context: GameContext) -> List[str]:
    return game_context.has_dashboard_data_list[0].get("white_games", []) if len(game_context.has_dashboard_data_list) > 0 else []


def get_dashboard_type(game_context: GameContext) -> str:
    return game_context.has_dashboard_data_list[0].get("type", DashboardType.Dashboard_1.value) if game_context.has_dashboard_data_list else DashboardType.Dashboard_1.value

