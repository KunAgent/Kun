# Sub-Agent Hard Rules (Layer 0 — Blocking, Must Read Every Time)

> **This file is the single source of truth for all Sub-Agent [FORBIDDEN] rules and critical constraints.** Every Page Sub-Agent must read this file before generating any content. Violations here directly cause rendering failures, validation errors, or architecture corruption.

---

## §Token-Fidelity — CSS Variable Name Source Constraint

All color/border-radius/shadow/font CSS variable names **must 100% come from the "Actual Token Name Reference" list passed by the Main Agent** (extracted per `design-library-parsing.md` priority hierarchy).

- [FORBIDDEN] Fabricating variable names that do not appear in the Main Agent's "Actual Token Name Reference" or the provided/generated CSS. In Library mode, `css.json` may be used as an auxiliary validation source, but it is not required in free-explore flows.
- [FORBIDDEN] Introducing hardcoded color values outside the brand CSS variable system (e.g., `text-[#333]`, `bg-[#f5f5f5]`, `style="color: #666"`)
- [FORBIDDEN] Using Tailwind semantic color classes (`bg-primary`, `text-foreground`, `bg-card`, etc.) — use `var(--{tokenName})` instead. Note: the `@theme inline` bridge in `<head>` exists only as infrastructure fallback so that accidental semantic classes still resolve to brand colors; its presence does **not** authorize writing semantic classes in HTML.
- [FORBIDDEN] Using Tailwind `font-*` classes for font references — use Library typography class names or CSS variables

---

## §Icon-Source-Priority — Library Icon Lookup Before Lucide (Library-Bound Only)

> Skip this section entirely when `designSource.iconAssets` is absent (Free-explore mode or Library without icons).
> **This is a GENERATION-TIME directive** — it guides what HTML to write DURING generation. It does NOT trigger post-generation repair or self-fix loops. If you already wrote Lucide and realize Library had it, do NOT go back and replace — just note it in the completion report and move on.

When `designSource.iconAssets` is present in the dispatch:

1. **BEFORE writing any `<i data-lucide="...">` icon**, check if a semantically equivalent name exists in the `availableNames` list.
   - Exact match: `close` → `close` ✓
   - Semantic equivalent: need "close" → Library has `x` or `cross` ✓
   - Related: need "chevron-down" → Library has `down` or `arrow-down` ✓
2. **If a Library icon match is found** → prefer `<span data-icon>` with mask-image path.
3. **If no reasonable match exists** → Lucide `<i data-lucide="...">` is the correct choice.
4. **Report**: completion JSON includes `libraryIconsUsed` and `lucideFallbackIcons` for transparency.

- [FORBIDDEN] Self-repair loop: going back to replace already-written Lucide icons with Library icons
- [FORBIDDEN] Spending more than 0 extra tool calls on icon source correction after page content is written
- [FORBIDDEN] Using both `<span data-icon>` AND `<i data-lucide>` for the same semantic icon on the same page (pick one source per semantic)
- [ALLOWED] Using Lucide for icons not in availableNames — this is expected fallback behavior

---

## §Design-Authority-Priority — Specs > Library > Aesthetics > Creativity

When a Design Library exists (componentPlan is non-empty, UI Kit path is provided):

1. **`specs/` directory content (`specsConstraints`) is the absolute highest authority** — page layout rules, component usage patterns, density/spacing overrides. When it conflicts with any other source (preview HTML, component JSON, UI Kit, SKILL.md), `specsConstraints` wins unconditionally; read and apply it before consulting any other design reference.
2. **Library files are the second authority** for visual decisions they cover: UI Kit `index.html` layout patterns (spacing, grid, section structure); component JSON `structurePatterns` / `variantDimensions`; token system (all semantic tokens usable regardless of aesthetics quantity limits); SKILL.md Essentials (density, tone, radius scale).
3. **Aesthetics rules are fallback** — only where specs and Library are silent: animation/transition timing; accessibility patterns (contrast, touch targets, focus); Anti-AI-Slop avoidance (always applies regardless of priority); general composition principles (only if Library has no UI Kit for the page type).
4. **Agent creativity** — only when all above are silent: decorative details, micro-interactions, copywriting style; must stay tonally consistent with the Library's voice.

