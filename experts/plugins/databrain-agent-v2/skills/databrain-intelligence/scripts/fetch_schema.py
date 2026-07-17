#!/usr/bin/env python3
"""
Fetch detailed table schema (columns and field definitions).

Token 来源（优先级从高到低）：
  1. --token 命令行参数
  2. 系统环境变量 DATABRAIN_TOKEN（生产由服务端自动注入）
  3. skill 根目录 .env 中的 DATABRAIN_TOKEN（本地调试）
  4. 旧的 TAI_IT_TOKEN 环境变量 / .env（兼容 fallback）

Usage:
    python fetch_schema.py --game_code demo --table_ids "id1,id2"
    python fetch_schema.py --token "<jwt>" --game_code demo --table_ids "id1,id2"
    python fetch_schema.py --game_code demo --table_ids "id1" --format ai
    python fetch_schema.py --game_code demo --keywords "game_event"
    python fetch_schema.py --game_code demo --keywords "daily" --keyword_limit 3
"""

import argparse
import json
import os
import sys

try:
    import requests
except ImportError:
    print("Error: pip install requests", file=sys.stderr)
    sys.exit(1)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sql_dialects import get_hint as _get_dialect_hint, get_full_hint as _get_full_hint, get_hint_for_driver as _get_dialect_hint_compat, get_full_hint_for_driver as _get_full_hint_compat
from _utils import check_http_auth, get_host, require_token
from fetch_tables import fetch_tables

DEFAULT_HOST = get_host()

ATTR_LABELS = {0: "common_dimension", 1: "dimension", 2: "metric"}


