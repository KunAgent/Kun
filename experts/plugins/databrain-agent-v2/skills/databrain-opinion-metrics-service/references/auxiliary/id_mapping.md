# id_mapping — ID 体系单一真理源

> **本文档是整个 skill 的 ID 决策中枢**。任何"哪张表用哪个 ID"、"unified_id↔app_id 转换"、"手游店 vs PC 店过滤键"的困惑，回到这里查。

---

## 1. 上游 ID 字段含义（`scripts/game_search.py` 输出）

react_agent_service 的 system prompt **不直接注入 BigQuery ID**，必须先用 `scripts/game_search.py` 解析。脚本输出的 5 个 ID 字段：

| API 字段 | 含义 | 前缀 | 等价于哪些"列名" |
|---|---|---|---|
| `game_id` | DataBrain 单端游戏 id（顶层兼容字段，= `mobile_id` 或 `pc_id` 之一） | `u` (mobile) / `e` (pc/console) | `unified_edition_id`（feeds 等舆情主表） |
| `mobile_id` | Mobile 单端游戏 id | `u...` | `unified_id`（手游店）/ `unified_edition_id`（feeds、kol、news） |
| `pc_id` | PC 单端游戏 id | `e...` | `edition_id`（PC 商店）/ `unified_edition_id`（feeds、kol、news） |
| `console_id` | Console 单端游戏 id | `e...` | `edition_id`（Console 商店） |
| `combine_id` | 跨端聚合 id（PC+Console+Mobile 三端融合） | `c...` | `combined_id`（**本舆情 skill 不直接使用**；text2sql 跨端聚合表用） |
| `entity_id` | 公司/开发商/发行商 UUID | UUID | `common.company_details` 等 |

> 同一款游戏的 `mobile_id` / `pc_id` / `console_id` 可能都存在（如 PUBG Mobile 既有 mobile_id 也有 pc_id）；视用户问的版本选哪个传给 SQL。

---

## 2. 各表过滤键速查

⚠️ **同一个 ID 在不同表里物理列名不同**！必须按这张表选对列名，否则 0 行无报错。

### opinion 域

| 表 | 过滤键（物理列名） | 传 game_search.py 输出的哪个字段 |
|---|---|---|
| `opinion.public_feeds` ⭐ | `unified_edition_id` | `game_id` / `mobile_id` / `pc_id` / `console_id` 任一（全部接受 u/e 前缀） |
| `opinion.feeds_author` | `game_id`（**物理列名就叫 game_id**！里面存的是 unified_edition_id） | 同上 |
| `opinion.kol` | `unified_edition_id` | 同上 |
| `opinion.kol_tag` | `unified_edition_id` | 同上 |
| `opinion.dim_topic_labels` | `unified_edition_id` | 同上 |
| `opinion.dim_media_account` | `unified_edition_id` | 同上 |
| `opinion.media_account_publishing` | `unified_edition_id` | 同上 |
| `opinion.media_account_audience` | `unified_edition_id` | 同上 |
| `opinion.dim_keyword` | `unified_edition_id` | 同上 |
| **手游店**：`opinion.store_score_app_store` / `_app_store_daily` | `unified_id`（**不带 edition！**） | `mobile_id` |
| **手游店**：`opinion.store_score_google_play` / `_google_play_daily` | `unified_id` | `mobile_id` |
| **手游店**：`opinion.store_score_taptap` | `unified_id` | `mobile_id` |
| **PC 店**：`opinion.store_score_steam` / `_daily` / `_by_language_hourly` | `edition_id` | `pc_id` |
| **Console 店**：`opinion.store_score_playstation` | `edition_id` | `console_id` |
| **Console 店**：`opinion.store_score_xbox` | `edition_id` | `console_id` |
| **Console 店**：`opinion.store_score_meta` | `edition_id` | `console_id` |
| **PC/Console 店**：`opinion.store_score_metacritic` | `edition_id` | `pc_id` 或 `console_id` |
| **PC/Console 店**：`opinion.store_score_opencritic` | `edition_id` | `pc_id` 或 `console_id` |
| `opinion.googletrends_keyword` | （**无游戏 ID**，按 `keyword` + `country` + `date` 过滤） | — |
| `opinion.memes` / `meme_videos` | （**行业级，不绑定游戏 ID**，按 `meme_title` / `region_code` / `release_time` 过滤） | — |
| `opinion.top_mobile_game` / `top_pconsole_game` | （重点游戏池，按 `country` + 排名过滤） | — |

