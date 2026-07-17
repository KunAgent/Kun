---
name: complaint-handling
description: >-
  End-to-end complaint handling: analyze context, draft response, determine resolution, and update CRM.
  Triggers on: reply to customer, ticket response, customer complaint, handle ticket, handle complaint.
---

# Complaint Handling

Analyze customer complaints, draft empathetic responses, determine resolution paths, and update CRM records.

## Workflow

1. **Analyze complaint context**
   - Customer history: past tickets, account age, lifetime value
   - Issue type: product defect, service failure, billing error, delivery issue, other
   - Severity: critical (churn risk / legal), high (revenue impact), medium (satisfaction), low (minor inconvenience)

2. **Draft response**
   - Acknowledge the issue and customer's frustration
   - Explain what happened (without defensiveness)
   - State the resolution clearly
   - Set expectations for follow-up if needed
   - Keep tone empathetic and solution-oriented

3. **Determine resolution**
   - **Refund**: Full or partial, when product/service clearly failed
   - **Credit**: Account credit for billing errors or service disruptions
   - **Fix**: Technical fix with timeline, when issue is resolvable
   - **Explanation**: When the complaint is based on misunderstanding, explain clearly

4. **If refund needed**: Trigger approval workflow. Document the amount, reason, and customer impact. Escalate if above authorization threshold.

5. **Update CRM** with outcome:
   - Complaint category and severity
   - Resolution type and details
   - Customer satisfaction follow-up date

6. **Flag systemic issues** — If the same complaint type appears 3+ times, flag it as a systemic issue requiring process or product improvement.

## Output Format

```
## Complaint Analysis
- Customer: [name / account]
- Issue: [summary]
- Severity: [critical / high / medium / low]
- History: [relevant past interactions]

## Draft Response
[ready-to-send reply]

## Resolution
- Type: [refund / credit / fix / explanation]
- Details: ...
- Approval needed: [yes/no, amount]

## CRM Update
- Status: [resolved / pending approval / escalated]
- Follow-up date: ...
- Systemic flag: [yes/no]
```
