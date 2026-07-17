# mgmt_metrics_query_tool

## Signature

```text
start_date: str      # REQUIRED, YYYY-MM-DD
end_date: str        # REQUIRED, YYYY-MM-DD
metrics: list[str]   # REQUIRED, MGMT metric_code list
module: str          # REQUIRED, business|all_studio|studio|publishing|project
```

## Rules

- Do not pass `studio_id`, `combine_id`, or other IDs. The tool reads them from context.
- `metrics` must use MGMT `metric_code` from the runtime metric map API (`mgmt_metric_map_tool` / `context.mgmt_info["metric_by_code"]`).
- `module=project` requires project IDs in context; `module=studio` requires studio IDs in context.
- TopN follow-up: after `mgmt_topn_query_tool`, call this tool only once with `module=studio` or `module=project`; the tool uses IDs stored by TopN.
- `decision_point` is special and can be queried as `metrics=["decision_point"]`.
- KPI/forecast/calendar/milestone metrics may allow future dates; other metrics are capped to today by the tool.

## Default Time Range

If no specific time period is provided, use current-year-to-date:

- `start_date`: Jan 1 of last month's year.
- `end_date`: yesterday.

Use `start_date=2000-01-01` only for explicit lifetime/since-launch wording such as `截止`, `上线至今`, `以来`, `历史`, `since launch`, `all-time`.

## `decision_point` Special Rules

- `decision_point` is non-numeric management decision data; it has no unit/describe data.
- If requested with `module="business"`, the tool queries `decision_point` under `publishing` because only IEGG self-publishing has project-team decision info.
- If requested with `module="studio"`, the tool skips `decision_point` because studio-publishing has no project-team decision info.
- If mixed with other metrics, `decision_point` may be queried separately from the main metrics.
