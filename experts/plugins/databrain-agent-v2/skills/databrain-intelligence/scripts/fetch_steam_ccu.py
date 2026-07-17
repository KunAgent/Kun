#!/usr/bin/env python3
"""
Fetch live Steam CCU (concurrent players) via the public Steam Web API.

Aligns with databrain_host `steam_ccu.py` (GetNumberOfCurrentPlayers). This script
does NOT replace warehouse PCU/ACU — pair with SQL patterns in examples/steam_ccu_queries.sql
for trends. See references/steam-ccu.md.

Token: DATABRAIN_TOKEN (auto-injected by service; legacy fallback TAI_IT_TOKEN).
Only needed to resolve combined_id → steam_id via DataLab SQL.

Usage:
    python scripts/fetch_steam_ccu.py --combined-id c00001765
    python scripts/fetch_steam_ccu.py --combined-id c00001765 --combined-id c00002645
    python scripts/fetch_steam_ccu.py --name "Counter-Strike 2" --type pc
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:
    print("Error: pip install requests", file=sys.stderr)
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _utils import get_host, require_token
from execute_sql import execute_sql
from search_entity import search_entity

STEAM_CCU_URL = (
    "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/"
)
DEFAULT_HOST = get_host()


def _escape_sql_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def resolve_steam_ids(
    combined_ids: list[str],
    token: str,
    host: str,
) -> list[dict[str, Any]]:
    """combined_id → entity_name, steam_id from common.combined_detail."""
    if not combined_ids:
        return []
    in_list = ", ".join(f"'{_escape_sql_string(cid)}'" for cid in combined_ids)
    sql = f"""
SELECT combined_id, entity_name, steam_id
FROM common.combined_detail
WHERE combined_id IN ({in_list})
LIMIT {len(combined_ids)}
""".strip()
    result = execute_sql(host=host, token=token, sql=sql)
    if result.get("code") != 0:
        raise RuntimeError(result.get("msg") or "execute_sql failed")
    rows = (result.get("data") or {}).get("data") or []
    by_id = {r["combined_id"]: r for r in rows}
    out: list[dict[str, Any]] = []
    for cid in combined_ids:
        row = by_id.get(cid)
        if not row:
            out.append(
                {
                    "combined_id": cid,
                    "entity_name": None,
                    "steam_id": None,
                    "error": "combined_id not found in common.combined_detail",
                }
            )
            continue
        steam_id = (row.get("steam_id") or "").strip()
        if not steam_id or steam_id.lower() in ("null", "none", "0"):
            out.append(
                {
                    "combined_id": cid,
                    "entity_name": row.get("entity_name"),
                    "steam_id": None,
                    "error": "no steam_id on combined_detail (not a Steam PC title?)",
                }
            )
            continue
        try:
            appid = int(steam_id)
        except ValueError:
            out.append(
                {
                    "combined_id": cid,
                    "entity_name": row.get("entity_name"),
                    "steam_id": steam_id,
                    "error": f"invalid steam_id: {steam_id!r}",
                }
            )
            continue
        out.append(
            {
                "combined_id": cid,
                "entity_name": row.get("entity_name"),
                "steam_id": appid,
            }
        )
    return out


def fetch_steam_ccu_api(appid: int, timeout: float = 15.0) -> dict[str, Any]:
    """Call Steam GetNumberOfCurrentPlayers for one appid."""
    resp = requests.get(STEAM_CCU_URL, params={"appid": appid}, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    response = data.get("response") or {}
    if response.get("result") != 1:
        return {
            "steam_id": appid,
            "error": f"Steam API result={response.get('result')}",
            "source": "steam API",
        }
    return {
        "steam_id": appid,
        "CCU": response.get("player_count"),
        "source": "steam API",
    }


def enrich_with_ccu(
    resolved: list[dict[str, Any]],
    max_workers: int = 8,
) -> list[dict[str, Any]]:
    """Attach CCU from Steam API to resolved rows."""
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ok = [r for r in resolved if r.get("steam_id") and "error" not in r]
    errors = [r for r in resolved if r not in ok]

    def _one(row: dict[str, Any]) -> dict[str, Any]:
        appid = row["steam_id"]
        try:
            api = fetch_steam_ccu_api(appid)
        except requests.RequestException as e:
            api = {"steam_id": appid, "error": str(e), "source": "steam API"}
        out = {**row, "fetched_at_utc": fetched_at}
        if "error" in api:
            out["error"] = api["error"]
            out["source"] = api.get("source", "steam API")
        else:
            out["CCU"] = api.get("CCU")
            out["source"] = api.get("source", "steam API")
        return out

    results: list[dict[str, Any]] = list(errors)
    if not ok:
        return results

    workers = min(max_workers, len(ok))
    if workers <= 1:
        results.extend(_one(r) for r in ok)
        return results

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_one, r): r for r in ok}
        for fut in as_completed(futures):
            results.append(fut.result())
    # Preserve input order for stable CLI output
    order = {r["combined_id"]: i for i, r in enumerate(resolved) if r.get("combined_id")}
    results.sort(key=lambda r: order.get(r.get("combined_id"), 9999))
    return results


def combined_ids_from_name(
    name: str,
    entity_type: str,
    top: int,
    host: str,
) -> list[str]:
    matches = search_entity(name, entity_type, top, host)
    ids: list[str] = []
    for m in matches:
        cid = (m.get("combine_id") or "").strip()
        if cid and cid not in ids:
            ids.append(cid)
    return ids


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Live Steam CCU via Steam Web API (by combined_id or game name)",
    )
    parser.add_argument(
        "--combined-id",
        action="append",
        dest="combined_ids",
        default=[],
        metavar="ID",
        help="combined_id (c...). Repeat for multiple games.",
    )
    parser.add_argument("--name", help="Game name → search_entity → combined_id")
    parser.add_argument(
        "--type",
        dest="entity_type",
        default="pc",
        choices=["mobile", "pc", "console", "company", ""],
        help="Entity type when using --name (default: pc)",
    )
    parser.add_argument("--top", type=int, default=1, help="Max matches for --name")
    parser.add_argument("--host", default=DEFAULT_HOST, help="DataLab API host")
    parser.add_argument("--token", default=None, help="DATABRAIN_TOKEN override (raw, no Bearer prefix)")
    parser.add_argument(
        "--max-workers",
        type=int,
        default=8,
        help="Concurrent Steam API calls (default: 8)",
    )
    args = parser.parse_args()

    if args.token:
        os.environ["DATABRAIN_TOKEN"] = args.token.strip()

    combined_ids = list(args.combined_ids or [])
    if args.name:
        combined_ids.extend(
            combined_ids_from_name(
                args.name, args.entity_type, args.top, args.host
            )
        )
    combined_ids = list(dict.fromkeys(combined_ids))  # dedupe, keep order

    if not combined_ids:
        if args.name and not args.combined_ids:
            parser.error(f"No entity found for name: {args.name!r}")
        parser.error("Provide --combined-id and/or --name")

    token = require_token(args.token)
    resolved = resolve_steam_ids(combined_ids, token, args.host)
    results = enrich_with_ccu(resolved, max_workers=args.max_workers)

    print(json.dumps({"results": results}, ensure_ascii=False, indent=2))
    if any("error" in r for r in results):
        sys.exit(2)


if __name__ == "__main__":
    main()
