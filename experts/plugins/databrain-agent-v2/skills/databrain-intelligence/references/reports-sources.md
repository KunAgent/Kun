# Reports & Platform Statistics Reference

> Coverage: DataBrain platform coverage statistics, external/internal research report metadata, and MobyGames credits crawl
> Database: `intelligence` schema, `database_uuid = 15000`

---

## 🚨 MUST-DO for report queries

**Return URLs, NOT file paths.** `pdf_cn` / `pdf_en` are **relative paths** stored in the database; they are NOT openable on their own. You MUST construct the full DataBrain preview URL for each language and give the user the URL. Pasting the raw relative path back (or listing it as "文件路径") is an incomplete answer — the user cannot click it.

### BAD — do NOT answer like this

```
- 文件路径（中文 PDF）：/intelligence/1763367274323_Grow a Garden为什么就火了.pdf
- 文件路径（英文 PDF）：/intelligence/1762323604139_en_Grow a Garden为什么就火了- 英文版 Final.pdf
- resource_id: 1985955987051253760
```

The user cannot open any of these. The answer is a dead-end.

### ✅ GOOD — answer like this

```markdown
《Grow a Garden 为什么就火了》
- 🇨🇳 中文版：https://databrain.intlgame.com/v2/intelligence/pdfPreviewDownloadLikeShare?id=171&systemId=gameResearch&resourceId=1985955987051253760&resourceName=Grow%2520a%2520Garden%25E4%25B8%25BA%25E4%25BB%2580%25E4%25B9%2588%25E5%25B0%25B1%25E7%2581%25AB%25E4%25BA%2586&resourcePath=%252Fintelligence%252F1763367274323_Grow%2520a%2520Garden%25E4%25B8%25BA%25E4%25BB%2580%25E4%25B9%2588%25E5%25B0%25B1%25E7%2581%25AB%25E4%25BA%2586.pdf&resourceLike=0&downloadLogKey=gameResearchDownload&lang=cn&referer=%252Fintelligence%252FgameResearchReport
- 🇺🇸 English：https://databrain.intlgame.com/v2/intelligence/pdfPreviewDownloadLikeShare?id=171&systemId=gameResearch&resourceId=1985955987051253760&...&lang=en&...
```

(In a Markdown render, wrap as `[中文版](https://…)` / `[English](https://…)`.)

### The one-liner workflow — use `scripts/build_report_url.py`

Do NOT do double-URL-encoding by hand. Use the helper:

```bash
# Option 1: pass fields individually
python scripts/build_report_url.py \
  --id 171 --system gameResearch --resource_id 1985955987051253760 \
  --title "Grow a Garden为什么就火了" \
  --pdf_path "/intelligence/1763367274323_Grow a Garden为什么就火了.pdf" \
  --report_like 0 --lang cn

# Option 2 (recommended in-agent): feed the JSON row straight from execute_sql.py
python scripts/build_report_url.py \
  --json_row "$(jq '.data.data[0]' /large_tool_results/report.json)" --lang cn
python scripts/build_report_url.py \
  --json_row "$(jq '.data.data[0]' /large_tool_results/report.json)" --lang en
```

The helper handles double URL-encoding internally, picks the right `title_cn`/`title_en` + `pdf_cn`/`pdf_en` column based on `--lang`, and prints the full clickable URL on stdout.

### Required SELECT columns (for the helper to succeed)

| Table | Required columns |
|-------|------------------|
| `intelligence.t_intelligence_research_report` | `id`, `system`, `resource_id`, `title_cn`, `title_en`, `pdf_cn`, `pdf_en`, `report_like`, `download_enable` |
| `intelligence.t_data_brain_report_info` | `id`, `resource_id`, `file_name`, `file_name_en`, `attachment` |

If any of these columns are missing from the query result, `build_report_url.py` cannot succeed — go back to Phase 2 and re-query with the full SELECT list.

### Rule of "delivered"

A report answer is **not delivered** until:
1. You have run `build_report_url.py` for each language the report has (at least one of `lang=cn` / `lang=en`),
2. You have put the resulting URL(s) in the user-facing text,
3. You did NOT paste the raw `pdf_cn` / `pdf_en` relative path as the answer.

If any of the above is missing, go back to Phase 2.

