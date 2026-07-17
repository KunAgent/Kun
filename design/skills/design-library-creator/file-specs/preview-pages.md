## Intent-Mode Fast-Path (DEFAULT for Figma bundle workflow)

When the component's intent JSON exists at `{output_dir}/components/{slug}.json` (validated by Phase 3 merged synthesis):
- **THIS FILE IS NOT READ** by the sub-agent. All rendering rules are embedded in the Phase 3 intent-mode task prompt (12 rules).
- The sub-agent reads ONLY: intent JSON + colors_and_type.css + specimen-reference.html.
- This document remains the constraint source for: create-from-scratch, expand-components, refine-library, and evidence-fallback routes.

> **Class-name convention**: Intent-mode uses `.specimen/.header/.stage/.story/.rail/.story-label` from specimen-reference.html.
> Fallback-mode (below) uses `.row/.label` for historical reasons. They are NOT interchangeable.

---

> **For Sub-Agents**: This is your PRIMARY constraint source. Follow EVERY rule below — violations cause structural failures (excessive nesting, wrapper abuse, oversized output).
> Your Task query tells you to read this file first. After reading, proceed to read data files and generate output.

# Preview HTML Pages Specification

## Overview

The `preview/` directory contains **standalone HTML pages** that visually demonstrate the design system's component patterns. Page count and content are **dynamically determined** by `uikit-plan.corePreviewComponents` when available, with Phase 1 shortlist / component index as fallback — they are NOT a fixed set.

## Page List Determination

Preview pages have a **1:1 correspondence** with core preview components:

1. Prefer `uikit-plan.corePreviewComponents` (Figma route: core target 6; non-Figma: target 6, min 4; support evidence may still be used by UIKit)
2. Fallback to the Phase 1 shortlisted component categories or `components/index.json`
3. Each core component gets exactly **1 preview page** — no grouping or merging
4. Record the final list as `outputPlan.previewPages[]`

> **1:1 Rule**: See `operation-policies/decision-rules.md` § Component Count Formula — every core preview component gets exactly 1 `preview/component-{slug}.html`. Primary structured component data is `components/_evidence/{slug}.json` when present; otherwise `components/{slug}.json` is the primary component source.

### Naming Convention

```
preview/component-{slug}.html
```

Where `{slug}` is a kebab-case descriptor matching the component group (e.g., `component-buttons.html`, `component-cards.html`, `component-navigation.html`, `component-data-display.html`).

## Per-Page Content Requirements

Each preview page must:
- Render a **representative subset** of variants across **≤2 row groups** (separated by `<hr class="divider">`)
- Show default + disabled states as DOM instances; hover/focus/active via CSS pseudo-classes only
- Use brand-specific real content (from `uiCopySamples`)
- Match the product's language
- **Prioritize token accuracy** — every rendered instance MUST correctly demonstrate CSS variable application (radius, shadow, color, spacing)

### Hover State Color Strategy (MANDATORY)

When generating `:hover` / `:active` pseudo-class styles:

**Step 1 — Classify hover target:**
- **Interactive component** (button, chip, tag, toggle, link, menu-item): → go to Step 2A
- **Container row** (table `tr`, list item, tree node, card in grid): → go to Step 2B

**Step 2A — Interactive component hover:**
1. If evidence `stateCoverage.hover.delta` exists → match its `background` value to a declared variable in `colors_and_type.css`
2. Else if `colors_and_type.css` defines `--accent-hover` → use `var(--accent-hover)`
3. Else → `filter: brightness(1.08)`

**Step 2B — Container row hover:**
1. If evidence `stateCoverage.hover.delta` exists → match its `background` value to a declared variable in `colors_and_type.css`
2. Else if `colors_and_type.css` contains `--state-hover` → use `background: var(--state-hover)`
3. Else → `filter: brightness(0.97)` (darken slightly, NOT accent color)
4. **NEVER use `--accent-hover` for container rows** — it is reserved for interactive components

