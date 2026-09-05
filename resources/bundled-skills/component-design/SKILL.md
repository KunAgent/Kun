---
name: component-design
description: "Apply a coherent visual system, responsive behavior, interaction states, and accessibility to Kun components."
---

# Component Design
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Apply a coherent visual system, responsive behavior, interaction states, and accessibility to Kun components.

## Tool routing
| Tool or skill | Use |
|---|---|
| `design_system` | Create or apply project design tokens. |
| `design_validate` | Validate design-system usage. |
| `design_component` | Publish the component prototype. |
| `generate_image` | Create a needed local visual asset. |

## Workflow
1. Define hierarchy, content density, primary action, and states.
2. Choose type, spacing, color, radius, and motion tokens before styling details.
3. Design mobile and desktop layouts intentionally.
4. Implement hover, focus, active, disabled, loading, empty, success, and error states as relevant.
5. Validate contrast, semantics, motion, and responsiveness.

## Completion gates
- Use one focal point and avoid nested-card clutter.
- Use color as reinforcement, not the only signal.
- Keep remote resource policy least-privilege.

## Boundaries
- Do not depend on undocumented host CSS or runtime globals.
- Do not hide essential text in imagery or animation.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
