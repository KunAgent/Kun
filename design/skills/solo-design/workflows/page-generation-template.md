# Page Generation Sub-task — Shared Template

> This file is the **shared template** for all "page generation/editing" type sub-tasks. Each workflow constructs Sub-Agent calls by referencing this template + passing differentiated parameters, avoiding repetition of the same constraint file lists, notes, and prohibition rules across multiple workflows.

## Pre-step — Generate HTML Skeleton or Copy Base HTML

> Only applicable to **new page creation** scenarios. Skip this step when editing existing pages.

> **[NOTE] Directory structure is pre-created by the Main Agent.** The `pages/` and `assets/` directories already exist. [FORBIDDEN] running `mkdir` to re-create them — this wastes a tool call for no benefit.

### Derived state pages: poll and copy the base HTML first

If the task input has `stateRole: "derived"`, this branch is mandatory and overrides all generic skeleton instructions below.

- [FORBIDDEN] Running `fill-html-head.mjs` for a derived state page.
- [FORBIDDEN] Creating a fresh skeleton or rebuilding the shared shell when the base HTML is missing.
- Resolve `derivedFromHtmlSrc` relative to `{designProjectPath}` when it is not absolute.
- Poll for the base HTML and copy it byte-for-byte before editing — **retry up to 10 times** with a short sleep (this is the single authoritative retry count; other documents reference this section). If the copy still fails after retries, stop and return `qualityGate: "blocked"` with `blockedReason: "missing base state html after retry: <path>"`. Missing base HTML is a temporary readiness condition, not permission to run `fill-html-head.mjs` or synthesize a fallback skeleton.
- After copying, edit only the declared `mutableRegions`; preserve the copied head, outer `<main>`, shell, tab/control frame, spacing, typography, radius, shadow, and common content.

Use this exact readiness pattern before any derived-state edit:

```bash
base="{designProjectPath}/{derivedFromHtmlSrc}"
out="{designProjectPath}/pages/{page-name}.html"
for i in 1 2 3 4 5 6 7 8 9 10; do
  [ -s "$base" ] && cp "$base" "$out" && break
  sleep 2
done
[ -s "$out" ] || { echo "missing base state html after retry: $base"; exit 2; }
```

If `derivedFromHtmlSrc` is already absolute, use it directly as `base` instead of prefixing `{designProjectPath}`.

### Ordinary/base pages: generate HTML skeleton

Before any HTML write, choose exactly one head-management mode and keep it for
the whole page:

- **`SkeletonMainOnly` (default)**: run `fill-html-head.mjs`
  first, then only replace/append content inside the existing `<main>` element.
  [FORBIDDEN] using a full-file `Write` after the skeleton exists.
- **`FullHtmlReplaceHead` (fallback only)**: write a full HTML file
  only when targeted `<main>` editing is impossible, then immediately run
  `fill-html-head.mjs <css> <file.html> --replace-head`. [FORBIDDEN] running a
  skeleton first in `FullHtmlReplaceHead`. [FORBIDDEN] manually copying the generated `<head>`
  from another file or from memory.

The two modes are mutually exclusive. The exact historical failure pattern
`fill-html-head.mjs → full-file Write` is a blocking violation because it
destroys or drifts the generated `<head>` infrastructure.

Run the script to automatically generate an HTML skeleton with complete `<head>`, avoiding manually filling 200+ lines of template:

```bash
node {SKILL_DIR}/script/fill-html-head.mjs {cssFilePath} {designProjectPath}/pages/{page-name}.html --title="{page title}" --lang="{language code}" --prefix={brandPrefix}
```

> **When `chartsRequired: true`** for this page (from orchestration-summary), append `--charts`:
> ```bash
> node {SKILL_DIR}/script/fill-html-head.mjs {cssFilePath} {designProjectPath}/pages/{page-name}.html --title="{page title}" --lang="{language code}" --prefix={brandPrefix} --charts
> ```

> **⚠️ Parameter Order Is Critical (common failure pattern)**:
> - **Arg 1** = CSS file path (the `colors_and_type.css` from Library or project)
> - **Arg 2** = Output HTML file path (the page to generate)
> - `--title` = Page title string
> - `--lang` = Language code (e.g., "en", "zh-CN")
> - `--prefix` = Brand prefix (e.g., "slds", "volcano")
>
> **[FORBIDDEN] Swapping the CSS and HTML arguments** — this causes the script to read the HTML as CSS input, resulting in "No :root block found" warnings and an empty/broken skeleton.
>
> **Concrete example** (with a SLDS CRM Library):
> ```bash
> node /data/user/skills/solo-design/script/fill-html-head.mjs \
>   /workspace/design_library/colors_and_type.css \
>   /workspace/crm-dashboard/pages/dashboard.html \
>   --title="CRM Dashboard" --lang="en" --prefix=slds
> ```

