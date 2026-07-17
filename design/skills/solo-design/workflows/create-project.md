# Create New Design Project

When the user's intent is not associated with any existing design project, use this workflow (i.e., no existing `.design` project was matched during pre-execution preparation).

> **Core Principle: Canvas first, Main Agent exclusively manages `.design` files.** Before dispatching page generation tasks, the Main Agent writes all page node skeletons (with pre-assigned IDs and htmlSrc) into `.design` in one pass. Sub-Agents only generate HTML files and do not write to `.design`, fundamentally eliminating concurrent write race conditions.
>
> **Wiring Principle**: When creating a new project, visible wiring is automatic. **Default topology is linear single-chain** (pages are connected head-to-tail in logical order, each page has exactly 1 visible exit, the last page has 0 visible exits). Only when the business flow genuinely branches is a page allowed to have 2 visible exits, but never more than 2. Total visible wiring count for the entire project must be ≤ page count. Back / return controls, global nav, breadcrumbs, secondary CTAs, and skip links such as Page 1 → Page 3 may navigate with `hideEdge: true` interactions and must not create visible reverse or shortcut edges. See `operation-policies/wiring-strategy.md` for details.

## TodoWrite Efficiency Rule

- Create initial todo list once at start (max 7 items covering all steps)
- Update status using `merge=true` with only changed fields
- [FORBIDDEN] Calling TodoWrite consecutively without an actual tool operation between them
- Batch status changes: when multiple sub-tasks complete simultaneously (e.g., all page Sub-Agents return), update all in a single TodoWrite call
- Maximum TodoWrite calls per session: 6 (create + 5 updates)

| Section | Description | User-facing Title |
|---------|-------------|-------------------|
| Step 0.5 — Reference Material & Requirement Analysis | Analyze non-text reference materials (screenshots/URLs/ZIPs) and parse long requirements | Understanding your requirements |
| Step 0.7 — Style Discovery & Definition | Collect creative direction (business tone, visual feel, references) when not provided by Library or reference materials | Confirming creative direction |
| Step 1 — Style Selection | Determine design constraint source (Design Library or user derivation), generate/reference brand CSS | Confirming design style |
| Step 2 — Project Initialization + Canvas Entry | Create directory structure, brand CSS file (if needed), and .design entry file | Preparing design project |
| Step 2.2 — Orchestration Summary | Write runtime context summary for token, page, component, image, and wiring plans | (Silent background, not displayed) |
| Step 2.5 — Image Pre-generation | Dispatch sub-tasks in parallel to generate all image assets into assets/, then register every asset as an image node in .design | Preparing image assets for pages |
| Step 3 — Page Generation | Plan a generation tree, generate shared fragments first, then dispatch leaf page sub-tasks (do not write to .design) | Designing pages ({page names}) |
| Step 3.5 — Page Reordering + Wiring Registration | After all sub-tasks complete, the Main Agent reorders page nodes by logical order and registers interactions based on the wiring mapping table | Configuring page navigation |
| Step 4 — Blocking Validation | Execute validation script; if failed, block progression — [FORBIDDEN] to proceed | (Silent background, not displayed) |
| Step 5 — Guide Preview | Inform user to open .design file for preview, output page summary table | Done, ready to preview |

> **User-facing Title**: When the Agent displays this step in TodoList or progress messages, it **must use the expression from this column**. Using the internal section names on the left is [FORBIDDEN]. Full rules in `operation-policies/user-facing-language.md` "Language Constraints for Task Planning and Progress Display".

## Step 0.5 — Reference Material & Requirement Analysis (Main Agent, conditional)

> **Skip condition**: If the user's message is a straightforward text-only requirement with < 500 characters and no attached materials, skip this step entirely and proceed to Step 1.

This step handles two common real-world scenarios that the standard flow does not cover by default:

### A) Reference Material Analysis (when non-text materials are present)

When the user provides screenshots, URLs, ZIP files, or other attached artifacts:

1. **Read** `{SKILL_DIR}/operation-policies/reference-material-handling.md`
2. **Execute** the analysis flow appropriate to the material type (screenshot → visual analysis, URL → fetch & extract, ZIP → extract & classify)
3. **Produce** a "Design Constraints Document" (structured output format defined in that file)
4. **Feed forward**: The extracted constraints replace or augment Step 1's style selection:
   - If reference provides clear visual direction → **skip style inquiry** in Step 1
   - If reference provides page structure → inform Step 2 page list planning
   - If reference is "Reconstruct + Extend" intent → first page in Step 3 uses reference layout as guide

### B) Long Requirement Parsing (when text input is extensive)

When the user's message exceeds ~500 characters or contains PRD-like structured content:

1. **Read** `{SKILL_DIR}/operation-policies/long-requirement-parsing.md`
2. **Execute** the 4-phase parsing: Structured Extraction → Page Prioritization → Feature Density Control → Requirement-to-Page Mapping
3. **Produce** a "Page Plan" (structured output format defined in that file)
4. **Feed forward**: The Page Plan provides the pre-determined page list (Step 2 nodeId pre-assignment), per-page feature requirements (Step 3 dispatch), visual direction summary (augments Step 1), and the page count cap decision when applicable

### Combined scenario (reference materials + long requirements)

When both are present (e.g., uid=1 evaluation case: screenshot + ZIP + 2000-char requirements):

1. Execute Reference Material Analysis first (extracts visual/structural constraints)
2. Then execute Long Requirement Parsing (extracts functional/content requirements)
3. Merge: visual direction from reference + page plan from text = complete project specification
4. Conflict resolution: text requirements win for content/features; reference materials win for visual style (unless text explicitly overrides)

### Multi-Device Project Split (when dual device types detected)

When Pre-Execution Preparation detects `multiDeviceProject: true` (user requirements span mobile + desktop):

1. **Phase 1 output includes device classification**: The Page Plan must tag each page with `targetDevice: 'mobile' | 'desktop'`
2. **Step 1 (Style Selection)**: Execute once — generate a single shared brand CSS
3. **Step 2 onwards**: Execute the per-project pipeline once per device project. The two device projects **may run interleaved in parallel**: Pass B initialization and its image/page generation dispatches may overlap with Pass A page generation (e.g., start Pass B project initialization while Pass A page Sub-Agents are still running). The only serialization constraint is that **all `.design` writes are executed by the Main Agent serially** (one write at a time per project file); Sub-Agent image/page generation across the two projects may interleave freely.
   - **Pass A (Mobile)**: Create mobile project directory, write `.design` with `deviceType: 'mobile'`, dispatch mobile-tagged pages
   - **Pass B (Desktop)**: Create desktop project directory, write `.design` with `deviceType: 'desktop'`, dispatch desktop-tagged pages
4. **Step 4 (Validation)**: Run validation independently on each project
5. **Step 5 (Preview)**: Present both projects to user with clear labels

**TodoWrite for multi-device**: Use a single todo list covering both passes. Example:
- Understanding your requirements (multi-device detected)
- Confirming design style (shared)
- Preparing mobile design project
- Designing mobile pages ({list})
- Preparing desktop design project
- Designing desktop pages ({list})
- Done, ready to preview (2 projects)

## Step 0.7 — Style Discovery & Definition (Main Agent, conditional)

> **Skip condition**: Skip if ANY of the following is true:
> - `operatingMode === "library-bound"` (Library provides the style)
> - Step 0.5 reference analysis already extracted a clear visual direction
> - The user's message already states explicit style preferences (color, font, mood)
> - Current project history provides usable `styleContinuityAnchors` for the requested continuation
> - `replicationMode === "high-fidelity"` (source site IS the style)

