# HTML Dashboard Schema Quick Reference

> The role of this document is now a **quick reference for the template's internal JSON schema**, not a workflow guide.
> For the full process, see the "Standard Output Files" and "HTML Dashboard" sections in `SKILL.md`.

## One-Line End-to-End Flow

**Strategy backtest**: run backtest -> call `export_results(...)` to write the 3 standard files -> the dashboard script reads those 3 files -> builds the `report_data` dict -> replaces the `__REPORT_DATA__` placeholder in `dashboard_template.html` -> outputs HTML.

**Event study**: finish event statistics -> **write `trades.csv` directly** (do not call `export_results`, because there is no portfolio-style summary; metrics come from `trades.pnl_pct`, see the "Standard Output Files" section in `SKILL.md`) -> the dashboard script reads `trades.csv` and constructs equity / summary as needed -> builds `report_data` -> same rendering flow as above.

`reference/render_dashboard.py` is a **copyable example** of this flow, not a mandatory library; if you copy it, copy `reference/dashboard_locales.py` too.

## The `report_data` Structure Expected by the Template

The template injects data via string replacement, using three placeholders:
- `__REPORT_TITLE__` -> strategy name (plain text, HTML-escaped)
- `__HTML_LANG__` -> page language attribute (`zh-CN` / `en`)
- `__REPORT_DATA__` -> the JSON string of `report_data` (must escape `<>&`)

```python
import json, html
template = open("dashboard_template.html").read()
report_json = json.dumps(report_data, ensure_ascii=False)
report_json = report_json.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
rendered = template.replace("__REPORT_TITLE__", html.escape(strategy_name)).replace("__REPORT_DATA__", report_json)
open("index.html", "w").write(rendered)
```

```python
report_data = {
    "meta": {
        "strategy_name": "MA Cross",
        "symbol": "600519.SH",
        "start": "2024-01-01",
        "end": "2024-12-31",
        "initial_cash": 1000000.0,
        "window_start_value": 1000000.0,
        "final_value": 1123456.78,
        "market": "china_a",
        "generated_at": "2026-04-08T10:00:00+08:00",
    },
    "summary": {
        "total_return_pct": 12.35,
        "annual_return_pct": 12.35,
        "max_drawdown_pct": 8.12,
        "sharpe": 1.21,
        "win_rate_pct": 58.33,
        "total_trades": 24,
    },
    "equity_curve":   [{"date": "2024-01-02", "value": 1000000.0}, ...],
    "pnl_curve":      [{"date": "2024-01-02", "pnl": 0.0}, ...],         # pnl = value - window_start_value
    "drawdown_curve": [{"date": "2024-01-02", "drawdown_pct": 0.0, "drawdown_abs": 0.0}, ...],
    "trade_history":  [{"symbol": ..., "side": "long", "entry_date": ..., "exit_date": ...,
                        "holding_bars": 13, "size": 100, "entry_price": 1500.0,
                        "exit_price": 1560.0, "pnl": 6000.0, "pnl_pct": 4.0,
                        "label": "Event description (required for event-driven tasks, optional otherwise)"}, ...],
    "ui": {
        "subtitle": "Modular Backtest Dashboard",
        "active_tab": "overview",
        "tabs": [{"id": "overview", "label": "Overview"}],
        "language": "en",       # required; only "zh" or "en"; follow the user-facing output language
        # color_scheme is optional: "eastern" (A shares / Hong Kong: red up, green down)
        # or "western" (U.S. etc.: green up, red down)
        # If omitted, the template infers it from meta.market:
        # china_a / hong_kong -> eastern; known U.S. market keys such as us_stock / us -> western;
        # if market is missing or unknown, default = eastern
    },
    "modules": [ ... ],      # see below
}
```

`meta` and `summary` come directly from `<prefix>_summary.json`.
`equity_curve` comes directly from `<prefix>_equity.csv`.
`trade_history` comes directly from `<prefix>_trades.csv`.
`pnl_curve` and `drawdown_curve` are derived from `equity_curve`.

## The `modules` Array

`modules` determines which cards are rendered on the page. Within the same tab, modules are rendered from top to bottom in array order.

> Organize the page only through `modules`. **Do not pass `sections` anymore**. The supported extension points in `build_dashboard_data()` are `extra_modules` and `ui_overrides`.

Available `type` values:

| type | Meaning |
|---|---|
| `overview_chart` | Main chart area: KPI strip + primary curve + markers + drawdown pane |
| `metric_table` | Performance metrics table |
| `trades_table` | Trade-detail table |
| `line_chart` | Generic multi-series line chart |
| `text` | Free-form text block |
| `custom_html` | Arbitrary HTML injected by the LLM (SVG / canvas / echarts / img, etc.) for strategy-specific visualizations |

