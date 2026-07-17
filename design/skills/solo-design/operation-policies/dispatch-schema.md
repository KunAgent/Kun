# Sub-Agent Dispatch Field Schema (SSOT)

> **Single source of truth for Sub-Agent dispatch field schema. Read by the Main Agent when assembling any page-generation/page-editing dispatch. Sub-Agent execution rules remain in `workflows/page-generation-template.md`.**
>
> Workflows (`create-project.md`, `edit-project.md`, `generate-variants.md`, `redesign-ui.md`) list only **differentiated parameters** and reference this file for all shared field definitions. Do not re-copy these definitions into workflow files. The Library constraint block format below is the authoritative dispatch-side mirror of SKILL.md "Design Library Constraint Passing in Subtask Dispatch".

## Dispatch Assembly Checklist

Every page-generation/page-editing Task query must contain, in order:

1. `Task:` line describing the generation/edit target, and `Output:` file path(s)
2. The aesthetics-mode note selected per §1
3. `Shared template: {SKILL_DIR}/workflows/page-generation-template.md`
4. All applicable shared fields below, populated with **concrete values** (never bare references like "keep same style" or a summary path alone)
5. The workflow's differentiated parameters (page requirements, per-page tables, etc.)

**[FORBIDDEN]** Dispatching page generation via a generic task without this structure — a generic dispatch produces standalone HTML with custom CSS in `<head>`, which `fill-html-head.mjs` destroys and which breaks canvas rendering. If the Main Agent cannot construct the full dispatch (e.g., missing component plan), fall back to **in-context generation** rather than dispatching an unconstrained Sub-Agent.

## §1 Aesthetics Mode Selection (required in every dispatch)

The Main Agent MUST select the correct aesthetics note based on `operatingMode` / `replicationMode`:

| Mode | Note to include in Task query | Sub-Agent aesthetics read |
|------|-------------------------------|---------------------------|
| `replicationMode === "high-fidelity"` | `## Visual Spec Excerpt (from source site analysis — this IS the design authority):` + visualSpecExcerpt content | Does NOT read `aesthetics/index.md` |
| `operatingMode === "library-bound"` | `## Aesthetics: Read {SKILL_DIR}/aesthetics/index.md as FALLBACK guidance — Library specs take absolute precedence where they exist.` | Reads as gap-filler |
| `operatingMode === "free-explore"` (no Library) | `## Aesthetics: Read {SKILL_DIR}/aesthetics/index.md before generating — it is the binding visual spec.` | Reads as binding spec |

**[FORBIDDEN] in replication mode**: passing aesthetics or visual reference file paths for the Sub-Agent to read — `visualSpecExcerpt` replaces aesthetics guidance entirely and must be pre-injected inline. This does NOT apply to Phase 0/Phase 1 constraint files (hard-rules, quality-gate, html-implementation) — Sub-Agents read those directly in ALL modes. Also [FORBIDDEN]: instructing the Sub-Agent to "read xxx file first" for aesthetics/visual context.

## §2 Core Identity & Routing Fields

| Field | Applies to | Required when | Format / Example |
|-------|-----------|---------------|------------------|
| Node ID (`nodeId`) | All page-leaf tasks | Always | Pre-assigned `page-{slug}` (e.g., `page-pricing`); Sub-Agents never invent IDs |
| Page logical index (`pageIndex`) | create / add-page | Always | Integer starting from 1 |
| Device type | All | Always | `desktop` \| `mobile` \| `tablet` |
| Dashboard mode | All | When `project.dashboardMode === true` | Boolean; allows fixed-viewport dashboard layout |
| Project path | All | Always | `{designProjectPath}` absolute path |
| Orchestration summary path | All | When summary exists | `{designProjectPath}/orchestration-summary.json` |
| Current page record | All | When summary exists | Filtered `pages[]` entry for this `nodeId` (do not paste full summary) |
| Language | All | Always | Consistent with user input |
| Project business theme | All | Always | Industry/business keywords (e.g., "new energy vehicle brand"); core semantic anchor for image semantics |
| This page's business scenario | All | Always | Specific business function this page carries |
| Page requirements / Modification requirements | All | Always | User's description for this page or requested change |

## §3 Library Constraints Block (operatingMode: library-bound)

