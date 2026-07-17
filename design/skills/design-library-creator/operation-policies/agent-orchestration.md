# Agent Orchestration

> **Fast Path Note**: For the normal `create-library` route, this file is a fallback/debug reference, not required pre-read context. The executable fast path lives in `SKILL.md` + `workflows/create-library.md` + the matching `examples/templates/` file. Read this file only for non-fast-path routes, rejected dispatch formats, missing templates, or orchestration debug.

## ⚠️ Tool Mapping (CRITICAL — Read First)

**"Sub-agent dispatch" = calling the `Task` tool.** This is mandatory, not optional.

| This Document Says | You MUST Do |
|-------------------|-------------|
| "dispatch a sub-agent" | Call the `Task` tool with `subagent_type: "general_purpose_task"` |
| "dispatch 3 sub-agents in parallel" | Send **3 `Task` tool calls in a single message** |
| "sub-agent reads files" | Include file paths in the `Task` tool's `query` parameter — the sub-agent will `Read` them |
| "sub-agent returns result" | The `Task` tool's return value is the sub-agent's result |

**NEVER substitute Glob/Read/LS for a Task dispatch.** Using Glob to speculatively read bundle files is NOT equivalent to dispatching a sub-agent. Glob cannot analyze, synthesize, or produce structured reports.

**Anti-pattern (FORBIDDEN)**:
```
❌ "Let me read some key token files to provide context for sub-agents"
   → Glob /data/user/work/bundle/tokens/*.md     ← WRONG: this is NOT dispatching
```

**Correct pattern (REQUIRED)**:
```
✅ Call Task tool × 1:
   Task 1: brand-analyst (query includes bundle path + brand-input.jsonl path + return format)
```

---

## Architecture

```
Main Agent (Orchestrator)
├── Responsibilities: route, explore indexes, derive orchestration data, dispatch via Task tool, validate, emit protocol when available
├── Does NOT: generate files (no Write for CSS/HTML/JSX/MD content)
├── Does NOT: read sub-agent specs, make aesthetic decisions
├── Does NOT: use Glob/Read as a substitute for Task dispatch
│
Sub-Agents (Executors) — launched via Task tool
├── Phase 2: 1× brand-analyst reads brand-input.jsonl → writes brand profile to tmp_dir → returns compact summary
├── Phase 3 Batch 1: up to 3 intent + preview sub-agents
├── Phase 3 Batch 2: remaining component sub-agents (if shortlist > 3)
├── Phase 4a: 1× SKILL.md + 1× README.md → docs return `writtenFiles` + `warnings`
├── Phase 4b: 1× Sample Page → consumes completed docs + previews, may read evidence fallback
├── Phase 5: Quality Gate (Main)
├── Do NOT: call `complete`, generate README/SKILL.md unless assigned, read other sub-agents' outputs
```

## Write Tool Usage (Main Agent)

| Allowed | Forbidden |
|---------|-----------|
| `Write` for shell scripts (zip/package) | `Write` for any `.css`, `.html`, `.jsx`, `.md` output |
| `Write` for `{tmp_dir}/phase2-brand-analyst.json` in `create-from-scratch` (Main Agent creates BrandProfile from user input) | Main Agent hand-writing or LLM-generating `colors_and_type.css`, `css.json` (`colors_and_type.css` is Sub-Agent output or legacy copied CSS; `css.json` is generated only by the specified deterministic script) |
| `RunCommand` for batch-writing `components/index.json` + `components/{slug}.json` × N (one-shot, in `create-from-scratch` and `expand-components` only) | Individual `apply_patch` for each component JSON file |
| `RunCommand` for zip packaging | |

**Detection rule**: If the Write content is > 200 bytes and the file extension is `.css/.html/.jsx/.md`, this is a violation. Re-route to Task.

---

## From-Scratch Anti-Patterns (FORBIDDEN)

These patterns were observed in production traces and MUST NOT occur:

1. **探索式寻路** (observed: 19 Glob/Grep/LS calls): Main Agent searching for schema files after token sub-agent returns → all templates MUST be pre-read in Phase 0.3
2. **主 Agent 手写/猜测 token 文件** (observed: ad-hoc scripts re-inferring CSS/JSON): Token sub-agent writes only `colors_and_type.css` in one Task → Main Agent MUST NOT hand-write, LLM-generate, patch, or infer token artifacts. Main Agent MUST only run the specified deterministic projection script for `css.json`
3. **串行写 component JSON** (observed: 6 individual apply_patch calls): Use ONE RunCommand batch write
4. **主 Agent 自己写 preview HTML** (observed: direct apply_patch for .html): Phase 3 is Task-only → Main Agent MUST NOT Write any .html
5. **Phase 4 后重写** (observed: 35 calls reading + patching sub-agent output): Zero post-processing → collect writtenFiles only
6. **验证修复循环** (observed: multiple validator → fix → re-validate rounds): Single validation in Phase 5 → fail = report, not fix
7. **Schema-warning retry loop**: `validate-intent.mjs` is advisory by default. Missing optional intent fields or enum warnings MUST NOT trigger component retry loops. Retry only when the physical JSON file is absent or preview validation fails, and retry only the slug(s) named by the failing file paths. A failure in `preview/component-buttons.html` can only retry `buttons`; it must not trigger regeneration of sidebar, cards, list, tables, button-group, or any other unaffected component.

---

## Parallel Dispatch Rules (Mandatory)

| Rule | Detail |
|------|--------|
| Independent tasks in same phase MUST use parallel `Task` calls | Send multiple `Task` tool calls in ONE message. Separate assistant messages are sequential because the Main Agent waits for each tool batch to return. |
| Maximum **3** `Task` calls per dispatch round | Phase 3 dispatches components in sequential batches of 3 until all are done. Phase 4a dispatches docs; Phase 4b dispatches UIKit after docs complete. |
| Dependency chains remain serial | brand-analyst + bundle copy (parallel) → Phase 3 batches → docs → UIKit. |
| Sub-agents never call `complete` | Only main agent can finalize the skill |
| **Component Fast Path** | Normal create-library Phase 3 sub-agents use `examples/templates/phase-2.5-intent-synthesis.md` to write `components/{slug}.json` and `preview/component-{slug}.html`. Evidence/Legacy fallback uses `phase-3-4-component.md`. |

## Sub-Task Dispatch Format

Every sub-task dispatched via the `Task` tool MUST include these elements in the `query` parameter.

> **Reference templates**: See `examples/templates/` for per-phase copy-ready templates. Read ONLY the template file matching the current dispatch phase. Adapt with actual paths and data — do not draft queries from scratch.

### Template Source of Truth (REQUIRED)

`examples/templates/` directory is the single source of truth for Task query bodies (one file per phase).

Main Agent MUST:
- Read the matching phase template from `examples/templates/`
- Fill actual bundle paths, shortlist data, and intermediate file paths
- For non-component tasks: preserve the compact embedded `⚠️ HARD RULES` section from the template
- For create-library Phase 3 component tasks: use the intent + preview `phase-2.5-intent-synthesis.md` template. Use `phase-3-4-component.md` only for Evidence/Legacy preview fallback.
- Include listed constraint file paths for non-component tasks; component preview tasks use the compact contract and explicit input files only

Main Agent MUST NOT:
- Read `file-specs/*.md` just to extract rules for a Task query
- Invent a new Task query from workflow summaries
- Drop or weaken non-component templates' compact `⚠️ HARD RULES`
- Inline full component hard rules, HTML templates, CSS variable lists, or file-spec excerpts into Phase 3 component Task queries

If a workflow snippet conflicts with the phase template in `examples/templates/`, the template wins.

### Inline Critical Rules (Task-Type Specific)

Non-component tasks MUST include the compact embedded `⚠️ HARD RULES` section from the matching template. Keep it short and never copy long `file-specs/*.md` excerpts into the Task query.

```
⚠️ HARD RULES (embedded — do NOT skip):
  1. {most critical structural constraint}
  2. {most critical content constraint}
  3. {most critical naming/format constraint}

📎 Full specification (read for detailed examples and edge cases):
  - {SKILL_DIR}/file-specs/{relevant-spec}.md
```

