# Phase 3 — Component Synthesis (Intent + Preview)

> **Used by**: Phase 3 component intent and preview generation. One sub-agent per core preview component, up to 3 in parallel.
> **Dispatch method**: FULL QUERY DISPATCH. Main Agent extracts the Instruction Body below, replaces `{Name}`, `{slug}`, `{output_dir}`, `{SKILL_DIR}` with resolved values, and passes the expanded body verbatim as the Task query. The sub-agent does NOT read this file (see `workflows/create-library.md` § 3.1).

---

## Instruction Body

Main Agent replaces these placeholders with resolved values before dispatching the expanded body as the Task query:
- `{Name}` → component display name
- `{slug}` → component slug
- `{output_dir}` → resolved absolute output path
- `{SKILL_DIR}` → absolute path to the design-library-creator skill

~~~
You are a Design System Architect + Preview Renderer. Generate intent JSON and preview HTML for component "{Name}" (slug: {slug}).

## Input Files (Read in order; paths are absolute; do not search)

Read only the files listed below. Do not perform web research, directory discovery, output directory inspection, same-family component lookup, or generated preview read-back. Brand/product copy must come only from final-state `renderFacts.controlMatrix`, `renderFacts.patterns`, or conservative accessibility labels required by semantic HTML.

1. {output_dir}/components/_evidence/{slug}.json — Figma-derived render contract
2. {output_dir}/colors_and_type.css — CSS variable definitions (SSOT for all allowed variables)
3. {output_dir}/components/_evidence/index.json — library context
4. {SKILL_DIR}/examples/templates/specimen-reference.html — preview HTML structure reference
5. ReturnReportFileAbs: {ReturnReportFileAbs} (Main Agent replaces this with the actual hidden `{tmp_dir}/agent-reports/...` path before dispatch)

If file 1 returns NotFound → write {"error":"evidence-missing","writtenFiles":[],"warnings":["FATAL:evidence-not-found"]} to ReturnReportFileAbs → STOP with `未能完成组件预览。`
If file 2 returns NotFound → write {"error":"css-file-missing","writtenFiles":[],"warnings":["FATAL:css-not-found"]} to ReturnReportFileAbs → STOP with `未能完成组件预览。`

## Output 1: Intent JSON → {output_dir}/components/{slug}.json

Generate this JSON directly. Use the exact field names below. If evidence is incomplete, write the best evidence-backed value instead of omitting the field.

```json
{
  "slug": "string — preserve the original slug",
  "name": "string — clean English name",
  "category": "Action | Display | Overlay | Form | Navigation | Feedback",
  "summary": "string — one sentence from evidence",
  "controlMatrix": {
    "sizes": [{"name": "string", "height": "number", "padding": "string CSS value", "fontSize": "number", "cssHeight": "var(--name) from colors_and_type.css"}],
    "states": [{"name": "string", "cssBackground": "var(--name)", "cssColor": "var(--name)", "opacity?": "number", "cursor?": "string"}],
    "variants": [{"name": "string", "cssBackground": "var(--name) or transparent", "cssBorder": "string or none", "cssColor?": "var(--name)"}],
    "semanticKinds?": [{"name": "string", "cssBackground": "var(--name)"}]
  },
  "geometry": {"radius": "var(--name) or literal px", "gap": "number"},
  "patterns": "pass-through from evidence.renderFacts.patterns with CSS variable resolution",
  "contentPolicy": "pass-through from evidence.renderFacts.contentPolicy",
  "renderObligations": ["string[] — merge evidence obligations + preview-specific layout instructions"],
  "iconSlots": "pass-through from evidence.renderFacts.iconSlots",
  "uiCopySamples": ["string[] — from evidence text or conservative labels"]
}
```

## Intent Rules

Evidence priority: require `evidence.contractKind === "llm-render-facts"` and `evidence.schemaVersion >= 6`. Consume `evidence.renderFacts` as the ONLY source.
If `evidence.renderFacts` is missing, STOP with {"error":"invalid-evidence-contract","warnings":["FATAL:renderFacts-missing"]}.
Consumption order: `identity` → `controlMatrix` → `patterns` → `geometry` → `contentPolicy` → `renderObligations` → `iconSlots` → `unknowns`.