The script generates a complete HTML file (with inline brand CSS `<style id="theme-vars">` + `@theme inline` bridge + Tailwind CDN + Lucide CDN), where `<main>` is empty. Subsequently, only use editing tools to append page content inside the `<main>` tag.

[FORBIDDEN] Do not manually output `<link>` tags in `<head>`, Tailwind/Lucide CDN references, or base styles — these are already auto-filled by the script.
[FORBIDDEN] After this script has created the file, do not use a full-file
`Write` tool on the same HTML file. If a full-file rewrite is unavoidable, switch
to `FullHtmlReplaceHead` by writing full HTML first and then running `--replace-head`; never
use both orders on the same page.

> **Custom CSS placement (`FullHtmlReplaceHead` only — free-explore/high-fidelity)**:
> If you use `FullHtmlReplaceHead` (write full HTML then run `--replace-head`), any custom `<style>` blocks MUST be placed inside `<body>` (e.g., before `</body>`), NOT inside the placeholder `<head>`. Reason: `--replace-head` replaces the entire `<head>` content; anything there will be lost.
>
> In library-bound mode, custom CSS classes are FORBIDDEN entirely — use Tailwind utilities + CSS variables only.

## Constraint Files (read by phase)

### Standard Mode (ALL dispatches)

Sub-Agent MUST read Phase 0 + Phase 1 files directly. No pre-injection or digest mode.

Phase 1a — Aesthetics:
- Normal modes (free-explore / library-bound): Sub-Agent reads `{SKILL_DIR}/aesthetics/index.md`. **[BLOCKING — FORBIDDEN to skip]**.
- High-fidelity replication (`replicationMode === "high-fidelity"`): Sub-Agent skips aesthetics read — `visualSpecExcerpt` in Task query is the design authority.

> [RATIONALE] Historical failure: Sub-Agents skipped Phase 1a aesthetics reads when left to self-direct. The `[BLOCKING — FORBIDDEN to skip]` annotation makes the read obligation explicit and machine-parseable.

> When the Quality Gate flags an aesthetic violation post-generation, Sub-Agent should deep-read `{SKILL_DIR}/aesthetics/index.md` (locate the relevant §N section) or `{SKILL_DIR}/aesthetics/self-check.md` for detailed rules, then fix and re-check.

### Phase 0 — Hard Rules ([Blocking] read before ANY implementation)

- `{SKILL_DIR}/operation-policies/sub-agent-hard-rules.md` — **Single source of truth** for all [FORBIDDEN] rules, Token fidelity constraints, script usage, componentPlan reading obligation, and Style Integrity Self-check. **Must read every time, no exceptions.**
- `{SKILL_DIR}/operation-policies/page-generation-quality-gate.md` — compact page-level quality gate for token compliance, style infrastructure, Library conformance, responsiveness, images, density, and anti-AI-slop. **Must read every time before writing and execute after writing.**

### Phase 1 — Read when generating/editing page content

- `{SKILL_DIR}/operation-policies/html-implementation.md` — HTML shared technical constraints (**must read every time**)
- Append reading by device type (**choose one based on "device type" input field, must not read both**):
  - Desktop / Tablet (desktop / tablet): `{SKILL_DIR}/operation-policies/html-implementation-web.md` — Desktop-specific layout constraints for columns, navigation bars, chart areas, form column widths, etc.
  - Mobile (mobile): `{SKILL_DIR}/operation-policies/html-implementation-mobile.md` — Mobile-specific layout constraints for screen efficiency ratio, dual-column cards, first-screen layering, border-radius protection, etc.
- `{SKILL_DIR}/operation-policies/page-density-strategy.md` — Page information density type strategy & Library restraint mode layout rules (**read when the quality gate or page record marks density risk, information-dense/task-driven page type, or `libraryRestraintMode: true`**)
- **Aesthetics — Full-Read Protocol** (Sub-Agent reads aesthetics spec before writing):

#### Design Authority Priority Chain (when Design Library exists)

When a Design Library is assigned (`operatingMode: library-bound`), the following strict priority applies to ALL visual decisions:

| Priority | Source | Authority Scope | Behavior |
|----------|--------|----------------|----------|
| 1 (Highest) | **Design Library** — resolved component contracts, UI Kit layout, SKILL.md Essentials, css.json token system | Layout patterns, spacing, component structure, color usage, typography scale, border-radius, shadows | **MUST follow exactly.** Do not "improve", "correct", or "simplify". |
| 2 | **Aesthetics Rules** (from aesthetics/index.md) | Only applies to areas the Library does NOT explicitly specify | Gap-filling: use aesthetics as guidance for decisions the Library is silent on (e.g., animation timing, accessibility patterns, anti-AI-slop avoidance) |
| 3 (Lowest) | **Agent Creativity** | Only when BOTH Library and Aesthetics are silent | Free to decide, but must remain stylistically consistent with Library's established tone |

