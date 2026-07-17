SELECT
    d.entity_name  AS game_name,
    AVG(base.au) AS sensortower__au,
    SUM(base.revenue)  AS sensortower__revenue,
    SAFE_DIVIDE(SUM(base.revenue), AVG(base.au))   AS sensortower__arpu,
    SUM(base.download)  AS sensortower__download
  FROM (
    SELECT
      id,
      date,
      SUM(mau)      AS au,
      SUM(revenue)  AS revenue,
      SUM(download) AS download
    FROM tencent-databrain-prod.intelligence.game_metric_sensortower_monthly_uid
    WHERE market = 'global'
      AND platform IN ('appstore', 'googleplay')
      AND date BETWEEN DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 6 MONTH)
                   AND DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 MONTH)
    GROUP BY id, date
  ) base
  LEFT JOIN common.app_detail d
    ON d.app_id = base.id
    AND d.id_type = 'unified_id'
  GROUP BY d.entity_name
  ORDER BY sensortower__au DESC
  LIMIT 50