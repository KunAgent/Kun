---
name: skill-creator
description: "Design and write concise reusable KunAgent skills with valid triggers, real tools, and testable completion criteria."
---

# KunAgent Skill Creator
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Design and write concise reusable KunAgent skills with valid triggers, real tools, and testable completion criteria.

## Tool routing
| Tool or skill | Use |
|---|---|
| `read` | Inspect relevant existing conventions. |
| `write` | Create a new skill file. |
| `edit` | Refine an existing skill. |
| `load_skill` | Load a registered skill when its full guidance is required. |
| `load_skill_asset` | Load one declared reference or asset. |

## Workflow
1. Decide whether reusable procedural knowledge is actually needed.
2. Write a trigger-rich description that says what and when.
3. Keep the body focused on decisions, sequence, tool contracts, gates, and boundaries.
4. Move deep detail to references and deterministic work to scripts.
5. Validate metadata, references, tools, syntax, and license.

## Completion gates
- Use relative paths inside the skill.
- Do not assume capabilities that are absent from the current tool catalog.
- Keep examples free of credentials and machine-specific paths.

## Boundaries
- Do not create a skill as a substitute for a one-off answer.
- Do not include hidden prompts, proprietary text, or copied assets without rights.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
