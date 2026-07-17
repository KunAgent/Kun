#!/usr/bin/env python3
"""
Execute a read-only BigQuery SQL against the **opinion / intelligence / common / marketing_hub** schemas
via the DataLab "exec_sql" API (`POST /api/v1/datalab/skill/exec_sql`).

This script is opinion-focused: default `schema=opinion`, but you can override with `--schema` (e.g. `intelligence`,
`marketing_hub`, `common`) when joining cross-schema tables. The underlying API supports BigQuery `FROM
project.dataset.table` fully-qualified names too.

Environment variables:
  - DATABRAIN_TOKEN: API token from DataBrain (raw value, no `Bearer ` prefix; required)
  - DATABRAIN_HOST:  DataBrain API host (optional; default `https://databrain.intlgame.com`).
                     Only trusted hosts are accepted; non-trusted hosts fall back to default with a warning.

⚠️ TIMEZONE — UTC+8 (Beijing time):
  舆情数据全栈口径为 **UTC+8（北京时间）**。`today` 取 system prompt 顶部注入的
  `当前时间`（已是 UTC+8 北京时间），无需为每条查询额外跑脚本；仅当上下文确实
  缺该字段时才回退 `python scripts/now_beijing.py`。
  时间窗口用纯字面量 `TIMESTAMP('YYYY-MM-DD')` / `DATE('YYYY-MM-DD')` /
  `DATETIME('YYYY-MM-DD')`（不加 `'Asia/Shanghai'` 参数 — 数据已按北京时间
  字面量灌库）；优先 `BETWEEN <start> AND <end>` 闭区间（如近 N 天含今天 =
  `BETWEEN <today-(N-1)> AND <today>`）。
  **禁止** `CURRENT_TIMESTAMP() / CURRENT_DATE() / CURRENT_DATETIME()` —— BQ
  服务时钟是 UTC，与业务北京时间错位最多 8h（实测 NIKKE 近 5 天声量偏差 23%）。
  See also: `scripts/now_beijing.py`（兜底 UTC+8 today provider），
  以及 SKILL.md 顶部 Hard Constraints 时间锚定 + Phase 2 时间映射表。

Usage:
    python execute_sql.py --sql "SELECT COUNT(*) FROM opinion.public_feeds WHERE comment_time >= TIMESTAMP('2026-04-01')"
    python execute_sql.py --schema intelligence --sql "SELECT ... FROM news_details ..."
    python execute_sql.py --sql_file /large_tool_results/query.sql

Large result sets are automatically spilled to /large_tool_results/opinion_sql_<timestamp>.json and stdout gets a
summary + first N rows sample. See --max_stdout_bytes / --output_file / --head_rows.

Common errors (CLI usage, BigQuery error codes, common SQL mistakes)
—— 这是 SKILL.md §3.2 错误码速查的单一真理源（SKILL.md 只留指针）：

| Code / Symptom | Cause | Action |
|----------------|-------|--------|
| `unrecognized arguments: SELECT ...` | SQL passed as positional, not `--sql` | Re-run with `--sql "..."` or `--sql_file ...` |
| 61001 timeout | Date range too wide / missing partition filter | Narrow date range; add `comment_time >=` / `date >=` filter on partition columns |
| 61002 syntax error | BigQuery syntax mismatch | Check DATETIME vs TIMESTAMP cast, QUALIFY, ARRAY_AGG, etc. |
| 61003 security check failed | Non-SELECT，或 SQL 文本字面量含禁字（正则匹配 `CALL`/`UPDATE`/`DROP`/`GRANT`/`EXECUTE` 等关键词，即使在字符串字面量里也会被拦） | 搜 "Call of Duty" 用 `codm`；"patch update" 用 `patch notes?` / `released` / `now live`；"price drop" 用 `price (cut\|reduction\|slash)` |
| 61004 no permission | Wrong game_code or database_uuid | Verify both; opinion default is `game_code=databrain database_uuid=15000` |
| 61006 rate limited | Too many concurrent queries (per-user ≤3, global QPS ≤50) | Retry after a short wait |
| `Not found: Table opinion.feeds` | `opinion.feeds` 已下线 | 改用 `opinion.public_feeds`（两者历史等价） |
| `Not found: Table` | Missing schema prefix or wrong table | Use `<schema>.<table>` or fully qualified `tencent-databrain-prod.<schema>.<table>` |
| `Unrecognized name: organization` | `feeds.organization` 字段不存在 | 用 `dim_media_account.category='official-accounts'` 反查（详见 references/auxiliary/social_filter_logic.md） |
| `Unrecognized name: language` | Some Cube views expose derived `language_code`; raw BQ field is `language` | See references/auxiliary/cube_schema.md §3 |
| `Unrecognized name: X; Did you mean Y?` | 字段名变化 | 按提示改；详见 references/auxiliary/cube_schema.md |
| `references column X which is neither grouped nor aggregated` | Missing GROUP BY column | Add to GROUP BY or wrap in aggregate; 可用序数 `GROUP BY 1, 2` |
| `Analytic functions cannot be arguments to aggregate functions` | 窗口套在聚合里 | 拆两层子查询，内层算窗口、外层聚合 |
| `No matching signature for operator >= for argument types: DATETIME, TIMESTAMP` | `store_score_*.create_time` 是 DATETIME，用错了 TIMESTAMP_SUB/TIMESTAMP() | 改 `DATETIME('<today-N>')` 字面量（基于 now_beijing.py / 注入的当前时间）或字符串 `'2026-01-01 00:00:00'`；不要用 `CURRENT_DATETIME()` |
| `invalid perl operator: (?<!` | RE2 不支持 lookbehind/lookahead | 用 `\b` 词边界（仅 Latin），中日韩文用本地译名匹配 `content_to_zh` |
| `row_count: 0` / Empty result 但预期有数据 | (1) 时间窗确实无数据 / (2) 字段不存在被静默过滤 / (3) 按 country 过滤丢了 `global` 部分 / (4) 用错 ID 列（手游店用了 unified_edition_id 而非 unified_id） | 先 `SELECT <known_field> LIMIT 1` 探查；按地区过滤同时报 `global` 占比；查商店表核对 references/auxiliary/id_mapping.md |

PARTITION FILTER REMINDERS (omitting these triggers 61001):

⚠️ MOST IMPORTANT — `opinion.public_feeds` requires BOTH a cluster filter AND a partition filter:
    - WHERE `unified_edition_id` = '<game_id>'   (cluster key — billion-row table, full scan without it)
    - AND   `comment_time` >= ... AND comment_time < ...  (partition key, DAY)
    Same rule applies to views built on `base_feeds`: hotness / feeds_topic / game_store_reviews /
    video_and_posts_* / official_account_*. The script emits a soft stderr warning when this is missed.

- `opinion.public_feeds.comment_time` → `TIMESTAMP`, partitioned by DAY (业务约定); clustered by `unified_edition_id` (业务约定 — 实际是 VIEW，业务侧仍按这两个键过滤).
- `opinion.kol.date` → `DATE`, partition by MONTH (`DATE_TRUNC(date, MONTH)`); clustered by `unified_edition_id, date`.
- `intelligence.news_details.release_time` → `DATETIME` (not TIMESTAMP), partition by MONTH (`DATETIME_TRUNC(release_time, MONTH)`); clustered by `unified_edition_id, release_time`.
- `intelligence.game_metric_streamhatchet_*` → no partition; clustered by `date` (_uid 系列) or `date, app_id` (原版).
- `marketing_hub.marketing_hub_video.video_release_time` → `DATETIME`, **no partition** (实测 DDL); clustered by `video_url`.
- `marketing_hub.marketing_hub_hashtag_video.video_release_time` → `DATETIME`, partition by MONTH; clustered by `channel_name, hashtag, country, video_id`.
- `marketing_hub.marketing_hub_hashtag_trending_*.date` → partition by MONTH.
- `opinion.meme_videos.release_time` → `TIMESTAMP`, partition by MONTH; clustered by `meme_title, url`.
- `opinion.store_score_*.create_time` → `DATETIME`, partition by MONTH (大多数；`_playstation` / `_meta` 为 DAY); clustered by `edition_id` / `unified_id`.
- `opinion.store_score_*_daily` 的分区字段是 **`date`**（不是 `create_time`），DATETIME, MONTH.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: pip install requests", file=sys.stderr)
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).parent))
from _utils import check_http_auth, get_host, require_token


ERROR_MESSAGES = {
    10001: "Invalid parameters",
    61001: "SQL execution timeout (常见原因：缺失分区时间过滤；缩小时间范围或加 partition column 过滤)",
    61002: "SQL syntax error",
    61003: "Security check failed (INSERT/UPDATE/DELETE/DROP 等 DDL/DML 不允许；SQL 文本中的 DML 关键字也会被拦截，比如字符串字面量里的 'CALL' 'UPDATE')",
    61004: "No database access permission (检查 game_code / database_uuid / token 是否匹配)",
    61005: "Invalid parameters (未登录或 game_code 为空)",
    61006: "System busy / rate limited (per-user concurrency ≤3, global QPS ≤50; 短暂等待后重试)",
    61007: "Internal execution failure",
}

# SQL safety pre-check — refuse obvious DDL/DML before sending to API.
# This is best-effort: API also rejects via 61003 but we save a round-trip.
_FORBIDDEN_PATTERNS = [
    r"\bINSERT\s+INTO\b",
    r"\bUPDATE\s+\w+\s+SET\b",
    r"\bDELETE\s+FROM\b",
    r"\bDROP\s+(TABLE|VIEW|DATABASE|SCHEMA)\b",
    r"\bCREATE\s+(TABLE|VIEW|DATABASE|SCHEMA|FUNCTION|PROCEDURE)\b",
    r"\bALTER\s+(TABLE|VIEW|DATABASE|SCHEMA)\b",
    r"\bTRUNCATE\s+TABLE\b",
    r"\bMERGE\s+INTO\b",
    r"\bGRANT\b",
    r"\bREVOKE\b",
]


def assert_readonly(sql: str) -> None:
    """Reject obvious DDL/DML before hitting the API."""
    upper = sql.upper()
    for pat in _FORBIDDEN_PATTERNS:
        if re.search(pat, upper):
            print(
                f"❌ Refusing to execute: SQL contains forbidden pattern matching `{pat}`. "
                "Only read-only SELECT / WITH queries are allowed.",
                file=sys.stderr,
            )
            sys.exit(2)


def warn_feeds_filters(sql: str) -> None:
    """Soft-warn (stderr only, do not block) when a SQL hits `opinion.public_feeds`
    (or its alias `opinion.feeds`) without the required cluster + partition filters.

    `opinion.public_feeds` is a VIEW (no physical BigQuery partition / cluster),
    but its underlying billion-row feeds data must be filtered by `comment_time`
    and `unified_edition_id`. Missing either filter typically causes 61001 timeout.

    This is intentionally a soft warning (not a hard reject) so legitimate
    cross-game / cross-date aggregations are still allowed — BigQuery itself will
    decide whether to timeout. The warning teaches the agent to add the filters.
    """
    upper = sql.upper()
    hits_feeds = ("PUBLIC_FEEDS" in upper) or re.search(r"\bOPINION\.FEEDS\b", upper)
    if not hits_feeds:
        return
    has_game = "UNIFIED_EDITION_ID" in upper
    has_time = "COMMENT_TIME" in upper
    if has_game and has_time:
        return
    missing = []
    if not has_game:
        missing.append("`unified_edition_id` (cluster key)")
        missing.append("    fix: add `WHERE unified_edition_id = '<game_id>'`")
    if not has_time:
        missing.append("`comment_time` (partition key)")
        missing.append("    fix: add `AND comment_time >= TIMESTAMP('<start>') AND comment_time < TIMESTAMP('<end>')`")
    print(
        "⚠ SQL hits `opinion.public_feeds` but missing required filter(s): "
        + ", ".join(m for m in missing if not m.startswith("    "))
        + ". This table is ~billion rows — missing filters typically cause 61001 timeout. "
        + "See SKILL.md top section for the full rule.",
        file=sys.stderr,
    )
    for hint in (m for m in missing if m.startswith("    ")):
        print(hint, file=sys.stderr)


def execute_sql(
    host: str,
    token: str,
    sql: str,
    game_code: str = "databrain",
    database_uuid: str = "15000",
    schema: str = "opinion",
    timeout_ms: int = 30000,
    limit: int = 3000,
) -> dict:
    url = f"{host.rstrip('/')}/api/v1/datalab/skill/exec_sql"
    auth_value = token.strip()
    if auth_value and not auth_value.lower().startswith("bearer "):
        auth_value = f"Bearer {auth_value}"

    headers = {
        "Content-Type": "application/json",
        "Authorization": auth_value,
    }
    payload = {
        "game_code": game_code,
        "database_uuid": database_uuid,
        "skill_name": "databrain-opinion-metrics-service",
        "sql": sql,
        "timeout_ms": timeout_ms,
        "limit": limit,
    }
    if schema:
        payload["schema"] = schema

    resp = requests.post(url, headers=headers, json=payload, timeout=max(timeout_ms / 1000 + 10, 60))
    check_http_auth(resp)
    resp.raise_for_status()
    try:
        return resp.json()
    except ValueError:
        raise ValueError(f"Non-JSON response from API (HTTP {resp.status_code}): {resp.text[:200]}")


def format_result(result: dict, head_only: int | None = None) -> str:
    """Format a result dict for human / terminal display.

    If ``head_only`` is set, only the first N data rows are rendered. A trailing note mentions
    how many rows were omitted. Column headers, status line, and error messages are always shown in full.
    """
    code = result.get("code", -1)

    if code != 0:
        msg = ERROR_MESSAGES.get(code, result.get("msg", "Unknown error"))
        detail = ""
        if result.get("data") and isinstance(result["data"], dict):
            detail = result["data"].get("detail", "")
        lines = [f"Execution failed (code={code}): {msg}"]
        if detail:
            lines.append(f"Detail: {detail}")
        return "\n".join(lines)

    data = result.get("data", {})
    columns = data.get("columns", [])
    rows = data.get("data") or []
    cost_time = data.get("cost_time") or 0
    count = data.get("count") or 0

    lines = []
    lines.append(f"Success | {count} rows returned | {cost_time:.2f} ms")
    lines.append("")

    if columns:
        lines.append("Columns:")
        for col in columns:
            lines.append(f"  {col.get('column_name', '?')} ({col.get('column_type', '?')})")
        lines.append("")

    if not rows:
        lines.append("(no data)")
        return "\n".join(lines)

    display_rows = rows if head_only is None else rows[:head_only]
    omitted = 0 if head_only is None else max(0, len(rows) - head_only)

    col_names = [c["column_name"] for c in columns]
    col_widths = [len(name) for name in col_names]
    for row in display_rows:
        for i, name in enumerate(col_names):
            val = str(row.get(name, ""))
            col_widths[i] = max(col_widths[i], min(len(val), 40))

    header = " | ".join(f"{name:<{col_widths[i]}}" for i, name in enumerate(col_names))
    lines.append(header)
    lines.append("-" * len(header))

    for row in display_rows:
        vals = []
        for i, name in enumerate(col_names):
            val = str(row.get(name, ""))
            if len(val) > 40:
                val = val[:37] + "..."
            vals.append(f"{val:<{col_widths[i]}}")
        lines.append(" | ".join(vals))

    if omitted:
        lines.append(f"\n... {omitted} more rows — see the spill file for full data.")
    elif count >= 1000:
        lines.append(f"\n⚠ Row count ({count}) may have hit the limit — actual data may be larger.")

    return "\n".join(lines)


# ─── Spill helpers ───────────────────────────────────────────────────────────
# Large result sets get written to a file on disk so the agent consuming stdout
# doesn't silently truncate the JSON. A small summary + head sample is printed
# to stdout instead.

def _large_tool_results_dir() -> Path:
    """Local large_tool_results dir (counterpart of the agent's /large_tool_results).

    Derived from AGENT_OUTPUT_DIR (= .../outputs/<session_id>) by going up to
    AGENT_ROOT and appending 'large_tool_results'. Falls back to ./large_tool_results
    in cwd when AGENT_OUTPUT_DIR is unset (standalone runs).
    """
    output_dir = os.environ.get("AGENT_OUTPUT_DIR", "").strip()
    if output_dir:
        return Path(output_dir).resolve().parent.parent / "large_tool_results"
    return Path.cwd() / "large_tool_results"


def _spill_path(explicit: str | None) -> tuple[str, str]:
    """Resolve ``(local_path, display_path)`` for the spill file.

    Auto location is the session's large_tool_results dir so the file persists and
    the agent can read it back via /large_tool_results/<name>. An explicit
    --output_file is honored as-is; cwd is the last-resort fallback.
    """
    if explicit:
        explicit_path = Path(explicit).expanduser()
        parent = explicit_path.parent
        if str(parent) and str(parent) != ".":
            parent.mkdir(parents=True, exist_ok=True)
        return str(explicit_path), str(explicit_path)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"opinion_sql_{ts}.json"
    local_dir = _large_tool_results_dir()
    try:
        local_dir.mkdir(parents=True, exist_ok=True)
        if not os.access(str(local_dir), os.W_OK):
            raise OSError(f"{local_dir} not writable")
    except OSError:
        print(f"⚠ {local_dir} not writable, falling back to cwd for spill file", file=sys.stderr)
        return str(Path.cwd() / filename), str(Path.cwd() / filename)
    return str(local_dir / filename), f"/large_tool_results/{filename}"


def _write_spill(result: dict, path: str) -> int:
    """Write result as pretty JSON to `path`. Returns bytes written."""
    payload = json.dumps(result, indent=2, ensure_ascii=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write(payload)
    try:
        return os.path.getsize(path)
    except OSError:
        return len(payload.encode("utf-8"))


def _fmt_size(n: int) -> str:
    if n < 1024:
        return f"{n}B"
    kb = n / 1024
    if kb < 1024:
        return f"{kb:.1f}KB"
    return f"{kb / 1024:.1f}MB"


def _build_spill_summary(
    result: dict,
    path: str,
    head_rows: int,
    fmt: str,
    spill_bytes: int,
    forced: bool = False,
) -> str:
    data = result.get("data", {}) if isinstance(result.get("data"), dict) else {}
    columns = data.get("columns", []) or []
    rows = data.get("data", []) or []
    cost_time = data.get("cost_time") or 0
    count = data.get("count") or 0

    lines = []
    if forced:
        lines.append(f"✓ Full JSON written to {path} ({_fmt_size(spill_bytes)})")
    else:
        lines.append(f"⚠ Large result — full JSON written to {path} ({_fmt_size(spill_bytes)})")
    lines.append(f"Success | {count} rows returned | {cost_time:.2f} ms")

    if columns:
        col_desc = ", ".join(
            f"{c.get('column_name', '?')} ({c.get('column_type', '?')})" for c in columns
        )
        lines.append(f"Columns: {col_desc}")

    shown = min(head_rows, len(rows))
    omitted = max(0, len(rows) - shown)
    if shown > 0:
        lines.append("")
        lines.append(f"First {shown} rows (sample):")
        if fmt == "table":
            sample = {
                "code": result.get("code", 0),
                "data": {**data, "data": rows[:shown], "count": shown},
            }
            lines.append(format_result(sample, head_only=shown))
        else:
            sample_payload = json.dumps(rows[:shown], indent=2, ensure_ascii=False)
            lines.append(sample_payload)
        if omitted > 0:
            lines.append(f"... {omitted} more rows — read the full JSON at {path}")

    return "\n".join(lines)


def main():
    def _nonneg_int(v: str) -> int:
        return max(0, int(v))

    parser = argparse.ArgumentParser(description="Execute a read-only BigQuery SQL against the opinion data schemas.")
    parser.add_argument("--game_code", default="databrain", help="Game/business code (default: databrain)")
    parser.add_argument("--database_uuid", default="15000", help="Data source identifier (default: 15000)")
    parser.add_argument("--sql", default=None, help="SQL statement")
    parser.add_argument("--sql_file", default=None, help="Read SQL from file")
    parser.add_argument(
        "--schema",
        default="opinion",
        help="Database schema (default: opinion). Use 'intelligence' for news_details / streaming tables, "
             "'marketing_hub' for industry videos/hashtags, 'common' for app_detail / country_region. "
             "You can also use fully qualified `project.dataset.table` in SQL.",
    )
    parser.add_argument("--timeout_ms", type=int, default=30000, help="Timeout in ms (default 30000, max 120000)")
    parser.add_argument("--limit", type=int, default=1000, help="Row limit (default 1000, max 5000)")
    parser.add_argument(
        "--format", "--output",
        choices=["table", "json"],
        default="json",
        help="Output format. Default `json` (no truncation). `table` is for one-off terminal display.",
    )
    parser.add_argument(
        "--output_file",
        default=None,
        help="Write full JSON result to this path; print summary + head sample to stdout. "
             "Overrides size-based auto-spill.",
    )
    parser.add_argument(
        "--max_stdout_bytes",
        type=_nonneg_int,
        default=50000,
        help="Auto-spill threshold (default 50000 bytes ~12k tokens). Set 0 to disable auto-spill.",
    )
    parser.add_argument(
        "--head_rows",
        type=_nonneg_int,
        default=10,
        help="Number of sample rows shown inline when output is spilled (default 10).",
    )

    args = parser.parse_args()

    token = require_token()
    host = get_host()

    sql = args.sql
    if args.sql_file:
        try:
            with open(args.sql_file, "r", encoding="utf-8") as f:
                sql = f.read().strip()
        except FileNotFoundError:
            print(f"Error: SQL file not found: {args.sql_file}", file=sys.stderr)
            sys.exit(1)

    if not sql:
        print("Error: provide SQL via --sql or --sql_file.", file=sys.stderr)
        sys.exit(1)

    assert_readonly(sql)
    warn_feeds_filters(sql)

    try:
        result = execute_sql(
            host=host,
            token=token,
            game_code=args.game_code,
            database_uuid=args.database_uuid,
            sql=sql,
            schema=args.schema,
            timeout_ms=args.timeout_ms,
            limit=args.limit,
        )
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}", file=sys.stderr)
        sys.exit(1)

    code = result.get("code", -1)
    rows = ((result.get("data") or {}).get("data") or []) if isinstance(result.get("data"), dict) else []
    is_error = code != 0
    is_empty = not rows

    output_json = json.dumps(result, indent=2, ensure_ascii=False)
    stdout_bytes = len(output_json.encode("utf-8"))
    auto_spill = (
        args.max_stdout_bytes > 0
        and stdout_bytes > args.max_stdout_bytes
        and not is_error
        and not is_empty
    )
    force_spill = bool(args.output_file) and not is_error and not is_empty
    should_spill = auto_spill or force_spill

    if should_spill:
        try:
            local_path, display_path = _spill_path(args.output_file)
            spill_bytes = _write_spill(result, local_path)
        except OSError as e:
            print(
                f"⚠ Failed to write spill file ({e}); falling back to inline output.",
                file=sys.stderr,
            )
        else:
            print(
                _build_spill_summary(
                    result,
                    display_path,
                    args.head_rows,
                    args.format,
                    spill_bytes,
                    forced=force_spill and not auto_spill,
                )
            )
            return

    if args.format == "json":
        print(output_json)
    else:
        print(format_result(result))


if __name__ == "__main__":
    main()
