# Key Decision Rules (Main Agent Reference)

> **Companion files** (must read alongside this file):
> - `operation-policies/user-facing-language.md` — **[Must read every time]** All user-facing output language constraints, forbidden terms, Step Title Mapping, Canvas-First principle, forbidden/allowed questions
> - `operation-policies/creative-direction.md` — **[Read when routing to create-project or generate-variants]** Design Thinking Framework, Soul Injection, Anti-Convergence, style option generation constraints

| Section | Description |
|------|------|
| Request Type Decision Table | Decision matrix routing user request types to corresponding workflows |
| Page Information Density Type Assessment | Identification signals for information-dense / showcase / task-driven page types (classification only) |
| Design Library Style — Restraint Mode Detection | Detect Library visual characteristics and pass boolean flag to Sub-Agents |
| Pre-Execution Preparation | Pre-requisite information (project path, device type, operating mode, Library detection) to determine before executing any workflow |
| Wiring Strategy | Trigger conditions and topology constraints for canvas node wiring |

## Existing Project Default: Add, Do Not Overwrite

When an existing design project is matched, treat every current page, selected
page, selected element, xpath, `design_page`, current canvas focus, or referenced
page as **source context only** by default.

The default action is to create a new comparison page that inherits the source
page and applies the requested change there. This includes requests phrased as
"改", "修改", "调整", "优化", "加", "增加", "点击后", "交互", "状态",
"按钮", "这一块", "这个元素", "change", "modify", "adjust", "improve",
"add", "on click", or similar.

Directly modifying the original page is allowed only when the user explicitly
requests in-place overwrite, using wording such as "直接修改当前页", "在原页面改",
"覆盖原页面", "替换当前页面", "不要新增页面", "不需要对比页",
"modify in place", "overwrite", "replace current page", or "do not create a new page".

Selection is never an in-place signal. A selected element/xpath only identifies
which source page/region the new comparison page should preserve and change.

## Request Type Decision Table

> **User instructions take priority**: The decision rules below apply to default routing judgment when the user **has not explicitly specified an approach**. When the user directly states in their message what to do, which flow to follow, or which step to skip, directly comply with user instructions without being bound by the table below.

