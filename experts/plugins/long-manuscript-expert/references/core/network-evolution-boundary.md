# Network Evolution Boundary

Use this reference when the expert needs to decide whether a task should stay
offline-first, add network help after first value, or require external
verification before a stronger claim can be made.

## The three evidence modes

1. `offline_required`
   The expert must deliver first value from user materials and current dialogue
   only. Network access is not required for manuscript progress.
2. `network_optional_after_first_value`
   The expert should still deliver first value first, then offer a research or
   verification branch that can improve evidence density, examples, or current
   context.
3. `network_required_for_claim_upgrade_only`
   The expert may still draft or restructure offline, but it must not upgrade
   key claims to "verified", "current", "publishable", or equivalent labels
   until external verification is completed.

## Default mapping

- Usually `offline_required`:
  - `novel_fiction`
  - `exam_essay`
  - `generic_longform` planning
  - `continue_chapter`
  - `revise_structure`
  - `de_ai_polish`
  - `format_export`
  - `organize_materials`
- Usually `network_optional_after_first_value`:
  - `manual_handbook`
  - `social_content_article`
  - `commercial_marketing_copy`
  - `repurpose_channels`
  - `distribution_plan`
  - `visual_brief`
- Usually `network_required_for_claim_upgrade_only`:
  - `academic_monograph`
  - `whitepaper_report`
  - `official_document`
  - any task asking for current regulations, current market facts, citations,
    named external examples, or country-specific localization facts

## Hard rules

- Do not replace a usable first-value manuscript bundle with a research plan.
- If the user explicitly forbids tools, files, or browsing, remain offline and
  downgrade fact status instead of faking certainty.
- If external verification is blocked, separate draftable content from
  externally blocked claims.
- `hostActionEnvelope` and `serviceCoordinationHints` remain metadata/debug
  surfaces. They are not user-visible proof that research or service tools
  actually ran.

## Claim handling when network is missing

When a task would benefit from external verification but network help is not
available, downgrade assertions into one of these states:

- `observed`
- `inferred`
- `unverified`
- `blocked_external`
- `preserve-as-thesis`

Do not mix these states inside one claim row. Strategic direction may remain a
thesis even when facts are still unverified.

## Dual-host boundary

- WorkBuddy and WorkBuddyAI share the same expert package, but they do not
  share runtime truth.
- User language still overrides host defaults. A Chinese prompt on
  WorkBuddyAI stays Chinese even if research is enabled.
- Host label, host namespace, official-entry proof, and service-side natural
  rows remain separate evidence layers.
- A network-enhanced answer must still say whether its evidence came from user
  material, current dialogue, or external sources.

## Minimum evolution loop

Treat template evolution as a gated loop:

1. Capture representative scenarios and negative cases.
2. Evaluate whether the current blueprint failed in routing, evidence mode, or
   continuation quality.
3. Upgrade the smallest asset possible: a template module, a blueprint, a
   claim rule, or a fixture.
4. Re-run offline-first rehearsal before accepting the upgrade.
5. Roll back by asset when any of these regress:
   - no-connector first value
   - exact host self-report
   - user-visible metadata leakage
   - evidence-mode confusion
   - same-binding service attribution boundaries

## What this file does not prove

- It does not prove official listing approval.
- It does not prove service-side closure.
- It does not make network access mandatory for ordinary manuscript work.
