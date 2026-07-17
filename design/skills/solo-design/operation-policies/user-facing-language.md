# User-Facing Language Constraints (Main Agent — Must Read Every Time)

> **This file governs all user-visible output**: conversation messages, TodoList titles, progress reports, thinking output, summaries. Internal technical implementation details must never be exposed.

---

## [FORBIDDEN] Technical Terms in User Communication

| Forbidden Technical Terms | User-Friendly Replacement |
|-------------------|---------------------|
| "设计库" (Chinese user-visible text only) | **"设计系统"** — always; e.g., "把 Volcengine 设计系统作为风格约束", "确认设计系统可用". English text keeps "Design Library" unchanged |
| "规范包" / "压缩包" / "bundle" / "ZIP" / "解压" | Do not mention packaging or parsing mechanics; say "你上传的设计规范" or omit |
| `.design` file / `.design` entry file | "design project", "canvas" |
| `.theme` file / brand CSS / colors_and_type.css | "design style", "theme colors" |
| `data` array / page node | Do not mention; describe as "pages" |
| `devMetadata` / `htmlSrc` / `sourceId` | Do not mention |
| `HTML page` / `Tailwind CDN` | "page", "design page" |
| Flow A / Flow B / Flow C / Flow D | Do not mention flow identifiers; directly describe what will be done |
| Validation script / production gate / 17-item check | Do not mention; execute silently in the background |
| Sub-Agent / Main Agent / parallel generation | "I'm designing for you...", "Starting to create..." |
| `canvas` / `SDK` / canvas editor | "design canvas", "canvas" |
| JSON / entry file / directory structure | Do not mention |
| Token / brand CSS variable / Design Token | "design style", "color scheme", "visual parameters" |
| interactions / wiring registration / wiring map | "configuring page navigation" |
| production gate / gate validation / validate | "checking", or do not mention (execute silently in the background) |
| pageIndex / group number / data array | Do not mention |
| Fork copy / Fork project | "creating a backup version" |

---

## [FORBIDDEN] Internal Strategy Leaking to User-Visible Output

The following information is the Agent's **internal orchestration strategy** and is forbidden from being exposed in any user-facing output format:

| Forbidden to Expose | Correct Alternative |
|---------|---------|
| Image budget allocation scheme ("total budget = page count × 3 = 9 images", per-page allocation quantities) | "Preparing visual assets for each page" |
| Budget planning process details (Method A/B, budget consumer concept) | Do not mention budget concepts; only report generation progress |
| Sub-Agent dispatch strategy (parallel/serial, task splitting logic) | "Generating N pages" |
| Technical structure of wiring mapping table (`data-dom-id`, `targetPageId`, `interactions`) | "Configuring navigation between pages" |
| `.design` file internal fields (`canvasData`, `pageIndex`, `group`) | Do not mention technical field names |
| Internal workflow step titles (Step 3.5, production gate, node registration, Token construction) | Use user-friendly titles from "Step Title Mapping Table" below |
| Technical verbs (parse, construct, Fork, register, dispatch, map, validate, append) | Use design-domain verbs (confirm, prepare, design, configure, complete, apply) |

**Principle**: The user only needs to know "what is being done" and "how much is done", not "how resources are allocated" or "how internal orchestration works".

---

## [FORBIDDEN] Language Constraints for Task Planning and Progress Display

When the Agent uses TodoWrite or similar tools to create task lists, **each task title must use natural language from the user's perspective**, describing "what the user will see as a result", not "what technical operation the Agent is performing internally".

### Step Title Mapping Table

| Internal Step | [FORBIDDEN] Exposed to User | [CORRECT] User-Visible Title |
|---------|----------------|-----------------|
| Parse Design Library Token constraints, determine brand CSS | Forbidden | Confirm design style |
| Project initialization: create directory structure, theme file and .design canvas entry | Forbidden | Prepare design project |
| Image pre-generation: distribute sub-tasks in parallel to generate image assets | Forbidden | Prepare imagery for each page |
| Generate N pages in parallel (page names A, B, C) | Forbidden, do not expose "parallel" | Design pages (page names A, B, C) |
| Page order rearrangement + wiring registration | Forbidden | Configure page navigation |
| Production gate validation | Forbidden | Final check |
| Production gate validation & guide preview | Forbidden | Done, ready for preview |
| Update .design file / register nodes | Forbidden | Do not display separately, merge into previous step |
| Fork project copy + shift files | Forbidden | Create backup version |
| Update brand CSS / re-apply theme to pages | Forbidden | Apply new design style |
| Map source group wiring to new group | Forbidden | Sync page navigation |

### Naming Principles

1. **Use design language, not engineering language**: "Confirm color scheme" not "determine brand CSS"; "Configure page navigation" not "register interactions wiring"
2. **Describe user-perceivable results**: "Start designing homepage, product page, about page" not "distribute 3 sub-tasks in parallel"
3. **Hide purely technical operations**: Validation, file registration, node sorting — if a step does not produce a user-perceivable change, either merge it into an adjacent step or do not display it
4. **Avoid quantifying internal resources**: "Prepare imagery" not "plan to generate 12 images (3 per page × 4 pages)"

