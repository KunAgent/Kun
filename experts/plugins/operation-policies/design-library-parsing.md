# Design Library Parsing & Theme Source Resolution

> This file contains the procedural steps for parsing Design Libraries and resolving theme sources. It is read by the **Main Agent** during pre-execution preparation when a Design Library is detected. Sub-Agents do not read this file — they receive extracted constraints via dispatch parameters.

---

## Theme Source Priority

When determining design constraints, the Agent judges the theme source in the following **strict priority order** from highest to lowest. Design decisions from higher-priority sources override lower-priority ones:

| Priority | Source | Identification Method | Handling Method |
| ----- | ---- | ------- | ------- |
| 1 (Highest) | **Design Library actively selected by user** | Context contains `<referenced_design_library>` or `<editing_design_library>` XML block | Read Library directory, extract design constraints, use as core spec for page generation; DL constraints have the highest authority |
| 2 | **Style/Token directly expressed in user query** | User message contains specific design parameters (HEX color values, font names, spacing values, etc.) or explicit style descriptions (e.g., "Apple minimalist style", "use brand color #FF6B00") | Effective on dimensions not constrained by the DL; when conflicting with DL, default to DL and ask user for confirmation |
| 3 | **Design Library already in use in the project** | When editing existing project, HTML already contains `<style id="theme-vars">` generated from the Library brand CSS file | Follow that Library's design constraints, ensure new/modified content is consistent with existing style |
| 4 | **Historical style continuity anchors in the current project** | Existing `.design`, `pages/*.html`, `colors_and_type.css`, and `orchestration-summary.json.project.styleContinuityAnchors` reveal a stable visual system | Reuse the extracted anchors as project-level style constraints. New pages and page-only edits must inherit color, shape, typography, spacing, component language, and depth rules instead of inventing a new visual brand |
| 5 (Lowest) | **Default path — requires user confirmation** | None of the above four sources exist | **Agent must not decide the theme and generate directly.** Must recommend theme options via AskUserQuestion; generate temporary `colors_and_type.css` after user confirmation |

> **Override rule**: Higher-priority sources only override fields they explicitly specify. For example, if the user only specifies the brand primary color, all other design decisions are still inherited from the Library.
>
> **Continuity override rule**: In multi-turn work, the current query only updates dimensions it explicitly mentions. Example: "make the buttons rounder" may update `shapeSystem`, but must not rewrite the existing color system, typography, spacing density, or component language.
>
> **Multi-device rule**: Mobile, desktop, and tablet variants share the same core color system, typography family, radius scale, and component language. Layout density, type sizes, and navigation form may adapt per device, but the result must not look like different brands.

---

## Historical Style Continuity Anchors (Priority 4)

When no explicit user style and no usable Design Library is available, but the current project already contains design files, the Main Agent must derive `project.styleContinuityAnchors` before dispatching any new page or page edit Sub-Agent.

Read these sources in order:

1. `orchestration-summary.json.project.styleContinuityAnchors` when present.
2. Project `colors_and_type.css` for concrete tokens, typography classes, radius scale, and surface variables.
3. Existing `.design` config and page inventory.
4. Existing `pages/*.html` for implemented header/footer treatment, cards, buttons, forms, lists, spacing rhythm, imagery, and interaction states.

Extract only stable rules that are visibly used in the project:

```json
{
  "colorSystem": "primary/accent/background/text/status colors and gradient rules",
  "shapeSystem": "radius scale, border width, divider, card/button/input shape",
  "typographySystem": "font family, type scale, weights, line heights, title/body/label style",
  "spacingSystem": "page margins, grid, section gaps, card padding, component density",
  "componentLanguage": "button/card/nav/form/list/CTA/icon visual treatment",
  "surfaceAndDepth": "shadow, blur, opacity, layer hierarchy, flat/elevated tendency",
  "imageryAndIconography": "image/illustration/icon style, stroke/fill rules, image crop and radius",
  "interactionTone": "hover/active/focus states, motion restraint, feedback strength"
}
```

Merge rules:

- Preserve existing anchor fields unless the current user query explicitly changes that dimension.
- Do not store unused exploration ideas; after generation, update anchors only from actual landed HTML/CSS.
- If multiple pages were generated, record the shared rule across pages; ignore one-off outliers unless the user explicitly made them global.
- For page-only edits, derive the project's `.design` path from `pages/*.html` before reading/writing anchors, so style memory remains project-level.