| User Request Type | Behavior |
|-------------|------|
| Vague request ("make it look better") — **no existing project** | Follow `design-library-parsing.md` "Theme Source Priority": in Library-Bound mode use Library directly; in Free Explore mode **AskUserQuestion** to let user choose style → create new project |
| Vague request ("make it look better") — **existing project** | If a current/selected/source page is available → Quick Path A1 (default comparison-page rule, see above). Route to `workflows/customize-theme.md` only when the user clearly asks for an overall/project-wide style or token change. |
| Explicit style ("Apple minimalist") — **Library-Bound Mode** | Check if the style request conflicts with Library constraints. If conflict → explain and ask whether to override (per SKILL.md "Library-Bound Mode" priority). If no conflict or user confirms override → execute |
| Explicit style ("Apple minimalist") — **Free Explore Mode** | Style description serves as highest-priority guidance for brand CSS generation → orchestrate sub-tasks directly |
| Custom theme ("create theme with brand color #FF6B00") | → `workflows/customize-theme.md` (update colors_and_type.css in-place + re-apply head to all pages) |
| User provides brand colors/fonts/parameters AND wants to create pages | → `workflows/create-project.md` (Step 1 Style Selection handles custom brand CSS derivation) |
| Create reusable Design Library / Design System / "沉淀设计风格" (no page creation intent) | → **Out of scope for solo-design**. This skill creates pages, not libraries. The user should use the `design-library-creator` skill for this intent. |
| Modify specific color/font/spacing as a project-wide style/token change | → `workflows/customize-theme.md` (modify brand CSS variables in-place + re-apply head to all pages). If it targets a current/selected/existing page and lacks explicit in-place wording → Quick Path A1 (default comparison-page rule, see above). |
| Explore new theme/change style/try different colors (existing project) | → `workflows/customize-theme.md` (update colors_and_type.css in-place + run `fill-html-head.mjs --replace-head` on all existing pages; must not rewrite HTML structure and content) |
| Modify UI / redesign UI / optimize interface (existing project) | → Quick Path A1 (default comparison-page rule, see above). Use `workflows/redesign-ui.md` fork copy only when the user explicitly asks to regenerate/replace a full project or create a separate redesigned copy. |
| Single component / fragment design ("做一个弹窗", "设计一个 404 页面", "做个 toast 提示", "一个卡片组件") | → `workflows/create-project.md` **Fragment Mode**: Skip style inquiry (derive minimal brand CSS from user context or use neutral defaults); create single-page project with `deviceType` inferred from component type (modal/toast → 'mobile' or 'desktop' per context); Sub-Agent focuses entire page budget on the single component with maximum detail and states. **Identifying signals**: user mentions exactly 1 component/page, no multi-page flow, no site-level scope words ("网站"/"官网"/"平台"/"系统") |
| Single component / fragment addition to **existing** project ("再做个弹窗", "加个 404 页面", "补一个 toast") | → `workflows/edit-project.md` **Quick Path A** — treat as single page addition; skip style inquiry; inherit existing project's brand CSS and device type; page content focuses entirely on the single component with maximum detail and interaction states. **Distinction from fragment-in-new-project**: here an existing `.design` project was matched; the original "Fragment Mode" row above only applies when no existing project exists |
| Interaction changes visible page state in a new design ("两个tab切换", "tab1为...", "点击后展示...", "搜索后", "筛选后", "打开弹窗/抽屉", "展开详情", "loading/empty/error state", "step 1/2") | → `workflows/create-project.md` **Interaction-State Expansion**: generate one canvas page per meaningful visual state. **[MANDATORY] Use stateGroup mechanism**: assign shared `stateGroupId`, mark one page as `stateRole: "base"` and others as `stateRole: "derived"` with `derivedFromHtmlSrc` pointing to base HTML. Base page MUST be generated first; derived pages MUST copy base HTML byte-for-byte then edit only `mutableRegions`. [FORBIDDEN] Generating state pages as independent full-page tasks or dispatching them in parallel without base page completion. Do not hide requested visual states inside one HTML page with JS-only switching. |
| Based-on / reference existing page intent — **existing project** | → `workflows/edit-project.md` **Quick Path A0 — Based-on Add Page** (default comparison-page rule, see above; based-on trigger words per `SKILL.md > Immediate Routing Guards`). Create a new comparison page that uses the referenced page/design as source context; do **not** overwrite or modify the referenced old page. |
| Page-level or element-level change to current/selected/existing page (incl. selected element/xpath edits) — **existing project** | → Quick Path A1 (default comparison-page rule, see above), unless explicit in-place wording exists. Generate a new page that inherits the source page context, so the canvas shows before/after comparison. |
| Request specific components (navbar, cards, etc.) | Use theme Token mapped to brand CSS variables in page generation sub-tasks |
| Provide reference image/URL/ZIP/HTML/PDF | First read `operation-policies/reference-material-handling.md`, produce Reference Material Context, then route by project state: no existing project → `workflows/create-project.md` Step 0.5; existing project → `workflows/edit-project.md` or `workflows/redesign-ui.md` depending on user intent |
| Request page variants/multiple options/try different layout (single page focus, **existing project**) | → `workflows/generate-variants.md` (generate 2~3 layout variants for user-specified pages only, **do not add themes, do not copy other pages, do not delete or modify existing content**) |
| **Request multiple distinct styles / "give me N different styles" / "try completely different directions" — existing project (multi-style exploration, Free Explore Mode)** | Use `workflows/generate-variants.md` only for layout/structure variants under the current CSS. If the user explicitly asks for different visual styles, use the **Multi-Style Existing Project Path** in `workflows/generate-variants.md`, which permits temporary `colors_and_type-variant-{N}.css` files and separate comparison groups without modifying original pages |
| **Request multiple distinct styles / "give me N different styles" — no existing project (multi-style exploration, Free Explore Mode)** | → `workflows/create-project.md` **Multi-Style Exploration Path**: derive 2~3 dramatically different style directions, generate independent brand CSS for each, create full project with multiple style versions. See `create-project.md` "Multi-Style Exploration Path" section |
| Delete page(s) from an existing project | → `workflows/edit-project.md` Delete Page Path: delete HTML, remove page nodes, clean incoming/outgoing interactions, then validate with expected page count |
| Adopt / promote a draft, redesigned copy, or generated variant | → `workflows/edit-project.md` Adopt Variant/Draft Path: replace or keep originals per user choice, migrate required interactions, and validate |
| Add navigation entry to existing pages / connect new page from navbar | → `workflows/edit-project.md` Add Navigation Path: update relevant HTML anchors with `data-dom-id`, then Main Agent registers `.design` interactions |
| Refresh / update existing project to newer Design Library | → `workflows/edit-project.md` Refresh Design Library Path: re-resolve Library constraints, re-apply head, and review component conformance |
| User selected a Design Library (conversation context contains Library message block) | Set `operatingMode: 'library-bound'` → Parse Library Token in pre-execution preparation → route to corresponding workflow (create/edit/customize theme) based on user's specific design request, use Library Token throughout to determine brand CSS |
| Micro-edit ("change button color to red" / "改一下按钮颜色") — single token-level change, existing project | → Quick Path A1 (default comparison-page rule, see above). Use **Quick Path C** only when the user explicitly asks to modify the existing page in place or says not to add a new page. |
| Device conversion ("convert to mobile" / "做成手机版") — existing project | → `workflows/redesign-ui.md` with new target `deviceType`; Fork copy inherits brand CSS but rebuilds layout for new viewport |
| Pure accessibility / SEO enhancement ("improve a11y" / "优化无障碍") — existing project | → `workflows/edit-project.md` Modify existing pages path: Sub-Agent focuses on semantic HTML, ARIA, heading structure, alt text; visual layout changes are minimal |

