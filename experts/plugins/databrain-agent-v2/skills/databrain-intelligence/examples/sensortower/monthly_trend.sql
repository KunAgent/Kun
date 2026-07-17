-- Default: uses game_metric_sensortower_*_uid tables (unified_id keyed)
-- Unified monthly trend for a title (iOS + Android combined)
-- SUM(revenue/download) gives cross-platform totals; SUM(mau) is summed across platforms
-- (same user may be counted on both iOS and Android — label as "iOS+Android summed" if reporting externally)

SELECT date,
       SUM(revenue)  AS revenue,
       SUM(download) AS download,
       SUM(mau)      AS mau
FROM intelligence.game_metric_sensortower_monthly_uid
WHERE id = ?
  AND market = 'global'
  AND date BETWEEN '2024-01-01' AND CURRENT_DATE()
GROUP BY date
ORDER BY date
