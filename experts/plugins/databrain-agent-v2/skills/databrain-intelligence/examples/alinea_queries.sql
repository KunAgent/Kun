-- Alinea Analytics (Steam) — ready-to-run BigQuery patterns
-- Tables: intelligence.game_metric_alinea_daily_cid | _monthly_cid
-- Reference (schema, freshness, pitfalls): references/alinea.md
--
-- ⚠️ execute_sql.py sends the ENTIRE file as one query — that WILL FAIL (multi-SELECT).
-- Copy ONE "-- Pattern N" block only, e.g.:
--   python scripts/execute_sql.py --sql "$(sed -n '7,18p' examples/alinea_queries.sql)"
-- Do NOT: python scripts/execute_sql.py --sql_file examples/alinea_queries.sql
--
-- ⚠️ Do NOT use `WITH ... AS (CTE)` in SQL sent via execute_sql.py — the API rewrites CTE
-- names to `schema.cte_name` tables (404 e.g. intelligence.params). Patterns 5–6 use
-- nested subqueries and inline DATE_SUB(CURRENT_DATE(), ...) instead.

-- ── Pattern 1: Single game, headline snapshot ───────────────────────────────
SELECT date,
       pcu, acu, dau,
       revenue AS daily_revenue,
       units_sold AS daily_units,
       revenue_total AS cumulative_revenue,
       units_sold_total AS cumulative_units,
       wishlists_total, followers_total, price
FROM intelligence.game_metric_alinea_daily_cid
WHERE combined_id = 'c00001765'          -- CS2
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY) AND CURRENT_DATE()
ORDER BY date DESC
LIMIT 5

-- ── Pattern 2: Daily trend (last 30 days, DoD on PCU) ───────────────────────
SELECT date,
       pcu,
       pcu - LAG(pcu) OVER (ORDER BY date) AS pcu_dod,
       dau,
       revenue AS daily_revenue,
       units_sold AS daily_units,
       wishlists_total
FROM intelligence.game_metric_alinea_daily_cid
WHERE combined_id = 'c00001765'
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND CURRENT_DATE()
ORDER BY date DESC
LIMIT 60

-- ── Pattern 3: Monthly aggregation (_monthly_cid, includes MAU) ─────────────
SELECT FORMAT_DATE('%Y-%m', date) AS month,
       pcu, acu, mau,
       revenue, units_sold, revenue_total, units_sold_total,
       wishlists_total, followers_total
FROM intelligence.game_metric_alinea_monthly_cid
WHERE combined_id = 'c00001765'
  AND date BETWEEN '2025-01-01' AND CURRENT_DATE()
ORDER BY month DESC
LIMIT 24

-- ── Pattern 4: Top-N Steam games (T-1 PCU; JOIN for names) ──────────────────
SELECT a.combined_id, d.entity_name, d.publisher,
       a.pcu, a.acu, a.dau,
       a.revenue AS daily_revenue,
       a.wishlists_total, a.followers_total
FROM intelligence.game_metric_alinea_daily_cid a
LEFT JOIN common.combined_detail d USING (combined_id)
WHERE a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
  AND a.pcu IS NOT NULL
ORDER BY a.pcu DESC
LIMIT 50

-- ── Pattern 5: Dashboard snapshot + T-1 DoD reference ─────────────────────────
-- query_date = yesterday (T-1); no WITH — execute_sql API breaks CTE names
SELECT
  a.combined_id, d.entity_name, d.developer, d.publisher,
  d.iegg_genre, d.tag_list, d.cover,
  COALESCE(NULLIF(d.release_date_str, ''), NULLIF(d.release_date, '')) AS release_date,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN a.pcu              END) AS pcu,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN a.acu              END) AS acu,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN a.dau              END) AS dau,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN a.revenue          END) AS daily_revenue,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN a.units_sold       END) AS daily_units,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN a.revenue_total    END) AS cumulative_revenue,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN a.units_sold_total END) AS cumulative_units,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN a.wishlists_total  END) AS wishlists_total,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN a.followers_total  END) AS followers,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY) THEN a.pcu             END) AS pcu_prev,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY) THEN a.acu             END) AS acu_prev,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY) THEN a.revenue         END) AS daily_revenue_prev,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY) THEN a.units_sold      END) AS daily_units_prev,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY) THEN a.wishlists_total END) AS wishlists_total_prev,
  MAX(CASE WHEN a.date = DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY) THEN a.followers_total END) AS followers_prev