### `overview_chart`

```python
{
    "type": "overview_chart",
    "tab": "overview",
    "width": "full",
    "stats": [           # top KPI cards
        {"label": "Total Return", "value": "12.35%", "raw": 12.35},   # raw controls coloring
        {"label": "Max Drawdown", "value": "8.12%", "raw": -8.12},
        {"label": "Trades", "value": "24"},                            # no raw -> neutral coloring
        ...
    ],
    "points": [          # main chart data points
        {"date": "2024-01-02", "equity": 1000000.0, "drawdown_abs": 0.0, "pnl": 0.0},
        ...
    ],
    "markers": [         # markers (strategy backtest = buy/sell; event study = one event marker per row)
        {"date": "2024-02-01", "action": "buy",  "price": 1500.0, "size": 100,
         "label": "Q1 results beat expectations"},
        {"date": "2024-02-20", "action": "sell", "price": 1560.0, "size": 100, "pnl": 6000.0, "pnl_pct": 4.0},
        {"date": "2024-02-01", "action": "event", "label": "Q1 results beat expectations",
         "entry_date": "2024-02-01", "exit_date": "2024-02-20", "pnl_pct": 4.0},
        # action can be buy / sell / short / cover / event
        # label is required in event-study scenarios. By default each event row produces one event marker.
        # When eventCount <= 20, the event name is drawn statically; <= 30 still shows the MM-DD date;
        # hover always shows the full label.
    ],
    "series_key": "equity",
    "stroke": "#f23645",
    "area_fill": "rgba(181,126,255,0.18)",
    "bars_key": "drawdown_abs",
    "bars_fill": "rgba(181,126,255,0.32)",
    "toggles": [         # in-chart toggles
        {"id": "equity",   "label": "Equity Curve", "checked": True},
        {"id": "drawdown", "label": "Drawdown",     "checked": True},
        {"id": "trades",   "label": "Trade Marks",  "checked": True},
    ],
    "modes": [           # absolute / percentage switch
        {"id": "absolute",   "label": "Absolute",   "active": True},
        {"id": "percentage", "label": "Percentage", "active": False},
    ],
    # overlay_series is optional: overlay additional comparison lines
    # "overlay_series": [
    #     {"name": "Buy & Hold", "stroke": "#9e9e9e",
    #      "points": [{"date": "2024-01-02", "value": 1000000}, ...]},
    #     {"name": "Strategy B", "stroke": "#ff9800", "points": [...]},
    # ],
}
```

### `metric_table`

```python
{
    "type": "metric_table",
    "tab": "overview",
    "title": "Performance Metrics",
    "columns": ["Metric", "All"],
    "rows": [
        {"metric": "Total Return",   "values": [{"main": "12.35%"}]},
        {"metric": "Annual Return",  "values": [{"main": "12.35%"}]},
        ...
    ],
}
```

For multi-column comparison (for example multi-strategy comparison), use `columns = ["Metric", "Strategy A", "Strategy B"]`, and align the `values` array accordingly.

### `trades_table`

```python
{
    "type": "trades_table",
    "tab": "overview",
    "title": "Trade Details",
    "rows": <trade_history>,    # pass trade_history directly
    # columns is optional: custom columns. If omitted, the default 10 columns are used.
    # Each column: key=field name, label=display name, format=rendering mode
    # format can be text (default) / number / pct / sign / pill
}
```

### `line_chart`

Generic multi-series line chart, **all lines are peers; there is no designated primary series**. For peer comparison across multiple symbols ("compare one strategy across N stocks"), prefer this over `overview_chart`; otherwise one line is visually elevated as the main line. Common uses include multi-strategy NAV comparison and rolling Sharpe comparison:

```python
{
    "type": "line_chart",
    "tab": "overview",
    "title": "NAV Comparison",
    "subtitle": "Strategy A vs Strategy B",
    "series": [
        {"name": "Strategy A", "points": [{"date": "...", "value": 1.0}, ...]},
        {"name": "Strategy B", "points": [...]},
    ],
}
```

### `text`

```python
{
    "type": "text",
    "tab": "overview",
    "title": "Strategy Notes",
    "text": "Any text / markdown goes here",
}
```

`text` is the standard place for stable, reviewable, shareable explanations, especially:
- conclusion summary
- key assumptions / methodology
- limitations and bias
- optimization ideas / next steps

Do not paste the full chat reply into the dashboard. Dashboard text should be **summarized, structured, and independently readable outside the conversation**.

Recommended usage:

