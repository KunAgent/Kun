---
name: lead-management
description: >-
  Lead scoring, triage, and call list generation. Score leads by fit and intent, prioritize outreach, and generate today's call list with per-lead talking points.
  Triggers on: lead score, triage leads, call list, who should I call, prioritize prospects.
---

# Lead Management

## Overview

Score and prioritize inbound leads so you always call the right people first. This skill combines lead triage with call list generation: every lead gets a fit score, an intent score, a tier classification, and a tailored talking point — so you can pick up the phone with confidence.

## Workflow

### Step 1: Score Each Lead

For every lead, assign two scores:

| Dimension | Scale | Criteria |
|-----------|-------|----------|
| **Fit** | 0-5 | Company size match, industry alignment, budget indicators, geographic relevance |
| **Intent** | 0-5 | Recent engagement signals (email opens, page visits, form fills), timing cues (contract renewal, hiring signals), referral source strength |

Combined score = Fit + Intent (max 10).

### Step 2: Classify Tiers

| Tier | Combined Score | Action |
|------|---------------|--------|
| **Hot** | 8-10 | Call today, same-day follow-up |
| **Warm** | 5-7 | Call this week, personalized email first |
| **Nurture** | 3-4 | Add to drip sequence, monthly check-in |
| **Disqualified** | 0-2 | Remove from active pipeline, archive |

### Step 3: Merge with Follow-up Queue

- Pull existing follow-up tasks from CRM (overdue callbacks, scheduled check-ins)
- Merge with newly scored leads — follow-ups take priority within the same tier
- Flag any leads that have gone cold (no engagement > 30 days)

### Step 4: Rank by Priority

Sort the merged list by:
1. Tier (Hot > Warm > Nurture)
2. Within tier: combined score descending
3. Tie-break: recency of last engagement

### Step 5: Generate Call List

Output a structured call list:

```
## Today's Call List — [Date]

### Hot Leads (call today)
| # | Name | Company | Score | Last Touch | Talking Point |
|---|------|---------|-------|------------|---------------|
| 1 | ... | ... | 9 | 2h ago | Referenced pricing page → address cost concern |
| 2 | ... | ... | 8 | 1d ago | Referred by [X] → lead with mutual connection |

### Warm Leads (call this week)
| # | Name | Company | Score | Last Touch | Talking Point |
|---|------|---------|-------|------------|---------------|
| ... |

### Follow-ups (overdue)
| # | Name | Company | Due Date | Talking Point |
|---|------|---------|----------|---------------|
| ... |
```

## Data Requirements

- Lead list with contact info, company details, and engagement history
- CRM follow-up queue (if available)
- If data is incomplete, ask the user before proceeding — do not invent scores

## Notes

- Talking points must be specific to the lead's behavior, not generic scripts
- Always include the "why" behind each tier assignment
- If no leads qualify as Hot, say so explicitly rather than inflating scores
