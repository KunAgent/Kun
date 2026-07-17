---
name: china-litigation-toolkit
description: 中国民事/劳动争议诉前评估工具包，覆盖诉讼费估算、劳动补偿区间、起诉前成本收益判断、起诉状/答辩状/证据提纲骨架。Use for China-facing litigation intake and pre-litigation triage.
allowed-tools: Read, Bash
---

# 中国诉前评估与文书骨架

This skill imports the useful litigation-facing parts of the China legal assistant package and removes sales copy. It is designed to replace the US-procedure-heavy litigation workflows that were removed.

## Capabilities

- 民事财产案件诉讼费估算。
- 劳动争议赔偿和补偿区间初筛。
- “值不值得起诉”的收益、成本、证据、执行可能性四维判断。
- 起诉状、答辩状、证据提纲骨架生成。
- 敏感信息脱敏和律师复核触发点。

## Use with

- `scripts/calculate_lawsuit_fee.py` for quick fee estimates.
- `references/pre-litigation-decision-pack.md` for诉前决策。
- `references/document-skeletons.md` plus assets templates for文书骨架。

## Boundary

This is for first-pass triage and drafting structure. Do not promise outcomes, do not calculate beyond supplied facts, and do not treat local procedural rules as fixed without current-source verification.
