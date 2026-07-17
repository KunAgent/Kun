-- Retention — LIFETIME / launch-to-date (legacy table; source data frozen since 2025-07-01).
-- ETL may still refresh insert_time — do not treat insert_time as data freshness.
-- Use ONLY when the user explicitly asks for lifetime / launch-to-date retention.
-- For month-specific / trend / "current" retention use the monthly-cohort tables instead:
--   retention_unified.sql / retention_weighted_multi.sql / retention_per_platform.sql.
--
-- Table: intelligence.game_metric_sensortower_retention (granularity='all_time', lifetime cohort).
-- This is the LEGACY scheme — DIFFERENT from the new monthly tables, do NOT mix the two:
--   · keyed by raw app_id → resolve via common.unified_ids (NOT common.sensortower_unified_ids)
--   · market is LOWERCASE ('global' / 'cn' / 'us' / …)
--   · legacy aggregation = plain AVG across app_ids (NO MAU weighting)
--   · confidence is informational only — do NOT use it as a weight
-- Default (no platform specified) = unified dual-platform average: AVG over all app_ids, no platform group.
-- Always state "lifetime retention; source data frozen since 2025-07-01" when answering from this table.
--
-- UNIFIED output labels D2/D3/D7/D15/D31 = ST raw days d1/d2/d6/d14/d30 (same labels as the monthly
-- tables, for comparability). The pre-extracted columns (retention_d2/d3/d7/d14/d30) are a DIFFERENT
-- day set and do NOT match these labels — so read from the `retentions` JSON instead:
--   day-N = JSON_EXTRACT_ARRAY(retentions)[SAFE_OFFSET(N-1)] (0-indexed at day-1).
--   D2→day1 OFFSET(0), D3→day2 OFFSET(1), D7→day6 OFFSET(5), D15→day14 OFFSET(13), D31→day30 OFFSET(29).

SELECT
  AVG(CAST(JSON_EXTRACT_ARRAY(r.retentions)[SAFE_OFFSET(0)]  AS FLOAT64)) AS D2,
  AVG(CAST(JSON_EXTRACT_ARRAY(r.retentions)[SAFE_OFFSET(1)]  AS FLOAT64)) AS D3,
  AVG(CAST(JSON_EXTRACT_ARRAY(r.retentions)[SAFE_OFFSET(5)]  AS FLOAT64)) AS D7,
  AVG(CAST(JSON_EXTRACT_ARRAY(r.retentions)[SAFE_OFFSET(13)] AS FLOAT64)) AS D15,
  AVG(CAST(JSON_EXTRACT_ARRAY(r.retentions)[SAFE_OFFSET(29)] AS FLOAT64)) AS D31
FROM intelligence.game_metric_sensortower_retention r
JOIN common.unified_ids u ON r.app_id = u.app_id
WHERE u.unified_id = '{mobile_id}'
  AND u.entity_type = 'mobile'
  AND u.source = 'sensortower'
  AND r.granularity = 'all_time'
  AND r.market = 'global'        -- lowercase; single country: r.market = 'us'
  -- single platform: AND r.platform = 'appstore'   -- or 'googleplay'
LIMIT 5000
