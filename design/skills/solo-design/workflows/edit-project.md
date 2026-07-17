# Edit Existing Design Project

When the user's intent is associated with an existing design project, use this workflow (i.e., an existing `.design` project was successfully matched during pre-execution preparation).

| Section | Description | User-facing Title |
|---------|-------------|-------------------|
| [Step 1 — Current State Analysis (Main Agent)](#step-1--current-state-analysis-main-agent) | Read existing project files, determine user request type | Analyzing current design |
| [Step 2 — Dispatch by Request Type](#step-2--dispatch-by-request-type-must-parallelize-for-multi-page-operations) | Dispatch corresponding sub-tasks by request type; multi-page operations must be parallelized | Designing pages ({affected page names}) |
| [Step 2a — Pre-register .design skeleton](#step-2a--pre-register-design-skeleton-add-new-pages-only) | Pre-register new page skeleton nodes into .design before generating content | (Silent background, not displayed) |
| [Step 2a.5 — Orchestration Summary](#step-2a5--orchestration-summary-add-new-pages-or-multi-page-edits) | Update runtime context summary for token, component, image, and page plans | (Silent background, not displayed) |
| [Step 2b — Image Pre-generation](#step-2b--image-pre-generation-add-new-pages-only) | After new page skeletons are pre-registered, generate all required image assets in parallel | Preparing image assets for new pages |
| [Step 2b' — Register new image nodes in .design](#step-2b--register-new-image-nodes-in-design-add-new-pages-only) | After image generation completes, append one image node per newly added asset into .design | (Silent background, not displayed) |
| [Step 2c — Dispatch HTML generation sub-tasks](#step-2c--dispatch-html-generation-sub-tasks-add-new-pages-only) | Dispatch HTML generation sub-tasks to Sub-Agents in parallel | Designing pages ({affected page names}) |
| [Step 2d — Wiring Registration](#step-2d--wiring-registration-only-if-user-explicitly-requests) | Register interactions centrally after all Sub-Agents complete HTML generation | (Silent background, not displayed) |
| [Step 3 — Blocking Validation](#step-3--blocking-validation-main-agent-blocking--must-not-skip) | Execute validation script after all sub-tasks complete; [FORBIDDEN] to continue if not passed | (Silent background, not displayed) |
| [Step 4 — Guide Preview (Main Agent)](#step-4--guide-preview-main-agent) | Inform user to preview .design file in canvas editor | Done, ready to preview |

> **User-facing Title**: When the Agent displays this step in TodoList or progress messages, it **must use the expression from this column**. Using the internal section names on the left is [FORBIDDEN]. Full rules in `operation-policies/user-facing-language.md` "Language Constraints for Task Planning and Progress Display".

## Step 1 — Current State Analysis (Main Agent)

1. Read existing `.design` file — understand pages inventory and group distribution
2. Read brand CSS file — understand current design constraints
3. Read or derive `orchestration-summary.json.project.styleContinuityAnchors` when no user-selected Design Library exists. Use `.design`, `pages/*.html`, and `colors_and_type.css` to capture stable color, shape, typography, spacing, component language, depth, imagery, and interaction rules before dispatch.
4. Check whether Design Library Token constraints exist (detection completed during pre-execution preparation phase) — if they exist, subsequent page additions or modifications must strictly follow the Token constraints to ensure new/modified pages are consistent with the Library-defined design style
5. Determine which type the user request belongs to → dispatch corresponding sub-tasks

## Step 2 — Dispatch by Request Type (must parallelize for multi-page operations)

> Full request type determination in `operation-policies/decision-rules.md` "Request Type Decision Table".
> **When involving additions or edits to multiple pages, all page sub-tasks must be dispatched to Sub-Agents in the same round in parallel**. Sequential execution one by one is [FORBIDDEN].

| Request Type | Behavior | Constraint Files |
|-------------|----------|------------------|
| Add new pages | Execute sub-flow: Step 2a → Step 2b → Step 2c → Step 2d (only if user explicitly requested wiring; see Step 2d exception for overlay return interactions). **Sub-Agents only generate HTML, do not write .design** | See `page-generation-template.md` |
| Modify existing pages | Use only when the user explicitly asks to edit/overwrite the old/current page in place. Otherwise route to Quick Path A1 and create a new comparison page. Selected elements, xpath context, and "this part / this button" references are source targeting information, not permission to overwrite. | See `page-generation-template.md` |
| Modify Design Tokens / Explore new style | → `customize-theme.md` | `customize-theme.md` |
| Redesign UI / Tweak UI | → `redesign-ui.md` | `redesign-ui.md` |
| Add assets | Place files directly into `assets/`, then **register every newly added image file as an image node in `.design`** (see Step 2b'). [FORBIDDEN] leaving image files only on disk without registering nodes — they will not appear on the canvas | — |
| Generate page variants | → `generate-variants.md` | `generate-variants.md` |
| Delete pages | Execute Delete Page Path below; Main Agent removes nodes/files/interactions, no Sub-Agent needed | `file-specs/design-file-structure.md` |
| Adopt variant / redesigned draft | Execute Adopt Variant/Draft Path below; Main Agent updates official page selection and interaction mapping | `file-specs/design-file-structure.md` |
| Add navigation to existing pages | Execute Add Navigation Path below; Sub-Agents edit HTML anchors, Main Agent registers interactions | `operation-policies/wiring-strategy.md` |
| Refresh Design Library | Execute Refresh Design Library Path below; re-resolve Library constraints and re-apply page heads | `operation-policies/design-library-parsing.md` |

### Quick Path Selection (evaluate in order, first match wins)

Before dispatching to the general table above, evaluate the user request against Quick Paths **in strict order**. If any Quick Path matches, use it directly without consulting the general table:

1. **Eval order 1: Quick Path A0 — Based-on Add Page?**
   - ✅ Trigger: The request contains a reference anchor such as "基于", "参考", "参照", "仿照", "按照", "以...为基础", "在...基础上", "based on", "reference", or "inspired by" and points to an existing page, current page, selected page, current design, prior result, or named page such as pageA/pageB
   - ✅ Trigger also applies when the action sounds like an edit: "增加/添加/加入/新增/扩展/改造/优化/补充/加一个功能/add/extend/add feature/improve". Example: "基于 pageA 增加一个搜索功能" still means create a new comparison page, not edit pageA.
   - ✅ Behavior: Treat the referenced page/design as immutable source context and create a **new comparison page** via the Add Pages sub-flow. Do **not** overwrite, modify, rename, delete, or replace the referenced page.
   - ✅ Examples: "基于首页做一个详情页", "基于 pageA 增加搜索功能", "参考这个页面生成注册页", "按照现有页面再做一个活动页", "based on this page add a search panel"
   - ❌ NOT trigger: The user explicitly says "覆盖原页面", "替换当前页面", "直接在当前页面修改", "不要新增页面", "overwrite the old page", "replace current page", or equivalent direct in-place wording
   - If both based-on wording and edit wording appear, **A0 wins** and creates a new page unless the user explicitly forbids creating a new page.

2. **Eval order 2: Quick Path A1 — Comparison Page Change?**
   - ✅ Trigger: An existing/current/selected page is available and the request asks to add, improve, optimize, redesign, adjust, create a state, add a modal/search/detail/empty/loading/error view, or change page-level content/layout/interaction.
   - ✅ Trigger: A selected element/xpath/`design_page` is available and the request asks to change that element's behavior, state, copy, layout, visual treatment, or click result. Examples include "这一块的按钮点击后...", "这个元素改成...", "让这个按钮...", and "this selected button should...".
   - ✅ Behavior: Treat the source page as immutable and create a **new comparison page** via the Add Pages sub-flow. The new page must inherit the source page's visible context and implement the requested change there.
   - ✅ Examples: "加一个搜索功能", "优化这个页面", "做一个空状态", "改成弹窗初始态", "把按钮改圆一点", "这一块的按钮点击后直接选择历史记录", "make this page better", "add a search panel"
   - ❌ NOT trigger: The user explicitly says "覆盖原页面", "替换当前页面", "直接在当前页面修改", "不要新增页面", "重生成原页面", "overwrite", "replace current page", "modify in place"; project-wide theme/token changes; delete/adopt/navigation-only requests.
   - If the user wording is ambiguous but a current/selected page exists, **A1 wins over Micro-Edit and Deepen Page** so the user can compare old and new versions on the canvas.
   - [FORBIDDEN] Interpreting element selection as implicit in-place edit permission. Selection only identifies the source page/region to preserve in the new comparison page.

3. **Eval order 3: Quick Path C — Micro-Edit?**
   - ✅ Trigger: Specific element + specific CSS property + scope ≤ 1 page + explicit in-place wording ("直接修改", "覆盖", "不要新增", "replace current page", etc.)
   - ✅ Examples: "把首页按钮改成红色", "change hero title font size", "这个卡片圆角大一点"
   - ❌ NOT trigger: "把颜色改一下" (no specific element), "所有页面" (scope > 1 page), selected element/xpath requests without explicit in-place wording
   - If scope is ambiguous and a current/selected page exists → default to Quick Path A1 (comparison page). If the user clearly asks for a project-wide style/token change → customize-theme.

4. **Eval order 4: Quick Path B — Deepen Page?**
   - ✅ Trigger: "展开", "更详细", "加更多内容", "add more sections", "make it more detailed"
   - ✅ Constraint: Targets exactly 1 existing page
   - ✅ Additional constraint: User explicitly asks to modify the existing page in place or says not to add a new page
   - ❌ NOT trigger: requests for new standalone pages (→ Quick Path A)
   - ❌ NOT trigger: ambiguous page-level improvement where a current/selected page exists (→ Quick Path A1 comparison page)

5. **Eval order 5: Quick Path A — Add Pages?**
   - ✅ Trigger: "再加", "追加", "新增页面", "add pages", "补充", "做个弹窗" (fragment in existing project), Quick Path A0 based-on/reference signals, or Quick Path A1 comparison-page change signals
   - ✅ Constraint: No style change intent
   - ❌ NOT trigger: simultaneous style change + new pages (→ customize-theme first, then add pages)

6. **None matched → Use the general dispatch table above**

### Quick Path A — Add Pages (user says "add more pages" / "再加几个页面")

> Applicable when: project exists + user requests additional pages + no style change intent.

This quick path is a streamlined entry into the standard "Add new pages" sub-flow, **skipping style inquiry**. Quick Path A0/A1 use the same sub-flow, with an extra requirement to read and pass the referenced/current page/design as source context. A0/A1 are not blocked by words like "增加功能", "优化", or "改造"; those words describe what changes in the new comparison page, not an instruction to edit the source page.

1. Read `orchestration-summary.json` → obtain existing project metadata (brand prefix, device type, current page list)
   - **Fallback**: If `orchestration-summary.json` does not exist (legacy project), fall back to standard "Add new pages" flow with style reuse derived from the existing CSS file
2. **Reuse existing brand CSS and `styleContinuityAnchors`** (do not re-inquire about style or regenerate CSS). In free-explore/no-Library mode, copy the expanded `styleContinuityAnchors` values into every Sub-Agent Task query as a binding "Historical style continuity anchors" block; do not merely say "keep same style" or pass only the summary path.
3. If triggered by Quick Path A0 or A1, identify the referenced/current source page/design from selected context, page title, file name, current canvas selection, current conversation focus, or page aliases such as pageA/pageB; read its `.design` node and HTML, then pass it to Sub-Agent as "Reference source context". The Sub-Agent must reuse the source page's layout skeleton, navigation/sidebar/header, key content regions, visual rhythm, component language, and style anchors unless the user explicitly asked to change one of those dimensions. It must output a distinct new HTML file and must not overwrite the source page. The Task query must explicitly state that the reference page is immutable and that the requested function/style change belongs to the new comparison page only.
   - For modal/search panel/empty/loading/error/detail-state requests, the new page should show the source page context with the state embedded or overlaid (for example dimmed source screen + modal), not a standalone floating card on blank background.
   - For source → new-page comparisons, choose a title that indicates derivation, such as `{source title} - 搜索状态`, `{source title} - 优化版`, or `{source title} - 对比稿`; choose a unique HTML slug derived from the source slug plus the requested state/change.
4. Determine new pages' `pageType` + `businessScenario`
5. Continue standard Step 2a → 2b → 2c → 2d flow

**Trigger signals**: User message contains "再加", "追加", "新增页面", "add pages", "补充", "more pages", Quick Path A0 based-on/reference wording ("基于", "参考", "参照", "仿照", "按照", "以...为基础", "在...基础上", "based on", "reference", "inspired by"), or Quick Path A1 comparison-page change wording ("加搜索", "做弹窗", "空状态", "优化这个页面", "改布局", "make this page better"). For Quick Path A0/A1, action words such as "增加/添加/加入/扩展/改造/优化/add/extend/improve" do not cancel the add-page path.

**[NOTE]** If a normal add-page request simultaneously asks for a project-wide style change, route to customize-theme first, then add pages. If Quick Path A0/A1 is triggered, still create a new comparison page; apply any requested style/function changes only to that new page unless the user explicitly requests project-wide changes.

### Quick Path B — Deepen Page (user says "make this page more detailed" / "展开这个页面")

> Applicable when: project exists + user requests increased content depth or state coverage for an existing page.

This quick path is a targeted sub-scenario of "Modify existing pages":

Use this path only when the user explicitly requests in-place editing. Otherwise, route to Quick Path A1 so the user can compare the detailed version against the original page.

1. Read target page HTML + its record in orchestration-summary
2. Analyze user expectation:
   - Append sections: add new `<section>` elements within `<main>`
   - Add state variants (loading/empty/error): render multi-state UI using hidden/visible classes within the same page
   - Content elaboration: in-place Edit to replace target section with a more detailed version
3. Dispatch page editing Sub-Agent (using standard page-editing template, passing "Modification requirements" that specify what to deepen)
4. Validate

**[NOTE]** This path does not create new pages, does not modify `.design` nodes, does not require `fill-html-head.mjs` — it is a lightweight in-place edit, only for explicit in-place requests.

### Quick Path C — Micro-Edit (user changes a single visual property / "改一下颜色")

> Applicable when: project exists + user requests a change scoped to ≤ 1 page + change is a single visual property (color, font size, spacing, border-radius) not affecting all pages.

This quick path avoids full customize-theme overhead for one-off tweaks:

1. Read target page HTML
2. Identify the exact element(s) affected
3. Execute based on change type:
   - **Token-level change** (maps to a CSS variable) → **Main Agent directly**:
     1. Update the variable value in `colors_and_type.css`
     2. Run `fill-html-head.mjs --replace-head` on affected page only
     3. No Sub-Agent dispatch needed
   - **Element-specific change** (e.g., "make THIS button bigger") → Dispatch single-page Sub-Agent with surgical edit instruction (uses standard page editing template; Sub-Agent does NOT run fill-html-head.mjs)
4. Validate token compliance on the edited page: verify no hardcoded colors / fabricated variable names were introduced; final authority is the scan script gate (Step 3 `scan-design-directory.mjs`)

**Trigger signals**: Request mentions specific element + specific property + scope is clearly single-page or single-element. Examples: "把首页按钮改成红色", "change the hero title font size", "这个卡片圆角大一点"

**[NOTE]** If the change should propagate to ALL pages (user says "全部改" / "所有页面"), route to `customize-theme.md` instead — that flow handles project-wide token updates.

---

**Page editing sub-task template** (based on shared template `{SKILL_DIR}/workflows/page-generation-template.md`; constraint files and shared rules all in that file):

> **Routing guard**: This page editing template is [FORBIDDEN] when Quick Path A0 or A1 is triggered. Based-on/reference and comparison-page requests must use the Add Pages sub-flow and generate a distinct new HTML file, even if the user asks to add, improve, optimize, or adjust a feature.

```
Task: Modify page "{page name}"
Output: {designProjectPath}/pages/{page-name}.html (overwrite existing file)
Shared template: {SKILL_DIR}/workflows/page-generation-template.md
All shared dispatch fields: assemble per {SKILL_DIR}/operation-policies/dispatch-schema.md, populated with this project's concrete values
Differentiated input (edit-specific):
  - Current page content: {read HTML}
  - Modification requirements: {user's specific requirements}
Additional notes (editing-specific rules):
  - This is an editing task (overwrite modification, not creating a new page); do not run fill-html-head.mjs, and do not append .design nodes.
  - Cross-page style consistency: The modified page must maintain the same base background color, Header/Footer treatment, text hierarchy, radius scale, spacing rhythm, component language, and surface/depth model as other pages in the project unless the current query explicitly overrides that dimension.
```

## Image Acceptance Rule (applies to ALL image operations in this workflow)

> SSOT: `create-project.md` Step 2.5b "Image Acceptance Rule". In short: a successful GenerateImage result is unconditionally accepted; [FORBIDDEN] re-reading/verifying/re-generating/deleting images, adding "no watermark"/"no logo"/"no signature" to prompts, or degrading to SVG/CSS fallback when generation succeeded. Full rule text and rationale live in that section.

## Step 2a — Pre-register .design skeleton (Add new pages only)

> Only execute this sub-step when Step 2 determines the request type is "Add new pages". The Main Agent must execute this step before image pre-generation and before dispatching HTML generation sub-tasks.
> For Quick Path A0/A1, this step is mandatory and is the proof that the operation is a new comparison page, not an in-place edit. The new `htmlSrc`, nodeId, and title must be different from the referenced source page.

1. Read current `.design` file, get existing page nodeIds
2. Pre-assign nodeId (`page-{slug}` format, derived from new HTML filename), htmlSrc, title for each new page
   - For Quick Path A0/A1 comparison pages that **replace** their source page (the default, unless the user explicitly asks to keep both versions usable in preview), also write `supersedesPageId: <source page nodeId>` into the skeleton node's `devMetadata`. This declares the source page retired and makes Step 2d Version Convergence mandatory.
3. Add new page skeleton nodes to `data` array (interactions remain empty array `[]`)
   - Normal add-page requests: append after existing page nodes.
   - Quick Path A0/A1 comparison pages: insert the new page node immediately after the referenced source page node in `data` so canvas auto-layout places old and new pages next to each other for comparison. If multiple comparison pages derive from the same source, insert them as a consecutive group after the source page.
4. Write back to `.design` file and immediately re-read to confirm correct node count

Do not run full project validation at this intermediate state because new HTML files may not exist yet. Full validation happens in Step 3 after all page files are complete.

## Step 2a.5 — Orchestration Summary (Add new pages or multi-page edits)

When adding pages or dispatching multiple page edit tasks, create or update `{designProjectPath}/orchestration-summary.json` following `{SKILL_DIR}/operation-policies/orchestration-summary.md`.

Required updates:

1. Preserve existing page records when they are not affected.
2. Add or update records for affected pages with `nodeId`, `slug`, `title`, `htmlSrc`, `pageType`, `businessScenario`, `componentPlan`, `imagePlan`, and `qualityRisks`.
   - For Quick Path A0/A1 comparison pages, also set `derivationType: "comparison-from-source"`, `sourcePageId`, and `sourceHtmlSrc`; preserve the source page's existing record unchanged.
3. For Library-bound projects, build each affected page's `componentPlan` from `components/_evidence/index.json` + `uikit-plan.json` when present; otherwise use `components/index.json` with 3-6 relevant slugs. Each plan entry must include resolved `contractKind` and `contractFile`; include `debugFile` only for debug/refine context and do not pass it as normal generation input.
4. Scan existing `assets/` and record reusable assets before planning new generation.
5. Pass `orchestrationSummaryPath` and the current page record to Sub-Agents instead of pasting full project context.
6. When no Design Library is selected, include `project.styleContinuityAnchors` in the summary and pass it to affected page Sub-Agents. Preserve untouched dimensions; if the user only changes one visual property, do not rewrite the rest of the style system.
7. **Dispatch payload guard**: Before calling any Sub-Agent in free-explore/no-Library mode, verify the Task query contains a literal "Historical style continuity anchors" block with expanded values for the available dimensions (`colorSystem`, `shapeSystem`, `typographySystem`, `spacingSystem`, `componentLanguage`, `surfaceAndDepth`, `imageryAndIconography`, `interactionTone`). If the block is missing, do not dispatch; add it first.

### Icon Asset Sync (Library-bound, conditional)

> Skip if not Library-bound or if Library has no `assets/icons/` or `icons/` directory.

1. LS `{library-path}/assets/icons/` (or `{library-path}/icons/`)
2. Compare file name list with existing `designSource.iconAssets.availableNames` in orchestration-summary
3. IF name list differs (new icons added / old icons removed / icons renamed):
   - Remove `{designProjectPath}/assets/icons/{libraryKey}/` directory
   - Re-copy ALL current Library SVGs to `{designProjectPath}/assets/icons/{libraryKey}/`
   - Update `orchestration-summary.json > designSource.iconAssets.availableNames` and `totalCount`
4. IF name list is identical → skip copy (no change needed)
5. [FORBIDDEN] Reading SVG file content during comparison — only compare file name lists

## Step 2b — Image Pre-generation (Add new pages only)

> Only execute this sub-step when Step 2 determines the request type is "Add new pages". Skip this step for modifying existing pages, modifying themes, or other request types.

The process follows `create-project.md` Step 2.5 image necessity rules:

1. **Scan reusable assets first**: Identify existing `assets/` files with matching business semantics; reuse before generating.
2. **Classify planned images by role**: `critical-hero`, `shared-brand`, `supporting-content`, or `decorative`.
3. **Avoid decorative generation**: `decorative` images are not generated by default; use typography, surface, icons, and same-hue texture instead.
4. **Generate only necessary new assets**: New generated image cap for added pages is `min(newPageCount + 1, 4)`, excluding reused/copied reference assets. (Cap is intentionally lower than create-project's `min(pageCount + 1, 6)` because incremental edits should stay conservative.)
5. **Update orchestration summary**: Record each asset role, ownership, semantic description, and status (`planned`, `generated`, `reused`, `degraded`).
6. **Dispatch image generation sub-tasks in parallel**: Only for planned assets that are not reusable; do not regenerate already reusable images.

## Step 2b' — Register new image nodes in `.design` (Add new pages only, [REQUIRED])

> **[REQUIRED]** After Step 2b completes (and before dispatching Step 2c HTML generation), the Main Agent **must append one `type: "image"` node into `.design` `data` array for every newly produced file under `assets/`**. Without this step, new image assets only live inside HTML `<img>` tags and never surface as independent cards on the canvas, which contradicts gate invariant #6 of `SKILL.md`.

Procedure (all in a single Main Agent pass, do not delegate to Sub-Agents):

1. **Diff `assets/`**: enumerate the files produced in Step 2b. Skip image files that were already registered as image nodes in the existing `.design` (reused assets).
2. **Skip non-image files**: only register files with image extensions (`.jpg` / `.jpeg` / `.png` / `.gif` / `.webp` / `.svg`).
3. **Continue the project-wide image-id counter**: scan existing image node IDs, find the largest `image-NNN` suffix, and continue from there (do not restart from `image-001`).
4. **Build one image node per new asset** using the "Image Node" spec in `file-specs/design-file-structure.md` — the SSOT for the node field template, the `image-NNN` id format, and the title rule (semantic description in the user's language; NOT a mechanical kebab-case → Title Case conversion of the filename).
5. **Append at the end of `data`**: read current `.design`, append all new image nodes after the existing nodes, write back once. Do not modify any existing node.
6. **Standalone "Add assets" requests**: when the user only adds new image files (no page changes), follow this same procedure — the diff/append logic still applies.

> **[FORBIDDEN]** Selectively registering only "primary" images; every newly added file in `assets/` (that matches an image extension) becomes a node.

## Step 2c — Dispatch HTML generation sub-tasks (Add new pages only)

> Dispatch HTML generation sub-tasks to Sub-Agents in parallel (same as `create-project.md` Step 3). Use `fill-html-head.mjs` to generate skeleton; **Sub-Agents only generate HTML, do not write .design**.
>
> **When involving multiple new pages, all page sub-tasks must be dispatched to Sub-Agents in the same round in parallel**. Sequential execution one by one is [FORBIDDEN].
>
> **[REQUIRED]** Sub-Agents read Phase 0 + Phase 1 constraint files directly per `page-generation-template.md` Standard Mode. No pre-injection or digest needed. This applies even for single-page additions.

All shared dispatch fields are assembled per `operation-policies/dispatch-schema.md` (Library constraints, free-explore policies, continuity anchors, shell contract, wiring/image tables, etc.). Edit-specific differentiated inputs:

- New page output path, pre-assigned nodeId, title, and htmlSrc.
- For Quick Path A0/A1: the comparison/source-page context per dispatch-schema.md §8 (source page identity, HTML excerpt or path, source-page continuity requirements, immutability sentence). Additionally:
  - Keep enough unchanged source content visible that the user can compare old and new pages side by side on the canvas.
  - If the requested change is a small UI affordance, implement it as a variation of the source page rather than inventing a new full layout.

## Step 2d — Wiring Registration (only if user explicitly requests)

> **Default is no wiring**. Only register interactions when the user explicitly requests page navigation / wiring. See `operation-policies/wiring-strategy.md` for details.
>
> **Exception 1**: hidden return interactions (backdrop, close control, back affordance) of comparison/state pages rendered as overlays are mandatory regardless of user request, per wiring-strategy.md overlay rules.
>
> **Exception 2 — Version Convergence (mandatory)**: when any page added in this round carries `supersedesPageId`, regardless of whether the user requested wiring, the Main Agent must execute Version Convergence per `operation-policies/wiring-strategy.md` "Version Convergence": redirect all incoming interactions from the superseded page(s) to the newest version, clear the superseded page's own `interactions` to `[]`, then re-read and self-check that no superseded page remains reachable.

After all Sub-Agents complete HTML generation, the Main Agent registers interactions centrally:

1. Read current `.design` file
2. For each page node that needs wiring, populate the `interactions` array with the requested navigation targets
   - For Back / return / close-to-list controls, global nav, breadcrumbs, secondary CTAs, and skip links, register `{ domId, targetPageId, hideEdge: true, transitionLabel }` so preview navigation works without drawing a canvas edge
   - [FORBIDDEN] Do not create a normal visible reverse interaction for return behavior
3. If any new page carries `supersedesPageId` (Exception 2): redirect every existing interaction whose `targetPageId` points to a superseded page so it targets the newest version (keep `hideEdge` / `transitionLabel` unchanged), and set each superseded page node's `interactions` to `[]`
4. Write back to `.design` file
5. If Exception 2 applied: immediately re-read the `.design` file and verify (a) no interaction references a superseded page id, (b) every superseded page's `interactions` is `[]`; fix and re-verify on any mismatch

## Delete Page Path (Main Agent only)

Use when the user explicitly asks to remove one or more existing pages.

1. Read `.design` and locate target page node IDs and `devMetadata.htmlSrc` files.
2. Remove target page nodes from `data`.
3. Remove incoming and outgoing `interactions` that reference deleted page IDs.
4. Delete corresponding `pages/*.html` files.
5. Run Step 3 validation with `--expected-pages=<remaining page count>`.

## Add Navigation Path

Use when the user asks to add a navigation entry, link an existing page from navbar/footer/CTA, connect newly added pages from existing pages, or make an already visible cross-page control clickable in preview.

1. Identify source page(s), target page(s), and required visible link text.
2. Dispatch HTML edit Sub-Agents only for source pages that need new or updated anchors.
3. Sub-Agents add stable `data-dom-id` attributes to the requested clickable elements and report the domIds.
4. Main Agent registers `.design` `interactions` using the reported domIds and target page IDs. If the requested link is a Back / return / close-to-list control, global nav, breadcrumb, secondary CTA, or skip link such as Page 1 → Page 3, include `hideEdge: true`.
5. Run Step 3 validation with `--require-interactions` when the expected links are known.

## Adopt Variant/Draft Path

Use when the user chooses a generated variant, redesigned copy, or draft as the official version.

1. Ask only if needed whether to replace the original page or keep both.
2. If replacing: update the original page node's `htmlSrc` to the adopted HTML or copy adopted HTML over the original file, then migrate required interactions. If the original node is kept alongside the adopted node, write `supersedesPageId: <original nodeId>` on the adopted node and execute Version Convergence per `operation-policies/wiring-strategy.md` (redirect incoming edges, clear the original node's `interactions`).
3. If keeping both: keep the adopted page as a separate node and optionally add navigation only if the user requests it.
4. Remove obsolete draft nodes/files only when the user explicitly asks to clean up.
5. Run Step 3 validation.

## Refresh Design Library Path

Use when the user asks to update an existing project to a newer or selected Design Library.

1. Re-run `operation-policies/design-library-parsing.md` to extract the updated Library constraints.
2. Re-apply the selected `colors_and_type.css` to all affected pages with `fill-html-head.mjs --replace-head`.
3. Do not rewrite page body content unless the user also requests component/layout migration.
4. If component/layout migration is requested, dispatch page edit Sub-Agents with the updated Component Index and relevant `ui_kits` reference.
5. Run Step 3 validation.

## Step 3 — Blocking Validation (Main Agent, Blocking — must not skip)

> **This step is blocking. After all Sub-Agents complete and before guiding the user to preview, the Main Agent must personally execute this validation. [FORBIDDEN] to proceed to Step 4 without passing validation.**

Use `scan-design-directory.mjs` for one-pass complete validation, avoiding multiple tool calls:

```bash
node {SKILL_DIR}/script/scan-design-directory.mjs <design-project-path> [--expected-pages=<N>]
```

Where `<design-project-path>` is the design project root directory path. If this operation involves adding new pages, the `--expected-pages=<N>` parameter must be passed (`N` = existing page count + newly added page count); not required when only editing existing pages or modifying themes.

When exit code is 1, follow the repair procedure in `operation-policies/design-project-validation.md`.

## Step 4 — Guide Preview (Main Agent)

Same as `create-project.md` Step 5. Keep the textual summary link-free and rely on the host-rendered artifact entry for the `.design` file. If the user prefers to preview HTML directly in a browser, a local HTTP service can also be started (see `operation-policies/output-delivery.md` "Preview Method" section).

**Finish summary must not include manual links**, format specified in `operation-policies/output-delivery.md` "Artifact Declaration" section.
