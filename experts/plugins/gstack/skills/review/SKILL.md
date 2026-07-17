---
name: review
description: |
  Pre-landing PR code review with 7 specialist sub-reviewers. Analyzes diff for SQL safety, LLM trust boundary violations, conditional side effects, and structural issues.
  Triggers: code review, PR review, pre-landing review, diff review.
  Specialists: api-contract, data-migration, maintainability, performance, red-team, security, testing.
---

# PR Code Review

Pre-landing code review that analyzes the current branch's diff for structural issues that tests don't catch.

## Specialists

| Specialist | Focus | File |
|-----------|-------|------|
| api-contract | API contract review | `specialists/api-contract.md` |
| data-migration | Data migration safety | `specialists/data-migration.md` |
| maintainability | Code maintainability | `specialists/maintainability.md` |
| performance | Performance review | `specialists/performance.md` |
| red-team | Adversarial review | `specialists/red-team.md` |
| security | Security deep-dive | `specialists/security.md` |
| testing | Test coverage review | `specialists/testing.md` |

## Workflow

1. **Check branch**: Verify current branch and base branch
2. **Get the diff**: `git diff` against base branch
3. **Critical pass**: Check for CRITICAL and INFORMATIONAL issues from checklist
4. **Specialist dispatch**: Detect stack/scope from diff, select relevant specialists (adaptive gating), dispatch in parallel, collect and merge findings with fingerprint dedup
5. **Fix-first review**: Classify AUTO-FIX vs ASK items, auto-fix AUTO-FIX items, batch-ask ASK items
6. **TODOS cross-reference**: Check if findings relate to existing TODOS items
7. **Documentation staleness**: Flag any docs that may be out of date after this diff
8. **Output**: Structured review with severity, confidence, fingerprint per finding

## Output Format

Each finding includes:
- Severity: CRITICAL / WARNING / INFO
- Confidence: 0-10
- Fingerprint: unique identifier for dedup
- File and line range
- Description and recommended fix
