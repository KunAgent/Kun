# UI Kit Specification

> **Read Context**: This file is passed as a MANDATORY constraint file in Phase 4 UIKit Task queries. The sub-agent MUST Read this file FIRST (before generating any HTML). All rules below are binding and enforceable by deterministic validation gates.

## Purpose

The UI Kit is an **interactive Design System Showcase** — a curated, brand-immersive React application that demonstrates how the design system's components compose into realistic product interfaces.

Think of it as "Storybook meets brand lookbook":
- It showcases components in context, not as an isolated raw grid
- It embodies the brand personality established in README.md
- It strictly follows the hard constraints from SKILL.md Essentials
- It proves the design system works as a coherent whole

It is NOT a documentation page or component dump. It is a designed product experience that uses realistic scenarios as the canvas for demonstrating the system.

## Showcase Framing

While the Kit uses realistic product scenarios as its canvas (see Content Requirements below), its PRIMARY purpose is to demonstrate the design system — not to be a complete functional product prototype.

The distinction:
- Product prototype: focuses on user flows, business logic, and data completeness
- Design System Showcase: focuses on component fidelity, visual coherence, brand personality, interaction quality, and the designed feeling that proves the system works

Use product scenarios to create context for components, not as an end in themselves. Design first, then choose components that serve the designed scenario; when using components, strictly preserve their components.css class structure and `/* @anatomy */` DOM hierarchy (extracted from preview HTML by the deterministic § 3.6 script).

## Technical Stack

- **React 18** via CDN (unpkg)
- **Babel Standalone** via CDN for JSX transformation
- **Zero build step** — open `index.html` directly in browser
- All code is self-contained in a single HTML file
- **Icons**: exported SVGs via `<img>` tags → Lucide CDN fallback; omit uncertain icons

Evidence-backed UIKit generation must also write a sibling `quality-report.json`.
This report is a deterministic validation contract, not documentation prose.

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<link rel="stylesheet" href="../../colors_and_type.css">
<link rel="stylesheet" href="../../components.css">
```

## Layout Fit Contract (HARD CONSTRAINT)

The UI Kit is rendered inside the Design Library Components tab iframe. The effective desktop target is **1184px**: host `.componentList` is `1184px` wide with no preview padding. The Kit must fit natively at this width.

Layout validation is a deterministic failure gate, not advisory guidance. A Kit fails validation if it omits the layout marker/classes, uses page scaling, exceeds the 1184px shell target, misses responsive breakpoints, or lets dense tables escape their wrapper.

Required:
- `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
- Root shell includes `data-layout-guard="uikit-v1"`
- Page-level classes are defined and used: `.uikit-shell`, `.uikit-sidebar`, `.uikit-main`, `.uikit-toolbar`, `.uikit-responsive-grid`, `.uikit-table-wrap`, `.uikit-truncate`, `.uikit-nowrap`, `.uikit-action-cell`, `.uikit-action`
- `.uikit-shell` uses `width:100%`, `max-width:1184px`, `margin:0 auto`, `overflow:hidden`
- `.uikit-responsive-grid` uses `minmax(0,1fr)` and collapses before overflow
- `@media (max-width: 900px)` and `@media (max-width: 640px)` are present
- Tables are wrapped in `.uikit-table-wrap`

**App-kit exception (`ui_kits/app/`)**: the Kit renders a centered phone frame (~390px), not a desktop grid shell. Desktop-grid guards (`.uikit-sidebar`, `.uikit-responsive-grid`, `.uikit-table-wrap`, `.uikit-action-cell`, `.uikit-action`, the 900px collapse breakpoint) are advisory — the validator reports them as warnings, not failures, and they should only be defined where the screen actually uses those patterns. Hard requirements that still apply to app kits: viewport meta, `data-layout-guard="uikit-v1"`, the `.uikit-shell` contract above, `.uikit-truncate`, the 640px stack guard, and the no-page-scaling rule.

Forbidden:
- Wider virtual canvas plus `transform: scale(...)`, `zoom`, iframe scaling, or page scaling
- Fixed `left/top/transform` positioning for normal text/layout structure
- Vertical CJK button text caused by narrow controls

Minimum page-layer CSS skeleton:

