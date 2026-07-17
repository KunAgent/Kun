-- Macro-region revenue share
-- DataBrain stores per-country market codes; build macro-regions manually with CASE WHEN.
-- Excludes synthetic aggregates (global / global_wo_china) before computing share.

SELECT region,
       SUM(revenue) AS revenue,
       SAFE_DIVIDE(SUM(revenue), SUM(SUM(revenue)) OVER ()) AS share
FROM (
  SELECT
    CASE
      WHEN market IN ('us', 'ca', 'mx')                                    THEN 'North America'
      WHEN market IN ('gb', 'de', 'fr', 'it', 'es', 'nl', 'se', 'no',
                      'fi', 'dk', 'pl', 'ru')                              THEN 'Europe'
      WHEN market IN ('jp', 'kr')                                           THEN 'Japan + Korea'
      WHEN market IN ('cn', 'hk', 'tw', 'mo')                              THEN 'Greater China'
      WHEN market IN ('id', 'th', 'vn', 'ph', 'my', 'sg')                 THEN 'Southeast Asia'
      ELSE 'Other'
    END AS region,
    revenue
  FROM intelligence.game_metric_sensortower_daily_uid
  WHERE id = ?
    AND market NOT IN ('global', 'global_wo_china')
    AND date BETWEEN ? AND ?
)
GROUP BY region
ORDER BY revenue DESC
