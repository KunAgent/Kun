# dim_tables — opinion 维度表 + channel_name 规范化

> 适用：`channel` / `language` / `topic` / `keyword` / `官号 mapping` 等"字段映射困惑"场景。
>
> 当 SQL 报"字段名拼错 / `Unrecognized name`"或"为什么过滤后 0 行"时，先查这里。

---

## 0. 涉及表概览

| 表 | 角色 | 关键字段 |
|---|---|---|
| `opinion.dim_media_account` | 监控官号配置 | `unified_edition_id`、`category`、`account_url`、`account_name`、`crawler_state`、`visibility` |
| `opinion.dim_keyword` | 监控关键词配置 | `unified_edition_id`、`keyword`、`crawler_state`、`visibility` |
| `opinion.dim_channel` | 渠道维表 | `channel_name`、`display_name`、`channel_type` |
| `opinion.dim_language` | 语言维表 | `language_code` + 中英文显示名 |
| `opinion.dim_topic_labels` | 话题分类维表 | `unified_edition_id`、`topic`、父话题、多语言翻译 |

> 元数据速查：以上 `opinion.dim_*` 表实测均为 **VIEW**，无物理 BigQuery partition / cluster；查询时仍应按业务过滤键（如 `unified_edition_id`、`category`、`crawler_state`、`visibility`）缩小范围。

---

## 1. `opinion.dim_media_account` — 监控官号配置（**最常用**）

### 字段速查

| 字段 | 说明 |
|---|---|
| `unified_edition_id` | **游戏 ID（必带）** |
| `account_name` | 账号名 |
| `account_url` | 账号 URL |
| `category` | **账号分类（9 种有效值，见下表）** |
| `visibility` | 可见性，过滤时用 `LOWER(visibility) != 'hidden'` |
| `crawler_state` | 爬虫状态，`1` = 正常爬取 |

### `category` 实测枚举（**9 种有效值 + 1 种兼容旧值**，BQ + 前端 bundle 交叉验证）

| `category` 值 | 含义 | 备注 |
|---|---|---|
| `official-accounts` | 官方运营账号 | 官方发声 / 排除官号看 UGC（B 路场景） |
| `discussion-groups` | 讨论群组 / 论坛 | 论坛、群组类账号 |
| `kol-monitoring` | 监控 KOL | 重点监控的 KOL 账号 |
| `single-post-comments` | 单帖评论 / 弹幕 | 单帖采集的评论 / 弹幕数据 |
| `live-broadcast` | 直播采集 | 直播相关数据采集 |
| `material` | UA 素材 | UA 投放素材相关 |
| `private-channels` | 私密渠道（**小写带横线**） | 私密 / 内部渠道账号 |
| `reddit` | Reddit 专用 | Reddit 渠道专用账号 |
| `PRIVATE` | （**兼容旧值**） | 历史遗留，前端 bundle 仍兼容；BQ 主流值已迁到 `private-channels`，新写过滤优先用新值 |

**⚠️ 脏数据**：实测 BQ 还有 `category = 'string'` 的脏行（占位/导入 bug），所有 `dim_media_account` 取数模板**必须 `AND category != 'string'` 排除**。

**⚠️ 重要**：`category` 是 **monitor source 配置维度**，**不等同于** `feeds_author.is_official_account`（**业务事实标准的"官号 vs 玩家"二元划分**）。要做"官号 vs 玩家"过滤请走 A 路（见 [social_filter_logic.md](social_filter_logic.md) §3.1），不要用 `category='official-accounts'`。

> 历史文档曾列过 `EXTERNAL` 这个值——经 BQ DISTINCT 实测、前端 bundle、业务代码多方核对均不存在，已删除。

### `match_key` 拼接规则（**DataBrain 平台官方约定**）

`feeds.sources` 里 `s.url + '#_#' + s.name` 与 `dim_media_account.account_url + '#_#' + account_name` 对齐：

```sql
-- match_key 标准拼接
LOWER(CONCAT(account_url, '#_#', account_name))
```

### 取分类账号列表标准模板（**4 条件必带**）