**Conflict resolution rule**: If an aesthetics rule contradicts a Library spec, **Library wins without exception**. Examples:
- Aesthetics says "max 5 colors" but Library defines 12 semantic tokens → use all 12
- Aesthetics says "spacing rhythm 16/24/32/48" but UI Kit uses gap-10 (40px) → use gap-10
- Aesthetics says "nesting depth ≤ 3" but Library component has 3 internal layers → allow 4 total (section + component layers)
- Aesthetics says "unified border-radius" but Library defines different radius per component → follow Library per-component radius

**[MANDATORY]** In library-bound mode, treat aesthetics as "fallback guidance for Library gaps" — not as a constraint that overrides Library evidence.

#### Phase 1a — Mandatory aesthetics read before writing (no exceptions)

Read the aesthetics spec before generating any page content. [FORBIDDEN] to skip unless in high-fidelity replication mode (where visualSpecExcerpt replaces aesthetics):

| File | Lines | Mandatory | Skip condition |
|------|-------|-----------|----------------|
| `{SKILL_DIR}/aesthetics/index.md` | ~634 | Yes | replicationMode === "high-fidelity" |

> **Design rationale**: All aesthetic constraints (tokens, typography, color, layout, imagery, accessibility, animation, state coverage, form validation) are consolidated in a single file. This eliminates the previous multi-file read paradox while keeping the full spec accessible in one read.
>
> **Read budget**: ~634 lines (~2500 tokens). This is a one-time cost per page generation that prevents expensive re-generation cycles caused by aesthetic violations.

#### Library-Bound Mode Read Order (when UI Kit exists)

When `operatingMode: 'library-bound'` and a UI Kit `index.html` is provided:

1. **First**: Read current page's planned `componentPlan[].previewFile` files (all available, no quantity limit) — establishes component DOM structure, visual patterns, CSS variable usage, and spacing as the primary implementation reference
2. **Then**: Read current page's planned `componentPlan[].contractFile` files — establishes semantic metadata (representativeVariants, anatomy, visualTraits, unknowns, structurePatterns) as supplement. When no `previewFile` exists for a slug, `contractFile` is the sole source for that component.
3. **Then**: Read UI Kit `index.html` when provided — establishes layout rhythm, information density, and composition patterns
4. **Then**: Read `aesthetics/index.md` — fills gaps not covered by Library evidence/UI Kit (animation, accessibility, imagery rules)
5. **Priority rule**: Where preview HTML patterns conflict with contractFile JSON → **preview wins**. Where UI Kit patterns conflict with resolved component contracts → **component data wins**. Where UI Kit conflicts with aesthetics → **UI Kit wins**.

> In Free Explore Mode (no UI Kit), read only `aesthetics/index.md` — it serves as the sole design authority.

#### Phase 2 — Read after page is complete (quality gate + triggered self-check)

| File | Lines | Why post-write |
|------|-------|---------------|
| `{SKILL_DIR}/operation-policies/visual-zero-tolerance.md` | ~80 | **[BLOCKING — SECOND READ]** Re-read and execute the 5-point verification procedure at the bottom of the file. Fix any violation before proceeding to quality gate. |
| `{SKILL_DIR}/operation-policies/page-generation-quality-gate.md` | ~120 | Compact blocking gate for every page. Must execute before declaring completion. |
| `{SKILL_DIR}/aesthetics/self-check.md` | ~365 | Deep aesthetic checklist. Read the relevant section when the quality gate flags a visual issue; read the full file for brand/marketing Showcase home pages. |

## Shared Input Data

> **Field schema (names, applicability, required-when, formats) is defined in `operation-policies/dispatch-schema.md` — the SSOT the Main Agent uses when assembling dispatches. This section defines how Sub-Agents CONSUME those fields.** When you receive a Task query, the fields are already populated with concrete values — use them directly without cross-referencing the schema file.

### Consuming Library constraints (when present)

