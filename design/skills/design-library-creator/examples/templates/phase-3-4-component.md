# Phase 3 Component Sub-Agent — Manual Evidence/Legacy Fallback

> **Deprecated for `create-library` route auto-retry**: Do not dispatch this template automatically after intent validation failure in `create-library`.
> Active for `create-from-scratch` and `create-from-structured-spec` routes (automatic Phase 3 dispatch).
> Use for `create-library` only when the user explicitly asks for a manual preview-only fallback for a specific component.
> **Dispatch topology**: component sub-agents are dispatched in batches with at most 3 Task calls per round. No CSS task exists in create-library; CSS is copied from the bundle.
> Each fallback sub-agent generates a **preview HTML page only** (no component doc, no intent JSON).

---

## Evidence/Legacy-Mode PreviewContract (MANUAL FALLBACK — when intent JSON is absent)

> Used only for explicit manual repair requests. Validation warnings/failures must not automatically trigger this path.

## PreviewContract: Full Task Query Format (Main Agent copies this for each component)

```
Task: Generate component preview "{Name}" (slug: {slug}).
MANDATORY READS (in order):
  1. {SKILL_DIR}/file-specs/preview-pages.md — ALL layout/structure/CSS constraints (MUST follow every rule)
  2. {output_dir}/colors_and_type.css — CSS variable definitions (SSOT for all allowed variables)
  3. {ComponentContractFile} — resolved component contract
ComponentContractKind: {evidence|compact-json|legacy-json}
[IF ComponentContractKind ≠ evidence] ComponentDebugFile: {output_dir}/components/{slug}.json
[NOTE: When ComponentContractKind=evidence, OMIT the ComponentDebugFile line entirely — sub-agent must not see this path]
OUTPUT: {output_dir}/preview/component-{slug}.html
CSS link (EXACT): <link rel="stylesheet" href="../colors_and_type.css">
BrandName: {libraryName}
Language: {language}
ProductType: {productType}
Copy source: use only ComponentContractFile `sourceSignals.uiCopySamples`, `visualSpecs.*.text`, `childrenDigest`, or conservative accessibility labels required by semantic HTML. Do NOT paste global UI copy samples into fallback tasks.
Forbidden tools: TodoWrite, Skill, LS, Glob, Grep, RunCommand, SearchCodebase
ReturnReportFileAbs: {tmp_dir}/agent-reports/phase3-component-{slug}.json

Completion contract:
1. Write the preview HTML to disk.
2. Write this JSON to ReturnReportFileAbs: {"writtenFiles":["preview/component-{slug}.html"],"warnings":[],"undefinedCssVars":0}
3. Final response: `已完成组件预览。`
Do NOT return JSON, file paths, stats, warnings arrays, analysis, or markdown in the final response.
```

---

## Key Points for Main Agent

1. Normal create-library execution uses `phase-2.5-intent-synthesis.md`; use this file only for Evidence/Legacy fallback.
2. **DO NOT inline PreviewContract** — Sub-Agent reads `file-specs/preview-pages.md` directly. This eliminates compression/translation risk.
3. **DO NOT inline CSS variables** — Sub-Agent reads `colors_and_type.css` directly and extracts the exact custom-property allowlist.
4. **DO NOT require reading `component-dispatch-rules.md`** in normal create-library execution.
5. The fallback query MUST preserve the full PreviewContract above. Do not compress it into a short summary.
6. All fallback preview tasks use the SAME format — only `{Name}`, `{slug}`, and resolved paths differ.
7. **NO component doc (.md) generation** — the Main Agent resolves one `ComponentContractFile`; full Figma component JSON is debug/refine only when evidence exists.
8. All component sub-agents read the SAME `colors_and_type.css` directly as the single source of truth for allowed CSS variables.
9. `cssVariables[]` entries are exact custom property names without `--`; component sub-agents MUST NOT normalize names to Tailwind/Material scales.
10. **subagent_type MUST be `"general_purpose_task"`** — component sub-agents Write HTML files; "Explore" type cannot write.
11. **Query language rule**: File paths, tool names, and format constraints stay in English. Only BrandName/description use the user's language.

---

## Sub-Agent Execution Constraints (MANDATORY)

```
⚠️ HARD LIMITS (non-negotiable):
- BANNED tools: TodoWrite, Skill, LS, Glob, Grep, RunCommand, SearchCodebase
- MAX CALLS: 5 (target 3)
- NO self-scan, NO verification, NO planning steps
- SILENT: Do NOT output intermediate reasoning or status text between tool calls. After writing the report file, final-respond only `已完成组件预览。`.
- Post-generation quality checks are handled by the Phase 5 validator
- If you need more than 5 calls, you are doing it wrong — STOP and return with warning
```

