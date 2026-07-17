# Refine Existing Library

> Incremental workflow: Adjust an existing Design Library based on user feedback.
> Read when: User references an existing Library and requests changes (adjust tokens, fix docs, improve components).

## When to Use

- User says "adjust the colors", "fix the button docs", "update the typography"
- User provides feedback on generated Library and wants iteration
- User asks to "optimize" or "improve" the Library
- User points out errors in generated output

### TodoWrite Policy (per SKILL.md invariant #12)

HARD CAP = 2. Allowed positions: ① after the change manifest is built, ② before final validation. Never standalone — always batch with the next action.

## Flow

### Step 1 — Assess Current State (Main Agent)

1. Read the existing Library's key files to understand current state:
   - `README.md` — brand narrative, file index
   - `SKILL.md` — gateway rules
   - `css.json` — current token understanding source
   - `colors_and_type.css` — runtime CSS link source
2. If kit-related change: also read `ui_kits/*/index.html` (kit-level README files are not part of the standard output)
3. If component-related: resolve ComponentContractFile first. Use `components/_evidence/index.json` + relevant `components/_evidence/{slug}.json` when evidence exists; otherwise use `components/index.json` + relevant `components/{slug}.json`.
4. **Redo Quality Check**: If multiple core files are missing/empty/malformed (e.g., `css.json` has wrong structure, `SKILL.md` < 5 lines, `README.md` is boilerplate), the previous generation FAILED. In this case:
   - Do NOT attempt to patch/refine — the base is too broken
   - Inform user: "上次生成质量不足，建议重新生成而非修补。"
   - Re-route to the ORIGINAL creation workflow (see SKILL.md Redo Handling)
5. Classify the change scope:

| Scope | Signal | Affected Files |
|-------|--------|---------------|
| Token change | "change primary color", "adjust spacing" | CSS, all preview HTML, UI Kit, components/{slug}.json |
| Component fix | "fix Button docs", "add Input component", "change Button radius/hover/preview" | `components/{slug}.json` + `components/index.json` + `preview/*.html` + `components.css` + `README.md` component pattern entry |
| Kit improvement | "add a screen", "fix navigation" | `ui_kits/<type>/index.html` |
| Doc update | "update README", "fix brand description" | `SKILL.md` and/or `README.md` |
| Content fix | "fix typos", "change copy language" | Various |
| Graphic asset change | "change icon color", `<design_library type="graphic">` in user message | `.design_library/{lib}/assets/icons/{name}.svg` (or `icons/{name}.svg`) — edit in place |

### Graphic Asset Changes (Main Agent direct edit)

Graphic asset (icon/SVG) modification is an EXCEPTION to the sub-agent dispatch flow:

- Main Agent edits the ORIGINAL SVG file in place under `.design_library/{lib}/` (look for `assets/icons/{name}.svg` or `icons/{name}.svg`; if the user message carries a `file-path` attribute on the `<design_library>` tag, edit that exact file). No sub-agent dispatch, no CSS/README cascade.
- Changes under `.design_library/` are automatically uploaded as a new library version when the turn ends — do NOT call any protocol action for this.
- NEVER create a standalone copy outside the library directory as the deliverable.
- If the library directory does not exist in the workspace (not installed), tell the user the original asset file cannot be located — do NOT create an orphan file and claim the library was updated.

### Step 2 — Plan Minimal Changes (Main Agent)

- **Prefer minimal changes over full regeneration.**
- Map the change to affected files:
  - Token rename → list ALL files referencing that token name (preview HTML, components/{slug}.json, UI Kit CSS variables, `css.json`)
  - Token value change (colors, spacing, radius, etc.) → update CSS, then run `css-to-json.mjs` to regenerate `css.json` + update all preview pages referencing affected tokens
  - Component add → generate that component's preview page + update component data + regenerate `components.css` + update README Component Patterns. For Figma-derived libraries, write `components/_evidence/{slug}.json` + debug/traceability `components/{slug}.json` and update both indexes; normal generation reads evidence. For non-Figma libraries, write compact schema v2 `components/{slug}.json` and update `components/index.json`.
  - Component preview/style modification → update `preview/component-{slug}.html`, then regenerate `components.css`; if the change affects anatomy, states, variants, usage guidance, or key visual facts, update the README Component Patterns row for that slug.
- Create a change manifest:
  ```
  Changed: colors_and_type.css (updated --brand-primary from #ff6b35 to #e65100)
  Cascade: css.json, preview/component-buttons.html, ui_kits/app/index.html
  Unchanged: all other files
  ```
