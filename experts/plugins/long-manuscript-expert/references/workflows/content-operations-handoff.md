# Content Operations Handoff

Use this workflow after the manuscript already has a stable chapter route,
sample opening, and a clear next drafting or finishing lane.

## When to activate

- the user wants to turn a long draft into public-channel content;
- the user asks for a publishing schedule, content summary pack, or image brief;
- the user is working inside WorkBuddy's `content-operations` project template;
- the draft is strong enough that post-draft work is now more important than raw expansion.

## Required handoff outputs

- `project_template_activation_hints`
- `content_operations_handoff`
- a recommended next branch from `repurpose_channels`, `distribution_plan`,
  `summary_pack`, or `visual_brief`

## WorkBuddy project-template mapping

- templateId: `content-operations`
- connectors: `tdocs-app`, `notion`
- adjacent experts:
  `wechat-official-account-operator`, `xiaohongshu-operator`,
  `content-creator`, `social-media-strategist`, `douyin-strategist`
- adjacent skills:
  `content-factory`, `content-distribution`, `content-summary`,
  `ai-illustration`, `de-ai-polish`

## Boundary

Project-template selection is orchestration context only. It can improve host
steering and task continuity, but it does not by itself prove official
distribution, publishing completion, user adoption, or product-credit closure.

If the host exposes service observation fields, include them in a separate
`serviceCoordinationHints` block. Do not hide them during debugging, and do not
count them as publishing completion.