- Orchestration summary path: read once, extract only the current `nodeId` page slice, then proceed.
- Brand CSS file path: already inlined via `<style id="theme-vars">` by `fill-html-head.mjs`; do not handle manually.
- Actual Token Name Reference: **[MUST] only use variable names from the provided list, formatted as `var(--{tokenName})`; guessing/fabricating names is [FORBIDDEN]**. Same for font (Library typography class names like `{prefix}-h1` or font-category tokenNames), radius, and shadow references.
- Layout reference (`{library-path}/ui_kits/{type}/index.html`): **[Blocking]** when provided — must read after planned component data; [FORBIDDEN] to generate page content without reading.
- Component Plan consumption order:
  1. For every `componentPlan` entry with `previewFile`, read it **FIRST** as the primary implementation reference. Match DOM patterns, CSS variable usage, and spacing observed in the preview. No per-page limit on preview reads.
  2. Read `contractFile` as semantic supplement (representativeVariants, anatomy, visualTraits, unknowns). When no preview exists for a slug, contractFile is the sole source.
  3. `debugFile` is for debug/refine only; do not read during normal generation when contractKind=evidence.
  - [FORBIDDEN] Reading previews for components not in the current page's componentPlan; ignoring previewFile DOM patterns when available and implementing differently without justification; re-scanning the full Component Index before every UI block; implementing a planned or discovered component from scratch when its resolved contract exists.
  - **Bounded supplement rule**: if a required component is missing from the plan, read at most 2 extra resolved component contract files (prefer the Allowed components whitelist) and report them in `extraComponentsRead`.
- Token fidelity constraints: apply as passed (full rules in `sub-agent-hard-rules.md` §Token-Fidelity).
- Forbidden invented components: [FORBIDDEN] inventing implementations for those slugs; use Tailwind utilities for their functionality instead.
- Style constraints (radiusMax / spacingBase / fontSizeBody / fontSizeMin / controlHeights): hard numeric boundaries; override aesthetics rhythm rules where they conflict. [FORBIDDEN] exceeding radiusMax.
- Theme mode: when `dark`, the Library CSS `.dark` block provides the palette; read `aesthetics/dark-mode.md` only for uncovered aspects (image treatment, shadow strengthening).
- Product context: use for tone calibration and copy generation (enterprise-formal vs. consumer-casual vs. developer-technical).
- Extra Library Constraints (when present): treat as supplementary rules with priority equal to componentPlan constraints.
- **Icon Assets** (Library-bound only; omit entirely for Free-explore):
  - Render: `<span data-icon class="w-{n} h-{n}" style="-webkit-mask-image: url('{path}'); mask-image: url('{path}');">`
  - Default coloring: `currentColor` (inherits parent text color automatically — most icons need no explicit color)
  - Override coloring: only when icon needs a DIFFERENT color than surrounding text, add `background-color: var(--{prefix}-{token})` to inline style
  - Path pattern: `../assets/icons/{libraryKey}/{name}.svg` — always quote the URL in `url('...')`
  - Available Library icons: {availableNames from orchestration-summary.designSource.iconAssets}
  - Priority: Library SVG via mask-image when semantic match exists → Lucide `<i data-lucide="...">` fallback
  - When to override color (examples):
    - Muted/secondary icon → `background-color: var(--{prefix}-muted-foreground)`
    - Brand/CTA emphasis → `background-color: var(--{prefix}-primary)`
    - State icon → `background-color: var(--state-success/error/warning/info)`
    - If Library defines icon-specific tokens (e.g., `--{prefix}-icon-color`), prefer those
  - [FORBIDDEN] hardcoded hex/rgb/hsl on icon background-color
  - [FORBIDDEN] using icon names NOT in availableNames
  - [FORBIDDEN] unquoted url() — always use url('...') with single quotes for filename safety
  - For existing-page edits: apply to newly added/touched icons only; do not rewrite unrelated existing Lucide icons

### Consuming project-level context

- **Dashboard mode** `true`: fixed viewport dashboard layout is allowed, ordinary responsive layout gate is skipped, horizontal overflow beyond the target canvas remains forbidden.
- **Project business theme / page business scenario**: core semantic anchors for content and image semantics on this page.
- **Style definition brief**: in free-explore mode, treat as the global visual north star.
- **Design read**: use to avoid generic defaults; do not expose as user-facing prose.
- **Design dials** (1-5 `layoutVariance` / `motionIntensity` / `visualDensity`): `layoutVariance` controls conservative vs. asymmetric/editorial composition; `motionIntensity` follows the motion execution mapping in dispatch-schema.md §5 and never overrides performance or reduced-motion rules; `visualDensity` never overrides `page-density-strategy.md`. In Library-bound mode, dials are secondary guidance only where the Library is silent.
- **Historical style continuity anchors**: in no-Library multi-turn projects, binding constraints for `colorSystem`, `shapeSystem`, `typographySystem`, `spacingSystem`, `componentLanguage`, `surfaceAndDepth`, `imageryAndIconography`, `interactionTone` unless the current user query explicitly overrides a dimension. Do not introduce a new palette, radius scale, font family, card/button language, or depth model just because the current task did not restate them.
- **Typography discipline**: use the project title/body font stacks from `styleContinuityAnchors.typographySystem` and `sharedProjectShellContract`. Do not introduce a new serif face for this page or one heading. If the project uses an editorial/culture serif tone, all Chinese Display/H1/H2 roles must share the same CJK serif family — a heading using a different serif from the shared type system is a Gate failure.
- **Shared project shell contract**: binding for multi-page projects — preserve shared navigation/header/sidebar/footer, single primary color system, type stack/scale, radius scale, surface/depth model, CTA style, and alignment rhythm. It applies across ordinary sibling pages; the state group's `sharedShellContract` is stricter and applies to same-screen visual states. [FORBIDDEN] Re-inventing navigation, primary CTA color, card radius, shadow model, or font stack per page.
- **Free-explore color/shadow policies**: apply the policy text as passed (definitions in dispatch-schema.md §4). Treat `secondary`/`accent` variables in old project files as legacy drift to avoid.
- **Visual north star**: organize the first screen and hierarchy around this intent before writing HTML.
- **Composition pattern**: binding for showcase / brand / landing pages; ordinary task pages should still use it as their rhythm pattern when present.
- **Continuity anchors**: apply these cross-page anchors and report which ones were actually implemented.
- **Language**: keep all page copy consistent with the user's input language.

