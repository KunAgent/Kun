# Create Design Library from Scratch

> Workflow for generating a Design Library when NO Figma bundle data is available.
> Read when: User wants a design system based on text description, reference URL, or specific color/font values — without providing a parsed .fig bundle.

## ⚠️ OVERRIDE INVARIANTS (supersede any conflicting step below)

These rules override all instructions in this workflow. Violations = failed output.

19. **Token sub-agent all-in-one**: Token sub-agent writes ONLY `colors_and_type.css` in one Task. Main Agent MUST run `css-to-json.mjs` after sub-agent returns.
21. **Component data batch write**: All component JSON files (index + per-slug) MUST be written in parallel Write calls in ONE assistant message (7 calls: 1 index + 6 slugs), or a single RunCommand with heredoc. Never individual apply_patches.
22. **Template Pre-Read at start**: Main Agent MUST parallel-read all dispatch templates in the FIRST call after user input is parsed. No subsequent template reads allowed.
**Layer order**: per SKILL.md invariant #30 (Non-Figma Creation Route Layering, including the skipSet exemption): CSS → `css.json` → components → previews → docs → `uikit-plan.json` → UIKit → validation. Docs start only after all requested previews return. UIKit starts only after docs and `uikit-plan.json` exist.

## When to Use

- User says "create a blue tech-style design system" (text description)
- User provides a reference URL/screenshot and says "make something like this"
- User gives specific values: "primary #2563EB, font Inter, radius 8px"
- User asks to "generate a design system" without attaching any bundle

## Phase Overview

| Phase | Executor | Output | Parallelism |
|-------|----------|--------|-------------|
| 0 — Parse Input + Ask User | Main Agent | BrandProfile + product type confirmation | — |
| 1 — Token System | Sub-Agent ×1 | `colors_and_type.css`; Main Agent derives `css.json` via deterministic script; token sub-agent returns `flatTokenSummary` | 1 Task |
| 2 — Component Selection + Orchestration | Main Agent | components/index.json + per-slug JSONs | 1 RunCommand |
| 3 — Component Previews | Sub-Agent batches | ≤6 preview HTML | ≤3 per batch |
| 4a — Documentation | Sub-Agent ×2 | SKILL.md + README.md | 2 parallel |
| 4b — UIKit Plan + UIKit | Script + Sub-Agent ×1 | `uikit-plan.json` + UIKit | sequential gate + 1 Task |
| 5 — Quality Gate & Complete | Main Agent | Validation + complete + cleanup | — |

## Output Directory

`{output_dir}` = `{workspace}/.design_library/{library_name}/` — `{workspace}` is the user's current workspace root; `{library_name}` is derived from user instruction (e.g., product name or style description).

`{tmp_dir}` = `{hidden_tmp_dir}/{library_name}/` — a non-user-visible temporary workspace for intermediate files consumed during generation. `{hidden_tmp_dir}` is a writable, deletable hidden temp area provided by the runtime. MUST NOT be `{output_dir}_tmp` or any visible folder inside the user's workspace. Cleaned up after completion.

> **Directory Separation**: `{output_dir}` contains ONLY final deliverables. `{tmp_dir}` holds intermediate files consumed during generation. Phase 5 cleans up `{tmp_dir}` after successful validation.
>
> **⚠️ HARD RULE — Write Scope Constraint**: Writing ANY file (data, scripts, logs, temp artifacts) to paths outside `{output_dir}` and `{tmp_dir}` is **FORBIDDEN**. This explicitly includes one-off helper scripts (e.g., `parse_forms.py`, `transform.mjs`). On device (Lite), files outside the allowed paths trigger user-facing delete-confirmation dialogs that break the experience. If you need a scratch script, write it to `{tmp_dir}/` and execute from there.

## Key Difference from `create-library.md`

