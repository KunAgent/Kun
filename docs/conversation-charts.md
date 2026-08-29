# Conversation Chart Contract

Kun treats charts as governed conversation content, not model-authored frontend code.

## Preferred agent path

Agents that support tools call `render_chart` with a versioned `ChartSpec`. The runtime validates the spec before persisting the ordinary tool call/result pair. The desktop validates it again before rendering.

```json
{
  "version": 1,
  "type": "line",
  "title": "30-day error-rate trend",
  "data": [
    { "date": "2026-08-01", "errorRate": 2.1 },
    { "date": "2026-08-02", "errorRate": 3.8 }
  ],
  "x": { "field": "date", "label": "Date", "format": "date" },
  "y": { "field": "errorRate", "label": "Error rate", "format": "percent" },
  "series": [{ "field": "errorRate", "label": "Error rate", "color": "danger" }],
  "actions": ["expand", "download-png", "download-csv"]
}
```

Text-only integrations may emit the same JSON in a fenced `chart` block. This is an input compatibility format only; it is not the durable internal message model.

## Chart selection

| Intent | Default |
| --- | --- |
| Trend over time | `line` or `area` |
| Top-N or ranking | horizontal `bar` |
| Category or multi-metric comparison | grouped `bar` or multi-series `line` |
| Proportion or composition | `pie` or `donut` |
| One important value | `metric` |
| Exact lookup | `table` |

Agents must not draw a chart without trustworthy structured data. They must follow explicit requests for prose-only or table-only output, normally use no more than two charts, and state a conclusion before the chart.

## Trust boundary

`ChartSpec` accepts data and semantic presentation intent only. It rejects HTML, CSS, JavaScript, remote resources, arbitrary colors, formatter functions, and native chart-library options. Rows, columns, series, text lengths, numeric values, and encoded payload size are bounded.

The desktop owns themes, layout, tooltips, responsive behavior, motion, export, and accessibility. Chart colors are mapped from semantic names to Kun design tokens.

## Client fallback

- Desktop GUI: interactive chart, data table, and allowed export actions.
- Markdown-only GUI integrations: validated fenced chart block.
- TUI/CLI: title and bounded textual data summary; no claim that a GUI chart was displayed.
- API/webhook: original `ChartSpec` remains in the ordinary tool result and can be rendered by a compatible client.
- Older clients: ordinary tool result JSON remains available.

Disabling the Lab conversation-visualization setting removes `render_chart` from future GUI tool catalogs. Existing persisted chart results remain renderable.

## Versioning

Consumers must reject unknown major versions and unknown fields. Additive platform support should use optional fields within a known version only when old clients can safely ignore the absence of the feature. Breaking changes require a new `version` and an explicit compatibility adapter.