- [FORBIDDEN] "Correcting" `specs/` constraints based on Library patterns or aesthetics rules
- [FORBIDDEN] "Correcting" Library patterns based on aesthetics rules (e.g., reducing Library's 12 tokens to aesthetics' "max 5 colors")
- [FORBIDDEN] Flattening Library component nesting to meet aesthetics nesting limits when the component JSON defines that structure
- [FORBIDDEN] Overriding Library spacing/radius with aesthetics "rhythm" rules

---

## §Script-Usage — fill-html-head.mjs Rules

**Parameter order is critical** (common failure pattern):
- **Arg 1** = CSS file path (the `colors_and_type.css`)
- **Arg 2** = Output HTML file path (the page to generate)
- Named flags use `--key=value` format: `--title=...`, `--lang=...`, `--prefix=...`, `--theme=...`
- Boolean flags use bare format: `--replace-head`, `--charts`

- [FORBIDDEN] Swapping the CSS and HTML arguments — causes "No :root block found" and broken skeleton
- [FORBIDDEN] Manually writing `@theme inline` blocks in HTML — auto-generated by the script
- [FORBIDDEN] Manually adding `<link rel="stylesheet">` for brand CSS — iframe srcdoc cannot load external paths
- Head write modes (`SkeletonMainOnly` / `FullHtmlReplaceHead`), the mode-mixing ban, and the derived-state exception (`stateRole: "derived"` → never run `fill-html-head.mjs`; poll-and-copy `derivedFromHtmlSrc`): see `§Style-Integrity` Safe Editing Mode (SSOT).

---

## §CSS-Ownership — Style Placement Rules

**Core invariant**: `<head>` is exclusively managed by `fill-html-head.mjs`. Sub-Agent must NEVER place custom `<style>` blocks in `<head>`.

### Library-Bound Mode (operatingMode === "library-bound")

- [FORBIDDEN] Defining custom CSS classes — ALL layout and visual styling must use Tailwind utility classes + brand CSS variables (`var(--{prefix}-{semantic})`)
- [FORBIDDEN] Writing `<style>` blocks with class definitions (e.g., `.page-shell {}`, `.capability-card {}`) — not in `<head>`, not in `<body>`, nowhere
- Allowed: `style=""` inline attributes using only CSS variables for exceptional one-off overrides
- Project-level validation blocks non-infrastructure `<style>` class definitions in Library-bound projects. Do not rely on custom CSS to pass final validation.

### Free-Explore / High-Fidelity Mode

- Custom CSS classes are allowed when Tailwind utilities cannot express the design
- Custom CSS must serve a named `compositionPattern` or high-fidelity visual requirement. [FORBIDDEN] using custom CSS to duplicate Tailwind-expressible basics such as simple flex centering, spacing, border radius, or card padding.
- [MANDATORY] Custom `<style>` blocks must be placed inside `<body>` (before `</body>`, after `<main>`) — **never inside `<head>`**
- Reason: `fill-html-head.mjs --replace-head` replaces the entire `<head>` to inject brand CSS; any custom styles in `<head>` will be destroyed

### Universal Rules

- [FORBIDDEN] Using `<link rel="stylesheet">` for any CSS — canvas iframe srcdoc cannot resolve paths
- [FORBIDDEN] Defining CSS classes that duplicate what Tailwind utilities already provide (e.g., `.flex-center { display:flex; align-items:center; }`)
- After writing, verify: no custom `<style>` exists between `<head>` and `</head>` (the script's generated blocks don't count)

---

## §No-Design-Write — Sub-Agent Must Not Touch .design

- [FORBIDDEN] Writing to, appending to, or modifying the `.design` file — page nodes are pre-registered by the Main Agent. Violating this causes race condition overwrites in parallel execution.
- Sub-Agent keeps `devMetadata.interactions` as empty array `[]`; Main Agent registers wiring after all pages complete.

---

## §No-Image-Generation — Sub-Agent Must Not Generate Images