Create-library Phase 3 component tasks pass only: component slug/name, output path, `colors_and_type.css`, `_evidence/{slug}.json`, `_evidence/index.json`, and specimen reference paths via the merged template. Fallback preview-only tasks pass `file-specs/preview-pages.md`, `colors_and_type.css`, and one resolved `ComponentContractFile`.

### Full Query Structure

```
Task: {concise description of what to produce}
Output:
  - {file path 1}
  - {file path 2}
Constraint files (MUST read before execution):
  - {SKILL_DIR}/file-specs/{relevant-spec}.md — {one-line purpose}
Input data:
  - {assigned bundle partition for Phase 2 analyst tasks OR intermediate JSON files for Phase 3+ generation tasks}
  ReturnReportFileAbs:
    - {tmp_dir}/agent-reports/{phase}-{stable-task-id}.json
  Completion:
    - Write the report JSON to ReturnReportFileAbs.
    - Final response: one short user-safe status sentence only.
```

**Key rule**: ALL generation sub-agents (Phase 2-5) Write output files to disk, then write a compact machine report to `ReturnReportFileAbs`. Main Agent reads that report once and references `writtenFiles` in `generate_skill_files` only when that protocol action is available; otherwise it keeps a compact relative file list for final summary. The report is orchestration data and MUST NOT be printed to the user.

### Task Tool Call Example (Phase 2)

```
Tool: Task
Parameters:
  description: "Analyze brand identity"
  subagent_type: "general_purpose_task"
  query: |
    You are a brand-analyst sub-agent for a Design Library generation pipeline.

    Task: Analyze brand identity, product type, and visual personality.

    Bundle root path: /data/user/work/bundle
    Tmp dir: <HIDDEN_TEMP_ROOT>/my-library

    Files to read:
      1. PRIMARY: /data/user/work/bundle/generated/brand-input.jsonl
      2. Supplementary: /data/user/work/bundle/context/brand-clues.md

    Write to: <HIDDEN_TEMP_ROOT>/my-library/phase2-brand-analyst.json

      ReturnReportFileAbs: <HIDDEN_TEMP_ROOT>/my-library/agent-reports/phase2-brand-analyst.json
      Completion: write the report JSON, then respond "已完成设计规范分析。"
```

## Context Distillation Principle

Context rules differ by task type:

- Phase 2 analyst sub-agents MAY read assigned raw bundle partitions, because their job is to reduce domain-specific source data into structured reports.
- Phase 3+ generation sub-agents read intermediate files directly from disk. Create-library Phase 3 reads `{output_dir}/colors_and_type.css` and `components/_evidence/*`; UIKit reads docs/previews first and `_evidence/*` only as fallback. They MUST NOT read raw bundle files.
- Main agent extracts orchestration data from Phase 2 returns (§ 2.4), then dispatches Phase 3+ with intermediate file paths as the generation input contract.

Sub-agents receive:

| Information | Phase 2 Analyst Input | Phase 3+ Generation Input |
|-------------|----------------------|-------------------------------|
| Brand | `generated/brand-input.jsonl` + limited supplementary files | BrandProfile JSON (~10 fields) |
| Tokens | Compact `generated/design-tokens.jsonl` or legacy generated CSS | `colors_and_type.css` (SSOT) + `css.json` file paths derived from final CSS |
| Components | Deterministically generated by BundleGenerator | Phase 3: `_evidence` → intent+preview. Phase 4b: preview first, `_evidence` fallback |
| Constraints | `bundle-exploration.md` + input bundle spec | Only 1-2 relevant output spec files |

### Inter-Phase Distillation (MANDATORY — violation triggers abort)

Context accumulation is the #1 cause of latency degradation. These checkpoints are HARD requirements, not suggestions.

| Checkpoint | When | Action | Context Budget |
|------------|------|--------|---------------|
| Post-Phase 2 | Brand analyst returned | Extract orchestration fields from return (§ 2.4); drop verbose summary text | ≤ 35K |
| Post-Phase 3 | CSS + first-batch components done (max 6) | Drop Phase 2 return bodies + all preFilledXxx strings; retain only `availableVariablesFile` path, compact stats, and `writtenFiles` paths | ≤ 55K |
| Pre-Phase 4 | Before UIKit + docs dispatch | Retain ONLY: intermediate file paths + writtenFiles list + BundleWarnings + colors_and_type.css path | ≤ 35K |