### Consuming the generation tree contract (binding when present)

- If this task is a `project-shell` or `shared-branch` node: output only the declared fragment under `partials/` and include explicit slot comments for descendants. Parent/shared fragments must avoid orphan micro-rows: do not create a full-width row that contains only one tiny standalone element with arbitrary padding/margin. If a single element must occupy a row, align it deliberately to the shared grid (left/center/right) or complete the row with related content such as title, metadata, status, action, tabs, or controls.
- If this task is a page/state leaf: first read `generationTreePath`, find the current node and ancestors by traversing the nested `root.children[]` tree, then read inherited fragments in order, preserve them unchanged except declared `mutableSlots`, and fill only `privateRegions` into the final page. [FORBIDDEN] Rebuilding inherited header/sidebar/global shell/shared body in a leaf page. [FORBIDDEN] Changing shared content, radius, color, shadow, spacing, or typography in a leaf just to "improve" one page.
- Active nav/tab slot rule: parent/shared fragments own the complete header/sidebar/tab-bar DOM and CSS. Each shared nav/tab item must expose a stable `data-nav-key` or `data-tab-key`; clickable items also keep `data-dom-id`. The parent defines the active visual state once via `[data-active="true"]` and includes `<!-- SLOT: activeNavItem -->` or `<!-- SLOT: activeTab -->`. Leaf pages may only fill that slot to set the current key active. [FORBIDDEN] Copying, rewriting, reordering, or restyling the header/sidebar/tab bar in a leaf just to mark active state.
- Slot substitution rule: descendants may replace only the exact slot comments declared by ancestors. Do not copy a parent shared region and then manually rewrite its breadcrumb, tabs, summary card, header, sidebar, or frame. If a parent fragment already contains order summary, tab bar, breadcrumb, or root shell HTML, the leaf page must include that parent fragment once and inject only the leaf's `privateRegions` into the relevant slot. Duplicate occurrences of parent-owned content in a leaf page are a generation-tree violation.
- Leaf readiness check: before writing the page, verify every path in `inheritedFragments` exists and is readable. If any inherited fragment is missing, do not synthesize a replacement, do not create the final page, and return a completion block with `"qualityGate": "blocked"` and `"blockedReason": "missing inherited fragment: <path>"`. A leaf task started before its parent fragment exists is an orchestration error, not permission to invent the shared shell.

### Consuming the state group contract (binding when present)

- If `stateRole` is `derived`: first read/copy `derivedFromHtmlSrc` (using the Pre-step poll-and-copy readiness pattern when the file is not yet visible) and edit only the declared `mutableRegions`. Preserve the root layout, outer `<main>` element and its style/class attributes, header/sidebar/nav, identity/summary area, control/tab bar position and dimensions, tab/control-to-panel seam, panel wrapper padding/background/border, page background, typography scale, spacing scale, radius/shadow model, and common component language exactly unless those regions are explicitly listed as mutable.
- [FORBIDDEN] Generating a derived state page from scratch, rerunning `fill-html-head.mjs`, rebuilding inherited fragments, changing `<main>` padding/background, or changing non-state content to "improve" the page.
- If `derivedFromHtmlSrc` is missing from task input or the base file is still unavailable after retries, stop and return `"qualityGate": "blocked"` with `"blockedReason": "missing base state html after retry: <path>"`.
- For tab states, the tab switcher and tab panel must be one shared content frame. The derived page may switch active/inactive tab styling and replace the panel body only; it must not move the tab bar, add/remove outer padding, or make the tab switcher look like an isolated floating control.

### Consuming source-page context for comparison pages (Quick Path A0/A1)

