# Documentation File Specifications

## Overview

Two documentation files are generated as part of every Design Library:

1. **`SKILL.md`** — Skill entry point (AI-consumable gateway)
2. **`README.md`** — Rich brand narrative document

Both are written AFTER all other library files are complete, as they reference and summarize the full output.

---

## SKILL.md

### Purpose

The Skill entry point that AI agents read FIRST when this Design Library is activated as a skill. It provides immediate brand context, file navigation, and concrete design decisions so the agent can produce on-brand output without reading any other file.

### Format Requirements

SKILL.md MUST begin with YAML frontmatter:

```yaml
---
name: {brand-slug}-design
description: Use this skill to generate well-branded interfaces and assets for {Brand Name} — {product description}. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping {kitType} UIs.
user-invocable: true
---
```

### Structure (after frontmatter)

```markdown
# {Brand Name} Design Skill

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out
and create static HTML files for the user to view. If working on production code, you can
copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build
or design, ask some questions, and act as an expert designer who outputs HTML artifacts
_or_ production code, depending on the need.

## Quick map

- `README.md` — brand context, content fundamentals, visual foundations (read first)
- `css.json` — structured token understanding source
- `colors_and_type.css` — drop-in runtime CSS variables; link it, do not read it to understand tokens when css.json exists
- `components/_evidence/` — compact component specifications for evidence-backed Figma libraries
- resolved component sources — create-library uses `preview/component-{slug}.html` first, `components/{slug}.json` for intent/variants, and `components/_evidence/{slug}.json` as fallback evidence
- `preview/` — small HTML cards illustrating the foundations and components
- `ui_kits/{type}/` — full click-thru recreation (use as reference for layout, density, patterns)
- `library-consumption.json` — recommended downstream read order

## Essentials at a glance

- {concrete design decision 1}
- {concrete design decision 2}
- ...
- {concrete design decision 6-8}
```

### Essentials Quality

Each "essential" must be a **CONCRETE DESIGN DECISION** specific to THIS brand, not a generic rule:

✅ Good: "Brand primary `#1664FF`. Cool, technical, restrained — no warm accents, no default gradients."
✅ Good: "Radius is **4 / 8** — deliberate, never softer. Pills only for status chips."
✅ Good: "Density first: 32px control height, 8-pt spacing, hair-thin pale borders everywhere."
✅ Good: "Type: PingFang SC (sub Noto Sans SC); Roboto/Inter for Latin; mono for code."
✅ Good: "Voice: bilingual (CN-first), professional, neutral, no emoji in product UI."

❌ Bad: "间距系统基于4px单位，仅使用 4, 8, 12, 16, 20, 24, 32, 40, 48, 64"
❌ Bad: "组件变体必须覆盖全部状态：默认、悬停、聚焦、按下、禁用"
❌ Bad: "所有交互元素需具备悬停和按下状态反馈"
❌ Bad: "AI组件需体现智能化特征"

**The difference**: Good essentials describe THIS BRAND's unique visual choices with specific values.
Bad ones describe any design system or are obvious generic requirements.

### Essentials Must Include

- Primary color hex value + visual character description
- Radius values with design rationale (why these values)
- Default control height + spacing base
- Font face names (not "System Sans")
- Voice/tone one-liner
- Shadow philosophy (e.g., "whisper-quiet, no shadow at rest")
- One brand-specific quirk or signature pattern

### Quality Criteria

- MUST have valid YAML frontmatter with `name`, `description`, `user-invocable: true`
- MUST have "Quick map" with actual file paths and descriptions
- MUST state that agents consume component sources in priority order: preview HTML first, `components/{slug}.json` for intent/variants, and `_evidence/{slug}.json` as fallback evidence
- MUST state that UIKit may read `_evidence/` when preview is insufficient, but preview DOM/CSS remains the first source when present
- MUST state that `css.json` is the token understanding source and `colors_and_type.css` is the runtime link source
- MUST have "Essentials at a glance" with ≥6 concrete design decisions
- Every essential must reference a specific value (hex, px, font name, etc.)
- An AI agent reading ONLY SKILL.md should understand the brand's visual identity
- No generic rules that apply to any design system
- Total length: 25-50 lines (including frontmatter) is acceptable. Do NOT count lines to verify.

