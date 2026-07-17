# Expand Component Coverage

> Incremental workflow: Add more components to an existing Design Library.
> Read when: User references an existing Library and requests adding components not covered in the first batch.

## When to Use

- User says "add more components", "continue analyzing", "add Cards and Search too"
- User requests specific components by name that are not in the current Library
- User says "explore more components" or "what other components can you add?"

### TodoWrite Policy (per SKILL.md invariant #12)

HARD CAP = 2. Allowed positions: ① after expansion scope is confirmed, ② before final validation. Never standalone — always batch with the next action.

## Prerequisites

- Existing Library with at least: `colors_and_type.css` + `css.json` + `README.md` + `components/index.json`
- Preferred runtime component CSS: `components.css`. If it is missing but `preview/component-*.html` exists, Main Agent MUST regenerate it after new preview pages are written.
- Preferred: `components/_evidence/index.json` and `components/_evidence/{slug}.json`
- Bundle data MAY or MAY NOT still be accessible
- If the Library contains a `specs/` directory, it is user-maintained context and MUST NOT be deleted during expansion. Modification is allowed only when explicitly requested by the user.

## Flow

### Step 1 — Assess Current State (Main Agent)

1. Read the existing Library's `README.md` → extract the File Index to determine which components already exist
2. Read `colors_and_type.css` for token understanding and as the runtime link source
3. Resolve component contracts: use `components/_evidence/index.json` and evidence files when present; otherwise use `components/index.json` and `components/{slug}.json`
4. Determine the **existing component list** (slugs listed in evidence index or `components/index.json`)

### Step 2 — Determine New Components (Main Agent)

**If user specified component names**: Use those directly.

**If user said "add more" without specifics**:
1. Check if the original bundle path is still accessible (try `LS {bundle_path}/components/`)
   - **Bundle available** → Read bundle `generated/components/index.jsonl` first, filter out slugs already present in generated `{output_dir}/components/_evidence/index.json`, sort by priorityHint/variantCount, take top 3-5
   - **Bundle not available** → Ask user to either:
     - Re-provide the bundle path, OR
     - Specify which components to add by name (agent will infer compact schema v2 component JSON from existing Library context)
2. Confirm the list with user if >5 new components (to manage generation time expectations)
3. Default incremental batch size is 3-5 components. Max 3 component sub-agents per dispatch round (same limit as create-library Phase 3/4). If the requested list exceeds 3 components, split into rounds.

### Step 3 — Extract Component Data (Sub-Agent ×1, if bundle available)

> Skip this step if bundle is not available — proceed to Step 4 with inference mode.

```
Task: Extract structural data for new components from the Design Spec Bundle.
Output: Disk-written component evidence + fallback JSON files for the new component list.
Constraint files (MUST read before execution):
  - {SKILL_DIR}/operation-policies/bundle-exploration.md — Reading strategy (especially: base + part1 only)
  - {SKILL_DIR}/file-specs/design-spec-bundle.md — Bundle structure schema
Forbidden tools (per SKILL.md invariant #16): TodoWrite, Skill, Grep, RunCommand, SearchCodebase; this task additionally forbids LS, Glob
Input data:
  - Bundle root path: {bundle_path}
  - New components to extract: {list of { slug, name }}
  - Files to read per category: `generated/components/{slug}.jsonl` evidence files (from bundle manifest `generatedFiles`)
    - ReturnReportFileAbs: {tmp_dir}/agent-reports/expand-components-{batchId}.json
  Report file format:
  - writtenFiles: ["components/_evidence/{slug1}.json", "components/{slug1}.json", ...]
  - summary: "Extracted N components: Name1 (N variants), Name2 (N variants). Key patterns: ..."
  - warnings: string[]
  Final response:
    已完成组件扩展。
```

### Step 4 — Generate Preview Pages (Sub-Agent ×N, ≤3 per round)

> **Template binding**: Main Agent uses `examples/templates/incremental.md` for incremental deltas and passes `examples/templates/component-dispatch-rules.md` as the shared preview constraint file when the sub-agent can read local files. Do not inline full component hard rules unless the runtime cannot provide file access to the sub-agent.