- name: remove emoji prefixes and CJK suffixes; use title case
- category: map from `evidence.renderFacts.identity.normalizedKind` and `evidence.renderFacts.intentKind`:
  button/link/toggle → Action | card/list/table/avatar/badge/tag/statistic/progress → Display |
  modal/dialog/drawer/popover/tooltip/dropdown → Overlay | input/select/checkbox/radio/switch/slider/form/datepicker/timepicker → Form |
  tabs/menu/breadcrumb/pagination/steps/anchor/navigation/nav → Navigation | alert/message/notification/result/skeleton/toast/banner → Feedback
- controlMatrix: pass through from `evidence.renderFacts.controlMatrix`, then resolve each raw hex value to its CSS variable from colors_and_type.css. Add `css*` prefixed fields (cssBackground, cssColor, cssBorder, cssHeight) with `var(--name)` values. Keep numeric fields (height, padding, fontSize) as-is for reference.
- geometry: take `evidence.renderFacts.geometry.radius` and resolve to CSS variable. Keep gap as literal.
- patterns: pass through from `evidence.renderFacts.patterns`. For tableModel/listModel, resolve any hex colors to CSS variables.
- contentPolicy: pass through verbatim from `evidence.renderFacts.contentPolicy`.
- renderObligations: start with `evidence.renderFacts.renderObligations`, then append 1-2 preview-layout-specific instructions (e.g., "Render sizes as horizontal strip", "Show variants as rows").
- uiCopySamples: collect text from `evidence.renderFacts.controlMatrix` entries that have text evidence, or from pattern examples. Never use variant names as product copy.
- sourceRefs: `evidence.renderFacts.sourceRefs` are traceability hints only, not generation sources. Never use sourceRefs to override identity, controlMatrix, patterns, or icon-slot facts.
- Compactness: Intent JSON should preferably be minified on one line and retain high-signal semantic guidance. Correctness and evidence fidelity outrank byte size.

### CSS Variable Resolution (MANDATORY for controlMatrix and Preview HTML)

All `var(--name)` references in intent JSON and Preview HTML MUST come from `colors_and_type.css`. Resolution method:

1. Read `colors_and_type.css` thoroughly — this is the SINGLE SOURCE OF TRUTH for variable names.
2. Match `controlMatrix.states[*].background` hex to `var(--name)` → write as `cssBackground`.
3. Match `controlMatrix.variants[*].background` hex to `var(--name)` → write as `cssBackground`.
4. Match `geometry.radius` to nearest radius variable.
5. **Never** use raw hex values or invented variable names. Every color and tokenized visual value must resolve to a `var(--name)` defined in colors_and_type.css. For exact evidence geometry (radius, size, padding, gap), use the matching CSS variable when one exists; otherwise preserve the source value as a literal px value instead of substituting an unrelated token.
6. **Never** assume a variable exists just because it "sounds right" (e.g., do not invent `--bg-brand-hover` unless you verified it is declared in the CSS file).
7. **Never** declare component/page-level CSS custom properties in preview HTML. Banned examples include `--btn-bg`, `--btn-fg`, `--btn-border`, `--btn-bg-hover`, `--card-bg`, `--sidebar-active`, and any `--{component}-*` alias. If the evidenced color exists in `colors_and_type.css`, use that declared variable directly. If no declared variable matches, use the closest declared variable and return a warning; do not define a local alias and do not write raw hex.

### Worked Example — Intent JSON for "Button"

Given v6 evidence with `renderFacts.identity.normalizedKind: "button"`, `renderFacts.controlMatrix.sizes` listing mini/small/medium/large with paired height/padding/fontSize, `renderFacts.controlMatrix.states` with default/hover/disabled, `renderFacts.controlMatrix.variants` with primary/secondary/outline/text, and `renderFacts.geometry.radius: 2`.

And given `colors_and_type.css` contains: `--brand-6: #165dff; --brand-5: #4080ff; --brand-3: #94bfff; --text-white: #ffffff; --fill-2: #f2f3f5; --text-1: #1d2129; --radius-sm: 2px; --control-height-mini: 24px; --control-height-sm: 28px; --control-height-md: 32px; --control-height-lg: 36px;`

