---
name: solo-design
description: Design website pages, adjust visual style and color schemes. Applicable to creation, editing, and preview of visual pages such as official websites, landing pages, product showcase pages, posters, and mobile app showcase pages. Produces .design canvas projects with HTML pages (use design-library-creator instead for reusable Design Library/Design System creation). 设计网页页面、调整视觉风格与配色。适用于官网、落地页、产品展示页、海报、原型、移动端展示页的创建/编辑/改版/换配色/暗色模式/页面变体等场景。
---

# Version Marker

`solo-design-version-convergence-v20260611-1830`

> Cross-platform sync: run `node {SKILL_DIR}/script/check-skill-sync.mjs` after any edit to verify macos/linux/windows copies are identical.

## Immediate Routing Guards

These guards apply before any detailed workflow choice:

- **Based-on / reference existing page = new comparison page by default**. If the user says "基于", "参考", "参照", "仿照", "按照", "在...基础上", "based on", "reference", or "inspired by" an existing/current/selected page or prior result, create a new page that uses the referenced page as immutable source context. This remains true when the action says "增加功能", "加搜索", "优化", "改造", "add feature", or "improve". Do not plan an in-place edit unless the user explicitly says to overwrite, replace, or directly modify the old/current page.
- **Existing project changes are add-first, not overwrite-first**. When an existing/current/selected page, selected element, xpath, `design_page`, or current canvas focus is available and the user asks to add, improve, optimize, redesign, adjust, create a state, add a modal/search/detail/empty/loading/error view, change button behavior, add a click interaction, or otherwise change page/element content/layout/interaction/visual treatment, create a new comparison page by default. The old page is source context and must remain unchanged. In-place page editing is allowed only when the user explicitly says "覆盖原页面", "替换当前页面", "直接在原页面修改", "不要新增页面", "不需要对比页", "重生成原页面", "overwrite", "replace current page", "modify in place", "do not create a new page", or equivalent. Selection is never an in-place signal. This guard does not override explicit project-wide token/theme changes, deletion, adoption, or navigation-only wiring requests.
- **Derived pages must preserve source-page context**. A new comparison page derived from an existing page must visibly continue the source page's layout skeleton, navigation/sidebar/header, core content, and style anchors. If the requested change is a modal, search panel, empty/loading/error state, or detail overlay, render it inside or above the inherited page context (e.g., dimmed source screen + overlay), not as an isolated floating component on a blank canvas.
- **Free-explore continuity must be explicit**. In no-Library multi-turn projects, reuse `project.styleContinuityAnchors` from current project history. When dispatching any page Sub-Agent, paste the expanded anchors into the Task query; do not rely only on `orchestration-summary.json` path or vague wording such as "keep same style".

## User Instruction Priority (Supreme Constraint)

> **This rule supersedes aesthetic defaults and optional workflow preferences, but never overrides deliverable validity, rendering correctness, security constraints, or required validation gates.**

When the user explicitly instructs "how to do it" or "how to change it", the Agent **must prioritize user instructions** for design direction, content, layout, and optional process choices. Required file-validity and rendering constraints remain binding because violating them prevents the canvas deliverable from working.

| Scenario | Correct Behavior |
|----------|-----------------|
| User explicitly requests a specific layout, color scheme, component structure, or file operation | Execute exactly as requested; Skill norms serve as defaults overridden by user instructions |
| User's approach differs from Skill-recommended best practices | Execute the user's request; if there is a quality risk, provide a **one-sentence** risk note, but still defer to the user's choice |
| User requests skipping an optional step (e.g., style inquiry or recommendation) | Skip it directly; do not insist on asking or executing by citing "process requirements" |
| User requests skipping validation or violating rendering/file-validity/security constraints | Do not silently skip; explain that the constraint is required for a working canvas result and continue with the closest safe equivalent |
| User's request conflicts with an aesthetic or process "[FORBIDDEN]" item | Execute per user instructions when it does not break output validity, rendering, or safety |

**Principle**: Skill norms are the Agent's decision-making basis **when the user has not explicitly specified**; explicit user instructions take priority for design decisions, while output-validity and safety constraints remain non-negotiable.