- The source page is immutable; implement requested changes only in the new comparison page.
- Preserve the visible shell, navigation/sidebar/header, key content regions, background treatment, spacing rhythm, typography hierarchy, radius/shadow model, and component language unless the user explicitly asked to change that dimension.
- The new page must visibly continue the source page. For search panels, modals, empty/loading/error states, and detail overlays, show the source page context underneath or around the new state (e.g., a dimmed inherited screen with the overlay). [FORBIDDEN] generating an isolated floating card or modal on a blank canvas when the requested state is based on an existing page.

### Overlay / floating layer states

When the state page represents an opened modal, drawer, popover, command palette, menu, preview panel, or similar floating layer, preserve the copied source page underneath and add the layer on top. Use a transparent, translucent gray, blur, or dim overlay according to the product style. Add `data-dom-id` to the backdrop/scrim if it closes the layer, and to every explicit close/cancel/back button inside the layer. These controls must appear in the hidden interaction table and navigate back to the source/base page with `hideEdge: true`. [FORBIDDEN] Rendering a floating layer without a registered close path when the UI visibly implies one.

### Consuming reference / requirement / redesign context (when present)

- **Reference Material Context**: apply visual constraints and layout patterns to preserve; "Content to preserve" is the authoritative content source in high-fidelity replication — do not fabricate alternative copy; for high-fidelity intent, use the Visual Spec Excerpt's exact values (colors/spacing/typography/layout), not approximations; prefer Source Asset Inventory assets per their reuse priority.
- **Long Requirement Context**: the page must visibly cover the must-have content/features and acceptance notes; intentionally deferred items may be simplified.
- **Redesign audit snapshot**: fix the listed `primaryIssue`/`fixPriority` items while preserving the listed `preserve` content and respecting `risk` constraints.

### Consuming image resources

The "Available image resources" table is filtered to this page (plus shared assets). Sub-Agent is **[FORBIDDEN] from calling image generation tools** — reference only images from the table with path `../assets/{filename}`; reuse the semantically closest image when no exact match exists; render `degraded` assets via the approved CSS degradation pattern, never broken `<img>` tags.

## Completion Report Fields

Every page generation/editing sub-task must return a JSON completion block. In addition to workflow-specific fields such as `nodeId`, `page`, `domIds`, `componentsRead`, and `qualityGate`, the report must include:

```json
{
  "designIntentEvidence": {
    "visualNorthStarApplied": "short text describing how the page visual intent is visible",
    "compositionPatternUsed": "Asymmetric two-column",
    "continuityAnchorsApplied": ["CTA style", "surface layering"],
    "antiSlopCheck": "no rainbow gradient, no icon tile wall, no generic hero"
  },
  "interactionStates": {
    "buttons": "default/hover/active/focus-visible/disabled coverage",
    "navigation": "hover/focus/active treatment",
    "cardsAndMedia": "clickable cards/media feedback",
    "forms": "focus/disabled/error/success coverage or 'not applicable'"
  },
  "alignmentEvidence": {
    "alignmentModeByRegion": ["header: baseline", "toolbar: center", "cards: left edge"],
    "checkedElements": ["buttons", "tags", "form controls", "card titles", "list rows", "nav items"],
    "orphanMicroRows": "none"
  },
  "headingCtaEvidence": {
    "headingPolicy": "all headings are short noun phrases; no sentence headings",
    "ctaPolicy": "CTA/button/tab/pill labels are short; long copy moved to body/subtitle",
    "longCopySplitExamples": []
  },
  "motionEvidence": "The most memorable business-relevant micro-interaction on this page",
  "generationNodeId": "gen-page-example",
  "htmlWriteMode": "SkeletonMainOnly | FullHtmlReplaceHead | DerivedCopyMutableOnly | SharedFragmentOnly",
  "headManagementEvidence": "Skeleton created by fill-html-head and only <main> was edited; or full HTML was written before --replace-head; or derived page copied base HTML",
  "childReadiness": {
    "applies": false,
    "plannedChildren": [],
    "readyForMainAgentDispatch": "not applicable"
  },
  "inheritedFragmentsUsed": ["partials/project-shell.html"],
  "privateRegionsGenerated": ["main content"],
  "sharedFragmentsPreserved": "Inherited shell preserved; only active nav slot and main content were filled",
  "sourceContextPreserved": "For comparison pages: shell/navigation/key content preserved and how the new state is layered; otherwise 'not applicable'",
  "blockedReason": null,
  "animationLibrariesUsed": []
}
```

Additional conditional fields:

- `libraryIconsUsed`: string[] — Library icon names used on this page via `<span data-icon>` (e.g., ["close", "settings"]). Empty array `[]` if no Library icons were used. REQUIRED when iconAssets is in dispatch; omit otherwise.
- `lucideFallbackIcons`: string[] — Lucide icon names used as fallback because no Library match existed (e.g., ["arrow-right", "external-link"]). Empty array `[]` if all icons came from Library. REQUIRED when iconAssets is in dispatch; omit otherwise.

