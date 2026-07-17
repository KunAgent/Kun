# Create Design Library from Structured Specification

> Workflow for generating a Design Library when the user provides a structured token document (Markdown token tables, CSS variables, JSON token files, or design system docs) with token names and values already defined.
> Read when: User provides a complete token specification document — NOT a Figma bundle, NOT a vague text description.

## When to Use

- User provides a `.md` / `.json` / `.css` file containing a complete design token table with hex values, font stacks, spacing values
- User pastes a structured design system specification with named tokens (e.g., `--bg-base-default: #1A1A1A`)
- User says "convert this design spec into a Design Library"
- User provides Figma Token export (JSON or text) without a parsed `.fig` bundle
- User provides a design system document generated from tools (Style Dictionary, Figma Tokens plugin, etc.)

**Key Differentiator from `create-from-scratch`**: Tokens are **already defined** — no AI inference needed for color scales, font choices, or naming. The task is **transformation**, not **creation**.

### TodoWrite Policy (per SKILL.md invariant #12)

HARD CAP = 3. Allowed positions: ① after route confirmation (before Step 1), ② Step 4→5 transition (components done → docs), ③ before final validation. Never standalone — always batch with the next action.

## Output Directory

`{output_dir}` = `{workspace}/.design_library/{library_name}/` — same convention as other routes.

> **⚠️ HARD RULE — Write Scope Constraint**: Writing ANY file (data, scripts, logs, temp artifacts) to paths outside `{output_dir}` and `{tmp_dir}` is **FORBIDDEN**. This explicitly includes one-off helper scripts (e.g., `parse_forms.py`, `transform.mjs`). On device (Lite), files outside the allowed paths trigger user-facing delete-confirmation dialogs that break the experience. If you need a scratch script, write it to `{tmp_dir}/` and execute from there.

## Key Differences from Other Routes

| Aspect | create-library | create-from-scratch | create-from-structured-spec |
|--------|---------------|--------------------|-----------------------------|
| Data source | Bundle (ground truth) | User description (AI inference) | Structured doc (deterministic extraction) |
| Token generation | Copy from bundle | AI derives scales | Extract from doc verbatim |
| Naming | Brand-prefix from bundle | M3 + brand-prefix (AI) | **Preserve source naming** |
| Dark mode | From bundle themes | AI derives from light | From doc (preserve as-is; NO auto-derive) |
| Components | From bundle index | 6 preset by product type | Default full generation unless skipSet opts out |
| CSS comments | `/* Source */` / `/* Derived */` | `/* AI-generated */` | `/* Source: structured-spec */` |

## Flow

### Step 1 — Parse Structured Input (Main Agent)

Analyze the provided document to extract:

1. **Input Format Classification**:

| Format | Identification |
|--------|---------------|
| Markdown token tables | Headers + rows with variable names and hex/rem values |
| CSS variables | `:root { --name: value; }` blocks |
| JSON tokens | `{ "color": { ... }, "spacing": { ... } }` structured objects |
| Design system doc | Mixed prose + token definitions + component specs |
| .design project CSS | `colors_and_type.css` located inside a `.design` project directory (sibling of `{name}.design` entry file); token names follow brand-prefix pattern; accompanied by `pages/*.html` showing actual component usage |

2. **Extract BrandProfile**:

```json
{
  "productType": "<inferred from doc context>",
  "confidence": "high",
  "personality": ["<from doc tone>"],
  "language": "<doc language>",
  "visualTone": "<from doc description>",
  "kitType": "<inferred>",
  "colorNamingPrefix": "<from token naming pattern or product name>",
  "source": "structured-spec"
}
```

3. **Determine Token Naming System**:
   - Identify the naming convention used (e.g., `--bg-*`, `--text-*`, `--border-*` grouping; or `--color-primary-*` scale pattern)
   - Record prefix/group structure for preservation

4. **Determine Theme Mode**:
   - **Dark-only**: Document defines only dark theme tokens → output will use `:root` with dark values, no `.dark` block
   - **Light + Dark**: Document defines both → normal `:root` (light) + `.dark` (overrides)
   - **Light-only**: Document defines only light → `:root` (light) only; `.dark {}` block omitted. Add `/* @light-only */` comment. If user explicitly requests dark mode generation, then AI may derive `.dark` (marked `/* AI-generated */`).

