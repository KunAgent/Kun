---
name: customer-insights
description: >-
  Customer feedback aggregation and health check. Collect feedback across channels, identify recurring themes and sentiment trends,
  score customer health, and recommend actions. Triggers on: customer feedback, customer sentiment, pulse check, customer health,
  what are customers saying.
---

# Customer Insights

Collect and analyze customer feedback across channels to identify themes, sentiment trends, and churn risk.

## Workflow

1. **Collect feedback from all channels** — Email, support tickets, reviews, social media mentions. Ask the user to paste or upload if no system integration is available.

2. **Categorize by theme and sentiment** — Group feedback into themes (product, service, pricing, onboarding, etc.). Tag each item as positive, neutral, or negative sentiment.

3. **Score customer health** — For each customer segment or key account:
   - Retention risk (high / medium / low)
   - Satisfaction trend (improving / stable / declining)
   - Engagement level (active / moderate / dormant)

4. **Identify top 3 themes and trends** — Rank themes by volume and severity. Highlight any emerging issues or positive shifts.

5. **Recommend actions per theme** — For each top theme, provide:
   - Summary of what customers are saying
   - Root cause hypothesis
   - Specific action items with urgency
   - Template response for proactive outreach if applicable

## Output Format

```
## Customer Pulse Summary
- Period: [date range]
- Total feedback items: [count]
- Sentiment split: [positive %] / [neutral %] / [negative %]

## Top 3 Themes
1. [Theme] — [volume] items, [sentiment] trend
   - Root cause: ...
   - Action: ...

## At-Risk Accounts
- [Account]: [risk level] — [reason]

## Recommended Actions
1. [Urgent] ...
2. [This week] ...
3. [Ongoing] ...
```
