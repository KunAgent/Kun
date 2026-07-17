---
name: cash-flow
description: "Cash flow forecasting and payroll planning. Generate 4-13 week cash projections, assess payroll feasibility, chase overdue invoices to close gaps, and provide next-month outlook. Triggers on: cash flow, runway, payroll risk, can we make payroll, month ahead."
---

# Cash Flow Forecasting & Payroll Planning

## Overview

Build a rolling 4–13 week cash flow projection, assess whether the business can make payroll, identify and chase overdue invoices to close gaps, and provide a next-month outlook with risk flags.

## Workflow

### Step 1: Build Cash Flow Snapshot

Collect from user:
- Current bank balance(s) and date
- Expected inflows by week: confirmed receivables, recurring revenue, other income
- Expected outflows by week: payroll, rent, loan payments, vendor payments, discretionary spend

Build a weekly projection table:

| Week | Starting Balance | Inflows | Outflows | Ending Balance | Min Cushion |
|------|-----------------|---------|----------|---------------|-------------|
| W1   |                 |         |          |               |             |
| ...  |                 |         |          |               |             |

- Minimum cushion = 2 weeks of fixed costs (payroll + rent + loan payments)
- Flag any week where ending balance < minimum cushion in red

### Step 2: Assess Payroll Feasibility

For each payroll date in the projection window:

- **CLEARED** — Ending balance ≥ payroll amount + 2-week cushion after payroll
- **TIGHT** — Ending balance ≥ payroll amount but < cushion after payroll
- **SHORTFALL** — Ending balance < payroll amount

If SHORTFALL: immediately escalate to Step 3.

### Step 3: Close Gaps (If Shortfall or Tight)

Prioritized gap-closing actions:
1. **Chase overdue invoices** — Run invoice-chase skill on top-priority AR
2. **Defer non-critical spend** — List discretionary outflows that can shift ≥ 1 week
3. **Accelerate receivables** — Offer early-pay discounts (1–2%) on outstanding invoices
4. **Tap credit line** — If available, calculate minimum draw needed
5. **Owner draw delay** — Flag owner distributions that can be postponed

### Step 4: Next-Month Outlook

Summarize:
- Projected opening and closing balance for the month
- Largest risk items (biggest outflow, most uncertain inflow)
- Key dates to watch (payroll, rent, loan payments, large receivable due dates)
- Confidence level: HIGH / MEDIUM / LOW (based on % of inflows that are confirmed vs. estimated)

### Step 5: Output Action Plan

Deliver:
1. Cash flow projection table (weekly)
2. Payroll assessment with status per pay date
3. Gap-closing action list ranked by speed-to-cash
4. Next-month outlook summary
5. "Do this today" — top 3 actions ranked by urgency

## Notes

- Always use the most recent bank balance available; note the date
- Separate "confirmed" inflows (signed PO, scheduled payment) from "expected" (verbal, habitual but not committed)
- Flag any projection that assumes > 50% unconfirmed inflows as LOW confidence
