-- Default: uses game_metric_sensortower_*_uid tables (unified_id keyed)
-- Launch-to-date / lifetime revenue
-- Stitches completed months (monthly_uid) + current partial month (daily_uid)
-- to avoid undercounting or double-counting the current month.

SELECT
  (SELECT IFNULL(SUM(revenue), 0)
   FROM intelligence.game_metric_sensortower_monthly_uid
   WHERE id = ?
     AND market = 'global'
     AND date < DATE_TRUNC(CURRENT_DATE(), MONTH)) AS completed_months_revenue,

  (SELECT IFNULL(SUM(revenue), 0)
   FROM intelligence.game_metric_sensortower_daily_uid
   WHERE id = ?
     AND market = 'global'
     AND date >= DATE_TRUNC(CURRENT_DATE(), MONTH)) AS current_month_revenue