| Aspect | create-library | create-from-scratch |
|--------|---------------|-------------------|
| Data source | Bundle files (ground truth) | User description + AI inference |
| Token generation | Copy from bundle (zero LLM) | Token sub-agent generates all |
| Component data | Copy from bundle | Main Agent writes from presets |
| Phase 3-5 | Same | Same (identical sub-agent templates) |
| Token provenance | Source tokens from bundle | ALL tokens are AI-generated (marked `/* AI-generated */`) |
| Component selection | From bundle `generated/components/index.jsonl` | Based on product type preset |

### TodoWrite Policy (HARD LIMIT)

| Rule | Detail |
|------|--------|
| **HARD CAP = 3** | Maximum 3 TodoWrite calls in entire session |
| **Allowed positions** | Phase 0→1, Phase 2→3, Phase 4→5 ONLY |
| **Batch with actions** | TodoWrite MUST share the tool call batch with the next action (NEVER standalone) |
| **Self-check** | If TodoWrite is the only tool in your response → VIOLATION → delete it and proceed |

---

## Phase 0 — Parse Input + Ask User (Main Agent)

> **User output**: "What type of product is this design system for?" / "Let me analyze your design description..."

### Step 0.1 — Classify Input

Classify user input type and extract design signals:

| Input Type | What to Extract |
|-----------|----------------|
| Text description ("蓝色科技风 dashboard") | Keywords: color tone, style, industry, product type |
| Reference URL | Use `WebFetch` if available to analyze dominant colors, typography, layout patterns |
| Specific values ("#2563EB, Inter, 8px") | Direct token values |
| Screenshot/image | Describe visual characteristics from the image |

### Reference URL Fallback

`WebFetch` is optional and may not exist in every agent runtime.

If the user provides a URL and `WebFetch` is available:
- Fetch the page
- Extract observable colors, typography, layout patterns, content tone, and product category
- Treat these observations as reference inspiration, not bundle ground truth

If the user provides a URL and `WebFetch` is NOT available:
- Do NOT fabricate page content, colors, fonts, screenshots, or brand claims
- Ask the user for a screenshot, short visual summary, or key design values
- If the user wants to proceed without more input, continue from the explicit text prompt only

### Step 0.2 — Confirm Product Type (Capability-Aware)

If product type is not explicitly stated:
- Use `AskUserQuestion` when the runtime provides it.
- If `AskUserQuestion` is unavailable, ask one concise clarification question in a normal response.
- If the user input already provides enough signal, do not ask.

Options: Dashboard | E-commerce | SaaS | Mobile App | Marketing/Landing | General

### Step 0.2b — Determine Skip Set (MANDATORY)

> **SSOT**: See `SKILL.md` § Skip Set for signal table and dependency rules.

Parse user request per SKILL.md signal table → construct `skipSet`.

**Simplified Flow** (when `components` in skipSet):

| Phase | Action |
|-------|--------|
| 0 | Parse Input + Ask User (unchanged) |
| 1 | Token System (unchanged) |
| 2 | **SKIP** (no component selection) |
| 3 | **SKIP** (no previews) |
| 4 | Docs only (no UIKit) |
| 5 | Quality Gate (unchanged) |

### Step 0.3 — Template Pre-Read (MANDATORY — same call as AskUser or immediately after)

Parallel-read ALL dispatch templates at the START of execution:

| Template | Used In |
|----------|---------|
| `examples/templates/scratch-token-gen.md` | Phase 1 token sub-agent |
| `examples/templates/phase-3-4-component.md` | Phase 3 component tasks |
| `examples/templates/phase-5-docs.md` | Phase 4 documentation |

> Do NOT pre-read `examples/templates/phase-4-ui-kit.md` — per its DISPATCH DIRECTIVE and SKILL.md Read Budgets, the UIKit sub-agent reads that template itself; the Phase 4 Task query only contains parameters and the template path.

**After this step**: Main Agent has all templates cached in context. DO NOT re-read any templates before dispatch. DO NOT read `file-specs/*.md` — those paths are passed to sub-agents who read them themselves.

---

## Phase 1 — Token System (Sub-Agent ×1)

> **User output**: "Generating design tokens..."

### Step 1.1 — Write BrandProfile

