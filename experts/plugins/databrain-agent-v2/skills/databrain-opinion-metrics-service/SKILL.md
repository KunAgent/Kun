---
name: databrain-opinion-metrics-service
description: "DataBrain 舆情指标查询助手。把游戏舆情/口碑/声量/情感/评分/KOL/直播/新闻/热门视频/热门帖子/Hashtag/热梗/竞品/官号 等问题，以及**游戏广告投放素材/创意取数**（创意数·素材数·素材类型·渠道·国家维度·素材明细列表）翻译成可执行的 BigQuery SQL，覆盖 opinion / intelligence / marketing_hub schema。**只支持游戏维度查询**，不支持公司/开发商/发行商聚合舆情；**不支持** UA 预算/团队规模/未来预测/决策建议/因果归因等问题，遇到会主动路由或拒绝。纯运营指标（独立的下载/收入/DAU/留存）归 databrain-intelligence；但**素材趋势 × DAU/下载时间对齐对比**在本 skill 素材 reference 内有限支持。触发关键词：舆情、口碑、声量、mentions、情感、sentiment、Brand Health、品牌健康度、评分、score、Steam/AppStore/GooglePlay/Xbox/PS/Metacritic/OpenCritic、好评率、KOL、网红、创作者、博主、直播、Streaming、Hours Watched、Peak CCV、新闻、News、PR、Google Trends、热门视频、热门帖子、Trending、Hashtag、TikTok、Meme、热梗、官号、Official Account、Earned、竞品、Competitor、话题、Topic、关键词、词云、市场热度、Channel Share、社媒、互动、Engagement、观看、Views、发帖、Publications、潜在曝光、Impressions、玩家评价、玩家讨论、Steam 评论、商店评论、投放素材、广告素材、广告创意、creatives、materials、素材库、素材列表、广告列表、创意数、素材数、新增素材、新增创意、素材类型、素材分布、渠道创意数、渠道占比、素材曝光、素材互动、素材评分、素材榜单、TopN 素材、国家投放、多游戏素材对比、竞品素材、视频标签"
---

# DataBrain Opinion Metrics Service

把游戏舆情问题翻译成 **BigQuery SQL**，通过 DataLab `/api/v1/datalab/skill/exec_sql` 接口执行。

---

## Upstream Contract（上游契约）