**Step 3 — Hover property scope (applies to ALL types):**
- Hover ONLY changes `background` (or `border-color` if same-base evidence stateCoverage says so)
- NEVER change `color` (text color) on hover unless evidence `stateCoverage.hover.delta.color` explicitly provides the value
- NEVER add properties not present in stateCoverage (no invented shadows, transforms, or opacity)

4. NEVER pick a scale step (like primary-600 or primary-400) and assign it as "hover" without evidence backing
5. NEVER assume "lighter = hover" or "darker = hover" — different design systems use different conventions

Decision priority: same-base `stateCoverage` evidence > type-appropriate CSS variable > brightness filter > omit

### Data Content Rules (MANDATORY)

- `renderFacts.patterns`, `renderFacts.controlMatrix`, and `renderFacts.iconSlots` text are **UI element labels** (button text, tab names, field labels) — NOT arbitrary table row data or list items
- For data-heavy components (table, list, grid):
  - Use generic placeholder data: "Item 1", "Item 2", "12,480", "Active" etc.
  - Column headers MUST match `renderFacts.patterns.tablePatterns[*].columns[*].headerText` when available
  - Row count: exactly 3 rows for default state, 1 row for disabled state
- NEVER invent: status badges, action columns, expand/collapse behavior, or interactive features not present in final-state `renderFacts.controlMatrix`, `renderFacts.patterns`, `renderFacts.contentPolicy`, `renderFacts.geometry`, `renderFacts.renderObligations`, or `renderFacts.iconSlots`

### Composite Component Minimum Structure (table, tree, list, form, menu)

When final-state `renderFacts.patterns` or `renderFacts.controlMatrix` is present:
- MUST render the evidenced header/label row, columns, item slots, row examples, and structural parts that appear in those final-state facts
- MUST include table/list headers from `renderFacts.patterns.tablePatterns[*].columns[*].headerText` or list headers from `renderFacts.patterns.listPatterns[*].header` when provided
- If a pattern proves a selection column, first column MUST be a 16-20px checkbox/radio placeholder
- If a pattern proves an action column, last column MUST contain 1-2 action text links or evidenced compact actions
- Use `renderFacts.patterns`, `renderFacts.controlMatrix`, and `renderFacts.renderObligations` as the primary rendering blueprint — follow their hierarchy literally
- If preview HTML for a composite component is < 40 lines before writing, self-check that all final-state structure facts are represented and improve the in-memory draft. Do not trigger post-write regeneration.

When `renderFacts.patterns` is absent for a component whose `renderFacts.identity.normalizedKind` or `intentKind` is table/tree/list/grid/form/menu:
- Use `renderFacts.controlMatrix`, `renderFacts.contentPolicy`, `renderFacts.geometry`, `renderFacts.renderObligations`, `renderFacts.unknowns`, and `renderFacts.riskNotes` as the primary visual spec
- Render a minimal 1-header + 3-row/item layout only when that structure is supported by `renderFacts.patterns.tableModel`, `renderFacts.patterns.listModel`, or explicit render obligations

### Preview Information Architecture

Preview pages must explain the component, not dump every evidence sample.

Use this composition model:
- Vertical axis = scenario / usage intent.
- Horizontal axis = information density or comparison dimension.
- Simple components should prefer 2-4 semantic scenario rows.
- Complex components should prefer 1-2 main scenes with meaningful deltas.
- `renderFacts.controlMatrix`, `renderFacts.patterns`, and `renderFacts.renderObligations` authorize evidence-backed choices; they are not the display order.

Simple component examples: `button`, `tag`, `badge`, `link`, `switch`, `checkbox`, `radio`, `progress`, `avatar`.
- Button rows should express primary action, secondary action, quiet/text action, and danger action when evidenced.
- Tag rows should express neutral classification, colored category, add-tag affordance, and danger/warning label when evidenced.
- Size/state variants should become compact comparison strips inside a scenario when they repeat the same usage intent.

