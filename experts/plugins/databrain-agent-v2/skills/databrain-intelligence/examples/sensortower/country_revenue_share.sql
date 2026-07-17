-- Default: uses game_metric_sensortower_*_uid tables (unified_id keyed)
-- Country revenue share for a title
-- Uses window function to compute each country's % of total.
-- NOTE: execute_sql.py may reject WITH CTEs — use nested subquery if it errors.

SELECT market,
       revenue,
       SAFE_DIVIDE(revenue, SUM(revenue) OVER ()) AS share
FROM (
  SELECT market, SUM(revenue) AS revenue
  FROM intelligence.game_metric_sensortower_daily_uid
  WHERE id = ?
    AND market NOT IN ('global', 'global_wo_china')
    AND date BETWEEN ? AND ?
  GROUP BY market
)
ORDER BY revenue DESC
LIMIT 20
