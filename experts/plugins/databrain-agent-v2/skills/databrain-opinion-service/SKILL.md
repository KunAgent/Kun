---
name: databrain-opinion-service
display_name_en: Public Opinion Analysis
display_name_zh: 舆情分析
description: Generate qualitative public opinion deliverables for games — packaged summary reports, topic deep-dive with representative player comments and URLs, single YouTube video URL analysis, DataBrain UI redirect links, and external web search context. For raw quantitative metric queries (声量/情感/评分/KOL/直播/新闻/Hashtag/Meme/官号 聚合数字), route to `databrain-opinion-metrics-service` instead.
when_to_use: Activate when the user wants a packaged opinion summary report (e.g. "最近舆情怎么样"), a specific topic deep-dive with representative comments and links, analysis of a specific YouTube video URL, a DataBrain UI redirect link, or external web context. Do NOT activate for pure numeric metric queries — those belong to `databrain-opinion-metrics-service`.
---

# Skill: Public Opinion Analysis (舆情分析)

## Environment Variables (Required)

| 变量名 | 是否必填 | 说明 |
|--------|----------|------|
| `DATABRAIN_TOKEN` | 必填 | 认证 token（不含 `Bearer ` 前缀） |
| `DATABRAIN_HOST` | 必填 | API 主机地址 |
| `DATABRAIN_DISPLAY_HOST` | 必填 | 系统链接展示域名 |

## 0. Skill Scope

- **This skill** → **qualitative** opinion deliverables: packaged summary reports, topic deep-dive with representative comment text + URLs, single YouTube video URL analysis, DataBrain UI redirect links, external web search context — for **any game** (Dashboard or Intelligence).
- **NOT this skill** → **quantitative** metric queries (mentions / sentiment counts / store score / KOL list / streaming / news / hashtag / meme / official-account aggregates / Channel Share). Route to **`databrain-opinion-metrics-service`** (它直接写 BigQuery SQL 跑出数字).

## 1. Triggers

舆情报告, opinion report, **高级量化总结**, **量化总结**, **高级总结**, **舆情数据整体总结**, 整体口碑总结, sentiment overview report, 快速摘要, 话题深度分析, topic deep-dive, 代表性评论, representative comments, 玩家原话, player quotes, 评论原文, 评论链接, comment URL, YouTube URL 分析, YouTube video URL analysis, video transcript, 视频转录, DataBrain 跳转链接, redirect link, custom AI summary, keyword analysis page, 联网搜索, web search, 外部资讯, patch notes, 公告, announcement, DLC 信息

## 2. How to Call Tools

```
run_skill_script(
  script_path="scripts/run_tool.py",
  cli_args=["--tool", "<tool_name>", "--param1", "value1", ...]
)
```
Rules: `--tool` required; lists as JSON strings; **arg names must exactly match signature** — unsupported args are silently dropped.

## 3. Tool Inventory & Signatures

> 仅列出本 skill 负责的「**报告化 / 定性 / 外链 / 跳转 / 外部搜索**」工具。指标聚合（mentions/sentiment/score/KOL/streaming/news/hashtag/meme/官号 数字）请走 `databrain-opinion-metrics-service`。

### 3.1 Core Tools (完整签名)

#### `get_opinion_summary_report`
**Packaged LLM-summarized opinion report** for game(s) WITHOUT specific topics. 用户问"最近舆情怎么样 / 整体口碑总结"一句话即可答，无需写 SQL。
> **产品特指词映射**：用户明确说"**高级量化总结 / 量化总结 / 高级总结 / 舆情数据整体总结**"时，这是 DataBrain 平台的产品别名，**优先**走本工具（返回量化正负面话题分析，含条数、好感度、互动量）。用户只说泛义"数据总结"未带"舆情/口碑"等限定时，按 soul.md §5 数据域默认路由，不强切。
```
game_names: List[str]                # REQUIRED
start_date: str = None               # default 7d ago
end_date: str = None
channel_category: str = None         # social|game_store
channel_code: List[str] = None
sentiment: str = None
language_code: List[str] = None
is_official_account: bool = None
```

