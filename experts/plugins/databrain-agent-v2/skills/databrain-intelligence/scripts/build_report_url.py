#!/usr/bin/env python3
"""
Build an openable DataBrain PDF preview URL from a report row.

Use this after querying `intelligence.t_intelligence_research_report` — the
`pdf_cn` / `pdf_en` columns are *relative paths*, NOT direct URLs. They must be
passed through the `/v2/intelligence/pdfPreviewDownloadLikeShare` endpoint with
double URL-encoded parameter values.

Usage examples:

    # Chinese version
    python build_report_url.py \
        --id 171 \
        --system gameResearch \
        --resource_id 2043612014944718848 \
        --title "Grow a Garden为什么就火了" \
        --pdf_path "/intelligence/1763367274323_Grow a Garden为什么就火了.pdf" \
        --report_like 0 \
        --lang cn

    # English version
    python build_report_url.py \
        --id 171 \
        --system gameResearch \
        --resource_id 2043612014944718848 \
        --title "Grow a Garden Why it took off" \
        --pdf_path "/intelligence/1762323604139_en_Grow a Garden为什么就火了- 英文版 Final.pdf" \
        --lang en

You can also pass a JSON row from `execute_sql.py --format json` (default) via
`--json_row` to avoid copying fields manually:

    python execute_sql.py --sql_file q.sql > /large_tool_results/out.json
    python build_report_url.py --json_row "$(jq '.data.data[0]' /large_tool_results/out.json)" --lang cn
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _utils import get_host

DEFAULT_HOST = get_host()
# The referer param is itself a pre-double-encoded string (encodes "/intelligence/gameResearchReport")
DEFAULT_REFERER = "%252Fintelligence%252FgameResearchReport"


def double_urlencode(value: str) -> str:
    """URL-encode twice (once to %-escape, once to escape the %).

    `/` → `%2F` → `%252F`
    ` ` → `%20` → `%2520`
    Chinese chars → `%EX%XX` → `%25EX%25XX`
    """
    if value is None:
        return ""
    once = quote(str(value), safe="")
    twice = quote(once, safe="")
    return twice


def build_url(
    host: str,
    report_id: str | int,
    system: str,
    resource_id: str | int,
    title: str,
    pdf_path: str,
    report_like: str | int = 0,
    lang: str = "cn",
    referer: str = DEFAULT_REFERER,
) -> str:
    """Construct the DataBrain PDF preview URL for a report row."""
    base = f"{host.rstrip('/')}/v2/intelligence/pdfPreviewDownloadLikeShare"
    params = [
        ("id", str(report_id)),
        ("systemId", system),
        ("resourceId", str(resource_id)),
        ("resourceName", double_urlencode(title)),
        ("resourcePath", double_urlencode(pdf_path)),
        ("resourceLike", str(report_like if report_like is not None else 0)),
        ("downloadLogKey", f"{system}Download"),
        ("lang", lang),
        ("referer", referer),
    ]
    query = "&".join(f"{k}={v}" for k, v in params)
    return f"{base}?{query}"


def build_url_from_row(row: dict, lang: str, host: str = DEFAULT_HOST) -> str:
    """Shortcut: pass a dict with report fields; the helper picks cn/en columns based on `lang`."""
    title_col = "title_cn" if lang == "cn" else "title_en"
    pdf_col = "pdf_cn" if lang == "cn" else "pdf_en"
    title = row.get(title_col) or row.get("title_cn") or row.get("title_en") or ""
    pdf_path = row.get(pdf_col)
    if not pdf_path:
        raise ValueError(f"Missing {pdf_col} in row; cannot construct URL for lang={lang}")
    return build_url(
        host=host,
        report_id=row.get("id"),
        system=row.get("system"),
        resource_id=row.get("resource_id"),
        title=title,
        pdf_path=pdf_path,
        report_like=row.get("report_like", 0),
        lang=lang,
    )


def main():
    parser = argparse.ArgumentParser(
        description="Build a DataBrain PDF preview URL from report row fields.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--host", default=DEFAULT_HOST,
                        help=f"DataBrain host (default: $DATABRAIN_HOST or {DEFAULT_HOST})")
    parser.add_argument("--lang", choices=["cn", "en"], default="cn",
                        help="Language of the URL (default: cn)")
    parser.add_argument("--json_row", default=None,
                        help="JSON object with report fields "
                             "(id, system, resource_id, title_cn, title_en, pdf_cn, pdf_en, report_like). "
                             "Bypasses the individual --id / --system / ... flags.")
    parser.add_argument("--id", default=None, help="Report id")
    parser.add_argument("--system", default=None, help="System (e.g. 'gameResearch')")
    parser.add_argument("--resource_id", default=None, help="Resource id")
    parser.add_argument("--title", default=None, help="Report title (use title_cn or title_en)")
    parser.add_argument("--pdf_path", default=None, help="Relative PDF path (use pdf_cn or pdf_en)")
    parser.add_argument("--report_like", default="0", help="Report like count (default: 0)")

    args = parser.parse_args()

    if args.json_row:
        try:
            row = json.loads(args.json_row)
        except json.JSONDecodeError as e:
            print(f"Error: --json_row is not valid JSON: {e}", file=sys.stderr)
            sys.exit(1)
        try:
            print(build_url_from_row(row, lang=args.lang, host=args.host))
        except (KeyError, ValueError) as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        return

    missing = [f for f in ("id", "system", "resource_id", "title", "pdf_path") if getattr(args, f) is None]
    if missing:
        parser.error(f"Missing required argument(s): {', '.join('--' + m for m in missing)}. "
                     f"Either pass them individually or use --json_row '<JSON>'.")

    print(build_url(
        host=args.host,
        report_id=args.id,
        system=args.system,
        resource_id=args.resource_id,
        title=args.title,
        pdf_path=args.pdf_path,
        report_like=args.report_like,
        lang=args.lang,
    ))


if __name__ == "__main__":
    main()
