# get_opinion_analysis_by_topic

Integrated topic analysis tool (metrics + optional ratio + representative comments).

## Signature

```text
topics: List[str]                    # REQUIRED — specific keywords, NOT sentiment types
game_names: List[str]                # REQUIRED
start_date: str = None               # YYYY-MM-DD, default = 30 days ago
end_date: str = None                 # YYYY-MM-DD
time_granularity: str = "day"        # day | week | month
content: List[str] = ["metrics", "comments"]   # metrics | ratio | comments
channel_category: str = None         # social | game_store
channel_code: List[str] = None       # e.g. youtube_keyword, steam, tiktok, twitter, reddit
sentiment: str = None                # positive | negative | neutral
language_code: List[str] = None      # e.g. en, zh, zh-hant, ja, ko, tr
region: List[str] = None             # e.g. 北美区, 东南亚 — auto-expanded to language filter
is_official_account: bool = None     # true | false
```

## Best For

- Specific topic deep-dive with both quantitative and qualitative evidence
- One-call topic report (trend/ratio/comments)

## Rules

### Topics
- `topics` cannot be empty, and must be **specific keywords** — NOT sentiment types (positive/negative/neutral).
- **Expand synonyms**: e.g. query "游戏难度" should include `["游戏难度", "战斗难度", "任务难度"...]` to improve recall.

### Content Options & Performance
- `content=["metrics"]` — fast query (~10s), basic metrics only
- `content=["metrics", "comments"]` — metrics + representative comments (~10s)
- `content=["metrics", "ratio"]` — full metrics with topic-vs-total percentage (~40s)
- `content=["metrics", "ratio", "comments"]` — complete analysis (~40s)
- Include `ratio` **only when needed** (adds ~30s extra query time).

### Channel Filtering
- `channel_code` must match `channel_category`:
  - `channel_category="social"` → only social channels: youtube_keyword, tiktok, twitter, facebook, reddit, discord, etc.
  - `channel_category="game_store"` → only store channels: steam, google_play, app_store, etc.
  - If unsure, do NOT set `channel_category`, only set `channel_code`.

### `is_official_account`
- Only set when user **explicitly** mentions official or non-official content.

### Region
- `region` accepts region names like "北美区", "东南亚" — the system auto-expands them to corresponding `language_code` values.

### Output Interpretation
- **`brand_health`** here is **TOPIC-level** net sentiment (positive_rate − negative_rate). Label it as "**话题健康度 / Topic Health Score**" — **NOT** "品牌健康度 / Brand Health" (which is reserved for game-level data).
- When narrating a topic, use that topic's **OWN** numbers. If `negative_rate ≥ 25%` OR `avg_sentiment < 3.5`:
  - Do **NOT** use approval words ("高度认可" / "广受好评" / "highly approved")
  - Do **NOT** use vague hedges ("评价两极" / "polarized" / "mixed")
  - Instead, **state the concrete figures** (e.g. "负面占比 32%、平均情感 2.7、话题健康度 -30") and summarize dominant negative aspects from representative comments.

### Comment URLs
- Representative comments returned by this tool already include URLs paired with each comment from the data source.
- Only show the URL that is **explicitly paired** with that comment in the tool result.
- **NEVER** construct, infer, or substitute a URL for a comment that does not have one.

### General
- For game-level overview without specific topics, use `get_opinion_summary_report`.
- NO fabricated content — only use actual query results.