`qualityGate: "passed"` is valid only when these evidence fields are non-empty and the page either follows the provided `compositionPattern` or reports a concrete business reason for deviation. `alignmentEvidence` and `headingCtaEvidence` are mandatory: if the page has alignment drift, orphan micro-rows, sentence headings, or long CTA/button/tab/pill labels, the gate cannot pass. `htmlWriteMode` and `headManagementEvidence` are mandatory; if a page used skeleton generation and then full-file Write, report `qualityGate: "failed"` and repair before completion. For Quick Path A0/A1 comparison pages, `sourceContextPreserved` must be non-empty and must name at least 3 preserved source elements (for example sidebar, search input, task list, background dim layer). If any third-party animation library is used, `animationLibrariesUsed` must list `{ "name": "...", "reason": "..." }` entries instead of `[]`.

For a `project-shell` or `shared-branch` parent node, `childReadiness.applies`
must be `true`, `plannedChildren` must list the direct child node IDs from
`generation-tree.json`, and `readyForMainAgentDispatch` must state whether this
parent output file is ready for the Main Agent to dispatch children. The parent
Sub-Agent must not dispatch those children itself. If later children remain
unfinished, the Main Agent must wait/poll for child completion before treating
the parent subtree as complete.

For redesign tasks, also return a compact `redesignEvidence` block:

```json
{
  "redesignEvidence": {
    "issuesFixed": ["card wall", "weak CTA hierarchy"],
    "contentPreserved": ["core copy", "navigation targets"],
    "domIdImpact": "unchanged"
  }
}
```

`domIdImpact` must be one of: `"unchanged"`, `"migrated"`, `"removed"`, or `"added"`. If any `data-dom-id` was removed or added, the Sub-Agent must report the exact IDs in the workflow-specific fields so the Main Agent can update `.design` interactions.

## Shared Rules

### Hard Rules (Single Source of Truth)

All [FORBIDDEN] constraints (Token fidelity, script usage, no-design-write, no-image-generation, no-validation-scripts, component conformance, style integrity self-check, completion report format, tool-call budget) are defined in **Phase 0 — `sub-agent-hard-rules.md`**. The compact page quality gate is defined in **Phase 0 — `page-generation-quality-gate.md`**. Any updates to these rules happen in their SSOT files only.

### Additional Context Rules (page-generation-specific)

- HTML `<head>` brand CSS introduction and base styles are auto-generated by the `fill-html-head.mjs` script for ordinary/base pages. For derived state pages, the `<head>` is inherited from the copied base HTML and must not be regenerated. Sub-Agent only needs to write content into `<main>` or the declared mutable region. Use brand prefix CSS variables for colors (e.g., `var(--{tokenName})`), and Tailwind utility classes for layout.
- **Node ID source**: `nodeId` is pre-assigned by the Main Agent in `page-{slug}` format. Sub-Agents must reuse the provided ID and must not invent, increment, or register page IDs.
- Image assets and path rules detailed in `html-implementation.md` "Image Rules" section. `critical-hero` images should be used when provided; `degraded` assets must be rendered through the approved CSS degradation pattern, not broken `<img>` tags.
- Cross-page style consistency: All pages must use the same brand CSS variable references for base background color, Header/Footer color scheme, text hierarchy, radius scale, spacing rhythm, component language, and surface/depth model. Choosing color schemes or shape systems outside the brand CSS / historical anchors for individual pages is [FORBIDDEN]. See `aesthetics/index.md §4 Color & Surface > Continuity` section for details.
- Design read and dials are execution hints, not authority sources. User instructions, reference material, Design Library, token fidelity, and validation gates always take priority.
- Historical style continuity anchors are project-level memory from actual landed files. Apply them in no-Library projects; update only the dimensions explicitly changed by the current user request. If the Task query did not include expanded anchor values, stop and ask the Main Agent for the missing anchor payload before writing HTML.
- Completion evidence: Completion JSON must include non-empty `designIntentEvidence`, `interactionStates`, `alignmentEvidence`, `headingCtaEvidence`, `motionEvidence`, `sourceContextPreserved`, and `animationLibrariesUsed`. `qualityGate: "passed"` is valid only when engineering gates pass and the page reports how it applied `visualNorthStar`, `compositionPattern`, `continuityAnchors`, interactive states, alignment modes, concise heading/CTA policy, reduced-motion behavior, source-page context for comparison pages, and any third-party animation library rationale.
- Responsive layout: Pages must be responsive, viewable properly on mobile, tablet, and desktop. Multi-column grids must have breakpoints (e.g., `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`); image-text side-by-side sections must auto-stack on mobile; fixed pixel widths are [FORBIDDEN]. See `html-implementation.md` "Responsive Layout (mandatory)".
- **Device-type-specific constraints**: Based on the "device type" field, the corresponding device-specific constraint file has already been appended in Phase 1 reading. It contains the highest-frequency layout violation protection rules for that device type — all must be followed.
- Page visual quality must pass `page-generation-quality-gate.md`. Read `aesthetics/self-check.md` for deeper checks when triggered by the gate, page content (brand/marketing Showcase home pages), or quality risks.