---

## Default Path — Theme Recommendation When No Theme Source Exists (Priority 5)

When none of the priority 1~4 sources exist, the Agent must proactively recommend theme options via **AskUserQuestion** based on the user's expressed content, and only generate temporary brand CSS after user confirmation.

**Processing Flow**:

1. **Analyze user expression**: Extract key clues from the user's description — industry type, business scenario, target audience, brand tonality, etc.
2. **Derive theme options**: Based on extracted clues, derive 2~4 differentiated theme directions (including color tone tendency, visual temperament, density style, and other concrete descriptions); present to user for selection via AskUserQuestion
3. **User confirmation**: After user selects, generate **temporary `colors_and_type.css`** based on the selected theme direction. This file maintains unified HTML consumption (same variable naming convention as Design Libraries).
4. **Insufficient information**: If user requirements are extremely vague (e.g., only says "make me a website"), do not skip theme recommendation and generate directly; instead ask the most critical business questions first

> **Core principle**: When no Design Library exists, the brand CSS generated by the Agent must follow the same variable naming convention as Design Libraries (brand prefix + semantic name), ensuring HTML consumption logic has only one path. Theme option generation rules are detailed in `operation-policies/creative-direction.md` "Style Option Generation Constraints" and "Dynamic Style Option Generation Rules".

---

## Design Library Context Parsing

When an XML-tagged design library block appears in context, it indicates a Design Library is active. There are two intent types:

### Referenced (Read-Only) Library

```
<referenced_design_library>
- intent: REFERENCE (read-only)
- name: {library-name}
- id: {library-id}
- path: {library-directory-path}
This Reference Design Library is the primary design constraint source. Read files from the path above to extract design tokens, component specifications, assets, and visual rules.
The Reference Design Library directory is READ-ONLY. Do NOT modify, delete, create, rename, or overwrite any files in this directory.
If the user's intent requires editing, creating, or updating a Design Library, write all final changes to the user's workspace Design Library directory instead.
Never write Design Library edits back into the read-only Reference Design Library directory.
</referenced_design_library>
```

When this block is present, use the library at `{path}` as the authoritative design constraint source. Files in this directory are READ-ONLY — never modify them.

### Editing Library

```
<editing_design_library>
- intent: EDITING (read-write)
- name: {library-name}
- id: {library-id}
- path: {workspace/.design_library/library-name}
You are editing this Design Library. All final library file changes MUST be written to the path above.
This workspace `.design_library/` directory is the only writable destination for Design Library edits.
The Work directory may be used for intermediate artifacts, but the final Design Library output MUST reside at the path above — not in the Work directory, not in the read-only reference library directory.
Read existing files from this path to understand the current library state before making changes.
Additional context:
Design Library selected item:
- type: {theme|color|component|graphic|spec}
- name: {item-name}
- library id: {library-id}
- library name: {library-name}
- file path: {optional, asset file path}
Selected item prompt:
{user-facing prompt describing the selected item and intent}
</editing_design_library>
```

When this block is present, the user is actively editing the library. All final Design Library writes MUST go to the `{path}` specified. Intermediate artifacts may use the Work directory, but the library's final output (CSS, components, previews, docs, etc.) MUST reside under `{path}`.

**`Additional context` handling**:
- When `Additional context:` is present, it lists one or more specific items the user selected via Add to Chat. Multiple items are separated by blank lines within the same block. Use these details to locate and modify only the targeted assets.
- When `Additional context:` is absent, the editing scope is the entire library (the user opened the library detail page without selecting a specific item).
- Multiple selected items from the same library are merged into a single `<editing_design_library>` block rather than producing separate blocks.

**Parsing steps** (completed during `decision-rules.md` pre-execution preparation phase):

### Step 0 — Specs Context Loading (HIGHEST PRIORITY — before all other reads)

Before reading files by the priority table, if the Library contains a `specs/` directory, the Main Agent reads it as the **authoritative design specification source**:

