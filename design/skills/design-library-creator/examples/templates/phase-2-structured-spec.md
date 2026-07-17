# Phase 2: Structured Spec Token Transform Sub-Task Template

> **Completion contract**: The transform sub-agent MUST write `colors_and_type.css` to disk, write a compact report to `ReturnReportFileAbs` (≤ 4KB) containing token count, group list, warnings, and written files, then final-respond only `已完成 Token 转换。`.

---

## Sub-Agent Execution Constraints

These apply to the structured-spec transform sub-agent:
- Tool bans per SKILL.md invariant #16: `TodoWrite`, `Skill`, `Grep`, `RunCommand`, `SearchCodebase`.
- FORBIDDEN additionally: `LS`, `Glob` — no discovery; use only the explicit file paths.
- FORBIDDEN: reading any path not listed in the task's named input files.
- FORBIDDEN: renaming, remapping, or normalizing source token names to M3/ThemeStyleProps conventions.
- FORBIDDEN: generating color scales (50-900) that do not exist in the source document.
- FORBIDDEN: inventing token values not present in the source.
- After all required Writes, write the compact report to `ReturnReportFileAbs` and STOP. No read-back, no verification prose, no markdown tables.
- SILENT: Do NOT output intermediate reasoning, status updates, or planning text between tool calls. After all Writes are done, final response must be only `已完成 Token 转换。`.
- WRITE-FIRST (anti-overthinking): Do NOT compose the complete token structure in your
  reasoning before writing. After parsing the source, go STRAIGHT to the Write call and
  think WHILE writing — the CSS file itself is your working draft. Pre-drafting the full
  CSS in reasoning wastes tokens and adds no accuracy.
- ⚠️ DISPATCH PARAMETER: `subagent_type` MUST be `"general_purpose_task"`.

---

## structured-spec-transform

