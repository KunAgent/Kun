# Visual Zero-Tolerance Checklist

> **Read timing**: Sub-Agent reads this file in full **once BEFORE writing any HTML** (preventive).
> After writing, execute the "Post-Write Verification Procedure" at the end of this file from
> context — no second full read of this file is required.
> Any violation found in post-write check → fix immediately before completion report.
>
> **SSOT**: This file is the single source of truth for heading / eyebrow / CTA text rules.
> Other files (quality gates, repair tables) reference the thresholds defined here.

---

## ❶ Single Language — No Bilingual Mixing

All headings, labels, buttons, navigation items, and descriptions on a page must use exactly ONE language.

- If the user communicates in Chinese → all UI text must be Chinese
- If the user communicates in English → all UI text must be English
- Only exceptions: brand names, universal abbreviations (KPI, VIP, ID), untranslatable proper nouns

**Violation signal**: Both Chinese characters AND English phrases (>2 words, excluding brand names) appear as headings or labels on the same page.

---

## ❷ No Component Overlap

Adjacent elements must never visually overlap, clip, or touch.

- Minimum gap between adjacent components: `8px` (`gap-2`)
- Absolutely-positioned badges/overlays must declare explicit offsets (`top`/`right` ≥ 8px), and the sibling text container must reserve matching padding so text cannot run under the positioned element
- Absolutely-positioned elements must not share a parent without explicit non-overlapping offsets
- Dense tag/pill groups must use `flex-wrap gap-2`

**Violation signal**: A positioned element lacks explicit offsets, or sibling text has no reserved padding where a positioned badge sits.

---

## ❸ Headings Are Words, NEVER Sentences

A heading is ANY title-like text at ANY level — page titles, section titles, card titles, list item titles, modal titles, nav labels, tab labels, badge labels. Not limited to `<h1>`–`<h6>` tags; includes any text that serves as a name/label for a block of content. Applies to ALL page types including showcase — NO EXCEPTIONS.

- Max length: **≤ 8 CJK characters** (or **≤ 6 English words**) at any size ≥ `text-xl` (20px)
- FORBIDDEN: complete sentences, clauses, descriptions, or text that could end with "。" / "."
- **Sentence detection**: if the text contains a verb forming a complete thought, or could naturally end with "。" / ".", it is a sentence — MUST be demoted to body text (`text-base` to `text-lg`), never rendered as a heading
- FORBIDDEN: sentence-ending punctuation in headings — no `。` `？` `！` `…` `.` `?` `!` in heading text
- If heading wraps to 2+ lines → it is too long to be a heading; extract a shorter noun phrase or reduce font-size immediately
- Display size (≥36px): only for brand names ≤4 CJK chars / ≤2 words, or single KPI numbers
- Mobile (< 640px) CJK heading: must not exceed `text-3xl` (30px)

**Scope**: applies equally to page-level headings (`<h1>`–`<h6>`), card titles, list item titles, modal/dialog titles, sidebar section labels, and any text that visually functions as a "name" for its parent container.

**Fix**: Extract the short noun-phrase as heading; move descriptive text to body paragraph below. Example: ❌ "像有温度的经典书市榜单，把热读氛围和家庭陪伴一起摆上桌" → ✅ Heading: "经典共读", Body: "像有温度的经典书市榜单..."

---

## ❹ No Eyebrow Text Above Headings (NO EXCEPTIONS)

FORBIDDEN: placing a small-text eyebrow / kicker / overline / 眉标题 label directly above a heading. This includes category labels, section markers, decorative dividers/icons used as section openers, or any small muted text that sits above a larger heading.

- FORBIDDEN: patterns like `<p class="text-xs">Category</p><h2>Title</h2>` or any visually stacked "small decorative text above big text" composition
- FORBIDDEN: decorative English uppercase eyebrow text (e.g., "CREATE FLOW", "ISSUE 04 · NATIVE TOPIC") on Chinese-language pages

**Exempt (functional elements, allowed above a heading)**:
- Tab bars / segmented filters, breadcrumbs, status badge rows — functional UI, not decorative eyebrows
- Page-level navigation (global header/navbar)
- A prior section's content (the heading starts the new section)

**Allowed alternatives**: inline tag/badge beside the heading on the same line, or category in metadata area below the title.

**Detection**: A text element with smaller font-size and no functional role (not a tab/filter/breadcrumb/status badge) as a preceding sibling (or visually above via flex-col) of a heading = eyebrow text = violation.

**Fix**: Move the label to BELOW the heading or beside it (same line).

---

## ❺ Text on Background Must Be Centered (Both Axes)

Any text element that sits on a visible background — regardless of component type — MUST be horizontally and vertically centered within its container. This is a universal rule.

**Applies to ALL of** (non-exhaustive): buttons (`<button>`, button-styled `<a>`), pill/chip buttons, tab items / segmented controls, badges / tags / labels with background, card headers with colored background, toast/snackbar text areas, and any element where text renders over a distinct background color, border, or shape (circle, rounded-rect, pill).

**Definition of "visible background"**: The text's container has any of: `background-color`, `background-image`, `border`, `border-radius` with fill, `box-shadow`, or is visually a distinct shape (circle, pill, card surface).

