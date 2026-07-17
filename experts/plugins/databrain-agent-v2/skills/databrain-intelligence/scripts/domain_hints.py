"""
domain_hints.py — DataBrain business domain knowledge base

Provides DataBrain-specific context for AI SQL generation, including:
- Game ID system (unified_id / edition_id / combined_id)
- Intelligence data sources (Sensortower, VG Insights, Ampere, Streamhatchet, etc.)
- BigQuery partition field filter rules

Other modules consume this via get_hints_for_question(question) or get_domain_hint(domain).
"""

from typing import Optional

# ── Game ID system ────────────────────────────────────────────────────────────

GAME_ID_HINT = """## DataBrain Game ID System

DataBrain unifies game IDs across multiple data sources:

| ID Type | Prefix | Platform | Description |
|---------|--------|----------|-------------|
| `unified_id` | `u` | Mobile | Mobile single-platform game ID |
| `edition_id` | `e` | PC / Console | PC or Console single-platform game ID |
| `combined_id` | `c` | Cross-platform | PC + Console + Mobile merged ID |
| `unified_edition_id` | `u`/`e` | General | Alias for unified_id or edition_id |
| `app_id` | none | Raw source | Source-native ID (Steam URL, ST app ID, etc.) |

### Core lookup tables

```sql
-- Look up all app_ids for a game_id (recommended: partitioned version)
SELECT app_id
FROM common.unified_ids_part
WHERE entity_type = 'pc'
  AND unified_edition_id = '<edition_id>'

-- Look up game_id from app_id
SELECT IF(entity_type='mobile', unified_id, edition_id) AS game_id,
       entity_type, app_id
FROM common.unified_ids
WHERE app_id = '<raw_app_id>'

-- Look up three-platform IDs from combined_id
SELECT entity_name, pc_id, console_id, mobile_id
FROM common.combined_ids
WHERE combined_id = '<combined_id>'

-- Look up all app_ids from combined_id
SELECT DISTINCT app_id
FROM common.unified_combined_ids
WHERE combined_id = '<combined_id>'
```

### Key rules
- Mobile games use `unified_id` (`u` prefix); PC/Console games use `edition_id` (`e` prefix)
- Cross-platform queries: start with `combined_id`, then join per-platform data
- VG Insights Steam `app_id` is a full URL (e.g., `https://store.steampowered.com/app/730/`) — convert via `common.unified_ids`
"""

# ── Intelligence data sources ─────────────────────────────────────────────────

INTELLIGENCE_HINT = """## DataBrain Intelligence Data Sources (BigQuery)

All tables are in the `intelligence` schema of `tencent-databrain-prod` BigQuery project.
All FROM clauses must include the schema prefix (e.g., `intelligence.game_metric_sensortower_daily_uid`).

### Mobile sources

| Source | Core Table | Partition | Key Metrics |
|--------|-----------|-----------|-------------|
| Sensortower (by app_id) | `intelligence.game_metric_sensortower_daily` | `date` (monthly) | download, revenue, dau |
| Sensortower (by unified_id, daily) | `intelligence.game_metric_sensortower_daily_uid` | `date` (monthly) | download, revenue, **dau** |
| Sensortower (by unified_id, monthly) | `intelligence.game_metric_sensortower_monthly_uid` | `date` (monthly) | download, revenue, **mau** |
| AppAnnie | `intelligence.game_metric_appannie_daily/weekly/monthly` | `date` (monthly) | download, revenue, dau |

**⚠️ Sensortower field trap:**
- `dau` exists ONLY in the daily table — querying it from the monthly table returns NULL
- `mau` exists ONLY in the monthly table — the daily table has no `mau` field
- Monthly table `date` must be the 1st of the month (e.g., `'2025-03-01'`, not `'2025-03'`)
- `platform` values are lowercase: `appstore` (iOS) and `googleplay` (Android)

Metric → table decision:
- MAU → `game_metric_sensortower_monthly_uid`
- DAU / monthly avg DAU → `game_metric_sensortower_daily_uid`

### PC/Steam sources

| Source | Core Table | Key Metrics |
|--------|-----------|-------------|
| VG Insights | `intelligence.game_metric_vginsights_daily` | revenue, units_sold, dau, mau, acu, pcu, wishlists, rating |
| Gamalytic | `intelligence.game_metric_gamalytic_daily/monthly` | revenue, units_sold, owners, review_total |

VG Insights note: `app_id` is a full Steam URL — convert via `common.unified_ids`.

### Console sources

| Source | Core Table | Key Metrics |
|--------|-----------|-------------|
| Ampere | `intelligence.game_metric_ampere_daily_cid` | active_users, new_users, hours_played, bounded_N (retention) |
| GSD (Europe) | `intelligence.game_metric_gsd_weekly_uid` | digital/physical revenue & units |
| NPD (North America) | `intelligence.game_metric_npd_monthly_uid` | units_sold, revenue |
| MScience | `intelligence.game_metric_mscience_daily_uid` | units_sold, num_users, revenue |

Ampere retention fields:
- `bounded_N`: strict day-N retention (D1/D7/D14/D28/D60)
- `unbounded_N`: returned on day N or later
- Retention rate = `bounded_N / NULLIF(new_users, 0)`

### Streaming sources

| Source | Core Table | Key Metrics |
|--------|-----------|-------------|
| Streamhatchet | `intelligence.game_metric_streamhatchet_stream_uid` | hours_watched, platform (twitch/ytg/facebook) |

Streamhatchet note: `id` field = `edition_id` (not `app_id`)

### Key rules
- Every intelligence query MUST include a `date` range filter (prevents full-table scan)
- Each table uses a different ID field: check before querying
- Newzoo data stopped updating 2023-03-01; historical records remain queryable
"""