```
Task: Parse structured design specification and generate Design Library CSS token file.
Output: {output_dir}/colors_and_type.css

⛔ NO CSS IN REASONING (HARD — budget rule):
NEVER draft, rehearse, or revise CSS content inside your thinking/reasoning.
Any CSS composed in reasoning must be typed AGAIN in the Write call — it is 100% wasted
tokens and adds zero accuracy. This is a TRANSFORMATION task: read the source, then
transcribe tokens directly into the Write argument, converting values as you type.
The FIRST place any `--token: value;` line appears MUST be the Write tool call.

⚠️ HARD RULES:
  1. PRESERVE all source token names VERBATIM — never rename to --primary, --background, --surface-*, etc.
  2. Token provenance comment: /* Source: structured-spec */
  3. Preserve source tokens in the definition layer, and when aliasLayer is true generate a portable alias layer for consumers.
     Component JSON, preview pages, docs, and UI Kit MUST prefer portable aliases (`--color-*`, `--radius-*`, `--type-*`, and other file-specs/css-tokens.md consumer variables), not source-specific token names.
  4. Do NOT generate .dark {} block when themeMode === "dark-only"; add `/* @dark-only */` as the first comment in the CSS file (validator uses this marker to skip .dark check)
  5. When themeMode === "light-only", add `/* @light-only */` as the first comment in the CSS file (validator uses this marker)
  6. If source document exceeds 64KB: read with offset/limit, parse in chunks
  7. Total Read calls budget: ≤ 5
  8. Write the CSS file, then write compact report to `ReturnReportFileAbs`. No verification, no read-back.
  9. ALL color values MUST be converted to 6-digit hex (#rrggbb). If source uses oklch(), hsl(), or other color spaces, compute the equivalent sRGB hex. Preserve token NAMES verbatim, but normalize color VALUES to hex. For semi-transparent colors use rgba(r,g,b,alpha).
  10. GROUPING COMMENTS:
      The output colors_and_type.css MUST contain fine-grained CSS section comments to classify color tokens.
      - If source CSS already has grouping comments (e.g., /* bg */, /* text */, /* 碧涛青 */) → PRESERVE them verbatim.
        Do NOT merge, rename, translate, or replace source group names with generic categories.
        (e.g., /* 晚秋红 */ must NOT become /* red */ or /* autumn-red */)
      - If source CSS has NO grouping comments (typical Tailwind v4 themes) → ADD semantic grouping comments.
      - When adding comments, use names that best represent the token semantics:
        /* bg */      — background/surface/container colors
        /* text */    — foreground/text colors
        /* accent */  — primary/brand/interactive colors
        /* border */  — border/outline/divider colors
        /* status */  — error/destructive/success/warning colors
        /* chart */   — chart-* data visualization colors
        /* sidebar */ — sidebar-* scoped tokens
      - Place the comment BEFORE the group of variables it labels.
      - Every color variable MUST be under exactly one group comment.
      - Source group names (including Chinese, brand-prefixed, or custom names) always take priority
        over the generic names listed above.
  11. TOKEN COMPLETENESS — ZERO LOSS (structured-spec route ONLY):
      - Count all CSS custom property declarations in source :root and .dark blocks.
      - The output MUST contain the EXACT SAME number of declarations. No skipping, no merging, no deduplication.
      - After writing, verify: if source has N variables, output has exactly N variables.
      - If you are uncertain about a value conversion, output the ORIGINAL value — never silently drop a token.
      - Exception: if two tokens in the SAME group have identical hex values, keep the
        more semantically specific name (this is dedup, not loss).
      - Note: This rule does NOT apply to figma-token-gen (which deduplicates per Rule 22c).
  12. STRIP TAILWIND v4 BUILD DIRECTIVES:
      - Remove: @import "tailwindcss", @custom-variant, @theme inline { ... }, @layer base { ... }
      - These are Tailwind build-time directives, NOT design tokens.
      - The @theme inline block duplicates :root vars with --color-* prefix — do NOT include those duplicates.
      - Keep ONLY: :root { }, .dark { }, and typography utility classes (if any).
  13. FORBIDDEN OUTPUT FILES:
      - NEVER write `css.json` — it is derived deterministically by Main Agent via `css-to-json.mjs`
      - Your ONLY output is `{output_dir}/colors_and_type.css`
      - If you write any forbidden file, the pipeline will FAIL at Quality Gate.
  14. PORTABLE ALIAS REQUIREMENT:
      - If aliasLayer is true, append aliases inside :root/.dark in the same CSS file.
      - Aliases MUST reference existing source tokens via var(...); never invent new values.
      - Preserve source token declarations and add aliases as the unified consumption layer.
      - The resulting CSS MUST stay compatible with file-specs/css-tokens.md and css-to-json.mjs.

Note: css.json is derived DETERMINISTICALLY by Main Agent scripts
after this sub-agent returns. The CSS MUST be structured properly for script parsing (see CSS Structure Order below).

Input data:
  - Source document path: {source_path}
  - Output directory: {output_dir}
  - Library name: {library_name}
  - Theme mode: {themeMode}  (one of: "dark-only", "light-dark", "light-only")
  - Include alias layer: {aliasLayer}  (boolean, default true when components/previews/UIKit are generated)
  - Brand profile: {brandProfile}

CSS Structure Order (from file-specs/css-tokens.md):
  1. Web Font Imports (@import url(...))
  2. :root { } block — ALL tokens grouped by category:
     - Color tokens (preserve source grouping/naming)
     - Typography variables (--font-*)
     - Spacing scale (--space-*)
     - Border radius (--radius-*)
     - Shadows (--shadow-*)
     - Motion/Easing (--duration-*, --ease-*)
     - Layout (--max-content, --gutter-*, etc.)
  3. .dark { } block — ONLY if themeMode === "light-dark" (overrides for dark mode)
  4. Typography utility classes (if source defines them)

css.json Derivation Reference (Main Agent derives this via script — sub-agent does NOT write css.json):
  - color: Record<groupName, Record<tokenName, {hex, opacity}>> — flat sibling groups under "color" key
  - font: { family, size, weight, lineHeight } — each is Record<tokenName, string>; font.size in px
  - shadow: Record<tokenName, {xOffset, yOffset, blur, spread, color:{hex,opacity}}>
  - radius: Record<tokenName, string> — values in px
  - spacing: Record<tokenName, string> — spacing scale (space-*) in px
  - size: Record<tokenName, string> — component sizes only (size-*) in px; does NOT contain space-* tokens

Execution:
  1. Read {source_path} (with offset/limit if large)
  2. Parse all token definitions by category
  3. Write {output_dir}/colors_and_type.css
   4. Write compact summary report to `ReturnReportFileAbs`

  Report file format (`ReturnReportFileAbs`):
  - writtenFiles: ["{output_dir}/colors_and_type.css"]
  - summary: "{N} tokens extracted across {M} groups. Theme: {themeMode}. Groups: [color, font, spacing, ...]"
  - tokenCount: N
  - groups: string[]
  - warnings: string[]

  Final response:
    已完成 Token 转换。
```