## Constraint File Index

> **[FORBIDDEN] Main Agent pre-reading of Sub-Agent implementation constraint files**
>
> The Main Agent **only reads files within its own orchestration scope** (the "Main Agent Reading Scope" list below). It is forbidden to pre-read or digest Sub-Agent implementation constraint files (`sub-agent-hard-rules.md`, `page-generation-quality-gate.md`, `html-implementation*.md`, `aesthetics/index.md`, `script/*`). Sub-Agents read these files directly per `page-generation-template.md` Standard Mode.
>
> **Reason**: Main Agent does not generate HTML or process CSS. Pre-reading these files wastes Main Agent context with irrelevant implementation details.
>
> **Only exception**: If the Main Agent generates page HTML directly for any reason (Sub-Agent retry failure per `workflows/create-project.md` Step 3.1, or any other in-context generation path), it **MUST** first read `sub-agent-hard-rules.md` and `html-implementation.md` (plus `html-implementation-{device}.md` when applicable). Generating page HTML without reading these files is forbidden — even for single-page or "simple" tasks.

### Main Agent Reading Scope

Main Agent responsibilities: Understand intent → Route decision → Dispatch subtasks → Wiring registration → Gate validation. Only the following files need to be read:

| File | When to Read | Content Summary |
| --- | --- | --- |
| `operation-policies/decision-rules.md` | **Must read before every execution** | Request type decision table, pre-execution preparation, density classification, wiring strategy quick reference |
| `operation-policies/user-facing-language.md` | **Must read before every execution** | User-facing output language SSOT, forbidden terms, step title mapping, Canvas-First principle, forbidden/allowed questions |
| `operation-policies/creative-direction.md` | Read when routing to create-project or generate-variants | Design Thinking Framework, style option generation constraints, anti-convergence rules |
| `operation-policies/design-library-parsing.md` | Read when Design Library exists or theme source priority must be resolved | Design Library / Token parsing SSOT, theme source priority, brand prefix discovery, component plan extraction |
| `file-specs/design-file-structure.md` | Read when creating, updating, or repairing `.design` metadata | Shared `.design` file format spec and node templates; readable by Main Agent for metadata ownership |
| `workflows/create-project.md` | When creating a new project | Complete steps (style selection → initialization → page generation → validation → preview) |
| `workflows/edit-project.md` | When editing an existing project | Complete steps (current state analysis → dispatch → update → validation → preview) |
| `workflows/customize-theme.md` | When modifying theme / exploring new styles | Update `colors_and_type.css` in place and re-apply page heads; do not create theme nodes or duplicate pages |
| `workflows/redesign-ui.md` | When user requests UI changes / redesign | Fork a duplicate project, apply UI changes on the duplicate |
| `workflows/generate-variants.md` | When generating page variants / multi-scheme comparison | Generate 2\~3 layout variants in parallel, compare side-by-side on canvas |
| `operation-policies/wiring-strategy.md` | When wiring decisions are involved (creating new project, user requests wiring) | Authoritative wiring strategy definition: visible wiring map + hidden interaction plan, visible edge limits, `hideEdge: true` semantics, data-dom-id naming convention, Main Agent unified interactions registration |
| `operation-policies/reference-material-handling.md` | When user provides non-text materials (screenshots/URLs/ZIPs) | Reference material analysis flow: detection → type-specific analysis → output Design Constraints Document |
| `operation-policies/long-requirement-parsing.md` | When user message > 500 chars or PRD-like content | Long requirement parsing: structured extraction → page prioritization → requirement-to-page mapping |
| `operation-policies/orchestration-summary.md` | When creating new projects, adding pages, or dispatching multiple page subtasks | Runtime summary file schema for page plan, token references, component plan, image plan, visible wiring plan, and hidden interaction plan; reduces repeated context passed to Sub-Agents |
| `operation-policies/dispatch-schema.md` | Read when assembling any page-generation/editing dispatch | Single source of truth for shared Sub-Agent dispatch field schema |
| `operation-policies/main-agent-repair-flow.md` | Read when the validation gate fails or image generation fails | Repair vs regenerate decision flow; image generation failure policy |

