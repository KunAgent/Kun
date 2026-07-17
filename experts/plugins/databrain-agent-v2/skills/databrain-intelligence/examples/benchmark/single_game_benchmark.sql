-- Pattern E: Single game benchmark lookup (after search_entity.py → combined_id)
-- Copy ONE block per execute_sql.py run.

-- E1: All benchmark metrics for one game by combined_id
SELECT d.metric, d.value, d.platform, d.source, g.game_name
FROM benchmark.benchmark_detail AS d
INNER JOIN benchmark.benchmark_game_info AS g ON d.game_id = g.game_id
WHERE g.combined_id = 'c0000xxxx'
ORDER BY d.metric
LIMIT 500;

-- E2: One metric for one game
SELECT d.metric, d.value, d.platform, g.game_name
FROM benchmark.benchmark_detail AS d
INNER JOIN benchmark.benchmark_game_info AS g ON d.game_id = g.game_id
WHERE g.combined_id = 'c0000xxxx'
  AND d.metric = 'sales_y'
LIMIT 100;
