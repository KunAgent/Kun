# Component Dispatch Rules (Shared Constraints)

> **Purpose**: Single source of truth for ALL component sub-agent constraints.
> Sub-agents Read this file once at task start. Main Agent does NOT inline these rules in the Task query.
> Runtime fast path: Phase 3 component Task queries inline the compact PreviewContract and should NOT require reading this file. Read this file only when the Task query explicitly says `RulesFileRequired: true`.

---

## ⚠️ HARD RULES (18 rules — violating ANY = failed output)

1. MUST Write preview file to disk: `preview/component-{slug}.html`
2. Preview: MUST use `<link rel="stylesheet" href="../colors_and_type.css">` — NEVER inline token CSS
3. Preview: ONLY use CSS variables declared in `colors_and_type.css` — no guessing
4. FORBIDDEN: `var(--xxx, #hex-fallback)` pattern. If a variable is NOT declared in `colors_and_type.css`, DO NOT invent it — use an available alternative. Every hex fallback is a hallucination signal.
5. Preview: use scenario/information architecture instead of raw sample rows. Simple components should prefer 2-4 semantic scenario rows; complex components should prefer 1-2 main scenes with meaningful deltas. Every instance MUST accurately apply CSS tokens (radius, shadow, color, spacing). Information clarity > raw sample count.
6. Preview: ZERO scaffolding — NO page-header, NO theme-toggle, NO `<script>`, NO section descriptions, NO global CSS reset, NO `inline style=""` for state simulation. Body starts directly with component rows.
7. Preview: CSS SHOULD use compact single-line format where readability permits. Keep files concise, but do not collapse distinct scenarios into one generic rail just to reduce size.
8. ALL copy in product's language — ZERO placeholders ("Component A", "Card Title", "TODO" are forbidden)
9. Write file to disk, then write the compact report to `ReturnReportFileAbs`. Final response: `已完成组件预览。` No verification, no read-back, no extra prose.
10. DO NOT read any `file-specs/*.md` files — all constraints are in THIS file.
11. DO NOT explore the output directory — no LS, no Read of existing files. Assume all directories exist. Write directly.
12. ICON STRATEGY: Use `<img src="../assets/icons/{name}.svg" width="24" height="24">` only for names listed in `usedIcons.bundle` / confirmed exported icons. If no exported SVG exists for an evidenced icon concept, use Lucide CDN when available. Never use Unicode glyphs as icon substitutes, never invent icons for segments/buttons whose own evidence has no icon part, and never embed raw SVG `<path>` data or define `<symbol>` blocks.
13. **NEVER invoke the `Skill` tool** — all needed constraints are in THIS file + your Task query inputs. Calling Skill wastes an entire LLM roundtrip for information you already have.
14. FORBIDDEN: converting scale names to Tailwind/Material steps (`50/100/600/700`) unless those exact variable names appear in `cssVariables[]`.
15. FORBIDDEN: shorthand aliases such as `--surface`, `--rule`, `--error`, `--color-danger` unless they appear exactly in `cssVariables[]`.
16. Before writing, scan your generated HTML string for every `var(--name)`; every `name` MUST be in `cssVariables[]`. If not, replace it with an allowed semantic variable before Write.
17. LAYOUT SAFETY: (a) All interactive controls (checkbox, radio, toggle, button-icon) MUST have `flex-shrink: 0`. (b) Composite components (table, form, tree, list, menu) MUST have `width: 100%` and occupy a `.row` alone. (c) NEVER use `position: absolute` on direct `.row` children. (d) Multiple component instances in one `.row` each MUST have `flex-shrink: 0` — NEVER allow flex compression to overlap sibling instances.
18. SEGMENTED GROUPS: For grouped/segmented controls, render one shared row/group with evidenced zero or negative gap and shared borders. Only first/last segments get outer corner radii; middle segments have square internal corners. Do not render each segment as a standalone rounded button, and do not add arrows/icons unless each segment's own evidence contains that icon slot.

---

## Output Budget

Keep the preview HTML compact and focused. Spend tokens on scenario structure and evidence-backed deltas, not scaffolding.

ZERO reasoning text outside the compact return contract. Write the preview file directly.

---

## Preview Page Template

> ⚠️ SYNC: body padding and structure must match `file-specs/preview-pages.md` Layout Structure.

