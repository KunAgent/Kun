# Orchestration Summary — Runtime Context Contract

> **Audience**: Main Agent writes this file. Page Sub-Agents consume only the current page slice plus required shared paths. This file reduces repeated long-context dispatch and keeps quality decisions centralized.

---

## When to Create or Update

| Scenario | Required Action |
| --- | --- |
| Create new project | Create `{designProjectPath}/orchestration-summary.json` after canvas entry initialization and before image pre-generation |
| Add new pages | Create or update `{designProjectPath}/orchestration-summary.json` after pre-registering new page skeletons |
| Multi-page edit/redesign/variants | Update only affected page records before dispatching page Sub-Agents |
| Single-page edit | Optional, but recommended when Design Library or image/component plans are involved |

The summary is an execution cache. It is not registered in `.design`, not shown to users, and not treated as a final design artifact.

---

## Required Schema

```json
{
  "project": {
    "name": "string",
    "path": "/absolute/design/project/path",
    "operation": "create | edit | redesign | variants",
    "deviceType": "desktop | mobile | tablet | freeSize",
    "language": "zh-CN | en | other",
    "dashboardMode": false,
    "replicationMode": null,
    "sourceUrl": null,
    "visualSpecExcerpt": null,
    "styleDefinitionBrief": null,
    "designRead": null,
    "designDials": {
      "layoutVariance": 3,
      "motionIntensity": 2,
      "visualDensity": 3
    },
    "styleContinuityAnchors": {
      "colorSystem": {
        "primaryColorRole": "single brand hue used for primary CTA and primary selected states",
        "brandHuePolicy": "free-explore uses no secondary/accent brand hue; identities/categories use neutral or primary tints",
        "stateColors": "optional semantic success/warning/error/info tokens only"
      },
      "shapeSystem": null,
      "typographySystem": null,
      "spacingSystem": null,
      "componentLanguage": null,
      "surfaceAndDepth": null,
      "imageryAndIconography": null,
      "interactionTone": null
    },
    "specsConstraints": "string | null — Distilled content from Library specs/ directory. HIGHEST PRIORITY design authority; overrides all other Library files when present.",
    "sharedProjectShellContract": {
      "navigationShell": "shared header/top nav/sidebar/footer structure and active-state treatment",
      "primaryColorSystem": "single primary brand hue; no secondary/accent brand hue in free-explore",
      "typographySystem": "shared font stack, type scale, weight scale, CJK/Latin rules",
      "radiusScale": "shared radius tiers and max radius for cards/buttons/inputs",
      "surfaceDepthModel": "shared card border/shadow/surface layering rules",
      "ctaStyle": "shared primary/secondary CTA shape, size, icon, and hover language",
      "alignmentRules": "shared grid, control alignment, spacing, and toolbar rhythm"
    },
    "generationTree": {
      "root": {
        "nodeId": "gen-project-shell",
        "kind": "project-shell",
        "pageIds": ["page-a", "page-b", "page-c"],
        "output": "partials/project-shell.html",
        "sharedRegions": ["header", "sidebar"],
        "privateRegions": [],
        "mutableSlots": ["activeNavItem", "pageTitle"],
        "status": "planned | generated",
        "children": [
          {
            "nodeId": "gen-page-a",
            "kind": "page-leaf",
            "pageIds": ["page-a"],
            "output": "pages/a.html",
            "sharedRegions": [],
            "privateRegions": ["page A body"],
            "mutableSlots": ["activeNavItem", "pageTitle"],
            "status": "planned | generated",
            "children": []
          }
        ]
      }
    }
  },
  "designSource": {
    "operatingMode": "library-bound | free-explore",
    "libraryIdentity": {
      "name": "Library display name or null",
      "id": "Library id or null",
      "version": "selected/current version as string/number or null",
      "scope": "workspace | custom-global | built-in-global | other | null",
      "path": "/absolute/library/path or null",
      "versionSource": "selected-context | metadata.json | library-consumption.json | package.json | api | null"
    },
    "libraryPath": "/absolute/library/path or undefined",
    "cssFilePath": "/absolute/path/to/colors_and_type.css",
    "brandPrefix": "string",
    "themeMode": "light | dark",
    "designDecisionSummary": "short text",
    "componentContractKind": "evidence | legacy-json | compact-json | undefined",
    "forbiddenInventedComponents": ["layout", "space"],
    "allowedComponents": ["input", "button", "table", "form", "..."],
    "styleConstraints": {
      "radiusMax": 8,
      "spacingBase": 1,
      "fontSizeBody": 13,
      "fontSizeMin": 10,
      "controlHeightDefault": 32,
      "controlHeightLarge": 38
    },
    "productContext": {
      "kitType": "enterprise-ai-design-system",
      "productType": "B2B cloud / AI operations platform"
    },
    "actualTokenNameReference": [
      {
        "semanticPurpose": "Primary background",
        "tokenName": "brand-background"
      }
    ]
  },
  "pages": [
    {
      "nodeId": "page-index",
      "slug": "index",
      "title": "Home",
      "htmlSrc": "pages/index.html",
      "pageIndex": 1,
      "stateGroupId": null,
      "stateRole": null,
      "baseStatePageId": null,
      "sharedShellContract": [],
      "mutableRegions": [],
      "derivedFromHtmlSrc": null,
      "derivationType": "original | comparison-from-source | variant | redesigned-copy",
      "sourcePageId": null,
      "sourceHtmlSrc": null,
      "pageType": "showcase | information-dense | task-driven",
      "businessScenario": "short text",
      "visualNorthStar": "short page-level visual intent",
      "compositionPattern": "Aesthetics §2.1 rhythm pattern or §11 Showcase pattern",
      "continuityAnchors": ["header treatment", "CTA style"],
      "libraryRestraintMode": false,
      "uiKitPath": "/absolute/library/ui_kits/type/index.html or undefined",
      "componentPlan": ["button", "card", "navigation"],
      "imagePlan": ["hero-main.jpg"],
      "chartsRequired": false,
      "miniProgramStyle": false,
      "qualityRisks": ["long CJK title", "dense first screen"]
    }
  ],
  "assets": [
    {
      "filename": "hero-main.jpg",
      "role": "critical-hero | shared-brand | supporting-content | decorative",
      "owningPage": "index | shared",
      "semanticDescription": "short text",
      "status": "planned | generated | reused | degraded"
    }
  ],
  "wiringPlan": [
    {
      "sourceNodeId": "page-index",
      "domId": "cta-pricing",
      "targetPageId": "page-pricing"
    }
  ],
  "hiddenInteractionPlan": [
    {
      "sourceNodeId": "page-index",
      "domId": "shortcut-blog",
      "targetPageId": "page-blog",
      "hideEdge": true,
      "reason": "secondary shortcut"
    }
  ]
}
```