---

## README.md

### Purpose

The comprehensive brand reference document. Written as if briefing a senior designer joining the team. Uses analytical prose with precise values — NOT template tables to fill.

### Required Sections

#### 1. Overview

```markdown
# {Brand Name} Design System

A design system reconstruction of **{Brand Name}** — {one-sentence product description}.
The system is purpose-built for {use case description}.

> *"{Designer quote or brand tagline if available}"* — source

## Source

- **Figma library:** {filename}
- **Pages:** {count} pages, {frame count} top-level frames covering {scope description}
- **Brand owner:** {company/product}

## What this design system covers

- **Foundations** — {specific foundations list with key values}
- **Components** — {count}+ documented components, {notable ones}
- **Sample slides & UI kit** — {kit description}
```

#### 2. Content Fundamentals

```markdown
## CONTENT FUNDAMENTALS

### Voice & tone

{Analytical paragraph describing the brand's communication style. NOT a table.
Include specific observations about language usage, formality level, person, emoji policy.}

### Concrete copy examples (lifted from the Figma)

- {Context}: *"{exact copy from the bundle}"*
- {Context}: *"{exact copy from the bundle}"*
- ...

### When generating copy

- {Specific copywriting rule derived from observed patterns}
- {Another rule}
- ...
```

**Rules:**
- Copy examples MUST come from actual bundle data (annotations/ui-copies*.md, brand-clues.md)
- NEVER fabricate generic examples like "保存、取消、删除、搜索"
- Voice & tone section must be analytical prose, not a key-value table

#### 3. Visual Foundations

Each subsection MUST be written as **analytical prose with embedded values**, NOT as standalone tables. Tables are supplementary to prose, not a replacement.

##### Color

```markdown
### Color

- **Brand primary:** `#hex` ({description}) — Used for {specific uses}.
- **Brand scale:** {N} stops from `#hex` ({name}) → `#hex` ({name}). {Additional context about alternate scales if present.}
- **Neutrals:** A {N}-stop scale from `#hex` through `#hex`. The dominant working neutrals are {list top 3-5 with approximate usage if available}.
- **Semantic:**
  - Success: `#hex` ({color family})
  - Warning: `#hex`
  - Danger: `#hex`
  - Info: {relationship to brand}
- **Vibe:** {One-paragraph color mood description}
```

##### Typography

```markdown
### Typography

- **Primary face:** **{Font Name}** — {platform context}. Weights used: {list}. {OS fallback info}.
- **Latin / numeric face:** **{Font}** for {use}; **{Font}** for {use}; **{Font}** for {use}.
- **Scale:** {list actual sizes from bundle, e.g., "display-1: 36/44, title-1: 20/28, body-1: 14/22"}
- **Letter-spacing:** {value if specified}
- **Line-height:** {description of approach}
```

**Rules:**
- MUST include actual font family names (never "System Sans" or "系统字体栈")
- MUST describe each font's specific use case
- MUST include font substitution plan for unavailable fonts
- MUST list actual size/weight values from the bundle's typography tokens

##### Spacing

```markdown
### Spacing

{Base unit}. Tokens: {actual token values}. {Component height context — e.g., "Inputs are 32px tall by default"}
```

##### Radius

```markdown
### Radius

- **{value}** — {use cases}
- **{value}** — {use cases}
- **{value}** — {use cases only}
- {If bundle contains designer quotes about radius choice, QUOTE them verbatim}
```

**CRITICAL**: Radius values MUST match `tokens/spacing.md` EXACTLY. If bundle says 4/4/8/99, write 4/4/8/99. NEVER hallucinate values like 12px or 20px that don't exist in the bundle.

##### Shadow / Elevation

```markdown
### Shadow / Elevation