```json
{
  "slug": "button",
  "name": "Button",
  "category": "Action",
  "summary": "Four-tier action hierarchy with 2px radius, 4 sizes, and verified hover/disabled states.",
  "controlMatrix": {
    "sizes": [
      {"name": "mini", "height": 24, "padding": "2px 12px", "fontSize": 12, "cssHeight": "var(--control-height-mini)"},
      {"name": "small", "height": 28, "padding": "3px 16px", "fontSize": 14, "cssHeight": "var(--control-height-sm)"},
      {"name": "medium", "height": 32, "padding": "5px 16px", "fontSize": 14, "cssHeight": "var(--control-height-md)"},
      {"name": "large", "height": 36, "padding": "7px 20px", "fontSize": 14, "cssHeight": "var(--control-height-lg)"}
    ],
    "states": [
      {"name": "default", "cssBackground": "var(--brand-6)", "cssColor": "var(--text-white)"},
      {"name": "hover", "cssBackground": "var(--brand-5)", "cssColor": "var(--text-white)"},
      {"name": "disabled", "cssBackground": "var(--brand-3)", "cssColor": "var(--text-white)", "opacity": 0.4, "cursor": "not-allowed"}
    ],
    "variants": [
      {"name": "primary", "cssBackground": "var(--brand-6)", "cssBorder": "none"},
      {"name": "secondary", "cssBackground": "var(--fill-2)", "cssBorder": "none", "cssColor": "var(--text-1)"},
      {"name": "outline", "cssBackground": "transparent", "cssBorder": "1px solid var(--brand-6)", "cssColor": "var(--brand-6)"},
      {"name": "text", "cssBackground": "transparent", "cssBorder": "none", "cssColor": "var(--brand-6)"}
    ]
  },
  "geometry": {"radius": "var(--radius-sm)", "gap": 8},
  "contentPolicy": {"allowedModes": ["real-text", "repeat-evidence-text"], "forbiddenModes": ["skeleton-bars", "invented-product-data"]},
  "patterns": {},
  "renderObligations": [
    "Render all 4 sizes as horizontal strip using controlMatrix.sizes",
    "Show primary/secondary/outline/text as separate scenario rows",
    "Use :hover/:disabled pseudo-classes with controlMatrix.states",
    "Radius is var(--radius-sm); no box-shadow"
  ],
  "iconSlots": [],
  "uiCopySamples": ["Button Text", "Submit", "Cancel", "Save"]
}
```

This example shows: (1) controlMatrix uses the EXACT CSS variable names from colors_and_type.css; (2) geometry resolves radius to a declared variable; (3) renderObligations merge evidence constraints with preview-layout instructions; (4) UI copy comes from evidence text, not variant names.

## Output 2: Preview HTML → {output_dir}/preview/component-{slug}.html

The CSS link must be exactly:

```html
<link rel="stylesheet" href="../colors_and_type.css">
```

### CSS Marker Convention (MANDATORY)

The `<style>` block MUST separate page scaffold from component CSS using markers:

```html
<style>
  /* Page scaffold — not extracted */
  *{box-sizing:border-box;margin:0}
  body{...}
  .specimen{...}
  .header{...}
  .stage{...}
  .story{...}
  .rail{...}
  .story-label{...}

  /* @component-css-start */
  .btn{...}
  .btn.primary{...}
  .size-lg{...}
  /* @component-css-end */
</style>
```

ALL component class definitions go BETWEEN `/* @component-css-start */` and `/* @component-css-end */`. A deterministic script extracts this section into `components.css` for UIKit consumption.

### Intent-Mode Rendering Rules (mandatory)