### Project Field Notes

| Field | Type / Default | Notes |
| --- | --- | --- |
| `name` | `string` | Project display name in the user's most frequently used language (see `user-facing-language.md` "Artifact Naming Language Rule"). E.g., Chinese user → `"咖啡品牌官网"`; English user → `"Coffee Brand Website"`. Must NOT be fixed to English. |
| `dashboardMode` | `boolean`; default `false` | Set to `true` only for large-screen dashboard / data screen / monitor scenarios. When true, pages may use fixed viewport layout; default `chartsRequired` should be true unless a page explicitly has no charts. |
| `replicationMode` | `"standard"` \| `"high-fidelity"` \| `null`; default `null` | Set to `"high-fidelity"` only when user intent is replication/clone; triggers enhanced extraction and quality gates |
| `sourceUrl` | `string` \| `null` | Target URL being replicated; stored for traceability |
| `visualSpecExcerpt` | `string` \| `null`; max 2000 chars | Required when `replicationMode === "high-fidelity"`; must cover the full page including below-fold sections and replaces aesthetics reading as visual guidance |
| `styleDefinitionBrief` | `string` \| `null`; max 200 chars | Creative direction summary from Style Discovery. In free-explore mode, this is the global visual north star shared by all pages; null when Library-bound or high-fidelity mode |
| `designRead` | `string` \| `null`; max 160 chars | Compact internal design interpretation from `creative-direction.md` (`pageKind / audience / tone / density / visual risk`). Passed to Sub-Agents; not user-facing output |
| `designDials` | `object`; defaults `{ layoutVariance: 3, motionIntensity: 2, visualDensity: 3 }` | 1-5 execution dials derived from scenario. They tune layout, motion, and density only where Library / reference / user input is silent |
| `styleContinuityAnchors` | `object` \| `null` | Project-level historical style memory used when no user-selected Design Library exists. Contains stable color, shape, typography, spacing, component, depth, imagery, and interaction rules extracted from actual project files. `colorSystem` must explicitly record `primaryColorRole`, `brandHuePolicy`, and optional `stateColors`; do not record `secondary` or `accent` brand hues in free-explore. User query overrides only explicitly mentioned dimensions. |
| `sharedProjectShellContract` | `object` \| `null` | Project-level multi-page consistency contract. Required for new multi-page projects and add-page flows. It captures shared navigation/header/sidebar/footer, primary color, font stack/type scale, radius scale, surface/depth model, CTA style, and alignment rhythm. It applies across ordinary pages; `stateGroupId.sharedShellContract` remains the stricter same-screen-state contract. |
| `generationTree` | `object` \| `null` | Required before HTML generation for any run producing 2+ pages or 2+ state variants. Main Agent classifies shared vs private regions, then records a nested dependency tree using `root.children[]`, not a flat top-level `nodes[]` array. This object must mirror `{designProjectPath}/generation-tree.json`; the standalone file is the dispatch SSOT. Shared nodes output reusable fragments under `partials/`; leaves output `pages/*.html`. Children may run only after parent fragments exist. |