- [FORBIDDEN] Calling image generation tools (text-to-image, DALL-E, etc.) — all images are pre-generated by the Main Agent in the image pre-generation phase.
- Reference images only from the "Available image resources" table passed by Main Agent, using path `../assets/{filename}`.
- If a section needs an image but no exact match exists, reuse the semantically closest image from the table.
- `critical-hero` assets must be used when provided. If an asset status is `degraded`, do not render a broken `<img>`; use the approved CSS degradation pattern for that slot.

---

## §Image-Failure-Degradation — Rendering `degraded` Assets

> Retry/batch failure policy is executed by the Main Agent (see `main-agent-repair-flow.md` "Image Generation Failure Policy"). Sub-Agents only consume asset records: when an asset's status is `degraded`, render the approved CSS degradation below instead of an `<img>`.

**CSS Degradation Patterns** (use in place of failed images):

```css
/* Hero/background → gradient */
background: linear-gradient(135deg, var(--{prefix}-surface-container-low) 0%, var(--{prefix}-surface-container) 100%);

/* Feature/product → subtle pattern with icon */
background: var(--{prefix}-surface-container-low);
/* Add a centered Lucide icon as visual anchor */

/* Avatar/profile → initials circle */
/* Use text initials on brand-colored circle (already common pattern) */
```

**Rules**:
- [FORBIDDEN] Leaving `<img src="...">` tags pointing to non-existent files — remove them or replace with CSS backgrounds
- Use the `degraded` asset record as a semantic slot and render the approved CSS fallback instead of an `<img>`
- HTML must remain fully functional without images — images are enhancement, never structural dependency

---

## §No-Validation-Scripts — Sub-Agent Must Not Run Project Validation

- [FORBIDDEN] Running `scan-design-directory.mjs` — it scans the entire directory including unfinished sibling pages, producing false positives during parallel execution.
- [FORBIDDEN] Running `validate-design-file.mjs` — Sub-Agent does not write `.design`, so validating it is the Main Agent's responsibility.
- Sub-Agent performs **Style Integrity Self-check** (see below) on its own HTML output only.

---

## §Component-Conformance — Component Plan Reading Rule

When a Design Library exists and the Main Agent passes a per-page `componentPlan`:

0. **Pre-built component classes**: when `<style id="component-vars">` exists in `<head>` (auto-inlined from `components.css`), prefer its pre-defined classes (`.btn`, `.badge`, `.card`) over custom component styles — they are the canonical implementation extracted from `preview/component-*.html`; still consult `previewFile` for DOM structure.
1. For each planned component: read `componentPlan[].previewFile` **first** as the primary implementation reference (DOM structure, CSS variable usage, spacing, visual patterns); then read `componentPlan[].contractFile` as semantic supplement (`representativeVariants`, `anatomy`, `visualTraits`, `unknowns`, `structurePatterns`, `variantDimensions`, `keyFeatures`). When `previewFile` is unavailable, `contractFile` becomes primary. If `contractKind` is `evidence`, do not read the optional `debugFile` during normal generation.
2. Use those component fields as implementation references adapted to the current page context.
3. If the page clearly needs a component missing from `componentPlan`, read at most **2 extra** resolved component contract files and report them in `extraComponentsRead`.
4. If no matching component exists in the plan or bounded supplement, implement freely while still following brand CSS constraints.
5. When `designSource.forbiddenInventedComponents` lists slugs (e.g., `["layout", "space"]`), [FORBIDDEN] inventing or implementing those component types from scratch. If a page needs layout/spacing functionality, use Tailwind utilities directly — do not create a named "Layout" or "Space" component wrapper.
6. When `designSource.allowedComponents` is non-empty, strongly prefer selecting extra components from this list. Using a component NOT in the whitelist requires reporting it in `extraComponentsRead` with justification.
7. `previewFile` is the **primary implementation reference** for every component in `componentPlan`. Sub-Agent must read ALL available `previewFile`s (no per-page quantity limit). Match its DOM patterns, class names, CSS variable usage, spacing, and visual hierarchy. [FORBIDDEN] ignoring `previewFile` content when it is available and implementing differently without justification.
8. `doNotInvent` constraints from evidence contracts are BLOCKING: Sub-Agent must NOT invent interaction states/variants not documented in `representativeVariants` or `stateDeltas` of the evidence contract. If `unknowns` lists gaps, render conservatively (default state styling) and report `"lowConfidenceComponents": [slug]` in completion report.