---

## [FORBIDDEN] Intermediate Output — Canvas-First Principle

> **The Agent's sole deliverable in design tasks is the canvas (`.design` project). Other than the AskUserQuestion calls listed in "Allowed Questions" below, the Agent must not output any "requires user review/confirmation to continue" intermediate text during the workflow.**

The following behaviors are absolutely forbidden:

| Forbidden Behavior | Correct Approach |
|---------|---------|
| Output a "requirements understanding" or "solution description" paragraph, waiting or implying user confirmation | Execute directly; present page structure in Step 5 deliverables table |
| Output brand CSS variables or Design Tokens in conversation for user to "review" or "confirm" | After Main Agent internally determines brand CSS, proceed directly to Step 2 without displaying technical details in conversation |
| Output a page planning table (page names + descriptions) and pause before generation, waiting for user confirmation | Proceed directly to Step 2 initialization; page planning is completed internally |
| Output Markdown structured content "for user reference" then pause | Execute directly; reference information is presented in Step 5 completion summary |
| Write an analysis/planning statement first, then wait for user reply before starting execution | AskUserQuestion is only used for style selection; after confirmation, execute immediately without additional output |

**Core Principle**: User submits design request → Agent makes at most one style selection inquiry (AskUserQuestion) → directly starts generating canvas. Any "analyze → confirm → then execute" loop before canvas generation is unnecessary friction and must be eliminated.

---

## Forbidden Questions (Hard Rules)

The following questions are **absolutely forbidden** from being asked to the user via AskUserQuestion or any other means, because the answers are already fixed by this skill:

- "What delivery format would you prefer?" (delivery format is fixed as `.design` project)
- "HTML or React?" (technical format is fixed as HTML + Tailwind CDN)
- "What framework do you need?" (no framework selection involved)
- "What is the output format?" (output structure is already fixed)
- "Should I generate code or a design?" (it is always a design)
- "Should I start a server for preview?" (can be started directly without asking; see `operation-policies/output-delivery.md` "Preview Method" section)
- "What responsive scope / breakpoints do you need?" / "响应范围？" / "需要适配哪些端？" (default is always desktop + tablet + mobile; see `decision-rules.md` "Responsive scope" section)

---

## Allowed Questions

Only the following types of questions may be asked to the user via AskUserQuestion:

- Style selection ("Which visual style do you prefer?")
- Content clarification ("What pages/sections should the website include?")
- Brand information ("What is the brand name/positioning/primary color?")
- Project selection (when multiple `.design` projects exist in workspace, "Which project would you like to edit?")
- Device type ("Is this a desktop or mobile design?")

---

## Artifact Naming Language Rule

All user-visible artifact names MUST use the user's most frequently used language (determined from the conversation history — the language appearing in the majority of user messages). File system paths (slugs, directory names) remain ASCII kebab-case for compatibility.

| Artifact | Language Rule | Example (Chinese user) | Example (English user) |
|----------|--------------|------------------------|------------------------|
| Project display name (host-rendered artifact title / `.design.name`) | User's language | `咖啡品牌官网` | `Coffee Brand Website` |
| `orchestration-summary.json` `project.name` | User's language | `"name": "咖啡品牌官网"` | `"name": "Coffee Brand Website"` |
| Page node `title` field in `.design` | User's language | `"title": "首页"` | `"title": "Home"` |
| Image node `title` field in `.design` | User's language | `"title": "主视觉"` | `"title": "Hero Main"` |
| Page summary table (Step 5) | User's language | 页面列"首页"、"产品介绍" | Page column "Home", "Products" |
| File path / slug / nodeId | ASCII kebab-case (unchanged) | `pages/index.html`, `page-index` | `pages/index.html`, `page-index` |

**Detection heuristic**: Count the language of all user messages in the conversation. The majority language is the "user's most frequently used language". When ambiguous (e.g., bilingual messages), default to the language of the **current** user message.

[FORBIDDEN] Using English-only titles when the user's language is non-English (e.g., naming a page "Home" when the user communicates in Chinese — use "首页" instead).

---

## AskUserQuestion Output Language

All AskUserQuestion fields displayed to the user MUST match the user's query language:

| Field | Language Rule |
|-------|--------------|
| `header` | Must use user's language (e.g., "视觉风格" not "Visual Style") |
| `question` | Must use user's language |
| `options[].label` | Must use user's language; English proper nouns may appear in parentheses as annotation |
| `options[].description` | Must use user's language |

[FORBIDDEN] Outputting English-only option labels/descriptions when user's query is in Chinese, even if the style names sound "more professional" in English.

Rationale: Users selecting design style must understand option semantics in their native language. Design terminology can be annotated bilingually but the primary text must be in the user's language.
