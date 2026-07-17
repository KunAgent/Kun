# Phase 4a: Documentation Sub-Task Templates

> Legacy filename note: this template is dispatched in Phase 4a before UIKit. Phase 4b UIKit consumes the completed SKILL.md and README.md. Phase 5 is only Quality Gate + Complete.

## Adaptive Content Rules (applies to both SKILL.md and README.md)

Main Agent passes `generatedArtifacts` and `skipSet` in Task query. Sub-agent MUST:

⚠️ **CRITICAL — GENERATED ARTIFACTS CONTRACT**: The `generatedArtifacts` list is AUTHORITATIVE. Do NOT use Read/Grep/Glob/LS to discover extra files. Trust the declared list as-is and proceed directly to writing your output.

1. **Quick Map / Index**: ONLY list files that appear in the `generatedArtifacts` list
   - If no `preview/` files in the list → omit preview line from Quick Map
   - If no `ui_kits/` files in the list → omit UIKit line from Quick Map
   - If no `components/` files in the list → omit components line from Quick Map
2. **Components section**: ONLY include if `components/index.json` is in `generatedArtifacts`
3. **Input data fallback**:
   - If `BrandFile` not provided → infer brand context from token naming patterns in colors_and_type.css
   - If `ComponentIndexFile` not provided → omit Component Patterns section entirely
4. **Essentials**: ALWAYS derive from `CSSFile` (available after Step 2b)

**Minimum viable docs** (when skipSet = {components, previews, uikit}):
- SKILL.md: frontmatter + Quick Map (3 files only: README.md, colors_and_type.css, css.json) + Essentials (7 lines) ≈ 30 lines
- README.md: Overview + Visual Foundations + Naming Convention + Caveats ≈ 60-80 lines

---

## Phase 4B: SKILL.md

