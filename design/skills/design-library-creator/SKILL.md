---
name: "design-library-creator"
description: "Create, expand, and refine Design Libraries. Supports bundle-based generation, from-scratch generation, component expansion, token/component refinement, and additional kit types. Also covers creating a new theme / color theme (创建主题/新建暖色主题/深色主题等 — a theme is a design-system deliverable: tokens + palette + component styling). Invoke when user wants to generate or modify a Design Library, or create a new theme when there is no existing .design project to restyle."
---

# Design Library Creator

## Read Order

| File | When | Purpose |
|------|------|---------|
| `SKILL.md` | Always | Route, role boundaries, invariants, create-library fast path |
| `workflows/{route}.md` | After routing | Full phase instructions for the selected route |
| `operation-policies/decision-rules.md` | Ambiguous route, component count decision, or call-budget self-check | Route classification, shortlist formula, call budget by route |
| `operation-policies/quality-gates.md` | Phase 5 | Final validator and acceptance criteria |
| `operation-policies/user-output-policy.md` | Any user-facing prose | Whitelist/blacklist for visible status text |
| `operation-policies/agent-orchestration.md` | Fallback/debug only | Non-fast-path routes, rejected Task format, missing template, orchestration debug |

> [FORBIDDEN] Main Agent MUST NOT pre-read sub-agent-only constraint files. Sub-agents receive those paths inside Task queries.

## Main Read Budgets (`create-library` route — other routes have own budgets in respective workflow files)

| Scope | Budget | Allowed Reads |
|-------|--------|---------------|
| Phase 1 entry | 1 | `{bundle_path}/INDEX` (routing entry — read FIRST, tells you what to read next and how to read JSONL files) |
| Phase 1 bundle scan | 1 | `{bundle_path}/generated/bundle-manifest.jsonl` only (retries not counted) |
| Phase 1 template preload | exactly 2 | `examples/templates/phase-2-analysts.md`, `examples/templates/figma-token-gen.md` |
| Phase 1 shortlist recovery | 1 + 1 Task | Monolithic component JSON header (limit: 250 lines) + splitter sub-agent (only when § 1.2 trigger conditions in `workflows/create-library.md` are met) |
| Phase 3 template read | 1 | `examples/templates/phase-2.5-intent-synthesis.md` (read at Phase 3 entry — source for FULL QUERY DISPATCH) |
| Phase 4a template preload | 1 | `examples/templates/phase-5-docs.md` (`phase-4-ui-kit.md` is read by the UIKit sub-agent only — Main Agent MUST NOT read it) |
| Phase 5 validation | separate | generated output only; MUST use validator script + targeted reads (no full-file re-reads) |

Hard stops (read-count scope — single definition: only reads of bundle files and intermediate `{tmp_dir}`/generated data files count; reads of skill templates/workflows and script stdout do NOT count):
- If Read count > 8 before first Phase 2 Task dispatch: stop reading and dispatch Phase 2 with current manifest data.
- If total bundle/intermediate Read count > 20: all later bundle/intermediate reads are forbidden.
- After Phase 2 returns: do not read raw bundle files. Brand return + Phase 1 manifest are the orchestration contract.
- Exception: If shortlist recovery is triggered (§ 1.2), the monolithic JSON read does NOT count toward the 8-read cap.

## Sub-Agent Scope

| Files | Assigned To |
|-------|-------------|
| `file-specs/css-tokens.md` | Refine/from-scratch/create-library token CSS generation |
| `file-specs/preview-pages.md` | Template authoring/incremental fallback; create-library Phase 3 uses intent + preview template |
| `file-specs/ui-kit.md` | UI Kit sub-agent |
| `file-specs/documentation.md` | Documentation sub-agents |
| `file-specs/design-library-output.md` | UI Kit/docs/non-inline generation sub-agents |
| `file-specs/design-spec-bundle.md`, deep `bundle-exploration.md` sections | Analyst sub-agents only |

## Protocol Actions

During Design Library generation, Main Agent submits artifacts to the runtime via the following protocol actions ONLY when the runtime tool list explicitly exposes an action/tool of the same name:

| Action | When | Params |
|--------|----------|------|
| `generate_skill_files` | After each Phase completes, submit that phase's generated files | `{ files: [{ path: string, role: string }] }` |
| `update_tokens` | Token system assembled (end of Phase 2) | `{ tokensExtracted: number }` |
| `update_components` | Component data exported (end of Phase 3) | `{ componentsAnalyzed: number }` |
| `complete` | Finalize session after all Gates pass | `{ stats: { tokensExtracted, componentsAnalyzed, filesGenerated } }` |