```python
report_data = build_dashboard_data(
    equity_csv="demo_equity.csv",
    trades_csv="demo_trades.csv",
    summary_json="demo_summary.json",
    language="en",  # follow the user's output language
    extra_modules=[
        {"type": "text", "tab": "overview", "title": "Conclusion", "text": "- Most return came from 3 trend trades\n- Max drawdown was concentrated in March"},
        {"type": "text", "tab": "overview", "title": "Key Assumptions", "text": "- Filled at next-day open\n- A shares lot rounding applied\n- Forced liquidation at the end"},
        {"type": "text", "tab": "overview", "title": "Limitations", "text": "- Daily bars cannot reconstruct intraday order precisely\n- Impact cost not modeled"},
        {"type": "text", "tab": "overview", "title": "Optimization Ideas", "text": "- Test wider take-profit thresholds\n- Add sideways-market filters"},
    ],
)
```

If you want to put the notes in a new tab, add tabs through `ui_overrides`:

```python
report_data = build_dashboard_data(
    ...,
    ui_overrides={
        "tabs": [
            {"id": "overview", "label": "Overview"},
            {"id": "notes", "label": "Notes"},
        ],
        "active_tab": "overview",
    },
    extra_modules=[
        {"type": "text", "tab": "notes", "title": "Optimization Ideas", "text": "- ..."},
    ],
)
```

### `custom_html` (Unified Channel for Strategy-Specific Visualizations)

When the five base module types above are not expressive enough (score distributions, grid-level diagrams, monthly heatmaps, correlation matrices, holding-period histograms, and so on), use `custom_html`.

```python
{
    "type": "custom_html",
    "tab": "overview",
    "title": "Monthly Return Heatmap",   # optional
    "width": "full",                     # optional: full / half / third / two-third
    "html": "<svg ...>...</svg>",        # required: arbitrary HTML fragment
    "mount_script": "...",               # optional: JS executed after mount; can access host / module
}
```

Field notes:

- `html`: arbitrary HTML fragment, injected as `innerHTML` into the module body. `<script>` tags are re-executed by the mounter, so CDN imports such as `<script src="...">` are supported
- `mount_script`: optional initialization code. It is executed via `new Function('host', 'module', mount_script)(hostEl, module)`, so it can access the local variables `host` (the module-body DOM element) and `module` (the full module dict)

Constraints:

- DOM ids / CSS classes **must** use the `bt-custom-<name>-` prefix to avoid collisions with built-in template elements
- Do not assume the page already loaded echarts / d3 / chart.js — load external libraries yourself inside `html`
- Errors in `mount_script` are caught and appended at the bottom of the card as `<pre class="custom-html-error">`
- `.custom-html-body img/svg/canvas` already defaults to `max-width:100%`
- **The `title`, labels, and tooltips in `custom_html` must match the dashboard `language`**

> **Note**: static charts (histograms, scatter plots, heatmaps, and so on) should **not** be embedded in the dashboard by default. Generate them as standalone matplotlib PNG files instead (see the "Matplotlib Charts" section in `SKILL.md`). `custom_html` is primarily for interactive visualizations (echarts / d3 / custom SVG).

Implementation example (echarts CDN + `mount_script`):

```python
modules.append({
    "type": "custom_html",
    "tab": "overview",
    "title": "Monthly Return Heatmap",
    "html": """
        <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
        <div id="bt-custom-heatmap-1" style="height:280px;"></div>
    """,
    "mount_script": """
        const el = host.querySelector('#bt-custom-heatmap-1');
        const chart = echarts.init(el);
        chart.setOption({
            tooltip: {},
            xAxis: { type: 'category', data: ['Jan','Feb','Mar','Apr'] },
            yAxis: { type: 'category', data: ['2023','2024'] },
            visualMap: { min: -10, max: 10, calculable: true },
            series: [{
                type: 'heatmap',
                data: [[0,0,2.1],[1,0,-1.5],[2,0,3.8],[3,0,0.4],
                       [0,1,1.0],[1,1,2.5],[2,1,-0.7],[3,1,4.2]],
            }],
        });
    """,
})
```

## Dashboards for Non-Typical Backtests (Event-Driven / Stock-Selection / Portfolio Allocation)

> **Hard rule**: event-driven tasks ("buy on signal day + sell N days later / average return over 30 days / buy on the second day after an announcement and hold X days"), stock-selection tasks, and portfolio-allocation / rebalancing tasks **must also generate dashboards**.
>
> Do not skip dashboard generation just because the standard modules cannot easily assemble a continuous NAV curve or because there is no continuous trading round-trip structure. Silently skipping dashboards for any non-single-symbol continuous strategy has been a recurring failure mode.

