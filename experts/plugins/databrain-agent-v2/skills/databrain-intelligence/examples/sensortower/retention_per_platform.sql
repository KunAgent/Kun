-- Retention — PLATFORM mentioned (single platform e.g. "App Store / iOS retention", or
-- Android-only). Use this table WHENEVER the question involves platform or a specific
-- package; the unified table has NO platform dimension.
-- Table: intelligence.sensortower_retention_monthly (keyed by app_id = package; has platform).
-- Granularity: MONTHLY new-user cohort. `date` = cohort month (1st).
--
-- Requirement (literal denominator): single-platform retention =
--   SUM(retention_dN * MAU) over the SELECTED platform's packages
--   / SUM(MAU) over ALL platforms' packages     ← denominator spans all platforms.
-- So the platform filter lives in the numerator IF(...), NOT in WHERE / the denominator.
--
-- MAU source: raw game_metric_sensortower_monthly (app_id level), joined per
--   (app_id, platform, market, date). retention.country is UPPERCASE → LOWER() to match market.
-- ID chain: databrain unified_id → common.sensortower_unified_ids → app_id.
-- est_retention_dN are STRING fractions (0-1) → CAST to FLOAT64.
-- Multi-country: change the country filter to IN ('US','JP',...). Multi-month: widen date range.

-- Output labels are UNIFIED across monthly & lifetime: D2/D3/D7/D15/D31 = ST raw days d1/d2/d6/d14/d30.
SELECT
  SAFE_DIVIDE(
    SUM(IF(r.platform = 'appstore', CAST(r.est_retention_d1  AS FLOAT64) * m.mau, 0)),
    SUM(m.mau)
  ) AS D2,
  SAFE_DIVIDE(
    SUM(IF(r.platform = 'appstore', CAST(r.est_retention_d2  AS FLOAT64) * m.mau, 0)),
    SUM(m.mau)
  ) AS D3,
  SAFE_DIVIDE(
    SUM(IF(r.platform = 'appstore', CAST(r.est_retention_d6  AS FLOAT64) * m.mau, 0)),
    SUM(m.mau)
  ) AS D7,
  SAFE_DIVIDE(
    SUM(IF(r.platform = 'appstore', CAST(r.est_retention_d14 AS FLOAT64) * m.mau, 0)),
    SUM(m.mau)
  ) AS D15,
  SAFE_DIVIDE(
    SUM(IF(r.platform = 'appstore', CAST(r.est_retention_d30 AS FLOAT64) * m.mau, 0)),
    SUM(m.mau)
  ) AS D31
FROM intelligence.sensortower_retention_monthly r
JOIN intelligence.game_metric_sensortower_monthly m
  ON m.app_id   = r.app_id
 AND m.platform = r.platform
 AND m.market   = LOWER(r.country)
 AND m.date     = r.date
JOIN (
  SELECT DISTINCT app_id, databrain_unified_id
  FROM common.sensortower_unified_ids
) b
  ON b.app_id = r.app_id
WHERE b.databrain_unified_id = '{unified_id}'
  AND r.date BETWEEN '{start_month}' AND '{end_month}'
  AND LOWER(r.country) = 'global'    -- single market; multi-country: r.country IN ('US','JP',...)
  -- Android instead: change 'appstore' → 'googleplay' in every IF(...). Denominator stays all-platforms.
  -- Per-platform breakdown (both at once, sharing the all-platforms denominator):
  --   SAFE_DIVIDE(SUM(IF(r.platform='appstore',  ... )), SUM(m.mau)) AS appstore_w_d7,
  --   SAFE_DIVIDE(SUM(IF(r.platform='googleplay', ... )), SUM(m.mau)) AS googleplay_w_d7
LIMIT 5000