```css
.uikit-shell{width:100%;max-width:1184px;margin:0 auto;overflow:hidden;display:grid;grid-template-columns:var(--uikit-sidebar-w, 220px) minmax(0,1fr);gap:var(--space-4)}
.uikit-sidebar,.uikit-main,.uikit-toolbar{min-width:0}
.uikit-sidebar{overflow:hidden;max-width:100%}
[data-component]{min-width:0;max-width:100%;overflow:hidden}
.uikit-toolbar{display:flex;align-items:center;gap:var(--space-2)}
.uikit-responsive-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-4)}
.uikit-table-wrap{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain}
.uikit-truncate{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uikit-nowrap{white-space:nowrap;flex-shrink:0}
.uikit-action-cell{display:flex;align-items:center;gap:8px;min-width:0;max-width:160px;overflow:hidden}
.uikit-action{min-width:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width: 900px){.uikit-shell{grid-template-columns:minmax(0,1fr)}.uikit-responsive-grid{grid-template-columns:minmax(0,1fr)}}
@media (max-width: 640px){.uikit-toolbar{flex-direction:column;align-items:stretch}.uikit-responsive-grid{grid-template-columns:minmax(0,1fr)}}
```

**Sidebar column width**: The `--uikit-sidebar-w` value MUST be set from `uikit-plan.json` → `layout.sidebarColumnWidth` when present. If absent, fallback to `220px`. Set it as an inline style on `.uikit-shell`: `style="--uikit-sidebar-w:{value}"`. This ensures the grid column matches the sidebar component's actual width from `components.css`.

## CSS Token Link (HARD CONSTRAINT)

The `<head>` section MUST contain these EXACT lines as its FIRST stylesheet links:

```html
<link rel="stylesheet" href="../../colors_and_type.css">
<link rel="stylesheet" href="../../components.css">
```

The first link loads design tokens (CSS variables). The second loads all component class definitions (auto-extracted from preview HTML by a deterministic script). Together they provide the complete styling foundation — UIKit `<style>` only needs page-level layout classes.

Use these exact paths. Do not read `uikit-plan.json` just to obtain the stylesheet links.

⚠️ SELF-CHECK: Before writing the file, verify BOTH exact strings exist in your output. If either is missing → output is INVALID.

Do NOT:
- Use a different relative path (e.g., `../colors_and_type.css`)
- Inline the CSS content
- Skip these links in favor of CDN or `<style>` blocks
- Redefine component CSS classes from `components.css` in your UIKit `<style>` block

## CSS Variable Source Of Truth

`colors_and_type.css` is the executable source of truth for CSS custom properties in UI Kit generation.

The UIKit sub-agent MUST read `colors_and_type.css` and build its variable allowlist from actual custom property declarations:

```js
/--([A-Za-z0-9_\-\u4e00-\u9fff]+)\s*:/g
```

(Variable names may contain CJK characters — the character class above must include `\u4e00-\u9fff`.)

Use names extracted from that CSS file in `var(--name)` references, plus page-level custom properties the UIKit declares itself in its own HTML (e.g. `--uikit-sidebar-w`). `css.json` is auxiliary metadata for semantic grouping and token browsing; it MUST NOT be used to invent or normalize variable names.

Examples:
- If `colors_and_type.css` defines `--color-border`, use `var(--color-border)`, not `var(--border)`.
- If it defines `--color-on-primary` or `--primary-foreground`, use the exact existing name, not `var(--on-primary)`.
- If a desired semantic token is absent, choose the closest existing CSS variable from the extracted allowlist or use a non-variable safe CSS value where explicitly allowed by the template.

## Self-Contained Requirement

**CRITICAL**: The `index.html` file MUST be completely self-contained. Babel standalone cannot do cross-file JSX imports. All components, state management, and logic live inside `<script type="text/babel">` blocks in the single HTML file.

Do NOT generate standalone `.jsx` files for the default Design Library output. If a user explicitly asks for reference implementations later, handle that as a separate incremental request.

## Component Attribution (CRITICAL)

Every major design-system component wrapper element should have a `data-component="{slug}"` attribute, where `{slug}` is derived from a `components.css` section header (`/* ── {Name} ── */`) or a whitelisted evidence component from `uikit-plan.json` / `components/_evidence/index.json`. Omitting this is reported as a component attribution warning; it must not trigger automatic UIKit regeneration.

When consuming a component's `/* @anatomy */` structure from `components.css`, treat it as a scenario/information-density component reference, not as a raw component grid to paste wholesale. Compose the component-level DOM with page-level layout. Do not re-expand component variants the anatomy intentionally collapsed. UIKit should demonstrate components in product context, not compensate for weak component structure.