Complex component examples: `input`, `table`, `select`, `menu`, `tabs`, `card`, `list`, `form`, `datepicker`, `dropdown`, `modal`, `drawer`.
- Render at most 2 main scenes.
- Scene 1 = canonical/default product usage.
- Scene 2 = the most visually or structurally distinct evidenced usage.
- Do not place structurally different families into one flex rail.
- Input must separate standard text entry from assisted entry; affix/action/textarea variants must be grouped as deltas, not equal siblings in a single rail.

Evidence coverage:
- Every rendered evidence-backed cell or scene wrapper MUST include `data-evidence-sample="..."` using the sample `id`, `name`, or `label`.
- If a sample does not add a new scenario or information dimension, it may be omitted without regeneration.
- If an evidenced sample is dropped for compactness, return warning `dropped-render-sample:{slug}`.

**Token accuracy requirement** (non-negotiable even with reduced quantity):
- Every `border-radius` must use the correct `--radius-*` variable
- Every shadow must use `--shadow-*` variables
- Every color must use semantic aliases (`--color-on-surface`, `--accent`, etc.)
- Every spacing must use `--space-*` variables
- If a group can't demonstrate a token correctly, it's better to omit it than fake it

### Evidence-Only Visual Properties (MANDATORY — non-negotiable)

⚠️ ABSENCE = ZERO:
- If the component's evidence (`coverageMatrix` + `sizeDeltas` + `stateCoverage` + `parts` + `anatomy`) contains NO mention of:
  - `radius` / `borderRadius` → DO NOT add any border-radius
  - `shadow` / `effects` containing "drop-shadow" → DO NOT add any box-shadow
  - `opacity` / `blur` → DO NOT add any backdrop-filter or opacity effects
- "Use CSS variables" means: express EXISTING evidence values via variables.
  It does NOT mean: add visual properties that evidence doesn't provide.
- A component with no radius in evidence rendered with border-radius is WORSE than
  a component with hardcoded radius matching evidence.

DECISION TREE for visual properties:
  1. Evidence has trait value + `*Token` field → use `var(--token)`
  2. Evidence has trait value, no `*Token` → use raw px value
  3. Evidence has NO trait for this property → DO NOT render it AT ALL
  4. NEVER "fill in" missing traits from assumptions or examples
  5. `padding` field format is `top/right/bottom/left` (CSS shorthand order).
     `paddingTokens` array maps as: `[vertical-token, horizontal-token]`.
     MUST emit full shorthand: `padding: var(--vertical) var(--horizontal)`.
     Do NOT drop vertical padding to 0 — use the token from paddingTokens[0].
  6. `height` in `sizeDeltas` / `coverageMatrix` is the EXACT rendered height.
     Use `height: Npx` not `min-height: Npx` unless evidence explicitly says "min".

**Hard ceiling**: Single file MUST NOT exceed **6KB**. Target: 4-5KB.

### CSS Marker Convention (MANDATORY for components.css extraction)

Every preview HTML `<style>` block MUST separate **page scaffold CSS** from **component CSS** using marker comments:

```html
<style>
  /* Page scaffold — NOT extracted */
  body { ... }
  .specimen { ... }
  .header { ... }
  .stage { ... }
  .story { ... }
  .rail { ... }
  .story-label { ... }

  /* @component-css-start */
  /* Component definitions — extracted to components.css by deterministic script */
  .btn { ... }
  .btn.primary { ... }
  .size-lg { ... }
  /* @component-css-end */
</style>
```

**Rules**:
1. `/* @component-css-start */` and `/* @component-css-end */` markers are REQUIRED in every preview HTML
2. ALL component class definitions (selectors, pseudo-states, size/variant modifiers) go BETWEEN the markers
3. Page layout classes (`.specimen`, `.header`, `.stage`, `.story`, `.rail`, `.story-label`, `body`, `*`, `@media` queries for page layout) stay OUTSIDE (above) the markers
4. The extraction script `extract-components-css.mjs` reads only the CSS between these markers + DOM anatomy from `<body>` to produce `components.css`
5. Downstream consumers (UIKit, docs) read ONLY `components.css` — they do NOT read preview HTML for CSS

