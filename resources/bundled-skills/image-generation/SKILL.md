---
name: image-generation
description: "Generate or refine one image with Kun's image tool using explicit composition and authorized references."
---

# Image Generation
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Generate or refine one image with Kun's image tool using explicit composition and authorized references.

## Tool routing
| Tool or skill | Use |
|---|---|
| `generate_image` | Generate exactly one image per call. |
| `read` | Inspect authorized workspace references when needed. |

## Workflow
1. Translate the request into subject, composition, viewpoint, style, lighting, palette, text requirements, and exclusions.
2. Choose an aspect ratio that matches the destination.
3. Attach only authorized current-thread or workspace reference images.
4. Generate one image.
5. Inspect the result and refine only when necessary or requested.

## Completion gates
- Set image_size only when the user explicitly requests 1K or 2K.
- Check faces, hands, text, logos, geometry, and cropping where relevant.
- Preserve the requested identity and composition when editing from a reference.

## Boundaries
- Do not claim ownership of third-party styles, logos, or characters.
- Do not copy temporary attachments into the workspace.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