```sql
SELECT DISTINCT
  LOWER(CONCAT(account_url, '#_#', account_name)) AS match_key
FROM `tencent-databrain-prod.opinion.dim_media_account`
WHERE unified_edition_id = '<game_id>'
  AND category = '<target_category>'              -- 见上方 9 种有效值
  AND category != 'string'                        -- 必带（排除脏数据）
  AND LOWER(visibility) != 'hidden'               -- 必带
  AND crawler_state = 1                           -- 必带
  AND account_name != ''                          -- 必带
```

> 在 `feeds` 中按 category 聚合的完整 SQL 见 [social_filter_logic.md](social_filter_logic.md)。

---

## 2. `opinion.dim_keyword` — 监控关键词配置

| 字段 | 说明 |
|---|---|
| `unified_edition_id` | **游戏 ID（必带）** |
| `keyword` | 监控关键词 |
| `visibility` | 可见性 |
| `crawler_state` | 爬虫状态 |

### 取关键词列表标准模板

```sql
SELECT DISTINCT LOWER(keyword) AS match_key
FROM `tencent-databrain-prod.opinion.dim_keyword`
WHERE unified_edition_id = '<game_id>'
  AND LOWER(visibility) != 'hidden'
  AND crawler_state = 1
  AND keyword != ''
```

---

## 3. `opinion.dim_channel` — 渠道维表

字段：`channel_name`（小写枚举）/ `display_name`（前端展示用）/ `channel_type`（`social` / `comments` / `news`）

### ⚠️ 2026-05 更新：`channel_name` 真实底层枚举（实测 2025-12 数据，权威）

旧版本文档曾说 "YouTube → `youtube`、Twitch → `twitch`、`youtube_keyword/youtube_live` 要合并为 youtube"，**这是错的**。

实测三套底表（`public_feeds` / `opinion.kol` / `media_account_publishing`）中 channel_name 的**真实底层枚举值完全一致**，**没有** `'youtube'` / `'twitch'` 这种"已规范化"的单值——`youtube_keyword` 等就是底表的真实值。

**业务平台 → 真实 channel_name 映射（权威，所有 reference 文档统一引用本表）**：

| 用户说 | 真实 `channel_name`（用于 WHERE filter） | 备注 |
|---|---|---|
| YouTube | `'youtube_keyword'` ⚠️ | **不是 `youtube`**！实测三表中 `youtube` 单值零记录 |
| Twitch | `'twitch_keyword'` ⚠️ | **不是 `twitch`** |
| Twitter / X | `'twitter'` | |
| TikTok / 抖音(海外) | `'tiktok'` | |
| Facebook | `'facebook'` | |
| Instagram | `'instagram'` | |
| Reddit | `'reddit'` | ⚠️ `opinion.kol` 表**无** Reddit 数据；`public_feeds` / `media_account_publishing` 有 |
| Bilibili (B 站) | `'bilibili'` | |
| Discord | `'discord'` | |
| Steam（商店评测） | `'steam'` | 配 `channel_type='comments'` |
| Steam 社区讨论 | `'steam_community'` | 配 `channel_type='social'` |
| Google Play / GP | `'google play'` ⚠️ | **带空格** |
| App Store / iOS | `'app store'` ⚠️ | **带空格** |
| 抖音 (Douyin) | `'douyin'` | |
| 快手 (Kuaishou) | `'kuaishou'` | |
| 小红书 (Xiaohongshu / RED) | `'xiaohongshu'` | |
| 贴吧 (Tieba) | `'tieba'` | |
| NGA | `'nga'` | |
| VK | `'vk'` | |
| Bluesky | `'bsky'` | |
| Threads | `'threads'` | |
| Xbox | `'xbox'` | 配 `channel_type='comments'` |
| PlayStation | `'playstation'` | 配 `channel_type='comments'` |
| Naver Cafe | `'cafe'`（旧）或 `'navercafe'` | 实测有 `'cafe'` 值，规范化后展示为 `navercafe` |

### 业务侧"展示层"规范化（仅在 SELECT 投影里使用，WHERE filter 仍用底层值）

如果业务需要把 `youtube_keyword` / `youtube_live` 合并展示为 "youtube"：