**Note**: The Main Agent reads the mandatory policy companions above + **only one** corresponding workflow file per execution (determined by the routing table); do not read all workflows at once.

### Sub-Agent Reading Scope (Main Agent must not pre-read)

Sub-Agent constraint files are precisely listed by phase in `workflows/page-generation-template.md`. When dispatching tasks to Sub-Agents, the Main Agent only needs to reference the template path and pass differentiated parameters — **no need to pre-read these file contents**.

The following list is for **overview reference only**; actual reading is controlled by `page-generation-template.md`:

| Category | File | Content Summary |
| --- | --- | --- |
| Technical Constraints (Common) | `operation-policies/html-implementation.md` | HTML common technical spec: tech stack, theme config, responsive layout, style rules, image rules, JS restrictions; layout structure (title block, info-action dual-column); line-wrap defense (tags/badges/pills, KPI cards, table wrapping) |
| Technical Constraints (Desktop) | `operation-policies/html-implementation-web.md` | Desktop / tablet specifics: internal element fluid width, top navbar full-width, chart companion info area, column adaptability (including nested column fuse), form field column width |
| Technical Constraints (Mobile) | `operation-policies/html-implementation-mobile.md` | Mobile specifics: container nesting & screen efficiency ratio, semantic hierarchy flattening, card dual-column constraints, above-the-fold layering, rounded container protection, line-wrap protection, section restraint & structural deduplication |
| Aesthetic System | `aesthetics/index.md` + `operation-policies/page-generation-quality-gate.md` | Quality gate is mandatory for every page; deeper aesthetic chapters are read only when triggered by page content, quality risks, or Showcase home-page requirements |
| File Specs | `script/fill-html-head.mjs` | HTML skeleton generation script (includes complete `<head>` generation logic); must be used during page generation / variant generation |
| File Specs | `script/validate-design-file.mjs` | `.design` file validation script (full check list in the script's header comment); automatically called internally by `scan-design-directory.mjs`, **Sub-Agent must not call directly** (to avoid validation-repair deadlocks when multiple Agents run in parallel on the same file) |

***

## \[FORBIDDEN] Blocking Validation Gate for `.design` File Generation

> **This section is the highest-priority constraint of the entire Skill. Violations will directly prevent canvas rendering. All flows must pass this gate before completion.**

### Core Invariants

| # | Invariant | Consequence of Violation |
| - | --------- | ------------------------ |
| 1 | `.design` file **must exist** and be valid JSON | Canvas cannot open |
| 2 | `data` field **must be a non-empty array** | `TypeError: e.data is not iterable` |
| 3 | `data` **must contain at least one page or image node**; theme nodes are legacy optional | Canvas opens with no usable content |
| 4 | Each page node's `devMetadata.htmlSrc` must point to an HTML file that **actually exists** | Page white screen |
| 5 | Each legacy theme node's `devMetadata.sourceId` must correspond to a `.theme` file that **actually exists** | SDK error for legacy theme projects |
| 6 | Each image node's `devMetadata.imageSrc` must point to an image file that **actually exists** | Image card blank |
| 6a | **Every image file under `assets/`** (extensions `.jpg/.jpeg/.png/.gif/.webp/.svg`) **must be registered as a `type: "image"` node** in `.design`. No file may live in `assets/` without a corresponding node. **Exemption**: files under `assets/icons/**` (Design Library icon assets for CSS mask rendering) are excluded from this invariant | Asset never appears on canvas |
| 7 | Every node **must have** **`devMetadata`** (not `metadata`), with all fields complete | SDK cannot parse |
| 8 | All node `id` values **must be unique** | Node confusion |
| 9 | In Library-bound mode, the active Design Library identity must be recorded in both `.design.config.designLibrary` and `orchestration-summary.json.designSource.libraryIdentity` with matching `name`, `id`, `version`, `scope`, and `path` | Library traceability and version checks cannot work |

> **Exemption**: files under `assets/icons/**` (Design Library icon assets for CSS mask rendering) are excluded from this invariant. They are HTML support icons consumed via `<span data-icon>`, not standalone canvas image cards.

### Validation Flow

Complete validation flow documentation (timing, repair flow guide) is in `operation-policies/design-project-validation.md`.

> **Sub-Agents do not execute validation**: When multiple Sub-Agents run in parallel, each validating the same `.design` file would cause deadlocks (multiple Agents simultaneously discovering and attempting to fix the same issue). Validation is unified by the Main Agent after all subtasks complete.

The **Main Agent** **must execute a one-time full validation** before presenting results to the user:

```bash
node {SKILL_DIR}/script/scan-design-directory.mjs <design-project-path> [--expected-pages=<N>] [--require-interactions=domId:file,...]
```

Where `<design-project-path>` is the design project root directory path. If the current operation involves adding new pages, the `--expected-pages=<N>` parameter must be passed; it is not needed when only editing existing pages or modifying themes. The optional `--require-interactions=domId:file,...` parameter asserts that the listed `data-dom-id` → page interactions are registered in `.design`.

### Common Omission Patterns

> Full patterns table with detailed prevention steps in `operation-policies/design-project-validation.md`. Two patterns deserve emphasis here:

| Omission Pattern | Consequence | Prevention |
| ---------------- | ----------- | ---------- |
| Generated HTML but page node was not registered in `.design` | Canvas blank | Main Agent pre-registers or appends page nodes; Sub-Agents never write `.design` |
| Generated images under `assets/` but did not register image nodes in `.design` | Assets never surface on canvas as cards; only available inside HTML `<img>` tags | Main Agent must execute `create-project.md` Step 2.5d (CREATE) or `edit-project.md` Step 2b' (UPDATE) after image generation completes — one image node per asset file, no exceptions |

### \[FORBIDDEN] Creating Ad-hoc Helper Scripts

**Absolutely forbidden** to write any Python, Shell, Node.js, or other language helper scripts during execution, including but not limited to:

| Forbidden Behavior | Correct Approach |
| ------------------ | ---------------- |
| Post-processing, re-generating, or deleting images after GenerateImage succeeds (including perceived watermark/quality concerns) | GenerateImage success = unconditionally accepted. Use generated images directly. The development preview watermark is expected platform behavior and is removed on export. [FORBIDDEN] to add `no watermark` to prompts — this triggers hallucinated concerns |
| Using Python/JS to generate color scales (HSL calculation, linear interpolation) | SDK automatically generates color scales from `seedColor`, or directly write 10 HEX values based on color experience |
| Using BeautifulSoup/cheerio etc. to parse/validate HTML structure | Ensure HTML correctness during generation; `.design` file integrity is validated by the built-in `validate-design-file.mjs` |
| Using scripts to batch rename/move/convert files | Use file operation tools directly |

**Only the following Skill-provided scripts are allowed**; execution of any other scripts is forbidden:

| Script | Purpose | Caller | When to Call |
|--------|---------|--------|-------------|
| `node {SKILL_DIR}/script/validate-design-file.mjs` | Validate a single .design file | **Internal (called by scan-design-directory.mjs)** | Not called directly |
| `node {SKILL_DIR}/script/fill-html-head.mjs` | Generate HTML skeleton (auto-fill `<head>`) | Sub-Agent | Must execute before creating ordinary/base HTML pages. [FORBIDDEN] for `stateRole: "derived"` pages; derived pages must copy the base HTML first. |
| `node {SKILL_DIR}/script/scan-design-directory.mjs` | Full directory scan validation (internally validates all .design files) | **Main Agent** | Must execute before presenting results to user |

### Preview Method

**Recommended preview method**: Let the host application render the `.design` artifact automatically. Do not create a manual Markdown link, bare file path, `computer://` URL, or "查看设计项目 / 查看 xxx 页面" link in the assistant summary.

Alternatively, the Main Agent may start a local HTTP server via `python -m http.server`, `npx serve`, etc. to preview HTML pages, or use the OpenPreview tool to display preview links. Sub-Agents must not start preview servers.

### Artifact Declaration (Finish Summary must not include links)

When the task is complete (calling the Finish tool), **the summary must not include any Markdown link, bare path, `computer://` URL, or manual artifact link text**. The host-rendered artifact entry is the only visible entry point for the `.design` artifact. Forbidden examples: `[查看设计项目](computer://...)`, `查看 design-4 页面`, `/absolute/path/to/project.design`, `computer:///absolute/path/to/project.design`.

Rules:
- Finish summary should be concise natural language in the user's language.
- Mention the result is available in the generated artifact entry, but do not create a clickable link yourself.
- `.design.name` / backend `display_name` remains the source of the host-rendered artifact title.
- In redesign-ui flow, the host-rendered artifact entry should point to the duplicate project's `.design` artifact; textual summary still contains no link.

### [FORBIDDEN] Leaking Internal Strategy to User-Visible Output

User-facing output language is defined only in `operation-policies/user-facing-language.md`. Do not copy or redefine those rules here; read that file every execution and use its step title mapping for conversation messages, TodoList titles, progress reports, and final summaries.

***

## Design Library & Token Constraints

Design Library parsing, theme source priority, brand prefix discovery, component plan selection, and css.json read limits are defined only in `operation-policies/design-library-parsing.md`. The Main Agent reads that policy when a Library exists or when theme source priority must be resolved.

Quick priority index:

| Priority | Source |
| -------- | ------ |
| 1 (Highest) | User-selected Design Library |
| 2 | Style/Token directly expressed in user query |
| 3 | Project's existing Design Library |
| 4 | Historical style continuity anchors from the current project (`orchestration-summary.json`, `.design`, `pages/*.html`, `colors_and_type.css`) |
| 5 (Lowest) | Default path — requires user confirmation |

Sub-Agent HTML implementation details, `fill-html-head.mjs` usage, and Token fidelity forbidden rules are defined in `workflows/page-generation-template.md` and `operation-policies/sub-agent-hard-rules.md §Token-Fidelity`. The Main Agent does not pre-read or duplicate those implementation rules.

When a Design Library exists, the Main Agent includes the compact Library constraints block in page subtasks. Template: `operation-policies/design-library-parsing.md` §Dispatch Payload Template (Library-Bound).

***

## Architecture: Main Agent Orchestration + Sub-Agent Execution

**You (the Main Agent) are only responsible for flow orchestration** — understanding intent, determining phase, assembling subtask descriptions, and dispatching to Sub-Agents.

**Sub-Agents are responsible for concrete implementation** — after receiving task descriptions, they read specified constraint files, then execute file creation/editing.

### Parallel Dispatch Principle (Mandatory)

**Batch subtasks must be dispatched to Sub-Agents in parallel only when they are truly independent; serial one-by-one execution is forbidden for independent work.** When a step contains multiple independent subtasks, the Main Agent must dispatch all subtasks in the **same turn**, allowing Sub-Agents to complete them in parallel. Tasks with parent/child, base/derived, or shared-fragment dependencies are not independent and must follow dependency order.

| Scenario | Parallel Requirement |
| -------- | -------------------- |
| Image asset pre-generation (creating new project / adding new pages) | All image generation subtasks dispatched in the same turn in parallel; page subtasks dispatched only after completion |
| Creating multiple unrelated pages; exploring page variants (2\~3 schemes); exploring theme variants (page copies); redesigning or editing multiple pages | All independent subtasks dispatched in the same turn in parallel |
| Creating pages/states that share a generation-tree ancestor, state group, tab shell, modal shell, or common body frame | Generate parent/shared fragment first; generate the base state leaf next; dispatch derived state leaves only after the base page file exists |

\[FORBIDDEN] The following serial behaviors for independent subtasks:

- Waiting for one independent subtask to complete before dispatching the next
- Dispatching only one subtask per turn, completing batch work over multiple turns
- Using the Main Agent itself to serially complete work that should be handled by Sub-Agents in parallel
- Generating page HTML in-context (whether via Write or SearchReplace) without first reading `sub-agent-hard-rules.md` and `html-implementation.md`

**Dependency exception**: Steps with data dependencies between them execute in dependency order. This includes generation-tree parent before child, shared branch before leaf, and state-group base before derived states. Parent and child nodes, or base and derived state pages, must never be dispatched in the same Task batch.

**Dispatch ownership**: Only the Main Agent dispatches Task/Sub-Agent work. Sub-Agents must never dispatch their own child Sub-Agents, even for a generation-tree child node. A Sub-Agent's output is a fragment/page file plus completion JSON only; the Main Agent reads that result, verifies readiness, updates `generation-tree.json`, and then dispatches eligible child nodes.

**Parent completion gate**: A child node is dispatchable only after all three are true: the parent Sub-Agent has returned completion, the parent `output` file exists and is non-empty, and the Main Agent has updated `generation-tree.json` marking that parent `status: "generated"`. Mentioning a planned parent path in the prompt is not enough.

**Parent subtree wait gate**: A parent/shared node being `generated` means its own fragment is ready, not that the whole branch is complete. Before the Main Agent treats a parent branch as complete or proceeds to final validation/summary, it must check every planned descendant in `generation-tree.json`. If any child/descendant is still `planned`, `running`, missing completion JSON, or missing a non-empty output file, the Main Agent must wait/poll and retry status checks instead of finalizing. After retries are exhausted, mark the parent branch `blocked` with the missing child node IDs and do not claim the design is complete.

### Subtask Dispatch Format

Each subtask must include the following information:

```
Task: {what to do}
Output: {which files to generate/modify}
Constraint files (must read before execution):
  - {SKILL_DIR}/xxx.md — {one-sentence purpose description}
  - ...
Scripts (must use complete commands):
  - node {SKILL_DIR}/script/fill-html-head.mjs ... (if HTML skeleton generation needed)
Input data:
  - {necessary context data}
```

Where `{SKILL_DIR}` = the installation directory path of this skill.

> **[CRITICAL] Free-explore style continuity payload**
>
> In no-Library / `free-explore` multi-turn projects, if the current project has `project.styleContinuityAnchors`, every page-generation or page-editing Sub-Agent task **must explicitly include the expanded anchors in the task input**. Passing only `orchestrationSummaryPath`, "follow the summary", or "keep the same style" is insufficient — Sub-Agents may optimize around the immediate edit and drift visually. The task may still include `orchestrationSummaryPath` for full context, but it must not be the only carrier of historical style constraints.
> Required payload template: `operation-policies/orchestration-summary.md` §Free-Explore Continuity Anchors Payload.

> **\[FORBIDDEN] Path abbreviation**
>
> When dispatching tasks to Sub-Agents, the Main Agent **must expand `{SKILL_DIR}` to the actual absolute path**. Bare file names (`Read html-implementation.md`, `Use fill-html-head.mjs`) are forbidden — always write `Read {expanded absolute path}/operation-policies/html-implementation.md` and `node {expanded absolute path}/script/fill-html-head.mjs {parameters}`.
>
> **Reason**: Sub-Agents do not know where the Skill directory is. If the Main Agent only passes file names, Sub-Agents will search in the project directory, causing "constraint file not found" errors. This is a known high-frequency failure pattern.

***

## Flow Routing

### Execution Steps

1. **Read decision rules**: First read `{SKILL_DIR}/operation-policies/decision-rules.md`, complete pre-execution preparation (determine project path, device type, request type)
2. **Route to corresponding flow**: Read the corresponding flow file according to the table below and execute

### Routing Table

> Detailed determination conditions and behavior descriptions for each request type are in `decision-rules.md` "Request Type Decision Table". Only the routing mapping is listed here.

| Condition | Flow File |
| --------- | --------- |
| Create new project | `{SKILL_DIR}/workflows/create-project.md` |
| Edit existing project | `{SKILL_DIR}/workflows/edit-project.md` |
| Modify Design Tokens / Explore new styles | `{SKILL_DIR}/workflows/customize-theme.md` |
| Change UI / Redesign UI / Optimize interface | `{SKILL_DIR}/workflows/redesign-ui.md` |
| Generate page variants / Multi-scheme comparison | `{SKILL_DIR}/workflows/generate-variants.md` |

Reusable Design Library / Design System creation is out of scope for `solo-design`; route that intent to `design-library-creator`. If the user is creating pages with custom brand colors, fonts, or style parameters, use `create-project.md`; if applying a new visual direction to an existing design project, use `customize-theme.md`.