```html
<!DOCTYPE html>
<html lang="{language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{ComponentName}</title>
<link rel="stylesheet" href="../colors_and_type.css">
<style>
  body { margin: 0; padding: 12px; background: var(--color-surface); font-family: var(--font-sans); color: var(--color-on-surface); box-sizing: border-box; }
  *, *::before, *::after { box-sizing: inherit; }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
  .label { font-size: 10px; color: var(--color-muted-foreground); min-width: 80px; max-width: 100px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; }
  .divider { border: none; border-top: 1px solid var(--color-border); margin: 4px 0 10px; }
  /* Component-specific styles (compact single-line) */
</style>
</head>
<body>
  <div class="row">
    <span class="label">{VariantName}</span>
    <!-- Component instances side by side -->
  </div>
  <hr class="divider">
  <div class="row">
    <span class="label">{VariantName}</span>
    <!-- Component instances -->
  </div>
</body>
</html>
```

### Preview Content Rules
- Show default + disabled as static DOM; hover/focus/active via CSS pseudo-classes only
- Match the product's language
- Render scenario rows or main scenes from ComponentVariants data. Prioritize token accuracy and information structure over variant coverage.
- Use brand-specific real content from UICopySamples
- CSS compact single-line format — one class definition per line
- NO page-header, NO theme-toggle, NO `<script>`, NO section descriptions

### CSS Variable Usage
- ONLY use variables declared in `colors_and_type.css`. Treat extracted custom property names as an exact allowlist without `--`.
- Common safe baseline: `--color-surface`, `--color-background`, `--color-on-surface`, `--color-muted-foreground`, `--color-border`, `--color-rule`, `--accent`, `--radius-md`, `--space-4`, `--space-8`, `--shadow-sm`, `--font-sans`
- NEVER use brand-prefixed tokens directly (e.g., `--slds-neutral-0`)
- NEVER add hex fallbacks

### Semantic Variable Decision Table
| Intent | Prefer these exact variables when present | Forbidden unless exact variable exists |
|--------|-------------------------------------------|----------------------------------------|
| Primary/default action | `--color-primary`, `--accent`, primary scale names from `cssVariables[]` | `--color-primary-600`, `--color-primary-700` |
| Danger/error | `--color-destructive`, `--color-error` | `--color-danger`, `--color-danger-600` |
| Surface/background | `--color-surface`, `--color-background`, `--color-card` | `--surface`, `--surface-dim` |
| Border/rule | `--color-border`, `--color-rule` | `--rule`, `--outline` |
| Text/subtle text | `--color-on-surface`, `--color-foreground`, `--color-muted-foreground` | `--text`, `--on-surface-variant` |
| Shadows | exact `--shadow-*` names from `cssVariables[]` | `--shadow-1`, `--shadow-3` unless present |

### Recommended Preview Baseline

If `colors_and_type.css` declares the following custom properties, prefer them for semantic clarity:
`--color-surface`, `--color-on-surface`, `--color-muted-foreground`, `--color-border`, `--accent`, `--radius-md`, `--space-4`, `--space-8`, `--shadow-sm`, `--font-sans`.

**Graceful degradation**: If any baseline variable is missing from cssVariables[], substitute with the closest semantic equivalent found in the available list. Return a `warnings[]` entry listing each substitution (`"substituted --accent → --color-primary"`). Do NOT STOP, do NOT invent hex fallbacks.

### Icon Assets
- Pre-exported icons are at `../assets/icons/{name}.svg`, but only names in `usedIcons.bundle` / exported icon lists are valid local paths.
- Fall back to Lucide CDN for icons NOT in the exported set. Never use glyphs, Unicode arrows, or text symbols as icon substitutes.
- Avatar or leading media slots may use Lucide `circle-user-round` or `user` when no local asset exists; do not render empty CSS circles for evidenced avatar/icon slots.

---

## Execution Flow (Sub-Agent)

1. Read `colors_and_type.css` from disk → extract declared custom properties with regex `--([A-Za-z0-9_-]+)\s*:`
2. Read `ComponentDataFile` from disk → entire file is this component's data (no need to locate by slug)
3. Generate preview HTML using scenario rows for simple components or 1-2 main scenes for complex components.
4. Self-scan generated HTML string: every `var(--name)` must be present in `cssVariables[]`; fix mismatches before writing
5. Write file to disk
6. Write `{ "writtenFiles": ["preview/component-{slug}.html"], "warnings": [], "undefinedCssVars": 0 }` to `ReturnReportFileAbs`
7. Final response: `已完成组件预览。`
8. **STOP** — no verification, no read-back, no extra prose