### intelligence 域

| 表 | 过滤键 | 传 game_search.py 哪个字段 |
|---|---|---|
| `intelligence.news_details` | `unified_edition_id` | `game_id` / `mobile_id` / `pc_id` / `console_id` |
| `intelligence.game_metric_streamhatchet_stream_uid` ⭐（_uid 优先版） | `id`（**实际是 unified_id**） | `mobile_id` 或 `pc_id` |
| `intelligence.game_metric_streamhatchet_channel_uid` ⭐ | `id` | 同上 |
| `intelligence.game_metric_streamhatchet_stream`（原版） | `app_id`（StreamHatchet 数据源原始 id） | **需 join `common.unified_ids` 转换**（见 §4） |
| `intelligence.game_metric_streamhatchet_channel`（原版） | `app_id` | 同上 |
| `intelligence.game_metric_streamhatchet_kol`（**无 _uid 版**） | `app_id` | 同上 |
| `intelligence.streamhatchet_sessions`（**无 _uid 版**） | `app_id` | 同上 |
| `intelligence.streamhatchet_profile`（主播资料补表，无 game 键） | `user_id` + `platform` | — |
| `intelligence.streamhatchet_kol_tag` | `app_id` | 同上 |

### marketing_hub 域

`marketing_hub.*` 8 张表都是**行业级聚合**，**不按游戏 ID 过滤**，按 `country` / `time_range` / `hashtag` / `platform` / `video_release_time` 过滤。详见 [marketing_hub.md](../marketing_hub.md)。

### common 域

| 表 | 用途 |
|---|---|
| `common.unified_ids` | unified_id ↔ app_id ↔ edition_id 映射（直播侧 join 必需） |

---

## 3. ID 选择决策树

```
用户问的指标
├── 舆情主表（声量/情感/Brand Health/互动/Earned/官号 / 主帖子帖 / TrendingPosts/Video / 词云）
│     → opinion.public_feeds → WHERE unified_edition_id = '<game_id>'
│
├── KOL（创作者榜单/趋势/标签）
│     → opinion.kol → WHERE unified_edition_id = '<game_id>'
│
├── 商店评分
│     ├── App Store / Google Play / TapTap（手游）
│     │     → store_score_app_store / google_play / taptap → WHERE unified_id = '<mobile_id>'
│     └── Steam / PlayStation / Xbox / Meta Store / Metacritic / OpenCritic（PC/Console）
│           → store_score_steam / playstation / xbox / metacritic / opencritic → WHERE edition_id = '<pc_id 或 console_id>'
│
├── 直播
│     ├── 游戏级 trends（hours_watched / peakCCV / avgCCV）
│     │     → game_metric_streamhatchet_stream_uid / channel_uid → WHERE id = '<mobile_id 或 pc_id>'   ⭐ 优先
│     └── KOL / sessions / profile（无 _uid 版）
│           → 原版表 + WHERE app_id IN (SELECT app_id FROM common.unified_ids WHERE unified_id = '<game_id>')
│
├── 新闻 PR
│     → intelligence.news_details → WHERE unified_edition_id = '<game_id>'
│
├── 行业级（marketing_hub.* / memes / googletrends / Channel Share market_popularity）
│     → 不按 game_id 过滤
│
└── 公司维度（开发商 / 发行商）
      → 本 skill 不支持公司聚合舆情，让用户提具体游戏列表
```

---

## 3.5 ⚠️ 跨平台游戏的 PC vs Mobile ID 决策（**写错就 0 行**）

对**既有 PC/Console 版又有 Mobile 版**的游戏，`game_search.py` 默认返回的 `entity_type` **不一定符合舆情数据实际存放位置**。

### 实测验证（2025-12 数据）