# ── BigQuery partition filter rules ──────────────────────────────────────────

PARTITION_HINT = """## BigQuery Partition Filter Rules

All intelligence tables partition by `date` (monthly). Always include a date range filter:

| Table type | Partition field | Example filter |
|------------|----------------|----------------|
| `intelligence.*` daily/weekly | `date` | `date >= '2026-03-01' AND date < '2026-04-01'` |
| `intelligence.*` monthly | `date` | `date = '2026-03-01'` (1st of month only) |
| `common.unified_ids_part` | `entity_type` | filter by `unified_edition_id` |

**If the user does not specify a time range, default to the last 30 days:**
`date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)`
"""

# ── Domain registry ───────────────────────────────────────────────────────────

_DOMAIN_REGISTRY: dict[str, str] = {
    "game_id": GAME_ID_HINT,
    "intelligence": INTELLIGENCE_HINT,
    "partition": PARTITION_HINT,
}


def get_domain_hint(domain: str) -> str:
    """
    Return the hint text for a specific domain.

    Args:
        domain: 'game_id' / 'intelligence' / 'partition'

    Returns:
        Hint text; empty string if domain not found.
    """
    return _DOMAIN_REGISTRY.get(domain, "")


def get_all_hints() -> str:
    """Return all domain hints concatenated — suitable for direct prompt injection."""
    return "\n\n".join(_DOMAIN_REGISTRY.values())


def get_hints_for_question(question: str) -> str:
    """
    Auto-select relevant domain hints based on keyword matching.

    Args:
        question: Natural language question from the user.

    Returns:
        Concatenated relevant hint text.
    """
    lower = question.lower()
    selected = []

    # Partition rules always included
    selected.append("partition")

    # Game ID related
    if any(kw in lower for kw in ["game_id", "unified_id", "edition_id", "combined_id",
                                   "app_id", "游戏id", "游戏 id", "id体系", "id 体系"]):
        selected.append("game_id")

    # Intelligence data related
    if any(kw in lower for kw in [
        "sensortower", "appannie", "vg insights", "gamalytic",
        "ampere", "gsd", "npd", "mscience", "streamhatchet",
        "情报", "下载", "收入", "dau", "mau", "销量", "留存",
        "直播", "stream", "steam", "download", "revenue", "retention",
        "units sold", "weekly", "monthly", "twitch", "youtube gaming",
        "intelligence", "market data", "ranking",
    ]):
        selected.append("intelligence")
        selected.append("game_id")  # Intelligence queries typically need ID lookups

    # Default: include intelligence for unrecognized queries (all data is intelligence domain)
    if "intelligence" not in selected:
        selected.append("intelligence")

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique = []
    for d in selected:
        if d not in seen:
            seen.add(d)
            unique.append(d)

    parts = [_DOMAIN_REGISTRY[d] for d in unique if d in _DOMAIN_REGISTRY]
    return "\n\n".join(parts)


# ── CLI entry point (debug) ───────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Print domain hints (debug)")
    parser.add_argument("--domain", default="all",
                        help="Domain: game_id / intelligence / partition / all")
    parser.add_argument("--question", default=None, help="Auto-select hints based on question")
    args = parser.parse_args()

    if args.question:
        print(get_hints_for_question(args.question))
    elif args.domain == "all":
        print(get_all_hints())
    else:
        hint = get_domain_hint(args.domain)
        if hint:
            print(hint)
        else:
            print(f"Unknown domain: {args.domain}. Available: {list(_DOMAIN_REGISTRY.keys())}")