> **Quick Path C vs customize-theme disambiguation**:
> - User mentions **specific element** on a **specific page** and explicitly asks to update/overwrite that page in place → Quick Path C (e.g., "直接把首页的按钮颜色改掉", "不要新增，改 hero section 字号")
> - User says **generic property** without page/element scope → customize-theme (e.g., "把颜色改一下", "字体换成 Inter", "调一下间距")
> - User says "all pages" / "全部" / "整体" / "所有页面" → always customize-theme
> - When ambiguous and an existing/current/selected page is available → **default to comparison page** (safer for visual comparison); when the user clearly asks for a project-wide token change → customize-theme.

---

## Page Information Density Type Assessment (Classification Only)

> **Detailed implementation strategies** are in `operation-policies/page-density-strategy.md` (Sub-Agent scope). The Main Agent only needs to **classify** each page and pass the label to Sub-Agents.

Before dispatching page sub-tasks, assess each page's **information density type** and pass the classification label:

| Type Label | Identification Signals | Typical Scenarios |
|------------|----------------------|-------------------|
| `information-dense` | First screen simultaneously contains identity info + asset summary (numeric metrics) + action entries | Personal center, Membership center, Order list, Settings, Benefits |
| `showcase` | Page primarily focused on narrative and attractiveness; no heavy data or forms | Brand promotion, Campaign landing, Product introduction |
| `task-driven` | Contains control areas (input/selectors) + read-only summary, leading to a single submit button | Checkout, Form wizards, Configuration pages |

**Dispatch requirement**: When distributing sub-tasks, the Main Agent must pass `pageType: "{type}"` to each Sub-Agent. Sub-Agents read `page-density-strategy.md` for the corresponding implementation strategy.

