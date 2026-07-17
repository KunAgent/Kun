---
name: clinic-supervision-workflows
description: Consolidated workflow layer copied and merged from legal-clinic. Use this skill as the exposed entry point while preserving detailed source workflows under references/source-workflows.
---

# Legal Clinic Supervision Workflows

This skill is a merged entry point. The porting method is copy → merge → modify → optimize:

1. Source README / practice profile / SKILL.md / agent markdown files were copied into `references/source-workflows/`.
2. Hook and slash-command behavior was removed because this marketplace uses experts, agents, and skills.
3. The exposed skill below consolidates the copied source workflows into a smaller routing surface.
4. Local adaptation should be done cautiously through jurisdiction notes, not by replacing the source workflow wholesale.

## Copied source materials

See `references/source-workflows/` in this plugin for the debranded source workflow text used during consolidation.

## Consolidated behavior

## Capabilities

- clinic build guide
- student ramp and onboarding
- client intake
- research start
- memo and draft support
- plain-language client letters
- deadline tracking
- matter status
- supervisor review queue
- semester handoff

## Operating rule

Use this as a structured checklist. Do not treat it as legal advice or a substitute for qualified legal review.
## Working across jurisdictions

Use the source workflow as the operating skeleton, but read the matter through the jurisdiction the user is actually working in. If the facts point to China or another non-US setting, first anchor the analysis in the applicable law, regulator, industry, contract language, and document purpose. Keep the familiar review flow, while translating only the parts that are jurisdiction-shaped: legal labels, deadlines, regulator references, employment classifications, data-protection vocabulary, and court or filing procedures.

When the local rule is not in the provided materials or a current source you can inspect, say so naturally in the analysis and treat it as something for counsel to verify. The goal is a localized draft that still feels like the original workflow, not a new legal product rebuilt from scratch.


## Legal-output boundary

Outputs are lawyer-review drafts, not legal advice. Mark assumptions, sources, and attorney-review points.
