---
name: business-reporting
description: >-
  Business reporting at every cadence: one-page snapshot, Monday brief, Friday recap, and quarterly review (QBR). Triggers on: business snapshot, how's the business, monday brief, friday brief, QBR, quarterly review, week ahead.
---

# Business Reporting

## Purpose

Deliver business visibility at every cadence: real-time snapshots, weekly briefs, and quarterly reviews — so the owner always knows where things stand.

## Workflow

### One-Page Snapshot

1. Collect data: cash balance, AR/AP, sales (MTD), pipeline, open tickets/tasks
2. Calculate derived metrics:
   - Cash runway (months at current burn rate)
   - Pipeline coverage (pipeline value / quota)
   - AR aging (current / 30+ / 60+ / 90+ days)
3. Auto-flag attention items:
   - 🔴 Cash runway < 2 months
   - 🔴 AR 60+ days > 20% of total
   - 🟡 Pipeline coverage < 1.5x
   - 🟡 MTD sales trailing prior month by > 15%
   - 🟢 All metrics on track
4. Generate one-page snapshot

### Monday Brief

1. Run snapshot workflow
2. Collect calendar commitments for the week
3. Identify top 3-5 priorities (cash-first ordering)
4. Surface pending decisions needing owner input
5. Generate brief

### Friday Recap

1. Run snapshot workflow
2. Collect week activity (deals closed, invoices sent, expenses, hires)
3. Compare to Monday baseline — what moved, what didn't
4. Identify wins and gaps
5. Preview next week (carry-overs + known events)
6. Generate recap

### Quarterly Review (QBR)

1. Run snapshot workflow
2. Gather quarterly data across four dimensions:
   - Financial: revenue, expenses, margin, cash trend
   - Pipeline: new deals, win rate, average deal size
   - Customer: retention, NPS/complaints, top accounts
   - Team: headcount, open roles, capacity utilization
3. Score quarter per dimension (🔴 Below target / 🟡 Mixed / 🟢 On track)
4. Identify 2-3 strategic themes (patterns across dimensions)
5. Set 3-5 next-quarter priorities with measurable targets
6. Generate QBR document

## Output Format

### Snapshot

```
## Business Snapshot — [Date]

### Cash
| Metric | Value | Status |
|--------|-------|--------|
| Cash Balance | ¥X | 🟢 |
| Cash Runway | X months | 🟢/🟡/🔴 |
| AR Aging (60+) | ¥X (X%) | 🟢/🟡/🔴 |

### Sales
| Metric | Value | Status |
|--------|-------|--------|
| MTD Revenue | ¥X | 🟢/🟡/🔴 |
| vs Prior Month | +/-% | — |

### Pipeline
| Metric | Value | Status |
|--------|-------|--------|
| Open Pipeline | ¥X | — |
| Coverage | Xx | 🟢/🟡/🔴 |

### Attention Items
- 🔴 [Urgent item]
- 🟡 [Watch item]
```

### Monday Brief

```
## Monday Brief — [Date]

### Top Priorities
1. [Priority] — [Why it matters now]
2. ...
3. ...

### Pending Decisions
- [Decision needed] — [Deadline]

### Week Calendar
- Mon: ...
- Tue: ...
```

### Friday Recap

```
## Friday Recap — [Date]

### Wins
- ✅ [Win]

### Gaps
- ⚠️ [Gap]

### Week-over-Week Movement
| Metric | Monday | Friday | Change |
|--------|--------|--------|--------|

### Next Week Preview
- [Carry-over / known event]
```

### QBR

```
## Quarterly Review — Q[X] [Year]

### Dimension Scores
| Dimension | Score | Key Takeaway |
|-----------|-------|-------------|
| Financial | 🟢/🟡/🔴 | ... |
| Pipeline | 🟢/🟡/🔴 | ... |
| Customer | 🟢/🟡/🔴 | ... |
| Team | 🟢/🟡/🔴 | ... |

### Strategic Themes
1. [Theme] — [Evidence]

### Next Quarter Priorities
1. [Priority] — Target: [measurable goal]
2. ...
```

## Notes

- Never fabricate numbers — if data is unavailable, show "N/A" and flag what needs connecting
- Snapshot should fit on one screen / one page; keep it scannable
- Monday briefs default to cash-first priority ordering; owner can override
- QBR should take < 15 minutes to read — it's a decision document, not a data dump
