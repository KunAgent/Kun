# Customize Design Tokens

> [Note] **Core Principle: Update CSS and re-apply to existing pages.** When the user asks to "modify the theme", "change the color scheme", "adjust fonts", "explore a new style", etc., implement by **modifying the brand CSS file (`colors_and_type.css`) and re-running `fill-html-head.mjs --replace-head`** on all existing pages. This updates the visual appearance in-place without creating new nodes on the canvas.
>
> [FORBIDDEN] **Must not create new theme nodes or `.theme` files.** Theme nodes are no longer generated — the canvas only shows page nodes. Do not create new groups or duplicate pages for theme exploration.
>
> [FORBIDDEN] **Must not rewrite HTML.** When customizing theme tokens, the page HTML structure, layout, copy, images, and interactions **must be fully preserved** — only replace theme values in `<style id="theme-vars">` (CSS variables, @theme inline bridge, shadow presets) and the `class` attribute on the `<html>` tag (light/dark toggle). **Absolutely forbidden** to regenerate or rewrite page HTML content.
>
> **Key Distinction from "Explore Variants"**: Customize theme (this workflow) updates the brand CSS and re-applies to all existing pages in-place; explore variants (`generate-variants.md`) only generates layout/structure alternatives for a specified single page, without touching theme CSS or other pages.

| Section | Description | User-facing Title |
|---------|-------------|-------------------|
| Step 1 — Main Agent Analysis | Read existing files, understand current design constraints | Analyzing current design style |
| Step 2 — Update brand CSS source | Modify `colors_and_type.css` based on user requirements | Applying new design style |
| Step 3 — Batch re-apply theme to all pages (script-driven) | Run `fill-html-head.mjs --replace-head` on all existing pages | Updating pages with new style |
| Step 3.5 — Image theme compatibility check & update (Main Agent, as needed) | Evaluate whether images are compatible with new theme tone, regenerate and update image references as needed | Updating images to match new style |
| Step 4 — One-pass Complete Validation (Main Agent) | Blocking validation before preview — run `scan-design-directory.mjs` | (Silent background, not displayed) |
| Step 5 — Guide Preview | Guide user to view updated design | Done, ready to preview |

> **User-facing Title**: When the Agent displays this step in TodoList or progress messages, it **must use the expression from this column**. Using the internal section names on the left is [FORBIDDEN]. Full rules in `operation-policies/user-facing-language.md` "Language Constraints for Task Planning and Progress Display".

## Step 1 — Main Agent Analysis

1. Read existing `.design` file — get the list of all page nodes (id, title, htmlSrc)
2. Read brand CSS file — understand the current design constraints and variable values
3. Collect the list of all page HTML files that will be updated
4. Understand user's modification requirements (color changes, font changes, border radius, etc.)
   - **Style Discovery**: If the request is vague (e.g., "make it more modern"), use **AskUserQuestion** to narrow down creative direction (tone adjectives, reference sites, color preference) before proceeding.

## Step 2 — Update brand CSS source (Main Agent direct execution)

**This step is executed directly by the Main Agent** — editing one CSS file does not warrant a Sub-Agent dispatch. Modify the existing brand CSS file (`colors_and_type.css`) based on the user's requested modifications.

### Custom Font Protection

When modifying `colors_and_type.css`:
- If the CSS contains existing `@font-face` declarations (injected by frontend for custom fonts), **preserve them unchanged**
- `@import url(...)` for Google Fonts at the top of the file must be preserved unless the user explicitly requests font removal
- Do NOT manually add `@font-face` blocks for custom fonts — this is handled by the frontend GUI

**Inputs**:
- Existing brand CSS file content (read first — variable format and current theme values)
- Modification requirements: user's specific requirements
- Brand prefix: {prefix}

**Output**: `{cssFilePath}` (updated brand CSS file, consumed by `fill-html-head.mjs`)

**Constraints**:
- Preserve all variables from the original that the user did not request to modify
- New/modified variable values must maintain both light and dark mode definitions if they existed previously
- Variable prefix must remain consistent with the brand prefix
- [FORBIDDEN] Creating new `.theme` files or theme nodes

## Step 3 — Batch re-apply theme to all pages (script-driven, no sub-tasks needed)

This step is **executed directly by the Main Agent**, utilizing `fill-html-head.mjs --replace-head` mode to batch-complete theme replacement for all pages, **without dispatching any sub-tasks**.

Use the `--replace-head` mode of `fill-html-head.mjs` to replace `<head>` and `<html class>` attributes for all pages in one pass:

```bash
node {SKILL_DIR}/script/fill-html-head.mjs \
  {cssFilePath} \
  {designProjectPath}/pages/{page-1}.html \
  {designProjectPath}/pages/{page-2}.html \
  ... \
  --replace-head
```

> **Batch execution for large projects (> 8 pages)**: If the project contains more than 8 HTML page files,
> split the `--replace-head` invocations into batches of at most 8 files each. Execute batches sequentially
> (order does not matter). This prevents shell argument length overflow on certain platforms.

The script will do the following for each HTML file:
1. Rebuild `<head>` with updated brand CSS variables (including CSS variables, @theme inline bridge, shadow presets, Google Fonts)
2. Preserve original `<title>` and `<body>` content unchanged
3. Update `<html>` tag's `class` attribute (light/dark)

