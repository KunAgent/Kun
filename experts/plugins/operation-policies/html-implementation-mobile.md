# HTML Layout Constraints — Mobile

This document defines layout constraints specific to mobile page generation. **Read only when device type is `mobile`**; for desktop scenarios, read `html-implementation-web.md`. For common technical constraints see `html-implementation.md`; for aesthetic/visual quality requirements see `aesthetics/index.md`.

---

## Mobile Container Nesting and Screen Efficiency

> Design principle in `aesthetics/index.md §2 Layout & Composition > Nesting`. Visible-container definition and depth limits: `sub-agent-hard-rules.md §Nesting-Limit` (SSOT).

**Goal**: Mobile visible container nesting ≤ 2 layers. Mobile cards recommend `p-3`; sub-containers `p-2` ~ `p-3` or remove background and use whitespace separation instead. Beyond 2 layers of nesting, accumulated padding per layer rapidly erodes content space.

### [FORBIDDEN] Nesting Sub-Cards Within Cards (Universal Rule)

The most common and harmful nesting anti-pattern on mobile: **within any container with `bg-*` + `rounded-*` (card, block, panel), applying independent `bg-*` + `rounded-*` + `p-*` to sub-regions** — regardless of whether the sub-region is a list item, KPI statistics block, benefits row, or any other content group.

```
Outer card  bg-[var(--{prefix}-card)]  rounded-2xl  p-4      ← Layer 1 padding
  ├─ Sub-card A  bg-[var(--{prefix}-background)]  rounded-xl  p-3  ← Layer 2 padding (stacking loss)
  ├─ Sub-card B  bg-[var(--{prefix}-background)]  rounded-xl  p-3  ← Same as above
  └─ Sub-block  bg-[var(--{prefix}-muted)]  rounded-xl  p-3         ← Same as above
       └─ Actual content                             ← Available width eroded by double-layer padding
```

**Assessment rule**: In the DOM tree, along any path from `<body>` to a content node, if 2 or more containers are encountered that each independently have `bg-*` (non-transparent/inherit) + `rounded-*` + `p-*`, it constitutes a nesting violation. The accumulated double-layer padding plus page margins leaves content width far below expectations, producing title wrapping, value truncation, and character-by-character body text.

**Correct alternatives for sub-region grouping** (choose by scenario):

| Option | Scenario | Approach |
|---|---|---|
| A — Dividers for grouping | List items / side-by-side data blocks | Outer card keeps background + radius; sub-items use fine horizontal lines and vertical spacing only — no independent background/radius |
| B — Shared container or fine lines | KPI / statistics block groups | All KPI blocks share one parent container's background + radius with fine vertical line separators, OR remove sub-block backgrounds entirely and differentiate by spacing + font-weight |
| C — No background + top divider | Independent function rows (benefits rows, action rows) | Row has no independent background/radius; separated from content above only by a top divider |
| D — Remove outer container background | List blocks (e.g., "Recent Orders") | Delete the outer block's background + radius; use a title row instead of a block card header; list items become independent full-width cards separated by spacing |

[FORBIDDEN] Within any container with background, applying `bg-*` + `rounded-*` + `p-*` independent card styling to sub-regions (regardless of whether they are list items, KPI blocks, benefits rows, or otherwise); when outer padding ≥ `p-4`, inner still using `p-3` ~ `p-4` causing content width to be eroded by double-layer padding; using "design sense", "visual separation", or "card highlighting" as justification for retaining dual-layer nested background structures on mobile; not checking DOM path nested background count layer by layer after page generation.

### Semantic Level Flattening

> Design principle in `aesthetics/index.md §2 Layout & Composition > Decoupling Semantic Levels from Visual Levels`.

**Goal**: When business information has 3+ levels of semantic structure (e.g., checklist → group → sub-item), only the 1st level uses a visible container (`bg-*` + `rounded-*`); 2nd and 3rd levels convey hierarchy through non-container means — bold titles, dividers, spacing jumps, left vertical line indentation, etc.