```html
<!-- ✅ Correct -->
<div data-component="menu" class="sidebar-nav">...</div>
<div data-component="badge" class="status-indicator">...</div>

<!-- ❌ Wrong — missing data-component, gate will reject -->
<div class="sidebar-nav">...</div>
```

## Quality Report Contract

Write `ui_kits/<type>/quality-report.json` next to `index.html` when `uikit-plan.json` and `components/_evidence/index.json` exist.

Required schema:

```json
{
  "schemaVersion": 1,
  "screensGenerated": 3,
  "coreComponentsUsed": ["button", "table"],
  "supportComponentsUsed": ["tag"],
  "previewClassReuseRate": 0.75,
  "hasProductContext": true,
  "inventedComponents": [],
  "renderedFromEvidence": [],
  "warnings": []
}
```

Hard requirements:

- `screensGenerated >= 2`
- `coreComponentsUsed` contains every `uikit-plan.corePreviewComponents[].slug`
- If `uikit-plan.selectionPolicy === "fixed-slots-first"`, UI Kit MUST treat `corePreviewComponents` as already selected and MUST NOT replace them with support/fallback components. `slotAssignments` and `missingFixedSlots` are diagnostics only.
- `supportComponentsUsed` is a subset of `uikit-plan.supportEvidenceComponents[].slug` plus slugs present in `components/_evidence/index.json`
- `previewClassReuseRate >= 0.5`
- `hasProductContext === true`
- `inventedComponents` is empty
- `renderedFromEvidence` contains only slugs present in `uikit-plan.allowedComponents` or `components/_evidence/index.json`

## Component CSS Consumption (CRITICAL)

The UI Kit **MUST** consume `components.css` (auto-extracted from preview HTML by the deterministic § 3.6 script) as the SOLE ground truth for component styling and `/* @anatomy */` DOM structure. The UIKit sub-agent does NOT read `preview/component-*.html` directly — preview fidelity is carried by `components.css`. When a whitelisted slug is missing from `components.css`, it MAY read compact evidence as fallback.

**Source priority:**
1. Read `SKILL.md`, `README.md`, and `colors_and_type.css` for brand/token context
2. Read `uikit-plan.json` for whitelist/blueprint when present
3. Read `components.css` ONCE → derive slugs from `/* ── {Name} ── */` section headers, extract class names and `/* @anatomy */` structures
4. Read `components/{slug}.json` only as auxiliary variant/state context when needed
5. Read `components/_evidence/{slug}.json` only when the slug is missing from `components.css` and `{slug}` exists in `components/_evidence/index.json`; consume final-state `renderFacts.identity`, `renderFacts.controlMatrix`, `renderFacts.patterns`, `renderFacts.contentPolicy`, `renderFacts.geometry`, `renderFacts.renderObligations`, `renderFacts.iconSlots`, `renderFacts.unknowns`, and `renderFacts.riskNotes`. Do not expect raw `renderPlan`, `visualSpecs`, `instanceComplexity`, `evidenceQuality`, or legacy representativeVariants.

`ComponentContractKind` is `intent-json` for create-library Phase 3 synthesized `components/{slug}.json`, `compact-json` or `legacy-json` for non-Figma component JSON, and `evidence` for `_evidence/{slug}.json` fallback. The kind never changes the source priority above: components.css remains first.

**Rules:**
1. Component CSS rules load via the `components.css` `<link>` — do NOT copy or redefine them in the Kit's `<style>` block
2. Apply existing component class names to component elements; do NOT invent parallel component-level class names
3. You MAY add layout/composition classes (grid, sidebar, page-level), but component-level styling MUST come from components.css
4. If components.css defines `.btn.primary`, Kit buttons MUST use `class="btn primary"`, not `class="primary-btn"`
5. Self-check: every component wrapper (`data-component`) with a components.css section must use at least one class from that section. Missing = invalid output.
6. If a whitelisted slug is missing from components.css, render from `_evidence` only when evidence was read and return `rendered-from-evidence:{slug}` warning.
7. Evidence fallback can provide structure/composition/copy hints; it must not override existing component CSS.

**Anti-pattern**: Defining `.ghost-btn` / `.primary-btn` / `.input-shell` when components.css already defines `.btn` / `.field` / `.table`.

## Size Budget

| Constraint | Value |
|------------|-------|
| Total `index.html` file size | **≤ 40KB** (soft ceiling — slightly over is acceptable) |
| View count | Prefer 3 primary views |
| Components per view | Prefer ≤ 5 distinct component instances |
| Mock data rows per table/list | Prefer ≤ 4 rows |
| Chart data points | Prefer ≤ 8 points |