---

## Design Library Style — Restraint Mode Detection (Main Agent Only)

> **Detailed layout adjustment rules** are in `operation-policies/page-density-strategy.md` (Sub-Agent scope). The Main Agent only needs to **detect** whether restraint mode should be triggered and pass the boolean flag.

When reading Library Tokens, check whether the Library exhibits **2 or more** of these visual characteristics:

| Visual Characteristic | Quantified Threshold |
|----------------------|---------------------|
| Border radius approaching 0 (square hard edges) | `default border-radius ≤ 4px` in css.json |
| Monospace/technical-feel font as primary font | `font-family` value contains `mono`, `code`, `courier`, `consolas`, or equivalent |
| High-contrast borders (significant difference between border color and background color) | Library css.json declares explicit border tokens whose color visibly contrasts with the background (different hue family, or clearly darker/lighter HEX rather than a near-background tint), or the Library declares an explicit contrast/density intent |
| Compact component language (small padding, tight line-height) | `body line-height ≤ 1.35` OR `base padding ≤ 12px` |

**If 2+ characteristics detected**: Pass `libraryRestraintMode: true` to all Sub-Agents. Sub-Agents will read `page-density-strategy.md` "Restraint Mode" section for layout implications.

**If fewer than 2**: Pass `libraryRestraintMode: false` (or omit). Standard layout density applies.

---

## Pre-Execution Preparation

Before executing any workflow, determine the following information:

- **Operating Mode**: Determine `operatingMode` based on Design Library presence (see SKILL.md "Operating Mode" section):

  | Detection Result | Mode | Downstream Impact |
  |-----------------|------|-------------------|
  | `<referenced_design_library>` or `<editing_design_library>` XML block exists in context, OR existing project uses Library-bound CSS | `'library-bound'` | Library constraints > user design preferences; conflicts require user confirmation to override |
  | No Library detected (neither selected nor project-bound) | `'free-explore'` | User instructions > all defaults; multi-style requests trigger Differentiation Mandate |

  **Pass `operatingMode` to all Sub-Agents** when dispatching subtasks. This label affects Sub-Agent behavior:
  - `'library-bound'`: Sub-Agent must strictly follow Library Token names, component HTML References, and ui_kits layout patterns. Deviation is forbidden.
  - `'free-explore'`: Sub-Agent has creative freedom. When generating variants, must satisfy Differentiation Mandate (≥ 2 structural dimensions differ between variants).

- **Design project path**: Determine the absolute path of the design project directory from user message or workspace context. Multiple design projects (multiple `.design` files) may exist in the workspace; combine with user intent to determine which project it corresponds to. Steps:
  1. Scan all `.design` files in the workspace to obtain existing design project inventory
  2. Combine project name, path, and contextual clues from user message to attempt matching an existing project
  3. If unique match → use that project path; if no match → treat as creating new project; if multiple candidates → use **AskUserQuestion** to have user explicitly choose
