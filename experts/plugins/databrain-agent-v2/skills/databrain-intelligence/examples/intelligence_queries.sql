-- Intelligence data query examples
-- Source: intelligence.* tables
-- All queries MUST include a date range filter (partition field)
-- Sensortower _uid tables: keyed by unified_id (u-prefixed hash) via `id` field

-- ── Example 1: Sensortower daily downloads & revenue (by app_id) ──────────────
SELECT
  date,
  platform,
  market,
  revenue,
  download,
  dau
FROM intelligence.game_metric_sensortower_daily
WHERE app_id = '<sensortower_app_id>'
  AND date >= '2026-03-01'
  AND date < '2026-04-01'
  AND platform IN ('appstore', 'googleplay')
ORDER BY date, platform, market
LIMIT 5000

-- ── Example 2: Single-month MAU by platform (unified_id, monthly table) ───────
-- ⚠️ monthly table date must be the 1st of the month; mau only exists here
WITH target_ids AS (
  SELECT id FROM UNNEST(['<uid1>', '<uid2>', '<uid3>']) AS id
)
SELECT t.id, t.platform, t.mau, t.revenue, t.download
FROM `tencent-databrain-prod.intelligence.game_metric_sensortower_monthly_uid` t
INNER JOIN target_ids ON t.id = target_ids.id
WHERE t.date = '<YYYY-MM-01>'   -- must be 1st of month, e.g. '2025-03-01'
  AND t.market = 'global'
ORDER BY t.id, t.platform
LIMIT 5000

-- ── Example 3: Single-month combined totals (iOS + Android) ───────────────────
WITH target_ids AS (
  SELECT id FROM UNNEST(['<uid1>', '<uid2>']) AS id
)
SELECT
  t.id,
  SUM(t.mau)      AS total_mau,
  SUM(t.revenue)  AS total_revenue,
  SUM(t.download) AS total_download,
  MAX(CASE WHEN t.platform = 'appstore'    THEN t.mau END) AS ios_mau,
  MAX(CASE WHEN t.platform = 'googleplay'  THEN t.mau END) AS android_mau
FROM `tencent-databrain-prod.intelligence.game_metric_sensortower_monthly_uid` t
INNER JOIN target_ids ON t.id = target_ids.id
WHERE t.date = '<YYYY-MM-01>'
  AND t.market = 'global'
GROUP BY t.id
ORDER BY total_mau DESC
LIMIT 5000

-- ── Example 4: Multi-month MAU / revenue / download trend ────────────────────
WITH target_ids AS (
  SELECT id FROM UNNEST(['<uid1>', '<uid2>']) AS id
)
SELECT
  t.id, t.date,
  SUM(t.mau)      AS total_mau,
  SUM(t.revenue)  AS total_revenue,
  SUM(t.download) AS total_download
FROM `tencent-databrain-prod.intelligence.game_metric_sensortower_monthly_uid` t
INNER JOIN target_ids ON t.id = target_ids.id
WHERE t.date BETWEEN '<START_YYYY-MM-01>' AND '<END_YYYY-MM-01>'
  AND t.market = 'global'
GROUP BY t.id, t.date
ORDER BY t.id, t.date
LIMIT 5000

-- ── Example 5: Monthly avg DAU (aggregated from daily table) ─────────────────
-- ⚠️ dau only exists in the daily table; monthly avg DAU = SUM(dau)/COUNT(days)
WITH target_ids AS (
  SELECT id FROM UNNEST(['<uid1>', '<uid2>']) AS id
),
daily_data AS (
  SELECT t.id, t.date,
    SUM(t.dau)      AS daily_total_dau,
    SUM(t.revenue)  AS daily_total_revenue,
    SUM(t.download) AS daily_total_download
  FROM `tencent-databrain-prod.intelligence.game_metric_sensortower_daily_uid` t
  INNER JOIN target_ids ON t.id = target_ids.id
  WHERE t.date BETWEEN '<YYYY-MM-01>' AND '<YYYY-MM-DD>'  -- full month range
    AND t.market = 'global'
  GROUP BY t.id, t.date
)
SELECT
  id,
  ROUND(AVG(daily_total_dau))    AS avg_daily_dau,
  SUM(daily_total_revenue)       AS month_revenue,
  SUM(daily_total_download)      AS month_download,
  COUNT(DISTINCT date)           AS days_count
FROM daily_data
GROUP BY id
ORDER BY avg_daily_dau DESC
LIMIT 5000