{Number} layers:
1. **{Name} (level 1):** `{CSS value}` — {usage description}
2. **{Name} (level 2):** `{CSS value}` — {usage description}
3. ...
- {Additional observations about shadow philosophy}
```

##### Borders, Backgrounds, Animation, Iconography

Each section: 2-4 bullet points of analytical observation with specific values. No filler.

#### 4. Component Patterns

```markdown
## Component Patterns

| Component | Preview | Contract | CSS Source | Key Facts | Key Insight |
|---|---|---|---|---|---|
| {Name} | `preview/component-{slug}.html` | `components/{slug}.json` or `components/_evidence/{slug}.json` | `components.css` section `{Name}` | {sizes/states/pattern model/anatomy facts} | {One-line insight specific to this brand} |
```

**Rules:**
- MUST include every component currently listed in `components/index.json` or `components/_evidence/index.json`.
- MUST include newly added or recently modified components in incremental workflows.
- Key Facts must be derived from actual component contracts: `renderFacts.controlMatrix`, `renderFacts.patterns.tableModel/listModel/toggleModel`, `renderFacts.iconSlots`, compact `variantDimensions`, or preview anatomy. Do not invent variants/states that are not present.
- CSS Source should state `components.css` when the aggregated section exists; otherwise explicitly write `preview-only` and list it as a caveat.
- Key Insight should be a brand-specific rendering/usage observation, not a generic label such as "button component".

#### 5. Index

```markdown
## Index

- `README.md` — this file
- `colors_and_type.css` — CSS variables for color, type, radius, shadow, spacing
- `components.css` — aggregated component CSS extracted from preview pages
- `assets/` — {if present}
- `preview/` — small HTML cards for the Design System tab
- `ui_kits/{type}/` — {Kit description}
- `SKILL.md` — agent skill manifest
```

#### 6. Caveats / Known Substitutions (REQUIRED)

```markdown
## Caveats / known substitutions

1. **{Font Name}** is {reason unavailable}. We substitute **{Alternative}** for {use}. {Impact note}.
2. **{Asset/Icon}** is {reason}; we use **{Alternative}** as {justification}.
3. {Any data integrity warnings from bundle}
4. {Any values that are inferred vs. observed}
```

**This section is MANDATORY.** Every design library has substitutions or data gaps. Hiding them reduces trust.

### Quality Criteria

- Written in analytical prose — reads like a senior designer's internal wiki, NOT a filled template
- Uses the brand's language for examples (Chinese brand → Chinese copy examples)
- ALL color/radius/spacing values cross-verified against TokenSystem data — ZERO hallucinated values
- Typography section names actual fonts (never "System Sans")
- Copy examples are from the bundle's actual UI copies, not fabricated generics
- Contains Caveats section listing data gaps and font fallbacks
- Total length: 100-150 meaningful lines. Zero tables with >6 rows.
- References specific files and tokens by name
- Structure headings stay in English for parseability; content in brand's language where appropriate

### Anti-Patterns to Avoid

| ❌ Anti-Pattern | ✅ Correct Approach |
|---|---|
| Table-only Visual Foundations (`\| Token \| Value \|`) | Analytical prose with embedded values |
| "System Sans" or "系统字体栈" for fonts | Actual font names: "PingFang SC", "Roboto" |
| Generic copy: "保存、取消、删除" | Real UI copy from bundle: "Click or drag the file here to upload" |
| Invented radius: "卡片12px、模态框20px" | Bundle-accurate: "4px controls, 8px cards, pill only for chips" |
| Design principles as platitudes | Omit principles section if no actionable insights; use Caveats instead |
| 5 shadow levels when bundle shows 3 | Match bundle exactly — 3 levels if bundle has 3 |