[FORBIDDEN] Every semantic level wrapped in `bg-*` + `rounded-*` + `p-*` (exceeds the §Nesting-Limit depth table); group containers using the same padding as the outer card causing margin accumulation; maintaining desktop nested structures on mobile without responsive flattening.

---

## Mobile Card Internal Dual-Column Layout Constraints

On mobile (< 640px), when card internals use `flex-row` (or equivalent) to place the main content area alongside auxiliary info blocks (status markers, current node, summary metrics, rounded blocks), the auxiliary block encroaches on main content width, squeezing titles and body text into a narrow strip — destroying the card's information-carrying capacity.

**Principle: On mobile, the main content area within cards must receive full available width. Auxiliary info blocks must not horizontally compete with the main content area for the same row.**

**Scope**: horizontal layouts within cards (list items, detail cards, approval forms). Does not apply to icon grids, equal-width button groups, and other naturally short-content symmetric dual-column scenarios.

**Default strategy — give auxiliary blocks their own row**:
- Status pill / node marker → separate row at card top (can be right-aligned), or incorporated into a tag row
- Summary metric (e.g., "Today's tasks 12") → separate row at card bottom, or incorporated at the end of the title row
- On desktop (≥ `md`) where space is generous, restore side-by-side via `md:flex-row`

**Assessment standard**: if after side-by-side placement the main content width is insufficient for the title to be single-line or for body paragraphs to wrap reasonably (e.g., 6-character title wraps into two lines, body fits only 8~10 chars per line), side-by-side is not viable.

[FORBIDDEN] Mobile cards using `flex-row` with a right-side auxiliary rounded block that declares a width wider than `w-1/4` (or uses `grid-cols-2` even split) — statically checkable violation; auxiliary info blocks using `shrink-0` transferring all compression to the main content area; maintaining "desktop side-by-side visual" on mobile without layout adjustment.

### [FORBIDDEN] Identifier Info Blocks Side-by-Side with Main Content Area

The above principle equally applies to larger **identifier info blocks** (order numbers, ticket numbers, invoice numbers — "label + value" blocks that desktop designs place in a right column). On mobile, implementing them via `grid-cols-2`, `flex-row`, or fixed-width right columns squeezes the main content area to ~50–55% of card width: titles truncate or force-wrap character-by-character, and body text fits only 7–9 Chinese characters per line.

**Correct approach**:
- Migrate identifier info (order number, ID, etc.) to the **card top tag row**, right-aligned in the same row as the status pill (`justify-between`), or connected with a `·` separator following the status
- Main content area (title + body) occupies the full row width exclusively, not sharing any row with info blocks
- On desktop (≥ `md`), restore side-by-side via `md:grid-cols-[1fr_auto]` with the auxiliary column width constrained (e.g., `max-w-[120px]`) to prevent over-widening

[FORBIDDEN] Mobile using `grid-cols-2` to equally split main content area and identifier info blocks; identifier blocks declaring any fixed proportion wider than `w-1/4` (e.g., `w-1/3` ~ `w-2/5`) to encroach on main content width — statically checkable violation; using "visual balance" or "desktop design preservation" as justification for maintaining parallel dual-column structure on mobile.

### [BLOCKING] ETA / Time Summary Block Independently Occupying First-Screen Right Column

> **This rule is the highest priority blocking rule. Matching equals violation, regardless of whether main content exhibits truncation.** Adding `truncate` to the main title does NOT fix it — truncation is the result of layout failure, not the solution.