```
Task: Generate the Design Library SKILL.md entry point documentation.
Output:
  - SKILL.md (AI-consumable skill card — YAML frontmatter + Quick Map + Essentials)
  - library-consumption.json (machine-readable downstream read order)

⚠️ HARD RULES (embedded — do NOT skip):
  1. SKILL.md MUST begin with YAML frontmatter: name, description, user-invocable: true
  2. Use the SKELETON below as the compact target shape. Replace {{...}} placeholders with actual data and keep the result concise.
  3. ALL color/radius/spacing values MUST come from BrandFile or {output_dir}/colors_and_type.css — ZERO hallucinated values.
  4. Typography MUST name actual font families (e.g., "PingFang SC", "Roboto") — NEVER write "System Sans" or "系统字体栈"
  5. Read BrandFile FIRST for brand context (personality, language, uiCopySamples). Read {output_dir}/colors_and_type.css for ALL token values (colors, typography, radius, spacing, shadow). Do NOT read the component directory or individual component JSON files.
  6. Write SKILL.md and library-consumption.json to disk, then write the compact report to `ReturnReportFileAbs`. Final response: `已完成设计系统文档。` No verification, no read-back, no extra prose. Line count: 25-50 lines is acceptable. Do NOT count lines. Do NOT read back to verify.

⚠️ AVOID:
  - Component variant details (dimensions, states, sizes)
  - Token system tables (color scales, spacing tables, shadow tables)
  - Design specifications or guidelines
  - Color hex scale listings (e.g., primary-1 through primary-8)
  - Typography tables with font-size/weight/line-height rows
  - "版本信息" / "设计原则" / "使用指南" sections

SKELETON (replace {{...}} with actual values):
---
name: {{brandSlug}}-design
description: Use this skill to generate well-branded interfaces for {{brandName}}. Contains colors, type, fonts, assets, and UI kit for prototyping {{kitType}} UIs.
user-invocable: true
---
# {{brandName}} Design Skill

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts, copy assets out and create static HTML files. If working on production code, read the rules here to become an expert in designing with this brand.

## Quick map

{{Render ONLY entries present in generatedArtifacts. Omit preview/ui_kits/components lines when those files were skipped or absent.}}
- `README.md` — brand context, content fundamentals, visual foundations (read first)
- `colors_and_type.css` — drop-in CSS variables for colors, type, radius, shadow, spacing
- `css.json` — structured token understanding source
- `components/_evidence/index.json` — compact component evidence index (only if generatedArtifacts contains component evidence)
- `uikit-plan.json` — component whitelist and UIKit planner output (only if generatedArtifacts contains uikit-plan.json)
- `library-consumption.json` — recommended downstream read order
- `preview/` — small HTML cards illustrating foundations and components (only if generatedArtifacts contains preview files)
- `ui_kits/{{kitType}}/` — full click-thru recreation (only if generatedArtifacts contains ui_kits files)
- `components/index.json` — component index + cross-component patterns (only if generatedArtifacts contains components/index.json)

## Essentials at a glance

- {{essential1: primary color hex + visual character, e.g. "Brand primary #1664FF — cool, technical blue. No warm accents."}}
- {{essential2: radius values + rationale, e.g. "Radius 4/4/8/99 — deliberate and tight. Pills only for chips."}}
- {{essential3: control height + spacing, e.g. "32px default control height, 4px spacing unit, 8-pt grid."}}
- {{essential4: font faces, e.g. "Type: PingFang SC (CN); Roboto Mono (code); no web font imports."}}
- {{essential5: voice/tone, e.g. "Voice: bilingual CN-first, professional, neutral, no emoji in UI."}}
- {{essential6: shadow philosophy, e.g. "Shadows whisper-quiet: 7 levels from 1px border to 15px ambient."}}
- {{essential7: one brand-specific quirk, e.g. "AI components are first-class: dedicated chat/thinking states."}}

## Components

{{Render this entire section ONLY if generatedArtifacts contains components/index.json. Otherwise omit the heading and table.}}
| Slug | Name | Key Insight |
|------|------|-------------|
{{exactly 1 row per component — list ALL core components, columns: slug | display name | one-line brand-specific insight}}

Also write `library-consumption.json`:

```json
{
  "schemaVersion": 1,
  "tokenSource": "css.json",
  "componentEvidenceIndex": "components/_evidence/index.json",
  "uikitPlan": "uikit-plan.json",
  "recommendedReadOrder": ["SKILL.md", "css.json", "components/_evidence/index.json", "components/_evidence/{slug}.json", "uikit-plan.json", "preview/component-{slug}.html", "ui_kits/{type}/index.html"],
  "coreComponents": ["{from uikit-plan.json}"],
  "supportComponents": ["{from uikit-plan.json}"]
}
```

Only include `componentEvidenceIndex`, `uikitPlan`, preview, and ui_kits paths when those files are present in generatedArtifacts or OutputFileList.

Constraint files (MUST read before execution):
  - {SKILL_DIR}/file-specs/documentation.md — Essentials quality criteria and anti-patterns
  - {SKILL_DIR}/file-specs/design-library-output.md — Output directory structure
Input data:
  - BrandFile: {tmp_dir}/phase2-brand-analyst.json (Read FIRST for brand context: personality, language, uiCopySamples, kitType)
  - CSSFile: {output_dir}/colors_and_type.css (primary token source — ALL color/type/radius/spacing/shadow values)
  - ComponentsCSSFile: {output_dir}/components.css (aggregated component CSS — include in Quick Map when present)
  - UIKitPlanFile: {output_dir}/uikit-plan.json (optional; read when present for core/support components)
  - generatedArtifacts: {relative file list as declared by main agent — do NOT verify on disk}
  - skipSet: {skipSet values}
  - OutputFileList: {complete list of all files generated in Phase 3}
  - OutputDir: {library output root path}
Report file format (`ReturnReportFileAbs`):
  - writtenFiles: ["SKILL.md","library-consumption.json"]
  - warnings: string[]

Final response:
  已完成设计系统文档。
```

---

## Phase 4C: README.md