**"Drop" means**: Do NOT reference this data in subsequent Task queries or responses. Sub-agents read what they need from disk via paths.

**Self-check**: If you notice your prompt growing (responses getting slower, TodoWrite taking > 3s), you are likely carrying stale context. Perform the next distillation checkpoint immediately regardless of current phase.

## Concurrency & Dispatch (see also SKILL.md Runtime Fast Path)

| Phase | Max Parallel | Key Rules |
|-------|-------------|-----------|
| 2 (Analysis + Copy) | 2 | brand-analyst Task + RunCommand(file copy) in same message |
| 3 Batch N | ≤3 | Sequential batches of up to 3 component previews per tool-call message; repeat until all dispatched (max 6 first-batch, ≤2 turns) |
| 4a (Docs) | 2 | SKILL.md + README.md in parallel |
| 4b (UIKit) | 1 | Dispatched only after docs sentinel passes; `css.json` is derived from final `colors_and_type.css` via `css-to-json.mjs` (never copied from bundle) |

**Rules**: 1 Task = 1-2 output files; ≤ 3 Task calls per dispatch round; Preview HTML ≤ 4 KB; UIKit ≤ 40 KB; Independent tasks MUST use parallel `Task` calls in ONE message.

---

## Sub-Agent Execution Policy

### Sub-Agent Execution Protocol (3-Phase Only)

All generation sub-agents (Phase 3/4/5) MUST follow this strict 3-phase execution pattern:

**Phase A: Read** (per-template allowlist — no exploration)
- Read ONLY files listed in the Task query's "Constraint files" and "Input data" fields
- No Glob, no SearchCodebase, no LS, no RunCommand
- No TodoWrite

**Phase B: Generate + Write**
- Generate content in memory
- Write all output files (1-3 Write calls typical)
- No Read after first Write call (zero Read-back)

**Phase C: Report + Final Response** (HARD STOP)
- Write report to `ReturnReportFileAbs`: `{ "writtenFiles": [...], "stats": {...}, "warnings": [...] }`
- Final response: one short user-safe status sentence only
- After final response — no further tool calls, no summary, no verification

