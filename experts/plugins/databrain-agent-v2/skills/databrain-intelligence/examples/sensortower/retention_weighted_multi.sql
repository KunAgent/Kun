-- Retention — MULTI-country and/or MULTI-month, MAU-weighted (NO platform mentioned).
-- Table: intelligence.sensortower_retention_unified_monthly (unified_app_id, no platform).
-- Weighted average:  SUM(retention_dN * MAU) / SUM(MAU)
--   over every selected (country, month) cell for this game. Special cases:
--     * multiple months  → weights each month by that month's MAU
--     * multiple countries → weights each country by that country's MAU
-- MAU source: game_metric_sensortower_monthly_uid (databrain unified_id keyed),
--   SUM across platforms to match the cross-platform "unified" concept.
-- Join: retention.country is UPPERCASE ISO-2, monthly_uid.market is lowercase → LOWER(r.country);
--   the country-level global rollup is already 'global' (lowercase) → matches market 'global'.
-- Caveat: Sensortower MAU only covers large markets; small-country cohorts with NULL MAU
--   drop out of the weighting — note coverage when reporting many small countries.

-- Output labels are UNIFIED across monthly & lifetime: D2/D3/D7/D15/D31 = ST raw days d1/d2/d6/d14/d30.
SELECT
  SAFE_DIVIDE(SUM(CAST(r.est_retention_d1  AS FLOAT64) * m.mau), SUM(m.mau)) AS D2,
  SAFE_DIVIDE(SUM(CAST(r.est_retention_d2  AS FLOAT64) * m.mau), SUM(m.mau)) AS D3,
  SAFE_DIVIDE(SUM(CAST(r.est_retention_d6  AS FLOAT64) * m.mau), SUM(m.mau)) AS D7,
  SAFE_DIVIDE(SUM(CAST(r.est_retention_d14 AS FLOAT64) * m.mau), SUM(m.mau)) AS D15,
  SAFE_DIVIDE(SUM(CAST(r.est_retention_d30 AS FLOAT64) * m.mau), SUM(m.mau)) AS D31
FROM intelligence.sensortower_retention_unified_monthly r
JOIN (
  SELECT DISTINCT sensortower_unified_app_id, databrain_unified_id
  FROM common.sensortower_unified_ids
) b
  ON b.sensortower_unified_app_id = r.unified_app_id
JOIN (
  SELECT id, date, market, SUM(mau) AS mau
  FROM intelligence.game_metric_sensortower_monthly_uid
  WHERE platform IN ('appstore', 'googleplay')
  GROUP BY id, date, market
) m
  ON m.id = b.databrain_unified_id
 AND m.date = r.date
 AND m.market = LOWER(r.country)
WHERE b.databrain_unified_id = '{unified_id}'
  AND r.date BETWEEN '{start_month}' AND '{end_month}'   -- multi-month range (1st-of-month)
  AND r.country IN ('US', 'JP', 'KR')                     -- selected countries (UPPERCASE)
LIMIT 5000