react_agent_service 的 system prompt 通过 `game_info_by_name` 提供 `game_name` / `game_type`(pc/console/mobile) / `release_dates_by_platforms` / `game_business_model`(paid/free)，但**不直接给 BigQuery 用的 ID**。首次必须用 `scripts/game_search.py` 把名字解析成 `unified_edition_id`（舆情主表过滤键）/ `mobile_id` / `pc_id` / `console_id` / `combine_id`（见 [Phase 1.5](#phase-15--解析游戏-id)）。**若 ID 已在对话历史/上下文中出现，直接复用，不要再调 `game_search.py` 验证。**

---

## ⚠️ 最重要的一条规则：`opinion.public_feeds` 聚簇键 + 分区键

`opinion.public_feeds` 物理上是 **VIEW**（自身无 BQ partition/cluster），但底层是亿级 `base_feeds`。**每条读它的 SQL 必须同时带**：

1. **游戏过滤（等价聚簇键）**：`WHERE unified_edition_id = '<game_id>'`（或 `IN (...)`）— **绝不能省**
2. **时间过滤（等价分区键）**：`AND comment_time >= TIMESTAMP('<start>') AND comment_time < TIMESTAMP_ADD(TIMESTAMP('<end>'), INTERVAL 1 DAY)`

缺任一个 → 必然 **61001 timeout** + 浪费配额（连"探查字段"也要带一个具体 id + 一周窗，不要写 `SELECT * FROM opinion.public_feeds LIMIT 1`）。该约束对所有基于 `base_feeds` 的视图（`hotness` / `feeds_topic` / `game_store_reviews` / `video_and_posts_*` / `official_account_*`）同样生效。

---

## Runtime Environment Variables

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `DATABRAIN_TOKEN` | **是** | — | 认证 token 原始值（**不含 `Bearer ` 前缀**，脚本自动拼接，由平台环境变量注入） |
| `DATABRAIN_HOST`  | 否 | `https://databrain.intlgame.com` | DataBrain API host；只接受可信域名 |
| `DATABRAIN_DISPLAY_HOST` | 否 | — | 回答中展示链接的 host（如 `https://databrain.woa.com`） |

---

## Hard Constraints

- **只读**：仅 `SELECT` / `WITH ... SELECT`，禁止 `INSERT` / `UPDATE` / `DELETE` / `DROP` / `CREATE` / `MERGE` / `TRUNCATE`（脚本会预先拦截）
- ⚠️ **时间 UTC+8（北京时间）锚定**：
  - `today` 来源 = system prompt 顶部已注入的 `当前时间`（该值已是 UTC+8 北京时间），**直接取其日期部分作为 `today`**；**仅当上下文里没有该字段时**，才回退 `python scripts/now_beijing.py`。无需为每条查询都跑脚本。
  - **禁止**在 SQL 中出现 `CURRENT_TIMESTAMP()` / `CURRENT_DATE()` / `CURRENT_DATETIME()`（含 `TIMESTAMP_SUB(CURRENT_TIMESTAMP(), ...)` 等组合）—— BQ 走 UTC 服务时钟，与业务北京时间错位最多 8h、窗口边界会截尾（实测 NIKKE 近 5 天声量偏差 23%）。一律从 `today` 自算纯字面量窗口。
  - **不加 `'Asia/Shanghai'` 时区参数**：数据按"北京时间字面量灌库"，加了反而 -8h 错位。
  - 完整窗口算法 + 右开窗口/闭区间规则见 [Phase 2.3 时间词翻译速查表](#23-时间词翻译速查表写错就时间窗错位)；回答披露口径见 [Phase 4](#phase-4--输出契约output-contract)。
- **`opinion.public_feeds` 必带聚簇键 + 分区键**（见上方红框）：单缺一个就 61001 timeout，双缺必跑死。
- **其他事实表也要带真实分区/聚簇/高选择性过滤**，缺失触发 **61001 timeout**。常见分区/时间字段：
  - `opinion.public_feeds.comment_time` (TIMESTAMP, DAY 业务约定 — VIEW 无 BQ partition) — 同时要 `unified_edition_id` 聚簇
  - `opinion.kol.date` (DATE, **MONTH**：`DATE_TRUNC(date, MONTH)`) — 聚簇 `unified_edition_id, date`
  - **`opinion.media_account_publishing.date` (DATE, DAY 分区) — 聚簇 `unified_edition_id`**（官号汇总数字主事实表）
  - `opinion.media_account_audience.date` (DATE) — 聚簇 `unified_edition_id`（仅粉丝数）
  - `intelligence.news_details.release_time` (**DATETIME**, **MONTH**：`DATETIME_TRUNC(release_time, MONTH)`) — 聚簇 `unified_edition_id, release_time`
  - `intelligence.game_metric_streamhatchet_*`：无物理分区；`_uid` 版聚簇 `date`，原版聚簇 `date, app_id`
  - `opinion.store_score_*.create_time`（**DATETIME**，不是 TIMESTAMP！）；`opinion.store_score_*_daily` 分区字段是 **`date`**（不是 `create_time`）
  - marketing_hub / meme 系（`marketing_hub_video` 聚簇 `video_url`、`marketing_hub_hashtag_video.video_release_time` DATETIME·MONTH、`marketing_hub_hashtag_trending_*.date`·`hashtag_kol.date` DATE·MONTH、`opinion.meme_videos.release_time` TIMESTAMP·MONTH）— 详见各自 reference
- **总要带 LIMIT**：默认 1000，最大 5000；TopN 类查询用具体 N
- **每个 FROM 都用 `schema.table`** 或全限定 `tencent-databrain-prod.<schema>.<table>`；不要用裸表名
- **`opinion.public_feeds.country = 'global'` 占 70%+**：按国家过滤前在回答中说明覆盖率，避免误导（详见 [geo_competitor.md](references/auxiliary/geo_competitor.md)）
- **`feeds.organization` 字段不存在**：区分官号/玩家请通过 `feeds_author.is_official_account = 1` 反查（详见 [social_filter_logic.md](references/auxiliary/social_filter_logic.md) §3.1）

---

## ⚠️ 指标 → 底表 决策表（**写错就数值偏差 1.x ~ 87 倍**）

业务 UI 上的数字背后是 cube view 路径，对应到 BigQuery 物理表。**指标族不同，底表不同，混用会严重偏差**：

| 指标族 | 底表 | reference | 关键说明 |
|---|---|---|---|
| **官号互动量 / 转发 / 观看 / 发帖 / 评论 / 点赞量** | `opinion.media_account_publishing` ⭐ | [official_account_metrics.md](references/official_account_metrics.md) §3-§6 | 物理表已预聚合"官号 × 日 × 渠道"，**不需 JOIN feeds_author**；engagement 第 4 项用 `unlike_number`（非 `tweets_unlike`） |
| **官号粉丝数** | `opinion.media_account_audience` | [official_account_metrics.md](references/official_account_metrics.md) §7 | 唯一例外，仍走 audience 表 |
| **网红/KOL 发帖数** | `opinion.public_feeds` + LEFT JOIN `feeds_author`（排除官号） | [kol.md](references/kol.md) §2 | hotness 路径；`channel_type='social'`、`comment_parent_id='-1'`、`a.is_official_account IS NULL OR != 1` |
| **活跃 KOL 数 / KOL 观看 / 互动 / 榜单 / 粉丝** | `opinion.kol` + base_kol 4 条硬过滤（`follower_number>0`/`posts>0`/`channel_name != 'reddit'`/排除官号 KOL） | [kol.md](references/kol.md) §3-§5 | ⚠️ **不支持 Reddit**（底表无数据） |
| **声量 / 情感 / Brand Health / 互动 / 曝光 / 发帖人数(creators) / 视频播放量** | `opinion.public_feeds` | [public_feeds.md](references/public_feeds.md) | `creators` / `publications` 必带 `channel_type='social'` |
| **商店评分** | `opinion.store_score_*_daily` / `_*` | [stores/](references/stores/) | 默认"全局加权平均一个数" `SUM(comments_number * store_score) / SUM(comments_number)` |
| **App Store / Google Play 新增评论数** | `opinion.public_feeds` + `channel_type='comments'` + `channel_name IN ('app store','google play')` | [stores/app_store.md](references/stores/app_store.md) §3 | **不**走 store_score_*_daily 累计差 |
| **新闻情感 / News Brand Health / News Engagement** | `intelligence.news_details` | [pr_news.md](references/pr_news.md) | 时区 UTC+8，`release_time` 是 **DATETIME**（不是 TIMESTAMP） |
| **直播 Hours Watched / Peak CCV** | `intelligence.game_metric_streamhatchet_*` | [streaming.md](references/streaming.md) | |
| **官号发的帖子列表 / 单帖详情 / URL** | `public_feeds + feeds_author A 路 JOIN` | [public_feeds.md](references/public_feeds.md) §5.2 | 要"内容"不是"数字"才走这里 |

### 关键原则
1. **要数字** → cube 路径（`media_account_publishing` / `media_account_audience` / `store_score_*` / `news_details`）
2. **要内容/列表** → `public_feeds + A 路 JOIN`
3. **网红"发帖数"vs"活跃 KOL"二选一** → 看 [kol.md](references/kol.md) §0 决策树
4. **广告投放素材/创意指标** → 与舆情底表**完全无关**，走 [`references/creative/`](references/creative/)（`intelligence.dwd_aix_gd_analysis_*` / `dwd_aix_gd_material`），**绝不**用 `opinion.public_feeds`

---

## ⚠️ channel_name 真实底层枚举（**写错就 0 行无报错**）

三套底表（`public_feeds` / `opinion.kol` / `media_account_publishing`）枚举一致。**最易写错的 4 个**：

| 用户说 | 真实 `channel_name` |
|---|---|
| YouTube | `'youtube_keyword'` ⚠️ **不是 `youtube`** |
| Twitch | `'twitch_keyword'` ⚠️ **不是 `twitch`** |
| Google Play | `'google play'` ⚠️ **带空格** |
| App Store | `'app store'` ⚠️ **带空格** |

其余取小写原名：`twitter`(X) / `tiktok` / `facebook` / `instagram` / `reddit`(⚠️ kol 表无) / `bilibili` / `douyin` / `kuaishou` / `xiaohongshu` / `tieba` / `nga`。**统一规则**：一律 `LOWER(channel_name) IN ('<value>')`，**禁止** `channel_name = 'youtube'` 等值匹配（会得 0 行）。完整表见 [auxiliary/dim_tables.md](references/auxiliary/dim_tables.md) §3。

---

## ⚠️ 跨平台游戏 PC vs Mobile ID 决策（**写错就 0 行无报错**）

对**既有 PC/Console 又有 Mobile** 的游戏，`game_search.py` 默认 `entity_type` 不一定对应舆情数据实际存放端：

- **PC-leading（数据在 PC id，前缀 e）**：Fortnite / Apex Legends / Forza Horizon 5 / Diablo IV / Warframe / HELLDIVERS 2 / Hunt Showdown 1896 / Dying Light 2 / FragPunk / Naraka 端游版 等 → `game_search.py "<game>" --type pc`
- **Mobile-leading（手游主导，前缀 u）**：Genshin Impact / Uma Musume / MLBB / Brawl Stars / PUBG MOBILE / 王者荣耀 / Garena Free Fire / Pokémon TCG Pocket / 燕云十六声 / Whiteout Survival 等 → mobile id
- **不确定时 probe**：两端各 `COUNT(*)` 近 7 天，取行数大的端（probe SQL 模板见 [auxiliary/id_mapping.md](references/auxiliary/id_mapping.md) §3.5）。

> ### ⚠️ 单指标查询禁止 PC + Mobile 跨端 UNION
>
> 游戏同时存在 PC 和 Mobile `unified_edition_id` 时，**单一指标查询必须只用一个 game_id**，禁止 `IN ('<mobile>','<pc>')` / 两端 `UNION ALL` 后 `SUM`·`AVG` / 任何变体"两端合并"（都会偏离业务单端 GT）。判定顺序：
>
> 1. 问句带 **PC 限定词**（`PC 端` / `端游` / 主机端 / `Steam` / Epic / 主机版）→ PC id（`--type pc`）
> 2. 问句带 **Mobile 限定词**（手游 / 移动端 / iOS / Android / App Store / Google Play）→ Mobile id（`--type mobile`）
> 3. 未指明端 → 用 `game_search.py` 默认返回端 id；若该端主表 0 行疑似用错端，按 probe 切换重试，**而不是**改写成 UNION 两端合查。
>
> 必要的"端游 + 手游全端合查"是另一种语义（业务很少需要），如必要须在回答**显式标注**跨端聚合并征求确认。

---

## Core Scripts

| 脚本 | 用途 |
|------|------|
| `scripts/game_search.py` | **首次解析必跑**（ID 已在历史则复用）：游戏名 → `mobile_id` / `pc_id` / `console_id` / `combine_id` / `entity_id` + `game_id` 顶层兼容字段 |
| `scripts/execute_sql.py` | 执行只读 BigQuery SQL，返回结果 |
| `scripts/now_beijing.py` | **兜底**：仅当上下文缺 `当前时间` 时用它拿 UTC+8 `today` |

```bash
python scripts/game_search.py "Genshin Impact"            # auto-fallback by entity_type
python scripts/game_search.py "Counter-Strike 2" --type pc
python scripts/game_search.py "miHoYo" --type company     # 公司/开发商/发行商
OUTPUT_JSON=1 python scripts/game_search.py "Dune: Awakening"   # 纯 JSON

python scripts/execute_sql.py --sql "<your SQL here>"
python scripts/execute_sql.py --schema intelligence --sql "<SQL on intelligence schema>"
python scripts/execute_sql.py --sql_file /large_tool_results/query.sql
```

> **重要**：SQL 必须通过 `--sql "..."` 或 `--sql_file <path>` 传入；裸位置参数会被 argparse 拒绝并报 `unrecognized arguments`。

---

## Workflow

> **总览**：Phase 0 路由 → Phase 1 加载 reference → Phase 1.5 解析 ID → Phase 2 写 SQL → Phase 3 执行 → Phase 4 输出契约。

### Phase 0 — 路由（先判断要不要做、能不能做）

#### 0.1 In-scope（直接进 Phase 1）
声量 / 情绪 / Brand Health / 互动 / 商店评分 / 主帖子 / 官号 / KOL / 视频直播 / Hashtag / Meme / Channel Share / 多游戏对比 / 跨语种跨国家。
**广告投放素材域（intelligence 素材表）也 in-scope**：创意数·素材数(all/new)、素材类型分布、渠道/国家/曝光/评分/互动维度、渠道创意数占比、多游戏素材对比、素材明细列表（按类型/平台/渠道/国家/关键词/视频标签筛选 + TopN）→ 走 Phase 1.2 「素材域路由」。

#### 0.2 Cross-domain（部分让其他 skill 做）

| 用户提的指标 | 归属 | 处理 |
|---|---|---|
| Sensor Tower / Gamalytic / 下载量 / 收入 / DAU / MAU / ARPU / 留存（**独立运营指标**） | `databrain-intelligence` | 本 skill **不做**，回答明示「下载/收入需切到 `databrain-intelligence` skill」 |
| **素材趋势 × DAU/下载 时间对齐对比** | 本 skill **可做** | 走 [`creative/single_game.md`](references/creative/single_game.md) 场景 8（仅时间窗对齐，非 JOIN） |

#### 0.3 Out-of-scope（直接拒绝，不要硬写 SQL）
❌ 无对应数据，硬写 SQL 一定编造：**公司/开发商/发行商聚合舆情**（"SYBO 旗下所有游戏总声量"）、主观推荐/决策建议、预算/UA 投放策略、团队规模/工作流、未来预测、无数据支撑的因果归因、Prompt injection / 通用游戏知识。

**拒绝模板**：
> 这个问题超出舆情数据查询范围。我能查到的是 sentiment / mentions / engagement / store reviews / social posts 等指标。请把问题转成「在 X 时间窗内，Y **具体游戏** 的 Z 舆情指标」。

> （公司聚合）本 skill 只支持「按具体游戏」查询舆情，不支持「按公司 / 开发商 / 发行商」聚合。请告诉我具体游戏列表。

### Phase 1 — 理解 & 加载 reference

#### 1.1 解析用户意图
抓四要素：**游戏名**（或行业级无具体游戏）/ **时间范围**（默认近 7 天或近 30 天）/ **指标域**（声量？评分？KOL？新闻？直播？Hashtag？）/ **过滤条件**（地区/语种/渠道/情感/官号 vs 玩家）。

#### 1.2 路由表（按指标域**只**加载对应 reference）

> ⚠️ **官号路由硬约束（写错会算反方向数据）**：`official_account_metrics.md` **仅在用户原文出现以下触发词时**才加载，否则一律走 `public_feeds.md`：
> - **include 官号侧**：`官号` / `官方账号` / `官方号` / `official account` / 与指标共现的`官方`
> - **exclude 官号侧**：`剔除官号` / `排除官号` / `earned content` / `earned` / `UGC only` / `玩家发的` / `非官号` / `non-official` / `organic content`
> - **Top N 排名侧**：`Top N 官号` / `头部官号` / `最活跃官号` / `哪些官号`
>
> **反例**：用户问「`<游戏>` 在所有平台 `<日期>` 的互动量/发帖量/观看量/曝光量」——无任何触发词 → 走 `public_feeds.md §4 场景 3`（含官号 + UGC 合计），**绝不**走 `official_account_metrics.md`（只覆盖官号、漏掉 UGC）。

| 用户问 | 加载 |
|---|---|
| 声量/情感/Brand Health/互动/曝光/观看/发帖/创作者/热门图文帖/热门视频/词云/热点话题（**默认通用，不含官号过滤**） | [`public_feeds.md`](references/public_feeds.md) — 用户未提任何"官号触发词"时聚合数字均走这里（含官号 + UGC 合计） |
| ✅ **「官号 include / exclude」聚合指标**：官号互动量/发帖量/观看量/粉丝数/Top N 官号/Earned Content 剔除官号 | [`official_account_metrics.md`](references/official_account_metrics.md) — **必须命中上方触发词才加载**。官号汇总数字走 **`opinion.media_account_publishing`**；粉丝数走 `media_account_audience`；Earned Content（exclude 官号）走 `public_feeds + feeds_author` LEFT JOIN（§8） |
| 官号帖子列表/单帖详情/按内容筛选官号 feed（**列表而非数字**） | [`public_feeds.md`](references/public_feeds.md) §5.2（A 路：`feeds_author.is_official_account = 1` JOIN） |
| ✅ **按具体游戏查视频/视频播放量/视频数/视频互动** | [`public_feeds.md`](references/public_feeds.md) §场景 5 — `unified_edition_id` + `media_type IN ('video','live')` + `tweets_view`；**绝不**走 `marketing_hub_video`（无 game_id 字段） |
| KOL / 创作者榜单 / 分档 / 合作创作者 | [`kol.md`](references/kol.md) |
| 直播 / Hours Watched / Peak CCV / Avg CCV / 主播 | [`streaming.md`](references/streaming.md)（含 _uid 优先策略，必要时反链 [`id_mapping.md`](references/auxiliary/id_mapping.md)） |
| 新闻 / PR / News Brand Health | [`pr_news.md`](references/pr_news.md) |
| Google Trends 关键词热度 | [`googletrends.md`](references/googletrends.md) |
| Meme / 热梗 / 文化趋势 | [`memes.md`](references/memes.md) |
| Channel Share Ranking / 市场热度 | [`market_popularity.md`](references/market_popularity.md) |
| Hashtag / TikTok / 行业视频 / Hashtag KOL | [`marketing_hub.md`](references/marketing_hub.md) — ⚠️ **仅限"不绑定单一游戏"的行业级查询**；按具体游戏查视频走 public_feeds.md §场景 5（本 reference 8 张表均无 game_id 字段） |
| 商店评分（按平台分流） | [`stores/<platform>.md`](references/stores/)（见下文「商店评分场景」） |
| 字段名困惑 / channel/language/topic/keyword/官号 mapping | [`auxiliary/dim_tables.md`](references/auxiliary/dim_tables.md) |
| 国家/地区/竞品/运营事件 mapping | [`auxiliary/geo_competitor.md`](references/auxiliary/geo_competitor.md) |
| ID 体系 / 哪表用哪 ID / unified_id↔app_id 转换 / 手游店 vs PC 店过滤键 / 直播侧 ID 选择 | [`auxiliary/id_mapping.md`](references/auxiliary/id_mapping.md) |
| Include/Exclude/官号识别业务逻辑 | [`auxiliary/social_filter_logic.md`](references/auxiliary/social_filter_logic.md) |
| 找不到字段 / 完整 schema | [`auxiliary/cube_schema.md`](references/auxiliary/cube_schema.md) |
| **广告投放素材 / 创意取数** | [`references/creative/`](references/creative/) — 三选一见下方「素材域路由」 |

> **黄金法则**：reference 里的 SQL 是经 BigQuery 全量验证的（多标注 "5/5 PASS" 等）。**先看 reference 找模板，再做最小化改写**，避免凭空写 SQL。

#### 素材域路由（which-of-3，命中素材类问题时**只**加载一个）
素材表是 `intelligence` schema，与舆情 `opinion.public_feeds` 完全不同；**不要**用 public_feeds 模板。

| 用户问的形态 | 加载 |
|---|---|
| 要**单条素材/广告明细列表**（按类型/平台/渠道/国家/关键词/视频标签筛选 + TopN） | [`creative/materials_list.md`](references/creative/materials_list.md)（主表 `intelligence.dwd_aix_gd_material`，CLUSTER BY `game_id`） |
| 要**单个游戏聚合数字/趋势**（创意数·素材数 Total、趋势、类型分布、DoD·SDLW、多维 TopN、素材 vs DAU 对比） | [`creative/single_game.md`](references/creative/single_game.md)（`dwd_aix_gd_analysis_creatives` / `_stats`） |
| 要**多游戏(1–15)横向对比**（overview/timeline/sum/国家×游戏矩阵/占比/环比） | [`creative/multi_game.md`](references/creative/multi_game.md)（同两张分析表 + `dim_aix_gd_games`） |

> 判定优先级：先看**要不要单条素材明细**（要 → materials_list）；只要聚合再看**游戏数量**（单个 → single_game；多个 → multi_game）。

#### 商店评分场景（按用户问的商店动态分流）
- **Steam** → [`stores/steam.md`](references/stores/steam.md)（详，含 `_daily` + `_by_language_hourly`）
- **App Store** → [`stores/app_store.md`](references/stores/app_store.md)（详） ／ **Google Play** → [`stores/google_play.md`](references/stores/google_play.md)（详）
- **TapTap / Xbox / PlayStation / Meta Store / Metacritic / OpenCritic** → 对应同名简版 md
- "全平台对比" → 按提到的商店分别加载并 UNION

⚠️ **关键陷阱**：手游店（App Store / Google Play / TapTap）用 `unified_id` 列；PC/Console 店（Steam / PlayStation / Xbox / Metacritic / OpenCritic）用 `edition_id` 列。**写错就 0 行无报错**。详见 [`id_mapping.md`](references/auxiliary/id_mapping.md)。

#### 辅助表查询指引
字段名/mapping 困惑 → `dim_tables.md`；国家/竞品/运营事件 → `geo_competitor.md`；用哪个 ID → `id_mapping.md`；官号识别/Include·Exclude → `social_filter_logic.md`；都找不到 → `cube_schema.md`（兜底）。

### Phase 1.5 — 解析游戏 ID

> **若游戏 `unified_edition_id` 等 ID 已在对话历史/上下文中出现，直接复用，不要再调 `game_search.py` 验证。** 仅首次解析或历史无 ID 时才跑脚本。

```bash
python scripts/game_search.py "<game name>" [--type mobile|pc|console]
```

输出含 `game_id`(= unified_edition_id，前缀 u/e) / `mobile_id`(= unified_id) / `pc_id`(= edition_id) / `console_id` / `combine_id`(= combined_id) / `entity_id`(公司) / `match_score`。

**ID 选择决策**（详见 [`id_mapping.md`](references/auxiliary/id_mapping.md)）：
- 舆情主表 `opinion.public_feeds` / `kol` / `feeds_author` / `news_details` → `WHERE unified_edition_id = '<game_id>'`
- 手游商店（App Store / Google Play / TapTap）→ `WHERE unified_id = '<mobile_id>'`
- PC/Console 商店（Steam / PlayStation / Xbox / Meta Store / Metacritic / OpenCritic）→ `WHERE edition_id = '<pc_id 或 console_id>'`
- 直播 `_uid` 表（优先）→ `WHERE id = '<mobile_id 或 pc_id>'`；原版表 → `WHERE app_id IN (SELECT app_id FROM common.unified_ids WHERE unified_id = '<game_id>')`
- **素材分析表**（`dwd_aix_gd_analysis_creatives` / `_stats` / `dwd_aix_gd_material`）→ `WHERE game_id = '<game_id>'`
- **素材 vs DAU 对比**（single_game 场景 8）：mobile → `game_metric_sensortower_*_uid` 用 `id` 列；pc/console → `game_metric_ampere_daily_cid` 用 `edition_id` 列

提示：`match_score = 666666` 是精确匹配；分数低 → `--top 3` 查候选；中文名建议指定 `--type`；内部代号/Demo 若非 666666 → 回头问用户正式名。

### Phase 2 — 生成 SQL

#### 2.1 从 reference 找最近的模板
大多数 reference 按"场景"组织 SQL；找最匹配的场景，把 `<game_id>` / `<start_date>` / `<end_date>` / `<channel_code>` 占位符替换成实际值。

#### 2.2 通用 SQL 规则
- **BigQuery 方言**：`DATE_SUB`、`DATETIME_TRUNC`、`SAFE_DIVIDE`、`COUNTIF`、`QUALIFY ROW_NUMBER()`、`UNNEST`、`MAX_BY`、`ARRAY_AGG` 都可用
- **GROUP BY 严格**：每个非聚合 SELECT 列必须出现在 GROUP BY（原样重复或序数 `GROUP BY 1, 2`）
- **窗口函数不能嵌套在聚合内**：`SUM(ROW_NUMBER() OVER(...))` 报错，需拆成两层子查询；`QUALIFY ROW_NUMBER() OVER (...) = 1` 取每组 Top1
- **情感映射统一口径**：`sentiment_rating IN (1,2)`=negative，`=3`=neutral，`IN (4,5)`=positive，`-1`=未打分。`positive_rate/negative_rate/avg_sentiment` 分母都是 `mentions`（**含 `-1`**），**默认不要在 WHERE 排除 `sentiment_rating = -1`**。
- **互动量 4 项累加 + 负值清洗（必用 CASE 形式）**：`SUM((CASE WHEN tweets_retweet>=0 THEN tweets_retweet ELSE 0 END) + (CASE WHEN tweets_reply>=0 THEN tweets_reply ELSE 0 END) + (CASE WHEN tweets_like>=0 THEN tweets_like ELSE 0 END) + (CASE WHEN tweets_unlike>=0 THEN tweets_unlike ELSE 0 END))`。写成 `SUM(IF(x<0,0,x) + IF(...))` 是错的（任一字段 NULL 整行被跳过偏小）。
- **曝光（potential_impressions）严格 > 0**：`SUM(CASE WHEN follower_number > 0 THEN follower_number ELSE 0 END)`
- **NLP `topics` 大小写归一化**：聚合时一律 `UPPER(t)` / `LOWER(t)`，否则 `'AI'` vs `'Ai'` 拆两行漏 30-50%
- **取最新快照**：`MAX_BY(<field>, create_time)` / `MAX_BY(<field>, insert_time)`
- **CTE vs 子查询**：DataLab 支持 `WITH`；遇 `Table not found` 误报时改内联子查询 `FROM (SELECT ...) t`

#### 2.3 时间词翻译速查表（**写错就时间窗错位**）

> ⚠️ `today` 来源 = system prompt 顶部注入的 `当前时间`（已是 UTC+8 北京时间），取其日期；上下文无该字段才回退 `python scripts/now_beijing.py`。**凡涉及"今天/最近/本周/本月"等相对时间一律以 `today` 为"当前日期"**算窗口；**绝不**用 `CURRENT_TIMESTAMP()` / `CURRENT_DATE()` / `CURRENT_DATETIME()`（BQ 走 UTC 服务时钟，错位最多 8h，实测 NIKKE 近 5 天声量偏差 23%）。下表示例设 `today = 2026-05-30`（周六）。
>
> ⚠️⚠️ **TIMESTAMP/DATETIME 字段 vs DATE 字段写法不同，混用会丢数据**：`comment_time` / `release_time` / `create_time` 是 TIMESTAMP/DATETIME 字段，**必须右开**：`>= TIMESTAMP('<start>') AND < TIMESTAMP_ADD(TIMESTAMP('<end>'), INTERVAL 1 DAY)`（DATETIME 列用 `DATETIME_ADD`）。**绝不能写 `<= TIMESTAMP('<end>')` 或 `BETWEEN TIMESTAMP(start) AND TIMESTAMP(end)`** —— `TIMESTAMP('<end>')` = `<end> 00:00:00`，闭区间只命中午夜一瞬、**丢掉 `<end>` 当天全部带时刻数据**（单日点查塌成 0~个位数，实测 9 条 bad case 全因此偏小，如 Royal Match 单日声量 216→1）。**只有 DATE 字段**（`opinion.kol.date` / `media_account_publishing.date`）才用 `BETWEEN DATE('<start>') AND DATE('<end>')`（闭区间正确）。

| 用户说 | 算法（基于 `today`） | 翻成（today=2026-05-30）|
|---|---|---|
| 今天 / today | DATE 字段 `date = today`；TIMESTAMP 字段右开 | `date = DATE('2026-05-30')`；或 `comment_time >= TIMESTAMP('2026-05-30') AND comment_time < TIMESTAMP_ADD(TIMESTAMP('2026-05-30'), INTERVAL 1 DAY)`（❌ 不要 `<= TIMESTAMP('2026-05-30')`） |
| 昨天 / yesterday | `date = today-1` | `date = DATE('2026-05-29')` |
| 最近 / 近 N 天（含今天）| `[today-(N-1), today]` | 近 7 天 → `BETWEEN DATE('2026-05-24') AND DATE('2026-05-30')` |
| 本周（ISO 周一起算，截止 today）| `[本周一, today]` | `BETWEEN DATE('2026-05-25') AND DATE('2026-05-30')` |
| 上周 / last week | 上一完整 ISO 周 `[周一, 周日]` | `BETWEEN DATE('2026-05-18') AND DATE('2026-05-24')` |
| 本月 / 上月 | `[本月1号, today]` / 上一完整月 | 本月 → `BETWEEN DATE('2026-05-01') AND DATE('2026-05-30')`；上月 → `BETWEEN DATE('2026-04-01') AND DATE('2026-04-30')` |
| 近 30/90 天 / 季度 | 同近 N 天 | 近 90 天 → `BETWEEN DATE('2026-03-02') AND DATE('2026-05-30')` |
| **上线后 / announcement / event 起算** | ⚠️ **必须有具体日期**才写 SQL（先查 `common.app_detail.release_time`，再 `comment_time >= TIMESTAMP(release_time) AND < TIMESTAMP_ADD(TIMESTAMP(release_time), INTERVAL 7 DAY)`）；没有就回头问用户，**不要**直接翻成"近 7 天" |
| 近期 / recently | **歧义** → 默认 7 天，输出里说明 |

> ⚠️ **`opinion.store_score_*.create_time` 是 DATETIME 不是 TIMESTAMP**：与 `TIMESTAMP_SUB` / `TIMESTAMP('...')` 比较会报 `No matching signature ... DATETIME, TIMESTAMP`。用 `DATETIME('YYYY-MM-DD')` 字面量（基于 `today` 自算）或字符串 `'2026-01-01 00:00:00'`（隐式转 DATETIME）；**不要**用 `CURRENT_DATETIME()`。

### Phase 3 — 执行 & 修复

```bash
python scripts/execute_sql.py --sql "<SQL>" [--schema intelligence]
python scripts/execute_sql.py --sql_file /large_tool_results/query.sql   # 长 SQL
```
返回 JSON 含 `code` / `data.columns` / `data.data` / `data.cost_time` / `data.count`。大结果落盘 `/large_tool_results/opinion_sql_<ts>.json`，stdout 只 print 摘要 + 前 N 行。

#### 3.2 错误码速查
完整 `Code / Symptom → Cause → Action` 表（CLI 报错、BigQuery 错误码 61001-61006、`Not found: Table` / `Unrecognized name` / GROUP BY / DATETIME 签名 / RE2 / `row_count:0` 等）见 [`scripts/execute_sql.py`](scripts/execute_sql.py) 顶部 docstring 的「Common errors」小节。

#### 3.3 自动修复循环（≤3 次）
拿到错误 → 找错误码 → 改写 SQL → 重跑；第 3 次仍报错则停止重试，给用户报告根因。

### Phase 4 — 输出契约（Output Contract）

每次回答必须包含：
1. **指标定义**（公式）— 例 `positive_rate = COUNT(DISTINCT IF(sentiment_rating IN (4,5), comment_uin, NULL)) / COUNT(DISTINCT comment_uin)`（分母 = mentions，含 `-1`）
2. **时间窗口**（精确到日/秒 + **UTC+8 北京时间**）— 例 `2025-01-01 ~ 2025-01-07 (UTC+8)`。SQL 时间过滤基于 `today` 自算字面量整日窗口；**不要**加 `'Asia/Shanghai'` 参数，更**不要**用 `CURRENT_TIMESTAMP() / CURRENT_DATE() / CURRENT_DATETIME()`（BQ 服务时钟是 UTC）。回答末尾**必须**单独成行披露：`数据时区：UTC+8（北京时间）`。
3. **过滤范围** — 游戏 / 渠道 / 国家 / 语种 / 官号 vs UGC
4. **数据覆盖度** — `MAX(comment_time)` 是几号；用户窗口是否被完整覆盖
5. **采集稳定性提醒**（如适用）— 哪些渠道当日断采

> **生产流量里大量错误是用户误读结果**，不是 SQL 错。务必把这 5 项写出来。

#### 数据缺口透明披露

| 场景 | 必带话术 |
|---|---|
| `MAX(comment_time)` 早于窗口尾（仅 `public_feeds` 等周期型表） | 「数据仅覆盖到 YYYY-MM-DD，X 之后部分尚未入库」 |
| 0 行（通用规则；事件型稀疏表见下方"单日点查严格契约"，主答案直接 0） | 「该过滤条件下未找到记录，已确认 game_id / 时间窗口可被覆盖」 |
| **`media_account_publishing` 单日聚合 0 行**（事件型稀疏表反例）| ✅ 主答案给数字 `0`；❌ 不允许说"未入库 / 数据未覆盖到 YYYY-MM-DD"——没行 = 该日真实未发帖 |
| Steam 评分两源对账偏差 | 「平台官方好评率 X% (`store_score_steam_daily`) vs 已采集评论好评率 Y% (`feeds.is_recommend`)；差异来自采集覆盖率」 |
| 跨域问题只查到部分 | 「下载/收入/DAU 部分需切到 `databrain-intelligence` skill」 |

#### ⚠️ GT=0 全局输出契约（**数字 0 是合法答案**）

##### 单日点查严格契约（优先级高于通用契约）
当问题形如「**`<游戏>` 在 `<平台>` 在 `<YYYY-MM-DD>` 的 `<发帖/观看/转发/评论/点赞/互动>` 量**」（单游戏 × 单日 × 可选单平台 × 官号汇总，主表必为 `opinion.media_account_publishing`）：
1. 跑 metric SQL：`SELECT <SUM expr> FROM media_account_publishing WHERE unified_edition_id='<id>' AND date=DATE('<Y-M-D>') [AND LOWER(channel_name)='<value>']`
2. **返回 NULL / 空集 / 0 → 主答案必须是数字 `0`**。**禁止**用逃避型措辞替代：「数据未覆盖」/「尚未入库」/「无入库」/「暂无记录」/「无数据统计」/「无法查询」/「数据缺失」；**绝不**把 `MAX(date)` 那天旧数据塞过来（最严重——答非所问）。
3. **关于 `MAX(date) < 用户问的日期`**：`opinion.media_account_publishing` 是**事件型稀疏事实表**（event-driven sparse fact table），"行" = "某游戏 × 官号 × 日 × 渠道 当天发了帖"。官号当日没发帖 = 无任何行（**不是**未入库）；`MAX(date)` 只是"最近有发帖事件的一天"，**不是**数据覆盖边界。**不允许**用 `MAX(date) < 用户问的日期` 推断"未来日期未入库"。
4. **例外**：仅当 `MAX(date) < 当前日期 - 30 天` 时，可在主答案 `0` **之后**附注"（近 30 天该游戏 × 渠道无任何官号发帖事件）"，**主答案仍是 `0`**。

输出模板：
```
<游戏> 在 <过滤范围> <YYYY-MM-DD> 的 <指标名> 为 **0**。
（注：该日 media_account_publishing 无该游戏 × 渠道的发帖事件，属事件型稀疏表的合法 0 值。）
```

##### 通用 GT=0 契约（时间范围 / 跨日聚合 / 非 `media_account_publishing` 场景）
SQL 正常执行（无报错）且返回 NULL / 空集 / 0 时，**必须作为合法数字 `0` 输出**，不允许用「数据缺失」/「无法回答」/「暂无数据」/「目前没有相关记录」/「需要更多信息」（在 game_id / 时间窗 / 渠道都已确定时）替代。**只有三种情况**才说"无法查询"：(1) `game_search.py` 解析不到 game_id；(2) SQL 报 BigQuery 错误；(3) 指标根本不在本 skill 覆盖范围（Phase 0 out-of-scope）。

> 关键原则：业务 GT 把"实际为 0"和"暂无数据"区分清楚——前者合法事实，后者查询失败。SQL 返回什么数字就答什么，覆盖度备注另行说明。

---

## Reference Documents Index

| 文件 | 主题 |
|------|------|
| [public_feeds.md](references/public_feeds.md) | 核心事实表：声量/情感/Brand Health/互动/曝光/Earned/热门图文帖/热门视频/词云/话题；§5.2 官号帖子列表（A 路） |
| [official_account_metrics.md](references/official_account_metrics.md) | **「官号 include/exclude」聚合指标专属**（必须命中官号触发词才加载）。汇总数字走 `media_account_publishing`；粉丝数走 `media_account_audience`；Earned 走 `public_feeds + feeds_author` LEFT JOIN |
| [kol.md](references/kol.md) | opinion.kol + kol_tag + feeds_author（创作者榜单/趋势/官号识别 — 非直播） |
| [streaming.md](references/streaming.md) | streamhatchet 6 张表（直播；优先 _uid 版本） |
| [pr_news.md](references/pr_news.md) | intelligence.news_details |
| [googletrends.md](references/googletrends.md) | opinion.googletrends_keyword |
| [memes.md](references/memes.md) | opinion.memes + meme_videos |
| [market_popularity.md](references/market_popularity.md) | top_mobile_game + top_pconsole_game + public_feeds（Channel Share Ranking） |
| [marketing_hub.md](references/marketing_hub.md) | marketing_hub.* 全部 8 张（Hashtag / 视频 / KOL Info） |
| [stores/steam.md](references/stores/steam.md) / [app_store.md](references/stores/app_store.md) / [google_play.md](references/stores/google_play.md) | 主商店评分（详） |
| [stores/taptap.md](references/stores/taptap.md) / [xbox.md](references/stores/xbox.md) / [playstation.md](references/stores/playstation.md) / [meta_store.md](references/stores/meta_store.md) / [metacritic.md](references/stores/metacritic.md) / [opencritic.md](references/stores/opencritic.md) | 其他商店（简） |
| [auxiliary/dim_tables.md](references/auxiliary/dim_tables.md) | dim_channel / dim_keyword / dim_language / dim_topic_labels / dim_media_account |
| [auxiliary/geo_competitor.md](references/auxiliary/geo_competitor.md) | country_region + unified_competitor + game_event |
| [auxiliary/id_mapping.md](references/auxiliary/id_mapping.md) | **ID 体系单一真理源**：5 个 ID 含义 + 各表过滤键 + 决策树 + join 模板 + PC/Mobile probe |
| [auxiliary/social_filter_logic.md](references/auxiliary/social_filter_logic.md) | Include/Exclude/官号识别业务逻辑 |
| [auxiliary/cube_schema.md](references/auxiliary/cube_schema.md) | 全表字段索引（兜底） |
| [creative/single_game.md](references/creative/single_game.md) | **单游戏投放素材**：四指标 Total/趋势/类型分布/多维 TopN/素材 vs DAU 对比 |
| [creative/multi_game.md](references/creative/multi_game.md) | **多游戏(1–15)投放素材横向对比** |
| [creative/materials_list.md](references/creative/materials_list.md) | **素材/广告明细列表** + 视频标签 `opinion.aix_gd_video_tags_detail` |

---

## Common Patterns（Quick Recipe）

### 取一段时间内某游戏的整体声量（其余模板见对应 `references/<topic>.md`）
```sql
SELECT
  FORMAT_DATE('%Y-%m-%d', DATE(comment_time)) AS date,
  COUNT(DISTINCT comment_uin) AS mentions,
  COUNT(DISTINCT CASE WHEN sentiment_rating IN (4,5) THEN comment_uin END) AS positive,
  COUNT(DISTINCT CASE WHEN sentiment_rating IN (1,2) THEN comment_uin END) AS negative
FROM `tencent-databrain-prod.opinion.public_feeds`
-- 必带：聚簇键 unified_edition_id + 分区键 comment_time（右开窗口）
WHERE unified_edition_id = '<game_id>'
  AND comment_time >= TIMESTAMP('<start_date>')
  AND comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
GROUP BY date
ORDER BY date
LIMIT 1000;
```

---

## Cross-skill Coordination

本 skill 处理 **舆情/声量/口碑/KOL/直播/新闻** 类问题，与 `databrain-intelligence`（DAU/Revenue/Retention）互补。同一对话既有「玩家舆情」又有「游戏销量」时，分别调用两个 skill，由上层合并。

---

## Pitfalls (TL;DR)

- ❌ **最严重**：查 `opinion.public_feeds` 不带 `unified_edition_id`（聚簇键）或 `comment_time` 范围（分区键）→ 亿级全表扫 + 必然 61001 timeout（其他事实表忘加时间分区过滤同理）
- 不解析游戏名直接写 `unified_edition_id = '原神'` → 0 行（必须先 `game_search.py`，ID 在历史则复用）
- 手游店写 `WHERE unified_edition_id = ...`（实际列名 `unified_id`）/ PC 店写 `unified_edition_id`（实际 `edition_id`）→ 0 行无报错
- 直播原版表（kol/sessions/profile 无 _uid 版）用 `unified_edition_id` 过滤 → 0 行（先转 `app_id`，详见 streaming.md）
- 用 `TIMESTAMP_SUB` 查 `store_score_*.create_time`（DATETIME）→ `No matching signature` 报错
- 用 `country='global'` 后认为是"全球数据"（其实是"无国家归属"，按国查时要 `country IN ('<target>','global')`）
- 写 `WHERE organization='official'` 区分官号（字段不存在！用 `dim_media_account.category` 反查）
- "发帖作者数/creators" 用 `COUNT(DISTINCT comment_uin)`（那是帖子数口径）→ **必须** `COUNT(DISTINCT CONCAT(reviewer,'-',LOWER(channel_name)))`（主帖 + `channel_type='social'`）
- 聚合 `topics` 不归一化大小写 → 漏 30-50%；把"上线后"直接翻成"近 7 天"（必须先查 release_time 或问用户）
- **按具体游戏查视频却用 `marketing_hub.marketing_hub_video`**：该表是行业级 Feed，无任何 game_id 字段，`LIKE '%游戏名%'` 反查标题大量误差 → 一律走 [public_feeds.md §场景 5](references/public_feeds.md)
- **官号路由两个方向都可能走反**（生产主要错误模式）：
  - **方向 A**：用户没说"官号"还走 `official_account_metrics.md` → 漏全部玩家 UGC（如 Blood Strike 仅 28K 官号互动量）。无触发词 → **必走** [public_feeds.md](references/public_feeds.md) §4 场景 3。
  - **方向 B**：用户明说"官号/剔除官号/Earned/玩家发的"还走 `public_feeds.md` 通用 §4 → 漏官号识别。命中触发词 → **必走** [official_account_metrics.md](references/official_account_metrics.md)。
  - **中国渠道**（douyin/bilibili/xiaohongshu/kuaishou/tieba/taptap/nga）→ 先按 official_account_metrics.md §0 渠道探针确认有无数据；唯一硬告知不覆盖的是 weibo（全域无 weibo 渠道）。