- [FORBIDDEN] Implementing a component from scratch when its resolved component contract or preview is available
- [FORBIDDEN] Re-scanning the full Component Index before every UI block
- [FORBIDDEN] Skipping planned component data reads — "I already know how to build a button" is not a valid reason to skip reading button/preview data
- [FORBIDDEN] Ignoring `previewFile` DOM patterns when `previewFile` is available — preview is the primary implementation authority

---

## §Style-Constraints — Library Structural Boundaries

When `designSource.styleConstraints` is provided in orchestration-summary.json:

| Constraint | Rule |
|-----------|------|
| `radiusMax` | [FORBIDDEN] Using border-radius values exceeding this (e.g., if max=8, no `rounded-2xl` which is 16px) |
| `spacingBase` | Use as minimum spacing unit for gap/padding decisions |
| `fontSizeBody` | Default body text font-size; [FORBIDDEN] going below `fontSizeMin` for any text |
| `controlHeightDefault` / `controlHeightLarge` | Input/button/select height targets; match these pixel values |

These constraints are Library authority and override aesthetics spacing/rhythm suggestions where they differ.

If `styleConstraints` is absent, aesthetics rules apply as usual (no behavior change).

---

## §Visual-Zero-Tolerance — Reference (Moved to Dedicated File)

> **Full rules moved to**: `{SKILL_DIR}/operation-policies/visual-zero-tolerance.md`
>
> That file covers: ❶ Single Language, ❷ No Overlap, ❸ Headings Are Words Not Sentences, ❹ No Eyebrow Text, ❺ Button Single-Line. It is the SSOT for heading/eyebrow/CTA text thresholds.
>
> Sub-Agent reads it in full **once before writing** (Pre-step 0), then after writing executes its "Post-Write Verification Procedure" checklist from context — no second full read. This section exists only as a pointer — the authoritative rules live in the dedicated file.

---

## §Style-Integrity — Protected Head Elements & Safe Editing Mode (SSOT)

> This section is the single source of truth for the protected-element table and Safe Editing Mode. Other files (`html-implementation.md`, Quality Gate 2) reference it.

> ⚠️ **CRITICAL — Full HTML Document Required**: Sub-Agent output HTML files MUST contain a complete `<!DOCTYPE html><html class="light"><head>...</head><body>...</body></html>` document structure. Outputting only `<main>` fragments causes the Main Agent to enter an expensive repair loop (~28 extra LLM calls, ~3.8M tokens, ~5 minutes delay). Correct workflow: 1) Run `fill-html-head.mjs` to generate skeleton (SkeletonMainOnly mode), OR 2) Write full HTML then run `fill-html-head.mjs --replace-head` (FullHtmlReplaceHead mode).

**Protected element table** — these elements are the foundation for page style rendering; missing any one causes all or partial styles to be lost. After page content is written, verify item by item:

| # | Check Item | Must be present / Consequence of loss | Owner |
|---|-----------|-----------------|-------|
| 1 | `<style id="theme-vars">` in `<head>` | Inline brand CSS variables; if lost, all brand color/font/radius/shadow variables fail | **Main Agent** (via `fill-html-head.mjs`) |
| 2 | `<style id="component-vars">` in `<head>` (when Library provides `components.css`) | Pre-built component CSS classes (`.btn`, `.badge`, `.card`, etc.); if lost, components render unstyled | **Main Agent** (via `fill-html-head.mjs`) |
| 3 | `@theme inline` bridge block within `<style type="text/tailwindcss">` | Tailwind v4 semantic class ↔ brand variable bridge — enables `bg-primary`, `text-foreground` etc. to resolve to brand colors. Both semantic classes and `var(--{tokenName})` are acceptable. | **Main Agent** (via `fill-html-head.mjs`) |
| 4 | Tailwind CDN `<script>` | `@tailwindcss/browser@4`; if lost, all layout/spacing utilities fail | **Main Agent** (via `fill-html-head.mjs`) |
| 5 | Lucide CDN `<script>` | `lucide@1.7.0` (fallback icon system); if lost, `<i data-lucide>` icons do not render | **Main Agent** (via `fill-html-head.mjs`) |
| 6 | `@layer base` styles | body background + color defaults | **Main Agent** (via `fill-html-head.mjs`) |
| 7 | `<html>` tag `class` attribute | Must include `"light"` or `"dark"`; if lost, CSS variable selectors don't match | **Main Agent** (via `fill-html-head.mjs`) |
| 8 | Lucide init script at bottom of `<body>` | `lucide.createIcons()` (required only when data-lucide is used) | **Sub-Agent** (must include when writing `<body>` content) |
| 9 | `[data-icon]` mask infrastructure in `<style>` block — CSS mask-size/mask-repeat/mask-position/background-color:currentColor base rules for Design Library SVG icons | MAIN-AGENT (via fill-html-head.mjs) |

