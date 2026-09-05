---
name: media-video
description: "Generate a short Kun video from text or an authorized first-frame image."
---

# Video Generation
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Generate a short Kun video from text or an authorized first-frame image.

## Tool routing
| Tool or skill | Use |
|---|---|
| `generate_video` | Generate a 6- or 10-second video. |
| `generate_image` | Create a first frame when the workflow needs one and the user permits it. |
| `send_im_attachment` | Send the generated video through IM when requested. |

## Workflow
1. Define subject, action, camera movement, scene continuity, style, aspect ratio, duration, and resolution.
2. Use an authorized workspace image as first_frame_image_path when doing image-to-video.
3. Write a motion-focused prompt that preserves important identity and geometry.
4. Generate the video.
5. Inspect the returned file metadata and report the path.

## Completion gates
- Use only supported duration, resolution, and aspect-ratio values.
- Keep motion physically coherent for the short duration.
- Check that the first frame is a PNG, JPEG, or WebP workspace file.

## Boundaries
- Do not use temporary attachment files as paths without authorization.
- Do not impersonate or fabricate real events involving identifiable people.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
