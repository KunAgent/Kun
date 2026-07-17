#!/usr/bin/env python3
"""Resolve game/company entities and fetch multi-system permissions via entity linking API.

Mirrors the deepagent entity_linking_api flow:
  POST GAME_SEARCH_API with multi_keywords + entity_type + system

Usage:
  # Pass NER output as JSON (preferred — includes standard_name/english_name):
  python scripts/resolve_entities.py --entities '[
    {"original_name": "HOK", "standard_name": "Honor of Kings", "english_name": "Honor of Kings", "type": "game"},
    {"original_name": "Tencent", "standard_name": "Tencent", "english_name": "Tencent", "type": "game company"}
  ]'

  # Simple fallback (original_name only, treats all as games):
  python scripts/resolve_entities.py --names "Honor of Kings" "PUBG Mobile"

Output: JSON array, one entry per input entity:
  [{
    "original_name": "HOK",
    "matched": true,
    "entity_name": "Honor of Kings",
    "entity_type": "mobile",
    "similarity": 0.98,
    "has_dashboard_permission": true,
    "dashboard_info": {...},        // only when has_dashboard_permission is true
    "has_opinion_permission": true,
    "opinion_info": {...},         // only when has_opinion_permission is true
    "has_intelligence": true,       // intelligence is available when entity is found
  }]

Env:
  DATABRAIN_TOKEN  (required)
  DATABRAIN_HOST   (optional, default https://databrain.intlgame.com)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

DATABRAIN_HOST_DEFAULT = "https://databrain.intlgame.com"
GAME_SEARCH_API = "/api/v1/intelligence_pc/chatbi/search"
SIMILARITY_THRESHOLD = 0.75

# entity_type values: "pc,console,mobile" for games (default), "company" for studios/publishers
ENTITY_TYPE_GAME = "pc,console,mobile"
ENTITY_TYPE_COMPANY = "company"
# system: which permission systems to query (mgmt excluded — checked separately at session start)
SYSTEM_DEFAULT = "intelligence,dashboard,opinion"


def _post(host: str, token: str, path: str, body: dict) -> dict:
    resp = requests.post(
        host + path,
        json=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _resolve_batch(host: str, token: str, entities: list[dict], entity_type: str) -> list[dict]:
    """Call entity linking API for a batch of same-type entities."""
    multi_keywords = [
        {
            "original_name": e.get("original_name", ""),
            "standard_name": e.get("standard_name", e.get("original_name", "")),
            "english_name": e.get("english_name", e.get("original_name", "")),
        }
        for e in entities
    ]
    body = {
        "multi_keywords": multi_keywords,
        "entity_type": entity_type,
        "system": SYSTEM_DEFAULT,
        "top": 1,
    }
    resp = _post(host, token, GAME_SEARCH_API, body)
    return resp.get("data") or []


def _parse_entry(rsp_entity: dict, original_name: str) -> dict:
    """Parse one entity from the API response list."""
    entity_list = [
        e for e in (rsp_entity.get("list") or [])
        if (e.get("similarity") or 0) >= SIMILARITY_THRESHOLD
    ]
    if not entity_list:
        return {"original_name": original_name, "matched": False,
                "reason": "no match above similarity threshold"}

    best = entity_list[0]
    dashboard_info = best.get("dashboard_info") or best.get("pc_dashboard_info") or {}
    opinion_info = best.get("opinion_info") or best.get("pc_opinion_info") or {}

    has_dashboard = bool(dashboard_info.get("has_permission"))
    has_opinion = bool(best.get("opinion") or best.get("pc_opinion"))

    entry = {
        "original_name": original_name,
        "matched": True,
        "entity_name": best.get("entity_name", ""),
        "entity_id": best.get("entity_id", ""),
        "combine_id": best.get("combine_id", ""),
        "entity_type": best.get("entity_type", ""),
        "similarity": best.get("similarity", 0),
        "has_dashboard_permission": has_dashboard,
        "has_opinion_permission": has_opinion,
        "has_intelligence": True,
    }
    if has_dashboard:
        entry["dashboard_info"] = dashboard_info
    if has_opinion and opinion_info:
        entry["opinion_info"] = opinion_info
    return entry


def main():
    parser = argparse.ArgumentParser(description="Resolve entities and fetch multi-system permissions")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--entities", type=str,
                       help="JSON array of {original_name, standard_name, english_name, type}")
    group.add_argument("--names", nargs="+",
                       help="Simple name list (all treated as games, original_name only)")
    args = parser.parse_args()

    token = os.environ.get("DATABRAIN_TOKEN", "").strip()
    if not token:
        print(json.dumps({
            "status": "error",
            "error": "DATABRAIN_TOKEN is not set. Get your token at https://databrain.woa.com/v2/user-center/personal-tokens-center",
        }, ensure_ascii=False))
        sys.exit(1)

    host = os.environ.get("DATABRAIN_HOST", DATABRAIN_HOST_DEFAULT).rstrip("/")

    # Build entity list
    if args.entities:
        try:
            entity_list = json.loads(args.entities)
        except json.JSONDecodeError as e:
            print(json.dumps({"status": "error", "error": f"Invalid JSON: {e}"}, ensure_ascii=False))
            sys.exit(1)
    else:
        entity_list = [{"original_name": n, "standard_name": n, "english_name": n, "type": "game"}
                       for n in args.names]

    # Split by type: games (pc,console,mobile) vs companies
    game_entities = [e for e in entity_list if e.get("type", "game") != "game company"]
    company_entities = [e for e in entity_list if e.get("type", "game") == "game company"]

    # original_name → result index mapping
    name_to_idx = {e.get("original_name", ""): i for i, e in enumerate(entity_list)}
    results: list = [None] * len(entity_list)

    def resolve_batch(entities, entity_type):
        if not entities:
            return
        try:
            rsp_entities = _resolve_batch(host, token, entities, entity_type)
            # rsp_entities is a list matching multi_keywords order
            for i, rsp_entity in enumerate(rsp_entities):
                if i >= len(entities):
                    break
                original_name = entities[i].get("original_name", "")
                idx = name_to_idx.get(original_name)
                if idx is not None:
                    results[idx] = _parse_entry(rsp_entity, original_name)
        except Exception as exc:
            for e in entities:
                idx = name_to_idx.get(e.get("original_name", ""))
                if idx is not None:
                    results[idx] = {"original_name": e.get("original_name", ""),
                                    "matched": False, "error": str(exc)}

    with ThreadPoolExecutor(max_workers=2) as pool:
        futs = []
        if game_entities:
            futs.append(pool.submit(resolve_batch, game_entities, ENTITY_TYPE_GAME))
        if company_entities:
            futs.append(pool.submit(resolve_batch, company_entities, ENTITY_TYPE_COMPANY))
        for f in as_completed(futs):
            f.result()

    # Fill any unmatched slots
    for i, e in enumerate(entity_list):
        if results[i] is None:
            results[i] = {"original_name": e.get("original_name", ""), "matched": False,
                          "reason": "no response from API"}

    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
