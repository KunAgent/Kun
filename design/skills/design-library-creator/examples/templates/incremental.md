# Incremental Sub-Task Templates

> **Used by**: `workflows/expand-components.md` and `workflows/refine-library.md` when updating individual outputs.
> **For create-library**: Use `phase-3-4-component.md` compact reference template instead.
> **SSOT**: Shared component preview constraints live in `component-dispatch-rules.md`; this file only documents incremental deltas.

---

## Preview-Only Sub-Tasks

### Sub-Agent Template (adapt per page)

```
Task: Generate "{pageSlug}" preview page.
Output: preview/component-{slug}.html

⚠️ HARD RULES (embedded — do NOT skip):
  1. MUST use <link rel="stylesheet" href="../colors_and_type.css"> — NEVER inline token CSS
  2. Render exact representative variants from component evidence when present; otherwise render the compact component JSON variants
  3. ZERO placeholders — use real UI copy from provided samples
  4. Generate complete, high-quality HTML within the shared component size cap
  5. DO NOT read colors_and_type.css from file-specs/ — it does NOT exist there.
  6. ONLY use CSS variables from the AvailableCSSVariables list below — no guessing
  7. Write file to disk, then write the compact report to `ReturnReportFileAbs`. Final response: `已完成组件预览。` No verification, no read-back, no extra prose.
  8. DO NOT read any file-specs/*.md files — use this incremental delta plus `component-dispatch-rules.md` when available.

## Incremental Delta Constraints

For full HTML structure, SVG reuse, CSS variable safety, and compact file-size rules, use `component-dispatch-rules.md` as the SSOT. The notes below only override input shape for incremental routes.

### CSS Linking
<link rel="stylesheet" href="../colors_and_type.css">
- ALWAYS use external stylesheet link — NEVER inline the CSS tokens
- Path is always relative: ../colors_and_type.css
- Additional page-specific styles may be in a <style> tag

#### Semantic Alias Source

Use `AvailableCSSVariables` as the authoritative list. If that list is missing, extract variables from `colors_and_type.css`; do not copy alias tables from specs.

Required baseline variables for this template:
`--color-surface`, `--color-on-surface`, `--color-on-surface-variant`, `--color-outline-variant`, `--radius-md`, `--space-4`, `--font-sans`.
If any baseline variable is missing, use an available listed alternative or return a warning. Never invent variables or add hex fallbacks.

### HTML Template

> ⚠️ SYNC: body padding and structure must match `file-specs/preview-pages.md` Layout Structure.

<!DOCTYPE html>
<html lang="{language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{ComponentName}</title>
<link rel="stylesheet" href="../colors_and_type.css">
<style>
  body { margin: 0; padding: 12px; background: var(--color-surface); font-family: var(--font-sans); color: var(--color-on-surface); }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
  .label { font-size: 10px; color: var(--color-muted-foreground); min-width: 80px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
  .divider { border: none; border-top: 1px solid var(--color-border); margin: 4px 0 10px; }
  /* Component-specific styles (compact single-line) */
</style>
</head>
<body>
  <div class="row">
    <span class="label">{VariantName}</span>
    <!-- Component instances -->
  </div>
  <hr class="divider">
  <div class="row">
    <span class="label">{VariantName}</span>
    <!-- Component instances -->
  </div>
</body>
</html>

### Page Content Rules
- Show default + disabled as static DOM; hover/focus/active via CSS pseudo-classes only
- NO page-header, NO theme-toggle, NO <script>, NO section descriptions
- Match the product's language
- Render only samples listed in the resolved ComponentContractFile. When ComponentContractKind is `evidence`, use `renderPlan.samples` and `visualSpecs` as the primary specification (legacy contractKind evidence only; v6 `renderFacts` evidence follows the consumption rules in `phase-2.5-intent-synthesis.md`). Simple component allowlist only: `button`, `input`, `checkbox`, `radio`, `switch`, `toggle`, `tag`, `badge`, `avatar`, `progress`, `spinner`, `link`; these may use `variant-gallery`. Everything else is complex by default and must stay `primary-plus-delta`. Do not infer simple/complex from variant count, node count, repeatedGroupCount, maxDepth, or scoring heuristics. When ComponentContractKind is `intent-json`, `compact-json`, or `legacy-json`, use `components/{slug}.json` as the primary component specification. Prioritize evidence fidelity and token accuracy over variant count.
- Resolution: use `_evidence` when evidence exists for Figma-derived libraries; otherwise use `components/{slug}.json` as primary. Return a low-fidelity warning only when the Library is Figma-derived or explicitly claims evidence should exist.
- Use brand-specific real content from UICopySamples
- CSS compact single-line format — one class definition per line. Target: 3-4KB, hard cap 4KB.

Input data:
  - AvailableCSSVariables: {semanticAliases from Phase 3 return — the ACTUAL variable names} (inline because expand-components has these in context; no Template Reference Pattern needed for single-dispatch)
  - ComponentContractFile: resolved by Main Agent
  - ComponentContractKind: evidence | compact-json | legacy-json | intent-json
  - Language: {language}
  - UICopySamples: {brand-specific copy samples}
  - CSSPath: "../colors_and_type.css"
  - OutputDir: {library output root path}
Report file format (`ReturnReportFileAbs`):
  - writtenFiles: ["preview/component-{slug}.html"]
  - warnings: string[]

Final response:
  已完成组件预览。
```

---

<!-- End of file -->