1. **Check existence**: LS `{path}/` — if `specs/` is present, proceed; otherwise skip this step entirely.
2. **LS `{path}/specs/`** — list immediate children (files and directories).
3. **Read top-level `.md` files** (max 5 files, prioritize by name relevance: `guide` > `pattern` > `rule` > `constraint` > `usage` > `convention` > alphabetical).
4. **Read subdirectory index**: For each subdirectory, read up to 1 index/entry file (prefer `index.md` or `README.md` inside it). Max 3 subdirectories.
5. **Token budget**: Total reads in this step must not exceed **8 files** (top-level + subdirectory combined).
6. **Incorporate constraints**: Extracted content is treated as **the highest-priority design specification**, superseding all other Library files (SKILL.md, README.md, preview HTML, component JSON, etc.). When `specs/` content conflicts with any other Library file, `specs/` wins unconditionally.
7. **Pass-through to Sub-Agents**: Implementation-level constraints from `specs/` are distilled into a `specsConstraints` field and passed to Sub-Agents alongside existing dispatch parameters. Sub-Agents MUST treat `specsConstraints` as their top-priority design authority — above preview HTML, component contracts, and UI Kit references.

> **No more root-level scattered files**: User-provided supplementary content MUST reside in `specs/`. The Agent does NOT attempt discovery of unknown files outside `specs/` in the Library root. Only the following known paths are recognized: `SKILL.md`, `README.md`, `colors_and_type.css`, `components.css`, `css.json`, `library-consumption.json`, `uikit-plan.json`, `metadata.json`, `assets/`, `ui_kits/`, `preview/`, `components/`, `specs/`, `context/`.

---

1. **Extract Library metadata**: Parse `name`, `id`, `path` (Library directory path), and `intent` (`REFERENCE` or `EDITING`) from the XML block
   - Also extract `scope` and `version` when present in the XML/context payload. If `version` is not present, read known metadata files during the file-read phase (`metadata.json`, `library-consumption.json`, `package.json`) and look for common fields: `version`, `libraryVersion`, `packageVersion`, `releaseVersion`, `currentVersion`, `current_version`.
   - Persist the resolved identity before dispatching any page Sub-Agent:
     ```json
     {
       "name": "Library display name or null",
       "id": "Library id or null",
       "version": "selected/current version or null",
       "scope": "workspace | custom-global | built-in-global | other | null",
       "path": "/absolute/library/path or null",
       "versionSource": "selected-context | metadata.json | library-consumption.json | package.json | api | null"
     }
     ```
   - Write this object to both `.design.config.designLibrary` and `orchestration-summary.json.designSource.libraryIdentity`. If a field is unavailable, write `null`; do not omit fields. On edits/add-page/redesign, preserve the existing identity unless the active Library context explicitly changes.
