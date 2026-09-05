---
name: daily-brief
description: "Produce a dated, source-linked daily brief with prioritized developments, implications, and watch items."
---

# Daily Intelligence Brief
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Produce a dated, source-linked daily brief with prioritized developments, implications, and watch items.

## Tool routing
| Tool or skill | Use |
|---|---|
| `web_fetch` | Retrieve public primary-source updates. |
| `browser_use` | Inspect public pages that require interaction. |
| `render_chart` | Present a material trend or ranking. |

## Workflow
1. Confirm date, timezone, audience, topics, geography, and cutoff time.
2. Collect developments from primary or authoritative sources.
3. Rank by impact and confidence, not novelty alone.
4. Write a concise executive summary followed by evidence and implications.
5. Add watch items with explicit triggers.

## Completion gates
- Date every item and include source URLs.
- Distinguish confirmed events from forecasts or commentary.
- Check that the title and cutoff date match the actual reporting window.

## Boundaries
- Do not present rumors as facts.
- Do not reuse stale items without explaining why they remain material.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