```
Task: Generate the Design Library README.md brand narrative documentation.
Output:
  - README.md (rich brand narrative — analytical prose for senior designers, NOT a reference manual)

⚠️ HARD RULES (embedded — do NOT skip):
  1. README is for HUMAN DESIGNERS — write like a senior designer's internal wiki briefing a new team member
  2. Visual Foundations MUST be ANALYTICAL PROSE with embedded values. NOT table-filling. If you catch yourself writing a table with >5 rows → STOP, rewrite as 2-3 prose sentences.
  3. ALL values come from BrandFile or {output_dir}/colors_and_type.css — ZERO hallucinated values
  4. Copy examples MUST come from provided uiCopySamples/bundle data — NEVER fabricate generics
  5. Typography MUST name actual font families — NEVER "System Sans" or "系统字体栈"
  6. If bundle contains designer quotes/rationale, QUOTE them verbatim
  7. MUST include "Caveats / known substitutions" section (MANDATORY — every library has gaps)
  8. "Design Principles" section: ONLY if actionable brand-specific principles exist. Platitudes ("be consistent") → OMIT entirely
  9. Read BrandFile FIRST for brand context. Read {output_dir}/colors_and_type.css for ALL token values. Do NOT read the component directory or individual component JSON files.
  10. Write README.md to disk, then write the compact report to `ReturnReportFileAbs`. Final response: `已完成设计系统说明。` No verification, no read-back, no extra prose.
  11. Keep README concise. Do NOT self-verify line counts.

⚠️ AVOID:
  - "安装" / "Installation" section (npm install, yarn add — the package does NOT exist)
  - Color scale hex listings (e.g., primary-1: #f3f7ff, primary-2: #ebf1ff...) — summarize in prose: "9 scales, 8 stops each, primary anchored at #1664ff"
  - Component variant exhaustive listings (dimensions, states, sizes per component)
  - "许可证" / "License" section
  - "API 参考" / "API Reference" section
  - Tables with >6 rows (use prose instead)
  - Content that duplicates SKILL.md (Quick Map, Essentials table — those belong ONLY in SKILL.md)
  - Generic design principles that apply to any system

REQUIRED STRUCTURE (follow this order exactly):

## 1. Overview (~10 lines)
# {Brand Name} Design System
A design system reconstruction of **{Brand}** — {one-sentence product description}.
> *"{Designer quote if available}"*
### Source: Figma library name, page count, brand owner.
### What this covers: Foundations (with key values), Components (count + notable), Sample kit.

## 2. Content Fundamentals (~15 lines)
### Voice & tone: Analytical paragraph (NOT a table) describing communication style.
### Concrete copy examples: 3-5 examples lifted from bundle's uiCopySamples.
### When generating copy: 3-4 specific copywriting rules derived from observed patterns.

## 3. Visual Foundations (~50-60 lines, ALL PROSE with embedded values)
### Color: Primary hex + visual character. Scale summary (N scales, N stops). Neutrals. Semantic. Vibe paragraph.
### Typography: Primary face + platform context + weights. Latin face. Scale summary (prose, not table). Line-height approach.
### Spacing: Base unit. Token range. Component height context.
### Radius: Each value + its use cases (2-4 bullet points max).
### Shadow / Elevation: N layers, prose description of philosophy. 1-2 example values inline.
### Borders, Backgrounds: 2-3 bullet points each.

## 4. Component Patterns (~10 lines)
| Component | File | Key Insight |
(max 6 rows — one per component, same as SKILL.md but with designer-oriented insights)

## 5. Index (~8 lines)
File listing with brief descriptions.

## 6. Caveats / known substitutions (~10 lines)
Font fallbacks, icon substitutions, data gaps, inferred values.

Constraint files (MUST read before execution):
  - {SKILL_DIR}/file-specs/documentation.md — Detailed quality criteria, anti-patterns, prose examples
  - {SKILL_DIR}/file-specs/design-library-output.md — Output directory structure
Input data:
  - BrandFile: {tmp_dir}/phase2-brand-analyst.json (Read FIRST for brand context: personality, language, uiCopySamples, kitType)
  - CSSFile: {output_dir}/colors_and_type.css (primary token source — ALL color/type/radius/spacing/shadow values)
  - ComponentsCSSFile: {output_dir}/components.css (aggregated component CSS — reference in docs when present)
  - generatedArtifacts: {relative file list as declared by main agent — do NOT verify on disk}
  - skipSet: {skipSet values}
  - BundleWarnings: {all propagated warnings from Phase 2}
  - OutputFileList: {complete list of all files generated in Phase 3}
  - DesignerQuotes: {any designer rationale/quotes found in bundle annotations}
  - OutputDir: {library output root path}
Report file format (`ReturnReportFileAbs`):
  - writtenFiles: ["README.md"]
  - warnings: string[]

Final response:
  已完成设计系统说明。
```
