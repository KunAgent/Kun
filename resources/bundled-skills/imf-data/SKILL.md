---
name: imf-data
description: "Retrieve and analyze IMF macroeconomic series, forecasts, and reserve-composition data."
---

# IMF Data
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Retrieve and analyze IMF macroeconomic series, forecasts, and reserve-composition data.

## Tool routing
| Tool or skill | Use |
|---|---|
| `web_fetch` | Fetch public IMF APIs, database pages, metadata, or releases. |
| `browser_use` | Inspect official IMF portals when interaction is required. |
| `render_chart` | Present country, indicator, or forecast comparisons. |

## Workflow
1. Identify dataset, edition, country or region, indicator, years, unit, and estimate status.
2. Locate the official public IMF endpoint or release page.
3. Fetch values and retain database-edition metadata.
4. Separate observed, estimated, and forecast periods.
5. Cite the release, source URL, and retrieval date.

## Completion gates
- Check units, scale, fiscal/calendar basis, and country coverage.
- Do not compare values across editions without noting revisions.
- Verify regional aggregates are source-provided or transparently calculated.

## Boundaries
- Do not present IMF projections as certain outcomes.
- Do not silently substitute another macroeconomic source.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