### FORBIDDEN across all phases (per SKILL.md invariant #16):
- ❌ TodoWrite / Skill (any phase — zero exceptions)
- ❌ Read after any Write call (Read-back verification)
- ❌ RunCommand (any — no wc, ls, cat, shell)
- ❌ Grep / Glob / SearchCodebase / LS (no file discovery; LS/Glob allowed only when the template explicitly scopes discovery paths, e.g., UIKit preview/evidence/icon discovery)
- ❌ Return body > 800 tokens (violates SKILL.md invariant #23)
- ❌ Any tool call after the final Return message
- ❌ Outputting a summary message after returning file content

> **Read budget**: No global ≤N hard limit. Each template declares its own file allowlist. Sub-agents may ONLY read files explicitly referenced in their Task query. Component sub-agents have MAX CALLS: 5 (target 3; see phase-3-4-component.md for authoritative execution steps).

### Component Preview Contract (Create-Library)

Normal create-library Phase 3 component sub-agents receive the expanded query from `examples/templates/phase-2.5-intent-synthesis.md`:
- Sub-agents read `_evidence/{slug}.json`, `colors_and_type.css`, `css.json`, `_evidence/index.json`, and specimen reference.
- Sub-agents write `components/{slug}.json` and `preview/component-{slug}.html`.
- Sub-agents MUST NOT read `examples/templates/component-dispatch-rules.md` during normal create-library execution.
- Evidence/Legacy fallback sub-agents use `examples/templates/phase-3-4-component.md` and may read `file-specs/preview-pages.md`.
- CSS is already generated in output_dir; no Phase 3 CSS sub-agent exists in create-library.

> **Why**: LLM owns component intent quality. `validate-intent.mjs` reports contract quality but does not block generation by default.

### Timeout & Retry Policy

| Phase | Timeout per Sub-Agent | Retry Strategy |
|-------|----------------------|----------------|
| 2 (Analysis) | 3 min | Retry once with same query |
| 3 Batch 1 (first components) | 5 min | Retry once |
| 3 Batch 2 (remaining components) | 5 min | Retry once |
| 4a (Docs) | 8 min | Retry once; if 2nd attempt also times out, stop successful completion |
| 4b (UIKit) | 8 min | Retry once; if 2nd attempt also times out, skip only when UIKit is optional and log warning |

**Timeout detection**: Retry only when the Task tool returns a timeout/error, or when the runtime explicitly reports that the sub-agent timed out. Do not assume the Main Agent can interrupt or inspect a synchronous Task call before it returns.

**Note**: These durations are runtime guidance. The Task tool itself does not enforce timeouts, and the Main Agent should not fabricate elapsed-time monitoring evidence.

---

## Sub-Agent Completion Report Contract

Phase 2-5 sub-agents Write output files to disk and write paths into `ReturnReportFileAbs`. Main Agent collects `writtenFiles` from report files for orchestration tracking only (never prints to user).

Report files live under `{tmp_dir}/agent-reports/`, are hidden from the user's workspace, and must be ≤4KB each. Each Task writes exactly one report file. The final Task/Sub-Agent response is user-visible and must be one short status sentence, never JSON.

### Phase 3/4/5 Report (Written to `ReturnReportFileAbs`)

Base schema (SSOT — templates may add phase-specific top-level fields they declare themselves, e.g., `undefinedCssVars` in `phase-2.5-intent-synthesis.md`/`phase-3-4-component.md`, or replace `stats` keys, but MUST keep `writtenFiles` + `warnings`):

```json
{
  "writtenFiles": [
    "preview/component-buttons.html",
    "preview/component-cards.html",
    "components/index.json",
    "components/{slug1}.json",
    "components/{slug2}.json"
  ],
  "warnings": [
    "Missing shadow data for elevated cards — used inferred values"
  ],
  "stats": {
    "filesGenerated": 2
  }
}
```

### Phase 2 Report (Written to `ReturnReportFileAbs`)

```json
{
    "writtenFiles": ["{tmp_dir}/phase2-brand-analyst.json"],
  "summary": "Product: CRM dashboard (high confidence). Personality: professional, clean, data-rich. Language: en. Kit: dashboard.",
  "warnings": [],
  "language": "en",
  "kitType": "dashboard",
  "productType": "CRM",
  "personality": ["professional", "clean", "data-rich"]
}
```

**Key rule**: `writtenFiles` entries for final library artifacts are relative paths under the library root. Temporary files may use `{tmp_dir}` when explicitly declared by the workflow. Main Agent must not rewrite or "improve" sub-agent output unless a quality gate triggers a targeted retry.

## Sub-Agent Error Handling

When a sub-agent report is missing, unexpected, or degraded, Main Agent MUST follow this protocol:

| Report Condition | Action |
|-----------------|--------|
| `writtenFiles` is non-empty + `warnings` present | Accept output, propagate warnings to `complete.summary` |
| `writtenFiles` is empty + `warnings` present | **Retry once** with simplified scope (reduce output count or file size) |
| Retry also returns empty `writtenFiles` | Log failure in `complete.summary`, continue to next phase |
| `ReturnReportFileAbs` missing but expected outputs exist | Continue, record internal `report-missing` warning, never print report/path details |
| `ReturnReportFileAbs` missing and expected outputs missing | **Retry once** with reduced scope |
| Sub-agent Task call itself errors/times out | **Retry once** with reduced scope (fewer files per call) |
| Retry also errors | Log failure, continue to next phase |

**Retry budget**: Maximum 1 retry per sub-agent per phase. Do NOT retry the same failed task more than once — escalate to `complete.summary` instead.
**Targeted retry scope**: A validation failure must be mapped to exact output files first. Retry prompts may include only those failed output files and their corresponding source contract/evidence files. Never batch healthy files into a retry just because they were generated in the same phase.

**Simplified scope examples**:
- Preview page sub-agent producing 2 pages → retry with 1 page only
- Component doc failing → retry with a stripped-down query (fewer variant details)
- CSS JSON timing out → retry with `limit: first 200 CSS variables only`
