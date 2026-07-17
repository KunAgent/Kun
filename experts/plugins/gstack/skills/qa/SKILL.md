---
name: qa
description: |
  Systematic QA testing with test-fix-verify loop. Three tiers: Quick, Standard, Exhaustive. Includes issue taxonomy and report templates.
  Triggers: QA test, test the app, find bugs, smoke test, regression test.
---

# QA Test → Fix → Verify

Systematically test a web application, find bugs, fix them with atomic commits, and re-verify.

## Modes

| Mode | Description |
|------|------------|
| Quick | 30-second smoke test |
| Standard | Systematic exploration, 5-10 issues |
| Exhaustive | Deep testing, comprehensive coverage |
| Regression | Compare against baseline |
| Diff-aware | Auto-detect affected pages from branch diff |

## Resources

- **Issue Taxonomy**: `references/issue-taxonomy.md` — classification of bug types
- **Report Template**: `templates/qa-report-template.md` — structured QA report format

## Workflow

1. **Initialize**: Parse URL, tier, mode, scope
2. **Authenticate**: Handle login/auth if needed
3. **Orient**: Map the application, detect framework
4. **Explore**: Per-page checklist — visual scan, interactive elements, forms, navigation, states, console, responsiveness
5. **Document**: Two evidence tiers — interactive bugs vs static bugs
6. **Triage**: Sort by severity, decide which to fix based on tier
7. **Fix Loop**: Locate source → minimal fix → one commit per fix → re-test → classify
8. **Final QA**: Re-run QA, compute final health score
9. **Report**: Structured report with health score, top issues, console health

## Output

- Health score (0-100)
- Issue list with severity, repro steps, evidence
- Before/after comparison
- Ship-readiness assessment
