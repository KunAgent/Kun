-- Pattern B: Distribution benchmark (top 1% / top 10% / median)
-- Copy ONE block per execute_sql.py run.
--
-- MUST: country_code = 'global' + pick ONE platform口径 + one value per game.
-- benchmark_detail fans out by country_code AND platform, so raw-row quantiles
-- double-count games and skew tail percentiles. Platform口径 (no platform asked):
-- PC-family → 'PC&Console'; mobile-family → 'Mobile'. See references/benchmark-sources.md
-- → "Distribution fan-out" + "Platform scoping".

-- B1: Month-1 retention — top 10% and median (PC-family → PC&Console)
SELECT
  APPROX_QUANTILES(v, 100)[OFFSET(90)] AS top_10_percent,
  APPROX_QUANTILES(v, 2)[OFFSET(1)]    AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'retention_m1'
    AND country_code = 'global'
    AND platform = 'PC&Console'
  GROUP BY game_id
);

-- B2: First-year sales — top 1% and median (PC-family → PC&Console)
SELECT
  APPROX_QUANTILES(v, 100)[OFFSET(99)] AS top_1_percent,
  APPROX_QUANTILES(v, 2)[OFFSET(1)]    AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'sales_y'
    AND country_code = 'global'
    AND platform = 'PC&Console'
  GROUP BY game_id
);

-- B3: GaaS ratio — median only (PC-family → PC&Console)
SELECT
  APPROX_QUANTILES(v, 2)[OFFSET(1)] AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'gaas_ratio'
    AND country_code = 'global'
    AND platform = 'PC&Console'
  GROUP BY game_id
);

-- B4: Wishlists before launch — top 1%, top 10%, median (Steam/PC-family → PC&Console)
SELECT
  APPROX_QUANTILES(v, 100)[OFFSET(99)] AS top_1_percent,
  APPROX_QUANTILES(v, 100)[OFFSET(90)] AS top_10_percent,
  APPROX_QUANTILES(v, 2)[OFFSET(1)]    AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'wishlists_before_launch'
    AND country_code = 'global'
    AND platform = 'PC&Console'
  GROUP BY game_id
);

-- B5: Day-2 retention — top 10% and median (mobile-family → Mobile)
SELECT
  APPROX_QUANTILES(v, 100)[OFFSET(90)] AS top_10_percent,
  APPROX_QUANTILES(v, 2)[OFFSET(1)]    AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'retention_rate_d2'
    AND country_code = 'global'
    AND platform = 'Mobile'
  GROUP BY game_id
);


-- B6: Steam refund rate — median (Steam/PC-family → PC&Console)
-- 「steam 游戏退款率一般是多少」→ 直接用 benchmark 回答
SELECT
  APPROX_QUANTILES(v, 2)[OFFSET(1)] AS median,
  COUNT(*) AS game_count
FROM (
  SELECT game_id, MAX(value) AS v
  FROM benchmark.benchmark_detail
  WHERE metric = 'refund_rate_lifetime'   -- or refund_rate_30d / _14d / _7d / _90d
    AND country_code = 'global'
    AND platform = 'PC&Console'
  GROUP BY game_id
);