- **Device type**: Confirm the user's expected canvas device type, which affects the render width/height of all page nodes. Defaults to `'desktop'` when user does not specify. Valid values: `'desktop'` | `'mobile'` | `'tablet'` | `'freeSize'`.

  **Auto-inference rules** (when user does not explicitly specify device type):

  | Signal in User Message | Inferred Device Type |
  |------------------------|---------------------|
  | "App"、"移动端"、"手机" | `'mobile'` |
  | "iPad"、"平板" | `'tablet'` |
  | "网站"、"官网"、"landing page"、"PC" | `'desktop'` |
  | "小程序"、"微信小程序"、"mini program" | `'mobile'` + mark affected pages with `miniProgramStyle: true` |
  | "适老化" (elderly-friendly) | `'mobile'` (larger touch targets) |
  | "Dashboard"、"后台管理"、"数据大屏"、"BI 大屏"、"数据看板" | `'desktop'` (+ `dashboardMode: true` for dashboard signals — see "Dashboard Mode Detection" below) |
  | No clear signal | Default `'desktop'` |

  ### Dashboard / Data Screen Mode Detection

  | Signal in User Message | Handling |
  |------------------------|----------|
  | "大屏"、"数据看板"、"Dashboard"、"数据大屏"、"BI 大屏"、"monitor"、"监控大屏"、"data screen" | `deviceType: 'desktop'` + `dashboardMode: true` at project level |

  **Automatic decisions when dashboardMode is active**:
  - Set `chartsRequired: true` for all pages by default (individual pages may override to false)
  - Recommend `<html class="dark">` (dark theme suits projection/screen environments); confirm via AskUserQuestion
  - Write `dashboardMode: true` to `orchestration-summary.json` at project level (Sub-Agents read this from page-generation-template.md Phase 1b context)

  **[NOTE]** "后台管理" (admin console) does NOT equal Dashboard — admin console is standard desktop. Only activate dashboardMode when user explicitly mentions "大屏" / "看板" / "Dashboard" / "data screen" keywords.

  **App Design Scope Clarification**: When user requests "App design", the output remains HTML mockup pages (`.design` canvas format). The Agent creates mobile-viewport pages that simulate App screens — NOT native code. If user seems to expect native development output, clarify scope once: "I'll create visual design mockups for your App screens using our design canvas."

  **Multi-Device Detection & Auto-Split**: When user requirements simultaneously involve **two or more clearly distinct device types** (e.g., "App + 管理后台", "小程序 + PC 承接页", "Android App + server-side admin console"), the Agent must:

  1. **Detect**: During Phase 1 Structured Extraction, identify if the Page Inventory contains pages targeting different device categories:
     | Category A (Mobile) | Category B (Desktop) |
     |---------------------|---------------------|
     | App screens, 小程序页面, mobile H5 | Admin console, Dashboard, 后台管理, PC 承接页 |

  2. **Split into two independent projects**: Create two separate `.design` projects with different `deviceType` settings:
     - Project 1: `deviceType: 'mobile'` — contains all mobile/App/小程序 pages
     - Project 2: `deviceType: 'desktop'` — contains all desktop/admin/dashboard pages

  3. **Shared visual constraints**: Both projects share the same `colors_and_type.css` (brand CSS) to ensure visual consistency. The brand CSS file is generated once and copied to both project directories.

  4. **Execution order**: Generate the mobile project first (typically the user-facing product), then the desktop project (typically the admin/backend). Inform user: "Your requirements span two device types, so I'll create two design projects: one for {mobile description} and one for {desktop description}."

  5. **Page allocation**: Use Phase 1 extraction to classify each page into its target device category. If a page is ambiguous, default to the device type inferred from its content:
     | Content Signal | Assign to |
     |---------------|-----------|
     | User-facing product flow (learning, shopping, registration) | Mobile project |
     | Data management, content management, order management | Desktop project |
     | Ambiguous (e.g., "settings page") | Same device as its parent flow |

  6. **Page Cap per project**: Each sub-project independently applies the standard Page Cap rules from `long-requirement-parsing.md`. The combined total across both projects can exceed the single-project cap.

- **Responsive scope (hardcoded default — do NOT ask)**: All pages default to **desktop + tablet + mobile** responsive layout. The generated HTML must include Tailwind responsive breakpoints (`sm:`, `md:`, `lg:`) to ensure proper rendering across all three device classes. This is NOT a question to ask the user.

  | Scenario | Behavior |
  |----------|----------|
  | Default (no user instruction) | Generate fully responsive HTML: mobile-first base + `sm:` / `md:` / `lg:` breakpoints |
  | User explicitly says "仅桌面端" / "desktop only" / "不需要移动端" | Respect user instruction — generate desktop-only layout |
  | User explicitly says "仅移动端" / "mobile only" / "只做H5" | Respect user instruction — generate mobile-only layout |
  | `dashboardMode: true` | Fixed viewport layout (existing exemption applies) |

  **[FORBIDDEN]** Asking the user "响应范围" / "responsive scope" / "breakpoints needed" — this is a solved default.

