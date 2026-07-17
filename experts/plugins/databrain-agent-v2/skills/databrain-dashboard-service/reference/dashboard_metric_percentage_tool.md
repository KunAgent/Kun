# dashboard_metric_percentage_tool

Metric dimensional percentage/share analysis (e.g., revenue share by country).

## Signature
```
game_names: List[str] = []         # game names
start_date: str = None             # YYYYMMDD
end_date: str = None               # YYYYMMDD
metrics: List[str] = []            # metrics to analyze (max 20)
granularity: str = None            # daily|weekly|monthly|realtime
group_by_dimension: str = None     # dimension to group by: zone|country|os|channel|region|lang
zone: List[str] = []
country: List[str] = []
os: List[str] = []
channel: List[str] = []
region: List[str] = []
lang: List[str] = []
```

## Rules
- Only supports percentage breakdown by: zone, country, os, channel, region, lang.
- For other dimension breakdowns → use `dashboard_metrics_query_tool`.
- Metrics that are already rates/ratios (e.g. 自然量占比, 付费用户占比) should NOT use this tool — use `dashboard_metrics_query_tool` to query them directly.
- Only ONE `group_by_dimension` per call.
- Only ONE filter dimension per call.
- Same date format (YYYYMMDD) and metric rules as `dashboard_metrics_query_tool`.
- Falls back to `dashboard_metrics_query_tool` if percentage query fails.