**Safe Editing Mode**:

- When creating an ordinary page or a base state page, **must first use `fill-html-head.mjs` to generate the complete skeleton** (pass in brand CSS file path), then only append content within the `<main>` tag
- When creating a derived state page (`stateRole: "derived"`), **must not use `fill-html-head.mjs`**. Poll for `derivedFromHtmlSrc`, copy the base HTML file to the derived output, then edit only declared `mutableRegions`. If the base file is unavailable after retries, report `qualityGate: "blocked"` with `blockedReason: "missing base state html after retry: <path>"`
- When editing an existing page, **only replace content within the `<main>` tag**; do not touch `<head>` or attributes/scripts on `<body>`
- [FORBIDDEN] Using full-file overwrite (Write tool) to rewrite an existing skeleton HTML — use the Edit tool to precisely replace content within `<main>`
- [FORBIDDEN] Mode mixing: `fill-html-head.mjs` skeleton generation followed by full-file `Write` on the same file. Choose one mode before writing:
  - `SkeletonMainOnly`: run skeleton, then edit `<main>` only.
  - `FullHtmlReplaceHead`: write full HTML first, then run `fill-html-head.mjs --replace-head`.
  The order `skeleton -> full-file Write` is always invalid because it replaces generated head infrastructure with manually copied or stale head content.
- [FORBIDDEN] Deleting or reordering `<style>` / `<script>` tags within `<head>`

**Repair responsibility split**:
- Items 1–7 are **`<head>` infrastructure** exclusively managed by `fill-html-head.mjs`. If any are missing after writing, the Main Agent failed to generate the skeleton before dispatch or the Sub-Agent accidentally overwrote it. **Sub-Agent MUST NOT fix items 1–7 by rewriting the file** — report the missing items under `infrastructureIssues[]` in the completion report, continue writing `<main>` content as normal; the Main Agent will run `fill-html-head.mjs --replace-head` after receiving the report.
- Item 8 is **Sub-Agent's responsibility** — if missing, add `<script>lucide.createIcons();</script>` before `</body>`.
- **Hardcoded colors and custom styles in `<head>`** are also Sub-Agent's responsibility — replace hardcoded values with `var(--prefix-*)` tokens and move any custom `<style>` from `<head>` to before `</body>`.

**[FORBIDDEN]** Using Write tool to rewrite the entire HTML file to fix infrastructure issues (items 1–7) — this destroys the `fill-html-head.mjs` skeleton and creates a vicious cycle of re-validation failures.

---

## §Nesting-Limit — Visible Container Depth Constraint

**Visible container definition (SSOT, machine-checkable)**: an element that simultaneously has `bg-*` (non-transparent/inherit), `rounded-*`, and `p-*`. All cards-inside-cards / card-in-card judgments across files use this single formula.

From page root (`<section>`) to final readable content, visible container layers MUST NOT exceed: **mobile (< 640px) 2 layers; desktop (≥ 1024px) 3 layers**.

- [FORBIDDEN] Wrapping product/feature cards or list items in an intermediate container that itself has `border` + `background`; applying `border` + `background` + `border-radius` + `padding` to BOTH a grid wrapper AND its individual cards; using `color-mix()` or `rgba()` semi-transparent backgrounds on intermediate wrapper `div`s between `<section>` and leaf content (implicitly adds a visual layer)
- When in doubt, use whitespace + dividers instead of nested containers to separate content groups

