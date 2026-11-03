---
name: slides
description: "Create, revise, review, and export native, editable PowerPoint decks from PPTD source in the main conversation."
---

# Kun Slides
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Build presentations yourself in this conversation. You write a PPTD deck (YAML text files) with your ordinary file tools; three deterministic tools render previews, copy images, and export a verified `.pptx`. There is no PPT sub-agent and no workflow id to carry.

## When to use
- The user wants a new presentation, a native PowerPoint file, or a rebuilt deck: use this skill.
- The user wants a small change to an existing `.pptx` (fix a typo, swap a number, reorder slides): use `office_inspect` / `office_edit` instead.
- The user explicitly asks for an HTML presentation (Presentation Studio, `.kun-ppt.html`): keep that workflow; this skill makes PPTX.

## Tools
| Tool | Use |
|---|---|
| `read` / `write` / `edit` | Author `deck.pptd` and `pages/*.page`. Edit one page at a time for changes. |
| `load_skill_asset` | Read one reference file below (paged, at most 400 lines per call; continue with `offset`). |
| `ppt_preview` | Render the deck with the built-in renderer onto the review whiteboard. Returns per-page changes, lint issues, and image asset availability. With `directions`, renders three 3-page sample decks for a style choice. |
| `ppt_import_asset` | Copy a user image or a `generate_image` result into the deck's `media/` folder; reference the returned `pptdSrc` from a page. |
| `ppt_export` | The only way to produce the `.pptx`. Validates the package and runs geometry QA. |
| `user_input` | One single-choice question for the direction choice. |
| `generate_image` | Optional supplementary pictures for image slots, only when `imageAssets` is `enabled`. |
| `delegate_task` | Optional, for decks over 15 pages: general helpers write page files in parallel. |
| `ppt_to_board` | Only when the user asks to edit the slides as shapes on the Design whiteboard. |

## Project layout
```
presentations/<slug>/
  deck.pptd            # entry: version v2, title, size [960, 540], theme, pages list
  pages/01_cover.page  # one file per slide, numbered in order
  media/               # images, only through ppt_import_asset
  directions/a|b|c/    # optional 3-page sample decks for the style choice
  .kun-ppt-review/     # owned by the tools: never edit or delete
presentations/<slug>.pptx   # export target
```
Use a short ASCII slug. All paths inside the deck are relative to the deck folder. Only local images are exported, so never reference URLs.

## References
Load only what the current step needs:
- `references/pptd/format.md` and `references/pptd/pages-and-elements.md`: read both before writing the first deck in this conversation.
- `references/pptd/shared-types.md`: colors, fonts, fills, borders, theme text styles.
- `references/pptd/charts.md`: only when a slide has a chart. `references/pptd/examples.md`: chart and animation examples.
- `references/design-policy.md`: the design baseline; read it once per deck.
- `references/categories.md`, then exactly one matching `references/categories/<scenario>.md`.
- `references/styles.md`: index of 30 named visual systems; load one `references/styles/<family>/<name>.md` when it fits a direction.
- `references/fonts.md` for font names, `references/shapes.md` for preset shape names and adjustments.

