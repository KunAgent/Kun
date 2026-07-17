-- Default: uses game_metric_sensortower_*_uid tables (unified_id keyed)
-- Game-level summary with platform pivot (no specific platform requested)
-- Collapses platform into separate columns; keeps market as output dimension.
-- Replace the table name with _weekly_uid or _monthly_uid as needed (swap dau -> wau/mau).
-- WARNING: SUM(dau) across platforms may double-count (see sensortower.md Pitfall #14).

SELECT
  id,
  date,
  market,
  SUM(revenue)  AS total_revenue,
  SUM(download) AS total_downloads,
  SUM(CASE WHEN platform = 'appstore'   THEN dau ELSE 0 END) AS appstore_dau,
  SUM(CASE WHEN platform = 'googleplay' THEN dau ELSE 0 END) AS googleplay_dau,
  SUM(dau) AS total_dau  -- cross-platform sum, may double-count (Pitfall #14)
FROM intelligence.game_metric_sensortower_daily_uid
WHERE id = ?
  AND date BETWEEN ? AND ?
  -- Choose ONE of:
  -- AND market = 'global'                                          -- headline
  -- AND market = 'us'                                             -- single country
  -- AND market NOT IN ('global', 'global_wo_china')              -- country breakdown
GROUP BY id, date, market
ORDER BY date