| Violating structure signature | Verdict | Fix action |
|---|---|---|
| Mobile first-screen first row: `flex justify-between` (or equivalent), left side status/progress pill group, right side an independent container whose semantics match "estimated arrival" / "estimated delivery" / "ETA" / "arrival time" / "delivery time" / "shipping time", or which contains an independent large-font `HH:MM` time value | Direct violation regardless of `shrink-0` / `rounded-*` / `bg-*` on the right container, and regardless of whether the main title visibly truncates — layout must be rearranged before continuing | Incorporate the time value + description as a right-aligned item **within the tag row** (same row as status pill, `justify-between`, single-line); if the time info exceeds what the tag row can carry, move it after the main title and body, **displayed on its own row** as a summary band |
| First-screen forms a "left tag area + right time summary area" dual-column division | Violation; "emphasizing urgency" / "brand feel" / "two auxiliary contents side-by-side" are not valid justifications | Same fixes as above; desktop (≥ `md`) may restore the independent right-side time block responsively |

---

## Mobile First-Screen Multi-Layer Identity Info Vertical Layering

Personal center / membership / account first screens carry multiple layers (avatar + name + level badge + validity description + action buttons) that all tend to "squeeze into the first row". **Core principle: priority differences between information layers must be conveyed through vertical layering, not horizontal compression.**

- Avatar, name, and level must not be compressed into the same horizontal row; font-size and color weight present clear primary/secondary relationships
- If a level badge alongside the name truncates/shrinks the name, move the badge to a separate row below the name
- Validity period, status descriptions, and other subordinate info go below the level, not horizontally alongside it
- If action buttons on the identity row compress identity info (title wrapping/truncation), move buttons to an independent row or position absolutely at top-right

**Assessment standard**: simulate mobile width — name fully single-line? Level badge text single-line readable? Validity description clearly visible? If any layer wraps or truncates due to horizontal compression, switch to vertical layering.

---

## Rounded Container Content Space Protection

> Design principle in `aesthetics/index.md §1 > Border-Radius and Container Size Proportion Constraints` and `§2 > Rounded Container Content Erosion in Narrow Spaces`.

**Goal**: border-radius must downgrade with container width — the narrower the container, the smaller the radius. Mobile (< 640px) cards default to `rounded-lg`; desktop can restore via `md:rounded-xl`. Large radius implies a higher minimum padding threshold; on narrow containers it severely erodes content space.

**Narrow-space text wrapping protection**: rounded containers in constrained spaces (card right-side auxiliary column, grid auxiliary column, sidebar) make 2~4-character text wrap character-by-character. Mobile-first: **let auxiliary rounded blocks go to a separate row** (see "Mobile Card Internal Dual-Column Layout Constraints"). On desktop side-by-side, give the container `shrink-0` and internal text `whitespace-nowrap`; if still insufficient, downgrade padding and radius rather than allowing wrapping — see "Rounded Block Wrapping Protection in Constrained Space" below.

**Field-level container merging**: on form detail pages, individual "label-value" fields must not have independent containers — merge multiple fields into one parent container, grouped with dividers or spacing.

**Option button groups**: side-by-side option buttons (e.g., "Normal/Abnormal") share one container with `flex-1` equal distribution, not individually wrapped in independent rounded containers.

[FORBIDDEN] Narrow cards (< 200px) using `rounded-2xl` causing insufficient content area; each form field occupying its own rounded container causing padding overhead accumulation and infinite page elongation; option buttons each individually wrapped causing 40%+ horizontal space waste; mobile and desktop using the same border-radius without responsive downgrade.

---

## Rounded Block Wrapping Protection in Constrained Space

Rounded blocks (pill badges, status markers, summary metric blocks — short-text containers with `rounded-*` + `bg-*` + `p-*`) in narrow columns easily cause 2~4 character text to wrap character-by-character into vertical stacking — one of the most common ugly states in mobile Chinese UI.

**Protection principle**: rounded block content must always remain single-line, but **never by sacrificing the main content area's available width**.

