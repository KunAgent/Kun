---
name: data-visualization
description: "Design and generate accurate statistical visualizations with readable scales, labels, annotations, and source context."
---

# Data Visualization
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Design and generate accurate statistical visualizations with readable scales, labels, annotations, and source context.

## Tool routing
| Tool or skill | Use |
|---|---|
| `render_chart` | Render governed charts directly from structured data. |
| `bash` | Run Python visualization code for file-based figures. |
| `design_create_diagram` | Create chart-like explanatory diagrams on canvas. |

## Workflow
1. Identify the analytical question and comparison structure.
2. Validate data types, units, missing values, and aggregation.
3. Select the simplest chart that preserves the relationship.
4. Use direct labels, honest scales, accessible color, and source notes.
5. Export at the requested dimensions and inspect the result.

## Completion gates
- Check totals, ordering, axes, units, legends, and annotations against source data.
- Use zero baselines where magnitude comparison requires them.
- Avoid dual axes unless the relationship and scale are unambiguous.

## Boundaries
- Do not smooth, truncate, or aggregate in ways that change the conclusion without disclosure.
- Do not use decorative charts when a table or metric is clearer.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