1. Token-only colors: every color MUST use `var(--name)` defined in colors_and_type.css. Match evidence raw hex values to declared CSS custom properties. Never use hex fallback, raw RGB/HSL color literals, or invented variable names. Geometry may use literal px only when no exact declared variable exists.
2. Variable allowlist: every `var(--name)` in Preview HTML must be defined in colors_and_type.css. Do not declare or use local CSS variable aliases such as `--bd`, `--rad`, `--bg2`, `--brand`, `--btn-bg`, `--btn-fg`, `--btn-border`, or any component-scoped `--{component}-*` token. The preview `<style>` block must not contain CSS custom property declarations at all; it may only consume variables from `../colors_and_type.css`.
3. Final-state renderFacts consumption order: read `evidence.renderFacts` FIRST and use it as the only generation source. It contains `identity`, `intentKind`, `controlMatrix`, `patterns`, `geometry`, `contentPolicy`, `renderObligations`, `iconSlots`, `icons`, `sourceRefs`, and `unknowns`. `renderFacts.identity.sourceName` is the authoritative Figma/category component identity.
3b. ControlMatrix as preview source of truth: `intent.controlMatrix` drives all rendered specimens. `controlMatrix.sizes` must drive height, padding, and font-size. `controlMatrix.states` must drive pseudo-class colors/borders; do not replace them with `filter: brightness(...)` or generic opacity. `controlMatrix.variants` decide variant specimen selection. Follow `intent.renderObligations` for all layout and forbidden-style constraints.
4. Source refs are traceability only: do not search for or infer missing raw `visualSpecs`, `semanticRefs`, `renderPlan`, or `evidenceQuality`. If a fact is absent from renderFacts, treat it as unknown and render conservatively.
5. Interactive states: clickable elements must include `:hover`, `cursor:pointer`, and `transition`. Use `opacity:.4; cursor:not-allowed; pointer-events:none` for `:disabled`. `:focus-visible` must use an existing allowlisted variable for outline color, preferring border/color tokens whose names include `focus`, `brand`, `primary`, or `accent`. If no suitable token exists, use `outline:2px solid currentColor; outline-offset:2px`; do not invent variables.
6. Do not simulate states with static `.hover`, `.press`, or `.focus` classes. Use CSS pseudo-classes.
7. Preview Composition Model: Preview is a component specimen surface, not documentation, diagnostics, or a raw evidence dump.
   - Render the component samples/scenes only. Do not add explanatory cards, "reserved axes", token notes, missing-coverage notes, evidence warnings, variant-axis inventories, or prose sections that are not themselves component UI.
   - Every visible block must be either a rendered component sample, a compact sample label, or a minimal layout wrapper required for comparison.
   - Do not make one row per variant entry unless that variant is itself a distinct visual/component scenario.
   - Every rendered evidence-backed cell or scene wrapper must include `data-evidence-sample="..."` using the variant or size `name`.
8. Simple components use scenario-grid. Simple examples include `button`, `tag`, `badge`, `link`, `switch`, `checkbox`, `radio`, `progress`, and `avatar`.
   - Read `intent.controlMatrix`; render sizes as density strip, variants as rows.
   - Columns: information density / delta. Preferred columns are full, standard, compact, and state/delta.
   - Use `intent.controlMatrix.sizes` and `intent.controlMatrix.variants` as specimen selection.
   - If a row/column combination has no evidence, leave it out; do not fabricate.
   - Button rows should express primary action, secondary action, quiet/text action, and danger action when evidenced. Do not create separate rows for Medium/Large/Small/Mini when they repeat the same semantic action; show sizes as a horizontal density strip inside the relevant scenario.
   - Tag rows should express neutral classification, colored category, add-tag affordance, and danger/warning label when evidenced. Do not make Tag look like Button; if semantic HTML uses `<button>`, visual treatment still follows tag evidence.
9. Complex components use two-scene primary-plus-delta. Complex examples include `input`, `table`, `select`, `menu`, `tabs`, `card`, `list`, `form`, `datepicker`, `dropdown`, `modal`, and `drawer`.
   - Read `intent.patterns.tableModel`/`listModel`/`toggleModel`/`componentAnatomy` for structure; use `intent.controlMatrix` for density.
   - Scenario 1 = canonical/default product usage.
   - Scenario 2 = the most visually or structurally distinct evidenced usage.
   - Inside each scenario, show only meaningful deltas needed to explain the component.
   - Input: show standard text entry as one scene; show assisted entry with affix/action/textarea as the second scene when evidenced. Sizes/states belong in compact strips; never mix single-line input, icon-only control, action input, and textarea as equal siblings in one rail.
   - Table: show one complete table scene plus one density/state/selection delta. Render `<tbody>` rows ONLY from `intent.patterns.tableModel.rows`; do not invent extra row content when `intent.contentPolicy.forbiddenModes` contains `invented-product-data`.
   - Select: show closed field scene plus dropdown/list scene when evidenced.
   - Menu/Tabs: show active navigation scene plus nested/overflow/state delta.
   - Do not place structurally different families into one flex rail.
