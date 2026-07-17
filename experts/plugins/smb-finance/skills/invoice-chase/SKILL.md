---
name: invoice-chase
description: "Overdue invoice chasing with AR aging report, escalation templates, and priority scoring. Triggers on: overdue, chase invoice, accounts receivable, late payment."
---

# Invoice Chase & AR Aging

## Overview

Generate an AR aging report, score overdue invoices by recovery priority, and produce an escalation sequence from friendly reminder to final demand.

## Workflow

### Step 1: Generate AR Aging Report

Collect from user:
- Outstanding invoices with: customer name, invoice number, invoice date, due date, amount due
- Any partial payments already received

Build AR aging buckets:

| Bucket | Days Outstanding | # Invoices | Total Amount |
|--------|-----------------|------------|-------------|
| Current | 0–0 (not yet due) | | |
| 1–30 | 1–30 days past due | | |
| 31–60 | 31–60 days past due | | |
| 61–90 | 61–90 days past due | | |
| 90+ | 90+ days past due | | |

Also show top 10 invoices by amount due (across all buckets).

### Step 2: Score by Priority

For each overdue invoice, calculate a priority score:

**Priority = Amount × Recovery Probability**

Recovery probability factors:
- Relationship length (longer = higher): weight 25%
- Payment history (on-time %): weight 30%
- Communication responsiveness: weight 25%
- Days outstanding (fewer = higher): weight 20%

Rate each factor 1–5, compute weighted average, then:

| Score Range | Priority | Action |
|------------|----------|--------|
| ≥ 4.0 | HIGH | Chase this week, escalate quickly |
| 2.5–3.9 | MEDIUM | Chase this week, standard sequence |
| < 2.5 | LOW | Batch follow-up, consider write-off at 120+ days |

### Step 3: Generate Reminder Sequence

For each invoice, produce a 3-step escalation sequence:

**Step 1 — Friendly Reminder** (1–15 days past due)
- Tone: warm, assumes oversight
- Content: invoice reference, amount, original due date, simple payment link or instructions
- Subject line: "Just checking in — Invoice #[X]"

**Step 2 — Firm Notice** (16–45 days past due)
- Tone: professional, clear expectation
- Content: overdue amount, days past due, new deadline (7 business days), late fee notice if applicable
- Subject line: "Follow-up required — Invoice #[X] is [Y] days overdue"

**Step 3 — Final Demand** (46+ days past due)
- Tone: firm, consequences stated
- Content: total amount due including any late fees, final deadline (5 business days), statement of next steps (move to legal collection / 申请支付令 / 民事诉讼简易程序 / suspend services)
- Subject line: "Final notice — Invoice #[X] requires immediate attention"

Provide ready-to-send email templates for each step.

### Step 4: Track and Update

Maintain a chase tracker:

| Customer | Invoice # | Amount | Days Past Due | Last Contact | Next Action | Due Date |
|----------|-----------|--------|--------------|-------------|-------------|----------|
| | | | | | | |

Update weekly. Escalate any invoice that reaches the next bucket threshold without response.

## Notes

- Never threaten legal action you cannot or will not follow through on
- Suggest offering early-pay discounts (1–2%) for invoices > 60 days overdue if cash flow is tight
- For invoices > 90 days with LOW priority, recommend evaluating write-off vs. continued pursuit
- Always log communication attempts with date and method (email, call, text)
