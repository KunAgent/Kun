---
name: xlsx
description: "Inspect, edit, validate, and preview existing Excel workbooks and supported ranges."
---

# Spreadsheet Workbooks
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Inspect, edit, validate, and preview existing Excel workbooks and supported ranges.

## Tool routing
| Tool or skill | Use |
|---|---|
| `office_inspect` | Inspect existing workbook sheets, ranges, issues, formulas, and source hash. |
| `office_edit` | Apply atomic hash-protected edits to an existing XLSX. |
| `office_preview` | Preview a sheet or range. |
| `render_chart` | Show conversation-level findings from already structured data. |

## Workflow
1. Require an existing XLSX file for workbook editing.
2. Inspect sheets, formulas, names, validations, styles, and source hash.
3. Translate requested changes into the smallest structured operation batch.
4. Apply office_edit with expectedSha256.
5. Validate formulas and preview the affected ranges.

## Completion gates
- Reconcile totals to source data.
- Check formulas, cached values, dates, currencies, percentages, and error cells.
- Preserve macros or advanced features only with a toolchain that supports them.

## Boundaries
- This Kun environment does not include a native create-from-scratch XLSX generator or recalculation engine.
- Do not install spreadsheet libraries implicitly or overwrite unsupported workbook features.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
