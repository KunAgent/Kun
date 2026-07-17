-- Pattern C: Top N games by benchmark metric
-- Copy ONE block per execute_sql.py run.
--
-- country_code = 'global' + ONE platform口径 + dedupe per game BEFORE ORDER BY,
-- otherwise a game with multiple platform/country rows is ranked multiple times.
-- Platform口径 (no platform asked): PC-family → 'PC&Console'; mobile-family → 'Mobile'.
-- See references/benchmark-sources.md → "Distribution fan-out" + "Platform scoping".

-- C1: GaaS ratio top 10 (PC-family → PC&Console)
SELECT g.game_name, t.game_id, t.value AS gaas_ratio
FROM (
  SELECT game_id, MAX(value) AS value
  FROM benchmark.benchmark_detail
  WHERE metric = 'gaas_ratio'
    AND country_code = 'global'
    AND platform = 'PC&Console'
  GROUP BY game_id
) AS t
INNER JOIN benchmark.benchmark_game_info AS g ON t.game_id = g.game_id
ORDER BY t.value DESC
LIMIT 10;

-- C2: Wishlists before launch top 10 (Steam/PC-family → PC&Console)
SELECT g.game_name, t.game_id, t.value AS wishlists_before_launch
FROM (
  SELECT game_id, MAX(value) AS value
  FROM benchmark.benchmark_detail
  WHERE metric = 'wishlists_before_launch'
    AND country_code = 'global'
    AND platform = 'PC&Console'
  GROUP BY game_id
) AS t
INNER JOIN benchmark.benchmark_game_info AS g ON t.game_id = g.game_id
ORDER BY t.value DESC
LIMIT 10;

-- C3: First-month MAU top 10 (PC-family → PC&Console; intelligence source only)
SELECT g.game_name, t.game_id, t.value AS ampere_mau_m1
FROM (
  SELECT game_id, MAX(value) AS value
  FROM benchmark.benchmark_detail
  WHERE metric = 'ampere_mau_m1'
    AND country_code = 'global'
    AND source = 'intelligence'
    AND platform = 'PC&Console'
  GROUP BY game_id
) AS t
INNER JOIN benchmark.benchmark_game_info AS g ON t.game_id = g.game_id
ORDER BY t.value DESC
LIMIT 10;
