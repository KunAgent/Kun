# Genre Selection (shared rules)

## Decision rules (do this first)
- **preset_tags** matched → use preset_tags (highest priority)
- "**all/全部/全品类**" → no genre filter
- sub-genre breakdown ("按子品类拆分 / group by sub genre") → **filter main genre only**
- **Default** → use **IEGG** (do NOT use AppMagic unless explicitly triggered below)
- Use **AppMagic (mobile-only)** ONLY when:
  - user explicitly requests AppMagic / AM (e.g. "用 AppMagic", "AM 品类"), OR
  - user explicitly says the genre is **Casual/休闲** or **Hypercasual/超休闲**
- **Never use both (IEGG + AppMagic) in the same answer** unless the user explicitly asks for a comparison/coverage study.

## Join rules (genre fields live in detail tables)
- unified_id (`*_uid` tables, `id`) → `common.app_detail` with `id_type='unified_id'`
- combined_id (`*_cid` tables, `combined_id`) → `common.combined_detail`

Example (unified_id + IEGG):

```sql
SELECT
  d.iegg_genre AS main_genre,
  d.iegg_sub_genre AS sub_genre,
  FORMAT_DATE('%Y-%m', m.date) AS month,
  SUM(m.revenue) AS revenue
FROM intelligence.game_metric_sensortower_monthly_uid m
JOIN common.app_detail d
  ON d.app_id = m.id AND d.id_type = 'unified_id'
WHERE m.market = 'global'
  AND m.date BETWEEN '2025-01-01' AND '2025-12-01'
GROUP BY main_genre, sub_genre, month
ORDER BY revenue DESC
LIMIT 200
```

> Note: Sensortower `_uid` tables are per-platform rows; follow `_uid` aggregation rules in `references/intelligence-sources.md`.

## AppMagic selector (mobile-only, unified_id)
Use `common.app_detail.ext_json` (requires `id_type='unified_id'`). Replace ALL CAPS placeholders:

```sql
WITH candidates AS (
  SELECT DISTINCT app_id
  FROM common.app_detail
  WHERE id_type = 'unified_id'
    AND (
      CONTAINS_SUBSTR(ext_json, 'MID_CATEGORY_TOKEN')
      OR CONTAINS_SUBSTR(ext_json, 'SUB_CATEGORY_TOKEN')
    )
),
appmagic_genres AS (
  SELECT
    app_id,
    JSON_VALUE(ext_json, '$.app_magic.super_genre') AS super_genre,
    JSON_VALUE(ext_json, '$.app_magic.major_category') AS major_category,
    JSON_VALUE(ext_json, '$.app_magic.mid_category') AS mid_category,
    JSON_VALUE(ext_json, '$.app_magic.sub_category') AS sub_category
  FROM common.app_detail
  WHERE id_type = 'unified_id'
    AND app_id IN (SELECT app_id FROM candidates)
)
SELECT *
FROM appmagic_genres
WHERE super_genre = 'SUPER_GENRE'
  AND major_category = 'MAJOR_CATEGORY'
  AND (
    (mid_category = 'MID_CATEGORY_1' AND sub_category IN ('SUB_CATEGORY_1A', 'SUB_CATEGORY_1B'))
    OR (mid_category = 'MID_CATEGORY_2' AND sub_category = 'SUB_CATEGORY_2')
  )
LIMIT 5000
```

Notes:
- Use `JSON_VALUE(...) = '...'` (avoid `STRPOS(...) > 0`).
- candidates stage uses `OR` (widen pool), not `AND`.
- Do not use AppMagic for PC/Console.

## Optional `genre_type` parameter (if exists)
- default: leave empty (auto-detect)
- set `app_magic` only when user explicitly requests AppMagic/AM OR explicitly says Casual/休闲/Hypercasual/超休闲
- set `iegg` only when user explicitly requests IEGG

