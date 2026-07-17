# get_opinion_summary_report

General sentiment overview tool for game(s) **without specifying concrete topics**.

## Signature

```text
game_names: List[str]                # REQUIRED
start_date: str = None               # YYYY-MM-DD, default = 7 days ago
end_date: str = None                 # YYYY-MM-DD, default = today
channel_category: str = None         # social | game_store
channel_code: List[str] = None       # e.g. youtube_keyword, steam, tiktok, twitter, reddit, discord, facebook, google_play, app_store
sentiment: str = None                # positive | negative | neutral
language_code: List[str] = None      # e.g. en, zh, zh-hant, ja, ko, tr, ru, de, fr
is_official_account: bool = None
```

## Best For

- User asks overall sentiment / discussion overview (e.g. "最近舆情怎么样", "玩家在讨论什么")
- No clear topic keywords provided
- Need quick summary of sentiment split + hot themes

## DO NOT USE

- **Specific topic** queries → use `get_opinion_analysis_by_topic`
- **Pure metric/number** queries (e.g. "哪个地区负面声量最多", "Top5地区负面声量", grouping/sorting by region/country/language/channel) → route to `databrain-opinion-metrics-service`

## Rules

- If user asks a **specific topic**, prefer `get_opinion_analysis_by_topic`.
- **`channel_code` / `channel_category` matching**:
  - `channel_category="social"` → only social channels: youtube_keyword, tiktok, twitter, facebook, reddit, discord, etc.
  - `channel_category="game_store"` → only store channels: steam, google_play, app_store, etc.
  - If unsure, do NOT set `channel_category`, only set `channel_code`.
  - If both conflict, tool may auto-fix by trusting `channel_code`.
- **`is_official_account`**: Only set when the user **explicitly** asks for official or non-official content (e.g. "官方帖子" → true, "玩家/社区讨论" → false). For general queries like "舆情有哪些", leave as `None`.
- Date defaults are auto-filled when omitted.
- Keep filter values explicit; avoid inventing unsupported channel/language codes.

## Output Format Rule

Note to user: "The topic ratio is calculated using only representative comments".

When presenting the opinion analysis, you **MUST** follow this exact format for each item:

```
{序号}. {主题描述}({百分比}%) : {内容说明}。
```

NEVER simplify or omit any opinion items. Keep all percentage numbers **EXACTLY** as provided in the data.
