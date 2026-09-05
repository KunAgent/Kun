---
name: open-data
description: "Retrieve official statistics from public international organizations and economic-data providers."
---

# Official Open Data
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Retrieve official statistics from public international organizations and economic-data providers.

## Tool routing
| Tool or skill | Use |
|---|---|
| `web_fetch` | Fetch official public APIs, metadata pages, and releases. |
| `browser_use` | Inspect official public portals when interaction is required. |
| `render_chart` | Present comparable time series or rankings. |

## Workflow
1. Define the indicator concept, geography, population, period, unit, and frequency.
2. Locate an official public API or authoritative source page.
3. Fetch values together with indicator codes, dimensions, and metadata.
4. Normalize only when definitions are comparable.
5. Document the source URL, code, unit, update date, and transformation.

## Completion gates
- Check breaks in series, provisional flags, seasonal adjustment, and missing values.
- Avoid ranking incomparable geographies or definitions.
- Preserve source URLs and indicator codes.

## Boundaries
- Do not fill missing values or convert units without disclosure.
- Do not mix official and modeled estimates without clear labels.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
