-- Metric discovery — valid SoT: benchmark_detail DISTINCT metric
-- Flow: A0 (exact) → A+ (group) → alignment check → A5 (metric_info) → A1 (detail LIKE)
--   → then "Platform family" (last block) to pick the platform口径 for distributions.
-- Copy ONE block per execute_sql.py run.

-- A1: Keyword search on detail (fallback — full SoT; use when A+ empty OR misaligned)
SELECT DISTINCT metric
FROM benchmark.benchmark_detail
WHERE LOWER(metric) LIKE '%wishlist%'
LIMIT 50;

-- A2: First-month active / MAU related metrics
SELECT DISTINCT metric
FROM benchmark.benchmark_detail
WHERE LOWER(metric) LIKE '%mau%'
   OR LOWER(metric) LIKE '%dau%'
LIMIT 50;

-- A3: Sales-related metrics (detail + optional UNION)
SELECT DISTINCT metric
FROM benchmark.benchmark_detail
WHERE LOWER(metric) LIKE '%sales%'
LIMIT 50;

-- A4: Verify exact metric exists before using in Pattern B/C
SELECT DISTINCT metric
FROM benchmark.benchmark_detail
WHERE metric = 'sales_y'
LIMIT 1;

-- A5: Chinese semantic — dim_metric_info ⋈ detail (no group_info; wider than A+)
SELECT d.metric, m.metric_cn, m.metric_en, m.is_recommend
FROM benchmark.dim_metric_info AS m
INNER JOIN (
  SELECT DISTINCT metric FROM benchmark.benchmark_detail
) AS d ON m.metric = d.metric
WHERE LOWER(m.metric_cn) LIKE '%首月%留存%'
   OR LOWER(m.metric_en) LIKE '%first month%retention%'
ORDER BY m.is_recommend DESC
LIMIT 20;

-- A+ (recommended): Product group + metric labels — semantic / 指标组 discovery
SELECT
  g.metric,
  g.group_name_cn,
  g.label_cn,
  m.metric_cn,
  m.metric_en,
  m.is_recommend,
  m.tips_cn
FROM benchmark.dim_metric_group_info AS g
INNER JOIN benchmark.dim_metric_info AS m ON g.metric = m.metric
INNER JOIN (
  SELECT DISTINCT metric FROM benchmark.benchmark_detail
) AS d ON g.metric = d.metric
WHERE LOWER(g.group_name_cn) LIKE '%留存%'
   OR LOWER(m.metric_cn) LIKE '%首月%留存%'
ORDER BY m.is_recommend DESC, g.sort
LIMIT 30;

-- A+: List metrics in a group (e.g. 收入 / sales group)
SELECT
  g.metric,
  g.group_name_cn,
  g.label_cn,
  m.metric_cn,
  m.is_recommend
FROM benchmark.dim_metric_group_info AS g
INNER JOIN benchmark.dim_metric_info AS m ON g.metric = m.metric
INNER JOIN (
  SELECT DISTINCT metric FROM benchmark.benchmark_detail
) AS d ON g.metric = d.metric
WHERE LOWER(g.group_name_cn) LIKE '%收入%'
   OR LOWER(g.group_name_en) LIKE '%revenue%'
ORDER BY g.sort
LIMIT 30;

-- A1: GaaS ratio — example when A+ returns revenue_* but not gaas_ratio (misaligned → downgrade)
SELECT DISTINCT metric
FROM benchmark.benchmark_detail
WHERE LOWER(metric) LIKE '%gaas%'
LIMIT 20;

-- Platform family — after picking the metric, find its platforms to choose the口径
-- (no platform asked: PC-family → 'PC&Console'; mobile-family → 'Mobile';
--  no umbrella row → fall back to the platform with widest game coverage).
SELECT platform, COUNT(DISTINCT game_id) AS games
FROM benchmark.benchmark_detail
WHERE metric = 'ampere_mau_m1'
  AND country_code = 'global'
GROUP BY platform
ORDER BY games DESC;
