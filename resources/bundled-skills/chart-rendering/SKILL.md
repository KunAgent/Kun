---
name: chart-rendering
description: "Render governed Kun charts and tables from structured data for trustworthy comparison and lookup."
---

# Chart Rendering
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Render governed Kun charts and tables from structured data for trustworthy comparison and lookup.

## Tool routing
| Tool or skill | Use |
|---|---|
| `render_chart` | Render metric, bar, line, area, pie, donut, or table outputs. |

## Workflow
1. State the conclusion in text before the chart.
2. Normalize data into explicit fields with one row per observation.
3. Choose the chart type from the analytical relationship.
4. Declare columns, x/y fields, formats, and series semantics.
5. Limit actions to the useful exports or expansion controls.

## Completion gates
- Use exact values and meaningful labels.
- Prefer tables for lookup and bars for ranking.
- Use pie/donut only for a small true part-to-whole composition.

## Boundaries
- Do not pass HTML, CSS, JavaScript, URLs, or chart-library options.
- Do not render a chart when prose or a single metric is clearer.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
