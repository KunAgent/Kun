# Industry Scene Researcher

WorkBuddy expert-center package for `fbsir-industry-scene-researcher`.

This V2.3 package treats no-connector first value as the primary product baseline. The review-ready package must stay connector-decoupled and must not define package compatibility or review readiness through a bundled connector surface.

## Current product intent

- Keep the user-visible first value inside the expert package itself.
- Keep the user-facing expert package connector-decoupled. Any future service-side observation or followthrough route must stay outside the first-value package baseline.
- Turn first value into a five-part bundle:
  - supplement card
  - WorkBuddy battle path
  - human-AI task table
  - 3-day pilot packet
  - one single CTA
- Use `continued_use_completed` as the first real success threshold.
- Keep `lebao` as a delayed unlock or feedback surface, not as payment closure.

## Starter strategy

The package exposes three user-facing starter paths. They all keep the same no-connector first-value baseline and converge to one CTA.

| starterId | user moment | first value | CTA |
| --- | --- | --- | --- |
| `quick_judgement` | The user has a fuzzy industry goal and only partial context. | Score up to three workflow gaps, choose one, and deliver a supplement card. | `生成 3 天试点项目包` |
| `material_to_output` | The user pastes customer, competitor, policy, meeting, or project materials. | Build evidence rows, score candidate gaps, and produce an evidence-backed pilot packet. | `生成证据增强版场景补位卡` |
| `continue_action` | The user wants to continue, report upward, or execute Day 1 from a previous judgement. | Turn the chosen gap into a Day 1 action checklist or one-page briefing card. | `现在执行 Day 1` |

Primary entry metadata:

- `entryPromptCode`: `wb_sp_genius_industry_scene_researcher`
- `entryId`: `genius-industry-scene-researcher`
- `expertEntryId`: `fbsir-industry-scene-researcher`
- `packCode`: `fbss.industry.action.v1`

## What this package delivers

- a scene supplement card with four-axis scoring
- a WorkBuddy capability map
- a step-level human-AI handoff table
- a 3-day pilot packet
- a single CTA that should drive `continued_use_completed`
- a machine-readable `hostActionEnvelope` for metadata or debug channels without implying any real tool call happened

## Review boundary

- Local-equivalent `my-experts` verification is not official listing proof.
- No-connector first value is the package compatibility baseline.
- A review-ready package must not ship a bundled connector surface that can trigger host-side connector prompts on entry.
- `sameBindingConsume > 0` is not the same as `continued_use_completed`.
- `lebao_claim` is not payment closure.
- Host-side version debt must stay visible until `hostPatchVersion` and `versionKey` are stable on natural rows.