**Validation gate**: If markers are missing, Phase 5 validator emits a warning and the extraction script falls back to heuristic extraction (less reliable).

### Style Constraints (from evidence/index.json.styleConstraints)

When `colors_and_type.css` or `evidence/index.json` contains a `styleConstraints` object:
- `radius.common[]` → allowed radius values for layout decisions
- `spacing.common[]` → allowed gap/padding values for layout decisions
- `fontSize.common[]` → allowed font sizes for layout decisions
- `height.controlDefault` → default control height (inputs, buttons, table rows)

⚠️ PRIORITY RULE (critical for fidelity):
- **Component evidence visual specs ALWAYS override styleConstraints.** If `sizeDeltas` or `coverageMatrix` says `radius = 6` but `styleConstraints.radius.common` does not include 6, use 6 and resolve the closest declared variable from `colors_and_type.css` when available.
- styleConstraints are a FALLBACK for decisions not covered by component evidence (e.g., spacing between component instances, page-level layout margins).
- `colors_and_type.css` is the SSOT for variable names. Do not trust or invent intermediate `*Token` fields.

### Layout Anti-Overlap Rules (MANDATORY)

1. **flex-shrink protection**: Interactive controls (checkbox, radio, toggle, switch, icon buttons) MUST have `flex-shrink: 0` to prevent visual compression.

2. **Instance isolation in row**: When placing MULTIPLE component instances side-by-side in a `.row`, each instance MUST have `flex-shrink: 0`. If the instance has a known/evidence width (from traits), use that fixed width. Otherwise set a reasonable `min-width` based on component type:
   - Buttons: `min-width: auto` (natural content width, never compressed)
   - Inputs/Selects: `min-width: 120px`
   - Cards/Panels: place ONLY ONE per `.row` with `width: 100%`
   If total instance width may exceed container, let `flex-wrap: wrap` handle line-breaking naturally — do NOT compress instances.

3. **Full-width composites**: Components classified as `table`, `form`, `tree`, `list`, `menu`, `calendar` MUST be rendered with `width: 100%` and placed as the ONLY child in their `.row` (no `.label` prefix — use a preceding `.row` with only a `.label` for the group name).

4. **position: absolute containment**: Any element using `position: absolute` MUST be inside a parent with `position: relative` and explicit `width`/`height`. NEVER use absolute positioning for top-level component instances in a `.row`.

5. **Inline label + control pattern**: When a text label sits next to an interactive control (e.g., "Unchecked" + checkbox), wrap them in a single `display: inline-flex; align-items: center; gap: 4px` container. The control element gets `flex-shrink: 0; width: {size}px; height: {size}px`.

6. **overflow guard**: If any single component instance may exceed 200px width, give it `min-width: 0; overflow: hidden` (or split into its own `.row`).

### Designer Quality Gates (MANDATORY — from design review feedback)

1. **Min-width ≥ height rule**: Button, Tag, Badge, Chip, and all compact interactive controls MUST have `min-width` ≥ their `height` (or min-height). This prevents visually crushed elements. If height=28px, min-width≥28px. If height=32px, min-width≥32px. Enforce via CSS: `min-width: var(--control-height)` or explicit px matching.

2. **Hover restoration (MANDATORY)**:
   - ALL interactive elements (buttons, tabs, links, menu items) MUST have a visible `:hover` state change (background-color or border-color shift).
   - Hover MUST use CSS pseudo-class `:hover` — NEVER simulate via static `.hover` class.
   - Hover transition: `transition: background .15s, border-color .15s` minimum.
   - If evidence `stateCoverage.hover.delta` exists, use its exact values.
   - Else use the type-appropriate CSS variable/fallback defined in Step 2.
   - If no evidence, use generic: `filter: brightness(.92)` for filled elements, `background: var(--bg-overlay-l1)` for ghost/text elements.