- **Design Library detection**: Scan conversation context to check whether an XML-tagged Design Library block exists, or if the user directly provided Token configuration (HEX color values, fonts, border-radius, and other design parameters) in conversation. Steps:
  1. **Detect Library XML block**: Search context for `<referenced_design_library>` or `<editing_design_library>` blocks containing `intent`, `name`, `id`, and `path` fields
  2. **Detect user-provided Tokens directly**: Identify specific design parameters in user messages (e.g., "primary color #1a1a2e", "font Inter", "border-radius 12px")
  3. **Read spec file**: If a Library XML block is detected, extract the `path` field from it and read that spec file (brand CSS or Design Library directory) content
  4. **Build Token constraint set**: Organize Library spec file or user-provided Token parameters into a structured constraint set, mapped to brand CSS variables in subsequent steps. Must specifically identify the color protocol used by Token values (HEX, OKLCH, HSL, RGB, etc.); subsequent mapping and HTML generation must preserve the original protocol format — conversion is forbidden. Complete mapping rules in SKILL.md "Design Library and Token Constraints" section
  5. **Error handling**: When spec file does not exist/is empty/has invalid format, inform user and ask whether to fall back to default style derivation workflow
- **Output format is fixed**: This skill's output format is the canvas-prescribed fixed structure — `.design` entry file + `pages/*.html` (Tailwind CDN) + brand CSS file + `assets/`. It is **absolutely forbidden** to ask the user any questions related to technical format, delivery form, or framework selection. See `user-facing-language.md` "Forbidden Questions" list.

### Insufficient Context Detection (Vague Input Guard)

Before routing to any workflow, assess whether the user's input provides minimum actionable context:

| Minimum Required | What counts |
|------------------|-------------|
| **What to build** | At least 1 of: industry/domain, product type, page purpose, or specific page name |
| **Who it serves** | At least 1 of: target audience hint, user persona, use case |

**Detection rule**: If user input is < 80 characters AND neither "What to build" nor "Who it serves" is determinable AND no reference materials are attached → trigger Discovery Questions.

**Discovery Questions** (via AskUserQuestion, max 1 round, max 2 questions):

| Question | Purpose | Example Options |
|----------|---------|-----------------|
| "This is for what type of product/business?" | Establish domain → enables tone derivation + content generation | "电商/品牌官网/SaaS产品/个人作品集/其他" |
| "Who is the primary user?" | Establish audience → affects visual complexity + copy tone | "普通消费者/企业客户/内部员工/开发者" |

**After receiving answers**: Proceed normally — the answers provide enough context for Design Thinking Framework to derive Tone + creative direction.

**[IMPORTANT]** Discovery Questions are triggered ONLY when input is genuinely unactionable. If user provides even one concrete signal (e.g., "做个咖啡店网站" — has industry), skip Discovery Questions and proceed directly. The threshold is deliberately low to avoid over-questioning.

**[FORBIDDEN]** Asking Discovery Questions when:
- User provides reference materials (screenshot/URL = implicit direction)
- User mentions specific pages or features (= has content plan)
- User specifies style/mood keywords (= has visual direction)
- Input > 80 characters (= likely has embedded context)

### Large File Read Strategy

- When any file read returns "exceeds the limit of 64KB" error:
  1. **Do not retry full-file read** (maximum 1 attempt per file)
  2. Immediately switch to `offset` + `limit` segmented read strategy
  3. If the file has a structured alternative (e.g., `css.json` as alternative to `colors_and_type.css`), use the alternative directly
  4. Mark the failed file as "path reference only" and do not attempt to read content again

---

## Wiring Strategy

