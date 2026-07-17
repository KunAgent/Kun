# MGMT Metric Catalog

Do not maintain a static full metric table in markdown.

The complete metric catalog is loaded from MGMT metric map API at runtime by `scripts/run_tool.py` and stored in:

```text
context.mgmt_info["metric_by_code"]
```

To inspect the current user's API-backed metric map, call `mgmt_metric_map_tool`.