### Forbidden (page-generation-specific, not covered by sub-agent-hard-rules.md)

- **[Mobile]** [FORBIDDEN] Auxiliary blocks alongside main content area within mobile cards: Under default viewport (no breakpoint prefix `flex-row`), auxiliary info blocks (status pills, node markers, summary metrics, etc. — rounded blocks) must not be horizontally side-by-side with the main content area (title + body text) within cards. Auxiliary blocks must be placed on a separate row. Only under `md:` and higher breakpoint prefixes is `flex-row` permitted for side-by-side placement of auxiliary blocks with main content area. Full rules in `html-implementation-mobile.md` "Mobile Card Internal Two-column Layout Constraint".
- [FORBIDDEN] Using DOM placeholders instead of real images in the normal path: All positions requiring images on the page must use `<img src="../assets/xxx.jpg">` referencing real image files. If a section needs an image but no exact match exists in the resource table, prioritize reusing the semantically closest existing image. A non-image visual treatment is allowed only when the Main Agent explicitly passes `fallbackAllowed: true` for that section after image generation/extraction failure. See `html-implementation.md` "[FORBIDDEN] Using DOM Element Placeholders Instead of Real Images".
- [FORBIDDEN] Reporting `qualityGate: "passed"` without `designIntentEvidence.visualNorthStarApplied`, `designIntentEvidence.compositionPatternUsed`, `designIntentEvidence.continuityAnchorsApplied`, `designIntentEvidence.antiSlopCheck`, non-empty `interactionStates`, non-empty `alignmentEvidence`, non-empty `headingCtaEvidence`, non-empty `motionEvidence`, explicit `sourceContextPreserved` (`"not applicable"` only for non-comparison pages), and explicit `animationLibrariesUsed` (use `[]` when none).
- [FORBIDDEN] Starting any HTTP server (page preview is centrally decided by Main Agent; see `operation-policies/output-delivery.md` "Preview Method" section).

## Post-generation Crowding Self-check (mandatory)

> Defined in `operation-policies/page-density-strategy.md` "Post-generation Crowding Self-check" section — covers universal multi-column/grid checks (all pages) and density-specific layout checks (gated by `pageType`). Sub-Agent reads and executes the section matching its assigned `pageType` label.

---

## Sub-Agent Failure Fallback (Universal — Main Agent Reference)

> **Audience**: Main Agent reads this section when a dispatched Task sub-agent fails. Sub-Agents do not need to read this section.

If a Task sub-agent returns empty (`""`) or "Agent completed with no output", **or does not respond at all, or returns an invalid / incomplete completion JSON** (missing required evidence fields, malformed JSON, bare file paths instead of the JSON block) — all of these are treated as the same failure and follow the same retry → fallback/skip flow:

1. **Retry once**: Re-dispatch with identical differentiated parameters, plus an additional note at the top of the query:
   ```
   [RETRY — Previous dispatch returned empty] You MUST produce the HTML file and report the JSON completion block. Read Phase 0 + Phase 1 constraint files per page-generation-template.md Standard Mode.
   ```
2. **If retry also fails** → action depends on workflow context:

   | Workflow | Fallback Action |
   |----------|----------------|
   | `create-project` / `edit-project` (add pages) | Fall back to **in-context generation**: Main Agent reads the 4 constraint files (`sub-agent-hard-rules.md`, `page-generation-quality-gate.md`, `html-implementation.md`, `html-implementation-{device}.md`) directly and generates the page HTML itself |
   | `redesign-ui` | Skip that page's UI change; inform user which page failed; continue with remaining results. Original page remains unchanged in the copy |
   | `generate-variants` | Skip that variant; inform user which variant failed; continue with remaining variants. Reduce `--expected-pages` count accordingly in validation |
   | `edit-project` (modify existing) | Fall back to in-context generation for the failed page |

3. **[FORBIDDEN]** Silently proceeding without the failed page — must either retry, fallback-generate, or explicitly inform user of the failure and reduced output scope.

**[RATIONALE]** Sub-Agents are local Task tool dispatches with full file access. Retry fixes transient failures (context overflow, tool timeout). In-context fallback is the last resort for critical pages; skip-and-inform is acceptable for non-critical variants/drafts.
