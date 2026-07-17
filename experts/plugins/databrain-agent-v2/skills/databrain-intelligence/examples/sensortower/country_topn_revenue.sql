-- Default: uses game_metric_sensortower_*_uid tables (unified_id keyed)
-- Country Top-N revenue for a title over a recent window
-- Excludes synthetic aggregates (global / global_wo_china) to return real countries only

SELECT market, SUM(revenue) AS revenue
FROM intelligence.game_metric_sensortower_daily_uid
WHERE id = ?
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND CURRENT_DATE()
  AND market NOT IN ('global', 'global_wo_china')
GROUP BY market
ORDER BY revenue DESC
LIMIT 10