After user confirms product type, produce a **BrandProfile** and write it to `{tmp_dir}/phase2-brand-analyst.json`:

```json
{
  "productType": "SaaS Dashboard",
  "confidence": "medium",
  "personality": ["professional", "clean", "data-focused"],
  "language": "en",
  "visualTone": "cool blue tones on white canvas, minimal shadows, sharp geometry",
  "kitType": "dashboard",
  "colorNamingPrefix": "atlas",
  "uiCopySamples": ["Dashboard", "Analytics", "Team Members", "Settings", "Export Report"]
}
```

### Step 1.2 — Dispatch Token Sub-Agent

Dispatch ONE token-generation sub-agent using template from `examples/templates/scratch-token-gen.md`. The sub-agent writes:
1. `{output_dir}/colors_and_type.css` — complete CSS with :root + .dark, font imports, all scales

Task query MUST include:
- BrandProfile (the JSON from Step 1.1, passed inline — it's ≤ 300 tokens)
- Constraint file PATH (not content): `{SKILL_DIR}/file-specs/css-tokens.md`
- Output path for the CSS file
- ReturnReportFileAbs: `{tmp_dir}/agent-reports/phase2-token-gen.json`

⚠️ Main Agent MUST after token sub-agent returns:
- Run deterministic script:
  1. `node {SKILL_DIR}/scripts/css-to-json.mjs {output_dir}/colors_and_type.css --output {output_dir}/css.json`
- This script derives `css.json` from CSS ground truth — 0 LLM cost, 100% in-sync.

⚠️ Main Agent MUST NOT after token sub-agent returns:
  - Read the token sub-agent's output files (css, etc.)
  - Print the token sub-agent's report JSON or final response details to the user
- Verify or "fix" the token sub-agent's output
- Run ad-hoc python/node scripts to infer, patch, or rewrite tokens (the two specified scripts above are mandatory deterministic projections, not LLM re-derivation)

### Step 1.3 — Token Derivation Checkpoint (BLOCKING)

⚠️ **BLOCKING**: Do NOT proceed to Phase 2 until ALL assertions pass.

After running the deterministic script, Main Agent MUST verify:
- [ ] `{output_dir}/css.json` exists (RunCommand: `test -f "{output_dir}/css.json" && echo OK`)

**If the file is missing**:
1. Re-run the failed script (only 1 retry allowed)
2. If still missing → STOP with error: "Token derivation failed: css.json not generated"
3. Do NOT proceed to Phase 2

This checkpoint costs 1 call. It is NON-NEGOTIABLE and cannot be optimized away.

---

## Phase 2 — Component Selection + Orchestration (Main Agent)

> **User output**: "Selecting components and preparing generation..."

### Step 2.1 — Select Components from Preset

Without bundle data, use product-type presets:

| Product Type | Recommended Components (6) |
|-------------|---------------------------|
| Dashboard | Button, Card, Table, Chart, Navigation, Sidebar |
| E-commerce | Button, Card, ProductCard, Cart, Navigation, Input |
| SaaS | Button, Card, Input, Table, Navigation, Modal |
| Mobile App | Button, Card, BottomNav, Input, Avatar, Chip |
| Marketing/Landing | Button, Card, Input, Badge, CTA-Link, Navigation |
| General (default) | Button, Card, Input, Navigation, Modal, Tag |

### Step 2.2 — Batch Write Component JSONs (parallel Write calls)

Write ALL component data files using parallel `Write` tool calls in ONE assistant message (7 calls: 1 index.json + 6 slug.json). This avoids shell quoting issues with RunCommand.

Use compact component JSON schema v2. Because this route is AI-generated from the start, write only `components/index.json` and `components/{slug}.json` as component contracts.

Alternative (if Write parallel limit is hit): use `RunCommand` with Node.js heredoc:
```bash
node <<'NODEEOF'
const fs = require("fs");
const path = require("path");
const outputDir = "{output_dir}";

const components = [
  { slug: "button", data: { /* ... */ } },
  // ... all component objects
];

fs.mkdirSync(path.join(outputDir, "components"), { recursive: true });
fs.writeFileSync(
  path.join(outputDir, "components", "index.json"),
  JSON.stringify({ components: components.map(c => ({
    slug: c.slug,
    name: c.data.name,
    category: c.data.category,
    sourceKind: c.data.sourceKind,
    confidence: c.data.confidence,
    variantCount: c.data.variantCount,
    priorityHint: c.data.usageHints?.priorityHint,
    keyInsightSeed: c.data.keyInsightSeed
  })) }, null, 2)
);
components.forEach(c => {
  fs.writeFileSync(
    path.join(outputDir, "components", c.slug + ".json"),
    JSON.stringify(c.data, null, 2)
  );
});
NODEEOF
```

> **[NOTE]** Prefer parallel `Write` calls. The Node.js fallback is only for edge cases where the tool parallelism limit is lower than 7. Heredoc avoids shell quoting issues that `node -e '...'` would face with embedded JSON.

Each component JSON contains:
- `slug`: kebab-case (e.g., "ProductCard" → "product-card")
- `schemaVersion`: `2`
- `name`, `category`, `sourceKind: "from-scratch"`, `confidence: "medium" | "low"`
- `semanticTypeCandidates`: 1-3 candidates with evidence; do not rely on name alone
- `variantDimensions`: compact dimension definitions, not a full cartesian expansion
- `representativeVariants`: 2-4 high-value variants with `whySelected`, `traits`, and `childrenDigest`
- `anatomy`, `structurePatterns`, `usageHints`, `doNotInvent`, `unknowns`
- `keyInsightSeed`: one short phrase for docs/orchestration summaries

Size budget:
- Target ≤8KB per `components/{slug}.json`
- Hard cap 12KB
- Prefer deleting low-value variants over bloating the file
- `components/{slug}.json` is the primary contract file for this route.

⚠️ This is a ONE-SHOT batch write. Do NOT apply_patch individual files.

### Step 2.3 — Dispatch Phase 3 Batch 1 (same assistant message)

In the SAME assistant message as component index write, dispatch Phase 3 Batch 1 (up to 3 component Tasks).

---

## Phase 3 — Component Previews (Task batches, ZERO post-processing)

> **User output**: silent by default. Do not announce component preview batches unless verbose/debug mode is active.

### CRITICAL EXECUTION RULES

1. Main Agent dispatches Task calls ONLY — no Read, no apply_patch, no RunCommand in Phase 3
2. After batch returns, read each `{tmp_dir}/agent-reports/phase3-component-{slug}.json` once and collect `writtenFiles` — do NOT Read the HTML files
3. If a sub-agent returns warnings, record them — do NOT "fix" them
4. The ONLY acceptable Main Agent actions in Phase 3 are: Task dispatch, text response

### Batch 1: First 3 Components

Dispatch up to 3 component Tasks using template from `examples/templates/phase-3-4-component.md`.

Each sub-agent generates ONLY `preview/component-{slug}.html`. Fill per component:

```
Task: Generate component preview "{Name}" (slug: {slug}).
PreviewContract:
  - Write exactly: {output_dir}/preview/component-{slug}.html
  - CSS link exactly: <link rel="stylesheet" href="../colors_and_type.css">
  - Read only: ComponentContractFile + CSSFile + {SKILL_DIR}/file-specs/preview-pages.md
  - Forbidden tools (per SKILL.md invariant #16): TodoWrite, Skill, Grep, RunCommand, SearchCodebase; this task additionally forbids LS, Glob
  - Forbidden after Write: Read/Grep/verification/read-back
  - HTML: ≤4KB, ≤2 row groups, no script, no theme toggle, no page header, no inline token CSS
  - Links: all <a> elements MUST use href="#" or no href — preview is visual-only, NEVER navigates to real URLs.
  - CSS vars: only names defined in CSSFile (colors_and_type.css), no hex fallback
    - ReturnReportFileAbs: {tmp_dir}/agent-reports/phase3-component-{slug}.json
    - Completion: write {"writtenFiles":["preview/component-{slug}.html"],"warnings":[],"undefinedCssVars":0} to ReturnReportFileAbs, then final-respond only "已完成组件预览。"
Data:
  - ComponentContractFile: {output_dir}/components/{slug}.json
  - CSSFile: {output_dir}/colors_and_type.css
  - BrandName: {libraryName}
  - Language: {language}
  - ProductType: {productType}
  - UICopySamples: {uiCopySamples array, ≤5 items}
```

### Batch 2: Remaining Components (if shortlist > 3)

After Batch 1 returns, dispatch remaining components (up to 3 more Tasks) in the NEXT assistant message.

### After ALL Phase 3 Returns

Extract component CSS for UIKit consumption:
```bash
node {SKILL_DIR}/scripts/extract-components-css.mjs {output_dir}
```

Main Agent proceeds to Phase 4a. Do NOT dispatch docs before all requested preview batches have returned.

---

## Phase 4a — Documentation (Sub-Agent ×2, ZERO post-processing)

> **User output**: "Generating documentation..."

Dispatch docs sub-agents in parallel using `examples/templates/phase-5-docs.md`:

- 1× SKILL.md (writes `SKILL.md`)
- 1× README.md (writes `README.md`)

Pass intermediate file paths for sub-agents to Read from disk:
- `BrandDataFile`: `{tmp_dir}/phase2-brand-analyst.json`
- `CSSFile`: `{output_dir}/colors_and_type.css`
- `ComponentIndexFile`: `{output_dir}/components/index.json` — **OMIT if `components` in skipSet**
- `skipSet`: pass to docs sub-agents for Adaptive Content Rules

### Phase 4b — Sample Page Plan + Sample Page (Script gate + Sub-Agent ×1)

> **Phase Guard (UIKit)**: if `uikit` in skipSet OR `components` in skipSet → skip this phase.

After docs return, generate and validate the deterministic UIKit plan from compact component contracts:

```bash
node {SKILL_DIR}/scripts/generate-uikit-plan.mjs --component-index {output_dir}/components/index.json --components-dir {output_dir}/components --brand-data {tmp_dir}/phase2-brand-analyst.json --available-vars {output_dir}/colors_and_type.css --components-css {output_dir}/components.css --out {output_dir}/uikit-plan.json
node {SKILL_DIR}/scripts/validate-uikit-plan.mjs --plan {output_dir}/uikit-plan.json --component-index {output_dir}/components/index.json --components-dir {output_dir}/components --out {output_dir}/uikit-plan.json
```

Then dispatch exactly one UI Kit sub-agent using `examples/templates/phase-4-ui-kit.md`:

- 1× UI Kit (writes `ui_kits/{kitType}/index.html`)

Pass intermediate file paths for the sub-agent to Read from disk:
- `BrandDataFile`: `{tmp_dir}/phase2-brand-analyst.json`
- `CSSFile`: `{output_dir}/colors_and_type.css`
- `CSSLink`: `../../colors_and_type.css`
- `ComponentIndexFile`: `{output_dir}/components/index.json`
- `ComponentContractFiles`: `{output_dir}/components/{slug}.json` for slugs in `uikit-plan.json`
- `UIKitPlanFile`: `{output_dir}/uikit-plan.json`
- `DocsFiles`: `{output_dir}/README.md`, `{output_dir}/SKILL.md`

Do not generate UIKit without `uikit-plan.json`.

### After Phase 4 Returns

CRITICAL — the following are FORBIDDEN after Phase 4 sub-agents return:
- Reading SKILL.md, README.md, or index.html into context
- apply_patch on any sub-agent generated file
- Dispatching additional "fix" Tasks
- Running Grep to check content quality
- **ANY read-verify-patch cycle on the same file** (UIKit fix loop indicator)

**Loop Detection Rule**: ANY Read of `ui_kits/*/index.html` after Phase 4 dispatch is a violation (zero tolerance, consistent with the FORBIDDEN list above) → STOP Phase 4, proceed to Phase 5.

Main Agent MUST only:
1. Collect `writtenFiles` from all `{tmp_dir}/agent-reports/*.json` reports
2. Proceed **immediately** to Phase 5 (validator will catch real issues)

---

## Phase 5 — Quality Gate & Complete (Main Agent, NO fix loop)

> **User output**: zh: "正在检查..." / "设计系统已生成完成。" — en: "Validating..." / "Design Library generation complete."

### Validation (single run)

Run the final validator:
```bash
node {SKILL_DIR}/scripts/validate-design-library-output.mjs {output_dir}
```

### If validator passes (exit code 0):

Clean up: Delete `{tmp_dir}` and all its contents. This step is non-blocking.

### If validator fails (exit code ≠ 0):

Enter the Controlled Stop Sequence (SKILL.md invariant #26): ensure `css.json` exists (run `css-to-json.mjs` if missing), then report a **failed completion summary** with the validator's compact JSON output and stop. Do NOT:
- Read generated files to "understand" the issue
- apply_patch to fix CSS links or JSON structure
- Dispatch "fix" Tasks
- Re-run the validator (beyond the single run already performed; exception: if `css-to-json.mjs` had to be run inside the stop sequence, one re-run is allowed)

**Rationale**: from-scratch quality is guaranteed by sub-agent prompts. If the validator fails, the sub-agent template needs improvement — not a runtime patch.

---

## Constraints

- ALL token values are AI inference — mark with `/* AI-generated */` in CSS (NOT `/* Source */`)
- Component variants are based on common patterns, not actual Figma data — be explicit about this in README.md
- Do NOT fabricate fictional "bundle data" or pretend to have read non-existent files
- User can later refine any generated output via `workflows/refine-library.md`
- User can expand component coverage via `workflows/expand-components.md`
- Product type presets are starting points — if user provides more specific information, prioritize that over presets

## Anti-Patterns (FORBIDDEN)

> See `operation-policies/agent-orchestration.md` § From-Scratch Anti-Patterns for the full list with production trace evidence.
>
> Summary: No post-Phase-0 file exploration, no Main Agent token writes, no serial component JSON, no Main Agent HTML writes, no Phase 4 post-processing, no Phase 5 fix loops.

---

## Call Budget Self-Check (MANDATORY)

This is the **graceful-degradation protocol** for this route (the hard layer per `decision-rules.md` § Call Budget by Route — distinct from the soft 20–55 guidance there). Hard checkpoint: 50 calls.

Main Agent MUST track its call count and enforce:

| Checkpoint | Condition | Action |
|-----------|-----------|--------|
| After Phase 1 (Step 1.3) | call_count > 15 | EMIT internal warning, consolidate remaining steps |
| After Phase 3 Batch 2 | call_count > 35 | Switch to minimal mode: skip UIKit, single-call docs only |
| After Phase 4 returns | call_count > 45 | **Do NOT re-enter Phase 4 for fixes**. Proceed directly to Phase 5 |
| Any point | call_count ≥ 50 | **STOP** — but FIRST ensure css.json exists (run script if needed), THEN run validator, THEN stop |

### Phase 4 Hard Cap

Phase 4 (UIKit + Documentation) is allocated a maximum of **8 calls** (3 Task dispatches + up to 5 sub-agent calls for returns/processing). If Phase 4 return processing requires > 3 additional calls (e.g., fixing UIKit navigation):
- **STOP fixing immediately**
- Record warning: "UIKit fix loop detected, deferring to user"
- Proceed to Phase 5 with current state

### Budget Exhaustion Protocol (overrides generic "STOP, report partial")

When budget ≥ 50:
1. Check: does `{output_dir}/css.json` exist?
   - NO → Run `css-to-json.mjs` (this 1 call is EXEMPT from budget cap)
   - YES → Continue
2. Run `validate-design-library-output.mjs` (this 1 call is EXEMPT from budget cap)
3. STOP with validator result

Critical-file scripts are budget-exempt. They cost 0 LLM tokens (deterministic) and take <2s.
