#!/usr/bin/env python3
"""
Execute a read-only SQL query.

三个关键参数的解析优先级（全部对称，低优先级自动兜底）：

  token         : CLI --token > env DATABRAIN_TOKEN（服务端 run_skill_script 注入）
                  > skill/.env DATABRAIN_TOKEN > env TAI_IT_TOKEN（旧兜底）
  host          : CLI --host  > env DATABRAIN_HOST（服务端 run_skill_script 注入）
                  > skill/.env DATABRAIN_HOST > 内置默认值
  database_uuid : CLI --database_uuid > env DATABRAIN_DATABASE_UUID（服务端注入）
                  > skill/.env DATABRAIN_DATABASE_UUID > 内置默认值 15000

Usage:
    python execute_sql.py --database_uuid 15000 --sql "SELECT * FROM table LIMIT 10"
    python execute_sql.py --database_uuid 15000 --schema intelligence --sql "SELECT * FROM table LIMIT 10"
    python execute_sql.py --database_uuid 15000 --sql_file query.sql

Large result sets are automatically spilled to /large_tool_results/execute_sql_<uuid>.json
and stdout gets a summary + first N rows sample. See --max_stdout_bytes / --output_file /
--head_rows below to control this behavior.

Common errors (CLI usage, BigQuery error codes, common SQL mistakes):

| Code / Symptom | Cause | Action |
|----------------|-------|--------|
| `unrecognized arguments: SELECT ...` (shell / argparse error, NOT a BigQuery error) | SQL passed as positional, not `--sql` | Re-run with `--sql "..."` or `--sql_file ...`. Do NOT edit the SQL — it's fine; the invocation is wrong. |
| Long string field shows trailing `...` (truncated) | Someone overrode the default with `--format table` | Drop `--format table` (script default `json` returns full values). |
| 61001 timeout | Date range too wide / missing partition filter | Narrow date range, add `date >=` filter |
| 61002 syntax error | BigQuery syntax mismatch | Check DATE_TRUNC, QUALIFY, INTERVAL; enter fix loop |
| `SELECT list expression references column X which is neither grouped nor aggregated` | A non-aggregated SELECT column is missing from `GROUP BY` | Add the column to `GROUP BY`, or wrap it in an aggregate function. For expressions, repeat the full expression in `GROUP BY` (or use ordinal positions, e.g. `GROUP BY 1, 2`). |
| `PARTITION BY expression references column X which is neither grouped nor aggregated` | Window function (`OVER (PARTITION BY X ...)`, often via `QUALIFY`) references a column missing from `GROUP BY` — same root cause as the SELECT-list variant, just inside an `OVER` clause | (1) add `X` to `GROUP BY`; or (2) wrap as `MAX(X)`/`MIN(X)` inside the window expression; or (3) compute the GROUP BY in an inner subquery, then apply the window function on the outer query (outer query has no `GROUP BY`, so any column is referenceable). |
| 61003 security check | Non-SELECT statement, **or SQL text contains a forbidden keyword substring even inside a string literal** — e.g. `'Call of Duty'` triggers `CALL`, `'patch update'` triggers `UPDATE` | (1) Never filter by game name string — resolve to `unified_id` via `search_entity.py` and filter by ID through `JOIN common.unified_ids`. (2) Remove all DML/DDL if present. |
| 61004 no permission | Wrong game_code or database_uuid | Ask user to verify both |
| 61006 rate limited | Too many concurrent queries | Retry after a short wait |
| `Not found: Table` | Missing schema prefix, wrong table name, or **CTE name treated as table** (e.g. `intelligence.params`) | Use full `schema.table` for real tables; **avoid `WITH` CTE** — use nested subqueries or inline `DATE_SUB` |
| MAU/DAU is NULL | No data for that game/period | Normal — note it in output |
| Revenue = 0 or NULL | Free-to-play or data not collected | Normal — distinguish 0 from NULL |
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import sys
import uuid
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: pip install requests", file=sys.stderr)
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).parent))
from _utils import (
    DEFAULT_DATABASE_UUID,
    check_http_auth,
    get_database_uuid,
    get_host,
    require_token,
)


ERROR_MESSAGES = {
    10001: "Invalid parameters",
    61001: "SQL execution timeout",
    61002: "SQL syntax error",
    61003: "Security check failed (INSERT/UPDATE/DELETE/DROP etc. are not allowed)",
    61004: "No database access permission",
    61005: "Invalid parameters (not logged in or game_code is empty)",
    61006: "System busy / rate limited (per-user concurrency ≤3, global QPS ≤50)",
    61007: "Internal execution failure",
}


def execute_sql(host: str, token: str, sql: str, game_code: str="databrain", database_uuid: str="15000",
                 schema: str = None, timeout_ms: int = 30000,
                limit: int = 3000) -> dict:
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
        "skill_name": "text2intelligence",
        "sql": sql,
        "timeout_ms": timeout_ms,
        "limit": limit,
    }
    if schema:
        payload["schema"] = schema

    cli_parts = [sys.executable, "execute_sql.py"]
    if schema:
        cli_parts.extend(["--schema", schema])
    cli_parts.extend(["--game_code", game_code, "--database_uuid", database_uuid])
    cli_parts.extend(["--sql", sql])
    request_detail = {
        "url": url,
        "game_code": game_code,
        "database_uuid": database_uuid,
        "schema": schema,
        "skill_name": payload["skill_name"],
        "timeout_ms": timeout_ms,
        "limit": limit,
        "sql": sql,
        "cli_command": shlex.join(cli_parts),
    }

    resp = requests.post(url, headers=headers, json=payload, timeout=max(timeout_ms / 1000 + 10, 60))
    check_http_auth(resp, request_detail=request_detail)
    resp.raise_for_status()
    try:
        return resp.json()
    except ValueError:
        raise ValueError(f"Non-JSON response from API (HTTP {resp.status_code}): {resp.text[:200]}")


def format_result(result: dict, head_only: int | None = None) -> str:
    """Format a result dict for human / terminal display.

    If ``head_only`` is set, only the first N data rows are rendered. A
    trailing note mentions how many rows were omitted. Column headers,
    status line, and error messages are always shown in full.
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

    Priority:
      1. explicit path from --output_file (used as-is; parent is created)
      2. auto path under the session's large_tool_results dir, so the file
         persists and the agent can read it back via /large_tool_results/<name>
      3. fallback ./execute_sql_<uuid4>.json in cwd when that dir is unwritable
    """
    if explicit:
        explicit_path = Path(explicit).expanduser()
        parent = explicit_path.parent
        if str(parent) and str(parent) != ".":
            parent.mkdir(parents=True, exist_ok=True)
        return str(explicit_path), str(explicit_path)

    uid = uuid.uuid4().hex
    filename = f"execute_sql_{uid}.json"
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
    """Simple human-readable size formatter (B / KB / MB)."""
    if n < 1024:
        return f"{n}B"
    kb = n / 1024
    if kb < 1024:
        return f"{kb:.1f}KB"
    return f"{kb / 1024:.1f}MB"


def _build_spill_summary(result: dict, path: str, head_rows: int, fmt: str,
                         spill_bytes: int, forced: bool = False) -> str:
    """Build the concise stdout message shown when output is spilled.

    Always prints:
      - a clearly-marked indicator line with the spill path
      - the status line (rows / cost)
      - column schema
      - first `head_rows` rows as a sample (json or table, per fmt)

    ``forced=True`` means the caller passed --output_file explicitly, so the
    message is a confirmation rather than a truncation warning.
    """
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
                # Avoid duplicate "count may have hit the limit" warnings in table formatting.
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

    parser = argparse.ArgumentParser(description="Execute a read-only SQL query")
    parser.add_argument(
        "--token", default=None,
        help="API token (raw, no Bearer prefix). "
             "Resolution: CLI > env DATABRAIN_TOKEN (auto-injected by service) "
             "> skill/.env DATABRAIN_TOKEN > env TAI_IT_TOKEN (legacy).",
    )
    parser.add_argument("--game_code", default="databrain", help="Game/business code (default: databrain)")
    parser.add_argument(
        "--database_uuid", default=None,
        help=f"Data source identifier. "
             f"Resolution: CLI > env DATABRAIN_DATABASE_UUID (auto-injected by service) "
             f"> skill/.env DATABRAIN_DATABASE_UUID > built-in default ({DEFAULT_DATABASE_UUID}).",
    )
    parser.add_argument(
        "--host", default=None,
        help="API host. "
             "Resolution: CLI > env DATABRAIN_HOST (auto-injected by service) "
             "> skill/.env DATABRAIN_HOST > built-in default (https://databrain.mcp.it.woa.com).",
    )
    parser.add_argument("--sql", default=None, help="SQL statement")
    parser.add_argument("--sql_file", default=None, help="Read SQL from file")
    parser.add_argument("--schema", default=None, help="Database schema")
    parser.add_argument("--timeout_ms", type=int, default=30000, help="Timeout in ms (default 30000, max 120000)")
    parser.add_argument("--limit", type=int, default=1000, help="Row limit (default 1000, max 5000)")
    parser.add_argument("--format", "--output", choices=["table", "json"], default="json",
                        help="Output format. Default is `json` (no truncation, programmatically parseable). "
                             "Pass `--format table` only for one-off interactive terminal display "
                             "(note: long string fields like pdf_cn / titles will be truncated with `...`).")
    parser.add_argument("--output_file", default=None,
                        help="Write full JSON result to this path and print a summary + head sample "
                             "instead of the full output to stdout. Overrides size-based auto-spill.")
    parser.add_argument("--max_stdout_bytes", type=_nonneg_int, default=50000,
                        help="Auto-spill threshold: when the JSON output would exceed this many bytes, "
                             "write the full result to /large_tool_results/execute_sql_<uuid>.json and print "
                             "only a summary + first N rows. Set 0 to disable auto-spill. Default: 50000 (~12k tokens).")
    parser.add_argument("--head_rows", type=_nonneg_int, default=10,
                        help="Number of sample rows to include inline when output is spilled. Default: 10.")

    args = parser.parse_args()

    # 三个关键值统一从子进程 env 解析，CLI 参数优先级最高
    token = require_token(args.token)
    host = get_host(args.host)
    database_uuid = get_database_uuid(args.database_uuid)

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

    try:
        result = execute_sql(
            host=host, token=token,
            game_code=args.game_code, database_uuid=database_uuid,
            sql=sql, schema=args.schema,
            timeout_ms=args.timeout_ms, limit=args.limit,
        )
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}", file=sys.stderr)
        sys.exit(1)

    # ── Decide: inline vs. spill-to-file ────────────────────────────────────
    # Never spill error responses — they are short and critical, and the agent
    # must see the full detail inline. Also never spill empty results.
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
            # Spill failed (permission denied / disk full / invalid path / ...).
            # Gracefully fall back to inline output rather than crashing the agent.
            print(
                f"⚠ Failed to write spill file ({e}); falling back to inline output.",
                file=sys.stderr,
            )
        else:
            print(_build_spill_summary(
                result, display_path, args.head_rows, args.format, spill_bytes,
                forced=force_spill and not auto_spill,
            ))
            return

    if args.format == "json":
        print(output_json)
    else:
        print(format_result(result))


if __name__ == "__main__":
    main()