### Theme Conformity (MANDATORY)

```
⚠️ THEME TOKEN USAGE (non-negotiable):
- Component preview HTML MUST use ONLY CSS variables from colors_and_type.css
  for colors, radius, spacing, and shadows.
- Every `var(--name)` usage must resolve to colors_and_type.css. Do not declare or use local alias variables such as `--bd`, `--rad`, `--bg2`, `--brand`, or `--on`.
- HARDCODED VALUES ARE FORBIDDEN when a matching CSS variable exists:
  ✗ border-radius: 16px;        → ✓ border-radius: var(--radius-lg);
  ✗ padding: 24px;              → ✓ padding: var(--space-6);
  ✗ color: #2d6a4f;             → ✓ color: var(--color-primary);
  ✗ box-shadow: 0 4px 8px ...;  → ✓ box-shadow: var(--shadow-3);
- Exception: layout-only values (width, height, grid-template) may use px/% when
  no matching --space-* or --layout-* variable exists.
- If no matching variable exists, use the closest available variable or note it in warnings.
```

⚠️ CLARIFICATION on Theme Conformity:
- The ✓ examples above show correct token usage ONLY WHEN evidence provides that property.
- If evidence has `radius=16` and `colors_and_type.css` declares `--radius-lg: 16px` → use `var(--radius-lg)` ✓
- If evidence has NO radius → adding `var(--radius-lg)` is FABRICATION ✗
- Theme Conformity = "use tokens to express evidence values", NOT "decorate with tokens"
- When in doubt: check `traits` object. No key = no CSS property.

### Render Contract Fidelity (MANDATORY when ComponentContractKind=evidence)

> **Applicability**: The field names below (`renderPlan.samples`, `visualSpecs.*`, `sourceSignals.*`) apply only to **legacy contractKind evidence**. v6 `renderFacts` evidence follows the consumption rules in `phase-2.5-intent-synthesis.md` instead.

```
⚠️ PIXEL-PERFECT FIDELITY RULE:
- When rendering a component, the PRIMARY source of truth for CSS values is:
  renderPlan.samples + visualSpecs.primary / visualSpecs.sizes / visualSpecs.states / visualSpecs.variants / visualSpecs.parts.
- Render ONLY samples listed in renderPlan.samples. Do not expand omitted axes or states.
- Simple component allowlist only: `button`, `input`, `checkbox`, `radio`, `switch`, `toggle`, `tag`, `badge`, `avatar`, `progress`, `spinner`, `link`. These may use `variant-gallery` and can show more sampled variants when evidence provides them.
- Everything else is complex by default, including `table`, `select`, `dropdown`, `menu`, `tabs`, `card`, `list`, `accordion`, `autocomplete`, `button-group`, `navigation`, `pagination`, `modal`, `drawer`, `tooltip`, `toast`, `datepicker`, and `timepicker`. Complex components must use `primary-plus-delta` and render only the primary assembly plus listed deltas.
- Do not infer simple/complex from variant count, node count, repeatedGroupCount, maxDepth, or scoring heuristics.
- CSS variable names must come from `colors_and_type.css`, the SSOT for allowed variables. Match raw evidence values (hex, px) to declarations in that file.
- If the raw value matches an available CSS variable, use the variable.
- If neither matches, use the raw px value from traits (exception to the "no hardcoded" rule for fidelity).
- DO NOT "round" or "snap" trait values to styleConstraints.common[] — those are for page layout, not component internals.
```

### Execution Steps

**Call 1**: Read `file-specs/preview-pages.md` (full — contains ALL structural constraints).
**Call 2**: Read `colors_and_type.css` (full) + `ComponentContractFile` (full) in parallel.
**Final Call**: Write preview HTML, write the compact report JSON to `ReturnReportFileAbs`, then STOP with only the short final response `已完成组件预览。`.

⚠️ Large File Strategy:
- ComponentContractFile is a render contract and should be read fully. Size budgets are soft; correctness outranks byte size.
- When the contract path is `_evidence/`, never read `components/{slug}.json` during generation. Use `unknowns` to render conservatively and warn.
- When the contract path is `components/{slug}.json`, it is the primary specification — read it fully.
- `colors_and_type.css` is the CSS variable source of truth — read it fully (no offset/limit needed).
- Preview must render only variants/states represented by `renderPlan.samples` and `visualSpecs` from the resolved contract. Do not invent states or variants not listed in the contract.

---

## Report File Format

```json
{
  "writtenFiles": ["preview/component-{slug}.html"],
  "warnings": [],
  "undefinedCssVars": 0
}
```

Final response MUST NOT be this JSON. The final response is only: `已完成组件预览。`