---

## Table of Contents

- [Source Overview](#source-overview)
- [Tables](#tables)
  - [statistics_latest](#statistics_latest)
  - [statistics_monthly](#statistics_monthly)
  - [t_data_brain_report_info](#t_data_brain_report_info)
  - [t_intelligence_research_report](#t_intelligence_research_report)
  - [t_spider_mobygame](#t_spider_mobygame)
- [Key Dimensions](#key-dimensions)
- [Common Query Patterns](#common-query-patterns)
- [Pitfalls & Notes](#pitfalls--notes)

---

## Source Overview

| Table | Purpose | Partition |
|-------|---------|-----------|
| `intelligence.statistics_latest` | Latest platform coverage counters (single snapshot) | none |
| `intelligence.statistics_monthly` | Monthly time series of coverage counters | none (`date` is STRING) |
| `intelligence.t_data_brain_report_info` | External / third-party intelligence reports (Sensor Tower, Stream Hatchet, AppMagic, etc.) | none (use `create_time`) |
| `intelligence.t_intelligence_research_report` | Internal research reports (agility, IP, weekly) | none (use `create_time`) |
| `intelligence.t_spider_mobygame` | MobyGames.com crawled credits (game → team members) | none |

---

## Tables

### statistics_latest

**Platform coverage — latest snapshot**. Each row is a named metric (e.g. tracked games per source) with its current count.

**Full table**: `intelligence.statistics_latest`

| Field | Type | Description |
|-------|------|-------------|
| `name` | STRING | Metric name (e.g. `po_steam_total_games`, `newzoo_monthly_games`, `top_mobile_games`) |
| `value` | INT64 | Current count |

**Use cases**: "How many Steam games does DataBrain cover?", "How many mobile games are tracked?"

---

### statistics_monthly

**Platform coverage — monthly time series**. Tracks how coverage grows over time.

**Full table**: `intelligence.statistics_monthly`

| Field | Type | Description |
|-------|------|-------------|
| `date` | STRING | Month (`YYYY-MM-01` **string, NOT DATE**) |
| `name` | STRING | Metric name (same namespace as `statistics_latest`) |
| `value` | INT64 | Count for that month |

**Use cases**: "Monthly trend of tracked PC games", "How has mobile coverage grown month over month?"

---

### t_data_brain_report_info

**External / third-party intelligence reports** — metadata for reports collected from outside sources (Sensor Tower, Stream Hatchet, AppMagic, Compliance, Market reports, etc.). Includes titles, tags, engagement metrics, and creator info.

> **⚠️ MUST include `resource_id`, `attachment`, and `file_name` in every SELECT that returns these reports to the user.** This table has no direct `pdf_*` columns — the user needs `resource_id` / `attachment` / `file_name` to locate and download the report. Without them the result is unactionable.

**Full table**: `intelligence.t_data_brain_report_info`

| Field | Type | Description |
|-------|------|-------------|
| `id` | INT64 | Report ID |
| `resource_id` | STRING | Resource identifier |
| `file_name` | STRING | File name (CN) |
| `file_name_en` | STRING | File name (EN) |
| `system` | STRING | System |
| `title` | STRING | Report title (CN) |
| `title_en` | STRING | Report title (EN) |
| `introduction` | STRING | Report summary (CN) |
| `introduction_en` | STRING | Report summary (EN) |
| `report_type` | STRING | Report type (e.g. `月度报告`) |
| `report_type_en` | STRING | Report type (EN) |
| `cover` | STRING | Cover image URL |
| `source` | STRING | Source (e.g. `Sensor Tower`, `Stream Hatchet`, `AppMagic`, `Compliance`, `Market`) |
| `role_id` | STRING | Role ID |
| `type` | STRING | Type |
| `tag` | STRING | Tags (CN, comma-separated) |
| `tag_en` | STRING | Tags (EN) |
| `download` | INT64 | Download count |
| `download_enable` | INT64 | Download-enabled flag |
| `wartermark_enable` | INT64 | Watermark-enabled flag |
| `creator_name` | STRING | Creator name (CN) |
| `creator_name_en` | STRING | Creator name (EN) |
| `creator_head_picture` | STRING | Creator avatar URL |
| `creator_department` | STRING | Creator department (CN) |
| `creator_department_en` | STRING | Creator department (EN) |
| `report_like` | INT64 | Like count |
| `report_watched` | INT64 | View count |
| `report_forward` | INT64 | Forward / share count |
| `create_time` | DATETIME | Creation time |
| `update_time` | DATETIME | Last update time |
| `report_language` | STRING | Report language (CN) |
| `report_language_en` | STRING | Report language (EN) |
| `attachment` | STRING | Attachment info |
| `sub_source` | STRING | Sub-source |
| `email` | STRING | Creator email |

**Use cases**: "What reports did DataBrain collect about Sensor Tower this month?", "Most downloaded reports", "Search reports by tag", "Report count by source".

---

### t_intelligence_research_report

**Internal intelligence research reports** — produced by the team (agility reports, IP reports, weekly reports, etc.). Bilingual (CN/EN) metadata with PDF links.

> **⚠️ The `pdf_cn` / `pdf_en` columns are RELATIVE PATHS, not direct URLs.** Every SELECT that returns these reports to the user must pull **all** of the following columns so that the openable URL can be constructed downstream: `id`, `system`, `resource_id`, `title_cn`, `title_en`, `pdf_cn`, `pdf_en`, `report_like`, `download_enable`. See [PDF Preview/Download Link Construction](#pdf-previewdownload-link-construction).

**Full table**: `intelligence.t_intelligence_research_report`

| Field | Type | Description |
|-------|------|-------------|
| `id` | INT64 | Report ID |
| `system` | STRING | System |
| `resource_id` | INT64 | Resource ID |
| `pdf_en` | STRING | English PDF URL |
| `pdf_cn` | STRING | Chinese PDF URL |
| `title_cn` | STRING | Report title (CN) |
| `title_en` | STRING | Report title (EN) |
| `abstract_cn` | STRING | Abstract (CN) |
| `abstract_en` | STRING | Abstract (EN) |
| `report_type` | STRING | Report type (e.g. `周度报告`) |
| `report_type_en` | STRING | Report type (EN) |
| `cover` | STRING | Cover image URL |
| `language_cn` | STRING | Language label (CN) |
| `language_en` | STRING | Language label (EN) |
| `segment` | STRING | Segment / category (e.g. `IP Reports`, `敏捷报告 Agility Report`) |
| `segment_en` | STRING | Segment (EN) |
| `role_id` | STRING | Role ID |
| `tag_cn` | STRING | Tags (CN, pipe-separated `\|`) |
| `tag_en` | STRING | Tags (EN) |
| `download_enable` | INT64 | Download-enabled flag |
| `watermark_enable` | INT64 | Watermark-enabled flag |
| `creator_name` | STRING | Creator name (CN) |
| `creator_name_en` | STRING | Creator name (EN) |
| `creator_head_picture` | STRING | Creator avatar URL |
| `creator_department` | STRING | Creator department (CN) |
| `creator_department_en` | STRING | Creator department (EN) |
| `report_like` | INT64 | Like count |
| `report_watched` | INT64 | View count |
| `report_forward` | INT64 | Forward / share count |
| `create_time` | TIMESTAMP | Creation time |
| `update_time` | TIMESTAMP | Last update time |
| `email` | STRING | Creator email |

**Use cases**: "Latest agility reports", "Roblox-related research reports", "Most viewed internal reports", "IP weekly reports from last month".

#### PDF Preview/Download Link Construction

The `pdf_cn` / `pdf_en` fields store **relative paths** (e.g. `/intelligence/1776xxx_report.pdf`). The correct access URL is NOT a direct COS link — it must be constructed via the DataBrain PDF preview endpoint.

**🛠️ Recommended: use [`scripts/build_report_url.py`](../scripts/build_report_url.py)** — it handles double URL-encoding and picks the right `title_cn` / `title_en` + `pdf_cn` / `pdf_en` column based on `--lang`. See the [MUST-DO block](#-must-do-for-report-queries) at the top of this file for invocation examples. The manual template below is kept for reference only.

**Manual template** (for reference — prefer the helper):

```
/v2/intelligence/pdfPreviewDownloadLikeShare?
  id            = {id}
  systemId      = {system}
  resourceId    = {resource_id}
  resourceName  = {double_urlencode(title_cn or title_en)}
  resourcePath  = {double_urlencode(pdf_cn or pdf_en)}
  resourceLike  = {report_like}
  downloadLogKey= {system}Download
  lang          = cn   (or "en" for English version)
  referer       = %252Fintelligence%252FgameResearchReport
```

**Key rule — double URL encoding**: all parameter *values* that contain `/`, Chinese characters, spaces, or special chars must be URL-encoded **twice** (i.e. `%` itself becomes `%25`):
- `/intelligence/foo.pdf` → first encode → `%2Fintelligence%2Ffoo.pdf` → encode again → `%252Fintelligence%252Ffoo.pdf`
- Spaces → `%20` → `%2520`
- Chinese chars → `%EX%XX` → `%25EX%25XX`

**Example** (ID 171, English):
```
/v2/intelligence/pdfPreviewDownloadLikeShare?id=171&systemId=gameResearch&resourceId=2043612014944718848&resourceName=Roblox%2520Bi-weekly%2520MOD%2520Collection%2520Recap%2520%28Nov%25202025%2520%E2%80%93%2520Mar%25202026%29&resourcePath=%252Fintelligence%252F1776070295191_en_%25E3%2580%2590GRC%25E3%2580%2591Roblox%25E5%258F%258C%25E5%2591%25A8%25E6%258A%25A5%25E5%2590%2588%25E9%259B%2586_2511_2603.%2520EN2.pdf&resourceLike=0&downloadLogKey=gameResearchDownload&lang=en&referer=%252Fintelligence%252FgameResearchReport
```

**Note**: `download_enable = 0` means the platform may restrict direct download; user must be logged into DataBrain to access.

---

### t_spider_mobygame

**MobyGames.com crawled data** — game credits and team member information. May be sparsely populated.

**Full table**: `intelligence.t_spider_mobygame`

| Field | Type | Description |
|-------|------|-------------|
| `count` | STRING | Count (string) |
| `md5` | STRING | MD5 hash |
| `game_name` | STRING | Game name |
| `web_game_name` | STRING | Game name as on MobyGames |
| `member` | STRING | Team member name |
| `top_credit` | STRING | Top credit / role |
| `credit` | STRING | Full credit info |
| `game_url` | STRING | MobyGames URL |

**Use cases**: "Who worked on game X (credits)?", "Find team members for a specific game".

---

## Key Dimensions

### `statistics_*.name` examples

Coverage counters (shared by both `statistics_latest` and `statistics_monthly`):

- `po_steam_total_games` — total Steam games tracked
- `po_app_store_total_games` — total App Store games tracked
- `po_google_play_total_games` — total Google Play games tracked
- `po_metacritic_total_games` — total Metacritic games tracked
- `top_mobile_games` / `top_pc_games` / `top_console_games` — top games by platform
- `pc_games` / `console_games` — total tracked per platform
- `mobile_updates` / `pc_updates` / `console_updates` — update counts
- `newzoo_monthly_games` / `Famitsu_monthly_games` — source-specific counts
- `company_coverage_mobile` / `company_coverage_pc_console` — company coverage
- `VGInsights_monthly_games` — **legacy, value = 0** (do not use; underlying data source revoked — see [deprecated-tables.md](deprecated-tables.md#steam-vg-insights--deprecated))

### `t_data_brain_report_info.source` values

- `Sensor Tower`
- `Stream Hatchet`
- `AppMagic`
- `Compliance`
- `Market`
- Others may exist — enumerate with `GROUP BY source`

### `t_intelligence_research_report.segment` values

- `IP Reports`
- `敏捷报告 Agility Report`
- Others may exist — enumerate with `GROUP BY segment`

### Tag delimiters

- `t_data_brain_report_info.tag` / `tag_en` — **comma-separated**
- `t_intelligence_research_report.tag_cn` / `tag_en` — **pipe-separated (`|`)**

---

## Common Query Patterns

### 1. Latest coverage counter

```sql
SELECT name, value
FROM intelligence.statistics_latest
WHERE name = 'po_steam_total_games'
```

### 2. Monthly coverage trend

```sql
SELECT date, value
FROM intelligence.statistics_monthly
WHERE name = 'pc_games'
  AND date >= '2025-01-01'
ORDER BY date
```

### 3. Reports from a specific external source (last 30 days)

```sql
SELECT id, title, title_en, source, create_time, download, report_watched,
       resource_id, attachment, file_name, file_name_en          -- link columns: MUST include
FROM intelligence.t_data_brain_report_info
WHERE source = 'Sensor Tower'
  AND CAST(create_time AS DATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
ORDER BY create_time DESC
LIMIT 50
```

### 4. Most-downloaded external reports

```sql
SELECT title, title_en, source, download, report_watched, create_time,
       resource_id, attachment, file_name, file_name_en          -- link columns: MUST include
FROM intelligence.t_data_brain_report_info
ORDER BY download DESC
LIMIT 20
```

### 5. Internal research reports by tag

```sql
SELECT id, system, resource_id,                                  -- URL build: identifiers
       title_cn, title_en,                                        -- URL build: resourceName source
       pdf_cn, pdf_en,                                            -- URL build: resourcePath source
       report_like, download_enable,                              -- URL build: resourceLike + access hint
       segment, tag_cn, create_time, report_watched               -- display / filtering
FROM intelligence.t_intelligence_research_report
WHERE tag_cn LIKE '%Roblox%'
ORDER BY create_time DESC
LIMIT 20
```

### 6. Internal reports by segment (agility / IP / weekly)

```sql
SELECT id, system, resource_id,                                  -- URL build: identifiers
       title_cn, title_en,                                        -- URL build: resourceName source
       pdf_cn, pdf_en,                                            -- URL build: resourcePath source
       report_like, download_enable,                              -- URL build: resourceLike + access hint
       segment, create_time, report_watched                       -- display
FROM intelligence.t_intelligence_research_report
WHERE segment LIKE '%Agility%'
  AND CAST(create_time AS DATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
ORDER BY create_time DESC
LIMIT 30
```

### 7. MobyGames credits for a specific game

```sql
SELECT game_name, member, top_credit, credit, game_url
FROM intelligence.t_spider_mobygame
WHERE LOWER(game_name) LIKE '%diablo%'
LIMIT 50
```

---

## Pitfalls & Notes

1. **🚨 Return URLs, never file paths**: `pdf_cn` / `pdf_en` are relative paths. Always run the query with the full required SELECT list, then run `scripts/build_report_url.py` (once per language) to get the openable URL. **Pasting the raw `pdf_cn` / `pdf_en` path back to the user is a broken answer** — see the MUST-DO block at the top of this file for BAD vs GOOD examples.

2. **`statistics_monthly.date` is STRING** (`YYYY-MM-01`), not DATE. Use lexical comparison (`date >= '2025-01-01'`) or `PARSE_DATE('%Y-%m-%d', date)` for DATE semantics.

3. **No date-partitioned report tables**: `t_data_brain_report_info` and `t_intelligence_research_report` do not have a `date` partition. Filter by `create_time` (or `update_time`), and wrap in `CAST(create_time AS DATE)` for DATE comparison.

4. **Tag delimiter differs between report tables**:
   - External: `t_data_brain_report_info.tag` is comma-separated
   - Internal: `t_intelligence_research_report.tag_cn` is pipe-separated (`|`)
   Use `LIKE '%keyword%'` for substring matches, or `SPLIT` + `UNNEST` with the correct delimiter for exact matches.

5. **`VGInsights_monthly_games` is a legacy metric with value = 0**: exclude it when listing non-zero coverage counters.

6. **MobyGames table can be sparsely populated**: `t_spider_mobygame` may have no rows for many games. Check row count before relying on it for a specific title.

7. **Field-name typos kept as-is**: `t_data_brain_report_info.wartermark_enable` is misspelled in the schema — use the column name verbatim, do not "correct" it to `watermark_enable` (note: internal table uses the correctly-spelled `watermark_enable`).

8. **Metric name namespace is shared but not identical**: `statistics_latest` and `statistics_monthly` both use the `name` column, but the exact set of metric names may differ — enumerate each with `SELECT DISTINCT name` before assuming coverage.

9. **Report `download` / `report_watched` / `report_like` / `report_forward` are engagement counters**: use `ORDER BY` + `LIMIT` for "top reports" queries; avoid `SUM` unless aggregating across a filtered set.
