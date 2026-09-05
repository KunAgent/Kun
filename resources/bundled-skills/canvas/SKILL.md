---
name: canvas
description: "Create and edit Kun Design screens, editable shapes, diagrams, design systems, layouts, and motion."
---

# Kun Canvas
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Create and edit Kun Design screens, editable shapes, diagrams, design systems, layouts, and motion.

## Tool routing
| Tool or skill | Use |
|---|---|
| `design_create_screen` | Create frames or screens. |
| `design_update_shapes` | Add or update editable shapes. |
| `design_arrange` | Align, distribute, grid, stack, or reflow. |
| `design_create_diagram` | Create an HTML-first complex diagram on Design canvas. |
| `design_system` | Create, apply, or validate DESIGN.md. |
| `design_validate` | Run design validation. |
| `design_motion_apply_preset` | Apply editable motion presets. |

## Workflow
1. Inspect the active canvas snapshot and occupied bounds.
2. Choose editable shapes for structure and HTML-first diagrams for complex explanatory layouts.
3. Use existing ids for updates and preserve unrelated content.
4. Apply arrangement or responsive reflow deliberately.
5. Validate the resulting design.

## Completion gates
- Never place new content over unrelated objects.
- Use full fill and stroke objects for vector styling.
- Use current frame and shape ids for motion.

## Boundaries
- Do not use canvas tools outside a canvas turn.
- Do not replace editable architecture diagrams with raster image generation.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