### Page Visual Field Notes

| Field | Type / Default | Notes |
| --- | --- | --- |
| `visualNorthStar` | `string`; required for create/add-page flows | One sentence describing what the page must feel like visually and what first impression it should create. Keep it concrete and business-specific. |
| `compositionPattern` | `string`; required for `showcase`, recommended for all pages | Pick one rhythm pattern from `aesthetics/index.md §2.1` or one Showcase pattern from `§11 Showcase Pattern Atlas`. Do not use generic "Hero + cards" as a pattern name. |
| `continuityAnchors` | `string[]`; default `[]` | 2-4 cross-page visual anchors, such as header treatment, CTA style, surface layering, type rhythm, radius/shadow discipline. Multi-page projects should share at least 2 anchors across pages. |
| `stateGroupId` | `string \| null`; default `null` | Required for pages created by Interaction-State Expansion, such as tabs, search results, modal-open, loading/empty/error, or other visual states of one source screen. All state pages for the same screen share this ID. |
| `stateRole` | `"base" \| "derived" \| null`; default `null` | For state groups, exactly one page is the base/default state. Sibling states are derived from the base HTML and may only change declared mutable regions. |
| `baseStatePageId` | `string \| null`; default `null` | For derived state pages, the base page node ID to copy from before applying state-only edits. |
| `sharedShellContract` | `string[]`; default `[]` | Immutable shell regions shared by every page in a state group: body/root frame, outer `<main>` style/class, content wrapper/max-width, header/sidebar/nav, identity/summary region, controls/tab bar geometry, tab/control-to-panel seam, panel wrapper padding/background/border, spacing/type/radius/shadow model, background, and component language. |
| `mutableRegions` | `string[]`; default `[]` | Regions that may differ between state pages: active control styling, tab/state panel body content, overlay/drawer/modal layer, selected row/card, chart/table content, validation/feedback, loading/empty/error/success content. Do not include outer `<main>` padding/background or shared panel wrapper unless the user explicitly asked to change the frame itself. |
| `derivedFromHtmlSrc` | `string \| null`; default `null` | Required when `stateRole === "derived"`. The base/source HTML path to poll and copy before applying mutable edits. Usually equals the base state page's `htmlSrc`; never leave it null for derived tab/modal/loading/overlay states. |
| `derivationType` | `string`; default `"original"` | For Quick Path A0/A1 comparison pages, set to `"comparison-from-source"` so future turns know the page is derived from an immutable source page. |
| `sourcePageId` | `string \| null`; default `null` | For comparison pages, the source page node ID. Used to preserve context and organize canvas comparison rows. |
| `sourceHtmlSrc` | `string \| null`; default `null` | For comparison pages, the source page HTML path. Sub-Agents use this as source context; never overwrite it unless the user explicitly asks for in-place editing. |
| `generationNodeId` | `string \| null`; default `null` | The nested generation tree node ID that owns this leaf page. Required when `project.generationTree` exists. |
| `generationPath` | `string[]`; default `[]` | Ordered ancestor node IDs from root to this leaf. Sub-Agent must read/apply every ancestor fragment before creating the leaf page. |
| `inheritedFragments` | `string[]`; default `[]` | Ordered fragment paths produced by ancestor `project-shell` / `shared-branch` nodes. Leaf pages assemble these unchanged except declared `mutableSlots`. |
| `privateRegions` | `string[]`; default `[]` | Page-specific regions the leaf Sub-Agent is allowed to generate. Shared regions not listed here must not be regenerated or restyled. |
| `mutableSlots` | `string[]`; default `[]` | Slots inside inherited fragments that leaves may fill. For shared headers/sidebars/tab bars, use `activeNavItem` / `activeTab` slots and stable `data-nav-key` / `data-tab-key` attributes; leaf pages change only the slot value, never the shared nav/tab DOM. |

