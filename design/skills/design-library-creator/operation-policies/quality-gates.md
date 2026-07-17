# Quality Gates

## Purpose

Main agent MUST execute this validation after ALL sub-agents complete (Phase 5). Files may be delivered incrementally through phase-level `generate_skill_files` actions, but the accumulated file set MUST pass all gates before `complete` is emitted.

## Capability-Aware Validation

Use the strongest available validation mode, but never claim browser validation if the runtime lacks browser/preview tools.

| Mode | When | Required Checks |
|------|------|-----------------|
| Full validation | Browser or preview tooling is explicitly requested and available | Run deterministic static checks first; optional browser checks are advisory unless requested |
| Static fallback | Default mode | Run deterministic file/CSS/JSON checks listed below |

## Script-First Static Validation

Main Agent MUST run the deterministic validator before emitting `complete`:

```bash
node {SKILL_DIR}/scripts/validate-design-library-output.mjs {output_dir}
```

(The validator auto-enables uikit-plan allowlist validation when `{output_dir}/uikit-plan.json` exists — auto-enabled findings are advisory warnings; pass `--require-uikit-plan` to enforce them as hard failures.)

Rules:
- Validator pass is REQUIRED for successful `complete`; if it exits non-zero, do not claim success.
- Treat only these validator counts as hard failures: undefined CSS variables > 0, preview link failures > 0, JSON failures > 0, UI Kit failures > 0, component slug mismatches > 0.
- If the validator passes, do NOT read full generated HTML/CSS/JSON files into LLM context; use the compact JSON summary as the Phase 5 static evidence.
- If the validator fails, only fix deterministic structure/CSS/JSON issues reported by the validator. Do not fix wording, visual style, screen count, implementation style, or other non-deterministic concerns.
- The validator is the mandatory static gate. Browser checks are optional and advisory unless the user explicitly asks for interactive validation.

## Hard Rule: Validator MUST Execute

If Main Agent emits a final response WITHOUT having run `validate-design-library-output.mjs`:
- The session is considered **FAILED** regardless of file state
- Main Agent MUST NOT claim "validation passed" or "validation partially failed" without having actually executed the script
- If the agent is about to stop (budget exhaustion, user cancellation, or error) → run validator FIRST

**Violation indicator**: If final response mentions "校验" / "validation" / "quality gate" but no RunCommand with `validate-design-library-output.mjs` appears in the call history → the agent hallucinated validation results.

Prompt-contract validation for skill changes only:

> Only run this when editing the `design-library-creator` skill itself. Never run it during normal Design Library generation. The checker lives outside the distributed skill, in the repo dev directory: `apps/icube_server_rs/modules/ai-agent/dev/design-library-creator-tests/validate-skill-contracts.mjs`.

```bash
node <repo>/apps/icube_server_rs/modules/ai-agent/dev/design-library-creator-tests/validate-skill-contracts.mjs {SKILL_DIR}
```

Trace-level regression indicators that block success:
- TodoWrite count > 4 in the full session.
- Any `Read` NotFound for `{bundle_path}/{bareComponentFile}` such as `bundle/input.md`.
- Phase 2b/2.4c token generation missing `colors_and_type.css` in output_dir, or token input gate failed.
- No Phase 4 docs dispatch before `complete` (UIKit dispatch NOT required for token-only bundles).
- No validator run before `complete`.

Static fallback MUST verify:
- Required file tree exists (including `css.json`)
- `preview/component-*.html` uses `<link rel="stylesheet" href="../colors_and_type.css">`
- `ui_kits/<type>/index.html` references `../../colors_and_type.css`
- No `var(--*)` reference points to an undefined variable in `colors_and_type.css`
- `components/index.json` matches `components/{slug}.json` files one-to-one
- `complete.stats` contains only `tokensExtracted`, `componentsAnalyzed`, and `filesGenerated`
- All generated files were delivered through phase-level `generate_skill_files` when that protocol action is available; otherwise files exist on disk and are listed in the final relative file summary

## Validation Read Budget

Phase 5 validation reads are a separate budget from Phase 1 bundle exploration reads.

Rules:
- Generated-output validation reads do NOT count toward the Main Agent bundle/intermediate read hard stop in `SKILL.md`
- MUST use `{SKILL_DIR}/scripts/validate-design-library-output.mjs` via `RunCommand` instead of reading full generated files into LLM context
- Read generated files only when the validator fails and the compact failure summary is insufficient for a targeted fix, or when the runtime lacks shell/static-check capability
- If reading is needed, use targeted ranges: first 120 lines for preview files, first 200 lines for `README.md`/`SKILL.md`, and script-based JSON parsing for `css.json`
- Never read raw bundle files during Phase 5 validation


## Token Input Gate (Create-Library)