5. **Determine Skip Set** (MANDATORY):

   > **SSOT**: See `SKILL.md` § Skip Set for the signal table and dependency rules. Parse user request per that table → construct `skipSet` (default = **empty**, i.e. generate ALL).

   **Call guidance** (see `decision-rules.md` § Call Budget by Route):
   - Typical: 15–45 calls depending on component count.
   - Do NOT compress or skip phases to reduce call count.

### Step 1a — Persist Source Spec

Copy the user-provided specification file(s) into `{output_dir}/specs/` to preserve the original input as reference material for future refinement and expansion workflows.

```bash
mkdir -p {output_dir}/specs
cp <user_provided_spec_file> {output_dir}/specs/
```

- If user provided a single `.md` file → copy it as-is (preserve original filename)
- If user pasted inline content (no file path) → write it to `{output_dir}/specs/source-spec.md`
- If user provided multiple files → copy all to `{output_dir}/specs/`
- This step does NOT count toward the call budget (it's a trivial filesystem operation)

> This ensures the `specs/` directory (defined in `file-specs/design-library-output.md` as user-maintained context) contains the original design specification for downstream workflows (`expand-components`, `refine-library`) to reference.

### Step 1.5 — [Conditional] Component Pattern Extraction from .design Pages

**Only execute when input source is a `.design` project (identified by `colors_and_type.css` residing next to a `{name}.design` entry file).**

The `.design` project's HTML pages contain real-world usage of the tokens — use them as evidence for component selection instead of relying solely on product-type presets.

**Procedure**:
1. Read the `.design` entry JSON to get the page list (`data[].devMetadata.htmlSrc`)
2. Read up to 3 representative pages (prefer: index/home + 1 feature page + 1 secondary page)
3. Identify recurring UI patterns:
   - Component types observed (Button, Card, Input, Navigation, Modal, Table, etc.)
   - Variant patterns (sizes, states, color variants)
   - Layout conventions (grid rhythm, spacing patterns)
4. Record findings as component candidates for Step 4

**Budget**: ≤3 page reads. Do NOT read all pages.

**Outcome**: If ≥4 component types identified from pages → use them as component list (skip presets in Step 4). If <4 → supplement with product-type presets.

### Step 2 — Transform Tokens (Sub-Agent ×1)

Dispatch a single parse-and-transform sub-agent. Template: `examples/templates/phase-2-structured-spec.md`.

**Sub-agent writes**:
1. `{output_dir}/colors_and_type.css` — following the Structure Order in `file-specs/css-tokens.md` with these overrides:
   - **Preserve source token names verbatim** (do NOT rename to ThemeStyleProps/M3)
   - Mark all tokens with `/* Source: structured-spec */`
   - Preserve source token names/values in the definition layer, but add portable aliases in the same CSS file when components/previews/UIKit will be generated
   - Portable aliases (`--color-*`, `--radius-*`, `--type-*`, and other consumer-facing variables required by `file-specs/css-tokens.md`) are the preferred runtime variables for component JSON, previews, docs, and UIKit
   - Handle dark-only: if `themeMode === "dark-only"`, write `:root {}` with dark values; omit `.dark {}` block; **add `/* @dark-only */` comment** in the file header so the validator skips the `.dark {}` check
   - Handle light-only: if `themeMode === "light-only"`, write `:root {}` with light values; omit `.dark {}` block; **add `/* @light-only */` comment**
   - Do NOT generate color scales (50-900) unless the source explicitly defines them

**Sub-agent MUST NOT write**: `css.json` — it is derived by Main Agent deterministic script in Step 2b.

**Sub-agent completion contract**: write `writtenFiles`, compact summary, token count, group list, and warnings to `ReturnReportFileAbs: {tmp_dir}/agent-reports/phase2-structured-token-gen.json`; final response must be only `已完成 Token 转换。`.

> [CRITICAL — NEVER SKIP] Step 2b is a hard requirement. If sub-agent already wrote a css.json, DELETE it and regenerate via script. Sub-agents are FORBIDDEN from writing css.json.

### Step 2b — Derive css.json (Main Agent, after sub-agent returns)

Main Agent runs the deterministic script to derive output from the authoritative CSS:
```bash
node {SKILL_DIR}/scripts/css-to-json.mjs {output_dir}/colors_and_type.css --output {output_dir}/css.json
```

This ensures `css.json` is 100% in-sync with the CSS source. Sub-agents read `colors_and_type.css` directly for CSS variable names.

### Step 3 — [Optional] Generate Components

> **Phase Guard**: `if "components" in skipSet → SKIP this step entirely. Proceed to Step 5 docs.`

Default behavior is to generate components. Skip only when `components` is in skipSet.

> **Component Selection**: See `decision-rules.md` § Component Selection Priority.

If generating components:
1. Confirm portable aliases already exist in `colors_and_type.css` from Step 2. If missing, STOP and fix the token transform template; do not patch aliases in component or UIKit stages.
2. Select 6 components from product-type preset or `.design` page evidence.
3. Write `components/index.json` + compact schema v2 `components/{slug}.json`.
4. Dispatch preview sub-agents using `examples/templates/phase-3-4-component.md`.

#### ⚠️ MANDATORY: Task Parallel Dispatch for Component Previews

```
FORBIDDEN: Writing preview HTML files directly in Main Agent context.
FORBIDDEN: Reading colors_and_type.css in Main Agent to generate preview content.
MANDATORY: ALL component preview HTML MUST be generated via Task tool dispatches.
```

**Dispatch topology (1 component = 1 Task, NEVER bundle multiple components into one Task)**:
- Each turn dispatches up to 3 Task calls in parallel (1 component per Task).
- Continue turn-by-turn until all components are dispatched.
- Example: 10 components → Turn 1: Task(A) + Task(B) + Task(C), Turn 2: Task(D) + Task(E) + Task(F), Turn 3: Task(G) + Task(H) + Task(I), Turn 4: Task(J).
- Each Task `subagent_type` = `"general_purpose_task"`

⚠️ FORBIDDEN: Combining multiple components into a single Task query.

**Component JSON contract**:
- `components/{slug}.json` is the primary contract file for this route.
- Each slug JSON MUST include `schemaVersion: 2`, `sourceKind: "structured-spec"`, `confidence`, `semanticTypeCandidates`, `variantDimensions`, `representativeVariants`, `anatomy`, `structurePatterns`, `usageHints`, `doNotInvent`, and `unknowns`.
- Single file target ≤8KB, hard cap 12KB.
- `confidence` is at most `medium` unless the user-provided source explicitly contains component specifications.
- Traits and examples MUST prefer portable aliases defined in `{output_dir}/colors_and_type.css`; do not invent aliases or token values. Source token names may be recorded as provenance metadata only.

**Inline context in Task query** (to eliminate redundant sub-agent Read calls):
- Include CSS variable names from `{output_dir}/colors_and_type.css` inline in the Task query
- Include `colors_and_type.css` path (sub-agents will Read it once)
- Include the component's `{slug}.json` content inline (avoids sub-agent Read)

**File creation**: Sub-agents MUST use `Write` tool (not `apply_patch`) for new preview HTML files. `apply_patch` is only for modifying existing files.

**Example Task dispatch pattern**:
```
// In a SINGLE message, dispatch 3 parallel Tasks:
Task(description="Generate button preview", subagent_type="general_purpose_task", query="...")
Task(description="Generate card preview", subagent_type="general_purpose_task", query="...")
Task(description="Generate table preview", subagent_type="general_purpose_task", query="...")
```

### Step 4 — Generate Documentation (Sub-Agent ×2)

> **Phase Guard**: This step always executes (docs are never skippable).

**Before dispatching docs**: Run component CSS extraction when components were generated:

```bash
node {SKILL_DIR}/scripts/extract-components-css.mjs {output_dir}
```

This produces `{output_dir}/components.css` — the aggregated component CSS file with DOM anatomy comments. It is a required input for docs and UIKit.

Dispatch docs sub-agents (SKILL.md + README.md in parallel) using `examples/templates/phase-5-docs.md`. If previews are generated, docs MUST wait until all preview batches have returned, and docs consume CSS + component index + preview artifact list.

Generate `SKILL.md` + `README.md` following `file-specs/documentation.md`:

- **SKILL.md**: Brand Essentials section references portable aliases for usage and source token names for provenance
- **README.md**: Include token inventory, naming convention explanation, and usage examples with portable aliases first
- Both docs respect the library's actual naming system while teaching the unified consumption layer

**Task query MUST include**:
- `generatedArtifacts`: complete list of files that exist in `{output_dir}` at this point
- `skipSet`: phases that were skipped (for adaptive content — see template Adaptive Content Rules)
- `CSSFile`: `{output_dir}/colors_and_type.css` (ALWAYS provided)
- `ComponentIndexFile`: `{output_dir}/components/index.json` (OMIT if components skipped)
- `PreviewFiles`: generated preview artifact list (OMIT if previews skipped)
- `ReturnReportFileAbs`: `{tmp_dir}/agent-reports/phase4-docs-{skill|readme}.json`

### Step 4.5 — UIKit Plan + UIKit Generation (conditional)

> **Phase Guard**: if `uikit` in skipSet OR `components` in skipSet → SKIP this step.

When components were generated in Step 3 and `uikit` is NOT in skipSet, generate and validate `uikit-plan.json` after docs complete:

```bash
node {SKILL_DIR}/scripts/generate-uikit-plan.mjs --component-index {output_dir}/components/index.json --components-dir {output_dir}/components --available-vars {output_dir}/colors_and_type.css --components-css {output_dir}/components.css --out {output_dir}/uikit-plan.json
node {SKILL_DIR}/scripts/validate-uikit-plan.mjs --plan {output_dir}/uikit-plan.json --component-index {output_dir}/components/index.json --components-dir {output_dir}/components --out {output_dir}/uikit-plan.json
```

Then dispatch UIKit sub-agent:

- Template: `examples/templates/phase-4-ui-kit.md`
- Input: CSSPath (relative from ui_kits/{kitType}/ to library root), CSSFile, component contracts from Step 3, PreviewReferences, DocsFiles, UIKitPlanFile
- kitType: determined from Step 1.5 device context or defaults to `dashboard`

Do NOT dispatch UIKit in parallel with docs. UIKit depends on completed docs and `uikit-plan.json`.

### Step 5 — Quality Gate & Complete

Run validator:
```bash
node {SKILL_DIR}/scripts/validate-design-library-output.mjs {output_dir}
```

**Expected behavior with validator**:
- `components/index.json` missing → warning (not failure) when `components/` directory does not exist
- `.dark {}` block missing → allowed when CSS contains `/* @dark-only */` comment
- `css.json` 6 top-level keys (`color`, `font`, `shadow`, `radius`, `spacing`, `size`) → still required (hard check)
- `SKILL.md` + `README.md` → still required (hard check)
- `colors_and_type.css` with `:root` → still required (hard check)

## Call Budget Self-Check (MANDATORY)

This is the **graceful-degradation protocol** for this route (the hard layer per `decision-rules.md` § Call Budget by Route — distinct from the soft 15–45 guidance there). Hard checkpoint: 40 calls.

Main Agent MUST track its own call count and enforce the budget:

| Checkpoint | Condition | Action |
|-----------|-----------|--------|
| After Step 2b | call_count > budget × 0.5 | EMIT internal warning, consolidate remaining steps |
| After Step 4 | call_count > budget × 0.7 | Switch to minimal mode: single-call docs, skip UIKit |
| Any point | call_count ≥ budget (40) | Enter the **Controlled Stop Sequence** (SKILL.md invariant #26): ensure css.json → run validator once → output whatever is complete → stop |

**Anti-patterns to avoid** (observed failure modes):
- Reading the same file multiple times in main context (use inline context in Task queries)
- LS/Glob calls to verify directories that were just created (trust mkdir -p)
- Empty "thinking" turns that produce no tool calls (always combine reasoning with action)
- Generating preview HTML directly instead of dispatching Tasks

## Constraints

- **NEVER rename source tokens** — the input naming is authoritative
- **NEVER generate color scales** that don't exist in the source document
- **NEVER fabricate token values** — only transform what the source provides
- When components are generated, portable aliases are required and must be written in Step 2
- If source has gaps (e.g., no spacing tokens), note in README.md but do NOT invent values
- User can later expand components via `workflows/expand-components.md`
- User can refine tokens via `workflows/refine-library.md`
- Product type presets for components are starting points — prioritize user's explicit instructions

## Conversation Continuity

After `complete`, suggest:
- "Add components to see your tokens in action" → `expand-components`
- "Refine or add missing token categories" → `refine-library`
- "Generate a UI Kit page" → `generate-additional-kit`