- **Protected directories**: `specs/` is user-maintained context — NEVER delete its contents during refinement. Modification is allowed ONLY when the user explicitly requests changes to specs content.

### Step 3 — Execute Changes (Sub-Agent dispatch)

- Dispatch only the necessary sub-tasks using the closest matching phase template/spec:
  - Token/CSS changes → targeted CSS-refine Task using `file-specs/css-tokens.md`; after CSS is updated, Main Agent runs `css-to-json.mjs` to regenerate css.json deterministically
  - Preview page changes → `examples/templates/incremental.md` § Preview-Only
  - Component data changes → for Figma-derived libraries, update `components/_evidence/{slug}.json` first and keep `components/{slug}.json` in sync or mark debug data stale. For non-Figma libraries, update compact schema v2 `components/{slug}.json` directly. CSS/HTML/MD content still goes through sub-agents.
  - UI Kit changes → `examples/templates/phase-4-ui-kit.md`
  - **Cascade rule**: Any change to `colors_and_type.css` MUST trigger a paired css.json regeneration via:
    ```bash
    node {SKILL_DIR}/scripts/css-to-json.mjs {output_dir}/colors_and_type.css --output {output_dir}/css.json
    ```
    - **Component CSS cascade rule**: Any change that creates, deletes, or modifies `preview/component-{slug}.html`, or changes component-level CSS/anatomy inside preview markers, MUST trigger:
      ```bash
      node {SKILL_DIR}/scripts/extract-components-css.mjs {output_dir}
      ```
      The regenerated `components.css` is part of the same change and must be listed in the final `writtenFiles`.
    - **README component-info cascade rule**: Any component add or meaningful component change MUST update `README.md` → Component Patterns with the slug, preview path, contract path, components.css coverage, variant/state/pattern facts, and one concise key insight.
- Include relevant snippets, file paths, and the change manifest for continuity
- Sub-agent constraints: use the closest template from `examples/templates/`; if that template says constraints are inline, do not add `file-specs/*.md` reads
- Each sub-agent receives:
  - The user's change request
  - Relevant snippets from current files (for reference)
  - Relevant token/component data (from README or CSS)

### Snippet Budget

Avoid pasting large generated files into the Task query.

| File Type | Default Context | Full Content Allowed When |
|-----------|-----------------|---------------------------|
| `README.md`, `SKILL.md`, `components/_evidence/index.json`, `components/index.json` | Relevant section + file index only | File is short and the entire file is directly affected |
| `colors_and_type.css` | Affected variable blocks + surrounding comments | Token rename/value change affects most of the file |
| `preview/*.html` | `<head>` CSS link + affected component/demo section | File is small and the requested change is page-wide |
| `ui_kits/<type>/index.html` | Route/screen/component snippets + import/link section | Never by default; only if the target file is demonstrably small |

Default snippet limit: 200-400 lines per sub-task. For larger context, pass the file path and exact symbols/sections to inspect; let the sub-agent read only the necessary ranges.

### Documentation and Markdown Changes

README, SKILL, CSS, HTML, and JSX content must still be generated by sub-agents. Main Agent may directly update structured component JSON (`components/_evidence/index.json`, `components/_evidence/{slug}.json`, `components/index.json`, and `components/{slug}.json`) when the change is limited to component metadata. Main Agent only:
- Builds the change manifest
- Selects affected files
- Dispatches targeted Task calls
- Collects `writtenFiles` paths from `{tmp_dir}/agent-reports/*.json`
- Emits `generate_skill_files`

### Step 4 — Cross-Reference Validation (Main Agent)

- If tokens changed: verify all preview HTML still references valid CSS variables
- If component added or preview/style changed: verify `components.css` contains the affected component section and `README.md` Component Patterns includes the affected slug with key facts
- If kit changed: verify kit still loads correctly
- Run relevant gates from `operation-policies/quality-gates.md` (not all — only affected ones)

### Step 5 — Finalize Changes

> Sub-agents Write updated files to disk, then write `{tmp_dir}/agent-reports/{refine-task-id}.json`; Main Agent references paths in reported `writtenFiles`. CSS sub-agent also writes `writtenFiles` + `stats` + `availableVariablesFile` to its report. Final sub-agent responses are short status sentences only.

## Constraints

- Do NOT regenerate unchanged files
- Preserve existing brand narrative and personality unless explicitly asked to change
- If user's request would break a Critical Invariant (see SKILL.md), warn before proceeding
- Maximum cascade depth: if a token rename affects >10 files, confirm with user before proceeding