- **Mobile (< 640px), highest priority**: let auxiliary blocks go to a separate row (see "Mobile Card Internal Dual-Column Layout Constraints"); restore side-by-side on desktop via `md:flex-row`
- **Desktop side-by-side protection**: rounded blocks `shrink-0`; main content `flex-1 min-w-0`; internal text `whitespace-nowrap`; padding restrained (`px-2 py-0.5` ~ `px-3 py-1`); large radius in narrow spaces downgrades to `rounded-lg`/`rounded-md`
- **Downgrade priority (all breakpoints)**: when text exceeds single-line capacity — reduce padding → downgrade border-radius → reduce font-size → truncate text. **Wrapping is never allowed.**

**Self-check** (mobile viewport): (1) text inside a rounded block wraps character-by-character → violation; (2) the rounded block stays single-line but the adjacent main content title severely wraps or body becomes a narrow strip → equally a violation — move the block to its own row.

---

## Text Overflow Mandatory Handling

Text overflow handling: see `html-implementation.md` (common) "Text Overflow Mandatory Handling (All Devices)".

---

## Mobile Section Restraint and Structure Deduplication

> Design principle in `aesthetics/index.md §2 > Mobile Section Restraint` and `§2 > [FORBIDDEN] Adjacent Block Layout Structure Repetition`.

**Goal**: section count on mobile is determined by narrative needs — each section serves an irreplaceable role; adjacent sections have perceptibly different layout structures.

**Self-check** (review each top-level block within `<main>`): ① narrative role — if a block's role duplicates an adjacent block (e.g., "yet another product showcase group"), merge or delete; ② structure deduplication — if adjacent blocks' grid/flex structures are highly similar, restructure one, or merge into one block with tabs/category titles.

### Action Entry Areas

> Design principle in `aesthetics/index.md §2 > Action Entry Signal-to-Noise Ratio`.

Core assessment: **visual differentiation between entries relies on icons and text themselves, not container shells.** When an entry's independent container decoration area exceeds its icon + text area, remove independent containers and let all entries share the parent background. When entry count exceeds first-screen capacity, use horizontal sliding rather than adding rows.

**Column count constrained by label readability**: action-entry grid column count is determined by "can the longest label display single-line in each cell", not "visual neatness". Simulate before choosing: at the current container width divided by target column count, is the longest label single-line readable? If not, degrade column count. Chinese labels are especially sensitive — character-by-character vertical stacking in narrow cells is layout failure, not acceptable display.

---

## Mobile Page Post-Generation Mandatory Self-Check

> Applies to all mobile pages; execute immediately after page HTML generation is complete. The Main Agent must provide a "pass / fail" conclusion for each item. **If any single item fails, layout must be fixed before continuing to subsequent steps.**

| # | Check Item | Assessment Standard |
|---|--------|---------|
| 1 | Does the first-screen main title receive full row width | Main title row has no right-side auxiliary block coexisting; if ellipsis (`...`) appears, directly ruled non-compliant — "already added `truncate`" is not accepted as justification |
| 2 | Does the first-screen tag row right side have an independent time/ETA summary block | Semantic match on "estimated arrival", "estimated delivery", "ETA", "delivery time", or independent large-font `HH:MM` — ruled non-compliant |
| 3 | Does main content area get horizontally compressed by auxiliary blocks | Auxiliary block shares row with main content area while declaring a width wider than `w-1/4` or using `grid-cols-2` even split — ruled non-compliant |
| 4 | **Full page**: Does excessive nesting layout exist | Scan **all** blocks with backgrounds across the entire page, not limited to first-screen — DOM path passes through 2 or more containers each independently with `bg-*`+`rounded-*`+`p-*` — ruled non-compliant; **High-frequency scenario**: comparison blocks (plan comparison, option comparison, product side-by-side, etc.) outer block already has background, internal options **must not** have independent card backgrounds — use dividers or spacing separation only |
| 5 | Does first-screen information layer prioritize vertical layering | Horizontal side-by-side structures (main content + attached block) without sufficient width support still exist — ruled non-compliant |

---

## WeChat Mini Program Style Adaptation (SSOT)

> **Trigger**: `orchestration-summary.json.pages[].miniProgramStyle === true`. This section is the SSOT for mini program chrome rules; Quality Gate 10 references it.