FROM intelligence.game_metric_alinea_daily_cid a
LEFT JOIN common.combined_detail d USING (combined_id)
WHERE a.date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
                 AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
GROUP BY a.combined_id, d.entity_name, d.developer, d.publisher,
         d.iegg_genre, d.tag_list, d.release_date_str, d.release_date, d.cover
ORDER BY pcu DESC NULLS LAST
LIMIT 200

-- ── Pattern 6: Upcoming Steam games (未上线), ranked by wishlists ───────────
-- release_date from combined_detail (fuzzy STRING) — NOT pconsole.release_date (DATE)
-- Nested subqueries only (no WITH) — see file header re: execute_sql + CTE 404
SELECT
  g.combined_id,
  g.entity_name,
  g.developer,
  g.publisher,
  g.iegg_genre,
  g.release_date_raw,
  g.release_date_norm,
  s.wishlists_total,
  s.follower_total
FROM (
  SELECT
    catalog.*,
    SAFE.PARSE_DATE('%Y-%m-%d',
      CASE
        WHEN REGEXP_CONTAINS(release_date_raw, r'^[0-9]{4}$')
          THEN CONCAT(release_date_raw, '-12-31')
        WHEN REGEXP_CONTAINS(release_date_raw, r'^[0-9]{4}-Q[1-4]$')
          THEN CONCAT(
            SUBSTR(release_date_raw, 1, 4),
            CASE SUBSTR(release_date_raw, 7, 1)
              WHEN '1' THEN '-03-31' WHEN '2' THEN '-06-30'
              WHEN '3' THEN '-09-30' WHEN '4' THEN '-12-31'
            END)
        WHEN REGEXP_CONTAINS(release_date_raw, r'^[0-9]{4}-[0-9]{2}-[0-9]{2}')
          THEN SUBSTR(release_date_raw, 1, 10)
        ELSE NULL
      END
    ) AS release_date_norm
  FROM (
    SELECT
      c.combined_id,
      c.entity_name,
      c.developer,
      c.publisher,
      c.iegg_genre,
      c.cover,
      NULLIF(TRIM(COALESCE(NULLIF(c.release_date_str, ''), NULLIF(c.release_date, ''))), '') AS release_date_raw
    FROM common.combined_detail c
    WHERE c.steam_id IS NOT NULL
      AND REGEXP_CONTAINS(LOWER(c.platform), r'(steam|pc)')
  ) catalog
) g
LEFT JOIN (
  SELECT
    a.combined_id,
    MAX_BY(a.pcu,              IF(a.pcu              IS NOT NULL, a.date, NULL)) AS latest_pcu,
    MAX_BY(a.wishlists_total,  IF(a.wishlists_total  IS NOT NULL, a.date, NULL)) AS wishlists_total,
    MAX_BY(a.followers_total,  IF(a.followers_total  IS NOT NULL, a.date, NULL)) AS follower_total
  FROM intelligence.game_metric_alinea_daily_cid a
  WHERE a.date BETWEEN DATE_SUB(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 30 DAY)
                   AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
  GROUP BY a.combined_id
) s ON s.combined_id = g.combined_id
WHERE COALESCE(s.latest_pcu, 0) = 0
  AND (g.release_date_norm IS NULL
       OR g.release_date_norm > DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))
ORDER BY s.wishlists_total DESC NULLS LAST,
         s.follower_total  DESC NULLS LAST,
         g.release_date_norm ASC NULLS LAST
LIMIT 100
