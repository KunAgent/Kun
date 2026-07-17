---
name: crm-hygiene
description: >-
  CRM cleanup and maintenance: dedupe contacts, update stale records, normalize deal stages, and ensure data quality.
  Triggers on: clean CRM, CRM cleanup, duplicate contacts, CRM maintenance, CRM audit.
---

# CRM Hygiene

Clean up and maintain CRM data quality: dedupe contacts, audit deal stages, update stale records, and normalize formats.

## Workflow

1. **Scan for duplicate contacts**
   - Match by: exact email, similar name + same company, same phone number
   - Categorize dupes: obvious (same email), likely (name + company match), ambiguous (similar name only)

2. **Auto-merge obvious dupes, flag ambiguous ones for review**
   - Obvious dupes: merge automatically, keeping the most complete record
   - Ambiguous dupes: present both records side-by-side for user decision
   - Merge rule: retain the record with more recent activity; combine any unique fields

3. **Audit deal stages**
   - Flag deals with no activity in 30+ days
   - Flag deals missing key fields (close date, amount, contact)
   - Identify deals in wrong stage (e.g., closed-won without signature date)

4. **Update outdated records**
   - Contacts with no touchpoint in 90+ days: mark for re-engagement
   - Companies with no active deals: flag for review
   - Stale notes or activity logs: archive

5. **Normalize data formats**
   - Phone numbers: 统一国内手机号 11 位 / 座机区号-号码格式；区分国际号码加 +86
   - Email addresses: lowercase, trim whitespace
   - Company names: 统一大小写，去掉公司性质后缀（"有限公司"/"股份有限公司"/"合伙企业"/"个体工商户"/Co., Ltd.）做匹配，但保留原始名称字段
   - Deal amounts: 统一为人民币（¥），外币明确标注币种和汇率口径
   - 微信/企微 ID：去重时把"微信号"作为关键字段比对（同一客户可能有多个手机号但微信号唯一）

6. **Generate cleanup report**
   - Duplicates found / merged / flagged
   - Stale records identified
   - Data quality score (before and after)
   - Ongoing maintenance recommendations

## Output Format

```
## CRM Cleanup Report
- Date: ...
- Contacts scanned: [count]

## Duplicates
- Obvious (auto-merged): [count]
- Likely (merged): [count]
- Ambiguous (flagged for review): [count] — see list below

## Deal Stage Issues
- Stale deals (30+ days no activity): [count]
- Missing key fields: [count]
- Wrong stage: [count]

## Stale Records
- Dormant contacts (90+ days): [count]
- Inactive companies: [count]

## Actions Taken
1. Merged [X] duplicate contacts
2. Normalized [X] records
3. Flagged [X] for manual review

## Data Quality Score
- Before: [score]/100
- After: [score]/100
```