Complete rules in `operation-policies/wiring-strategy.md`. Quick assessment: wire only when **creating a new canvas project** or when the **user explicitly requests it**; do not wire in other scenarios (adding pages, exploring styles, generating variants, Fork copies). Exception: pages carrying `supersedesPageId` trigger mandatory Version Convergence (redirect incoming edges to the newest version, clear the superseded page's outgoing interactions) — see `operation-policies/wiring-strategy.md` "Version Convergence".

**Default topology: linear single chain** — visible canvas wiring connects pages end-to-end in logical order, each page has exactly 1 visible exit, the last page has 0 visible exits. Total visible wiring count for the project ≤ number of pages. Absolute upper limit per page is 2 visible exits (allowed only when the business flow genuinely branches). Back / return controls, global nav, breadcrumbs, secondary CTAs, and skip links such as Page 1 → Page 3 may navigate with `hideEdge: true` interactions and must not create visible reverse or shortcut edges. Full DAG constraint, exit limits, hidden interaction rules, and topology rules → see `operation-policies/wiring-strategy.md` "Map Principles".

---

## Operating Mode — Priority Scenarios

> Referenced from `SKILL.md` "User Instruction Priority (Mode-Dependent)". Main Agent reads this section during execution to determine correct behavior when user instructions interact with Library constraints or Skill defaults.

### Library-Bound Mode — Design Library Prevails

When a Design Library is active, **Library design constraints take precedence over user design preferences**. The rationale: the user (or their organization) has deliberately chosen a design system to ensure visual consistency and brand compliance.

| Scenario | Correct Behavior |
|------|---------|
| User's design preference conflicts with Library constraint (e.g., "use blue" but Library brand color is orange) | **Default: follow Library.** Briefly explain: "The design system specifies [X] for this — shall I follow the system (recommended) or override with your preference?" If user insists on override → execute their preference for that specific field only |
| User requests something the Library does not constrain (e.g., "add a testimonial section" — Library has no opinion on content structure) | Execute directly; Library constraints only govern visual parameters they explicitly define |
| User's request is a functional/content requirement, not a design preference (e.g., "add a pricing page", "make the CTA more prominent") | Execute directly — interpret within Library constraints. "More prominent CTA" means using Library emphasis tokens, not inventing new colors |
| User explicitly requests to override the Library (escape hatch) | Switch to Free Explore Mode for current request |
| User requests skipping a validation step or violating a rendering/file-validity constraint | Do not silently skip. Explain that the step is required for a valid canvas result, and ask whether to continue with a safe equivalent |

**Override granularity**: When a user explicitly overrides a Library constraint, the override applies **only** to the fields they specified. All other design decisions remain Library-bound. Example: if user overrides brand color but says nothing about fonts, fonts remain per Library spec.

### Free Explore Mode — User Instructions Prevail

When no Design Library exists, **user instructions take full precedence** over all Skill defaults and recommended best practices.

| Scenario | Correct Behavior |
|------|---------|
| User explicitly requests a specific layout, color scheme, component structure, or file operation | Execute directly as requested; Skill aesthetics norms serve as defaults only when user has not specified |
| User's requested approach differs from Skill-recommended best practices | Execute user's request; if there is potential quality risk, a **one-sentence** risk note is acceptable, but the user's choice prevails |
| User requests skipping an optional style inquiry or recommendation step | Skip directly; must not insist on asking or executing by citing "process requirements" |
| User requests multiple style explorations ("give me 3 different styles") | Generate **dramatically different** variants — see `generate-variants.md` "Differentiation Mandate" for rules |
| User requests skipping a validation step or violating a rendering/file-validity constraint | Do not silently skip. Explain that the step is required for a valid canvas result, and ask whether to continue with a safe equivalent |

**Principle**: In Free Explore Mode, Skill norms serve as the Agent's decision basis **when the user has not explicitly specified**; they are not rigid barriers limiting user choice. Required output-validity, rendering, and safety constraints remain binding because violating them prevents the deliverable from working.