When the user is in free-explore mode and hasn't stated visual preferences, proactively collect creative direction **before** mechanical style generation:

1. **Ask via AskUserQuestion** (pick 1–2 most relevant questions, not all):
   - What is the business tone? (e.g., professional/playful/luxurious/editorial)
   - Any reference brands or websites whose visual feel you like?
   - Primary color preference? (or "surprise me")
   - Content-heavy or visual-heavy?

2. **Produce a `styleDefinitionBrief`** (≤ 200 chars): A single sentence capturing the creative direction. Example: "Finance SaaS, cool neutral + indigo accent, Inter + Noto Sans SC, editorial rhythm, restrained surfaces."

3. **Produce compact execution controls**:
   - `designRead` (≤ 160 chars): `{pageKind} / {audience} / {businessTone} / {density} / {visualRiskToAvoid}` per `creative-direction.md` "Design Read Contract".
   - `designDials`: `{ layoutVariance, motionIntensity, visualDensity }` using 1-5 values from `creative-direction.md` "Design Dials".

4. **Store**: Write `styleDefinitionBrief`, `designRead`, and `designDials` into `orchestration-summary.json > project`. These fields inform Step 1's style derivation and Step 3's Sub-Agent dispatch.

> **Design rationale**: Without explicit creative direction, the AI defaults to "safe generic" output (mint accent, centered hero, 3-column cards). Collecting direction upfront enables distinctive, business-appropriate design choices from the start.

## Step 1 — Style Selection (Main Agent)

> **Fast Path (Library-Bound Mode)**: If the pre-execution preparation phase detected `operatingMode: 'library-bound'` (a usable Design Library is available), **skip the style inquiry** and directly extract design constraints (brand prefix, key design decisions) from the Library directory, then proceed to Step 2.
>
> The Main Agent must complete the following in this phase:
> 1. **LS `{library-path}/`** — if `specs/` exists, load supplementary constraints per `design-library-parsing.md` "Step 0 — Specs Context Loading". Do not scan unknown scattered files in the Library root.
> 1a. Resolve the active Library identity (`name`, `id`, `version`, `scope`, `path`, `versionSource`) from the XML/context payload first, then metadata files (`metadata.json`, `library-consumption.json`, `package.json`) if the version is missing. Store the same object in both `.design.config.designLibrary` and `orchestration-summary.json.designSource.libraryIdentity`; unknown fields are explicit `null`.
> 2. Read `{library-path}/SKILL.md` → Extract Essentials (primary color, font, border radius, density, tone) + **semantic variable name listing** (these are the actual `var(--name)` used in HTML)
> 3. Read `{library-path}/README.md` → Extract Voice & Tone, Visual Foundations, Caveats (font substitution, etc.) — **same priority as SKILL.md, required**
> 4. Read `{library-path}/css.json` when present → structured token understanding source. Do not manually read full `colors_and_type.css` for token extraction when css.json exists; pass CSS path to `fill-html-head.mjs` only.
> 5. Read `{library-path}/components/_evidence/index.json` when present → extract available slugs, semantic candidates, priority hints, and evidence file paths. If absent, read `{library-path}/components/index.json` when present.
> 6. Read `{library-path}/uikit-plan.json` or `{library-path}/library-consumption.json` when present → core/support component split and recommended read order.
> 7. Record Library path, brand prefix, CSS file path, design decision summary, pass to subsequent steps
> 8. Extract key semantic variable names from SKILL.md + css.json, pass as "Actual Token Name Reference" to each Sub-Agent when dispatching Step 3 tasks. **Source priority: SKILL.md essentials > css.json structured tokens > last-resort CSS scan**
> 9. Build a per-page `componentPlan` from `components/_evidence/index.json` and `uikit-plan.json` when present; otherwise build it from `components/index.json`. Store resolved `contractKind`, `contractFile`, and optional debugFile in `orchestration-summary.json`; Page Sub-Agents read only `contractFile`.
> 10. LS `{library-path}/ui_kits/` to identify available Kit types, select the most matching type for the project
>
> **Context Management**: After extracting the token mapping table and design decision summary from Library files, the Main Agent should rely solely on the extracted structured data (token mapping table, brand prefix, design decision summary) for all subsequent steps. The raw Library file contents (SKILL.md, css.json, README.md) are not referenced again — only the distilled outputs matter going forward.

**Default Path (Free Explore Mode)** — no Design Library available:

> **Step 0.7 Handoff**: If Step 0.7 already produced a `styleDefinitionBrief`, use it directly as the creative direction input below — do NOT re-ask the user for style preferences. AskUserQuestion in step 1 below fires only when Step 0.7 was skipped AND no clear direction exists.
>
> **Historical continuity handoff**: If existing project files provide `styleContinuityAnchors`, reuse those anchors directly and do NOT ask for a new style. The user query may override only explicitly mentioned dimensions.

