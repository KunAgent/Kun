-- Steam CCU / PCU / ACU — warehouse SQL patterns
-- Reference: references/steam-ccu.md | Live API: scripts/fetch_steam_ccu.py
--
-- ⚠️ execute_sql.py sends the ENTIRE file as one query — copy ONE pattern block only.
-- ⚠️ No `WITH` CTE — use nested subqueries (see scripts/execute_sql.py).

-- ── Pattern 1: Resolve steam_id for a combined_id ───────────────────────────
SELECT combined_id, entity_name, steam_id
FROM common.combined_detail
WHERE combined_id = 'c00001765'
LIMIT 5

-- ── Pattern 2: Latest spider PCU (warehouse near-real-time, T-0 crawler) ────
-- segment IS NULL — NOT segment = 'All'
SELECT date,
       spider_steam_pcu,
       spider_steam_acu
FROM intelligence.game_metric_pconsole_daily_cid
WHERE combined_id = 'c00001765'
  AND platform = 'PC'
  AND market = 'global'
  AND segment IS NULL
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY) AND CURRENT_DATE()
ORDER BY date DESC
LIMIT 10

-- ── Pattern 3: PCU best-effort (spider + alinea + gamalytic, one row/day) ───
SELECT date,
       MAX(spider_steam_pcu) AS spider_pcu,
       MAX(alinea_pcu) AS alinea_pcu,
       MAX(gamalytic_pcu) AS gamalytic_pcu,
       COALESCE(MAX(spider_steam_pcu), MAX(alinea_pcu), MAX(gamalytic_pcu)) AS pcu_best
FROM intelligence.game_metric_pconsole_daily_cid
WHERE combined_id = 'c00001765'
  AND platform = 'PC'
  AND market = 'global'
  AND (segment = 'All' OR segment IS NULL)
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND CURRENT_DATE()
GROUP BY date
ORDER BY date DESC
LIMIT 60

-- ── Pattern 4: Alinea ACU trend (T-1 complete; not live API) ──────────────
SELECT date, pcu, acu
FROM intelligence.game_metric_alinea_daily_cid
WHERE combined_id = 'c00001765'
  AND date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND CURRENT_DATE()
ORDER BY date DESC
LIMIT 60
