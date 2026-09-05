---
name: world-bank-data
description: "Retrieve and analyze World Bank indicators, country metadata, and development time series."
---

# World Bank Data
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Retrieve and analyze World Bank indicators, country metadata, and development time series.

## Tool routing
| Tool or skill | Use |
|---|---|
| `web_fetch` | Fetch the official World Bank public API and indicator metadata. |
| `browser_use` | Inspect official indicator and country pages interactively. |
| `render_chart` | Present trends and country comparisons. |

## Workflow
1. Define indicator concept, code, countries, years, unit, and aggregation need.
2. Fetch indicator metadata from the official World Bank source.
3. Fetch values and preserve country or region identifiers.
4. Handle missing years and aggregates explicitly.
5. Cite indicator code, source organization, update date, and URL.

## Completion gates
- Check current versus constant prices, per-capita denominators, and percentage definitions.
- Do not average region aggregates with countries.
- Label modeled estimates and source revisions.

## Boundaries
- Do not interpolate missing data without disclosure.
- Do not imply that correlated development indicators establish causation.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
