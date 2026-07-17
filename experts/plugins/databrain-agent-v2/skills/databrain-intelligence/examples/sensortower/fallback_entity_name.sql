-- EXCEPTION: uses raw table game_metric_sensortower_monthly (no _uid) — fallback when _uid rows are missing for a title
-- Fallback when _uid tables return zero rows
-- Some older / multi-edition games have a valid unified_id but no rows in *_uid views.
-- Retry on the raw table using entity_name LIKE matching.

SELECT date, platform, market, SUM(revenue) AS revenue, SUM(download) AS download
FROM intelligence.game_metric_sensortower_monthly
WHERE LOWER(entity_name) LIKE '%paper.io%'
  AND market = 'global'
  AND date BETWEEN ? AND ?
GROUP BY date, platform, market
ORDER BY date
