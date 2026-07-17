# Streamhatchet Reference

> **CRITICAL — Metric selection rule (never mix these, this is special in the database):**
> - **`airtime_hours`** = **直播时长** — time the streamer was live broadcasting (supply side). Use when user asks: 「直播时长」「主播开播时长」「airtime」。
> - **`hours_watched`** = **观看时长** — total hours consumed by viewers (demand side). Use when user asks: 「观看时长」「观众观看时长」「hours watched」。
> - These measure **opposite sides** of streaming. Never substitute one for the other.

Streamhatchet is a commercial streaming analytics platform covering **Twitch**, **YouTube Gaming (ytg)**, and **Facebook Gaming**.

**Core table:** `intelligence.game_metric_streamhatchet_stream_uid` — game-level streaming metrics keyed by `id` (unified_id for mobile, edition_id for pc/console).

---

## game_metric_streamhatchet_stream_uid

**Partition field:** `date`

> **⚠️ ID rule:**
> - **Mobile games:** `id` stores the **unified_id** (`u...` prefix).
> - **PC/Console games:** `id` stores the **edition_id** (`e...` prefix). Do NOT use `u...` unified_id values — they return 0 rows.
> - **PC/Console recommended:** if you have a `combined_id`, use the `pconsole_*_cid` wide table directly instead — it already includes pre-joined Streamhatchet columns and avoids the edition_id lookup entirely (see [pconsole Wide-Table Integration](#pconsole-wide-table-integration) below).

### Dimensions

| Column | Type   | Notes |
| ------------- | ------ | ---------- |
| `id`          | STRING | unified_id value for mobile; edition_id for pc/console — game join key |
| `date`        | DATE   | Data date — **partition field**                                        |
| `platform`    | STRING | `twitch` / `ytg` (YouTube Gaming) / `facebook`                         |
| `granularity` | STRING | `daily` (only value present in this table)                             |
| `entity_name` | STRING | Game name (raw Streamhatchet name)                                     |

### Metrics

| Column            | Type    | Notes                                            |
| ----------------- | ------- | ------------------------------------------------ |
| `hours_watched`   | FLOAT64 | Total hours watched, 观看时长(小时)              |
| `airtime_hours`   | FLOAT64 | Total hours streamed (airtime), 直播时长（小时） |
| `peak_viewers`    | FLOAT64 | Peak concurrent viewers, 直播观众峰值            |
| `average_viewers` | FLOAT64 | Average concurrent viewers, 直播观众平均值       |

---

> **Monthly aggregation:** The table stores daily rows; use `DATE_TRUNC(date, MONTH)` + GROUP BY to roll up to month:
> - `SUM(hours_watched)` — total hours watched for the month
> - `MAX(peak_viewers)` — highest single-day peak viewers in the month
> - `AVG(average_viewers)` — average of daily average viewers
> - `SUM(airtime_hours)` — total airtime hours for the month

---

## pconsole Wide-Table Integration

> **Recommended for PC/console games:** if you have a `combined_id`, use this wide table directly — no need to look up edition_id or query Streamhatchet tables separately.

`pconsole_*_cid` wide tables expose 4 Streamhatchet columns (summed across platforms):

| Wide-table column               | Source metric                     |
| ------------------------------- | --------------------------------- |
| `streamhatchet_hours_watched`   | `hours_watched`, 观看时长(小时)   |
| `streamhatchet_airtime_hours`   | `airtime_hours`, 直播时长（小时） |
| `streamhatchet_peak_viewers`    | `peak_viewers`, 直播观众峰值      |
| `streamhatchet_average_viewers` | `average_viewers`, 直播观众平均值 |