10. Structures: render evidence-backed samples as real interactive HTML elements. Do not invent unsampled variants. Keep HTML concise; only drop samples that do not add a new scenario or information dimension, and report `dropped-render-sample:{slug}` when dropping an evidenced sample.
10b. Geometry fidelity: component-specific geometry from `intent.geometry` and `intent.controlMatrix.sizes` is authoritative for rendered samples. Exact radius, padding, gap, width, and height MUST be preserved via matching CSS variables from `colors_and_type.css` or literal px values when no matching variable exists. Do not replace a component's evidenced radius with a brand-summary radius, and do not use README/SKILL narrative radius to override per-component evidence.
10c. Composite action fidelity: when evidence shows a control/action/badge made from multiple semantic parts (for example icon instance + text frame, logo + label, leading/trailing icon slots, or stacked primary/secondary text), preserve that nested composition and axis direction. Do not flatten multi-part controls into a generic single-line button, and do not drop evidenced icon/text subparts merely because the sample still behaves like a button.
10d. Segmented group fidelity: when `intent.patterns.segmentedGroups` is present, it is the SSOT for grouped/segmented controls. Render one shared group, not separated standalone buttons. Preserve its `axis`, `gap`, `sharedBorder`, `segmentCount`, and every segment's `padding`, `radius`/`borderRadii`, exact `text`, and icon presence. First segment keeps only left outer corners, middle segments have square internal corners, and last segment keeps only right outer corners. If `controlMatrix.sizes[*].widthPolicy` or `segments[*].widthPolicy` is `content-hug`, do NOT write fixed inline widths; use padding/min-width and let text render fully. Do not add leading/trailing icons to segments unless `intent.iconSlots` or that exact segment's `hasIcon` proves it.
10e. List pattern fidelity: when `intent.patterns.listModel` is present, it is the SSOT for list/table-like repeated item anatomy. Convert each pattern directly into intent with `header`, repeated `item`, `item.slots`, `itemExamples`, `hasDividers`, and disabled state. Preserve leading/content/trailing slots, evidenced item gaps/padding/radius, dividers, header/link rows, and disabled styling. Do not flatten a list into a generic card, and do not invent icons or trailing values outside the pattern examples.
10e-2. Repeated item state fidelity: when `intent.patterns.listModel.itemStates` is present, it is the SSOT for active/default/selected/disabled item styling. Preserve text `color`, `fontWeight`, item `background`, `border`, and `opacity` exactly through CSS variables or literal values from evidence. Active/default differences must be visible in text styling when provided; do not express active state only through icons or container color. Render icons only from `listModel.itemSlots[*].iconName`, `listModel.itemExamples[*].leadingIcon/trailingIcon`, `intent.iconSlots`, or exact segmented-group icon facts; never infer icons from global availability.
10f. Table pattern fidelity: when `intent.patterns.tableModel` is present, it is the SSOT for data-table anatomy. Render table headers from `tableModel.columns` and rows from `tableModel.rows`. Preserve column widths/roles, header text, selection columns, inline controls, status/badge cells, action cells, pagination/footer, and row height. A column with `role:"selection"` MUST render checkboxes only; never render switch/toggle unless that exact cell's `controls` includes `"toggle"`. `columnId` must be unique; if evidence has duplicate ids, suffix with the column index in HTML and return warning `duplicate-table-column-id:{slug}`. If `contentPolicy.forbiddenModes` contains `invented-product-data`, cell text must come from `rows[*].cells[*].texts`, `columns[*].sampleValues`, or `uiCopySamples` only.
10f-2. Placeholder substitution (MANDATORY for Preview HTML): Evidence-derived `sampleValues` and `tableModel.rows[*].cells[*].texts` may contain Figma master-component placeholders that MUST NOT appear verbatim in rendered Preview HTML. Known placeholders (case-insensitive exact match): `Button text`, `Badge text`, `Label`, `Placeholder text`, `Text`, `Input text`, `Helper text`, `Link text`. When rendering a Preview HTML specimen that encounters a known placeholder in cell text or button label: (a) Substitute a contextually appropriate word/phrase based on the column `role` or slot function: role=action → "View", "Edit", "Delete", "Details"; role=status → "Active", "Pending", "Completed", "Failed"; badge slot → "New", "Pro", "Beta", "Verified"; generic button → "Submit", "Save", "Cancel", "Apply". (b) Substitutions replace UI-chrome labels only; they do NOT introduce invented product/business data (which remains forbidden by `contentPolicy.forbiddenModes`). (c) Intent JSON `sampleValues` pass through evidence AS-IS — substitution happens ONLY at render time.
10g. Composition zone fidelity: when `intent.patterns.zoneLayout` is present, it is the SSOT for component spatial layout. Each zone represents a distinct area of the component. Use zone geometry to set width/height/padding/background/border for that area. Use zone contentType to decide what kind of content to render inside. When a zone has a patternRef, consume `intent.patterns.listModel` or `intent.patterns.tableModel` for that zone's content structure. Layout type dictates the overall arrangement: `sidebar-main` → CSS grid with fixed sidebar width + fluid main area; `split-panel` → CSS grid with splitRatio; `header-body-footer` → flex column with fixed header/footer + fluid body; `stacked` → flex column with each zone as a section. Respect layout gap between zones. Do not flatten a multi-zone component into a single column unless at the responsive breakpoint (460px).
10g-2. Component anatomy fidelity: when `intent.patterns.componentAnatomy` is present, it is the SSOT for generic composite structure. Render from `componentAnatomy.scenarios[*].root.children` and preserve slot hierarchy, `role`, `box`, `container`, `textStyle`, `iconName`, and action/media/avatar slots. Do not infer a component family layout from the slug when anatomy exists; `componentAnatomy` is more authoritative than generic card/menu/list assumptions, while `tableModel`, `segmentedGroups`, `toggleModel`, and `listModel` remain stronger specialized models.
10g-3. Child component binding fidelity: when a slot in `componentAnatomy` or an item slot's `structure` in `listModel` has a `componentRef` field, it is the authoritative specification for which child component variant to render at that position. Use the exact `componentRef.slug` component with the specified `componentRef.variant` (maps to CSS class like `.btn.primary`, `.tag.success`) and `componentRef.size` (maps to size class like `.size-sm`, `.size-lg`). If `componentRef.overrides` contains text content (e.g., `{"label": "Submit"}`), use it as the child component's display text. NEVER substitute a different variant or size than what `componentRef` specifies — doing so is a fidelity violation equivalent to inventing unsampled content.
10h. Templated list handling: when a listModel entry has `isTemplated: true`, the evidence `itemExamples` are placeholder text (often "List item 1" repeated). In this case: use `intent.patterns.listModel[n].itemExamples[*].texts[*].text` if they are diverse (different content per example). If all examples have identical text, generate 3-6 contextually appropriate items based on the component's `intentKind` and zone role. For a navigation sidebar, use common dashboard section names (Dashboard, Analytics, Users, Products, Settings). For a data list, use generic but varied data entries. Preserve the slot structure exactly (leading icon + content + trailing) — only replace text.
10h-2. Navigation icon diversification: when a `navigation` component's `listModel.itemExamples` all share the same `leadingIcon` value (e.g., all "check-circle"), it indicates that the evidence captured a structural placeholder rather than the actual per-item icons. In this case: assign a distinct Lucide icon to each rendered nav item based on its text label semantics. Use this mapping as guidance: Dashboard→`layout-dashboard`, Analytics→`bar-chart-2`, Users→`users`, Products→`package`, Settings→`settings`, Messages→`mail`, Reports→`file-text`, Support→`headphones`, Overview→`globe`, Pages→`file`, Ecommerce→`shopping-bag`, Docs→`book-open`, Components→`layers`, Help→`help-circle`, Team→`users-2`, Billing→`credit-card`, Invoice→`receipt`, Transactions→`arrow-left-right`. For labels not in this list, choose the closest semantic Lucide icon. Never repeat the placeholder icon for all items — icon diversity is required for navigation fidelity.
10i. Structural state hints: when `intent.controlMatrix.states` includes interactive states, use them as the source for pseudo-class styling. Apply hover/active/disabled CSS using the declared `cssBackground`, `cssColor`, `opacity`, and `cursor` values. Follow `intent.renderObligations` for any layout or styling constraints that override default behavior.
10j. Layout regions: when `intent.patterns.zoneLayout` describes top-level spatial zones, use this as a quick layout reference. Each zone's `dominantContent` hints at what to render: `navigation` → nav list with icons; `data-table` → table/grid structure; `card-grid` → responsive card layout; `form` → form inputs; `text` → heading + body text; `mixed` → multiple content types in sequence.
10k. State detection: when `intent.controlMatrix.states` contains only a default state with no hover/disabled, provide standard `:hover`/`:active` based on the component's `intentKind`. For components with explicit states, use exactly the values declared in `controlMatrix.states`.
11. Responsive: add a single-column fallback with `@media (max-width:460px)`.
12. Constraints: no page header/theme toggle. JavaScript allowed for interactions (tabs, toggles, dropdowns). Prefer compact HTML, but information architecture wins over raw byte count.
13. Icons: consume `intent.icons.bundle` ONLY for literal files that exist in `assets/icons/{name}.svg`; consume `intent.icons.lucide` via Lucide CDN. Never create a local `../assets/icons/{name}.svg` reference when the matching `intent.iconSlots[*].fallback` is not `bundle`. Never use unicode symbols or emoji as icon substitutes.
13b. Icon anatomy fidelity: `intent.icons` is an availability list, not permission to place every icon everywhere. Render icons only for slots listed in `intent.iconSlots` or exact pattern segment facts. For button/button-group variants, do not globally apply arrow-left/arrow-right to all buttons just because those icons appear in availability. If the evidence proves an icon slot but the original icon name is uncertain, preserve the slot's exact size and render `intent.icons.unknownFallback` (default `circle-help`); do not draw dots, Unicode, text, CSS pseudo-icons, or invented fallback icons.
14. Template conformity: follow specimen-reference.html structure: `.specimen`, `.header`, `.stage`, `.story`, `.rail`; `.story-label` stays in the fixed 92px label column and must wrap or clip inside that column, never overlap the `.rail`. specimen-reference.html is structure-only. Do not copy its CSS variable names; variables must come from this library's colors_and_type.css.
15. Copy fidelity: use intent.uiCopySamples or evidence UI copy as display copy. Never use variant names or size names as button/tag copy.
16. Pill content: `.pill` is optional and must be attached to a rendered component sample. It may describe a verified visual delta only when CSS tokens prove that value. Do not render standalone pill groups, raw variant counts, axis lists, token notes, or explanatory bullet lists.
17. Alignment: compact controls must use `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`; flex text children need `min-width:0`; items in the same rail must be vertically centered.
18. Accessibility: use semantic HTML or roles. Tab groups must use `role="tablist"` / `role="tab"` / `aria-selected`; disabled buttons must use the `disabled` attribute.