1. Extract **industry/business scenario** keywords from user description, combine with audience characteristics, brand tone, and competitor visual conventions for that industry, independently derive 2–4 most fitting style options, and let the user choose via **AskUserQuestion** (all option fields must match user's query language — see `creative-direction.md` "AskUserQuestion Language Rule"). Style prohibition rules in `operation-policies/creative-direction.md` "Style Option Generation Constraints"
2. Based on the user's selected style direction, **generate a temporary `colors_and_type.css`** (format identical to Design Library output, including brand prefix CSS variables, typography class names, light/dark dual-mode variables). This file will be written to the project directory in Step 2, unifying HTML consumption with the Design Library path.
   - **Free-explore color policy (blocking)**: generate exactly one brand primary hue and its tints. Do not generate `secondary`, `accent`, `--color-secondary`, `--color-accent`, or their light/dark scales. If status colors are needed, generate a separate `stateColors` token set named only `--state-success`, `--state-warning`, `--state-error`, and `--state-info`; these are for semantic status only, not identity/category styling.
   - Identity/category/member-role styling must use text, icons, neutral tints, layout, or the primary tint. Do not use extra hues for parent/child, book genre, recommendation/comment/share type, avatars, or progress ownership.
   - **Free-explore radius policy (blocking)**: generate a restrained radius scale only: `--radius-sm: 2px or 4px`, `--radius-md: 8px`, `--radius-lg: 12px or 16px`, `--radius-full: 9999px`. Do not generate `--radius-xl`, `--radius-2xl`, `--radius-3xl`, or any card/button/input radius above `16px` unless the user's current query explicitly asks for large/soft/round shapes. Warm, family, child, lifestyle, friendly, storybook, premium, or playful tone is not enough to exceed 16px.
   - In `orchestration-summary.json`, set `designSource.styleConstraints.radiusMax` to `16` by default, and write `shapeSystem` / `sharedProjectShellContract.radiusScale` using the same restrained scale. Do not record `24px`, `28px`, `32px`, `rounded-2xl`, or `rounded-3xl` as continuity anchors unless directly requested by the user.
   - **Free-explore typography policy (blocking)**: generate one stable project font system, not per-page font experiments. Chinese pages default to sans-serif. If editorial/culture/publishing tone justifies serif, choose exactly one CJK serif display/title family and one body stack; do not generate competing serif stacks such as `Playfair Display` + `Georgia` + `Noto Serif SC` for Chinese headings. Decorative Latin serif names may be used only as Latin fallback/accent and must not precede the CJK serif in Chinese title variables. Record the selected title/body stacks in `styleContinuityAnchors.typographySystem` and `sharedProjectShellContract`, then pass them unchanged to every Sub-Agent.
   - **Free-explore shadow policy (blocking)**: ordinary/static cards, tables, lists, sections, buttons, and panels must use border or surface layering first. If they use shadow, every shadow color alpha must be `<= 0.05`. Shadow alpha above `0.05` is allowed only for real floating layers: modal, popover, dropdown, drawer, tooltip, toast, or menu. Do not use colored shadows or glow shadows.
   - In `orchestration-summary.json`, set `designSource.styleConstraints.staticShadowAlphaMax` to `0.05`, and write `surfaceAndDepth` / `sharedProjectShellContract.surfaceDepthModel` with the same rule: static surfaces are border/surface-led, only floating layers may use deeper elevation.

### Multi-Style Exploration Path (Free Explore Mode Only)

When the user explicitly requests **multiple distinct styles in a single creation** (e.g., "give me 3 different style versions of this site", "I want to see completely different directions"), the following flow replaces the standard Default Path above:

1. **Derive differentiated style directions**: Based on user context, derive 2–3 **dramatically different** style directions. Each direction must differ from others in ≥ 2 of the 6 dimensions defined in `generate-variants.md` "Differentiation Mandate". Use AskUserQuestion to let the user confirm or adjust the directions.

2. **Generate independent brand CSS for each direction**: Each style gets its own `colors_and_type.css` file (named `colors_and_type-{direction-slug}.css`, e.g., `colors_and_type-minimal.css`, `colors_and_type-expressive.css`). The CSS files must reflect genuinely different design decisions across color system, typography, spacing/density, shape language, and shadow/depth — not just color swaps. Contrast dimension examples: see `generate-variants.md` "Differentiation Mandate".

3. **Generate pages per style in parallel**: For each style direction, dispatch page generation Sub-Agents using that direction's brand CSS. All pages across all styles are dispatched in the same round in parallel.

4. **Canvas organization**: Each style direction's pages are placed in a separate `group` value in the `.design` file, so they appear as distinct rows on the canvas for easy visual comparison.

> **[FORBIDDEN]** In multi-style exploration:
> - Generating the same layout with different colors (reskinning)
> - Using the same Hero/section structure across styles
> - Varying only surface parameters (radius, shadow) without structural changes
> - Generating more than 3 style directions (overwhelms comparison)

## Step 2 — Project Initialization + Canvas Entry → Main Agent direct execution

> **[FORBIDDEN] Delegating this step to Sub-Agents via the Task tool.** This step involves writing `.design` metadata and must be executed directly by the Main Agent in-context. The operations are trivial (mkdir + write 2-3 JSON files) and do not warrant a sub-task dispatch. Using the Task tool here wastes tokens and latency on Sub-Agent overhead for no benefit.

The Main Agent directly creates the directory structure, brand CSS file (if no Design Library), and `.design` entry file in one pass. This metadata initialization must not be delegated to Page Sub-Agents, because the Main Agent exclusively manages `.design` files.

> **[Note] Critical Format Constraints**: Format requirements for `data` field, `devMetadata` field, etc. are detailed in `design-file-structure.md` JSON specification section.

> **[Architecture Critical]** The `.design` file created in this step **must contain all page skeleton nodes**. Page skeleton node IDs are pre-assigned by the Main Agent before dispatch using the `page-{slug}` format (derived from the HTML filename minus `.html` suffix, e.g., `pages/about-us.html` → `page-about-us`). Page Sub-Agents in Step 3 only generate HTML files and never write to `.design`, completely eliminating concurrent race conditions.

Before executing Step 2, the Main Agent must plan all pages and pre-assign:

| Field | Description |
|-------|-------------|
| `nodeId` | Format: `page-{slug}` (e.g., `page-index`, `page-pricing`, `page-about-us`). Slug is derived from the HTML filename minus `.html` suffix |
| `htmlSrc` | `pages/{slug}.html`, corresponding to the page filename |
| `title` | Page title — **must use the user's most frequently used language** (e.g., Chinese user → "首页", "产品介绍"; English user → "Home", "Products"). See `user-facing-language.md` "Artifact Naming Language Rule" |
| `pageIndex` | Logical sequence number, starting from 1 |

### Interaction-State Expansion

When the user requests interactions that change what the page visibly shows, the
Main Agent must expand each meaningful visual state into a separate canvas page
state before writing the `.design` skeleton.

**Trigger signals**:
- Tabs: "两个tab切换", "多个 tab", "tab1 为...", "tab2 为...", "第一个 tab",
  "第二个 tab", "tabs for ...", "switch between tabs"
- Search/filter/sort: "搜索后", "筛选后", "排序后", "选择条件后",
  "after search", "filtered state", "selected filter"
- Overlays: "打开弹窗", "弹窗初始态", "抽屉", "popover", "modal", "drawer"
- Disclosure/detail: "展开详情", "查看更多", "点击后展示", "选择后显示",
  "expanded state", "details open"
- Process/system states: "loading", "加载中", "empty", "空状态", "error",
  "错误态", "success", "提交成功", "step 1/2", "wizard"

**Behavior**:
1. Generate one page per meaningful visual state, even when the product concept
   sounds like a single screen. Example: "订单详情页，tab1 为订单信息，tab2 为订单数据图表"
   creates two pages: "订单详情页 - 订单信息" and "订单详情页 - 数据图表".
2. Keep state pages for the same source screen in the same `group` and adjacent
   logical order.
3. All state pages must share an identical page shell: outer frame size,
   header/sidebar/navigation, identity/summary area, control bar position,
   spacing, typography, radius, and brand treatment.
4. Only these areas may differ by state: active control styling, the stateful
   content region, overlay/drawer/modal layer, selected row/card, validation
   feedback, loading/empty/error content, chart/table content, and state-specific
   helper text.
5. Do not implement requested visual states only as internal JS in one HTML page.
   Canvas needs one visible page node for each requested visual state.
6. Register controls that switch between same-screen states as hidden
   interactions (`hideEdge: true`) so Preview can navigate between state pages
   without drawing extra canvas edges. Visible business-flow wiring should not be
   used for same-screen state switching.
7. In `orchestration-summary.json`, give state pages shared `continuityAnchors`
   that explicitly say "identical shell; only the active control/stateful region
   differs".
8. Keep lightweight hover/active/focus micro-interactions inside the same HTML
   page when they do not reveal persistent new content. Do not create extra pages
   for ordinary hover-only visual feedback.

**Overlay / Floating Layer State Rule** (Main Agent planning duties; Sub-Agent rendering rules in `page-generation-template.md` "Overlay / floating layer states"):
- For any floating layer (modal, drawer, popover, menu, command palette, toast detail, preview panel) opened on top of an existing page, plan a derived state page copied from the source/base page; the layer renders on top of the visible source context (transparent/translucent/blurred/dimmed backdrop per product style; opaque scrim only when the reference design uses one).
- Register the backdrop/scrim as a hidden interaction back to the source/base page (`hideEdge: true`) with a stable `data-dom-id` (e.g., `modal-backdrop-close`, `drawer-scrim-close`, `popover-outside-close`).
- Every dedicated close/cancel/back control inside the layer must also be registered as a hidden interaction to the source/base page; visual close icons without `data-dom-id` are not enough.
- A primary confirmation action that keeps the user in the same flow is registered per the planned target state: hidden interaction for same-screen state transitions, visible wiring only when it is the main business-flow next page.

#### Shared Shell Generation Protocol (Blocking)

State pages in the same interaction-state group are **not independent full-page
design tasks**. The Main Agent must make their shared shell explicit before
dispatch:

1. Create a stable `stateGroupId` for the source screen, choose one base/default
   state (`stateRole: "base"`), and mark all sibling states as
   `stateRole: "derived"` with `baseStatePageId`.
2. Write `sharedShellContract` and `mutableRegions` into each page record —
   the exact region inventories (immutable shell regions incl. outer `<main>`
   frame/wrapper/tab-bar geometry for tab/modal/overlay states; allowed mutable
   regions) are defined in `orchestration-summary.md` field notes
   (`sharedShellContract` / `mutableRegions`).
3. Generate the shared state branch first, then generate the base state leaf,
   then generate derived state leaves. Derived state pages must start by copying
   the base HTML file byte-for-byte (or the existing source HTML for comparison
   state pages), then edit only the declared `mutableRegions`. [FORBIDDEN]
   Rebuilding a sibling state page from scratch, rerunning `fill-html-head.mjs`
   for a derived state, or reassembling the full shell from fragments instead of
   copying the base page.
4. Pages with the same `stateGroupId` are not parallelizable until the base HTML
   and `sharedShellContract` exist. The normal flow is sequential
   `shared branch → base page → copy base → derived state edit`. Do not dispatch
   a derived state while the base page is still generating. If parallel
   Sub-Agents are unavoidable after the base exists, pass the base HTML path and
   immutable shell excerpts; each Sub-Agent must preserve those excerpts
   verbatim and may only edit declared slots.
   Derived-state Sub-Agent readiness (poll, copy, retry up to 10 times, then
   return `qualityGate: "blocked"`) is defined once and completely in
   `page-generation-template.md` Pre-step "Derived state pages: poll and copy
   the base HTML first".
   Only the Main Agent may dispatch the next node in this sequence. Sub-Agents
   must not dispatch child Sub-Agents; they only produce their assigned fragment
   or page and completion JSON. Parent completion / subtree wait gates: see
   SKILL.md §Architecture.
5. Same-screen state switching controls still use hidden interactions
   (`hideEdge: true`) so Preview can jump between state pages without drawing
   canvas edges.
6. For overlay/floating-layer derived states, include hidden return interactions
   for both the backdrop/scrim and every explicit close/cancel/back control,
   all targeting `baseStatePageId` with `hideEdge: true`.

Example: "订单详情页，tab1 为订单信息，tab2 为订单数据图表" creates
`订单详情页 - 订单信息` as the base page, copies it to
`订单详情页 - 数据图表`, and changes only the active tab and tab panel —
both pages keep the same shell (`<main>` padding/background, header/sidebar,
order summary, tab bar geometry, tab-panel wrapper); the tab switcher stays
attached to the tab panel through a shared content frame.

**Main Agent Direct Execution Checklist:**

1. ✅ Read `{SKILL_DIR}/file-specs/design-file-structure.md` (format reference)
2. ✅ Create directory structure: `{designProjectPath}/assets/`, `{designProjectPath}/pages/`
3. ✅ **IF Library-bound AND `{library-path}/assets/icons/` or `{library-path}/icons/` exists** →
   - LS icon directory to get full name list
   - Copy ALL SVGs to `{designProjectPath}/assets/icons/{libraryKey}/` (file copy is zero-cost, do not filter)
   - LS target directory to confirm copied files
   - Write icon name list to orchestration-summary.json > designSource.iconAssets (per `design-library-parsing.md` "Icon Asset Discovery")
   - [FORBIDDEN] Reading SVG file content; only file names are needed
   - [FORBIDDEN] Filtering icons based on componentPlan — user-uploaded icons are freely used assets
4. ✅ **IF no Design Library** → Write `{designProjectPath}/colors_and_type.css` (complete brand CSS from Step 1)
   **IF has Design Library** → Skip (reference Library's CSS directly)
5. ✅ Write `{designProjectPath}/{project-name}.design` — JSON with N page skeleton nodes. In Library-bound mode, `config.designLibrary` must contain the active Library identity from Step 1a; in free-explore mode, set it to `null` or omit it.

**Operation mode**: CREATE (vs. UPDATE in edit-project.md)

**Input data**:
- Project name: {name}
- Project path: {designProjectPath}
- Brand CSS source:
  - With Library: path = {library-path}, CSS = {library-path}/colors_and_type.css, prefix = {prefix}
  - Without Library: CSS content = {complete CSS string from Step 1}, prefix = {prefix}
- Page list (pre-assigned by Main Agent in logical order):

| nodeId | title | htmlSrc | pageIndex |
|--------|-------|---------|-----------|
| page-{slug} | {title} | pages/{page-name}.html | 1 |
| ... | ... | ... | ... |

**Page skeleton node constraints**:
- `interactions` = `[]` (wiring in Step 3.5)
- `canvasData.x/y` = 0 (SDK autoLayout)
- pages/ directory empty at this point (expected)

[SKIP] Do NOT run validate-design-file.mjs here. Full validation in Step 4.

> **Next**: After Step 2 metadata initialization completes, write the orchestration summary, then proceed to Step 2.5 Image Pre-generation phase.

## Step 2.2 — Orchestration Summary → Main Agent direct execution

Before image pre-generation and page dispatch, the Main Agent must write `{designProjectPath}/orchestration-summary.json` following `{SKILL_DIR}/operation-policies/orchestration-summary.md`.

Field schema and per-field requirements for `project` (including `designRead`, `designDials`), `designSource`, `pages[]` (including `visualNorthStar`, `compositionPattern`, `continuityAnchors`, `componentPlan`, `imagePlan`, `chartsRequired`, `miniProgramStyle`), `assets[]`, `wiringPlan[]`, and `hiddenInteractionPlan[]` are defined in `orchestration-summary.md` "Required Schema" + field notes — do not re-derive them here. For this flow, set `project.operation` to `"create"`.

**Context passing rule**: Page Sub-Agents receive `orchestrationSummaryPath` and the current page record. Do not paste the full summary into every subtask when a path + filtered page slice is sufficient.

**Visual execution planning rule**: Before Step 3 dispatch, the Main Agent must ensure `project.designRead` and `project.designDials` exist; every page has `visualNorthStar`; every showcase / brand / landing page has `compositionPattern`; and every multi-page project has at least 2 shared `continuityAnchors` copied into each page record. This converts the broad aesthetic spec into a compact, page-specific execution brief.

## Step 2.5 — Image Pre-generation → Dispatch sub-tasks in parallel

> **Core Principle: Images first, pages use them later.** Before generating any HTML pages, generate all required image assets in parallel. This way page generation Sub-Agents can directly reference existing images without needing to call image generation tools themselves, greatly improving page generation speed and image consistency.

### 2.5a — Plan Image Inventory (Main Agent)

1. **Classify image necessity by role instead of page-level budget**:

   | Image Role | Generation Rule | Quality Priority |
   |------------|-----------------|------------------|
   | `critical-hero` | Generate or reuse for brand home, campaign landing, product showcase, and other pages whose first impression depends on a real visual | Must not be removed for speed; if generation fails, record `status: "degraded"` and use approved CSS degradation |
   | `shared-brand` | Generate at most 1-2 project-wide brand visuals that can be reused across pages | Prefer shared style consistency over unique images per page |
   | `supporting-content` | Generate only when the section's meaning depends on an image, such as product proof, venue, food, vehicle, person, or report visual | Reuse closest existing/shared image before generating |
   | `decorative` | Do not generate by default | Use typography, icons, surface, spacing, and subtle same-hue texture instead |

2. **Apply default allocation rules**:
   - `showcase`: default 1 `critical-hero`; add at most 1 `supporting-content` only when content semantics require it
   - `information-dense`: default 0 images; generate/reuse 1 only for avatar/product/report evidence
   - `task-driven`: default 0-1 images; usually only success/confirmation/explanation screens need one
   - New generated image hard cap: `min(pageCount + 1, 6)`; copied/reused reference assets do not count toward this cap
   - Existing ZIP/URL/reference assets with matching semantics must be reused before any new generation

3. **High-Fidelity Replication — Image Plan Override**:

   When `replicationMode === "high-fidelity"`, the standard role-based allocation is **replaced** by the **Embedded Image Replication Plan** from `reference-material-handling.md` (SR-3 for screenshots, or Content Extraction for URLs):

   | Standard Mode | High-Fidelity Replication Mode |
   |---------------|-------------------------------|
   | Formulaic prompts: "{business theme}, {section type}, {style keywords}" | **Content-descriptive prompts**: describe what is VISUALLY DEPICTED in each source image |
   | Role-based budget allocation | **1:1 mapping**: one generated image per embedded image visible in the source |
   | Generic category keywords | **Specific composition + content + color palette** from source image |
   | Image hard cap applies | Hard cap still applies, but plan directly mirrors source |

   **Replication prompt formula** (replaces the standard formula in Step 2.5b):

   ```
   "{visible content description from SR-3/Content Extraction}, {composition notes (centered/split/full-bleed)}, {color palette from source (warm cream/dark/cool neutral)}, {style notes (professional/editorial/modern)}, high quality, no text overlay, no typography, no watermark"
   ```

   **[FORBIDDEN] in replication mode**: generic keywords ("website design image", "professional photography") without describing actual visible content; abstract/geometric placeholders when the source clearly shows product screenshots or real content; skipping image generation because "UI screenshots can't be replicated" — generate an approximation matching the source's visual tone, composition, and color palette.

4. **For each planned image, specify only**:
   - Owning page
   - Role (one of: `critical-hero` | `shared-brand` | `supporting-content` | `decorative`)
   - Section type (one of: `hero` | `feature` | `detail` | `testimonial` | `background` | `product`)
   - Target filename (e.g., `hero-main.jpg`, `feature-collaboration.jpg`) — must follow Asset file naming rules in `design-file-structure.md` (semantic kebab-case, no numeric prefixes or suffixes)
   - Initial status (`planned`, `reused`, `generated`, or `degraded`)

After planning, update `{designProjectPath}/orchestration-summary.json.assets[]` and each page's `imagePlan`.

> **Prompt construction is formulaic** — the Main Agent does not need to compose free-form creative descriptions. Each image prompt is assembled from the formula in Step 2.5b below.

### 2.5b — Dispatch image generation sub-tasks in parallel

> **Image Acceptance Rule (SSOT — applies to ALL image generation/operations in this skill; `edit-project.md` and other workflows reference this section)**
>
> The `GenerateImage` platform adds a small overlay watermark in development preview. This is **expected platform behavior** — final exported images are watermark-free after export.
>
> - [CRITICAL] If GenerateImage returns success → image is **unconditionally accepted**. Do NOT inspect, re-read, re-generate, or delete it.
> - [FORBIDDEN] Reading generated image files to "verify quality" (binary files cannot be meaningfully read)
> - [FORBIDDEN] Adding "no watermark", "no logo", or "no signature" to prompts (these phrases prime watermark-related reasoning and trigger hallucinated concerns)
> - [FORBIDDEN] Re-generating, deleting, or replacing images due to perceived watermark/quality issues
> - [FORBIDDEN] Degrading to SVG/CSS-only fallback or removing imagePlan when GenerateImage succeeded
> - [FORBIDDEN] Reasoning about whether generated images "might have watermarks" — you cannot see image content; accept tool confirmation at face value

All images to be generated are dispatched as independent sub-tasks, **in the same round in parallel** to Sub-Agents. Format for each image generation sub-task:

```
Task: Generate image asset "{section type} for {page name}"
Output: {designProjectPath}/assets/{image-filename}.jpg
Input data:
  - Image generation prompt (assembled from formula):
    "{project business theme}, {page business scenario}, {section type} image, {style keywords from brand CSS (e.g., warm tones / cool minimal / earthy organic)}, high quality, professional photography, no text, no typography, no letters, no words"
  - Target file path: {designProjectPath}/assets/{image-filename}.jpg
  - Owning page: {page name}
  - Image role: {critical-hero|shared-brand|supporting-content}
  - Section type: {hero|feature|detail|testimonial|background|product}
Note:
  - Prompt follows the formula above — Main Agent fills in the bracketed variables; no free-form description needed
  - Must follow aesthetics/index.md §5 Imagery "Image generation prompt construction rules" for lighting/composition constraints
  - Save directly after generation, [FORBIDDEN] to post-process
  - Decorative images are not generated by default; do not create image tasks with role `decorative`
```

### 2.5c — Consolidate image resource list

After all image sub-tasks complete, the Main Agent consolidates the complete image resource list in the `assets/` directory (including filename, role, semantic description, owning page, and status), updates `orchestration-summary.json`, and passes only the current page's images plus shared assets to each Sub-Agent in Step 3.

If Step 0.5 extracted reusable assets from screenshots/URLs/ZIP/HTML references, merge them into the same inventory before dispatch:

| Source | Merge Rule |
|--------|-----------|
| ZIP / HTML image assets | Copy into `assets/`, preserve source mapping, and prefer reuse before generating new images |
| Screenshot-derived visual elements | Record as visual constraints; only copy actual attached files when available |
| URL assets | Reuse only when legally and technically available as local files; otherwise treat as visual reference only |

The final per-page "Available image resources" table must include both generated images and copied reference assets, filtered to the target page plus shared assets.

### 2.5c-1 — Asset Integrity Verification (Main Agent)

After downloading/copying assets (whether from image generation, URL download, or ZIP extraction), verify each file before proceeding:

| Check | Threshold | Action on Failure |
|-------|-----------|-------------------|
| File size | < 1 KB | Likely a redirect page or error response; retry with explicit `-L` flag or alternate URL |
| File format | Cannot be identified as image by extension + magic bytes (e.g., file starts with `<!DOCTYPE` or `<html`) | Mark as `degraded`; do not pass to Sub-Agent as valid image |
| HTTP status | Non-200 after redirect following | Mark as `degraded` |

**Retry strategy**:
1. First retry: Add explicit `Accept: image/*` header and follow all redirects (`curl -L`)
2. Second retry: If original URL has signed/expiring parameters (`x-expires`, `x-signature`), skip retry — these are time-limited CDN links that may have expired
3. After 2 failed retries: Mark asset as `degraded`, record failure reason in `orchestration-summary.json.assets[]`, pass `fallbackAllowed: true` to Sub-Agent for the affected section

**[FORBIDDEN]** Passing a < 1KB file or a non-image file (HTML redirect page) as a valid image resource to Sub-Agents.

### 2.5d — Register every asset as an image node in `.design` (Main Agent, [REQUIRED])

> **[REQUIRED]** After all image sub-tasks complete (and before dispatching Step 3 page generation), the Main Agent **must append one `type: "image"` node into `.design` `data` array for every file produced under `assets/`**. Without this step, image assets only live inside HTML `<img>` tags and never surface as independent cards on the canvas, which contradicts gate invariant #6 of `SKILL.md`.

Procedure (all in a single Main Agent pass, do not delegate to Sub-Agents):

1. **List `assets/` directory**: enumerate every file produced in Step 2.5b (and any pre-existing reusable assets that were carried into Step 2.5c's resource list).
2. **Skip non-image files**: only register files with image extensions (`.jpg` / `.jpeg` / `.png` / `.gif` / `.webp` / `.svg`). Other files (e.g. fonts, data) are not registered.
3. **Exemption**: files under `assets/icons/**` (Design Library icon assets for CSS mask rendering) are NOT registered as `.design` image nodes. Only register files directly under `assets/` (not in subdirectories).
4. **Build one image node per asset** using the "Image Node" spec in `file-specs/design-file-structure.md` (the SSOT for the node field template, `image-NNN` 3-digit project-wide id counter starting from `001`, and the semantic-title rule: title is a meaningful description in the user's language, never a mechanical Title Case conversion of the filename).
5. **Append at the end of `data`**: read current `.design`, append all new image nodes after the existing nodes (theme + page skeletons from Step 2), write back once. Do not modify any existing node.
6. **Skip validation here**: HTML pages are still empty at this stage, so `validate-design-file.mjs` check #10 will fail. Full validation is handled by Step 4.
7. **Quick integrity check** (lightweight, not full validation): After writing `.design`, re-read it and verify:
   - `data` array length = expected total (page skeleton count from Step 2 + image node count from this step)
   - The last N entries (where N = number of images registered) all have `type: "image"`
   - No duplicate `id` values exist across all nodes

   If mismatch → re-execute step 4 (re-append image nodes from the gap). **[FORBIDDEN]** proceeding to Step 3 with a mismatched `.design` file.

> **[FORBIDDEN]**
> - Delegating image node registration to page generation Sub-Agents (breaks the "Main Agent exclusively manages `.design`" invariant).
> - Selectively registering only "primary" images and dropping decorative ones — every file in `assets/` (that matches an image extension) becomes a node.
> - Reusing the same `id` across image nodes; ID counter is project-wide unique.

## Step 3 — Page Generation → Plan tree, generate shared fragments, then dispatch leaf sub-tasks

Before any `pages/*.html` file is generated, the Main Agent must build a
tree-shaped execution plan in `orchestration-summary.json.project.generationTree`.
The purpose is to prevent sibling pages from independently recreating the same
header/sidebar/body shell and drifting in color, radius, spacing, or content.

### Step 3.0 — Generation Tree Planning (Main Agent, blocking)

Classify the requested pages/states into shared and private regions:

1. **Project shell**: regions shared by all pages, usually app frame, header,
   sidebar/top nav, footer, global background, brand CSS usage, type scale,
   radius scale, shadow model, and CTA treatment.
2. **Shared branches**: regions shared by a subset of pages. Examples: two tab
   states sharing an order summary and table frame; modal-open and base state
   sharing the whole underlying page; A/B pages sharing all content except one
   tab panel while C has a different body.
3. **Leaves**: final page/state files that only fill private regions or mutable
   slots declared by ancestors.

Write the complete tree before dispatch in two places:

1. `orchestration-summary.json.project.generationTree`
2. `{designProjectPath}/generation-tree.json`

`generation-tree.json` is the dispatch SSOT and must be an actual file, not
only agent memory or a completion report. It must be a nested tree with a
top-level `root` node and recursive `children[]` arrays. Do not use a flat
top-level `nodes[]` array as the SSOT. Each node must define `nodeId`, `kind`
(`project-shell` | `shared-branch` | `page-leaf`), `pageIds`, `output`,
`sharedRegions`, `privateRegions`, `mutableSlots`, `status` (`planned` |
`generated` | `blocked`), and `children`. Shared nodes output reusable
fragments under `{designProjectPath}/partials/`; leaves output
`{designProjectPath}/pages/*.html`. The exact JSON shape is defined in
`operation-policies/orchestration-summary.md` "Required Schema" (`generationTree`).

The tree must be complete before any Task is dispatched: it must include every
planned page/state leaf, every shared branch, and every parent-child edge. A
tree with only `gen-project-shell` is incomplete for multi-page work and must
not proceed to page generation.

Example plan for pages A/B/C where A, B, and C share header/sidebar, while A
and B differ only in one tab panel:

```text
gen-project-shell (partials/project-shell.html: header + sidebar + root frame)
├── gen-ab-common (partials/ab-common.html: shared body except tab panel)
│   ├── gen-page-a (pages/a.html: tab A private panel)
│   └── gen-page-b (pages/b.html: tab B private panel)
└── gen-page-c (pages/c.html: C private body)
```

Dispatch order is dependency-based, not flat parallel:

1. Generate root `project-shell` fragment.
2. Generate each `shared-branch` fragment after its parent exists.
3. Generate leaf pages only after every ancestor fragment is complete.
4. Leaf siblings under the same completed parent may run in parallel.

[FORBIDDEN] Dispatching A/B/C page Sub-Agents independently when they share a
project shell or branch body. [FORBIDDEN] Allowing each leaf to invent its own
header/sidebar, card radius, brand color, shadow model, or shared body copy.

**Task batching rule (blocking)**: A parent generation-tree node and any of its
children must never be dispatched in the same assistant response / same
tool-call batch. Parent completion / subtree wait gates: see SKILL.md
§Architecture. Operationally, the Main Agent must:

1. Read `{designProjectPath}/generation-tree.json`, traverse from `root`, and
   dispatch only currently-ready child nodes whose parent path already has
   existing `output` files.
2. Wait for the Task result of every dispatched shared node.
3. Verify the declared `partials/*.html` file exists and update the node to
   `status: "generated"` in both `generation-tree.json` and
   `orchestration-summary.json.project.generationTree`.
4. Only then dispatch child shared nodes or leaf page nodes.

[FORBIDDEN] Passing `partials/project-shell.html` or any other inherited
fragment path to a leaf task before that file has been created. [FORBIDDEN]
Emitting a batch like `Task(project-shell), Task(page-a), Task(page-b)` in one
model turn. The correct sequence is `Task(project-shell)` → receive result →
verify file → read the nested tree → `Task(page-a), Task(page-b)` if both are
leaf siblings under the completed parent.

Shared fragments may include explicit mutable slots, for example `<!-- SLOT: activeNavItem -->`, `<!-- SLOT: pageTitle -->`, or `<!-- SLOT: tabPanel -->`. Leaves may fill only those slots and their own `privateRegions`. If a common region needs page-specific active styling, make that styling a slot; do not duplicate the whole common region.

**Active nav/tab protocol**: Parent fragments own the full header/sidebar/tab-bar
structure and active styling; leaf pages only fill the `activeNavItem` /
`activeTab` slot. Full slot rules (stable `data-nav-key` / `data-tab-key`,
`[data-active="true"]` styling, slot-only substitution): see
`page-generation-template.md` "Shared Input Data" Active nav/tab slot rule.

For Interaction-State Expansion pages, the state group must also appear in the
generation tree. Generate the base/common state as a shared parent, then derive
tab, loading, empty, error, modal, drawer, popover, and overlay leaves from it.

**Sub-Agents only generate HTML fragment/page files and do not write to
`.design`** — page nodes were pre-registered by the Main Agent in Step 2. Once
Sub-Agents complete HTML, they simply report back.

> **Constraint Reading (Sub-Agent Direct Mode)**: Sub-Agents read constraint files directly per `page-generation-template.md` Phase 0 + Phase 1 protocol. Main Agent does NOT pre-read or digest these files — this complies with SKILL.md "Main Agent only reads orchestration-scope files" invariant.

> **Aesthetics Read (Direct Mode)**: Sub-Agents read `aesthetics/index.md` directly during Phase 1a of `page-generation-template.md`. No pre-injection is needed — all aesthetic rules (tokens, typography, color, layout, imagery, accessibility, animation, state coverage, form validation) are consolidated in a single file (~634 lines, ~2500 tokens).

> **High-Fidelity Replication Override**: When `orchestration-summary.json.project.replicationMode === "high-fidelity"`, select the replication aesthetics mode and inject the Replication Directive + `visualSpecExcerpt` inline per `operation-policies/dispatch-schema.md` §1 and §9 — the source site IS the design authority; aesthetics reading is replaced entirely.
>
> **[MANDATORY]** The `visualSpecExcerpt` injected into the Task query must cover the FULL page (not just hero/first screen). If the excerpt only describes above-the-fold content, re-execute the reference material analysis with scroll captures before dispatching.

> **Reference Context Completeness Gate (High-Fidelity Replication Only)**:
> When `orchestration-summary.json.project.replicationMode === "high-fidelity"`, the Main Agent **MUST** verify the following before dispatching any Sub-Agent:
>
> | Check | Requirement | If Missing |
> |-------|-------------|------------|
> | Visual Spec Excerpt | Non-empty, ≥ 500 chars, contains at least 3 HEX color values | Re-execute reference-material-handling "Source Code Extraction" step |
> | Content to Preserve | Non-empty, contains page section names and key copy | Re-execute WebFetch + extract section inventory |
> | Layout patterns | Contains section count + grid structure description | Re-execute browser snapshot analysis |
>
> **[FORBIDDEN]** Proceeding to dispatch if any check fails. This gate cannot be waived.

> **Page Logical Order**: The Main Agent determined logical order when pre-assigning nodeIds in Step 2. When dispatching in Step 3, pass `nodeId` and `pageIndex` to the corresponding Sub-Agent — Sub-Agents do not need to generate IDs themselves.

> **Inter-page Navigation Wiring**: Before dispatching sub-tasks, the Main Agent must plan the **business flow path** between pages (i.e., the user's core browsing path), then pass both the "visible wiring mapping table" and the "hidden interaction table" to each Sub-Agent. **Default visible topology is linear single-chain** — pages connected head-to-tail in logical order (e.g., A→B→C→D), each page has exactly 1 visible exit. Only when the business flow itself branches is a page allowed 2 visible exits. [FORBIDDEN] Cycles in visible wiring topology — full DAG constraint, exit limits, hidden interaction rules, and topology rules in `operation-policies/wiring-strategy.md` "Map Principles". Sub-Agents, when generating HTML, must add `data-dom-id` attributes to all visible wiring controls and all hidden interaction controls. Full rules in `operation-policies/wiring-strategy.md`.

Sub-tasks are based on the shared template `{SKILL_DIR}/workflows/page-generation-template.md`. **All shared dispatch fields are assembled per `operation-policies/dispatch-schema.md`** (aesthetics mode selection, Library constraints block, free-explore color/shadow/typography policies, shared project shell contract, design read/dials, continuity anchors, generation tree contract, state group contract, comparison context, wiring/hidden interaction tables, image resources table, P0 alignment + heading/CTA checklists). Only **create-specific differentiated parameters** are listed below:

```
Task: Generate HTML page or shared fragment "{generation node name}"

(Aesthetics mode note: select and include per dispatch-schema.md §1 based on operatingMode/replicationMode)

Output:
  - Leaf page task: {designProjectPath}/pages/{page-name}.html
  - Shared generation-tree node task: {designProjectPath}/partials/{fragment-name}.html
  ([FORBIDDEN] Do not write to .design file — page nodes were pre-registered by Main Agent in Step 2)
After completion, must report to Main Agent in JSON code block format (bare file paths or Markdown links are forbidden). Required fields: "nodeId", "page", "title", "domIds", "componentsRead", "extraComponentsRead", "aestheticsRead", "aestheticsSkipped", "nestingDepthCheck", plus every shared evidence field defined in page-generation-template.md "Completion Report Fields" ("designIntentEvidence", "interactionStates", "alignmentEvidence", "headingCtaEvidence", "motionEvidence", "sourceContextPreserved", "stateGroupId", "sharedShellPreserved", "generationNodeId", "inheritedFragmentsUsed", "privateRegionsGenerated", "sharedFragmentsPreserved", "htmlWriteMode", "headManagementEvidence", "animationLibrariesUsed", "qualityGate").
Shared template: {SKILL_DIR}/workflows/page-generation-template.md (pre-steps, constraint files, shared rules all in this file)
All shared dispatch fields: assemble per {SKILL_DIR}/operation-policies/dispatch-schema.md, populated with this project's concrete values (never bare references like "keep same style")
Differentiated input (create-specific):
  - Node ID (nodeId): {ID pre-assigned in Step 2, e.g., page-pricing}
  - Page logical index (pageIndex): {sequence number starting from 1}
  - Page requirements: {user's description for this page}
  - Generation tree context: {current node plus ancestors; concrete values in the format of dispatch-schema.md §6}
  - State group contract: {concrete values in the format of dispatch-schema.md §7; only when this page belongs to Interaction-State Expansion, otherwise omit}
  - Visual north star / Composition pattern / Continuity anchors: {this page's values from orchestration-summary; composition pattern required for showcase / brand / landing pages; at least 2 shared anchors for multi-page projects}
  - Visible wiring mapping table + Hidden interaction table: {this page's rows only; format per dispatch-schema.md §10; omit empty tables}
  - Available image resources: {this page's rows plus shared assets only; format per dispatch-schema.md §11}
  - Reference Material Context / Long Requirement Context / Replication Directive + Visual Spec Excerpt: {when applicable; format per dispatch-schema.md §9}
Additional notes:
  - [CRITICAL] Dispatch Format is Non-Negotiable: full assembly structure and prohibitions per dispatch-schema.md "Dispatch Assembly Checklist" + §12. If the full dispatch cannot be constructed (e.g., missing component plan), fall back to in-context generation (Main Agent generates HTML directly) rather than dispatching an unconstrained Sub-Agent.
  - [CRITICAL] Head write mode is mutually exclusive per page: SkeletonMainOnly (run fill-html-head.mjs first, then edit only inside <main>) or FullHtmlReplaceHead (write full HTML first, then run fill-html-head.mjs --replace-head). [FORBIDDEN] fill-html-head.mjs skeleton → full-file Write. Derived state pages never run fill-html-head.mjs — they poll-and-copy the base HTML per page-generation-template.md Pre-step. Full execution rules + CLI flag format + theme auto-inference: page-generation-template.md Pre-step.
  - Wiring rules detailed in operation-policies/wiring-strategy.md. Add data-dom-id in HTML for all entries in the visible wiring mapping table and hidden interaction table. Do not leave visible cross-page controls unregistered.
```

### Step 3.1 — Sub-Agent Failure Fallback

Follow `page-generation-template.md` "Sub-Agent Failure Fallback (Universal)" — retry once with the `[RETRY]` note; if the retry also fails (including no response or invalid/incomplete completion JSON), fall back to **in-context generation**: the Main Agent reads the 4 constraint files (`sub-agent-hard-rules.md`, `page-generation-quality-gate.md`, `html-implementation.md`, `html-implementation-{device}.md`) directly and generates the page HTML itself.

## Step 3.5 — Consolidate Reports + Page Reordering + Wiring Registration + Persistence Confirmation (Main Agent, after all sub-tasks complete)

After all Sub-Agents complete, the Main Agent must execute the following operations in order:

### 3.5a — Consolidate domId lists reported by Sub-Agents

Collect information reported by all Sub-Agents and build an **expected interaction checklist** — one line per planned interaction in the form `{source page (htmlSrc)} → {domId} → {target page}`, with `[hideEdge=true]` appended for hidden entries (e.g., `Home (pages/index.html) → cta-products → Products page`; `Products (pages/product.html) → back-home → Home page [hideEdge=true]`).

This interaction checklist will be used for Step 3.5b persistence confirmation and passed to Step 4 script's `--require-interactions` parameter. If a Sub-Agent's reported domId list is inconsistent with the visible wiring map or hidden interaction plan (e.g., a page should have `cta-pricing` or `shortcut-blog` but Sub-Agent reported empty), the corresponding HTML must be fixed before proceeding.

### 3.5a-1 — Consolidate design intent and motion evidence

Collect all evidence fields defined in `page-generation-template.md` "Completion Report Fields" from every Sub-Agent completion JSON before writing final wiring, and verify them against that section's gate conditions. Create-flow emphasis:

1. Every page: non-empty `designIntentEvidence.visualNorthStarApplied`, `interactionStates`, `alignmentEvidence`, `headingCtaEvidence`, `motionEvidence`, and explicit `animationLibrariesUsed` (`[]` unless the Animation Library Exception in `operation-policies/html-implementation.md` applies).
2. Showcase / brand / landing pages: `compositionPatternUsed` non-empty and matching the page's `compositionPattern` unless the report explains a concrete business reason for deviation.
3. Multi-page projects: at least 2 `continuityAnchorsApplied` recur across pages (e.g., Header/Footer treatment, CTA style, surface layering, type rhythm).
4. `sourceContextPreserved`: `"not applicable"` is valid for ordinary new-project pages; comparison pages derived from an existing source page must name at least 3 preserved source-page elements.
5. If any evidence is missing/generic, an unjustified animation library appears, or a page visibly falls back to an unplanned generic card wall → perform one targeted repair/regeneration with the missing visual fields emphasized. [FORBIDDEN] proceeding to Step 4 with missing completion evidence.

### 3.5b — Atomic Reorder + Wiring Registration + Persistence Confirmation

> **All operations below are performed in a single pass to minimize context overhead and reduce the window for overwrites.**

1. **Read** the `.design` file **once**
2. **Reorder** page nodes by logical page order (homepage first, core business pages in the middle, contact/support pages last):
   - Follow common-sense page type ordering: Home/Landing → Core products/services showcase → Brand/About/Team → Contact/Support/FAQ
   - Only adjust positions in the `data` array; do not modify any field content of nodes (except interactions below)
   - `canvasData` x/y keep default value 0; the canvas SDK's `autoLayout` automatically calculates layout positions based on array order
3. **Register interactions** — traverse all page nodes, build a **page title → node ID** mapping, then populate `devMetadata.interactions` for each source page node based on the visible wiring map and hidden interaction plan:
   - Each wiring entry contains `domId` (corresponding to `data-dom-id` in HTML) and `targetPageId` (target page's node ID)
   - Hidden interaction entries must include `hideEdge: true`; they remain clickable in preview but do not draw visible canvas edges
   - Full rules in `operation-policies/wiring-strategy.md`
4. **Self-check before writing**: Verify each source page has ≤ 2 visible exits, total visible wiring count ≤ page count. Hidden interactions with `hideEdge: true` do not count as visible exits. If a source page has multiple visible entries pointing to the same target, merge into one (keep the most semantically strong domId). Do not merge away hidden interactions that correspond to distinct visible controls.
5. **Write back** to `.design` **once**
6. **Re-read once** to confirm ALL of the following:
   - Page node count in `data` array = expected page count (number of sub-tasks dispatched in Step 3)
   - Each domId in the expected interaction checklist exists in the corresponding page node's `devMetadata.interactions`
   - Each interaction's `targetPageId` points to an existing page node
7. **If any check fails** → the write was overwritten or did not take effect. Re-execute from step 1 of this sub-step — **max 3 attempts**; if checks still fail after 3 attempts, report the remaining errors to the user and stop. [FORBIDDEN] to proceed to Step 4 without passing.


## Step 4 — One-pass Complete Validation (Main Agent, Blocking — must not skip)

> **This step is blocking. After all Sub-Agents complete and before guiding the user to preview, the Main Agent must personally execute this validation. [FORBIDDEN] to proceed to Step 5 without passing validation.**

Use `scan-design-directory.mjs` for one-pass complete validation, avoiding multiple tool calls:

```bash
node {SKILL_DIR}/script/scan-design-directory.mjs <design-project-path> \
  --expected-pages=<N> \
  --require-interactions=<domId1>:<pageFile1>,<domId2>:<pageFile2>,...
```

- `<design-project-path>`: Design project root directory path
- `--expected-pages=<N>`: Total number of pages expected for this run (i.e., number of sub-tasks dispatched in Step 3)
- `--require-interactions`: Expected wiring checklist consolidated in Step 3.5a, formatted as comma-separated `domId:owningHTMLfilename` list, e.g., `cta-products:index.html,cta-pricing:product.html,cta-contact:pricing.html`; the script will simultaneously verify: whether the domId exists in the corresponding HTML file, and whether it has been registered in `.design`'s interactions

When exit code is 1, follow the repair procedure in `operation-policies/design-project-validation.md` — **max 3 repair rounds**; if validation still fails after 3 rounds, report the remaining errors to the user and stop.

## Step 5 — Guide Preview (Main Agent)

Keep the textual summary link-free and rely on the host-rendered artifact entry for the `.design` file. If the user prefers to preview HTML directly in a browser, a local HTTP service can also be started (see `operation-policies/output-delivery.md` "Preview Method" section).

Since the canvas entry was already created in Step 2, the user can actually open the canvas at any time during page generation to view completed pages.

**Finish summary must not include manual links**, format specified in `operation-policies/output-delivery.md` "Artifact Declaration" section.

> **[NOTE] Preview screenshot is optional.** If using browser tools to take a screenshot, do NOT attempt to `Read` the screenshot PNG file (binary files cannot be read as text). The DOM snapshot from `browser_navigate` is sufficient for verification purposes.

### Page Summary Table

Output a Markdown table to the user, providing an overview of all pages generated, with columns: **Page** (page title), **File** (path relative to project root), **Content Summary** (main modules/sections), **Key Interactions** (buttons, forms, hover effects, anchor navigation, etc.), and **Navigation Wiring** (pages connected via visible interactions, shown as canvas arrows — hidden interactions with `hideEdge: true` such as Back / return, global nav, breadcrumbs, secondary CTAs, and skip links are not visible wiring). Example:

| Page | File | Content Summary | Key Interactions | Navigation Wiring |
|------|------|-----------------|------------------|-------------------|
| Home | `pages/index.html` | Hero section + Feature showcase + Statistics + CTA | Navigation jumps, CTA buttons, card hover | → Products page (CTA button) |
| Pricing | `pages/pricing.html` | Plan comparison + FAQ | Plan toggle, FAQ accordion | → Contact Us (inquiry button) |
| Contact Us | `pages/contact.html` | Contact form + Map | Form submission | (No outgoing wiring) |
