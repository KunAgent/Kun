---
name: sec-edgar
description: "Retrieve and analyze public SEC filings, company facts, XBRL data, and filing metadata."
---

# SEC EDGAR
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Retrieve and analyze public SEC filings, company facts, XBRL data, and filing metadata.

## Tool routing
| Tool or skill | Use |
|---|---|
| `web_fetch` | Fetch public SEC filing pages, submissions JSON, or company facts. |
| `browser_use` | Inspect EDGAR search and filing pages interactively. |
| `render_chart` | Present filing-derived trends from verified values. |

## Workflow
1. Resolve the registrant by CIK and verify ticker or name aliases.
2. Select filing form, period, accession, and amendment status.
3. Fetch the primary filing or public SEC structured data.
4. Normalize units and taxonomy concepts carefully.
5. Cite form, filing date, period, accession number, and SEC URL.

## Completion gates
- Check amended filings and restatements.
- Reconcile extracted values to the filing tables and scale.
- Separate company disclosure from analyst interpretation.

## Boundaries
- Do not use scraped summaries as substitutes for material filing evidence.
- Do not present filing analysis as personalized investment advice.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