| Field | Required when | Format / Example |
|-------|---------------|------------------|
| Brand CSS path | Always | `{library-path}/colors_and_type.css` (with Library) or `{designProjectPath}/colors_and_type.css` (project-local) |
| Brand prefix | Always | e.g., `volcano` |
| Design decision summary | Always | Key parameters from Library SKILL.md Essentials, or constraints derived from brand CSS |
| Actual Token Name Reference | Always with Library | Table `Semantic Purpose \| Actual tokenName`; **[MUST] Sub-Agent may only use variable names from this list, guessing is [FORBIDDEN]**; usage format `var(--{tokenName})` |
| Font / radius / shadow reference | Always with Library | Library typography class names (e.g., `{prefix}-h1`, `{prefix}-body`) and tokenNames from the reference list per category |
| Layout reference | When UI Kit exists | `{library-path}/ui_kits/{type}/index.html` — **[Blocking when available]** Sub-Agent must read after planned component data, before generating |
| Component Plan | Always with Library | Table `Component \| Slug \| Why selected` with 3-6 Main-Agent-pre-selected slugs from `components/_evidence/index.json` + `uikit-plan.json` when present, otherwise `components/index.json`. Resolve per slug: `contractFile` (evidence libraries: `{library-path}/components/_evidence/{slug}.json`; non-evidence: `{library-path}/components/{slug}.json`), optional `previewFile`, optional `debugFile` (debug/refine only). Bounded supplement: Sub-Agent may read at most 2 extra resolved contracts, reported as `extraComponentsRead`. [FORBIDDEN] re-scanning the full Component Index per UI block; [FORBIDDEN] implementing a planned component from scratch when its contract exists |
| Token fidelity constraints | Always with Library | `[FORBIDDEN] Fabricating variable names not in css.json \| Hardcoded colors \| Tailwind semantic color classes \| Tailwind font-* classes \| Modifying brand CSS` (full rules: `sub-agent-hard-rules.md` §Token-Fidelity) |
| Forbidden invented components | When `uikit-plan.json` lists them | Slug list; [FORBIDDEN] inventing implementations; use Tailwind utilities instead |
| Allowed components | When whitelist exists | Slug whitelist; prefer when selecting extra components; report deviation in `extraComponentsRead` |
| Style constraints | When Library defines numeric boundaries | `radiusMax` px ([FORBIDDEN] exceeding), `spacingBase` px, `fontSizeBody`/`fontSizeMin` px, `controlHeightDefault`/`controlHeightLarge` px — override aesthetics rhythm rules where they conflict |
| Theme mode | Always | `light` \| `dark`; when dark, Library CSS `.dark` block provides palette |
| Product context | When known | `{kitType} — {productType}`; tone calibration for copy |
| Extra Library Constraints | Only when Library `specs/` was loaded | Distilled implementation-level constraints; priority equal to componentPlan constraints |

## §4 Free-Explore Policy Blocks (no Design Library)

Paste these policy blocks verbatim into the dispatch when `operatingMode === "free-explore"`:

| Field | Required when | Content |
|-------|---------------|---------|
| Free-explore color policy | Always in free-explore | "Use one brand primary hue only. Do not use or invent `secondary` / `accent` brand colors even if they appear in old project files; treat them as legacy drift to avoid. Extra hues are allowed only through `--state-success`, `--state-warning`, `--state-error`, and `--state-info`, and only for real semantic states. Identity/category/member-role styling must use text, icons, neutral tints, layout, or the primary tint." |
| Free-explore shadow policy | Always in free-explore | "Static cards/tables/lists/sections/buttons/panels must use border or surface layering first; any static shadow alpha must be `<= 0.05`. Shadow alpha above `0.05` is only for real floating layers such as modal/popover/dropdown/drawer/tooltip/toast/menu. Do not use colored shadows or glow shadows." |
| Style definition brief | Free-explore only | `{orchestration-summary.project.styleDefinitionBrief}`, or null when Library-bound / high-fidelity |
| Historical style continuity anchors | Free-explore continuation work | **Expanded** `orchestration-summary.project.styleContinuityAnchors` values for all available dimensions: `colorSystem`, `shapeSystem`, `typographySystem`, `spacingSystem`, `componentLanguage`, `surfaceAndDepth`, `imageryAndIconography`, `interactionTone`. Paste the expanded values directly into the Task query under a literal "Historical style continuity anchors" block; do not rely only on `orchestrationSummaryPath` or "keep same style" wording. Null when no history exists |
| Typography discipline | Free-explore multi-page | Project title/body font stacks from `styleContinuityAnchors.typographySystem` and `sharedProjectShellContract`; no per-page font experiments |

## §5 Project-Level Shared Context

