# mgmt_topn_query_tool

## Signature

```text
start_date: str
end_date: str
order_metric_obj: dict
query_metrics: list[str]
module: str              # studio|project only
top_num: int = 10
data_source: str | null  # only with module=project: studio|publishing|dev
```

## `order_metric_obj`

Must be a JSON object:

```json
{"order_metric":"gross_revenue_actual", "order_by":"gross_revenue_actual", "order":"desc"}
```

| order_metric | allowed order_by |
|---|---|
| `gross_revenue_actual` | `gross_revenue_actual`, `growth`, `growth_rate`, `mom`, `yoy` |
| `gross_revenue_forecast` | `gross_revenue_forecast`, `neutral`, `business_team` |
| `gross_revenue_kpi` | `gross_revenue_kpi`, `complete` |
| `net_profit_actual` | `net_profit_actual`, `growth`, `growth_rate` |
| `net_profit_forecast` | `net_profit_forecast`, `neutral`, `business_team` |
| `net_profit_kpi` | `net_profit_kpi`, `complete` |
| `milestone_headcount` | `milestone_headcount`, `next_milestone_headcount` |

Rules:
- Use `module="studio"` for studio rankings.
- Use `module="project"` for project/game rankings.
- `data_source` only applies to `module="project"`: `studio`, `publishing`, `dev`.
- If the user asks broad “all/every/each studio/project”, use `top_num=10` first.
- Do not use this tool when the ranked objects are not studios or projects.
- If `order_by="complete"`, it is only valid for `gross_revenue_kpi` or `net_profit_kpi`; actual/forecast metrics are automatically sanitized to the corresponding KPI metric.
- If `order_by` is invalid for `order_metric`, the tool falls back to `order_by=order_metric`.
- KPI/forecast/calendar/milestone ranking metrics may allow future dates; other metrics are capped to today by the tool.