For each new component, dispatch a sub-agent using the **Preview-Only template** from `examples/templates/incremental.md` to generate its preview page.

Each new component gets a new `preview/component-{slug}.html` page. Do NOT regenerate existing preview pages in this workflow. If the user explicitly asks to change an existing preview page, route that request to `workflows/refine-library.md`.

Dispatch a new preview page sub-agent using the **Preview-Only** template from `examples/templates/incremental.md`. The new page slug is derived from the component group name (e.g., `component-search.html`).

If new components don't fit existing preview pages AND don't warrant a standalone page, this step may be skipped. **Skip criteria**: ALL of the following must be true:
- `variantCount ≤ 3` (trivial variant surface)
- The component is a utility/modifier (not a user-facing interactive element, e.g., Divider, Spacer, Badge)

### Step 5 — Refresh Aggregated Component CSS (Main Agent)

After any new `preview/component-{slug}.html` is written, Main Agent MUST refresh `{output_dir}/components.css` deterministically:

```bash
node {SKILL_DIR}/scripts/extract-components-css.mjs {output_dir}
```

This step is mandatory even when only one component was added. `components.css` is the UIKit/component-consumption SSOT, so it must include the new component section before README or UIKit updates reference it.

### Step 6 — Update Documentation & Component Files (Main Agent)

The extraction sub-agent writes `components/_evidence/{new-slug}.json` and debug/traceability `components/{new-slug}.json` for each new component when bundle data is available. Main Agent updates both `{output_dir}/components/_evidence/index.json` and `{output_dir}/components/index.json`; generation sub-agents resolve the contract file by path existence (`components/{slug}.json` first, else `_evidence/{slug}.json`). In inference mode (bundle unavailable), write compact schema v2 `components/{new-slug}.json` with `sourceKind`, `confidence`, and `unknowns`, then update `{output_dir}/components/index.json`. Do not create inferred `components/_evidence/` for non-Figma data. Then dispatch one documentation update sub-agent:

```
Task: Update Design Library README file index after component expansion.
Output: README.md
Constraint files (MUST read before execution):
  - {SKILL_DIR}/file-specs/documentation.md — README structure and content requirements
  - {SKILL_DIR}/file-specs/design-library-output.md — Output directory structure and file roles
Input data:
  - Existing README path/content excerpt: {current README file index + relevant brand summary only}
    - New components: {list of new preview pages with slugs}
    - New component key facts: for each slug include contract path, preview path, components.css section name, component kind, variant/state coverage from `renderFacts.controlMatrix` or component JSON, pattern model (`tableModel`, `listModel`, `toggleModel`, segmented groups), and 1 concise brand-specific rendering insight.
  - Existing component list: {names of previous components}
    - ComponentsCSSFile: {output_dir}/components.css (freshly regenerated; README Component Patterns must mention it when present)
  - Do NOT modify SKILL.md (gateway document, component-agnostic)
  - OutputDir: {library output root path}
    - ReturnReportFileAbs: {tmp_dir}/agent-reports/expand-components-readme.json
  Report file format:
  - writtenFiles: ["README.md"]
  - warnings: string[]
  Final response:
    已完成设计系统说明。
```

### Step 7 — Quality Gate (Main Agent)

Run only the relevant gates from `operation-policies/quality-gates.md`:
- **Gate 1** (Structure): verify new component files exist
- **Gate 3** (JSON Structure): verify component index/slug JSON integrity
- **components.css**: verify it exists and contains a section/anatomy for every newly added `preview/component-{slug}.html`
- **README.md**: verify Component Patterns includes each new slug with its preview path, contract path, components.css coverage, and one key insight
- **Gate 6** (Protocol): verify all files were written successfully

## Constraints

- Do NOT regenerate existing preview pages or CSS tokens
- Do NOT modify `colors_and_type.css`
- Do regenerate `components.css` whenever new component preview pages are added
- New preview pages MUST use the same template structure as existing ones
- Brand language, token naming, and visual tone must be consistent with existing Library
- If bundle is not available, clearly state in warnings that component data was inferred (lower fidelity)