---

## Main Agent Responsibilities

1. Write the summary after page skeleton IDs, CSS source, token references, page types, and component/image plans are known.
   - In Library-bound mode, also write `designSource.libraryIdentity` and mirror the same object into `.design.config.designLibrary` before dispatching any Sub-Agent. Preserve it on edit/add-page/redesign unless the user explicitly switches Library.
   - `libraryIdentity` must include `name`, `id`, `version`, `scope`, `path`, and `versionSource`; use `null` for unknown fields instead of omitting them.
2. Keep `actualTokenNameReference` concise: include only semantic tokens Sub-Agents are expected to use, not every raw color scale.
3. Build each page's `componentPlan` from `components/_evidence/index.json` + `uikit-plan.json` when present; otherwise use `components/index.json`, selecting the 3-6 most relevant slugs for the page. Each entry must include resolved `contractKind` and `contractFile`; include `previewFile` whenever `preview/component-{slug}.html` exists (no dependency on `library-consumption.json.previewFiles` — file existence is the sole gate); include `debugFile` only for debug/refine traceability.
4. Build each page's `imagePlan` from the image necessity rules in `create-project.md` / `edit-project.md`.
5. Fill `project.designRead` and `project.designDials` before dispatch when the operation involves create, variants, or redesign direction decisions.
6. Fill or update `project.styleContinuityAnchors` before dispatch whenever no user-selected Design Library exists and project history is available. Derive it from actual `.design`, `pages/*.html`, `colors_and_type.css`, and the previous summary; never record unlanded exploration ideas.
7. Fill each page's `visualNorthStar`, `compositionPattern`, and `continuityAnchors` before dispatch. These fields are the compact aesthetic execution brief for Sub-Agents.
8. For Interaction-State Expansion, fill `stateGroupId`, `stateRole`, `baseStatePageId`, `sharedShellContract`, `mutableRegions`, and `derivedFromHtmlSrc` before dispatch. Derived state pages must point to the base state, set `derivedFromHtmlSrc` to the base state's HTML path, poll/copy that file before editing, and must not be treated as independent full-page design tasks. For tab/switcher states, `sharedShellContract` must include the outer `<main>` frame, content wrapper, tab/control bar, and tab-panel wrapper; the derived page may only switch active control styling and replace declared panel body content.
9. For multi-page projects, fill `project.sharedProjectShellContract` before dispatch. It is binding for all ordinary pages and must include navigation/header/sidebar/footer treatment, primary color system, type scale/font stack, radius scale, surface/depth model, CTA style, and alignment rhythm.
10. Before dispatching any HTML generation for multi-page or multi-state work, fill `project.generationTree` and write the same object to `{designProjectPath}/generation-tree.json`. Generate shared `project-shell` and `shared-branch` fragments first, then dispatch leaf pages only after every ancestor fragment is complete. If two pages share a header/sidebar/body scaffold and differ only in a tab/modal/list state, that shared body must be a parent node, not duplicated by independent leaf tasks.
11. Enforce generation-tree readiness by actual Sub-Agent completion and files, not by planned paths. Only the Main Agent may dispatch generation-tree nodes; Sub-Agents must not dispatch child Sub-Agents. A child node is dispatchable only when every ancestor Sub-Agent has returned completion, every ancestor node has `status: "generated"` in `generation-tree.json`, and every ancestor `output` file exists and is non-empty. Parent and child nodes must not be dispatched in the same Task batch. After each node completes, update `generation-tree.json` status before dispatching descendants.
12. Enforce parent subtree completion before consolidation, validation, and final summary. A parent/shared node with `status: "generated"` only means its own fragment is ready. Recursively inspect every child/descendant; if any child is `planned`, `running`, missing completion JSON, or missing a non-empty output file, wait/poll and retry before proceeding. If retries are exhausted, set the parent/subtree to `blocked`, record the missing child node IDs, and do not mark the design complete.
13. For every page leaf, fill `generationNodeId`, `generationPath`, `inheritedFragments`, and `privateRegions`. Use `mutableSlots` on parent nodes for allowed differences inside shared fragments, such as active nav item, selected tab, page title, or breadcrumb label. For shared headers/sidebars/tab bars, parent nodes must expose stable `data-nav-key` / `data-tab-key` attributes and a single active style; leaves fill only `activeNavItem` / `activeTab` slots to set `data-active="true"` for the current key.
14. Update `project.styleContinuityAnchors` after Sub-Agent completion using only rules actually implemented. When multiple pages were generated, keep shared rules and avoid letting a single anomalous page pollute the project anchor.
15. Update `assets[].status` after image generation or degradation completes.
16. Pass `orchestrationSummaryPath` and the current page's filtered record to each Page Sub-Agent.
17. In free-explore/no-Library mode, do not rely on the path alone for style continuity. Every Page Sub-Agent Task query must also include an expanded "Historical style continuity anchors" block copied from `project.styleContinuityAnchors`; this makes color, radius, typography, spacing, component language, depth, imagery, and interaction tone visible in the immediate task.