**If approaching the limit, prioritize in this order:**
1. Keep standard CSS links and CSS variable usage correct (non-negotiable)
2. Keep component diversity (show different component types)
3. Reduce data density (fewer table rows, shorter lists)
4. Simplify interaction states (hover is enough, skip ripple/press)

**Anti-pattern**: Rendering a 50-row data table or a full month calendar view in the kit. Use representative 3-4 rows / single week view instead.

## Anti-Bloat Guidance

| # | Rule | Rationale |
|---|------|-----------|
| 1 | Prefer CSS classes in `<style>` for repeated styling | Keeps output compact and easier to scan |
| 2 | Prefer exported SVG via `<img>` first; if unavailable, use Lucide CDN `<img>` (see Icon Usage below) | Keeps file portable with real icon visuals |
| 3 | Keep table/list rows compact | A few rows demonstrate pattern without wasting tokens |
| 4 | Each view should stay focused | Prevents "kitchen sink" screens that double file size |
| 5 | Keep output token budget low | Reduces generation latency |

## Icon Usage

When preview/evidence semantics indicate an icon slot, the UI Kit must render a real icon. Do not replace known sidebar, nav, button, search, table-action, status, avatar, or leading-media slots with decorative CSS circles, borders, initials, empty boxes, text arrows, Unicode glyphs, or text-only placeholders. Use exported SVG first, then Lucide CDN. Avatar/leading-media slots may use Lucide `circle-user-round` or `user` when no local image exists. If no semantic icon name can be inferred, omit the uncertain icon instead of inventing one.

### Tier 1: Exported SVG assets (PRIORITY)

```jsx
<img src="../../assets/icons/search.svg" width="20" height="20" alt="search" />
```

### Tier 2: Lucide JS Icons (when bundle icon unavailable)

> **MANDATORY**: When bundle icons are unavailable or have non-semantic names, Lucide JS is the REQUIRED fallback. Do NOT skip to Unicode.

Ensure the HTML `<head>` contains:
```html
<script src="https://unpkg.com/lucide@1.8.0/dist/umd/lucide.min.js"></script>
```

And before `</body>`:
```html
<script>lucide.createIcons();</script>
```

Then use icons as:
```jsx
<i data-lucide="search" style="width:20px;height:20px;display:inline-block"></i>
```

Common Lucide names: `search`, `chevron-down`, `chevron-right`, `x`, `check`, `plus`, `minus`, `menu`, `bell`, `settings`, `user`, `home`, `arrow-left`, `arrow-right`, `edit`, `trash`, `eye`, `calendar`, `clock`, `filter`.

### Tier 3: Omit Uncertain Icons

If an icon concept is needed and no bundle or Lucide equivalent is evidenced, omit the uncertain icon slot. Do not use Unicode glyphs, text arrows, CSS pseudo-icons, or inline `<symbol>` libraries in UI Kit output.

### Segmented / Grouped Controls

When evidence shows repeated child controls in one grouped row, render a single segmented group with shared borders and evidenced zero/negative gap. Only the first segment keeps left outer radii, only the last segment keeps right outer radii, and middle segments keep square internal corners. Do not render each segment as a standalone rounded button. Do not add arrows/icons unless that segment's own evidence contains the icon part.

### Avoid

- Icon JS libraries when exported SVGs or Lucide CDN images are sufficient
- Large inline SVG path libraries
- **Dynamic icon helper functions** that construct `src` paths at runtime (e.g., `` src={`../../assets/icons/${name}.svg`} ``). Every icon MUST use a static string `src` attribute so the frontend resolver can process it.

## Content Requirements

### Primary Views

Every kit should provide a small set of navigable views with smooth transitions:

| Kit Type | Example Screens |
|---|---|
| `app/` | Home feed → Detail/Product → Cart/Profile |
| `website/` | Hero/Landing → Features/Pricing → Contact/Signup |
| `dashboard/` | Overview → Analytics/Detail → Settings |
| `poster/` | Main composition → Alternate layout → Detail view |

### Brand-Specific Real Content

- Food delivery app → Real dish names, prices, restaurant names
- Finance app → Transaction history, account balances, card details
- Social app → Posts, comments, user profiles with realistic data
- Chinese brand → ALL copy in Chinese, including navigation labels

### Locale-Appropriate Copy