```sql
SELECT
  -- ⚠️ 仅在 SELECT 投影里聚合成展示名（不影响 WHERE filter）
  CASE
    WHEN channel_name IN ('twitch_keyword','twitch_live')   THEN 'twitch'
    WHEN channel_name IN ('youtube_keyword','youtube_live') THEN 'youtube'
    WHEN channel_name = 'cafe'                              THEN 'navercafe'
    ELSE channel_name
  END AS channel,
  ...
FROM `tencent-databrain-prod.opinion.public_feeds`
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<start>')
  AND comment_time <  TIMESTAMP('<end>')
  -- ⚠️ filter 还是用底层枚举值
  AND LOWER(channel_name) IN ('youtube_keyword', 'youtube_live')
```

### 统一规则（金科玉律）

1. **所有 WHERE filter 用 `LOWER(channel_name) IN ('<底层值1>','<底层值2>')` 列表匹配**
2. **不要**用 `channel_name = 'youtube'` 等值匹配——会得到 0 行
3. YouTube 在 KOL 类指标（hotness.kol_publications、kol.all_*）实测**只有 `youtube_keyword` 一种值**；如果用户问"YouTube"，过滤 `IN ('youtube_keyword')` 即可（`youtube_live` 仅 30 行/月，直播侧另立 reference）

### `channel_type` 三类

| 值 | 含义 |
|---|---|
| `social` | 社媒 / 社区（Twitter / YouTube / TikTok / Reddit / Bilibili / Facebook 等） |
| `comments` | 商店评论（Steam / Google Play / App Store / Xbox / PlayStation 等） |
| `news` | 新闻（注：新闻完整数据走 [pr_news.md](../pr_news.md)，不在 feeds 里完整采集） |

### 易混淆的"看似一样实则不同"

- `'steam_community'` ≠ `'steam'`：
  - `'steam_community'` = Steam 社区讨论帖（`channel_type='social'`）
  - `'steam'` = Steam 商店评测（`channel_type='comments'`）
- `'youtube_keyword'` ≠ `'youtube_live'`：
  - `'youtube_keyword'` = 关键词追踪的 YouTube 视频/创作者（占绝大多数）
  - `'youtube_live'` = YouTube 直播（极少数样本，直播侧另立 [streaming.md](../streaming.md)）

---

## 4. `opinion.dim_language` — 语言维表

字段：`language_code`（小写 ISO-2）+ 中英文显示名。

实际数据中常见 `language_code`：`en` / `zh` / `zh-hant` / `ja` / `ko` / `pt` / `ru` / `de` / `fr` / `es` / `it` / `nl` / `id` / `vi` / `th` / `tr` / `ar`。

⚠️ **`'cn'` 在某些表里出现（旧值）**：写 SQL 时建议 `language_code IN ('zh','cn')` 兜底。

---

## 5. `opinion.dim_topic_labels` — 话题分类维表

字段：`unified_edition_id` + `topic`（NLP 话题）+ 父话题 + 多语言翻译。

⚠️ **`feeds.topics` 大小写不一致**（NLP 模型版本迭代导致）：`'AI'` vs `'Ai'`、`'BUG'` vs `'Bug'`、`'MLBB'` vs `'Mlbb'`。聚合 `feeds.topics` 时一律 `UPPER(t)` 或 `LOWER(t)` 归一化，否则同话题被拆成两行漏 30-50% 量。

详见 [public_feeds.md](../public_feeds.md) §7.2。

---

## 6. 注意事项

1. `dim_media_account` / `dim_keyword` 的查询**必须带 `unified_edition_id`**（这是它们的事实归属键）+ `crawler_state=1` + `visibility!='hidden'` 三条件
2. `match_key` 拼接顺序固定：`url + '#_#' + name`（不要写反）
3. `channel_name` 写错就 0 行无报错——不确定时先 `SELECT DISTINCT channel_name FROM public_feeds WHERE unified_edition_id='...' AND comment_time >= ... LIMIT 1000` 探一下
4. `category` 9 种有效值是**业务侧约定的枚举**，不是数据库字段类型；写错（如 `'official_accounts'`、`'OFFICIAL'`）会得到 0 行；脏数据 `'string'` 必须排除
5. **`category` ≠ `feeds_author.is_official_account`**：要做"官号 vs 玩家"过滤请走 A 路，详见 [social_filter_logic.md](social_filter_logic.md) §3.1