3. **Strict alignment**:
   - All `.story`/`.row` rows within one page MUST share identical grid-template-columns or label width (92px uniform across ALL pages).
   - Components in the same `.rail`/`.row` MUST be vertically centered (`align-items: center`).
   - Adjacent component instances of the same type MUST share identical height.

4. **No text wrapping in controls**:
   - Button labels, tag text, badge content: `white-space: nowrap` (mandatory).
   - If text overflows, use `text-overflow: ellipsis; overflow: hidden`.
   - Table headers: `white-space: nowrap`.

5. **Spacing consistency**:
   - All gaps MUST come from token system (--spacer-* variables or consistent px values from the design). ZERO random hardcoded px values for spacing.
   - Within one page, the gap between variant groups must be uniform (one value).
   - The gap between instances within the same row must be uniform (one value).

### Forbidden Patterns

- **NO page-header / page-title** — body starts directly with component demos
- **NO theme toggle button or script** — theme is controlled by the host SDK iframe
- **NO section descriptions / explanatory text** — only `.label` spans for variant names
- **NO inline `style=""` to simulate hover/focus/active states** — use CSS pseudo-classes
- **NO `* { margin:0; padding:0; box-sizing:border-box }` reset** — unnecessary in iframe context
- **NO `.state-group` / `.state-label` wrapper per instance** — use flat `.row` + `.label`
- **JavaScript allowed** — use `<script>` blocks for interactions (tabs, toggles, dropdowns). Keep scripts minimal and self-contained.

## Technical Requirements

### Text Container Constraints (CJK-critical, MANDATORY)

When rendering text elements from evidence/component JSON, apply CSS based on the node's `textAutoResize` and `sizingH` attributes in `childrenDigest`:

| Evidence signal | CSS rule |
|----------------|----------|
| `resize=none` (fixed box, single line) | `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` |
| `resize=none` + `maxLines=N` (fixed box, multi-line) | `overflow: hidden; display: -webkit-box; -webkit-line-clamp: N; -webkit-box-orient: vertical` |
| `resize=height` + (`sizing=fill` or fixed width) | `overflow-wrap: break-word; word-break: break-all; white-space: normal` |
| `resize=width-and-height` | `white-space: nowrap; width: auto` |
| `truncation=end` | Force `text-overflow: ellipsis; overflow: hidden` |
| No explicit signal (CJK default) | Headings: `word-break: keep-all; overflow-wrap: break-word`; labels/tags: `white-space: nowrap` |

**Flex child rule**: Any flex child containing truncated text MUST have `min-width: 0`, otherwise `text-overflow` is ineffective.

### SVG Reuse (MANDATORY)

If the same SVG icon appears **≥ 2 times** on a preview page:

1. Place a hidden `<svg>` defs block at the top of `<body>`:
   ```html
   <svg style="display:none" xmlns="http://www.w3.org/2000/svg">
     <symbol id="icon-chevron" viewBox="0 0 24 24">
       <path d="..."/>
     </symbol>
   </svg>
   ```
2. Reference via `<use>` everywhere the icon is needed:
   ```html
   <svg width="24" height="24"><use href="#icon-chevron"/></svg>
   ```
3. **Forbidden**: Duplicating the same `<path>` inline multiple times or using `background-image: url("data:image/svg+xml,...")` with repeated SVG data.

This reduces output size by 3-8KB for icon-heavy components (Datepicker, TreeGrid, Navigation).

### Icon References (MANDATORY)

The component's evidence JSON provides `usedIcons: { bundle: [...], lucide: [...] }`.
- For `bundle` icons: use `<img src="../assets/icons/{name}.svg">` only for names listed in `usedIcons.bundle`; these names are the actual exported SVG files.
- For `lucide` icons: use `<img src="https://cdn.jsdelivr.net/npm/lucide-static@1.8.0/icons/{name}.svg">`
- If `usedIcons` is absent, infer icon names from evidence structure nodes with `type: "icon"` and apply the priority chain below. Never create a local `../assets/icons/{name}.svg` reference unless `{name}` is confirmed as exported.

