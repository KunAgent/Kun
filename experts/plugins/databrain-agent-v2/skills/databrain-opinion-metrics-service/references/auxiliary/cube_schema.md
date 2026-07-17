# cube_schema — 全表字段索引词典（兜底）

> ⚠️ **本文档是最后兜底**：当各业务 reference（public_feeds.md / kol.md / streaming.md / pr_news.md / stores/* / marketing_hub.md / memes.md / market_popularity.md / googletrends.md）都找不到字段时，回到这里检索。
>
> **优先去对应业务 reference 找模板**，不要默认从这里开始查。

---

## 1. 表名 → 业务 reference 跳转表

| 表 | 业务 reference |
|---|---|
| `opinion.public_feeds` | [public_feeds.md](../public_feeds.md) |
| `opinion.feeds_author` | [public_feeds.md](../public_feeds.md) §5（官号识别） |
| `opinion.kol` / `kol_tag` | [kol.md](../kol.md) |
| `opinion.dim_media_account` / `dim_keyword` | [dim_tables.md](dim_tables.md) + [social_filter_logic.md](social_filter_logic.md) |
| `opinion.dim_channel` / `dim_language` / `dim_topic_labels` | [dim_tables.md](dim_tables.md) |
| `opinion.googletrends_keyword` | [googletrends.md](../googletrends.md) |
| `opinion.memes` / `meme_videos` | [memes.md](../memes.md) |
| `opinion.top_mobile_game` / `top_pconsole_game` | [market_popularity.md](../market_popularity.md) |
| `opinion.store_score_steam` / `_daily` / `_by_language_hourly` | [stores/steam.md](../stores/steam.md) |
| `opinion.store_score_app_store` / `_daily` | [stores/app_store.md](../stores/app_store.md) |
| `opinion.store_score_google_play` / `_daily` | [stores/google_play.md](../stores/google_play.md) |
| `opinion.store_score_taptap` | [stores/taptap.md](../stores/taptap.md) |
| `opinion.store_score_xbox` | [stores/xbox.md](../stores/xbox.md) |
| `opinion.store_score_playstation` | [stores/playstation.md](../stores/playstation.md) |
| `opinion.store_score_meta`  | [stores/meta_store.md](../stores/meta_store.md) |
| `opinion.store_score_metacritic` | [stores/metacritic.md](../stores/metacritic.md) |
| `opinion.store_score_opencritic` | [stores/opencritic.md](../stores/opencritic.md) |
| `intelligence.news_details` | [pr_news.md](../pr_news.md) |
| `intelligence.game_metric_streamhatchet_*` | [streaming.md](../streaming.md) |
| `intelligence.streamhatchet_*` | [streaming.md](../streaming.md) |
| `marketing_hub.marketing_hub_*` | [marketing_hub.md](../marketing_hub.md) |
| `common.unified_ids` / `unified_competitor` / `country_region` / `game_event` | [id_mapping.md](id_mapping.md) + [geo_competitor.md](geo_competitor.md) |

---

## 2. 各表过滤键速查（**与 [id_mapping.md](id_mapping.md) §2 一致**）

> 来源：BigQuery `INFORMATION_SCHEMA.COLUMNS` + `INFORMATION_SCHEMA.TABLES` DDL 实测。
> VIEW 物理上无 partition / cluster，但业务侧仍按对应字段做过滤；标注"VIEW"提醒查询时不会触发 partition pruning。

| 表 | 过滤键 | 分区字段 | 分区类型/粒度 | 聚簇 |
|---|---|---|---|---|
| `opinion.public_feeds` | `unified_edition_id` | （VIEW，业务按 `comment_time` 过滤） | TIMESTAMP, DAY（业务约定） | （VIEW，业务上等价于按 `unified_edition_id` 聚簇） |
| `opinion.feeds_author` | `game_id`（实际存 unified_edition_id） | `_p_key` (`RANGE_BUCKET(_p_key, GENERATE_ARRAY(1, 2, 1))`，技术分桶) | INT64 | `game_id, md5_uin` |
| `opinion.kol` | `unified_edition_id` | `date` | DATE, **MONTH** (`DATE_TRUNC(date, MONTH)`) | `unified_edition_id, date` |
| `opinion.kol_tag` | `unified_edition_id` | — | — | `unified_edition_id, author_md5` |
| `opinion.dim_media_account` | `unified_edition_id` | — (VIEW) | — | — |
| `opinion.dim_keyword` | `unified_edition_id` | — (VIEW) | — | — |
| `opinion.dim_topic_labels` | `unified_edition_id` | — (VIEW) | — | — |
| `opinion.dim_channel` / `dim_language` | (维表，全量) | — (VIEW) | — | — |
| `opinion.media_account_publishing` | `unified_edition_id` | `date` | DATE, DAY | `unified_edition_id` — 官号发帖+互动预聚合，详见 [`../official_account_metrics.md`](../official_account_metrics.md) |
| `opinion.media_account_audience` | `unified_edition_id` | `date` | DATE, DAY | `unified_edition_id` — 官号粉丝快照+互动，详见 [`../official_account_metrics.md`](../official_account_metrics.md) |
| `opinion.googletrends_keyword` | （keyword + country + date） | — | — | `start_time, game_id` |
| `opinion.memes` | （title / region / type） | — | — | `title` |
| `opinion.meme_videos` | `meme_title` | `release_time` | TIMESTAMP, MONTH | `meme_title, url` |
| `opinion.top_mobile_game` / `top_pconsole_game` | （country + 排名） | `date` | DATE, **YEAR** | `game_id, date` |
| `opinion.store_score_steam` | `edition_id` | `create_time` | **DATETIME, MONTH** | `edition_id` |
| `opinion.store_score_steam_daily` | `edition_id` | **`date`** (分区键，非 `create_time`；表内仍有 `create_time` 列) | **DATETIME, MONTH** | `edition_id` |
| `opinion.store_score_steam_by_language_hourly` | `edition_id` | — (VIEW) | — | — |
| `opinion.store_score_app_store` | `unified_id` | `create_time` | **DATETIME, MONTH** | `unified_id` |
| `opinion.store_score_app_store_daily` | `unified_id` | **`date`** | **DATETIME, MONTH** | `unified_id, area, date` |
| `opinion.store_score_google_play` | `unified_id` | `create_time` | **DATETIME, MONTH** | `unified_id` |
| `opinion.store_score_google_play_daily` | `unified_id` | **`date`** | **DATETIME, MONTH** | `area, date, unified_id` |
| `opinion.store_score_taptap` | `unified_id` | `create_time` | **DATETIME, MONTH** | `unified_id` |
| `opinion.store_score_playstation` | `edition_id` | `create_time` | **DATETIME, DAY** (`DATE(create_time)`) | `edition_id` |
| `opinion.store_score_xbox` | `edition_id` | `create_time` | **DATETIME, MONTH** | `edition_id` |
| `opinion.store_score_meta` (BQ 实际表名，文档历史误写 `store_score_meta_store`) | `edition_id` | `create_time` | **DATETIME, DAY** (`DATE(create_time)`) | `edition_id` |
| `opinion.store_score_metacritic` | `edition_id` | `create_time` | **DATETIME, MONTH** | `edition_id` |
| `opinion.store_score_opencritic` | `edition_id` | `create_time` | **DATETIME, MONTH** | `edition_id` |
| `intelligence.news_details` | `unified_edition_id` | `release_time` | **DATETIME** (BQ 实测), MONTH | `unified_edition_id, release_time` |
| `intelligence.game_metric_streamhatchet_stream_uid` | `id`（unified_id） | — | — | `date` |
| `intelligence.game_metric_streamhatchet_channel_uid` | `id`（unified_id） | — | — | `date` |
| `intelligence.game_metric_streamhatchet_stream` | `app_id` | — | — | `date, app_id` |
| `intelligence.game_metric_streamhatchet_channel` | `app_id` | — | — | `date, app_id` |
| `intelligence.game_metric_streamhatchet_kol` | `app_id` | — | — | `date, app_id` |
| `intelligence.streamhatchet_sessions` | `app_id` | — | — | `date, app_id` |
| `intelligence.streamhatchet_profile` | `user_id` + `platform` | — | — | `user_id` |
| `intelligence.streamhatchet_kol_tag` | `app_id` | — | — | `unified_edition_id, user_name` |
| `marketing_hub.marketing_hub_hashtag_trending_tiktok` | （hashtag + country） | `date` | DATE, MONTH | `date, time_range, hashtag` |
| `marketing_hub.marketing_hub_hashtag_trending_exolyt` | （hashtag + country） | `date` | DATE, MONTH | `date, hashtag` |
| `marketing_hub.marketing_hub_hashtag_trending_tiktok_gaming` | （hashtag + country） | `date` | DATE, MONTH | `date, time_range, country, hashtag` |
| `marketing_hub.marketing_hub_hashtag_video` | `hashtag` | `video_release_time` | **DATETIME**, MONTH | `channel_name, hashtag, country, video_id` |
| `marketing_hub.marketing_hub_hashtag_video_info` | （video 关联） | — | — | `channel_name, video_id` |
| `marketing_hub.marketing_hub_hashtag_kol` | `hashtag` | `date` | DATE, MONTH | `channel_name, hashtag, anchor_uid` |
| `marketing_hub.marketing_hub_kol_info` | （KOL 补表） | — | — | `channel_name, anchor_uid` |
| `marketing_hub.marketing_hub_video` | （country + platform） | **无**（与 `_hashtag_video` 不同） | — | `video_url` |
| `common.app_detail` | `app_id` | `_p_key` (`RANGE_BUCKET(_p_key, GENERATE_ARRAY(1, 2, 1))`) | INT64 | `app_id` |
| `common.unified_ids` | `unified_id` 或 `edition_id` | `_p_key` (`RANGE_BUCKET(_p_key, GENERATE_ARRAY(1, 2, 1))`) | INT64 | `app_id` |
| `common.unified_ids_part` | `unified_edition_id` | — | — | `unified_edition_id` |
| `common.country_region` | `country_code` | — (VIEW) | — | — |
| `common.unified_competitor` | `unified_id` | — | — | `unified_id` |
| `common.game_event` | `games.game_id` / `event_start_time` | — | — | `start_time` |
| `common.company_details` | `uuid` | — | — | `uuid` |

---

## 3. 字段类型陷阱速查

| 字段 | 出现的表 | 类型 | 写错的报错 |
|---|---|---|---|
| `comment_time` | `opinion.public_feeds` | TIMESTAMP | — |
| `create_time` | `opinion.store_score_*` | **DATETIME** | 用 `TIMESTAMP_SUB` → `No matching signature for operator >= for argument types: DATETIME, TIMESTAMP` |
| `release_time` | `intelligence.news_details` | **DATETIME**（BQ DDL 实测；以前文档误标 TIMESTAMP） | SQL 中常用 `TIMESTAMP('...')` 字面量是隐式比较；严格写建议 `DATETIME('...')` |
| `release_time` | `opinion.meme_videos` | TIMESTAMP（**与下方 video_release_time 对照！同是视频时间，类型相反**） | — |
| `video_release_time` | `marketing_hub.marketing_hub_video` / `_hashtag_video` | **DATETIME**（**与上方 meme_videos.release_time 对照！**） | 用 `TIMESTAMP_SUB` → `No matching signature for operator >= for argument types: DATETIME, TIMESTAMP` |
| `date` | `opinion.kol` / `intelligence.streamhatchet_*` / `marketing_hub.*_hashtag_*` | DATE（不是 TIMESTAMP！） | 用 `TIMESTAMP('<...>')` 也能隐式转，但建议 `DATE('<...>')` |

---

## 4. 已废弃字段速查

`opinion.public_feeds` 表里：

| 字段 | 状态 |
|---|---|
| `unified_id` | 已废弃，请用 `unified_edition_id` |
| `edition_id` | 已废弃，请用 `unified_edition_id` |
| `sentiment_chunks` | 已废弃 |
| `sentence_chunks` | 已废弃 |

⚠️ **`unified_id` / `edition_id` 仅在 `public_feeds` 废弃**，在其他表（手游店、PC 店、common.unified_ids 等）正在使用。详见 [id_mapping.md](id_mapping.md) §6。

---

## 5. 不存在的字段（看着像但实际没有）

| 字段 | 哪张表 | 业务意图 → 替代方案 |
|---|---|---|
| `organization` | `opinion.public_feeds` | "区分官号 / 玩家" → 走 `dim_media_account.category` 反查（详见 [social_filter_logic.md](social_filter_logic.md)） |

---

## 6. 互动量字段（feeds 系列）

| 字段 | 含义 | 注意 |
|---|---|---|
| `tweets_view` | 浏览/播放量 | `> 0` 才计入 Views |
| `tweets_like` | 点赞 | **可能 < 0**，需 `IF(x<0,0,x)` 清洗 |
| `tweets_reply` | 回复 | 同上 |
| `tweets_retweet` | 转发 | 同上 |
| `tweets_unlike` | 踩 | 同上 |
| `follower_number` | 作者粉丝数 | `> 0` 才计入 Impressions（**严格 > 0**） |

详见 [public_feeds.md](../public_feeds.md) §1 互动量公式。

---

## 7. 商店评分字段范围速查

| 平台 | 字段 | 范围 |
|---|---|---|
| Steam | `all_reviews_score` / `recent_reviews_score` | **0-1**（前端 `* 100` 显示百分比） |
| App Store / Google Play | `store_score` | **1-5** |
| TapTap | `score` | 业务侧确认（常见 1-10） |
| Xbox | `store_score` | **1-5** |
| PlayStation | `store_score` | **1-5** |
| Metacritic | `meta_score` | **0-100**（媒体评分） |
| Metacritic | `user_score` | **0-10**（玩家评分） |
| OpenCritic | `top_critic_average_score` | **0-100** |

---

## 8. 不可直接查的数据（已知 BQ 路径未对接）

| 数据 | 说明 |
|---|---|
| 直播 Hours Watched 等的旧 MySQL 表 `t_opinion_streaming` | 已删除，替代方案：`intelligence.game_metric_streamhatchet_stream_uid` |
| 旧 MySQL `t_opinion_news` | 已删除，替代方案：`intelligence.news_details` |
| 旧 MySQL `t_opinion_comment_edit_sentiment_rating_log`（情感编辑日志） | 已删除，feeds 默认情感即生效 |
| `common.combined_ids` / `common.app_detail` | **已删除**，本 skill 不支持三端合查；详见 [id_mapping.md](id_mapping.md) §7 |

---

## 9. 兜底搜索建议

如果在所有业务 reference 都找不到字段，**最后兜底**：

1. 用 `INFORMATION_SCHEMA.COLUMNS` 直接 BigQuery 查 schema：

```sql
SELECT column_name, data_type, description
FROM `tencent-databrain-prod.opinion.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = '<table_name>'
ORDER BY ordinal_position;
```

2. 或先 `SELECT * FROM <table> WHERE <主过滤键> = '<...>' LIMIT 1` 探一行看真实字段。