**Self-check**: before completing, count visible container layers for at least 2 representative content paths (e.g., "section → card → content text"). If the count exceeds the limits, flatten by removing inner containers or stripping their `border`/`background`.

---

## §Tool-Call Budget — Page Sub-Agent

- Default page generation/editing completes as: read constraints + read inputs + generate/modify HTML + execute local quality gate + return report.
- [FORBIDDEN] TodoWrite for single-page tasks (exception: multi-file tasks touching 3+ files may use it once at start and once at end).
- [FORBIDDEN] Read-back after writing the HTML unless: ① write/edit tool reported failure, ② generated content touched `<head>` unexpectedly, or ③ the quality gate needs exact local inspection of the final file.
- [FORBIDDEN] RunCommand for local validation; Main Agent runs `scan-design-directory.mjs`.

---

## §Complete-Output — No Placeholder / No Truncation

Every generated or edited HTML page must be complete on disk. Partial output is a failed deliverable even if the completion report claims success.

[FORBIDDEN] Placeholder/truncation patterns in HTML, CSS, JS, and completion JSON: `...` standing in for omitted structure or code; `// TODO` / `/* TODO */` / `<!-- TODO -->`; `/* ... */` / `<!-- ... -->`; `rest of code`, `same as above`, `for brevity`, `continue pattern`, `add more as needed`; empty `<section>`/`<nav>`/`<footer>`/`<main>`/card/list/modal shells intended to be filled later; stub links/buttons implying missing implementation.

Allowed: real business copy may contain a visible ellipsis character; intentional disabled/empty/loading/error states only when fully designed and labeled as real states.

If the page is too large to describe in chat, write the full file to the requested path and keep the completion report concise — never paste partial code as a substitute for writing the file.

---

## §Completion-Report Format

After completing the task, report to the Main Agent in JSON code block format:

```json
{
  "nodeId": "page-{slug}", "page": "pages/{page-name}.html", "title": "Page Title",
  "domIds": ["cta-pricing", "nav-about"],
  "componentsRead": ["button", "card"], "extraComponentsRead": [],
  "aestheticsRead": ["index.md"], "aestheticsSkipped": [],
  "nestingDepthCheck": { "status": "pass", "maxLayersFound": 2, "samplePaths": ["section > card > content"] },
  "qualityGate": "passed"
}
```

Bare file paths or Markdown links are [FORBIDDEN] — they trigger IDE artifact UI rendering.

---

## §Completion-Lock — Absolute Termination After Completion Report

Once you output the completion report JSON block, your response MUST end immediately. No exceptions.

- [FORBIDDEN] Any tool calls (Edit, Grep, Read, SearchReplace, RunCommand, etc.) after the completion JSON
- [FORBIDDEN] "Let me fix one more thing" reasoning, reopening the quality gate debate, or entering a color/token replacement loop post-completion
- [FORBIDDEN] Self-executing the "Repair vs Regenerate" table (`main-agent-repair-flow.md`) — that is exclusively Main Agent scope

**Design rationale**: the completion report is a one-shot irreversible verdict. Issues discovered after the JSON are handled by the Main Agent's post-completion validation/repair — catch everything BEFORE reporting; never re-run or reinterpret any gate afterwards.

---

## §No-Helper-Scripts — Forbidden Ad-hoc Script Creation

**Absolutely forbidden** to create any ad-hoc Python, Shell, Node.js, or other helper scripts during execution, including: Python (Pillow etc.) to crop/process images (use generated images directly — prompt constraints are Main Agent scope); Python/JS to generate color scales (SDK auto-generates from `seedColor`, or write HEX directly); BeautifulSoup/cheerio to parse/validate HTML (ensure HTML is correct at generation time; `.design` is validated by built-in `validate-design-file.mjs`); scripts to batch rename/move/convert files (use file operation tools directly).

Running built-in preview commands (`python -m http.server`, `npx serve`) is allowed and is not considered creating a helper script.
