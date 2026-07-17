-- Default: uses game_metric_sensortower_*_uid tables (unified_id keyed)
-- Rolling last-N-days revenue / downloads for a single title
-- Replace ? with mobile_id (unified_id, u... prefix) and adjust INTERVAL as needed

SELECT SUM(revenue) AS revenue, SUM(download) AS download
FROM intelligence.game_metric_sensortower_daily_uid
WHERE id = ?
  AND market = 'global'
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND CURRENT_DATE()