Icons exported as SVG are available at `../assets/icons/{name}.svg`.
Use `<img>` tags to reference icons — NEVER inline SVG paths in HTML.

Icon priority (use in order):
1. **Bundle exported SVG** (highest priority): `<img src="../assets/icons/{name}.svg" width="24" height="24" alt="{name}">`, only when `{name}` is in `usedIcons.bundle`
2. **Lucide JS** (when bundle icon unavailable): `<i data-lucide="{name}" style="width:24px;height:24px;display:inline-block"></i>` (ensure `<script src="https://unpkg.com/lucide@1.8.0/dist/umd/lucide.min.js"></script>` in head + `<script>lucide.createIcons();</script>` before `</body>`)
3. **Omit uncertain icons** when no bundle or Lucide match is evidenced. Do not substitute Unicode glyphs, text arrows, CSS pseudo-icons, or invented icon slots.

Common Lucide icon names: `search`, `chevron-down`, `chevron-right`, `x`, `check`, `plus`, `minus`, `menu`, `bell`, `settings`, `user`, `home`, `arrow-left`, `arrow-right`, `edit`, `trash`, `eye`, `eye-off`, `calendar`, `clock`, `filter`, `download`, `upload`.

### Segmented / Grouped Controls

When evidence shows repeated child controls in one grouped row, render a single segmented group with shared borders and evidenced zero/negative gap. Only the first segment keeps left outer radii, only the last segment keeps right outer radii, and middle segments keep square internal corners. Do not render each segment as a standalone rounded button. Do not add arrows/icons unless that segment's own evidence contains the icon part.

### CSS Linking (MANDATORY)

```html
<link rel="stylesheet" href="../colors_and_type.css">
```

- MUST use external stylesheet link — NEVER inline the CSS tokens
- Path is always relative: `../colors_and_type.css`
- Additional page-specific styles in a `<style>` tag using **compact single-line format**

### CSS Format (MANDATORY — Compact Single-Line)

All page-specific CSS MUST use compact single-line format to minimize output tokens:
The variable names in examples below are illustrative; for create-library, every generated `var(--name)` MUST be replaced with a name present in `{output_dir}/colors_and_type.css`.
Do not declare or use local CSS variable aliases such as `--bd`, `--rad`, `--bg2`, `--brand`, `--on`, `--btn-bg`, `--btn-fg`, `--btn-border`, `--btn-bg-hover`, or any component-scoped `--{component}-*` token. Preview HTML must not declare CSS custom properties; it may only consume variables from `../colors_and_type.css`.

```css
/* ✅ CORRECT — Compact single-line */
body { margin: 0; padding: 12px; background: var(--color-surface); font-family: var(--font-sans); color: var(--color-on-surface); }
.row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.btn { display: inline-flex; align-items: center; gap: 6px; border: none; cursor: pointer; }
.btn-primary { background: var(--accent); color: var(--accent-foreground); border-radius: var(--radius-md); padding: 10px 24px; }
.btn-primary:hover { background: var(--accent-hover); }

/* ❌ WRONG — Expanded multi-line */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  cursor: pointer;
}
```

### CSS Variable Usage (MANDATORY)

Preview pages MUST use **semantic alias variables** defined in `colors_and_type.css`:

```css
/* ✅ CORRECT — Use semantic aliases */
background: var(--color-surface);
color: var(--color-on-surface);
border-radius: var(--radius-md);

/* ❌ WRONG — Using brand-prefixed tokens directly */
background: var(--slds-neutral-0);
```

The semantic alias layer MUST be defined in `colors_and_type.css` and maps to the brand-prefixed raw tokens. Preview pages reference only these aliases, ensuring portability.