---

## Sub-Agent Consumption Rules

| Data | Use |
| --- | --- |
| `project.specsConstraints` | **HIGHEST PRIORITY** — Design constraints extracted from the Library `specs/` directory. When present, these override all other design references (preview HTML, component contracts, UI Kit, SKILL.md). Sub-Agent MUST read and apply these before consulting any other source. |
| `designSource.libraryIdentity` | Traceability for the active Design Library (`name`, `id`, `version`, `scope`, `path`, `versionSource`). Sub-Agent does not use it for styling decisions, but completion reports should not contradict it. |
| `designSource.cssFilePath` | Argument 1 for `fill-html-head.mjs` |
| `designSource.brandPrefix` | Prefix for typography classes and variable names; always provided by Design Library |
| `designSource.actualTokenNameReference` | Only allowed CSS variable source |
| `pages[].componentPlan` | Resolved component entries: `{ slug, contractKind, previewFile?, contractFile, debugFile? }`. Read `previewFile` **first** as primary implementation reference (DOM structure, CSS variable usage, spacing); then read `contractFile` as semantic supplement (variants, states, unknowns). When no `previewFile` exists, `contractFile` is the sole source. |
| `pages[].imagePlan` + `assets[]` | Only image files allowed for this page, plus shared assets |
| `project.designRead` | Short scenario/audience/tone/density/risk brief; use it to avoid generic defaults while staying inside the Library or reference authority |
| `project.designDials` | 1-5 layout / motion / density tuning. Use only as secondary guidance; never override Library specs, density rules, or performance constraints |
| `project.styleContinuityAnchors` | Project-level visual memory. In free-explore / no-Library mode, apply these as binding constraints for color, shape, typography, spacing, component language, surface depth, imagery, and interaction tone unless the current user query explicitly overrides a specific dimension |
| `project.sharedProjectShellContract` | Multi-page consistency contract. Preserve shared nav/header/sidebar/footer, primary CTA color, font stack/type scale, radius scale, surface/depth model, CTA style, and alignment rhythm across all pages. Sub-Agent must not redesign these per page. |
| `project.generationTree` + `{designProjectPath}/generation-tree.json` | Nested tree-shaped generation dependency plan. The standalone JSON file is the dispatch SSOT and must use `root.children[]`, not top-level `nodes[]`. It must include all shared nodes and all leaf pages before any Task starts. Shared nodes generate reusable fragments under `partials/`; page/state leaves assemble inherited fragments and generate only declared private regions. Sub-Agent must not treat sibling pages as independent standalone designs when they share an ancestor node. |
| `pages[].visualNorthStar` | Organize the first screen and main hierarchy around this page-level design intent |
| `pages[].compositionPattern` | Binding composition/rhythm choice; Sub-Agent must not degrade it into a default card wall |
| `pages[].continuityAnchors` | Cross-page anchors that must appear in the page and completion report |
| `pages[].stateGroupId`, `stateRole`, `baseStatePageId`, `sharedShellContract`, `mutableRegions` | Binding contract for Interaction-State Expansion. Base pages define the canonical shell. Derived pages copy from the base HTML and may only alter declared mutable regions; report preserved shell regions in `sharedShellPreserved`. |
| `pages[].generationNodeId`, `generationPath`, `inheritedFragments`, `privateRegions` | Binding leaf generation contract. Read ancestor fragments in order, preserve them unchanged except declared parent `mutableSlots`, then generate only `privateRegions`. Completion report must include the fragments used and regions generated. |
| `pages[].chartsRequired` | When true, call `fill-html-head.mjs` with `--charts` and allow Chart.js usage for that page |
| `pages[].qualityRisks` | Quality gate emphasis before completion |
| `pages[].miniProgramStyle` | When true, render a real mini program navigation bar with a visible right system capsule containing more and close actions. Do not render an empty placeholder. |
| `wiringPlan` filtered by `sourceNodeId` | Visible wiring `data-dom-id` attributes to place in HTML; these become drawn canvas edges |
| `hiddenInteractionPlan` filtered by `sourceNodeId` | Hidden `data-dom-id` attributes to place in HTML; these become `interactions` with `hideEdge: true` and do not draw canvas edges. Include overlay backdrops/scrims and floating-layer close/cancel/back controls that return to the source/base page. |
| `designSource.themeMode` | When "dark", Library dark palette is active; read aesthetics/dark-mode.md only for gap-fill |
| `designSource.componentContractKind` | Pre-determined contract resolution strategy; skip per-file detection when set |
| `designSource.forbiddenInventedComponents` | Components Sub-Agent must NOT implement from scratch when not in componentPlan |
| `designSource.allowedComponents` | Whitelist; Sub-Agent should prefer these slugs when selecting extra components |
| `designSource.styleConstraints` | Hard numeric boundaries for radius, spacing, font-size, control-height; override aesthetics rhythm rules |
| `designSource.productContext` | kitType/productType for tone calibration in copy and layout decisions |
| `pages[].componentPlan[].previewFile` | **Primary implementation reference** — read FIRST before contractFile. Match DOM patterns, CSS variable usage, and spacing. No per-page limit on preview reads. |

