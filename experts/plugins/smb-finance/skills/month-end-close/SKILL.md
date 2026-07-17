---
name: month-end-close
description: "Complete month-end close workflow: pre-close checks, bank reconciliation, accruals, trial balance, financial statements, P&L narrative with margin summary. Triggers on: month end, close the books, monthly close, closing checklist."
---

# Month-End Close

## Overview

Execute the complete month-end close workflow: pre-close validation, bank and credit card reconciliation, accrual entries, trial balance review, financial statement generation, and P&L narrative with margin context.

## Workflow

### Step 1: Pre-Close Checks

Verify before starting the close:

- [ ] All bank and CC transactions imported and categorized
- [ ] All invoices and bills entered for the period
- [ ] No uncategorized transactions remaining
- [ ] Inventory counts updated (if applicable)
- [ ] Employee expense reports submitted and approved
- [ ] Previous month's accruals reviewed for reversal

Flag any incomplete items and list what's needed before proceeding.

### Step 2: Bank & Credit Card Reconciliation

For each bank and CC account:

| Item | Bank Statement | Book Balance | Difference |
|------|---------------|-------------|------------|
| Ending balance | ¥ | ¥ | ¥ |
| Outstanding checks | | | |
| Deposits in transit | | | |
| Bank fees not recorded | | | |
| Interest earned not recorded | | | |
| **Adjusted balance** | ¥ | ¥ | ¥ |

- Adjusted balances must match. If not, identify and resolve each discrepancy
- List any stale checks (> 90 days outstanding) for void/reissue decision

### Step 3: Post Accruals

Record standard accrual entries:
- Wages earned but not yet paid (if payroll date falls after month-end)
- Utilities and recurring expenses not yet billed
- Interest on loans not yet recorded
- Revenue earned but not yet invoiced (accrued revenue)
- Prepaid expenses to amortize this period
- Prior month accruals to reverse

Present each entry as: Account | Debit | Credit | Description

### Step 4: Trial Balance Review

Generate trial balance and check:

- [ ] Total debits = total credits (must balance)
- [ ] No unusual balances (negative cash, negative AP, equity < 0 without explanation)
- [ ] Compare key accounts to prior month — flag changes > 20% with no obvious explanation
- [ ] Verify retained earnings roll-forward is correct

### Step 5: Generate Financial Statements

Produce three standard statements:

1. **Income Statement (P&L)** — Revenue, COGS, Gross Profit, Operating Expenses, Net Income
2. **Balance Sheet** — Assets, Liabilities, Equity as of month-end
3. **Cash Flow Statement** — Operating, Investing, Financing activities for the period

Each statement must include: current period, prior period, and ¥ change.

### Step 6: Write P&L Narrative

Write a concise narrative covering:

- **Top-line**: Revenue vs. prior month and vs. budget (if available). Up or down, and why
- **Margin context**: Gross margin % this month vs. prior and vs. target. What drove changes
- **Expense highlights**: Any unusual or one-time expenses. Recurring expense trends
- **Bottom line**: Net income vs. prior month. Is the business on track for quarterly targets
- **Cash position**: Ending cash and how many weeks of runway it represents

Keep the narrative to 1 page. Write for the business owner, not the accountant.

### Step 7: Close Package

Assemble the close package:
1. Pre-close checklist (completed)
2. Bank reconciliation summaries
3. Accrual journal entries
4. Trial balance
5. Financial statements (P&L, Balance Sheet, Cash Flow)
6. P&L narrative
7. Notes and open items for next month

Flag any items that need owner decision before the close is finalized.

## Notes

- Close should be completed within 5 business days of month-end
- If data is incomplete, complete what you can and clearly label what is estimated vs. confirmed
- Every adjustment must have a documented reason — no "plug" numbers
- Retain all supporting schedules for audit trail