Match the product's language entirely:
- Chinese brand → Chinese text, Chinese currency (¥), Chinese date format
- English brand → English text throughout
- Never mix languages within the same product

## Visual Requirements

### Color Usage Hierarchy

CSS token files often contain multiple variable families (core theme, sidebar, chart, data-visualization, etc.). The UI Kit MUST respect a strict priority hierarchy:

| Priority | Variable Families | Usage Scope |
|----------|------------------|-------------|
| 1 — Dominant (≥80% surface) | `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--accent`, `--border`, `--ring`, `--input`, `--destructive`, `--popover` | Page backgrounds, main surfaces, buttons, text, inputs |
| 2 — Contextual | `--sidebar-*` | Only inside sidebar/nav panel containers |
| 3 — Data | `--chart-*`, `--data-*` | Only inside chart/visualization elements |

**Rules:**
1. Priority 1 variables define the page's dominant visual emotion.
2. Priority 2-3 variables MUST NOT appear outside their designated context.
3. `color-mix()`, gradients, and opacity overlays on Priority 2-3 tokens as page-level styling is FORBIDDEN.
4. If the token file has dark/light themes, pick ONE theme consistently — do not mix light-mode core with dark-mode sidebar tokens.

**Coherence Check:**

The UI Kit must "feel like" the component library (as expressed by `components.css` classes and the brand docs):
- Same dominant hue family
- Same saturation level
- Same accent placement pattern (sparse, not tiled)
- Same contrast level (dark = dark, light = light)

If the Kit looks like a different product from the component library, it is WRONG.

## Layout Overflow Guard

The generated UIKit should satisfy a static layout guard. Violations are reported as warnings, not blocking failures, because visual layout hints should prevent avoidable overflow without forcing full-page regeneration. This guard exists to prevent CJK labels, timestamps, toolbar controls, sidebar titles, and audit metadata from wrapping into visually broken narrow columns or escaping their cards.

Required root marker:

```html
<div class="uikit-shell" data-layout-guard="uikit-v1">
```

Required page-level CSS classes:

