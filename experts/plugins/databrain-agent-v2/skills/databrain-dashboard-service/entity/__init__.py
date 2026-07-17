"""Standalone entity resolution module for databrain-dashboard skill.

Provides entity linking and dashboard permission resolution.
No LLM calls — game names are passed directly by the caller.
"""
from entity.entity_linking import (
    EntityNames,
    game_entity_linking,
    game_entity_linking_json,
    company_entity_linking,
    company_entity_linking_json,
)
from entity.entity import (
    get_entity_names_simple,
    resolve_game_entities,
    query_dashboard_game_detail_v2,
)

__all__ = [
    "EntityNames",
    "game_entity_linking",
    "game_entity_linking_json",
    "company_entity_linking",
    "company_entity_linking_json",
    "get_entity_names_simple",
    "resolve_game_entities",
    "query_dashboard_game_detail_v2",
]
