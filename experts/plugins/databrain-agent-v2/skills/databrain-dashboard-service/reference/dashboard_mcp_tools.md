# Dashboard MCP Tools (Two-Step Workflow)

For game-specific feature data (crash, progression, FPS, coop, topup, etc.) and ALL Miniclip game queries.

## Step 1: `dashboard_mcp_describe_data_tool`
Discover available cubes/measures/dimensions.
```
game_code: str       # REQUIRED - valid dashboard game_code (e.g. demo, i_game, nikke)
user_query: str      # REQUIRED - semantic user query; if ambiguous, agent should rewrite to be clearer
```
⚠️ Do NOT pass `game_names` — this tool uses `game_code`.
Returns: JSON schema of available measures/dimensions/filters for building step 2 query.

## Step 2: `dashboard_mcp_read_data_tool`
Execute MCP query with custom measures, dimensions, filters, time ranges.
```
game_code: str       # REQUIRED - same game_code as step 1
query: str (JSON)    # REQUIRED - query object built from step 1 schema
```

## Query Object for Step 2
Build based on describe_data schema. Typical structure:
```json
{
  "measures": ["cube.metric1"],
  "dimensions": ["cube.dim1"],
  "filters": [{"member":"cube.field","operator":"equals","values":["val"]}],
  "timeDimensions": [{"dimension":"cube.date","dateRange":["2026-01-01","2026-01-31"],"granularity":"day"}],
  "order": [["cube.metric1","desc"]],
  "limit": 1000
}
```

## Rules
- Always do step 1 first to get schema, then build step 2 query.
- `game_code` is NOT same as `game_names` — resolve from `dashboard_game_code_and_filters` in context.
- Miniclip games: ALL metrics must go through MCP, never `dashboard_metrics_query_tool`.
- De-minor (去小号) for non-NIKKE games: must use MCP tools.
- `user_query` in step 1 should be descriptive of what data is needed.