2. **Read Library files by priority** (note: `specs/` has already been loaded in Step 0 with absolute highest priority — the table below covers remaining files):

   | Order | File | Content to Read | Required/Optional |
   | --- | --- | --- | --- |
   | 1 | `{path}/SKILL.md` | Brand Essentials (primary color, font, border-radius, density, tonality, semantic variable names) — **this is the primary source for usable CSS variable names** | **Required** |
   | 1 | `{path}/README.md` | Voice & Tone, Visual Foundations, Caveats (font substitution, etc.) — **read at the same priority as SKILL.md** | **Required** |
   | 2 | `{path}/css.json` | Structured token understanding source (colors, font, radius, spacing, shadow). Use this before reading CSS. | **Required when present** |
   | 3 | `{path}/colors_and_type.css` | Runtime CSS source consumed by `fill-html-head.mjs`. Do NOT manually read for token extraction when css.json exists. | **Required (consumed by script, not manually read)** |
   | 3 | `{path}/components.css` | Pre-extracted component styles aggregated from `preview/component-*.html`. Consumed by `fill-html-head.mjs` only when `componentUsagePlan.componentCss` is `auto` or `on`; skipped when `componentCss` is `off`. Sub-Agents do NOT manually read or copy this file. | **Optional; only available in HTML when component CSS mode allows it** |
   | 4 | `{path}/components/_evidence/index.json` | Compact component family index, semantic candidates, priority hints, evidence file paths | **Required only when L2 Component Inventory Digest is needed** |
   | 5 | `{path}/preview/component-{slug}.html` (matched to `componentUsagePlan.previewsToRead`) | Primary implementation reference only for components whose DOM/classes/states are actually used. Read only previews listed by `componentUsagePlan`; default max 3 per page. | Required only when `componentUsagePlan.mode` is `preview-backed` or `component-css-backed` |
   | 6 | Resolved component contract file (matched to `componentUsagePlan.contractsToRead`) | Per-component semantic contract (representativeVariants, anatomy, visualTraits, unknowns, structurePatterns). Resolution: if `{path}/components/{slug}.json` exists → use this file; else if `{path}/components/_evidence/{slug}.json` exists → use that. | Required only for components actually selected for implementation |
   | 7 | `{path}/uikit-plan.json` and/or `{path}/library-consumption.json` | Core/support component split, allowed component whitelist, downstream read order, **componentContractKind**, **forbiddenInventedComponents**, **allowedComponents**, **screenBlueprints** (page↔component allocation aid), **productContext** (kitType + productType), **styleConstraints** (from `components/_evidence/index.json` top-level: radius, spacing, fontSize, height), **previewFiles** (available preview list for validation reference) | Optional but preferred |
   | 8 | `{path}/ui_kits/<type>/` | Layout reference benchmark + composition reference (index.html). **Sub-Agent must read** when available; resolved component contracts still define component details. | **Preferred layout benchmark** |
   | 9 | `{path}/components/index.json` and `{path}/components/_evidence/{slug}.json` | Evidence archive and component index. Used as fallback when intent is missing; primary source for pre-intent libraries. | Fallback or archive |

   > **Token Name Source Hierarchy**:
   > - **Primary**: `SKILL.md` "Essentials at a glance" section lists semantic variable names (e.g., `--slds-accent`, `--slds-foreground`, `--slds-muted`) — these are the ACTUAL names used in HTML via `var(--name)`.
   > - **Secondary**: `colors_and_type.css` defines all `:root` variables including semantic aliases. These are auto-inlined by `fill-html-head.mjs`. Sub-Agents can see the full variable list after the script runs.
   > - **Supplementary**: `css.json` contains raw palette tokens (e.g., `slds-neutral-100`, `slds-electricBlue-40`). Useful for understanding color relationships but NOT directly used as HTML variable names in most Libraries (Libraries map raw tokens → semantic aliases in CSS).
   >
   > **Component Contract Resolution**:
   > 1. **Preview-first**: If `preview/component-{slug}.html` exists → set `previewFile` to that file. This is the **primary implementation reference** (DOM structure, CSS variables, spacing, visual patterns).
   > 2. **Contract resolution** (semantic supplement / fallback): If `components/{slug}.json` exists → set `contractFile` to that file. Else if `components/_evidence/{slug}.json` exists → set `contractFile` to that evidence file.
   > 3. When both `previewFile` and `contractFile` exist and both are listed in `componentUsagePlan` → Sub-Agent reads `previewFile` first for implementation, then `contractFile` for semantic understanding (variants, states, unknowns).
   > 4. When only `contractFile` exists (no preview) → `contractFile` becomes the sole primary source.
   > 5. When neither exists → no component data available for this slug.
   > Sub-Agent reads `previewFile` before `contractFile` only when both are listed in `componentUsagePlan` — never read preview HTML merely because it exists.

   > **`colors_and_type.css` usage**: Read by `fill-html-head.mjs` script and inlined into the HTML's `<style id="theme-vars">` (not referenced via `<link>`, because the canvas SDK renders via iframe srcdoc and cannot load external paths). The Main Agent does NOT need to manually read this file for token extraction — the semantic variable names are listed in `SKILL.md`.

   > **`components.css` usage**: `components.css` is controlled by `componentUsagePlan.componentCss`. When the mode is `on` or `auto` and `fill-html-head.mjs` inlines it, the final HTML contains `<style id="component-vars">`; only then may Sub-Agents use pre-built component CSS classes (e.g., `.btn`, `.badge`, `.card`). When the mode is `off`, `<style id="component-vars">` is intentionally absent and Sub-Agents must not use those pre-built classes. Sub-Agents do NOT manually read, copy, or `<link>` this file in any mode.

   > **Component plan usage**: Main Agent must not dump the full component index into every page subtask. Select a small `componentPlan` per page from `components/_evidence/index.json` + `uikit-plan.json` when present; otherwise use `components/index.json`. Store resolved `{slug, contractKind, previewFile, contractFile, debugFile?}` entries in `orchestration-summary.json.pages[].componentPlan`. Include `previewFile` whenever `preview/component-{slug}.html` exists (no dependency on `library-consumption.json.previewFiles` declaration).

   > **library-consumption.json / uikit-plan.json — Deep Extraction Rules**:
   > When reading Order 7 files, extract the following fields (all optional — graceful degradation when absent):
   >
   > | Field | Source File | Extracted Value | Downstream Use |
   > |-------|-------------|-----------------|----------------|
   > | `componentContractKind` | library-consumption.json | `"evidence"` / `"legacy-json"` / `"compact-json"` | Pre-set contractKind for all componentPlan entries; skip per-file detection |
   > | `forbiddenInventedComponents` | uikit-plan.json | Array of slugs (e.g., `["layout", "space"]`) | Pass to Sub-Agents via orchestration-summary; enforce in §Component-Conformance |
   > | `allowedComponents` | uikit-plan.json | Array of slugs | Sub-Agent prefers these when selecting extra components |
   > | `screenBlueprints` | uikit-plan.json | Array of {name, componentSlugs, role} | Use during page→componentPlan allocation (prefer primary blueprint components) |
   > | `productContext.kitType` | uikit-plan.json | e.g., `"enterprise-ai-design-system"` | Include in designDecisionSummary |
   > | `productContext.productType` | uikit-plan.json | e.g., `"B2B cloud / AI operations platform"` | Include in designRead and page business scenario |
   > | `styleConstraints` | components/_evidence/index.json (top-level) | {radius, spacing, fontSize, height} | Pass to Sub-Agents as structural boundaries |
   > | `previewFiles` | library-consumption.json | Array of preview/ paths | Validation reference for available preview HTMLs (not a gate — preview inclusion is based on file existence, not this declaration) |
   >
   > **Backward compatibility**: If `library-consumption.json` is absent, all fields default to undefined/empty. Existing flow (reading uikit-plan.json only for core/support split) continues unchanged.