## Hard Constraints

- Forbidden tools (per SKILL.md invariant #16, plus web): TodoWrite, Skill, Grep, RunCommand, SearchCodebase, WebSearch, WebFetch
- Read: UNLIMITED. Read all input files thoroughly. Accuracy is the priority — do not skip reads to "save budget".
- LS/Glob: Allowed within {output_dir}/components/ and {output_dir}/preview/ for discovery when needed (declared template exception to #16).
- REASONING BUDGET: Do not draft the full intent JSON or preview HTML in hidden reasoning. Use required evidence/CSS reads, preserve fidelity, write once, and report non-blocking uncertainty in `warnings[]`.
- Keep intent JSON compact, but there is no hard byte cap; Preview HTML should stay concise without sacrificing scenario/information structure.
- STOP immediately after writing. Do not verify or read back.
- The sub-agent must not modify components/index.json
- NEVER Read the output paths — they do not exist until you Write them
- Write the completion report to ReturnReportFileAbs. Final response must be only `已完成组件预览。`.

## Report File

{"writtenFiles":["components/{slug}.json","preview/component-{slug}.html"],"warnings":[],"undefinedCssVars":0}

Final response MUST NOT be JSON. Use only: `已完成组件预览。`
~~~

---

## Validation Gates (run by Main Agent after all component synthesis tasks complete)

```bash
node {SKILL_DIR}/scripts/validate-intent.mjs --intent-dir {output_dir}/components --vars-file {output_dir}/colors_and_type.css
```

```bash
node {SKILL_DIR}/scripts/check-design-library-phase.mjs {output_dir} --phase preview --files preview/component-{slug1}.html,...
```

Intent validation is advisory by default. Do not retry solely for missing optional intent fields; preview generation may continue.
Preview validation is a deterministic reporting step, not a regeneration trigger.
Do not dispatch component retry/fallback tasks for preview fidelity, missing optional intent fields, sample count, radius/shadow/style mismatch, or other quality concerns.
Only objective runtime blockers may stop the phase: missing preview file, broken stylesheet link, invalid JSON parse, or undefined CSS variables.
If a runtime blocker remains, report the compact validator output and stop; do not synthesize a fallback component in the Main Agent.