#### `get_opinion_analysis_by_topic`
Topic deep-dive bundle — metrics + sentiment + **representative comments with URLs**. Preferred for any specific-topic question. `content=["metrics","comments"]` 已覆盖话题指标 + Top 内容两块。
```
topics: List[str]                    # REQUIRED
game_names: List[str]                # REQUIRED
start_date: str = None               # YYYY-MM-DD
end_date: str = None                 # YYYY-MM-DD
time_granularity: str = "day"        # day|week|month
content: List[str] = ["metrics","comments"]  # [metrics,ratio,comments]
channel_category: str = None         # social|game_store
channel_code: List[str] = None
sentiment: str = None                # positive|negative|neutral
language_code: List[str] = None
region: List[str] = None
is_official_account: bool = None
```
⚠️ `ratio` optional (adds time series). Do NOT pass `query_keywords` or `dateRange`.

Core tool references:
- `get_opinion_summary_report`: `reference/get_opinion_summary_report.md`
- `get_opinion_analysis_by_topic`: `reference/get_opinion_analysis_by_topic.md`

### 3.2 Other Tools (详见 reference/ 目录)

| Tool | Best For | Reference |
|---|---|---|
| `get_game_info` | Resolve game name/release date for the tools above | `reference/get_game_info.md` |
| `youtube_url_analysis_tool` | Analyze a specific YouTube video URL (top comments / transcript) | `reference/youtube_url_analysis_tool.md` |
| `opinion_redirect_tool` | DataBrain UI 跳转链接（custom_ai_summary / keyword_analysis / url_analysis 页面） | `reference/opinion_redirect_tool.md` |
| `websearch_tool` | Web search for patch notes / announcements / DLC / unfamiliar events | `reference/websearch_tool.md` |

> 📖 Before calling a 3.2 tool, read its `reference/<tool_name>.md` for full signature and constraints.

## 4. Key Rules

- No topic → `get_opinion_summary_report`; specific topic → `get_opinion_analysis_by_topic`
- Web search first for version/patch/DLC/unfamiliar events before report generation
- **Game ID priority**: if `databrain-entity-resolver` has already run for this session and returned a matched entity with `has_opinion_permission=true`, use its `entity_name` directly as `game_names` — **skip `get_game_info`**. Only call `get_game_info` when no entity resolver result is available for the game.
- Resolve game via `get_game_info` only when entity resolver result is absent; pass `game_names` not `game_id`
- Multi-game: keep game dimension; separate calls for different date ranges
- Link integrity: comment text + URL from same record; never fabricate
- **Pure metric query** (mentions/sentiment count/store score/KOL list/streaming/news number/hashtag/meme/官号 aggregates/Channel Share) → **不要在这里硬答**，路由到 `databrain-opinion-metrics-service`

## 5. Cross-skill Coordination

Routing rules: see **soul.md §5**.

- **This skill (`databrain-opinion-service`)** = 报告化摘要 + 话题深度（含评论文本/URL） + YouTube URL 分析 + DataBrain 跳转链接 + 联网搜索
- **`databrain-opinion-metrics-service`** = 全部舆情**指标**的原始 BigQuery SQL（声量/情感/商店评分/KOL/直播/新闻/Google Trends/Hashtag/Meme/Channel Share/官号聚合）。用户问数字 → 直接路由
- **`databrain-intelligence`** = 非舆情类的市场/情报指标（DAU / Revenue / Downloads / Retention 等）

This skill works for **any game** regardless of dashboard_white_games.

## 6. Pitfalls

- `get_opinion_summary_report` for specific topic (use `get_opinion_analysis_by_topic` instead)
- Wrong arg names to `get_opinion_analysis_by_topic` (e.g. `query_keywords` / `dateRange`)
- Negative conclusion from <100 samples
- Skipping `get_game_info` for new games
- 在本 skill 里尝试回答纯指标数字（应路由到 `databrain-opinion-metrics-service`）
- 把 `get_opinion_analysis_by_topic` 当成 KOL/视频/官号 排行工具用（它是话题维度，不是创作者/视频维度）