Sub-Agents must not read the full summary repeatedly. Read once, extract the current page slice, then proceed.

### Missing Data Fallback

| Missing Field | Fallback Behavior |
|---------------|-------------------|
| `orchestration-summary.json` file does not exist | Use Task query's inline input data directly (Main Agent should have passed all required fields in differentiated parameters) |
| Library-bound mode has no `designSource.libraryIdentity` or `.design.config.designLibrary` | Main Agent must repair both before dispatch/validation. If version cannot be found from selected context, metadata files, or API response, set `version: null` and `versionSource: null`. |
| `designSource.libraryIdentity` and `.design.config.designLibrary` disagree | Main Agent must reconcile them from the active Library context before dispatch; do not let Sub-Agents choose a Library identity. |
| Multi-page/state work has no `generation-tree.json` | Block dispatch, write the complete tree file, mirror it into `orchestration-summary.json.project.generationTree`, then resume |
| `generation-tree.json` uses a top-level `nodes[]` array | Treat as invalid planning. Rewrite it as a nested `root.children[]` tree before dispatch |
| `generation-tree.json` contains only root shell and no leaf nodes | Treat as incomplete planning. Add all shared branches and page/state leaves before dispatching any page Task |
| Current page `nodeId` not found in `pages[]` | Use Task query's inline input data; report `"orchestrationSummaryMismatch": true` in completion JSON |
| `componentPlan` is empty array | Implement freely following brand CSS constraints; no component JSON reads needed |
| `imagePlan` is empty array | No images for this page; use CSS patterns for visual interest where imagery would normally appear |
| `visualNorthStar` or `compositionPattern` is missing | Use Task query's inline visual brief if provided. For showcase pages, report `"visualPlanMissing": true` and choose a concrete pattern from `aesthetics/index.md` before writing; do not default to a generic card wall. |
| `designRead` is missing | Infer from `styleDefinitionBrief`, Library summary, reference material, or page business scenario; do not ask the user solely to fill this internal field |
| `designDials` is missing | Use `{ "layoutVariance": 3, "motionIntensity": 2, "visualDensity": 3 }`, then lower motion to 1 for compliance / dashboard pages |
| `styleContinuityAnchors` is missing in an existing no-Library project | Extract anchors from `colors_and_type.css`, existing `pages/*.html`, and `.design` before dispatch. If no stable rule can be extracted, proceed to the default style confirmation path rather than inventing silently |
| Sub-Agent Task query only says "keep same style" or only passes `orchestrationSummaryPath` | Before dispatch, paste the expanded `project.styleContinuityAnchors` values directly into the Task query under "Historical style continuity anchors". |
| `continuityAnchors` is empty | Preserve brand CSS, typography rhythm, Header/Footer treatment, and CTA style from the project context; report the anchors actually applied in completion JSON. |
| `stateGroupId` is set but `sharedShellContract` or `mutableRegions` is empty | Main Agent must repair the page record before dispatch. Do not generate sibling state pages from scratch. |
| `stateRole === "derived"` but `baseStatePageId` / `derivedFromHtmlSrc` / source HTML is missing | **[BLOCKING]** — poll/retry for the base HTML path first; if still missing, report failure to Main Agent; do not invent a new shell. |
| `actualTokenNameReference` is empty or missing | **[BLOCKING]** — report failure to Main Agent immediately; do not fabricate token names |
| Both `wiringPlan` and `hiddenInteractionPlan` filtered results are empty | No planned cross-page `data-dom-id` attributes needed for this page; set `"domIds": []` in completion report |
| `wiringPlan` is empty but `hiddenInteractionPlan` is non-empty | Add `data-dom-id` for the hidden entries and report them in `"domIds"`; Main Agent registers them with `hideEdge: true` |
| Page is an overlay/floating-layer state but hidden return interactions are missing | Main Agent must add hidden entries for the backdrop/scrim when clickable and every explicit close/cancel/back control, all targeting the source/base page with `hideEdge: true` |
| `themeMode` is missing | Default "light" |
| `forbiddenInventedComponents` empty/missing | No invention ban; Sub-Agent may implement freely |
| `allowedComponents` empty/missing | No whitelist; free selection from evidence |
| `styleConstraints` missing | Aesthetics rhythm rules are sole authority |
| `productContext` missing | Infer from Library name + business scenario |
| `previewFile` missing in componentPlan entry | Skip preview; use contractFile only |

