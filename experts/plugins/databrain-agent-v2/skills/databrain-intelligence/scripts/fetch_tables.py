#!/usr/bin/env python3
"""
搜索 DataLab 数据表列表。

Usage:
    python fetch_tables.py --game_code databrain --keywords "daily"
"""

import argparse
import json
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: pip install requests", file=sys.stderr)
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).parent))
from _utils import check_http_auth, get_host, require_token

DEFAULT_HOST = get_host()


def fetch_tables(host: str, token: str, game_code: str='databrain', keywords: str = "",
                 drivers: list = None, cycles: list = None,
                 first_labels: list = None, second_labels: list = None,
                 order_by: str = "use_count", desc: bool = True,
                 page: int = 1, page_size: int = 10) -> dict:
    url = f"{host.rstrip('/')}/api/v1/datalab/new_tablelist"
    auth_value = token.strip()
    if auth_value and not auth_value.lower().startswith("bearer "):
        auth_value = f"Bearer {auth_value}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": auth_value,
    }
    payload = {
        "game_code": game_code,
        "first_labels": first_labels or [],
        "second_labels": second_labels or [],
        "drivers": drivers or [],
        "cycles": cycles or [],
        "keywords": keywords,
        "order_by": order_by,
        "desc": desc,
        "page": page,
        "page_size": page_size,
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    check_http_auth(resp)
    resp.raise_for_status()
    try:
        data = resp.json()
    except ValueError:
        raise ValueError(f"API 返回非 JSON 响应 (HTTP {resp.status_code}): {resp.text[:200]}")
    if data.get("code", -1) != 0:
        raise ValueError(f"API Error {data.get('code')}: {data.get('msg', 'unknown')}")
    return data


def format_table_list(data: dict) -> str:
    rows = data.get("data", {}).get("data_list", [])
    total = data.get("data", {}).get("row_count", 0)

    if not rows:
        return "No matching tables found."

    lines = [f"Total {total} tables, showing {len(rows)}:\n"]
    header = f"{'#':<4} {'table_id':<36} {'Name':<40} {'Driver':<12} {'Cycle':<8} {'Schema':<20} {'database_uuid':<16}"
    lines.append(header)
    lines.append("-" * len(header))

    for i, row in enumerate(rows, 1):
        name = row.get("customize_name") or row.get("table_name", "")
        if len(name) > 38:
            name = name[:35] + "..."
        lines.append(
            f"{i:<4} {row.get('table_id', ''):<36} {name:<40} "
            f"{row.get('driver', ''):<12} {row.get('cycle', ''):<8} "
            f"{row.get('scheme', ''):<20} {row.get('database_uuid', ''):<16}"
        )

    lines.append("")
    desc_lines = []
    for i, row in enumerate(rows, 1):
        table_desc = row.get("table_desc") or row.get("table_desc_en") or ""
        if table_desc:
            desc_lines.append(f"  [{i}] {table_desc[:100]}")
    if desc_lines:
        lines.append("Descriptions:")
        lines.extend(desc_lines)

    labels = data.get("data", {}).get("label", {})
    if labels:
        available = []
        if labels.get("drivers"):
            available.append(f"drivers: {labels['drivers']}")
        if labels.get("labels"):
            available.append(f"labels: {labels['labels']}")
        if labels.get("cycles"):
            available.append(f"cycles: {labels['cycles']}")
        if available:
            lines.append(f"\nAvailable filters: {' | '.join(available)}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Search DataLab tables")
    parser.add_argument("--token", default=None, help="JWT Bearer Token (default: $DATABRAIN_TOKEN, fallback $TAI_IT_TOKEN; raw value, no Bearer prefix)")
    parser.add_argument("--game_code", default="databrain", help="Game/business code (default: databrain)")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"API host (default: {DEFAULT_HOST})")
    parser.add_argument("--keywords", default="", help="Search keywords")
    parser.add_argument("--drivers", default=None, help="Driver filter, comma-separated")
    parser.add_argument("--cycles", default=None, help="Cycle filter, comma-separated")
    parser.add_argument("--first_labels", default=None, help="First-level labels, comma-separated")
    parser.add_argument("--second_labels", default=None, help="Second-level labels, comma-separated")
    parser.add_argument("--order_by", default="use_count", help="Sort field")
    parser.add_argument("--asc", action="store_true", default=False, help="Ascending order (default: descending)")
    parser.add_argument("--page", type=int, default=1, help="Page number")
    parser.add_argument("--page_size", type=int, default=10, help="Results per page")
    parser.add_argument("--format", choices=["table", "json"], default="table", help="Output format")

    args = parser.parse_args()

    token = require_token(args.token)
    drivers = [d.strip() for d in args.drivers.split(",")] if args.drivers else None
    cycles = [c.strip() for c in args.cycles.split(",")] if args.cycles else None
    first_labels = [l.strip() for l in args.first_labels.split(",")] if args.first_labels else None
    second_labels = [l.strip() for l in args.second_labels.split(",")] if args.second_labels else None

    try:
        data = fetch_tables(
            host=args.host, token=token, game_code=args.game_code,
            keywords=args.keywords, drivers=drivers, cycles=cycles,
            first_labels=first_labels, second_labels=second_labels,
            order_by=args.order_by, desc=not args.asc,
            page=args.page, page_size=args.page_size,
        )
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}", file=sys.stderr)
        sys.exit(1)

    if args.format == "json":
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print(format_table_list(data))


if __name__ == "__main__":
    main()
