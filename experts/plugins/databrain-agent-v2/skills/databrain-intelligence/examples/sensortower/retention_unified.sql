-- Retention — SINGLE country / global, SINGLE month, direct read (NO platform mentioned).
-- Table: intelligence.sensortower_retention_unified_monthly (unified_app_id; ST already merged packages).
-- Use when one (country, cohort-month) cell is enough — no MAU weighting needed.
-- For multi-country and/or multi-month → retention_weighted_multi.sql instead.
-- For platform-specific → retention_per_platform.sql. For lifetime → retention_lifetime.sql.
--
-- ID chain: databrain unified_id → common.sensortower_unified_ids → unified_app_id.
-- country is UPPERCASE ISO-2; global rollup is lowercase 'global' → LOWER(r.country) for filter.
-- est_retention_dN are STRING fractions (0-1) → CAST to FLOAT64.
-- Output labels UNIFIED: D2/D3/D7/D15/D31 = ST raw days d1/d2/d6/d14/d30.

SELECT
  CAST(r.est_retention_d1  AS FLOAT64) AS D2,
  CAST(r.est_retention_d2  AS FLOAT64) AS D3,
  CAST(r.est_retention_d6  AS FLOAT64) AS D7,
  CAST(r.est_retention_d14 AS FLOAT64) AS D15,
  CAST(r.est_retention_d30 AS FLOAT64) AS D31
FROM intelligence.sensortower_retention_unified_monthly r
JOIN (
  SELECT DISTINCT sensortower_unified_app_id, databrain_unified_id
  FROM common.sensortower_unified_ids
) b
  ON b.sensortower_unified_app_id = r.unified_app_id
WHERE b.databrain_unified_id = '{unified_id}'
  AND r.date = '{cohort_month}'              -- 1st of month, e.g. '2026-03-01'
  AND LOWER(r.country) = 'global'            -- single market; per-country: LOWER(r.country) = 'us'
LIMIT 5000