> **[FORBIDDEN]** Throughout the entire process, rewriting HTML `<body>` content is forbidden. Page structure, layout, copy, interactions, and style classes all remain unchanged.
>
> **Only exception**: In Step 3.5, after determining images are incompatible with the new theme tone, only updating the `src` attribute path of corresponding `<img>` tags is permitted — no other modifications allowed.

## Step 3.5 — Image Theme Compatibility Check & Update (Main Agent, as needed)

> **This step is conditionally executed.** Only needed when theme tone changes significantly; if the theme change only involves minor color adjustments (e.g., brand color fine-tuning), skip this step and proceed directly to Step 4.

### 3.5.1 Trigger Determination

Execute this step when any of the following dimensions changes significantly:

| Dimension | Determination Criteria |
|-----------|----------------------|
| Color temperature | Original theme is warm-toned (red/orange/yellow/brown series), new theme is cool-toned (blue/cyan/gray/green series), or vice versa |
| Light/dark mode | `light` switches to `dark`, or `dark` switches to `light` |
| Emotional tone | Original theme emotion has significant contrast with new theme emotion (lively vs. reserved, natural vs. technological, etc.) |

**Decidable trigger rule** — Trigger when: primary hue shifts > 90°, or light/dark mode flips, or warm(0-60°/300-360°)↔cool(120-270°) family switch. Do not trigger for hue adjustments within ±30°.

If none of the three dimensions have significant changes, skip Step 3.5 and proceed directly to Step 4.

### 3.5.2 Image Compatibility Assessment

1. Scan all page HTML files, extract all `<img>` tag `src` attribute paths, deduplicate and consolidate into an image inventory
2. For each image in the inventory, infer its color temperature and emotional attributes based on **original generation prompt or filename semantics** (not pixel analysis). If no generation prompt record exists and the filename has no semantic meaning, conservatively keep the original image.
3. Compare against new theme tone, evaluate each image:

| Assessment Result | Action |
|------------------|--------|
| Compatible with new theme (color temperature/emotion consistent) | Keep original path, no regeneration needed |
| Incompatible with new theme (color temperature/emotion conflict) | Mark as "pending regeneration" |

If all images are compatible, skip 3.5.3 and proceed directly to Step 4.

### 3.5.3 Execute Image Updates

For all "pending regeneration" images, process as follows:

**Generate new images in parallel (sub-tasks)**

Dispatch an independent image generation sub-task for each incompatible image. Each sub-task must:

1. Follow the Prompt construction rules in `aesthetics/index.md §5 Imagery` "Image generation prompt construction rules" section (mandatory three-part format)
2. Keep the original image description's **business scenario semantics** unchanged, adjust **color temperature/emotion** to align with the new theme
3. Strictly follow lighting description principles: use neutral vocabulary (neutral studio lighting, soft white studio light, etc.); colored lighting effects, particles, or holographic effects are forbidden
4. New file naming rule: `{original-name}-updated.{ext}` (e.g., `hero-image.jpg` → `hero-image-updated.jpg`)
5. Output to the same `assets/` directory as original
6. **[FORBIDDEN] to overwrite original files**

**Failure policy**: If an image regeneration sub-task fails, keep the original image reference, skip that image, and do not block Step 4.

**After all sub-tasks complete**, update image references in pages:

1. Only modify `<img>` tag `src` attributes in page HTML, replacing paths with new filenames
2. Nothing other than `src` attributes may be modified (`alt`, `class`, layout structure, etc. all remain unchanged)

> **Image Node Registration**: After generating new `-updated` image files, the Main Agent must register each new file as a `type: "image"` node in `.design` (per Core Invariant #6a), using the "Image Node" spec in `file-specs/design-file-structure.md` and following the same procedure pattern as `create-project.md` Step 2.5d.

## Step 4 — One-pass Complete Validation (Main Agent, Blocking — must not skip)

> **This step is blocking. Before guiding the user to preview, the Main Agent must personally execute this validation. [FORBIDDEN] to proceed to Step 5 without passing validation.**

Use `scan-design-directory.mjs` for one-pass complete validation, avoiding multiple tool calls:

```bash
node {SKILL_DIR}/script/scan-design-directory.mjs <design-project-path>
```

Where `<design-project-path>` is the design project root directory path. Since theme customization does not add or remove pages, the `--expected-pages` parameter is not needed.

When exit code is 1, follow the repair procedure in `operation-policies/design-project-validation.md`.

## Step 5 — Guide Preview (Main Agent)

Inform the user that the theme has been updated and guide them to preview the changes.

**Finish summary must not include manual links**. The `.design` artifact is exposed only through the host-rendered artifact entry; follow SKILL.md "Artifact Declaration" section.

### Guidance Content Requirements

The Agent must **clearly inform the user of the following** in the preview guidance (in natural language, without exposing technical terminology):

1. **What was changed**: Inform the user that the design style (colors, fonts, etc.) has been updated across all pages
2. **How to view**: Guide the user to open the `.design` file to preview the updated design
3. **Page content unchanged**: Explain that all page structures and content remain the same, with only the visual style updated
4. **How to iterate**: Inform the user they can request further adjustments to fine-tune the style

### Theme Change Summary Table

Output a Markdown table to the user, providing an overview of what changed:

| Dimension | Before | After | Change Description |
|-----------|--------|-------|-------------------|
| Colors | {original primary} | {new primary} | {modification content} |
| Font | {original font} | {new font} | {modification content} |
| Border Radius | {original radius} | {new radius} | {modification content} |