| Field | Required when | Format / Example |
|-------|---------------|------------------|
| Design read | When available | `{orchestration-summary.project.designRead}` — `{pageKind} / {audience} / {businessTone} / {density} / {visualRiskToAvoid}`; internal, not user-facing |
| Design dials | When available | `{orchestration-summary.project.designDials}` — 1-5 `layoutVariance` / `motionIntensity` / `visualDensity`. Motion mapping: `1` basic hover/focus only; `2-3` default refined button/card/nav feedback plus light first-screen entrance; `4-5` showcase/brand pages may add scroll reveal, count-up, subtle parallax, or particle/canvas atmosphere when justified. Third-party libraries must follow html-implementation.md "Animation Library Exception" |
| Shared project shell contract | Multi-page projects (binding) | `{orchestration-summary.project.sharedProjectShellContract}`, or null for single-page projects. Preserve shared nav/header/sidebar/footer treatment, single primary color system, type stack/scale, radius scale, surface/depth model, CTA style, and alignment rhythm. Sub-Agent must not invent a different navigation, primary CTA color, card radius, shadow model, or font stack for its own page |
| Visual north star | create / add-page (required) | Current page's `visualNorthStar` sentence |
| Composition pattern | Required for showcase / brand / landing pages | Current page's `compositionPattern` from `aesthetics/index.md §2.1` or `§11` |
| Continuity anchors | Multi-page projects (≥ 2 shared anchors) | Current page's `continuityAnchors` list |

### P0 Alignment checklist (paste inline, mandatory in every page-generation dispatch)

- Every visual row/toolbar/form row/card row/list item must choose one alignment mode: left edge, right edge, center line, or baseline.
- Buttons, tags, form controls, card titles, list rows, table/toolbars, nav items, and mixed icon+text groups must not drift inside the same visual group.
- Do not position a small element with arbitrary padding/margin. If one small element occupies a row, deliberately align it left/center/right to the grid or complete the row with related content.

### P0 Heading / CTA checklist (paste inline, mandatory in every page-generation dispatch)

- Headings must be short words/phrases, not sentences. Chinese headings at `text-xl` or larger should be <= 8 CJK chars; longer copy becomes body/subtitle.
- CTA/button/tab/pill labels must be short. Chinese CTA preferably 2-6 chars; English CTA preferably 1-3 words.
- [FORBIDDEN] Putting a long requirement phrase, full sentence, comma-heavy sentence, or explanatory copy into a heading, button, pill, tab, or primary CTA. Split into short heading + body + short action label.

## §6 Generation Tree Contract

Required when `orchestration-summary.project.generationTree` exists; null only for true single-page work. For leaf page tasks, pass only the current node plus ancestors:

```json
{
  "generationTreePath": "{designProjectPath}/generation-tree.json",
  "generationNodeId": "gen-page-order-chart",
  "generationPath": ["gen-project-shell", "gen-order-detail-common", "gen-page-order-chart"],
  "inheritedFragments": ["partials/project-shell.html", "partials/order-detail-common.html"],
  "privateRegions": ["tab panel: order data charts"],
  "mutableSlots": ["activeTab", "pageTitle"]
}
```

| Field | Meaning |
|-------|---------|
| `generationTreePath` | Materialized dispatch SSOT file |
| `generationNodeId` | Current generation tree node ID |
| `generationPath` | Ordered node IDs from root to this task |
| `inheritedFragments` | Ordered fragment paths from ancestor nodes |
| `privateRegions` | Regions this task may generate |
| `mutableSlots` | Allowed page-specific slots inside inherited fragments (e.g., active nav item, selected tab, page title, breadcrumb) |

Leaf Sub-Agents read inherited fragments in order, assemble them unchanged except declared `mutableSlots`, and generate only `privateRegions`. Shared-node Sub-Agents output only the declared fragment under `partials/`, not a full page. Full Sub-Agent consumption rules: `page-generation-template.md` "Shared Input Data".

## §7 State Group Contract

Required when the page belongs to Interaction-State Expansion; otherwise omit:

```json
{
  "stateGroupId": "order-detail-tabs",
  "stateRole": "base | derived",
  "baseStatePageId": "page-order-info",
  "sharedShellContract": ["root frame", "outer <main> style", "topbar/sidebar", "order summary header", "tab bar geometry", "tab-panel wrapper", "spacing scale", "type scale", "radius/shadow model"],
  "mutableRegions": ["active tab styling", "tab panel content", "chart/table content"],
  "immutableShellRegions": ["body/main frame", "outer <main> padding/background", "global nav", "summary cards", "tab/control bar", "tab-panel container", "primary actions"],
  "derivedFromHtmlSrc": "pages/order-info.html"
}
```

Assembly rules:

- `derivedFromHtmlSrc` is required for every `stateRole: "derived"` page; never leave it null for derived tab/modal/loading/overlay states.
- The Task query for a derived page must **not** include any "Generate HTML skeleton" instruction or any `fill-html-head.mjs` command. Its first executable step is the poll-and-copy protocol defined once in `page-generation-template.md` Pre-step "Derived state pages".
- Completion JSON for derived pages must set `stateGroupId` and name at least 7 preserved shell regions in `sharedShellPreserved`.

