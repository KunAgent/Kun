-- Pattern D: Benchmark with platform / source filters
-- Copy ONE block per execute_sql.py run.
--
-- User named a platform → route to that exact口径 (routing table in benchmark-sources.md
-- → "Platform scoping"). PC/Steam → 'pc'; Console → 'console'; iOS/Android → exact.
-- platform is mixed-case → wrap with LOWER(). Always + country_code='global' + dedupe.

-- D1: Steam PCU day-1 — user asked PC → platform = 'pc' (Steam-only metric)
SELECT
  APPROX_QUANTILES(v, 100)[OFFSET(99)] AS top_1_percent,
  APPROX_QUANTILES(v, 2)[OFFSET(1)]    AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'vginsights_pcu_d1'
    AND country_code = 'global'
    AND LOWER(platform) = 'pc'
  GROUP BY game_id
);

-- D2: PCU-related metrics on detail (discovery + platform)
SELECT DISTINCT d.metric, d.platform
FROM benchmark.benchmark_detail AS d
WHERE LOWER(d.metric) LIKE '%pcu%'
   OR LOWER(d.platform) = 'pc'
LIMIT 100;

-- D3: First-month MAU distribution, intelligence source, no platform asked → PC&Console
SELECT
  APPROX_QUANTILES(v, 100)[OFFSET(99)] AS top_1_percent,
  APPROX_QUANTILES(v, 2)[OFFSET(1)]    AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'ampere_mau_m1'
    AND country_code = 'global'
    AND source = 'intelligence'
    AND platform = 'PC&Console'
  GROUP BY game_id
);