**Semantic alias usage**: Preview pages MUST only use CSS variables defined in `colors_and_type.css`. The canonical alias naming rules live in `file-specs/css-tokens.md` (Semantic Alias Layer section), and the executable list comes from `{output_dir}/colors_and_type.css` for create-library. Do not copy or maintain alias quick-reference tables here. If an evidence color exists in `colors_and_type.css`, use that variable directly. If no allowlisted focus/border token exists, use `outline:2px solid currentColor` instead of inventing a variable. Do not define component-level fallback variables in preview HTML.

### Content Hygiene

Preview pages are visual component specimens, not documentation pages. Do not render explanatory sections such as "reserved axes", "available dimensions", token notes, evidence warnings, missing-coverage notes, variant inventories, or bullet lists that are not component UI. Show rendered component samples only, with compact labels when needed.

### HTML Template

> **SSOT**: Normal create-library execution uses the merged intent+preview template in `examples/templates/phase-2.5-intent-synthesis.md`. This file is used by Evidence/Legacy fallback, expand-components, refine-library, and other preview-only incremental routes.

### Layout Structure

- **`.row`** — Horizontal flex container for same-variant instances. Multiple instances of the same variant sit side by side in one row.
- **`.label`** — Tiny uppercase text at the start of each row identifying the variant/category.
- **`<hr class="divider">`** — Visual separator between variant groups. Max 1 divider per page (= max 2 groups).
- No wrapper sections, no descriptions, no headers.
- **NO device frame**: Preview pages are flat specimen sheets. Phone frame (412×780) is ONLY for `ui_kits/app/index.html`. Even for Mobile App product types, component previews NEVER wrap in a phone/device mockup.
- Keep vertical rhythm tight: body padding 12px, row gap 8px. Do NOT add extra wrapper padding or large margins between groups. The preview is rendered inline in a component list — excess whitespace wastes screen real estate.

### Content

Evidence contract priority: for `components/_evidence/{slug}.json`, use final-state `renderFacts` as the primary specification. Consume `renderFacts.identity`, `renderFacts.controlMatrix`, `renderFacts.patterns`, `renderFacts.contentPolicy`, `renderFacts.geometry`, `renderFacts.renderObligations`, `renderFacts.iconSlots`, `renderFacts.unknowns`, and `renderFacts.riskNotes`. Do not expect or reconstruct raw `renderPlan`, `visualSpecs`, `instanceComplexity`, `evidenceQuality`, or `representativeVariants`.

- Use brand-specific real content, never generic labels
- Match the product's language (Chinese brands → Chinese text)
- Show realistic data (real color values, actual measurements)
- Render ≤2 row groups from the resolved `ComponentContractFile`. When the contract is `components/_evidence/{slug}.json`, use final-state `renderFacts.controlMatrix`, `renderFacts.patterns`, `renderFacts.contentPolicy`, `renderFacts.geometry`, and `renderFacts.renderObligations` as the primary specification. If `renderFacts.unknowns` or `riskNotes` lists a gap, render conservatively and report a warning. When the contract is `components/{slug}.json`, use it as the primary specification directly. Do not invent variants or states not present in the resolved contract.

## Parallel Generation

In `create-library` workflow, normal Phase 3 uses **merged component synthesis sub-agents** — each agent produces both `components/{slug}.json` and `preview/component-{slug}.html` for one core preview component. Preview-only sub-agents are used only when merged synthesis fails and Evidence/Legacy fallback is required. No component docs are generated by sub-agents; the Main Agent resolves one `ComponentContractFile` per fallback slug. Evidence-backed Figma fallback resolves to `components/_evidence/{slug}.json`; non-Figma and legacy routes resolve to `components/{slug}.json`.

In `expand-components` workflow, preview-only sub-agents may still be used (Incremental: Preview-Only template).

| Page Count | Strategy |
|---|---|
| ≤3 pages | 1 round × ≤3 agents |
| 4-6 pages | 2 rounds (3 + remainder) |

Create-library component previews read `{output_dir}/colors_and_type.css` for the variable-name contract. Legacy/incremental routes should pass a route-specific `CSSFile` when needed. Canonical phase numbering is defined only in `workflows/create-library.md`.
