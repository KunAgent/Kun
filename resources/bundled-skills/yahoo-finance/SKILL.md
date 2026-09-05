---
name: yahoo-finance
description: "Retrieve public Yahoo Finance market, company, financial, ownership, and analyst data through authorized access."
---

# Yahoo Finance
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Retrieve public Yahoo Finance market, company, financial, ownership, and analyst data through authorized access.

## Tool routing
| Tool or skill | Use |
|---|---|
| `web_fetch` | Fetch authorized public Yahoo Finance pages when text extraction is available. |
| `browser_use` | Inspect public ticker and company pages interactively. |
| `render_chart` | Present verified price or metric trends. |

## Workflow
1. Confirm ticker, exchange, instrument type, currency, and timezone.
2. Specify raw or adjusted prices and the observation timestamp.
3. Fetch only publicly accessible fields needed for the question.
4. Normalize periods and units before comparison.
5. Cite the page URL and retrieval timestamp; report when access is unavailable.

## Completion gates
- Check delayed versus real-time status.
- Verify corporate actions and fiscal periods.
- Separate reported values, derived metrics, and analyst estimates.

## Boundaries
- Do not bypass access controls or terms.
- Do not present market data as personalized investment advice or guaranteed returns.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