**Rules**:
- `generate_skill_files` `files[].path` uses paths relative to `{output_dir}`
- `complete` MUST be called only after all files are submitted and Quality Gate passes
- These actions are provided by the runtime; Main Agent calls them directly, sub-agents MUST NOT call them
- If these actions are NOT present in the available tools/actions, Main Agent MUST NOT fabricate calls or claim they were emitted.
- No-action fallback completion = generated files exist on disk + `validate-design-library-output.mjs` exits 0 + final response lists compact relative file summary.
- In no-action fallback mode, never mention `generate_skill_files`, `update_tokens`, `update_components`, or `complete` as executed actions.

## Critical Invariants

These override all workflow/template instructions.

1. Multi-file bundle: input is Markdown + SVG + binary bundle, not a single JSON.
2. Ground truth: token values come from data; brand narrative is inference.
3. UI Kit required (unless token-only bundle): `ui_kits/<type>/index.html` MUST be interactive React 18. Token-only bundles (per `decision-rules.md` § Token-Only Bundle Detection table) skip UI Kit and component generation.
4. External CSS only: all `preview/*.html` link `../colors_and_type.css`; never inline token CSS.
5. Brand-specific naming: color names use product prefix; never generic M3 defaults.
6. No placeholders: zero lorem ipsum, TODO, "Component A", or generic labels.
7. Output cleanliness: no sub-agent return JSON/paths/internals to user (see `user-output-policy.md`). Task/Sub-Agent final responses are user-visible; they MUST be short human status sentences, never machine contracts.
8. Dependency order: tokens → LLM intent + preview → docs → kit; never all-at-once.
9. Parallel via `Task` tool: In `create-library`, Phase 3 sub-agents write `components/{slug}.json` + preview HTML. In `create-from-scratch`/`create-from-structured-spec`, Main Agent writes component JSONs in Phase 2, and Phase 3 sub-agents write only preview HTML. Intent validation is advisory by default and must not trigger retry loops for schema warnings.
10. Main Agent write limit: no direct CSS/HTML/JSX/MD output. Allowed writes: `{tmp_dir}/phase2-brand-analyst.json`, `components/index.json` via deterministic aggregation, `components/{slug}.json` (all non-Figma creation routes: create-from-scratch/create-from-structured-spec/expand, per invariant #9), component metadata-level JSON updates in refine-library (see that workflow § Documentation and Markdown Changes), zip/package scripts.
11. Context distillation: Phase 3+ sub-agents read intermediate JSON/CSS directly, not raw bundle files.
12. TodoWrite HARD CAP = 4; never standalone. Allowed positions and detection rules are owned by each workflow's TodoWrite Policy section (workflow-specific caps take precedence, e.g., create-from-scratch CAP = 3).
13. Output hygiene: never expose absolute/intermediate paths, hex values, dispatch params, quality-gate internals, or retry details. User-facing terminology: Chinese text always says "设计系统" (never "设计库"); English text keeps "Design Library"; never mention 压缩包/规范包/bundle/解压/包结构/JSONL or any input-packaging mechanics — the user's input is simply "设计规范" / "design spec" (see `operation-policies/user-output-policy.md` § Terminology Rules).
14. Script-first validation/projection: Phase 5 MUST run `{SKILL_DIR}/scripts/validate-design-library-output.mjs`; non-zero exit blocks `complete`. JSON token projection MUST use `{SKILL_DIR}/scripts/css-to-json.mjs`, never LLM-written `css.json`.
15. Executable manifest paths only (create-library route): every path must execute as `{bundle_path}/{entry}`; bare names invalid. Abort on manifest failure — correctness owned by `bundle-generator/manifest-gen.ts`.
16. Sub-agent tool bans inherited: every Task query forbids `TodoWrite`, `Skill`, `Grep`, `RunCommand`, `SearchCodebase`, and read-back after Write unless template names an exception. `LS`/`Glob` are allowed only when the template explicitly scopes discovery paths (for example UIKit preview/evidence/icon discovery).
17. Phase completion sentinels: do not advance unless blocking sentinel in workflow has passed.
18. Intermediate file isolation: `{tmp_dir}` = `{hidden_tmp_dir}/{library_name}/`. MUST NOT be visible in user workspace. Delete after completion. This includes ALL temporary/helper scripts (`.py`, `.js`, `.sh`, `.mjs`, etc.) — they MUST be written to `{tmp_dir}`, NEVER to workspace root or any user-visible directory. Writing ANY file outside `{output_dir}` and `{tmp_dir}` is FORBIDDEN.
20. Phase 3/4 zero post-processing: After sub-agents return, Main Agent reads only `{tmp_dir}/agent-reports/*.json` completion contracts and collects `writtenFiles`. Reading or patching returned HTML/MD/CSS is FORBIDDEN. (Deterministic scripts reading files via RunCommand — e.g., `extract-components-css.mjs`, validators — are NOT covered by this ban.)
23. Sub-agent completion contract: every Task query MUST pass `ReturnReportFileAbs: {tmp_dir}/agent-reports/{phase}-{stable-task-id}.json`. Sub-agents write machine data there (`writtenFiles`, `warnings`, `stats`, and declared phase-specific fields; ≤4KB, one report per Task), then STOP with only a short user-safe sentence such as "已完成组件预览。". Do NOT return JSON, file paths, analysis, reasoning, suggestions, markdown tables, or stats in the final response.
24. **`.design` Project Relationship**: A `.design` project's `colors_and_type.css` is the token spec. Route "extract/distill/save design style" requests to `create-from-structured-spec`. This skill is the single owner of Design Library creation.
26. **Critical-File Guarantee + Controlled Stop Sequence**: `css.json` generation (via deterministic script) is UNCONDITIONAL. If `colors_and_type.css` exists but `css.json` does not → the session is in FATAL violation; the only fix is to run `css-to-json.mjs`. Whenever any rule tells Main Agent to stop (budget exhaustion, validator failure, sub-agent failure, any STOP signal), Main Agent MUST execute the **Controlled Stop Sequence** instead of halting instantly: ① if `colors_and_type.css` exists and `css.json` is missing/stale, run `css-to-json.mjs`; ② run the final validator once (skip if it already ran after the last file change); ③ emit a completion/partial-completion summary; ④ stop. No other actions (no file reads, no fix Tasks, no extra validator re-runs) are permitted inside the sequence.
27. **Token Input Gate** (create-library route): `{tmp_dir}/design-tokens.jsonl` MUST be copied from `generated/design-tokens.jsonl` and validated by `validate-token-input.mjs` (schema check, no old fields). If the Read tool returns a "exceeds the limit of 64KB" error, the token sub-agent MUST retry with offset/limit (e.g., offset=1 limit=5, then offset=6 limit=5) to read all JSONL lines, then generate CSS from the accumulated data. Do NOT report failure for oversized files — chunked reading is the standard recovery path.
28. **No Artifact Link in Summary**: Final user-visible summary MUST NOT contain any `computer://` link or directory path. The frontend will automatically render a Design Library card below the summary. Do NOT output links to README.md, UI Kit HTML, css.json, .zip, .design_library/, or other internal files.
30. **Non-Figma Creation Route Layering** (create-from-scratch / create-from-structured-spec routes only): both routes MUST execute in this order unless skipSet removes a dependent phase: `colors_and_type.css` → `css.json` → `components/{slug}.json` → `preview/component-{slug}.html` → docs → `uikit-plan.json` → UIKit → validation. Docs start only after previews finish; UIKit starts only after docs and `uikit-plan.json` exist.
31. **Shared Token Output Contract**: Every creation route MUST write `colors_and_type.css` according to `file-specs/css-tokens.md` and derive `css.json` with `scripts/css-to-json.mjs` according to `file-specs/css-json.md`. Sub-agents MUST NOT write `css.json` directly.
32. **Structured-spec alias contract** (create-from-structured-spec route only): Structured-spec routes preserve source token names/values in the CSS definition layer, but component JSON, previews, docs, and UIKit MUST prefer portable aliases from the same CSS file (`--color-*`, `--radius-*`, `--type-*`, and the consumer-facing variables required by `file-specs/css-tokens.md`).
33. **`metadata.json` is engineering-owned**: Agent (Main or sub) MUST NEVER create, write, modify, or delete `{output_dir}/metadata.json` in any route. It is written exclusively by the backend after server-side library registration. Missing `metadata.json` is NOT a defect — never generate one (no placeholder id/name/version). When duplicating a library directory, exclude it. See `file-specs/design-library-output.md` § System-Managed Files.
34. **Reasoning Budget / Write-First Execution**: Do not pre-draft large CSS/HTML/JSON/Markdown artifacts in hidden reasoning. Use required reads and template-mandated checks, then write. Preserve evidence reads, fidelity, UIKit quality, self-checks, post-write reviews, and validators. Put non-blocking uncertainty in `warnings[]`.

> **Relocated/removed rules**: #19, #21, #22 → `workflows/create-from-scratch.md` § OVERRIDE INVARIANTS. #25 (Call Guidance) → `operation-policies/decision-rules.md` § Call Budget by Route. #29 — removed (intentional gap; do not search for it).

## Route Table

| Condition | Workflow |
|-----------|----------|
| New Library from parsed bundle | `workflows/create-library.md` |
| New Library without bundle | `workflows/create-from-scratch.md` |
| New Library from structured token spec | `workflows/create-from-structured-spec.md` |
| Add components to existing Library | `workflows/expand-components.md` |
| Refine existing Library | `workflows/refine-library.md` |
| Add another kit type | `workflows/generate-additional-kit.md` |
| User requests regeneration of last output | Re-route to ORIGINAL workflow (not refine-library). See Redo Handling below. |

> **Token-Only Bundle**: A bundle containing only design tokens without UI components. Detection is owned by `operation-policies/decision-rules.md` § Token-Only Bundle Detection (check Shortlist Recovery triggers FIRST — `shortlist.length === 0` alone is NOT sufficient). In this mode: skip Phase 3, skip Phase 4 UIKit, generate only tokens + docs.

## Skip Set — Universal Opt-Out Mechanism

All creation workflows (`create-library`, `create-from-scratch`, `create-from-structured-spec`)
support a `skipSet` that allows users to opt out of optional phases.

### Design Principle
- **Default = FULL generation** (all capabilities of the route)
- **Opt-out only** — user must explicitly say "不要 X" to skip
- **Never opt-in** — agent does NOT ask "是否需要 X？" for standard phases
- **Data constraints override user**: if data is insufficient (e.g., Token-Only Bundle), skip regardless

### Signal Table

| User Signal | skipSet values |
|------------|----------------|
| "只要 token" / "不要组件" / "不生成 components" / "token-only" / "no components" | components, previews, uikit |
| "不要 UI Kit" / "不需要 kit" / "no kit" | uikit |
| "不要预览" / "不需要 preview" / "no previews" | previews |
| "只生成 css + 文档" / "只要基础文件" / "token + docs only" | components, previews, uikit |
| **No explicit exclusion (default)** | **(empty — generate all)** |

### Dependency Rules
- `components` skipped → auto-adds `previews` and `uikit` (cascading dependency)
- `previews` can be skipped independently (components data still generated, just no HTML preview)
- `uikit` can be skipped independently (components + previews still generated)
- **Non-skippable**: `colors_and_type.css`, `css.json`, `README.md`, `SKILL.md`, Quality Gate

### Intermediate File Rules
- `phase2-brand-analyst.json`: Written in `create-library` and `create-from-scratch` (brand sub-agent).
  Not written in `structured-spec` (docs infer brand from token naming).

## Execution Entry

1. Select one workflow from the Route Table.
2. For `create-library`, use the Runtime Fast Path below and skip full `agent-orchestration.md` unless fallback/debug conditions apply.
3. Read the selected workflow and only the phase template required by the current dispatch.
4. Follow phases sequentially; use `decision-rules.md` only for ambiguity or component-count formula.

## Runtime Fast Path: Create-Library (Quick Reference)

| Phase | Executor | Parallelism | Key Output |
|-------|----------|-------------|------------|
| 1 | Main Agent | — | Manifest awareness + shortlist |
| 2 | Sub-Agent ×1 + Main RunCommand | parallel (same msg) | Brand JSON + file copy |
| 3 | Sub-Agent batches | 1 component/Task, ≤3 Tasks/turn, ≤2 turns (max 6 per run) | Intent JSON + Preview HTML |
| 4a | Sub-Agent ×2 | 2 parallel | SKILL.md + README.md |
| 4b | Sub-Agent ×1 | 1 sequential after docs | UIKit Showcase |
| 5 | Main Agent | — | Validator + cleanup |

Task tool mandatory params: `subagent_type: "general_purpose_task"`, `description`: 3-5 word Chinese summary, `response_language: "zh"`. `description` is USER-VISIBLE: use design-domain wording ("分析设计规范", "生成组件预览"), in Chinese say "设计系统" never "设计库" (English keeps "Design Library"), and never mention 压缩包/规范包/bundle/解压/JSONL/目录结构 or any packaging/parsing mechanics (see `operation-policies/user-output-policy.md` § Terminology Rules).

Main Agent read prohibitions after Phase 1:
- No `file-specs/*.md` reads for sub-agent rules.
- No raw bundle reads after Phase 2.
- No `{tmp_dir}/*.json` or CSS fragment reads for generation context, except the token sub-agent complete-read of `{tmp_dir}/design-tokens.jsonl` in Phase 2b. `{tmp_dir}/agent-reports/*.json` is exempt as a small completion contract: Main Agent may read each report once, but MUST NOT use it as generation context or print it to the user.
- No full `agent-orchestration.md` read in normal create-library execution.

> Full executable instructions: `workflows/create-library.md`. Read `operation-policies/agent-orchestration.md` only for fallback/debug.

## Role

You are a senior Design System Architect. Reconstruct the product's own visual language from parsed design data; do not impose a generic style system.

## Conversation Continuity

After `complete`, route follow-up requests to refine, expand components, generate another kit, export formats, add dark mode, or framework-specific code as appropriate.