```css
.uikit-shell {
  width: 100%;
  max-width: 1184px;
  margin: 0 auto;
  overflow: hidden;
}
.uikit-sidebar,
.uikit-main,
.uikit-toolbar {
  min-width: 0;
}
.uikit-sidebar {
  overflow: hidden;
  max-width: 100%;
}
[data-component] {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}
.uikit-truncate {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.uikit-nowrap {
  white-space: nowrap;
  flex-shrink: 0;
}
.uikit-responsive-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 16px;
  min-width: 0;
}
.uikit-table-wrap {
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
.uikit-action-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 160px;
  overflow: hidden;
}
.uikit-action {
  min-width: 0;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

**Component containment rule**: The `[data-component]` selector ensures ALL design-system components are contained within their grid cell. Components from `components.css` may declare explicit `width` values (e.g., `sidebar-shell.default{width:288px}`, `table-card{width:1200px}`). Without containment, these overflow the layout grid. This rule prevents overlap between siblings without overriding the component's internal styling.

Hard layout rules:

- The target desktop viewport for UI Kit generation is 1184px, matching the frontend Component tab iframe canvas (`componentList` max 1184px, full width with no preview padding). All desktop grids must fit this width before responsive breakpoints apply.
- Do not design a wider virtual canvas and shrink it with `transform: scale(...)`, `zoom`, iframe scaling, or page-level scaling. The UIKit must fit natively at 1184px so text and controls remain legible.
- Responsive behavior is mandatory. 1184px is the desktop baseline, not a fixed-only canvas.
- At `max-width: 900px`, multi-column shells MUST collapse to one content column or compact rail + content.
- At `max-width: 640px`, cards/toolbars MUST stack, optional sidebars MUST collapse above content, and dense tables MUST use `.uikit-table-wrap` horizontal scroll or card rows.
- Multi-column shell/content grids MUST use `minmax(0, 1fr)` for flexible content columns.
- Reusable responsive grids MUST use `.uikit-responsive-grid` or equivalent `auto-fit`/`minmax(min(100%, Npx), 1fr)` behavior.
- Dense tables MUST be wrapped in `.uikit-table-wrap`; columns may keep an evidenced `min-width` and scroll horizontally instead of squeezing text.
- Every flex/grid child that contains dynamic text MUST have `min-width: 0`.
- Sidebar titles, nav labels, search labels, filter buttons, badges, timestamps, table cells, and audit metadata MUST use `.uikit-truncate` or `.uikit-nowrap`.
- Table/list action cells MUST use `.uikit-action-cell`; each data row may show at most one text action plus one compact icon/overflow action. Do not stack multiple full-width buttons inside one cell.
- Text actions inside constrained cells MUST use `.uikit-action` or equivalent ellipsis behavior.
- Controls with 2+ CJK characters MUST never collapse into stacked vertical glyphs. Give them sufficient width or truncate with ellipsis.
- Do not use `position:absolute`, fixed `left/top`, or transforms for normal text layout. Use flex/grid flow.
- If the content cannot fit, reduce copy length or data density. Do not let text cross card, toolbar, or sidebar boundaries.

### Phone Frame (for `app/` type)

```css
.phone-frame {
  width: 412px;
  height: 780px;
  border-radius: 40px;
  border: 8px solid var(--inverse-surface);
  overflow: hidden;
  position: relative;
  box-shadow: var(--shadow-5);
}
```

- The snippet above demonstrates required dimensions and structure. Colors and shadows MUST be replaced with tokens from `colors_and_type.css`.
- The direct child container inside `.phone-frame` MUST include `border-radius: inherit` to prevent corner bleed where the white background leaks outside the rounded border at bottom-left and bottom-right corners (a known CSS rendering issue with `overflow: hidden` + `border-radius` + absolutely-positioned children).
- Status bar with time, battery, signal icons
- Rounded corners matching modern phone bezels
- Bottom home indicator bar

### Interaction States

Every interactive element MUST show:
- **Hover**: Overlay with `var(--state-hover)` background shift
- **Focus**: 2px focus ring using `var(--accent)` + 2px offset
- **Press/Active**: Ripple effect or scale(0.97) transform
- **Disabled**: 0.5 opacity + `cursor: not-allowed`

### Page Navigation

- Smooth transitions between screens (slide, fade, or scale)
- Use CSS transitions or React state-driven animations
- Navigation state managed via React `useState`
- Back navigation support where appropriate

## Kit Type Variations

### `app/` — Mobile Application
- Phone frame wrapper (required); the ~390px frame interior is the design canvas — design mobile-first inside it, never stretch content toward the 1184px stage
- Bottom navigation bar (3-5 tabs)
- Prefer 3 screens with tab-based or stack navigation
- Screen anatomy: status bar → header → scrollable body → bottom nav → home indicator; header/nav never scroll away
- Primary CTA must be a whitelisted component class from `components.css` (page-layer CSS may position/enlarge it, but the class identity comes from the component library)
- Photo/media slots (photo cards, galleries, banners) use real generated images (`text_to_image` endpoint), never a lone icon centered in an empty media box
- Pull-to-refresh indication (visual only)
- Sticky header with scroll behavior

### `website/` — Desktop/Responsive Website
- Full-width layout, max-width constrained
- Hero section with CTA
- Feature sections with illustrations/icons
- Pricing table or comparison
- Footer with links
- Responsive behavior at key breakpoints

### `dashboard/` — Admin/Analytics Panel
- Sidebar navigation (collapsible)
- Header with user avatar, search, notifications
- Data cards with metrics
- Table or list views
- Chart placeholders (CSS-only bar/donut charts)
- Filter/action bars

### `poster/` — Visual Composition
- Large-format visual layout
- Minimal interaction (hover reveals, parallax)
- Typography-heavy composition
- Color blocking and visual hierarchy demonstration
- Suitable for print-inspired digital pieces

## Reference Implementation Policy

The kit directory contains only `index.html` by default. Component implementations are embedded inside that file so the kit remains portable and runnable without a build step.

Rules:
- Do NOT output extra `.jsx` files unless the user explicitly requests reference code
- Do NOT import local files from `index.html`
- If reference code is requested later, generate it through an incremental workflow and update documentation accordingly

## Anti-Patterns

| ❌ NEVER DO | ✅ INSTEAD |
|---|---|
| Generic labels ("Button", "Card Title") | Real product content ("加入购物车", "¥28.00") |
| Lorem ipsum filler text | Contextually appropriate copy |
| Flat grid of components | Interactive multi-screen application |
| English text for Chinese products | Match product language entirely |
| Import external .jsx from index.html | Inline all code in index.html |
| Placeholder images with gray boxes | App kits: real `text_to_image` images; other kits: CSS gradient or emoji representations |
| Static non-interactive mockup | Full hover/focus/active states |
| Single screen with no navigation | A small set of navigable views with transitions |