-- ── Example 6: Multi-month avg DAU trend (from daily table) ──────────────────
WITH target_ids AS (
  SELECT id FROM UNNEST(['<uid1>', '<uid2>']) AS id
),
daily_data AS (
  SELECT t.id, t.date,
    FORMAT_DATE('%Y-%m', t.date) AS month,
    SUM(t.dau) AS daily_total_dau
  FROM `tencent-databrain-prod.intelligence.game_metric_sensortower_daily_uid` t
  INNER JOIN target_ids ON t.id = target_ids.id
  WHERE t.date BETWEEN '<START_DATE>' AND '<END_DATE>'
    AND t.market = 'global'
  GROUP BY t.id, t.date
)
SELECT
  id, month,
  ROUND(AVG(daily_total_dau)) AS avg_daily_dau,
  COUNT(DISTINCT date)        AS days_count
FROM daily_data
GROUP BY id, month
ORDER BY id, month
LIMIT 5000

-- ── Example 7: VG Insights Steam data (DAU / revenue / rating) ───────────────
-- Note: VG Insights app_id is the full Steam URL
SELECT
  date,
  revenue,
  units_sold,
  dau,
  mau,
  acu,
  pcu,
  wishlists_total,
  rating
FROM intelligence.game_metric_vginsights_daily
WHERE app_id = 'https://store.steampowered.com/app/730/'  -- CS2
  AND date >= '2026-03-01'
  AND date < '2026-04-01'
ORDER BY date
LIMIT 5000

-- ── Example 8: Ampere Console retention (D1/D7/D28) ──────────────────────────
SELECT
  date,
  platform,
  market,
  active_users,
  new_users,
  hours_played,
  bounded_1,
  bounded_7,
  bounded_28,
  ROUND(bounded_1  * 100.0 / NULLIF(new_users, 0), 2) AS d1_retention,
  ROUND(bounded_7  * 100.0 / NULLIF(new_users, 0), 2) AS d7_retention,
  ROUND(bounded_28 * 100.0 / NULLIF(new_users, 0), 2) AS d28_retention
FROM intelligence.game_metric_ampere_daily_cid
WHERE combined_id = '<combined_id>'
  AND date >= '2026-03-01'
  AND date < '2026-04-01'
ORDER BY date, platform, market
LIMIT 5000

-- ── Example 9: Streamhatchet streaming hours (by platform) ───────────────────
SELECT
  DATE(date) AS dt,
  platform,
  SUM(hours_watched) AS hours_watched
FROM intelligence.game_metric_streamhatchet_stream_uid
WHERE id = '<edition_id>'   -- id field = edition_id
  AND date >= '2026-03-01'
  AND date < '2026-04-01'
  AND platform IN ('twitch', 'ytg', 'facebook')
GROUP BY dt, platform
ORDER BY dt, platform
LIMIT 5000

-- ── Example 10: GSD Europe weekly sales ──────────────────────────────────────
SELECT
  date,
  market,
  device,
  digital_revenue,
  digital_units,
  physical_revenue,
  physical_units,
  (digital_revenue + physical_revenue)   AS total_revenue,
  (digital_units   + physical_units)     AS total_units
FROM intelligence.game_metric_gsd_weekly_uid
WHERE combined_id = '<combined_id>'
  AND date >= '2026-02-01'
  AND date < '2026-04-01'
ORDER BY date, market
LIMIT 5000

-- ── Example 11: Cross-source comparison (Sensortower + Gamalytic) ────────────
-- Requires resolving app_ids via common.unified_ids first
WITH st_data AS (
  SELECT
    date,
    'sensortower' AS source,
    SUM(revenue)  AS revenue,
    SUM(download) AS volume
  FROM intelligence.game_metric_sensortower_daily
  WHERE app_id IN (SELECT app_id FROM common.unified_ids_part
                   WHERE unified_edition_id = '<unified_id>' AND entity_type = 'mobile')
    AND date >= '2026-03-01'
    AND date < '2026-04-01'
    AND market = 'global'
  GROUP BY date
),
gama_data AS (
  SELECT
    date,
    'gamalytic' AS source,
    SUM(revenue)    AS revenue,
    SUM(units_sold) AS volume
  FROM intelligence.game_metric_gamalytic_daily
  WHERE edition_id = '<edition_id>'
    AND date >= '2026-03-01'
    AND date < '2026-04-01'
  GROUP BY date
)
SELECT * FROM st_data
UNION ALL
SELECT * FROM gama_data
ORDER BY date, source
LIMIT 5000