## Workflow
1. **Understand.** Read the request, attachments, and named workspace files. Settle audience, purpose, and page count. Ask at most one question, only for a fact you cannot reasonably infer; otherwise decide and state your assumptions.
2. **Plan.** Pick the scenario (one category guide). Write a slide-by-slide plan: each slide gets one reader task and one main message. Choose the theme: two font roles, a palette of at least four colors with semantic roles, a type scale, margins, and an imagery strategy.
3. **Direction (only when there is no visual basis).** Skip this when the user gave a template, brand, style reference, or existing deck, or when the change is small. Otherwise write three materially different sample decks under `directions/a`, `directions/b`, `directions/c`. Each has exactly three 16:9 pages: the cover, a representative content page, and the most complex page, filled with real content from the plan. Vary fonts, palette, layout grammar, and imagery; name at least four theme colors and the fonts in `theme.textStyles`. Then call `ppt_preview` with `deck` set to the main deck folder and `directions` listing all three (exactly one `recommended`). Ask `user_input` with one single-choice question: options `1. <name>`, `2. <name>`, `3. <name>` in the same order, the recommended one marked, each rationale as the description. Wait for the answer; a direction card the user picks on the whiteboard arrives as attached `ppt-direction` context with the chosen `directionId` from the `ppt_preview` result.
4. **Build.** Write `deck.pptd` with the chosen theme (reuse the chosen sample's theme and pages as a starting point), then every page. Fill all titles, body text, numbers, tables, charts, and diagrams as native PPTD elements. Then call `ppt_preview` on the deck.
5. **Fix lint.** `ppt_preview` returns `issues` (off-slide elements, text below the readable size, likely text overflow, stretched images, too many font families). Fix them in the page files and preview again. Two rounds at most; then mention what is left.
6. **Review.** Tell the user the previews are on the whiteboard and end your turn, unless they asked you to export without review. Feedback arrives as normal messages, often with attached `ppt-review` context naming the deck, slides, and annotations. Change only those pages, then `ppt_preview` again; only changed pages get a new revision.
7. **Export.** When the user approves (for example "export", "导出", or the card's export button), call `ppt_export` with the deck and `presentations/<slug>.pptx` (`replace: true` when overwriting your own earlier export). If it reports geometry errors, apply each `repairHint` to the named shape and export again. Use `allowQaErrors` only after two failed repair rounds, and say what remains.
8. **Deliver.** Lead with the `.pptx` path and slide count, then say where the pictures came from (your material, generated, native only) and any remaining QA warning.

## Image slots
Images are optional supplementary assets placed in planned slots, never a whole slide and never carriers of text.
1. The user's relevant material first (attachments or workspace images), imported with `ppt_import_asset`.
2. A generated picture only when `ppt_preview` reported `imageAssets: "enabled"`: `aspect_ratio` matching the slot, no text, numbers, or logos in the picture, one imagery style for the whole deck, at most one per slide and six per deck. Import it from `.kun/images/...` with `ppt_import_asset`. Do not generate images for direction samples; mark a would-be picture with a simple placeholder shape.
3. Otherwise compose the slot from native shapes, icons, and charts, or drop it. `imageAssets: "disabled"` or `"unavailable"` never blocks the deck.

## Design baseline
- One reader task and one main message per slide; split dense material instead of shrinking it.
- Body text at least 14 pt, captions and table text at least 12 pt; keep every element inside the slide with at least 40 px margins on a 960 x 540 page.
- At most two non-monospace font families; a declared type scale; one structural palette used for meaning, with readable contrast.
- No cards or rounded boxes just to manufacture hierarchy, no generic tech gradients, glow, or glassmorphism, no emoji decoration, never stretch an image (use `fit: {mode: cover}` or `{mode: contain}`).
- Never invent facts, numbers, sources, or quotes; mark missing material as a placeholder. Put the source and period beside external data.
- The user's template, brand, colors, and fonts override the category and style guides.

## Quick edits
For "change slide 3", edit only that page file (and the theme in `deck.pptd` only for deck-wide changes), then `ppt_preview`. Do not rewrite the deck or redo the direction step. If an export already exists, export again with `replace: true` when the user wants the file updated.

## Large decks
Above 15 pages, after the theme and the first three pages are final, you may `delegate_task` page batches to general helpers. Give each the deck path, the exact page files it owns, the theme summary, and the plan rows for its pages, and tell it to load the `slides` skill. Then preview, fix, and export the whole deck yourself.

## Completion
- A deck is delivered only when `ppt_export` returned `validated: true`. Never build a `.pptx` with shell scripts or other tools.
- Keep the PPTD source next to the export so later edits stay cheap.
- Never edit `.kun-ppt-review/`; the tools own it.