**Event studies are exempt from `export_results`**: event studies do not have a meaningful portfolio-style summary (Sharpe / annualized return / max drawdown are not meaningful per event). The LLM should write `trades.csv` directly (see the "Standard Output Files" section in `SKILL.md`). Stock-selection / portfolio tasks that do have a real equity curve may still call `export_results`.

If you call `build_dashboard_data(...)` directly:
- event studies automatically switch to **event-level default modules**, instead of reusing Sharpe / annualized return / drawdown tables from strategy backtests
- event studies should **pass `event_overview_mode` explicitly**: use `"stats"` for queries about average return / median / win rate / best / worst event, `"timeline"` for cumulative performance / curve / time-evolution queries, and `"both"` when both views should remain visible
- when `event_overview_mode="timeline"` or `"both"` and no `equity_curve` is passed but `trade_history` contains event `entry_date / exit_date / pnl_pct`, a **cumulative event PnL curve** is synthesized automatically
- event studies default to **one `event` marker per event row** on the main chart. If `event_date` is not provided, it defaults to `entry_date`; it can also be moved with `event_anchor="exit"` or an explicit `event_date`
- if some event should appear only in `trades_table` and not on the chart, set `show_marker=False` on that row
- if you already have a better event curve (for example a custom virtual portfolio NAV), pass `equity_curve` explicitly and it overrides the synthesized one
- if an `overview_chart` is generated, `render_dashboard(...)` validates that **the number of displayable event markers equals the number of rows in the same tab where `show_marker != False`**. If not, rendering fails instead of silently producing "events in the table but missing markers on the chart"

### How the Standard Three Files Map in These Scenarios

- `<prefix>_trades.csv`: each row is **one event** (event date -> buy date -> sell date -> return_pct). Event studies write it manually; stock-selection / portfolio tasks may still use `export_results`, which does not require the strategy to be a continuous one-symbol strategy
- `<prefix>_equity.csv`: stock-selection / portfolio tasks may use a synthesized "virtual equal-weight NAV"; pure event studies may leave it empty if no such curve exists
- `<prefix>_summary.json`: stock-selection / portfolio tasks get it from `export_results`; event studies without portfolio-style metrics must not fabricate Sharpe / annualized return. Keep only event-level statistics such as `total_trades / win_rate_pct / total_return_pct`

### What to Put on the Dashboard — The LLM Decides

There is no rigid mandatory recipe. Available ingredients include:

- **KPI cards**: event count / average return / median return / win rate / best event / worst event / number of triggered symbols / holding-period P25/P75 ...
- **Main chart**: if a NAV-like curve can be synthesized, use `overview_chart` or `line_chart`; if not, do not force a main chart
- **Event list**: use `trades_table` to display `<prefix>_trades.csv`
- **Strategy-specific visuals**: static charts should be generated as standalone matplotlib PNG files (see the "Matplotlib Charts" section in `SKILL.md`); interactive charts should go through `custom_html`

The LLM should choose the 3-6 most informative modules for the specific task instead of blindly applying one fixed template.

### Bottom Line

- "I cannot build a continuous NAV curve" is **not** a valid reason to skip the dashboard
- "The standard 5 module types are not enough" is **not** a valid reason to skip the dashboard — use `custom_html`
- Even with only 5 events, the dashboard should at least contain: KPI block + event-detail table. Strategy-specific visuals can be delivered as standalone matplotlib PNGs
- The default remains a single HTML file; special visuals should be injected into that main dashboard through `custom_html`

---

## Multi-Strategy Comparison

- Default approach: run multiple strategies on the same data and cost assumptions, and **call `export_results(prefix=...)` once per strategy** to produce one independent set of 3 files per strategy
- When assembling the dashboard, read multiple sets of files -> use one `line_chart` for multi-series NAV + one `metric_table` for multi-column comparison
- Do not mix multiple strategies into one monolithic hybrid backtest script unless the problem is explicitly about strategy interaction

## How to Handle Strategy-Specific Content

If the user wants things like:
- score distribution for a scoring strategy
- a grid-level trigger map for a grid strategy
- holding-period distribution, return distribution, monthly heatmap

**Inject them through `custom_html` into the main dashboard**, as defined above. **Do not** output a separate HTML file. The default deliverable remains a single HTML.

## Implementation Bottom Line

- Do not scatter HTML-assembly logic inside strategy code — dashboard assembly should be separate from the backtest script
- Do not depend on a backend service; output must be a standalone single-file HTML
- Curves and tables should be read from the standard output files; do not bypass `export_results(...)` and recompute metrics ad hoc
- If the **data-loading span > formal evaluation span**, you must pass `start / end` into `export_results(...)` so it can slice and recompute on the evaluation window