## §8 Comparison / Source-Page Context (Quick Path A0/A1)

Required for comparison pages derived from an existing page; otherwise omit:

| Field | Format |
|-------|--------|
| Source page identity | Source page title / nodeId / htmlSrc |
| Source HTML | Excerpt or full HTML path |
| Source-page continuity requirements | "Preserve the visible shell, navigation/sidebar/header, key content regions, background treatment, spacing rhythm, typography hierarchy, radius/shadow model, and component language unless the user explicitly asked to change that dimension." |
| Immutability sentence | "The source page is immutable; implement requested changes only in the new comparison page." |

## §9 Reference Material / Replication Fields

| Field | Required when | Format |
|-------|---------------|--------|
| Reference Material Context | Materials (screenshot/URL/ZIP/HTML/PDF) were provided | Sources, intent, visual constraints, layout patterns to preserve, content to preserve, source asset inventory filtered to this page |
| Replication Directive | ONLY when `replicationMode === "high-fidelity"` | Paste verbatim: "This is a HIGH-FIDELITY REPLICATION. You must: 1. Match the reference layout grid, section order, and proportions exactly 2. Use the exact color values from Visual Spec Excerpt below (not approximate) 3. Preserve all visible text from 'Content to Preserve' verbatim — do not fabricate alternative copy 4. Match font sizes, weights, and spacing rhythm from the spec 5. Creative deviation is FORBIDDEN unless technically impossible to replicate. Quality criterion: a viewer cannot distinguish your output from the original at a glance." |
| Visual Spec Excerpt | ONLY when high-fidelity | ≤ 2000 chars from `orchestration-summary.project.visualSpecExcerpt` containing exact colors, spacing, typography, layout skeleton, and effects; must cover the FULL page, not just above-the-fold |
| Long Requirement Context | When long requirement parsing was triggered | Page-specific requirement IDs, must-have content/features, optional/deferred items, acceptance notes |
| Redesign audit snapshot | redesign-ui flow only | `{redesignAudit}` with `primaryIssue`, `fixPriority`, `preserve`, `change`, `risk` |

## §10 Wiring & Interaction Tables

**Visible wiring mapping table** (business flow arrows drawn on canvas; omit when empty):

| Navigation link on this page | Target page | domId |
|------------------------------|-------------|-------|
| "Learn More" button | About Us | cta-about |

**Hidden interaction table** (clickable in Preview, no canvas edge; Main Agent registers `hideEdge: true`; omit when empty):

| Navigation link on this page | Target page | domId | Reason |
|------------------------------|-------------|-------|--------|
| "Back" button | Homepage | back-home | return |
| "Modal backdrop" | Source page | modal-backdrop-close | close overlay |
| "Close modal" | Source page | close-modal | close overlay |

Hidden entries include Back / return controls, global nav, breadcrumbs, secondary CTAs, skip links, overlay backdrops/scrims, and floating-layer close/cancel/back controls. Sub-Agents must add `data-dom-id` to every entry in both tables. Full topology rules: `operation-policies/wiring-strategy.md`.

## §11 Available Image Resources Table

**Filtered to this page only** — include only images whose owning page matches this Sub-Agent's page, plus shared/multi-page assets. Sub-Agents are [FORBIDDEN] from calling image generation tools; all images must come from this table with path `../assets/{filename}`. If a section genuinely needs an image but no suitable one exists, reuse the semantically closest image from the table.

| Filename | Role | Status | Semantic description | Suggested section |
|----------|------|--------|---------------------|-------------------|
| hero-main.jpg | critical-hero | generated | {description} | Hero main visual |
| brand-shared.jpg | shared-brand | reused | {description} | Feature support |

## §12 Universal Dispatch Prohibitions (assembly-time)

- [FORBIDDEN] Dispatching a shared fragment task and any child page/branch task in the same tool-call batch. Parent completion / subtree wait gates: see SKILL.md §Architecture.
- [FORBIDDEN] Asking or allowing a Sub-Agent to dispatch its own child Sub-Agent; the Main Agent is the only dispatcher.
- [IMPORTANT] [FORBIDDEN] for Sub-Agents to write or modify the `.design` file. Page nodes are pre-registered; `.design` is exclusively managed by the Main Agent.
- Head write mode (`SkeletonMainOnly` / `FullHtmlReplaceHead`), derived-state copy protocol, and `fill-html-head.mjs` CLI usage are Sub-Agent execution rules defined in `page-generation-template.md` Pre-step — do not restate them in dispatches beyond the mode-relevant reminder.
