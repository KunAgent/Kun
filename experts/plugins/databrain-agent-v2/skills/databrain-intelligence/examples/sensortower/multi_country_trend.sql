-- Default: uses game_metric_sensortower_*_uid tables (unified_id keyed)
-- Multi-country daily DAU trend (SEA example)
-- Adjust the market IN list for other regions.

SELECT date, market, SUM(dau) AS dau
FROM intelligence.game_metric_sensortower_daily_uid
WHERE id = ?
  AND market IN ('id', 'th', 'vn', 'ph', 'my', 'sg')
  AND date BETWEEN ? AND ?
GROUP BY date, market
ORDER BY date, market
