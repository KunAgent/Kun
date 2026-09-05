---
name: slides
description: "Create, edit, review, and export native PowerPoint presentations through Kun's governed presentation workflow."
---

# Kun Slides
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Create, edit, review, and export native PowerPoint presentations through Kun's governed presentation workflow.

## Tool routing
| Tool or skill | Use |
|---|---|
| `ppt_agent` | Start and continue the native presentation workflow. |
| `ppt_to_board` | Place a completed direct-mode PPTD deck on the board when explicitly requested. |
| `user_input` | Collect one required direction choice during the workflow. |

## Workflow
1. Start ppt_agent with a short UI title and no rewritten presentation prompt.
2. If direction is required, ask exactly one structured single-choice question and submit the selected direction.
3. When previews are ready, pause for visual review.
4. Apply revision or retry actions on the same workflow.
5. After explicit approval, build and verify the final PPTX.

## Completion gates
- Retain childId and workflowId across every phase.
- Verify deck files and export after build.
- Respect review governance; do not bypass it with shell-generated decks.

## Boundaries
- Do not start a replacement child for feedback on an active workflow.
- Do not call ppt_to_board for an image-first review bundle.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
