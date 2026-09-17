---
id: excalidraw-diagram
name: Excalidraw diagram
description: Create and iterate Excalidraw diagrams on Kun Work, Design, and Code canvases.
---

# Excalidraw diagram for Kun
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

Use this skill when the turn says the canvas engine is Excalidraw, the user asks for an Excalidraw sketch, or they invoke `/excalidraw`. If the turn is a Kun ShapeOps / HTML canvas, leave this skill unused and follow `diagram-design` instead.

## Tool routing

| Tool | Use |
|---|---|
| `write` / `edit` | Mutate the canonical `scenePath` JSON. |
| `load_skill_asset` | Load one reference at a time. |
| `design_apply_excalidraw` | Reload the open board from that file, export the PNG sidecar, and wait for the renderer receipt. |
| `Read` | Inspect the PNG sidecar after an applied receipt. |

Never call `design_update_shapes`, `design_create_screen`, `design_create_diagram`, `design_arrange`, or HTML screen tools on an Excalidraw board.

## Workflow

1. Load `references/kun-scene.md` and use the `scenePath` from the turn. Do not invent a sibling `.excalidraw` file.
2. Load `references/color-palette.md` before choosing fills or strokes.
3. Decide simple vs comprehensive. Comprehensive diagrams need research, evidence artifacts, and section-by-section writes.
4. Map each concept to a distinct visual pattern (fan-out, convergence, timeline, tree, cycle, assembly). Avoid equal card grids.
5. Load `references/element-templates.md` and `references/json-schema.md` only when writing JSON.
6. Empty board: write a complete scene. Existing user strokes: upsert by element `id`; do not replace unrelated elements unless the user asked to redraw.
7. Build large diagrams one section per edit. Use descriptive ids (`auth_box`, `arrow_to_db`) and section seed ranges (100xxx, 200xxx).
8. After each section, call `design_apply_excalidraw`. Treat `Queued` / `Accepted` as unapplied. Read the PNG sidecar only after a renderer receipt reports applied.
9. Audit the PNG: clipped text, overlaps, arrows through nodes, unbalanced whitespace. Edit JSON, apply, and re-read until the composition is showable.

## Craft

- Diagrams should argue visually. Structure must still communicate if labels were removed.
- Default to free-floating text. Add rectangles only when the shape carries meaning.
- `roughness: 0`, `opacity: 100`, `fontFamily: 3`. Element `text` holds readable words only.
- Colors come from the palette. Do not invent new hex values.

## Boundaries

- Do not use Python, Playwright, or a browser renderer. Kun exports the PNG.
- Do not emit Excalidraw JSON in assistant text.
- Do not load every reference at once.
