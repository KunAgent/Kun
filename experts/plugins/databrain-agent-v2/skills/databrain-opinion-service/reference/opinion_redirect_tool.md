# opinion_redirect_tool

Generate DataBrain opinion-analysis page links for task redirection.

## Signature

```text
game_names: List[str]                # REQUIRED
analysis_type: str                   # REQUIRED: custom_ai_summary | keyword_analysis | url_analysis
keywords: List[str] = None
description: str = None
```

## Best For

- Need redirect links for creating advanced opinion tasks in DataBrain UI
- Need user-facing deep-link for keyword/url/custom analysis pages

## Rules

- `analysis_type` must be one of:
  - `custom_ai_summary`
  - `keyword_analysis`
  - `url_analysis`
- If game cannot be resolved in DataBrain opinion scope, fallback may trigger web search path.