### Rules:
- Container MUST use `flex items-center justify-center` (or `inline-flex items-center justify-center`)
- FORBIDDEN: fixed `height`/`min-height` without vertical centering — causes "text at top, empty space below"
- FORBIDDEN: `text-center` alone without `items-center` — only solves horizontal, not vertical
- Padding must be symmetric: equal top/bottom (`py-*`), equal left/right (`px-*`)
- Text must also be single-line within these containers: every `<button>` and button-styled `<a>` must include `whitespace-nowrap`
- If text is too long for single-line: reduce font-size (min `text-xs` / 12px), then shorten copy. Never allow wrapping.

### Additional button/CTA label rules (SSOT):
- CJK button/CTA labels: **2–6 characters** (4 or fewer preferred); English button/CTA labels: **1–3 words**
- FORBIDDEN: a full sentence inside a button, pill, tab, or primary CTA

**Violation signals**:
- Visible empty space above or below text within a background container
- Text hugging one edge (top/left/right) instead of centered
- Text wrapping to multiple lines inside a button/tab/badge

**Fix**: Apply `flex items-center justify-center whitespace-nowrap` to the container. Use symmetric padding. Remove fixed heights unless paired with flex centering.

---

## ❻ Border-Radius Must Match Design Library Exactly

Component border-radius is NOT a decorative choice — it is a specification from the Design Library. Sub-Agent MUST NOT invent, exaggerate, or "beautify" border-radius values.

- Every component's `border-radius` must match the Design Library definition (component preview, CSS variables, or component JSON). If the DL shows a Button with small radius (`rounded` / 4-6px), do NOT use `rounded-full` or `rounded-xl`; if a Card shows `rounded-lg`, do NOT use `rounded-3xl` or `rounded-none`. When in doubt, use the DL's radius CSS variable (e.g., `var(--brand-radius-sm)`) rather than guessing a Tailwind class
- [FORBIDDEN] `rounded-full` (pill) on buttons when the DL shows small/medium radius; increasing radius "to look better/more modern"; mixing radius styles when the DL is consistent; defaulting to large radius just because it's mobile
- **Radius source priority**: ① component-specific radius in DL component definition → ② global radius CSS variable from `SKILL.md` / `colors_and_type.css` → ③ if neither exists: conservative small radius (`rounded` / `rounded-md`), never pill

**Violation signal**: visible corner curvature differs from the same component in the DL preview/specification. **Fix**: look up the exact DL radius value (or its CSS variable) and apply it.

---

## ❼ Strict Component Reproduction — NOT Style Imitation

When a Design Library provides component definitions (UI Kit, component JSON, or preview images), the Sub-Agent MUST reproduce those components exactly — not "design something in a similar style." **The Design Library is a specification, not an inspiration board.**

**Strict reproduction means**: DOM structure/container hierarchy, selected/active/hover state treatment (colors, borders, backgrounds, shadows), and spacing/padding/radius/sizing all match the Library definition — not "close enough". If the Library shows Tabs with a bottom-border active indicator, produce exactly that — not a pill toggle that "looks similar".

- [FORBIDDEN] Creating a "business-customized version" of a component the Library already defines; using Library tokens but inventing your own component structure; "inspired by" instead of "reproduced from"; adding embellishments (extra shadows, gradients, decorations) not present in the Library component

**When to apply**: whenever `orchestration-summary.json` has a `componentPlan` / `uiKitPlan` mapping a Library component to a page element, or the page uses a UI pattern (tabs, cards, buttons, inputs, modals, etc.) that exists in the Library's component set.

**If the Library component doesn't cover the need**: first try a combination of Library components; as a last resort build a custom component using ONLY Library tokens and mark it "custom — not in Library".

**Violation signal**: rendered structure, state treatment, or proportions visibly differ from the Library preview/specification. **Fix**: re-read the Library component definition and rebuild to match exactly.

---

## ❽ Strict Page Layout from UI Kit

When the Design Library provides UI Kit page layouts (via `ui_kits/` directory or `uikit-plan.json`), the Sub-Agent MUST follow the page structure and layout hierarchy exactly.

- Section order, grid structure, and content zones must match the UI Kit layout
- Do not rearrange sections, merge zones, or invent new layout patterns
- The UI Kit is the **blueprint** — the Sub-Agent fills in content but does not redesign the architecture

**Violation signal**: Page structure (section order, grid columns, content zone arrangement) does not match the referenced UI Kit layout.

**Fix**: Re-read the UI Kit layout file and restructure the page to match.

---

## Post-Write Verification Procedure

After writing the page HTML, execute this checklist from context (no second full read of this file required), checking each rule above in order:

1. Scan all visible text — any bilingual mixing? → Fix
2. Inspect positioned elements and dense groups — explicit offsets and reserved padding present? Any zero-gap clusters? → Add spacing/offsets
3. Check every heading-level element — any sentence, >8 CJK chars, or sentence-ending punctuation (。？！….?!)? → Demote to body text or remove punctuation
4. Check heading preceding siblings — any decorative eyebrow/kicker/overline above a heading (functional tabs/breadcrumbs/status badges exempt)? → Move below or beside
5. Check every element with a visible background (buttons, tabs, badges, pills, etc.) — is text centered both horizontally and vertically? Single-line? No empty space? → Fix
6. Check every component's border-radius — does it match the DL's component definition? Any unauthorized pill/large radius? → Fix to match DL
7. Compare every component against its Design Library definition — is it a strict reproduction or a loose imitation? → Rebuild to match exactly
8. Compare page layout against UI Kit reference — does structure match? → Restructure

Only report `qualityGate: "passed"` after all 8 checks pass.
