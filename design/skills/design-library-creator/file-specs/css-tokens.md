# CSS Token File Specification

## File

Single file: **`colors_and_type.css`**

This is the primary token CSS file in the library output. It contains all design tokens, typography classes, and utility variables. A secondary `components.css` file is extracted deterministically by `scripts/extract-components-css.mjs` from preview HTML files.

## Shared Token Contract (SSOT — all routes produce the SAME artifact)

Every creation route (figma-token-gen / scratch-token-gen / structured-spec) MUST produce
an identical-contract `colors_and_type.css`, converted by `css-to-json.mjs` into the
frontend `ThemeTokenData` shape. **The figma route's requirements are the reference
standard** — it is the most battle-tested route; other routes align to it. Routes differ
ONLY in where token VALUES come from (Figma data / brand inference / user spec), never
in the output contract.

| # | Contract item | Requirement (route-independent, figma-grade) |
|---|---|---|
| 1 | Color group comments | `/* groupName */` — single token, no extra text (no arrows/colons/descriptions); flat 2D structure: ONE hue scale per group, never multiple hue families under one comment |
| 2 | In-group color ordering | tokens sorted by lightness — lightest first, darkest last |
| 3 | `@primary` marking | exactly ONE `/* @primary */` inline mark per color group — the most saturated mid-lightness token |
| 4 | `@group-priority` | declare 3-5 groups, scored on ALL three dimensions: importance × scale completeness (≥ 4 tokens, ≥ 6 ideal) × business usage frequency; never text/surface/grey/neutral/utility groups |
| 5 | Scale length cap | 10 steps default (post-processor cap); `/* @max-group-size: N */` ONLY on explicit user request, never on Agent initiative |
| 6 | Color value format | 6-digit hex (`#rrggbb`) or `rgba()` only — NEVER oklch/hsl/hwb/lab/lch |
| 7 | Category naming (STRICT) | spacing `--space-{N}` · sizing `--size-*` (plus `--max-*`/`--gutter-*`/`--nav-*`/`--sidebar-width` for layout) · radius `--radius-*` · shadows `--shadow-N` ordered by blur ascending, each with an inline usage comment (`/* Card */`) · typography `--font-size-*`/`--font-weight-*`/`--line-height-*` in px/unitless |
| 8 | Numeric categories (radius/spacing/size) | dedup by value · ascending order · concrete px (no calc()/rem) |
| 9 | Alias layers | 3-layer architecture (see below); portable aliases (`--color-*`, `--radius-*`, `--type-*`) reference tokens via `var()`, never introduce new values |
| 10 | css.json | NEVER hand-written — always derived via `scripts/css-to-json.mjs` (SKILL.md invariant #31) |
| 11 | Mandatory self-review | after Write, read back ONCE; verify group format, single-token-group count, and per-category token counts; fix via targeted Edit calls (no reasoning re-draft, no whole-file rewrite) |

Per-route differences are limited to:
- **Value source & fidelity**: figma/structured-spec = faithfully reproduce source (no invention, no loss); scratch = generate from BrandProfile (full scales always expected)
- **Provenance marks**: `/* Source: ... */` (figma) · `/* AI-generated */` (scratch) · `/* Source: structured-spec */` (structured-spec)
- **Group naming origin**: figma/structured-spec = preserve designer's business naming verbatim; scratch = semantic names fitting the brand

## Token Architecture (3 Layers)

```
Layer 1 — Brand Scales (definition only, NOT consumed directly by previews/UIKit):
  --<brand>-<color>-50 through --<brand>-<color>-900

Layer 2 — Short Aliases (maps scales → consumable keys):
  --primary, --accent, --bg, --fg, --muted, --rule, --link
  --surface, --surface-container-low, ... (M3 surface hierarchy)

Layer 3 — Portable Aliases (consumer-facing, used by preview pages and UIKit):
  --color-primary, --color-surface, --color-border, --radius-*, --type-*
```

- Preview pages and UI Kit consume the CSS variables defined in `colors_and_type.css` (including any Layer 2/3 aliases present). When Figma bundle routes define a Layer 3 alias set, prefer those portable names; otherwise use whatever variable name is defined in `:root`.
- Layer 3 maps to Layer 2; Layer 2 maps to Layer 1
- Sub-agents generating `colors_and_type.css` MUST output ALL three layers in this order
- See "Color Naming Convention" and "Semantic Alias Layer" sections below for full definitions

## Structure Order

```css
/* 1. Web Font Imports */
@import url('https://fonts.googleapis.com/css2?family=...');

/* 2. @font-face for custom fonts (if any — managed by frontend GUI) */
/* Agent must preserve existing @font-face blocks unchanged */

/* 3. Light Theme Tokens (default) */
:root {
  /* Brand color scales */
  /* Semantic aliases */
  /* Surface hierarchy */
  /* State layers */
  /* Typography variables (--font-size-*, --font-weight-*, --line-height-*) */
  /* Spacing scale */
  /* Border radius */
  /* Shadows */
  /* Motion */
  /* Layout */
}

/* 3. Dark Theme Tokens */
.dark {
  /* Override light values */
}

/* 4. Typography Classes */
.brand-display { ... }
.brand-h1 { ... }

/* 5. Utility Classes (optional) */
```

## Color Group Comments

The `:root {}` block SHOULD contain CSS section comments to classify color tokens.
These comments drive downstream css.json categorization. Any single-word, hyphenated, or
Unicode comment is accepted as a valid color group name.

**Rules**:
- Group names MUST use the source data's original business naming (Figma Collection name, variable folder path, scaleGroup prefix, etc.).
- Group names are business identifiers — they must match what the designer defined, not AI-inferred categories.
- Do NOT translate, romanize, or force names into predefined English categories.
- If source data has brand prefixes (e.g., `arco-`), preserve them in token names.
- Only output groups that have actual source data. Do NOT create empty groups or invent tokens.

**Common patterns** (illustrative, not mandatory):

| Comment | Typical Contents |
|---------|-----------------|
| `/* primary */` | Brand primary scale tokens |
| `/* text */` | Text/foreground color tokens |
| `/* surface */` | Background/surface/structural tokens |
| `/* 碧涛青 */` | Chinese-named color palette |
| `/* arco-blue */` | Brand-prefixed hue family |

**`@group-priority` Declaration (Color Group Ordering)**:

Agent MUST include a `@group-priority` comment near the top of the CSS file (before or inside `:root {}`)
to declare which color groups should appear first in the generated `css.json`:

```css
/* @group-priority: primary, success, info, accent */
```

- Groups are listed in display priority order (leftmost = highest priority, appears first in JSON)
- `css-to-json.mjs` places these groups at the top of the JSON output in the declared order
- Groups not listed are sorted by token count (most tokens first) after the priority groups
- If a listed group doesn't exist in the CSS, it is silently skipped
- A listed group with fewer than 4 color tokens is demoted by `css-to-json.mjs` to the
  tail of the priority list (sparse scales render as thin, unappealing preview cards)

**Multi-dimensional scoring** — evaluate EVERY candidate group on all three dimensions
before declaring the order. A group must score well on ALL of them, not just one:

1. **Importance (brand/semantic weight)**: brand primary first, then other chromatic
   groups (success, info, warning, accent, named hue palettes). Prioritize visually RICH
   and SATURATED groups — they render as vibrant color cards in the Design Library
   preview. AVOID text, background, surface, grey, or neutral — these contain mostly
   white/gray/low-saturation colors that produce dull preview cards.
2. **Scale completeness (token count)**: a priority group SHOULD have a reasonably
   complete scale — ≥ 6 tokens is ideal, 4-5 acceptable, < 4 MUST NOT be declared as a
   priority group. A semantically important group (e.g., success) with only 2 tokens
   makes the cover image and first screen look sparse — leave it out of `@group-priority`
   and let it sort by token count instead. Never promote a 2-3 token group over a full
   10-step scale just because its semantic role sounds important.
3. **Business usage frequency**: prefer groups whose colors are actually referenced by
   semantic aliases / components throughout the library (e.g., the scale backing
   `--accent`, `--bg-section`, button/link states). A palette that exists in source data
   but is rarely consumed downstream should rank lower than an equally complete,
   heavily-used one.

- There is no fixed list; the priority depends on the brand and design context
- Typically declare 3-5 priority groups

**`@max-group-size` Declaration (Color Scale Length Cap)**:

`css-to-json.mjs` caps each color group at **10 tokens by default** (longer groups are
evenly sampled down to 10). This is the standard scale length for the Theme panel.

ONLY when the user EXPLICITLY requests longer scales (e.g., "我要 12 阶色阶" / "give me
a 14-step palette"), declare the cap override near the top of the CSS file:

```css
/* @max-group-size: 12 */
```

- Default is 10 — do NOT declare this comment unless the user asked for more steps
- Values below 10 are ignored (the default already applies); values are clamped to ≤ 50
- The Agent-generated scale length and the declared cap MUST match the user's request
  (e.g., user asks 12 steps → write 12 tokens per scale AND declare `@max-group-size: 12`,
  otherwise the script samples the scale back down to 10)

### Hue-Family Palette Groups

Any single-word or hyphenated CSS comment is a valid color group.
Brand color palettes use their hue family name directly:

| Comment | Maps to css.json | Content |
|---------|-----------------|---------|
| `/* cyan */` | `"cyan"` | Cyan hue scale tokens |
| `/* magenta */` | `"magenta"` | Magenta hue scale tokens |
| `/* 碧涛青 */` | `"碧涛青"` | Chinese-named hue scale |
| `/* arco-blue */` | `"arco-blue"` | Brand-prefixed hue scale |
| `/* {any-name} */` | `"{any-name}"` | Any named palette scale |

Rules: single hue per group (flat 2D structure).
Group name must be a single word, hyphenated, or Unicode (no spaces).

## Color Naming Convention

> **Color Format Constraint**: All color values in this CSS file SHOULD be expressed in 6-digit hex (`#rrggbb`) or `rgba(r,g,b,a)` for transparency. Avoid `oklch()`, `hsl()`, `hsla()`, `hwb()`, `lab()`, `lch()` when possible. The downstream `css-to-json.mjs` CAN convert oklch/hsl to hex, but hex is strongly preferred to avoid gamut-mapping precision loss. If the source design uses non-hex formats, convert them to their sRGB hex equivalents.

### Brand Colors — Full Scales

Use ThemeStyleProps unified key names. These are fixed semantic keys that map to any brand's actual values.

```css
/* ✅ CORRECT — ThemeStyleProps unified naming */
--primary: #1664ff;
--primary-foreground: #ffffff;
--secondary: #f1f5f9;
--secondary-foreground: #0f172a;
--accent: #f97316;
--accent-foreground: #ffffff;
--background: #ffffff;
--foreground: #0f172a;
--muted: #f1f5f9;
--muted-foreground: #64748b;
--border: #e2e8f0;
--ring: #1664ff;

/* ❌ WRONG in component preview pages — brand scales exist in :root (generated by BundleGenerator)
   but preview/UI-kit code must only consume ThemeStyleProps unified keys above */
--panda-orange-50: #fff8f0;  /* ← exists in :root definition layer, NOT for direct consumer use */
```

Generate full scales for each brand color identified in the design spec, preserving source step naming (50-900 only when source data uses those exact steps).

### Semantic Aliases (Conditional)

Include these semantic mappings ONLY when the corresponding source token exists. If source data
does not define the referenced brand scale token, do NOT create the alias:

```css
/* Only output these if the source var() target actually exists: */
--bg: var(--<brand>-<color>-50);        /* Page background — only if scale-50 exists */
--fg: var(--<brand>-<color>-900);       /* Primary text — only if scale-900 exists */
--accent: var(--<brand>-<color>-500);   /* Brand accent — only if scale-500 exists */
--accent-hover: var(--<brand>-<color>-600);
--rule: var(--<brand>-<color>-200);     /* Borders/dividers */
--link: var(--<brand>-<color>-600);     /* Interactive text */
--muted: var(--<brand>-<color>-400);    /* Secondary text */
```

> **Important**: These aliases use `var(--<brand>-<color>-N)` internally, but downstream consumers (preview pages, UI Kit) MUST reference only the alias keys (`--bg`, `--fg`, `--accent`, etc.) — never the brand-prefixed scales directly.

### Derived Values

Mark derived values with a comment:

```css
--card-bg: var(--surface-container-low); /* Derived */
--input-border: var(--rule); /* Derived */
```

When the route is `create-from-scratch` and there is no bundle ground truth, mark generated values with `/* AI-generated */` instead of pretending they are source tokens. Do not mix `/* Source */` provenance into from-scratch CSS.

### M3 Surface Hierarchy (Conditional — only output tokens that exist in source data)

⚠️ STOP: This section is a REFERENCE ONLY. Do NOT treat this as a checklist to fill.
If the source data does not explicitly contain these tokens, DO NOT generate them.
Generating M3 tokens that don't exist in source is a Rule 5 violation (fabrication).
Most Figma files do NOT have M3 surface hierarchy — skip this entire section unless
source explicitly defines surface-container/interactive-state variables.

The following tokens are standard M3 surface/state naming. Output ONLY those that have
corresponding values in the source design-tokens.jsonl. Do NOT fabricate values for tokens
that don't exist in source:

```css
/* Surface levels — output only if source provides these */
--surface: ...;
--surface-dim: ...;
--surface-bright: ...;
--surface-container-lowest: ...;
--surface-container-low: ...;
--surface-container: ...;
--surface-container-high: ...;
--surface-container-highest: ...;
--inverse-surface: ...;
--inverse-on-surface: ...;

/* Interactive state layers — output only if source provides interaction state data */
/* NOTE: group these under "interactive", NOT "state" */
--interactive-hover: rgba(..., 0.08);
--interactive-focus: rgba(..., 0.12);
--interactive-press: rgba(..., 0.16);
--interactive-drag: rgba(..., 0.16);

/* Error + Status — output only if source has error/status colors */
--error: ...;
--error-container: ...;
--on-error: ...;
--on-error-container: ...;

/* Chart colors — output only if source defines chart/data-viz colors */
--chart-1: ...;
--chart-2: ...;
--chart-3: ...;
--chart-4: ...;
--chart-5: ...;
```

## Typography Variables (in :root)

> These variables are the machine-readable source for `css-to-json.mjs` extraction.
> They MUST exist in `:root {}` alongside color/spacing/radius variables.
> Use role names derived from design tokens typeScale (e.g., display, h1, body, caption).

> **Font family fidelity (Figma-import route)**: The example below shows a 3-family pairing
> (serif + sans + mono) for FORMAT illustration only. The number of distinct font families
> in your output MUST equal the number of distinct families in source data. If the source
> uses a single family, ALL `--font-*` family tokens reference that one family — do NOT
> copy this example's multi-font pairing.

```css
:root {
  /* === Typography === */
  --font-display: 'Playfair Display', serif;
  --font-heading: 'Playfair Display', serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --font-size-display: 56px;
  --font-size-h1: 40px;
  --font-size-h2: 32px;
  --font-size-h3: 24px;
  --font-size-h4: 20px;
  --font-size-body: 16px;
  --font-size-lead: 18px;
  --font-size-caption: 12px;
  --font-size-eyebrow: 11px;
  --font-size-mono: 14px;

  --font-weight-display: 700;
  --font-weight-h1: 700;
  --font-weight-h2: 600;
  --font-weight-h3: 600;
  --font-weight-h4: 600;
  --font-weight-body: 400;
  --font-weight-lead: 400;
  --font-weight-caption: 400;
  --font-weight-eyebrow: 600;
  --font-weight-mono: 400;

  --line-height-display: 1.1;
  --line-height-h1: 1.2;
  --line-height-h2: 1.25;
  --line-height-h3: 1.3;
  --line-height-h4: 1.4;
  --line-height-body: 1.6;
  --line-height-lead: 1.7;
  --line-height-caption: 1.5;
  --line-height-eyebrow: 1.4;
  --line-height-mono: 1.6;
}
```

## Typography Classes

> **rem vs px boundary**: Typography *classes* use `rem` for responsive HTML scaling.
> The underlying CSS custom properties (`--font-size-*`) declared in `:root {}` MUST use **px** values — see `file-specs/css-json.md` § font.size.
> Sub-agents generating `colors_and_type.css` variables: always output px for `--font-size-*`.

Use brand prefix. Include ALL these levels:

```css
.p-display  { font-family: var(--font-display); font-size: 3.5rem; font-weight: var(--font-weight-display); line-height: var(--line-height-display); letter-spacing: -0.02em; }
.p-h1       { font-family: var(--font-heading); font-size: 2.5rem; font-weight: var(--font-weight-h1); line-height: var(--line-height-h1); }
.p-h2       { font-family: var(--font-heading); font-size: 2rem; font-weight: var(--font-weight-h2); line-height: var(--line-height-h2); }
.p-h3       { font-family: var(--font-heading); font-size: 1.5rem; font-weight: var(--font-weight-h3); line-height: var(--line-height-h3); }
.p-h4       { font-family: var(--font-heading); font-size: 1.25rem; font-weight: var(--font-weight-h4); line-height: var(--line-height-h4); }
.p-body     { font-family: var(--font-body); font-size: 1rem; font-weight: var(--font-weight-body); line-height: var(--line-height-body); }
.p-lead     { font-family: var(--font-body); font-size: 1.125rem; font-weight: var(--font-weight-lead); line-height: var(--line-height-lead); }
.p-caption  { font-family: var(--font-body); font-size: 0.75rem; font-weight: var(--font-weight-caption); line-height: var(--line-height-caption); }
.p-eyebrow  { font-family: var(--font-body); font-size: 0.6875rem; font-weight: var(--font-weight-eyebrow); line-height: var(--line-height-eyebrow); letter-spacing: 0.08em; text-transform: uppercase; }
.p-mono     { font-family: var(--font-mono); font-size: 0.875rem; font-weight: var(--font-weight-mono); line-height: var(--line-height-mono); }
.p-price    { font-family: var(--font-display); font-size: 1.5rem; font-weight: var(--font-weight-display); line-height: var(--line-height-display); font-variant-numeric: tabular-nums; }
```

Replace `p-` prefix with actual brand prefix (e.g., `panda-`, `duo-`, `zen-`).

## Spacing Scale

- **Figma-import route** (`figma-token-gen`): Output spacing tokens ONLY from `design-tokens.jsonl spacing.observedValues` or `commonPaddings/commonGaps`. If source has no spacing data, output NOTHING for this section.
  **Count fidelity (HARD)**: output EVERY deduplicated source value, including half-step / off-grid values (2px, 10px, 14px, 18px, etc.). The `--space-{N}` suffix is an ascending index, NOT a 4px multiplier — never drop values for not fitting a clean rhythm.
- **From-scratch route** (`scratch-token-gen`): Generate a standard 4px-based scale as specified in the task hard rules.

> **Format**: Spacing values MUST be concrete px integers. NEVER use `calc(var(--spacing) * N)` or `rem`.

Example (only when source provides these values):
```css
--space-1: 4px;
--space-2: 8px;
/* ... output only values that exist in source data */
```

## Sizing (Component Dimensions)

- **Figma-import route**: Sizing has NO dedicated `design-tokens.jsonl` section — actively mine component dimension values from: jsonl size/dimension fields (if present), `specAnnotations` texts mentioning heights/widths/icon sizes, and `variables-raw*.md` variables named with size/height/width/icon. If nothing is found, output NOTHING.
- **From-scratch route**: Generate component size tokens as specified in the task hard rules (if required).

**Naming convention (STRICT)**: sizing tokens MUST use the `--size-*` prefix — the ONLY pattern `css-to-json.mjs` classifies into the css.json `size` category. Layout constraints may also use `--max-*`, `--gutter-*`, `--nav-*`, `--sidebar-width`.

```css
--size-button-height: 40px;
--size-input-height: 36px;
--size-icon-sm: 16px;
--size-icon-md: 24px;
```

> Do NOT misfile component dimensions into spacing (`--space-*`) — a 40px button height is a size token, not a spacing step. Values MUST be concrete px; dedup by value; ascending order.

## Shadows

- **Figma-import route**: Output shadow tokens ONLY from `design-tokens.jsonl shadows[]` array. If source has no shadow data, output NOTHING.
  **Count fidelity (HARD)**: output exactly ONE `--shadow-N` per source shadow entry. If source defines 9 shadows, output 9 — never merge or trim to match the 5-level example below (it illustrates FORMAT, not count). Only exact duplicates may be deduplicated.
- **From-scratch route**: Generate a multi-level elevation scale as specified in the task hard rules.

Format: `{x}px {y}px {blur}px {spread}px {color}`

**Naming convention**: Use sequential numeric names (`--shadow-1`, `--shadow-2`, ...) ordered by elevation (blur ascending). Each shadow variable MUST have an inline comment describing its intended usage context:

```css
--shadow-1: 0 1px 2px rgba(15,23,42,.06), 0 1px 1px rgba(15,23,42,.04); /* Card */
--shadow-2: 0 4px 8px -2px rgba(15,23,42,.10); /* Card Hover */
--shadow-3: 0 8px 24px -8px rgba(15,23,42,.18); /* Float */
--shadow-4: 0 16px 40px -12px rgba(15,23,42,.24); /* Modal */
--shadow-5: 0 24px 60px -20px rgba(15,23,42,.30); /* Overlay */
```

The inline comment (e.g., `/* Card Hover */`) is consumed by `css-to-json.mjs` to produce display-friendly JSON keys in the format `shadow-N·Description` (e.g., `shadow-2·Card Hover`).

## Motion

- **Figma-import route**: Output motion tokens ONLY if `design-tokens.jsonl` provides motion data. If none exists, output NOTHING.
- **From-scratch route**: Generate motion tokens as specified in the task hard rules (if required).

## Layout Variables

- **Figma-import route**: Output layout tokens ONLY if `design-tokens.jsonl` provides layout data. If none exists, output NOTHING.
- **From-scratch route**: Generate layout tokens as specified in the task hard rules (if required).

## Token Naming Convention

Token naming preserves the designer's original naming from source data:
- If source uses brand prefixes (e.g., `--arco-primary-1`), preserve them.
- If source uses generic names (e.g., `--primary-1`), preserve them.
- If source uses Chinese or other Unicode names (e.g., `--碧涛青-1`), preserve them.
- Do NOT strip, rename, or normalize token names.
- Do NOT translate token names between languages (e.g., `--碧涛青-5` must NOT become `--cyan-5`).
- Do NOT translate group comment names (e.g., `/* 晚秋红 */` must NOT become `/* autumn-red */`).
- Aliases (Layer 2/3) may use standard English names (`--primary`, `--background`, etc.)
  but these are ADDITIONS referencing source tokens via `var()`; they never replace source names.

Status colors (success, warning, error, info) SHOULD use role-based naming when possible,
but source naming always takes priority.

Each color group SHOULD contain tokens of a single hue family (flat 2D structure).

## Requirements Checklist

- [ ] MUST include both `:root` (light) and `.dark` themes (if source has dual-theme data)
- [ ] MUST preserve source token naming (including brand prefixes and Unicode names if present)
- [ ] MUST provide full scales for brand colors, preserving source step naming
- [ ] Semantic aliases: Figma-import → ONLY for tokens that exist in source; From-scratch → generate full alias set per task rules
- [ ] Surface hierarchy: Figma-import → output only tokens that exist in source data; From-scratch → generate as needed
- [ ] MUST define typography classes with brand prefix (if typography source data exists)
- [ ] Spacing: Figma-import → output ONLY values from source observedValues; From-scratch → use task hard rules
- [ ] Sizing: Figma-import → actively mine component dimensions (jsonl size fields, specAnnotations dimension texts, variables-raw size/height/width/icon variables) and emit `--size-*` tokens; output NOTHING only when source truly has no dimension data
- [ ] Shadows: Figma-import → output ONLY from source shadows[] array; From-scratch → use task hard rules
- [ ] Count fidelity (Figma-import, HARD): per-category token count MUST match deduplicated source data — font families == source families; shadows == shadows[].length; radius values == radius.observedValues (no invented 0/none slots); spacing == all observed values incl. half-steps. No fabrication, no loss.
- [ ] Motion: Figma-import → output ONLY if source provides motion data; From-scratch → use task hard rules
- [ ] Layout: Figma-import → output ONLY if source provides layout data; From-scratch → use task hard rules
- [ ] Font @import ONLY for web fonts with >20% usage — system fonts NEVER imported
- [ ] If CSS contains existing `@font-face` blocks (from frontend GUI for custom fonts), Agent MUST preserve them unchanged
- [ ] Agent must NOT manually add `@font-face` for user-uploaded custom fonts — this is managed by frontend GUI
- [ ] Derived tokens MUST have traceable comments: `/* Derived: {source} [at {transform}] */`
- [ ] From-scratch token values MUST be marked `/* AI-generated */`
- [ ] Scale steps MUST preserve source step naming from `colors_and_type.css` (e.g., if source uses `1..8`, output uses `1..8`). Do NOT normalize to 50-900 unless those exact steps exist in source data.
- [ ] Semantic alias layer: conditional — only generate aliases for tokens that exist in source
- [ ] ALL color values MUST be 6-digit hex (#rrggbb) or rgba(). NEVER use oklch(), hsl(), hwb(), lab(), lch(). Convert non-hex source colors to hex equivalents.

## Semantic Alias Layer (Conditional)

⚠️ GROUPING RULE: All aliases MUST be placed under the SAME CSS comment group as their
referenced source token. Do NOT create separate groups for each alias.
Example: `--color-primary-container: var(--brand-blue-50)` belongs under `/* brand-blue */`
or `/* primary */` — NOT under a new `/* primary-container */` group.

In addition to raw tokens, `colors_and_type.css` MAY include a **semantic alias layer** that maps generic names to source tokens. This layer allows preview pages and UI Kits to use portable variable names.

**CRITICAL RULE**: Only generate an alias if the target token it references ACTUALLY EXISTS in the source data. Never create aliases pointing to non-existent tokens.

### Available Aliases (generate only when target exists)

Add these at the end of the `:root` block (and override in `.dark`) — but ONLY for tokens
whose referenced target actually exists in source data:

> **Template variables**: Replace `<brand>`, `<primary>`, `<neutral>`, `<color>` placeholders below with actual values from BrandProfile:
> - `<brand>` → BrandProfile.colorNamingPrefix (e.g., "atlas", "zen")
> - `<primary>` → primary hue name from color scale (e.g., "blue", "indigo")
> - `<neutral>` → neutral hue name (e.g., "slate", "gray")
> - Example: `--<brand>-<primary>-50` → `--atlas-blue-50`

```css
/* ============================================
   SEMANTIC ALIAS LAYER
   Maps generic names → brand-prefixed tokens
   Used by preview pages and UI Kit
   ============================================ */

/* === Surface & Background === */
--color-background: var(--bg);
--color-foreground: var(--fg);
--color-surface: var(--surface);
--color-surface-dim: var(--surface-dim);
--color-surface-variant: var(--surface-container-high);
--color-surface-container: var(--surface-container);
--color-surface-container-low: var(--surface-container-low);
--color-surface-container-high: var(--surface-container-high);
--color-surface-container-highest: var(--surface-container-highest);
--color-card: var(--surface);
--color-sidebar: var(--surface-container-low);

/* === Text === */
--color-on-surface: var(--fg);
--color-on-surface-variant: var(--muted);
--color-muted-foreground: var(--muted);

/* === Brand/Primary === */
--color-primary: var(--accent);
--color-primary-hover: var(--accent-hover);
--color-on-primary: #ffffff;
--color-primary-container: var(--<brand>-<primary>-50);
--color-on-primary-container: var(--<brand>-<primary>-900);

/* === Secondary === */
--color-secondary: var(--<brand>-<neutral>-200);
--color-secondary-container: var(--<brand>-<neutral>-100);
--color-on-secondary-container: var(--<brand>-<neutral>-800);

/* === Error === */
--color-error: var(--error);
--color-error-container: var(--error-container);
--color-on-error: var(--on-error);
--color-on-error-container: var(--on-error-container);

/* === Borders === */
--color-outline: var(--rule);
--color-outline-variant: var(--<brand>-<neutral>-100);
--color-border: var(--rule);

/* === Functional Status === */
--color-success: var(--<brand>-success-600);
--color-warning: var(--<brand>-warning-600);
--color-error: var(--<brand>-error-600);  /* Use "error", never "danger" */

/* === Radius (ONLY output slots that have source values — no defaults) === */
--radius-sm: var(--<brand>-radius-sm);   /* ← only if source has a "small" radius */
--radius-md: var(--<brand>-radius-md);   /* ← only if source has a "medium" radius */
--radius-lg: var(--<brand>-radius-lg);   /* ← only if source has a "large" radius */
--radius-xl: var(--<brand>-radius-xl);   /* ← only if source has an "xl" radius */
--radius-full: 9999px;

/* === Typography (only if source provides typeScale data) === */
--type-display-sm: ...;   /* from typography.typeScale */
--type-heading-sm: ...;
--type-body-md: ...;
--type-body-sm: ...;

/* === Font family === */
--font-family-base: var(--font-body);
```

### Completeness Note: `--space-*` and `--shadow-*`

The spacing variables (`--space-1` through `--space-16`) and shadow variables (`--shadow-1` through `--shadow-5`) defined in the `:root` block are already in generic naming — they do NOT need a brand→generic alias mapping. Downstream Phase 4 sub-agents read `colors_and_type.css` directly to discover which variables exist.

**Shadow inline comments**: Shadow variables SHOULD include an inline comment describing usage (e.g., `--shadow-1: ...; /* Card */`). The `css-to-json.mjs` script reads these comments and produces JSON keys in the format `shadow-1·Card` (varName + middle dot + description). This gives the Design Library UI meaningful display names for each elevation level.

**Rule**: The CSS variable set in `colors_and_type.css` = all `--color-*` + `--radius-*` + `--type-*` + `--font-*` aliases **PLUS** all `--space-*`, `--shadow-*`, `--layout-*`, `--duration-*`, `--easing-*`, `--transition-*`, and `--motion-*` variables defined in `:root`.

### Rules

1. Every variable used in `preview/component-*.html` SHOULD have a definition in this alias layer (if source data supports it)
2. The alias layer maps TO existing source tokens — never introduces new color values
3. The `.dark` block SHOULD override aliases that change in dark mode (if source has dark theme data)
4. Alias names follow the pattern: `--color-{role}`, `--radius-{size}`, `--type-{level}`
5. NEVER create an alias whose target token does not exist in source data — skip it instead

---

> **Sync notice**: Changes to the Semantic Alias Layer above are reflected directly in `colors_and_type.css`. Preview templates and sub-agents read `colors_and_type.css` directly instead of maintaining alias quick-reference tables.

---

## Structured-Spec Route: Token Naming Preservation

When the workflow route is `create-from-structured-spec`:

1. **DO NOT** rename source tokens to ThemeStyleProps / M3 conventions
2. **DO NOT** generate brand-prefixed color scales (50-900) if input uses a different grouping system
3. **PRESERVE** the input's CSS variable naming verbatim (e.g., `--bg-base-default` stays as `--bg-base-default`)
4. **Fine-grained CSS section comments** are MANDATORY for color grouping. The downstream `css-to-json.mjs` script uses these comments as authoritative group signals.
   - If source has section comments → PRESERVE them verbatim. Do NOT merge or replace with generic Structure Order comments.
   - If source has NO section comments (common for Tailwind v4 theme files) → ADD semantic grouping comments to classify colors by role:
     `/* bg */` for background/surface/container colors,
     `/* text */` for foreground/text colors,
     `/* accent */` for primary/brand/interactive colors,
     `/* border */` for border/outline/divider colors,
     `/* status */` for error/destructive/success/warning colors,
     `/* chart */` for chart-* data visualization colors,
     `/* sidebar */` for sidebar-* scoped tokens.
   - Every color variable in :root MUST fall under exactly one section comment.
5. Token provenance comment: `/* Source: structured-spec */` (NOT `/* AI-generated */` or `/* Source */`)
6. `:root` / `.dark` rule (theme structure determined by `themeSignals` in design-tokens.jsonl):
   - @dark-only (identicalRatio > 0.9, darkValueRatio > 0.8) → `:root` contains dark values directly; `.dark {}` omitted. Add `/* @dark-only */` comment at top.
   - @light-only (identicalRatio > 0.9, darkValueRatio < 0.2) → `:root` contains light values; `.dark {}` omitted. Add `/* @light-only */` comment at top.
   - dual-theme (otherwise) → normal `:root` (light) + `.dark` (overrides)
   - Do NOT auto-derive missing themes unless user explicitly requests it.
7. Semantic Alias Layer:
   - **SKIP** if no preview pages / UI Kit are generated in this round
   - **INCLUDE** if components are generated (preview pages need portable aliases)
   - When included, alias layer maps source token names → portable `--color-*` aliases
8. Requirements Checklist items that DO NOT apply in this route:
   - "MUST use brand-specific color names, never generic" → source names are preserved regardless of form
   - "MUST provide full scales for primary brand colors" → only if source defines scales
   - "MUST include complete M3 surface hierarchy" → only if source defines equivalent surface tokens
   - "MUST include both `:root` (light) and `.dark` themes" → only if source has both themes
   - "From-scratch token values MUST be marked `/* AI-generated */`" → use `/* Source: structured-spec */` instead