Before dispatching the Figma token sub-agent:
- `{tmp_dir}/design-tokens.jsonl` MUST exist.
- It MUST NOT contain old schema fields: `brandSignals`, `unresolvedReferences`, `rawSpecAnnotations`, or `variables[].values`.
- Main Agent MUST run `node {SKILL_DIR}/scripts/validate-token-input.mjs {tmp_dir}/design-tokens.jsonl --legacy-css {bundle_path}/generated/colors_and_type.css --json`.
- If validator returns `mode="llm"`, dispatch the token sub-agent and pass warnings into the task prompt.
- If validator returns `mode="bundle"`, copy legacy `generated/colors_and_type.css` and skip the token sub-agent.
- If validator returns `mode="fail"`, stop only for unreadable/old-schema token input. Missing semantic roles or `themeSignals.quality.status=fail` are degraded-token warnings, not a reason to stop create-library.
- Token sub-agent reads the file in one pass if possible. If the Read tool returns a size-exceeded error, use offset/limit chunked reads (see figma-token-gen.md R2).

## Gate 1: Structure Completeness

| Required Path | Check |
|---------------|-------|
| `SKILL.md` | Exists |
| `README.md` | Exists |
| `colors_and_type.css` | Exists, contains `:root` and `.dark` blocks (see Exception below) |
| `css.json` | Exists, valid JSON, contains top-level keys: `color`, `font`, `shadow`, `radius`, `spacing`, `size` |
| `ui_kits/<type>/index.html` | Exists, links `../../colors_and_type.css` (**SKIP if components/ dir absent — token-only**) |
| `preview/component-*.html` | All pages listed in `outputPlan.previewPages` (from Phase 1 shortlist) exist (N = actual shortlist count from Phase 1, per `decision-rules.md` Component Count Formula) |
| `components/index.json` | Exists, valid JSON, `components[]` array has N entries matching shortlist slugs (**SKIP if components/ dir absent — token-only**) |
| `components/{slug}.json` × N | Each file exists, valid JSON, contains matching slug (**SKIP if components/ dir absent — token-only**) |

Exception: `.dark {}` block is NOT required when CSS contains `/* @light-only */` or `/* @dark-only */` comment markers (structured-spec route single-mode output).

## Gate 2: CSS Reference Integrity

- ALL `preview/component-*.html` files MUST contain `<link rel="stylesheet" href="../colors_and_type.css">`
- NONE may inline token CSS definitions
- `colors_and_type.css` MUST contain both `:root { }` and `.dark { }` blocks

  Exception: `.dark {}` block is NOT required when CSS contains `/* @light-only */` or `/* @dark-only */` comment markers (structured-spec route single-mode output).
- Font `@import` must be at the top of the CSS file
- `css.json` MUST be valid parseable JSON (no comments, no trailing commas)
- `css.json` color values MUST use `{ "hex": "#xxxxxx", "opacity": "N" }` format — never rgba() strings
- `css.json` token names MUST be consistent with `colors_and_type.css` variable names (minus `--` prefix)
- Component preview pages MUST only use CSS variables that are defined in `colors_and_type.css`

## Gate 3: JSON Structure Integrity

- `css.json` MUST be valid parseable JSON (no comments, no trailing commas)
- `components/index.json` MUST be valid parseable JSON
- Every component listed in `components/index.json` MUST have `components/{slug}.json`
- Every `components/{slug}.json` MUST parse and contain the same `slug`

## Gate 4: Non-Goals

- Do NOT block completion on documentation wording, line counts, section names, or banned prose patterns
- Do NOT block completion on UI Kit screen counts, navigation regexes, React marker strings, inline styles, icon strategy, or visual implementation style
- Do NOT dispatch SearchReplace loops for non-deterministic content/style concerns

## Gate 5: Optional UI Kit Functionality

- If the user explicitly requests browser validation, `index.html` may be opened to check runtime errors and navigation
- Browser validation findings are reported separately from deterministic static gate results
- Do not convert optional browser findings into automatic rewrite loops

## Gate 6: Protocol Compliance

Apply this gate only when the runtime explicitly exposes these protocol actions/tools.

- If available, all files were delivered via `generate_skill_files` actions
- If available, `update_tokens` was emitted after token system assembly when the route creates or changes tokens
- If available, `update_components` was emitted after component data export when the route creates or changes component coverage
- If available, `complete` is the final action with valid stats

No-action fallback:
- If protocol actions are not present in the available tools/actions, Main Agent MUST NOT fabricate or claim action emission.
- Completion evidence is: files exist on disk, deterministic validator exits 0, and final response lists compact relative file summary.
- In no-action fallback, do not fail solely because `generate_skill_files`, `update_tokens`, `update_components`, or `complete` were not emitted.

## Failure Handling

If any gate fails:
1. Identify the specific failing items from validator compact JSON output
2. For `create-library`: Fix only deterministic structure issues (CSS link path, JSON parse). Maximum 1 fix round. If still failing after 1 retry, emit failed completion.
3. For `create-from-scratch`: Do NOT fix. Report failed summary immediately. Zero fix rounds.
   - Rationale: from-scratch quality is guaranteed by sub-agent prompts. If the validator fails, the sub-agent template needs improvement — not a runtime patch. Quality is built in, not inspected in.
4. Emit targeted `generate_skill_files` updates for affected files only (create-library only)
5. Re-validate only the affected gates (create-library only)