When the user mentions "小程序" (mini program), affected pages apply the following visual simulation constraints. Mini program pages must simulate a real WeChat Mini Program navigation bar, not a generic mobile H5 header.

### Fixed UI Element Simulation

| Element | CSS Implementation | Notes |
|---------|-------------------|-------|
| Status bar | `<div class="h-11 bg-transparent"></div>` top spacer | Simulates device status bar space |
| WeChat navigation bar | `h-11 flex items-center px-4` with left back/balancing area, centered title, and right system capsule | Height 44px; title must remain visually centered |
| Right system capsule | Visible `w-[88px] h-8 rounded-full border` capsule containing more button + divider + close button | Empty capsules are forbidden |
| TabBar | `<div class="fixed bottom-0 inset-x-0 h-[50px] border-t flex items-center justify-around">` | Max 5 tabs (icon + label); only for pages identified as tab pages by Main Agent |
| Safe area bottom | `<div class="h-[env(safe-area-inset-bottom,34px)]"></div>` | Full-screen device compatibility |

Standard mini program navigation bar example:

```html
<header class="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
  <div class="flex h-11 items-center px-4">
    <div class="flex w-[88px] items-center justify-start">
      <button class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--background)]" aria-label="返回">
        <i data-lucide="chevron-left" class="h-4 w-4"></i>
      </button>
    </div>
    <div class="min-w-0 flex-1 text-center text-[16px] font-semibold tracking-[-0.02em]">页面标题</div>
    <div class="flex h-8 w-[88px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--background)]/90 text-[var(--foreground)]" aria-label="小程序菜单">
      <button class="flex h-full flex-1 items-center justify-center" aria-label="更多">
        <i data-lucide="more-horizontal" class="h-4 w-4"></i>
      </button>
      <span class="h-4 w-px bg-[var(--border)]" aria-hidden="true"></span>
      <button class="flex h-full flex-1 items-center justify-center" aria-label="关闭">
        <i data-lucide="x" class="h-4 w-4"></i>
      </button>
    </div>
  </div>
</header>
```

- Secondary pages show a left back button. Root/tab pages may omit the visible back icon but must keep a left `w-[88px]` balancing area so the centered title aligns with the right system capsule. The right system capsule is always visible and must not be replaced by an empty placeholder.

### Page Container Constraints

Main content area must account for fixed UI: top padding = status bar (44px) + nav bar (44px) = 88px; bottom padding = TabBar (50px) + safe area (34px) = 84px (only if the page is a tab page).

### Visual Style Rules

| Dimension | Specification |
|-----------|--------------|
| Buttons | Primary button follows brand color (NOT WeChat green #07C160); secondary uses muted variable |
| Font size | Base 14px (equivalent to mini program 28rpx), headings 16-18px |
| Border radius | Business UI defaults to `rounded-lg`; `rounded-full` is forbidden for CJK text pills longer than 4 characters. The right mini program system capsule is the only allowed `rounded-full` exception and must contain visible more/close affordances. |
| Modals | Centered half-screen modal (max-height ≤ 70vh), bottom rounded corners, backdrop overlay |
| List items | Horizontal padding 16px, vertical padding 12px, bottom border dividers (not shadow cards) |

### Important Notes

- This is a **visual simulation** — HTML reproducing the "look and feel" of a mini program, not actual mini program APIs
- Mini program system chrome is not brand UI: the right capsule must not use `var(--primary)`/`var(--secondary)`/`var(--accent)`/`var(--card)`, brand shadows, or decorative borders; empty visible capsules are forbidden — it must contain a more action, a divider, and a close action (with `aria-label="关闭"`/`"Close"` and a close icon such as `data-lucide="x"`)
- If a project contains both "mini program" and "H5" pages, `miniProgramStyle` applies only to mini program pages; H5 pages use standard mobile constraints. TabBar renders only on pages identified as "tab pages" by the Main Agent (based on `businessScenario`)