| 游戏 | `game_search.py` 默认 entity_type | 舆情数据实际在 | 用错 ID 后果 |
|---|---|---|---|
| Fortnite | mobile (`uf2f54...`) | **PC** `efac98152ddaf5d5d08d6286e2626e83c` | 用 mobile id 查 opinion.kol YouTube → **0 行** |
| Naraka: Bladepoint | mobile (`u899803...`) | **PC** `ea3a8c0f4c15ae15a875184e6fa700dbf` | 用 mobile id 查 KOL 观看量 → 数值偏低 |
| Apex Legends | combined `u10000000015` | **PC** `ef350d7af297093f5707ef7c787279e9c` | 用 combined id 查 YouTube 负面占比 → 0 mentions |
| Forza Horizon 5 | mobile (`uca3bf6...`) | **PC** `e0462af36fdfb4df439d29208fe591306` | 数据全 0 |
| Diablo IV | combined / mobile | **PC** `e105fe4609b81f5b00fe298ddd2abce47` | |
| Warframe | mobile (`u8f17b8...`) | **PC** `e11000000282` | |
| HELLDIVERS 2 | mobile (`ube0022...`) | **PC** `e5c9edf94f3fe9cac5509db1c53395224` | 用 mobile id 查发帖作者数 → 0 行 |
| Dying Light 2: Stay Human | PC `edd35f...` | PC 同左 | — |
| FragPunk | PC `e738bc...` | PC 同左 | — |
| Hunt: Showdown 1896 | PC `e0cf81...` | PC 同左 | — |
| Valorant | mobile (`u5e4dad...`, **= Valorant Mobile 独立游戏**) | **PC** `e8cf4268c5acf0adaa5aa539cf6c0c9af` | 用 mobile id 查官号互动 → 中国渠道（douyin/kuaishou/bilibili）数据，与 PC 全球账号数据不同 |
| ROBLOX | mobile `u080032...`（实际是 ROBLOX 跨端 unified） | mobile id 有数据 ✅ | — |
| Genshin Impact | mobile `uf0a4c6...` | mobile id 有数据 ✅（包括 YouTube 等海外社媒） | — |
| Uma Musume: Pretty Derby | mobile `u610b8f...` | mobile id 有数据 ✅ | — |

### 决策原则

1. **PC-only / PC-leading 游戏**（端游为主，手游版很小众或不存在）→ **必用 PC id**（前缀 `e`）
   - 典型：Fortnite / Apex / Forza / Diablo / Warframe / HELLDIVERS 2 / Hunt Showdown / Dying Light 2 / FragPunk / Naraka 端游版
2. **Mobile-only / Mobile-leading 游戏**（手游为主或全球大体量手游）→ 用 mobile id
   - 典型：Genshin Impact / Uma Musume / MLBB / Brawl Stars / PUBG MOBILE / 王者荣耀 / Arena of Valor / Garena Free Fire / Pokémon TCG Pocket / 燕云十六声 / Delta Force Mobile / Whiteout Survival / Age of Empires Mobile / Love and Deepspace / EA SPORTS FC Mobile
3. **既有 PC 又有大量 mobile 数据的游戏**（少见）：ROBLOX、Genshin Impact 等用 mobile id 也能查到大量数据；优先 mobile id（多数 cube view 默认走 mobile）

### 验证 SQL（probe 一下确认）

如果不确定，先跑（`today` 取注入的当前时间(UTC+8)、缺失回退 `now_beijing.py`；近 7 天起点 = `<today-6>`，终点 = `<today>` 含今天）：

```sql
-- 用 mobile id 试探
SELECT COUNT(*) FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<mobile_id>'
  AND comment_time >= TIMESTAMP('<today-6>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<today>'), INTERVAL 1 DAY)
LIMIT 1;

-- 用 PC id 试探
SELECT COUNT(*) FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<pc_id>'
  AND comment_time >= TIMESTAMP('<today-6>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<today>'), INTERVAL 1 DAY)
LIMIT 1;
```

哪个返回的行数大就用哪个。`game_search.py --type pc` / `--type mobile` 可以指定查特定平台 ID。

