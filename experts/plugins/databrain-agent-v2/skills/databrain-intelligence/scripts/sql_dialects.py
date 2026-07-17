"""
sql_dialects.py — BigQuery SQL dialect reference (single source of truth)

Provides BigQuery-specific syntax hints for AI SQL generation.
All intelligence data tables are in BigQuery (tencent-databrain-prod project).

Other modules consume this via get_hint() / get_full_hint().
"""

# ── Common rules (apply to all queries) ──────────────────────────────────────

COMMON_RULES = [
    "Generate only SELECT / WITH...SELECT — no DDL or DML",
    "SQL must end with LIMIT (default 5000)",
    "All FROM clauses must include schema.table prefix — bare table names are not valid in BigQuery",
    "Aggregation queries require GROUP BY; every non-aggregated SELECT column must appear in GROUP BY",
    "Declare aliases explicitly with the AS keyword",
    "Use IS NULL / IS NOT NULL for NULL comparisons — never = NULL",
    "String literals use single quotes",
    "Always filter the `date` partition field to avoid full-table scans",
]

# ── BigQuery dialect definition ───────────────────────────────────────────────

BIGQUERY = {
    "label": "BigQuery",
    "date_recent_n": "DATE_SUB(CURRENT_DATE(), INTERVAL n DAY)",
    "date_format": "FORMAT_DATE('%Y-%m-%d', dt)",
    "date_trunc": "DATE_TRUNC(dt, DAY)  -- note: (date, part) order, not ('part', date)",
    "date_diff": "DATE_DIFF(end_date, start_date, DAY)",
    "month_trunc": "DATE_TRUNC(dt, MONTH)",
    "cast_to_str": "CAST(x AS STRING)",
    "cast_to_int": "CAST(x AS INT64)",
    "cast_to_float": "CAST(x AS FLOAT64)",
    "string_concat": "CONCAT(a, b)",
    "string_length": "LENGTH(s)",
    "string_substr": "SUBSTR(s, pos, len)",
    "string_trim": "TRIM(s)",
    "string_upper": "UPPER(s)",
    "null_coalesce": "IFNULL(x, default) or COALESCE(x, default)",
    "null_if": "NULLIF(x, val)",
    "conditional": "IF(cond, then, else) or CASE WHEN",
    "count_if": "COUNTIF(condition)",
    "limit_syntax": "LIMIT n",
    "from_style": "schema.table_name (schema prefix REQUIRED)",
    "window_qualify": "QUALIFY ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...) = 1",
    "window_row_number": "ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)",
    "approx_distinct": "APPROX_COUNT_DISTINCT(x)",
    "array_agg": "ARRAY_AGG(x) or STRING_AGG(x, ',')",
    "unnest": "UNNEST([val1, val2]) AS alias  -- use in CTE to pass ID lists",
    "json_extract": "JSON_EXTRACT_SCALAR(json_col, '$.key')",
    "notes": [
        "QUALIFY is supported — filter window function results without a subquery",
        "DATE_TRUNC(dt, DAY) — argument order is (date, part), the reverse of PostgreSQL",
        "FROM must include schema.table — schema prefix cannot be omitted",
        "INTERVAL n DAY — no quotes needed (unlike PostgreSQL's INTERVAL 'n days')",
        "COUNTIF(condition) is available as a shorthand for SUM(IF(condition, 1, 0))",
        "Prefer <> over != for inequality comparisons",
        "Use UNNEST([...]) CTE to pass lists of IDs without a temp table",
    ],
}


def get_hint() -> str:
    """Return a one-line BigQuery dialect hint for inline schema context."""
    items = [
        f"Last N days: {BIGQUERY['date_recent_n']}",
        f"Date trunc: DATE_TRUNC(dt, DAY)",
        f"FROM: schema.table required",
        "QUALIFY supported",
    ]
    return f"BigQuery dialect — " + "; ".join(items)


def get_common_rules() -> str:
    """Return common SQL rules as a bulleted string for prompt injection."""
    return "\n".join(f"- {r}" for r in COMMON_RULES)


def get_full_hint() -> str:
    """Return the full BigQuery dialect reference for complete context scenarios."""
    lines = ["## BigQuery SQL Dialect Reference"]
    keys = [
        ("date_recent_n", "Last N days"),
        ("date_format", "Date format"),
        ("date_trunc", "Date truncation (day)"),
        ("month_trunc", "Date truncation (month)"),
        ("date_diff", "Date diff"),
        ("cast_to_str", "Cast to string"),
        ("cast_to_int", "Cast to int"),
        ("cast_to_float", "Cast to float"),
        ("string_concat", "String concat"),
        ("string_substr", "Substring"),
        ("null_coalesce", "NULL coalesce"),
        ("null_if", "NULLIF"),
        ("conditional", "Conditional"),
        ("count_if", "Count if"),
        ("limit_syntax", "LIMIT syntax"),
        ("from_style", "FROM style"),
        ("window_qualify", "QUALIFY filter"),
        ("window_row_number", "ROW_NUMBER window"),
        ("approx_distinct", "Approx distinct"),
        ("array_agg", "Array/string agg"),
        ("unnest", "Unnest array/list"),
        ("json_extract", "JSON extract"),
    ]
    for key, name in keys:
        val = BIGQUERY.get(key, "")
        if val:
            lines.append(f"- **{name}**: `{val}`")
    notes = BIGQUERY.get("notes", [])
    if notes:
        lines.append("\n**Notes:**")
        for n in notes:
            lines.append(f"- {n}")
    return "\n".join(lines)


# ── Backward-compatible shims (for callers that pass a driver string) ─────────

def get_hint_for_driver(driver: str) -> str:
    """Backward-compatible shim — always returns the BigQuery hint regardless of driver."""
    return get_hint()


def get_full_hint_for_driver(driver: str) -> str:
    """Backward-compatible shim — always returns the BigQuery full hint."""
    return get_full_hint()