3. **Identify brand prefix**: Infer prefix from SKILL.md "Essentials" section (primary source) or `fill-html-head.mjs --detect-prefix` fallback (see "Brand Prefix Discovery" below)
4. **Handle exceptional cases**:
   - Directory does not exist or is empty → Inform user the Library has no available files, fall back to default style derivation flow
   - SKILL.md or `css.json` missing → Attempt **last-resort fallback** reading of `colors_and_type.css` (using offset+limit segmented strategy to extract `:root` variable names only). If still unavailable → Inform user the Library is incomplete, ask whether to continue
   - `components/_evidence/` missing → Resolve `contractKind: "legacy-json"` or `compact-json` from `components/index.json` + relevant component JSON. This is normal for structured-spec/from-scratch/legacy libraries; mark lower-fidelity only when the Library claims to be Figma-derived or when component JSON is also missing

---

## Brand Prefix Discovery

Design Library Tokens use brand prefix naming (e.g., `volcano-primary`, `panda-orange-600`). The Agent identifies the brand prefix using:

**Discovery rules** (in priority order):
1. **SKILL.md "Essentials at a glance"** — look for `prefix:` field or infer from listed variable names (e.g., `--slds-accent` → prefix is `slds`)
2. **`fill-html-head.mjs` detection** — the script's `detectPrefix()` function automatically identifies the prefix from `:root` CSS variables when inlining. It selects the first segment that appears in semantic token patterns (`primary`, `background`, `foreground`, etc.), or falls back to the most frequent first segment.
3. **Fallback**: If neither source yields a clear prefix, use the Library's `name` field as the prefix.

**Verification method**: Confirm that most variable names in `colors_and_type.css` `:root` block start with `{prefix}-`.

---

## context/ Directory Handling

If the Library contains a `context/` directory:

1. **Check existence**: LS `{path}/` — if `context/` is present, proceed; otherwise skip.
2. **Read `context/visual-preview.md`** when present: supplementary global visual context. Typically references `assets/previews/` thumbnail — use as visual orientation (Main Agent does not render images but records reference in designDecisionSummary when helpful).
3. **Token budget**: max 2 files from `context/`.
4. **Priority**: Between Order 7 (README.md) and Order 8 (ui_kits/) — supplementary visual context.
5. **No forwarding required**: `context/` content is a Main Agent global orientation aid; Sub-Agents receive distilled information via `designDecisionSummary` and `productContext` fields.

---

## Dark Theme Resolution in Library-Bound Mode

When `colors_and_type.css` contains a `.dark { ... }` selector block:

1. **Detection**: `fill-html-head.mjs` inlines the full CSS including the `.dark` block. The `--theme=dark` flag sets `<html class="dark">`, activating the dark overrides at runtime.
2. **Main Agent decision**: If user requests dark mode, or Dashboard mode triggers dark recommendation, pass `--theme=dark` to `fill-html-head.mjs`. The Library's `.dark` block IS the dark theme — it replaces `aesthetics/dark-mode.md` defaults for all token values it defines.
3. **Priority integration**:
   - Library `.dark` block variables > `aesthetics/dark-mode.md` generic rules
   - `aesthetics/dark-mode.md` still applies for aspects the Library `.dark` block does NOT cover (e.g., image brightness adjustment, shadow strengthening, backdrop-filter patterns)
4. **Sub-Agent awareness**: Pass `themeMode: "dark"` in dispatch when dark is active. Sub-Agent reads `aesthetics/dark-mode.md` only for gap-filling rules.
5. **No `.dark` block present**: If Library CSS has no `.dark` selector, dark mode falls back entirely to `aesthetics/dark-mode.md` generic rules.

---

## Icon Asset Discovery (Library-Bound Only)

When a Design Library is active and the library directory contains `assets/icons/` or `icons/`:

1. **LS** the icon directory (`{library-path}/assets/icons/` preferred; fallback to `{library-path}/icons/`). Do NOT read SVG file content.
2. **Derive `libraryKey`**: use `libraryIdentity.id` from the extracted metadata (Step 1 above). If id is null, use `libraryIdentity.name` with non-alphanumeric chars replaced by `-`.
3. **Copy** all `.svg` files to `{designProjectPath}/assets/icons/{libraryKey}/` (file copy is zero-cost).
4. **LS** the target directory to confirm copied file names.
5. **Write** `designSource.iconAssets` to `orchestration-summary.json`:
   ```json
   {
     "source": "assets/icons",
     "projectIconDir": "assets/icons/{libraryKey}",
     "libraryKey": "{libraryKey}",
     "renderMethod": "css-mask",
     "pathTemplate": "../assets/icons/{libraryKey}/{name}.svg",
     "availableNames": ["close", "down", "search", "..."],
     "totalCount": 45,
     "coloringRule": "currentColor by default; override with Library token when needed"
   }
   ```
   - `availableNames` stores filenames without `.svg` extension
   - Always pass the complete name list (no truncation; 200 names ≈ 600 tokens is acceptable)
6. **[FORBIDDEN]** Reading SVG file content — only file names are needed
7. **[FORBIDDEN]** Filtering icons based on componentPlan — user-uploaded icons are freely-used assets

> **Icon naming**: Design Library icons keep their original filenames. Sub-Agents construct paths using `pathTemplate` + names from `availableNames`.

---

## Dispatch Payload Template (Library-Bound)

When a Design Library exists, the Main Agent includes this compact input data in every page subtask (referenced from `SKILL.md > Design Library & Token Constraints`):

```
Design Library Constraints (strictly follow, deviation forbidden):
  - Library path: {library-directory-path}
  - Brand prefix: {brandPrefix} (e.g., "volcano")
  - CSS file path: {library-path}/colors_and_type.css (consumed by fill-html-head.mjs; final HTML contains inline <style id="theme-vars">)
  - Token understanding source: {library-path}/css.json (read before CSS; do not manually read colors_and_type.css for token extraction when css.json exists)
  - Design decision summary: {key design parameters extracted from SKILL.md Essentials}
  - Layout reference: {library-path}/ui_kits/{type}/index.html (Sub-Agent must read when available)
  - Component evidence index: optional {library-path}/components/_evidence/index.json (preferred when present)
  - Component plan: {per-page componentPlan selected from components/_evidence/index.json + uikit-plan.json when present; otherwise selected from components/index.json. Each entry includes contractKind and contractFile. Sub-Agent reads only contractFile during normal generation; debugFile is for debug/refine only}
  - Token fidelity SSOT: {SKILL_DIR}/operation-policies/sub-agent-hard-rules.md §Token-Fidelity
  - Forbidden invented components: {designSource.forbiddenInventedComponents or "none"}
  - Allowed components whitelist: {designSource.allowedComponents or "unrestricted"}
  - Style constraints: radius-max={radiusMax} spacing-base={spacingBase} font-body={fontSizeBody}px control-h={controlHeightDefault}px {or "none — use aesthetics defaults"}
  - Theme mode: {themeMode, default "light"}
  - Product context: {productContext.kitType} / {productContext.productType} {or "not specified"}
  - Component preview files: {per-page matching previewFile paths from componentPlan[], or "none available"}
```