def fetch_schema(host: str, token: str, game_code: str, table_ids: list) -> dict:
    url = f"{host.rstrip('/')}/api/v1/datalab/batchGetTableInfo"
    auth_value = token.strip()
    if auth_value and not auth_value.lower().startswith("bearer "):
        auth_value = f"Bearer {auth_value}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": auth_value,
    }
    payload = {
        "table_id": table_ids,
        "system": "datalab",
        "game_code": game_code,
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    check_http_auth(resp)
    resp.raise_for_status()
    try:
        data = resp.json()
    except ValueError:
        raise ValueError(f"Non-JSON response from API (HTTP {resp.status_code}): {resp.text[:200]}")
    if data.get("code", -1) != 0:
        raise ValueError(f"API Error {data.get('code')}: {data.get('msg', 'unknown')}")
    return data


def resolve_table_ids_from_keywords(
    host: str, token: str, game_code: str, keywords: str, page_size: int = 1,
) -> tuple[list[str], int]:
    """Resolve table_id(s) via keyword search. Returns (ids, total_match_count)."""
    data = fetch_tables(
        host=host, token=token, game_code=game_code,
        keywords=keywords, page_size=page_size,
    )
    rows = data.get("data", {}).get("data_list", [])
    total = data.get("data", {}).get("row_count", len(rows))
    if not rows:
        raise ValueError(f"No tables found for keywords: {keywords!r}")
    ids = [row["table_id"] for row in rows if row.get("table_id")]
    if not ids:
        raise ValueError(f"No table_id in search results for keywords: {keywords!r}")
    return ids, total


def format_schema(data: dict) -> str:
    tables = data.get("data", [])
    if not tables:
        return "No table information found."

    lines = []
    for table in tables:
        table_name = table.get("customize_name") or table.get("table_name", "unknown")
        physical_name = table.get("table_name", "")
        driver = table.get("driver", "")
        scheme = table.get("scheme", "")
        db_uuid = table.get("database_uuid", "")

        lines.append(f"{'=' * 80}")
        lines.append(f"Name: {table_name}")
        lines.append(f"Physical name: {physical_name}")
        lines.append(f"Driver: {driver} | schema: {scheme} | database_uuid: {db_uuid}")
        if table.get("table_desc"):
            lines.append(f"Description: {table['table_desc']}")
        lines.append("")

        columns = table.get("column_list", [])
        if not columns:
            lines.append("  (no column information)")
            continue

        dimensions = [c for c in columns if c.get("is_dimension") or c.get("is_common_dimension")]
        metrics = [c for c in columns if c.get("is_metric") and not c.get("is_common_dimension")]
        other = [c for c in columns
                 if not c.get("is_dimension") and not c.get("is_common_dimension") and not c.get("is_metric")]

        if dimensions:
            lines.append(f"  ── Dimensions ({len(dimensions)}) ──")
            col_header = f"  {'Column':<30} {'Type':<10} {'Origin Type':<15} {'Attribute':<15} {'Display Name'}"
            lines.append(col_header)
            lines.append("  " + "-" * 90)
            for col in dimensions:
                attr_label = ATTR_LABELS.get(col.get("attribute", -1), "unknown")
                display = col.get("display_name") or col.get("display_name_en") or ""
                lines.append(
                    f"  {col['name']:<30} {col.get('type', ''):<10} "
                    f"{col.get('origin_type', ''):<15} {attr_label:<15} {display}"
                )
            lines.append("")

        if metrics:
            lines.append(f"  ── Metrics ({len(metrics)}) ──")
            col_header = f"  {'Column':<30} {'Type':<10} {'Origin Type':<15} {'Attribute':<15} {'Display Name'}"
            lines.append(col_header)
            lines.append("  " + "-" * 90)
            for col in metrics:
                attr_label = ATTR_LABELS.get(col.get("attribute", -1), "unknown")
                display = col.get("display_name") or col.get("display_name_en") or ""
                lines.append(
                    f"  {col['name']:<30} {col.get('type', ''):<10} "
                    f"{col.get('origin_type', ''):<15} {attr_label:<15} {display}"
                )
            lines.append("")

        if other:
            lines.append(f"  ── Other ({len(other)}) ──")
            for col in other:
                display = col.get("display_name") or col.get("display_name_en") or ""
                lines.append(f"  {col['name']:<30} {col.get('type', ''):<10} {display}")
            lines.append("")

    return "\n".join(lines)


def format_for_ai(data: dict) -> str:
    """Compact schema output suitable for injection into an AI prompt."""
    tables = data.get("data", [])
    if not tables:
        return "No table information"

    lines = []
    seen_drivers = set()
    driver_list = []

    for table in tables:
        physical_name = table.get("table_name", "unknown")
        scheme = table.get("scheme", "")
        full_name = f"{scheme}.{physical_name}" if scheme else physical_name
        driver = table.get("driver", "")

        lines.append(f"-- table: {full_name} (driver: {driver})")
        if table.get("table_desc"):
            lines.append(f"-- description: {table['table_desc']}")

        columns = table.get("column_list", [])
        for col in columns:
            is_dim = col.get("is_dimension") or col.get("is_common_dimension")
            role = "dimension" if is_dim else ("metric" if col.get("is_metric") else "other")
            display = col.get("display_name") or col.get("display_name_en") or ""
            comment = f" -- {display}" if display else ""
            lines.append(f"  {col['name']} {col.get('origin_type', '')}, -- [{role}]{comment}")

        hint = _get_dialect_hint()
        if hint:
            lines.append(f"-- ⚠️ {hint}")
        lines.append("")

        drv_key = (driver or "").lower().strip()
        if drv_key and drv_key not in seen_drivers:
            seen_drivers.add(drv_key)
            driver_list.append(driver)

    # Append full BigQuery dialect reference once
    if driver_list:
        full = _get_full_hint()
        if full:
            lines.append("")
            lines.append(full)

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Fetch detailed table schema")
    parser.add_argument("--token", default=None, help="JWT Bearer Token (default: $DATABRAIN_TOKEN, fallback $TAI_IT_TOKEN; raw value, no Bearer prefix)")
    parser.add_argument("--game_code", default="databrain", help="Game/business code (default: databrain)")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"API host (default: {DEFAULT_HOST})")
    parser.add_argument("--table_ids", default=None, help="Table IDs, comma-separated")
    parser.add_argument("--keywords", default=None,
                        help="Search keywords to resolve table IDs (alternative to --table_ids)")
    parser.add_argument("--keyword_limit", type=int, default=1, metavar="N",
                        help="With --keywords: fetch schema for top N matches (default: 1, max: 20)")
    parser.add_argument("--format", choices=["table", "json", "ai"], default="table",
                        help="Output format: table (human-readable), json (raw), ai (compact for prompt injection)")

    args = parser.parse_args()

    if not args.table_ids and not args.keywords:
        parser.error("one of --table_ids or --keywords is required")
    if args.table_ids and args.keywords:
        parser.error("--table_ids and --keywords are mutually exclusive")
    if args.keyword_limit < 1 or args.keyword_limit > 20:
        parser.error("--keyword_limit must be between 1 and 20")
    if args.table_ids and args.keyword_limit != 1:
        parser.error("--keyword_limit is only valid with --keywords")

    token = require_token(args.token)
    try:
        if args.keywords:
            keywords = args.keywords.strip()
            if not keywords:
                parser.error("--keywords must not be empty")
            table_ids, match_total = resolve_table_ids_from_keywords(
                host=args.host, token=token, game_code=args.game_code,
                keywords=keywords, page_size=args.keyword_limit,
            )
            if match_total > len(table_ids):
                print(
                    f"Note: keywords {keywords!r} matched {match_total} tables; "
                    f"fetched top {len(table_ids)} (table_ids={','.join(table_ids)}). "
                    f"Run fetch_tables.py --keywords {keywords!r} to list all matches.",
                    file=sys.stderr,
                )
        else:
            table_ids = [t.strip() for t in args.table_ids.split(",") if t.strip()]
            if not table_ids:
                parser.error("--table_ids must contain at least one table ID")

        data = fetch_schema(
            host=args.host, token=token,
            game_code=args.game_code, table_ids=table_ids,
        )
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}", file=sys.stderr)
        sys.exit(1)

    if args.format == "json":
        print(json.dumps(data, indent=2, ensure_ascii=False))
    elif args.format == "ai":
        print(format_for_ai(data))
    else:
        print(format_schema(data))


if __name__ == "__main__":
    main()