---

## 4. `common.unified_ids` join 模板（直播侧 unified_id → app_id 转换）

直播原版表（`game_metric_streamhatchet_kol` / `streamhatchet_sessions` / `_channel`、`_stream` 非 _uid 版）必须经 `common.unified_ids` 转换：

```sql
WHERE app_id IN (
  SELECT app_id
  FROM `tencent-databrain-prod.common.unified_ids`
  WHERE unified_id = '<game_id>' OR edition_id = '<game_id>'
)
```

性能优化（如可访问）：

```sql
-- common.unified_ids_part 实测无物理分区，按 unified_edition_id 聚簇；按该字段过滤通常更快
SELECT app_id
FROM `tencent-databrain-prod.common.unified_ids_part`
WHERE entity_type = 'pc'
  AND unified_edition_id = '<game_id>'
```

---

## 5. 手游店 vs PC/Console 店的过滤键陷阱（**必读**）

| 商店类型 | 物理列名 | game_search.py 输出 | 写错就 0 行（无报错） |
|---|---|---|---|
| **手游店**（App Store / Google Play / TapTap） | `unified_id` | `mobile_id` | ⚠️ 写 `WHERE unified_edition_id = ...` → 列名不存在或 0 行 |
| **PC 店**（Steam） | `edition_id` | `pc_id` | ⚠️ 写 `WHERE unified_id = ...` → 0 行 |
| **Console 店**（PS/Xbox/Meta Store） | `edition_id` | `console_id` | 同上 |
| **PC/Console 共享**（Metacritic/OpenCritic） | `edition_id` | `pc_id` 或 `console_id` | 同上 |

**记住**：列名按表选，前缀按平台选——
- 列名 `unified_id` 表示这张表只接受 `u...` 前缀（手游）
- 列名 `edition_id` 表示这张表只接受 `e...` 前缀（PC/Console）
- 列名 `unified_edition_id` 表示这张表接受 `u/e` 任一前缀（feeds、kol、news 等舆情主表）

---

## 6. 字段废弃辨析（**重要！避免误解**）

BigQuery 实测确认 `opinion.public_feeds` 表里的 schema 标注：

| 字段 | 状态 |
|---|---|
| `unified_edition_id` | ✅ **正在用**（"unified_id(mobile) or edition_id(pc/console)"） |
| `unified_id` | **已废弃**（"这是废弃字段，请使用 unified_edition_id"） |
| `edition_id` | **已废弃**（"这是废弃字段，请使用 unified_edition_id"） |

**但这只在 `opinion.public_feeds` 这一张表里废弃！** 在**其他表里**这两个字段是正在使用、必须使用的：
- 手游店 `store_score_app_store_*` / `_google_play_*` / `_taptap` 物理列名就叫 `unified_id`
- PC/Console 店 `store_score_steam_*` / `_playstation` / `_xbox` / `_metacritic` / `_opencritic` 物理列名就叫 `edition_id`
- `common.unified_ids` 同时含 `unified_id` 和 `edition_id` 两列（这就是 app_id ↔ game_id 的转换表）

**本质**：「同一个 ID 在不同表用不同物理列名」，**不是全局废弃**。

---

## 7. 三端合查能力受限

`opinion.public_feeds.unified_edition_id` **不接受 `combined_id`（c... 前缀）**：feeds 是单端表，只有 u/e 形式。

历史方案是先 `common.combined_ids` 展开成 mobile/pc/console 三个单端 ID 再 UNION。**但本 skill 已删除 `common.combined_ids`** —— 所以本 skill **不支持三端合查**。

如果用户问"三端总声量"，**让用户分别提供 mobile/pc/console 单端 ID**（或让 `game_search.py` 同时返回多端 ID 后，分别查 + 上层做 UNION），不要硬写 SQL 查 `common.combined_ids`。

---

## 8. 引用 / 反链

- `streaming.md` 顶部「ID 选择」小节内联简版
- `stores/*.md` 每份顶部一句话标明 `unified_id` vs `edition_id`
- `SKILL.md` Phase 1.5 解析 ID 步骤
