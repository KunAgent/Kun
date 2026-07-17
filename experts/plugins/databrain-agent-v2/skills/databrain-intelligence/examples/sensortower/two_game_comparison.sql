-- Default: uses game_metric_sensortower_*_uid tables (unified_id keyed)
-- Two-game side-by-side daily comparison
-- Replace 'uAAA...' / 'uBBB...' with the actual mobile_ids.

SELECT date,
       CASE WHEN id = 'uAAA...' THEN 'GameA' ELSE 'GameB' END AS game,
       SUM(revenue) AS revenue,
       SUM(dau)     AS dau
FROM intelligence.game_metric_sensortower_daily_uid
WHERE id IN ('uAAA...', 'uBBB...')
  AND market = 'global'
  AND date BETWEEN ? AND ?
GROUP BY date, game
ORDER BY date, game