---

## Conflict Resolution

| Conflict | Winner |
| --- | --- |
| Summary token name conflicts with Design Library component or CSS data | Design Library data wins; report mismatch to Main Agent |
| Page requires a component not listed in `componentPlan` | Sub-Agent may read up to 2 extra resolved component contract files and report them |
| Current user query changes one style dimension but historical anchors define others | Current query wins only for the explicitly mentioned dimension; untouched anchor dimensions remain binding |
| Mobile / desktop / tablet layouts need different structure | Device layout may adapt, but shared brand color, font family, radius scale, and component language from `styleContinuityAnchors` remain binding |
| Interaction-state sibling page wants a different shell composition | `sharedShellContract` wins. Only declared `mutableRegions` may change unless the user explicitly asks to redesign the whole state group. |
| Image planned but generation degraded | Use CSS degradation only for that image role; do not leave broken `<img>` |
| Wiring plan references a missing target page | Main Agent must repair `.design`/plan before validation |

---

## Quality Priority

This summary is an optimization layer, not a permission to skip quality sources. When the summary is incomplete or obviously wrong, the Agent must repair the summary or report the issue instead of fabricating tokens, components, images, or wiring.

---

## Free-Explore Continuity Anchors Payload

Referenced from `SKILL.md > Subtask Dispatch Format [CRITICAL] Free-explore style continuity payload`. In no-Library / `free-explore` multi-turn projects, when `project.styleContinuityAnchors` exists, every page-generation or page-editing Sub-Agent Task query must include this expanded block (the anchors themselves, not just the summary path):

```text
Historical style continuity anchors (binding unless the current query explicitly overrides a listed dimension):
- colorSystem: ...
- shapeSystem: ...
- typographySystem: ...
- spacingSystem: ...
- componentLanguage: ...
- surfaceAndDepth: ...
- imageryAndIconography: ...
- interactionTone: ...
```

The task may still include `orchestrationSummaryPath` for full context, but it must not be the only carrier of historical style constraints.
