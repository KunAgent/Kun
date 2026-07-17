---
name: enterprise-legal-workflows
description: Consolidated workflow layer copied and merged from commercial-legal, corporate-legal, employment-legal, privacy-legal, product-legal, regulatory-legal, ai-governance-legal, and ip-legal. Use this skill as the exposed entry point while preserving detailed source workflows under references/source-workflows.
---

# Enterprise Legal Workflows

This skill is a merged entry point. The porting method is copy → merge → modify → optimize:

1. Source README / practice profile / SKILL.md / agent markdown files were copied into `references/source-workflows/`.
2. Hook and slash-command behavior was removed because this marketplace uses experts, agents, and skills.
3. The exposed skill below consolidates the copied source workflows into a smaller routing surface.
4. Local adaptation should be done cautiously through jurisdiction notes, not by replacing the source workflow wholesale.

## Copied source materials

See `references/source-workflows/` in this plugin for the debranded source workflow text used during consolidation.

## Consolidated behavior

## Source capability groups

1. Commercial legal: contract review, NDA review, SaaS MSA review, renewal tracking, escalation flagging, stakeholder summaries.
2. Corporate legal: M&A diligence, tabular issue extraction, material contract schedules, closing checklists, board minutes, written consents.
3. Employment legal: hiring review, termination review, employment relationship review, working-time and compensation QA, internal investigations, leave and handbook tracking.
4. Privacy legal: use-case triage, PIA generation, DPA review, personal information rights request response, policy monitoring, regulatory gap analysis.
5. Product legal: launch review, marketing claims review, feature risk assessment, quick issue triage.
6. Regulatory legal: feed watching, policy diffing, gap surfacing, policy redraft, regulatory deadline tracking.
7. AI governance legal: AI inventory, use-case triage, AI impact assessment, vendor AI review, AI policy starter, AI regulatory gaps.
8. IP legal: trademark clearance, FTO triage, invention intake, IP clause review, OSS review, infringement triage, cease-and-desist and takedown drafts.

## Operating rule

For any non-trivial request, route to the corresponding team member instead of answering as a generic legal assistant. Outputs are lawyer-review drafts, not legal advice.
## Working across jurisdictions

Use the source workflow as the operating skeleton, but read the matter through the jurisdiction the user is actually working in. If the facts point to China or another non-US setting, first anchor the analysis in the applicable law, regulator, industry, contract language, and document purpose. Keep the familiar review flow, while translating only the parts that are jurisdiction-shaped: legal labels, deadlines, regulator references, employment classifications, data-protection vocabulary, and court or filing procedures.

When the local rule is not in the provided materials or a current source you can inspect, say so naturally in the analysis and treat it as something for counsel to verify. The goal is a localized draft that still feels like the original workflow, not a new legal product rebuilt from scratch.


## Legal-output boundary

Outputs are lawyer-review drafts, not legal advice. Mark assumptions, sources, and attorney-review points.
