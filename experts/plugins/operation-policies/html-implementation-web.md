# HTML Layout Constraints — Web / Desktop

This document defines layout constraints specific to desktop and tablet page generation. **Read only when device type is `desktop` or `tablet`**; for mobile scenarios, read `html-implementation-mobile.md`. For common technical constraints see `html-implementation.md`; for aesthetic/visual quality requirements see `aesthetics/index.md`.

---

## Internal Element Width Constraints (Mandatory)

All internal elements (grid items, cards, info blocks) must use fluid widths to fill the space allocated by their parent container. `max-w-*` is only used for the page's outermost content container; internal cards and blocks must not use it.

[FORBIDDEN] Setting fixed widths (e.g., `w-[300px]`) or restrictive max-widths (e.g., `max-w-sm`) on grid items, cards, or content blocks, causing elements to fail to fill their parent container with blank space beside them.

---

## Top Navigation Bar Full-Width Constraint

**Goal**: The navbar is a page-spanning chrome element that must stretch across the full viewport width (background/border fills full width) with centered internal content area. The navbar background color should match the page Body base color, using fine lines or subtle shadows to imply boundaries rather than a color band creating visual separation.

[FORBIDDEN] Setting `max-w-*` or fixed width on the navbar causing blank space on both sides; navbar being compressed by content area padding making it narrower than the content area; navbar title lacking centered alignment relationship; navbar and Body background colors being inconsistent creating a "two-piece splice" appearance.

---

## Chart Companion Info Area CSS Implementation

> Design principle in `aesthetics/index.md §2 Layout & Composition > Chart Companion Info Layout Principle` and `aesthetics/index.md §3 Typography > Data Annotation Text`. This section provides CSS implementation constraints.

**Goal**: The KPI metric area and text summary area above charts are subordinate information to the chart and must share the parent card with the chart without an independent container. Metrics are horizontally arranged, each with limited width and truncated annotations, with summary text de-emphasized. Internal metrics maintain a three-tier font-size descending hierarchy (label → value → annotation).

[FORBIDDEN] Wrapping the KPI metric area in an independent card causing visual separation from the chart; metric annotations with unlimited width causing metric columns to expand; text summary area with independent borders causing its weight to compete with data for attention.

---

## Column Fitness CSS Implementation

> Design principle in `aesthetics/index.md §2 Layout & Composition > Column Fitness — Column Fitness Pre-Assessment`. This section provides CSS-level implementation guidance.

### Goal

Every content block placed into a column layout must receive sufficient width to **maintain its original display form**: table column counts not forced to reduce, card grids not degraded to single-column, charts not compressed to illegibility, text not character-by-character wrapped.

### Implementation Principles

- **12-column grid with differentiated `col-span-*` by content volume**. Equal-width allocation for blocks with vastly different volumes (e.g., `grid-cols-2` giving a table and a KPI number each 50%) is forbidden.
- **One protagonist per row**: the protagonist block takes the majority share (`col-span-8`+); companions take the remainder. If two blocks both need large shares, each occupies its own row (`col-span-full`).
- **Mobile defaults to stacking; no "mobile exemption"**: if multi-column is retained on mobile (icon grids, data overview cards), the same fitness assessment applies with a narrower viewport, so compression risk is higher.

### Assessment Signals

Before determining column count, mentally shrink each block to its allocated width. If any of these triggers, give the block more width, reduce column count, or use horizontal scrolling — silently compressing content is not allowed (desktop and mobile alike):

- Text labels/body paragraphs would character-by-character wrap or stack vertically
- Tables/grids would need to reduce visible column count
- Charts would compress until axis labels overlap or graphics become illegible
- Card groups would degrade from horizontal to vertical stacking

### Common Anti-Patterns

- **Skeleton first, content second** — writing `grid-cols-3` first then stuffing content in; assess content volume first to determine column count
- **Equal-width for symmetry** — vastly different volumes given the same `col-span`; allocation must reflect content needs, not visual symmetry
- **Complex info in sidebar** — sidebars are narrow-column roles; chart + metrics + description composites belong in the main area
- **Dashboard cards uniformly equal-width regardless of volume** — a table card and a single-KPI card must not receive the same width
- **Fixed column count without responsive degradation** — pricing/feature-comparison card rows must reduce column count with breakpoints or use `auto-fit` + `minmax()`
- **Nested column compression stacking** — inner multi-column inside an outer multi-column skeleton compounds width loss; simulate per-cell width at the parent's actual width before generating inner columns; if insufficient, degrade column count or use horizontal scrolling

### Nested Column Proactive Circuit-Breaking

The above anti-patterns are extremely easy to overlook in "skeleton first, content second" workflows. The following situations must undergo explicit checking **before** writing HTML; triggering any one forces the corresponding downgrade:

| Circuit-Breaking Condition | Mandatory Execution Rule |
|---------|------------|
| An outer page-level horizontal split already exists, and within one of the split columns there is a collection of user-operable controls (input fields, selectors, etc.) | That column's internal control collection must be changed to vertical arrangement; horizontal sub-columns within it are forbidden |
| A container already has internal horizontal columns, and in any one column at its allocated width, content (text, controls, charts) would wrap or be severely compressed | Change that column's content to vertical arrangement, or upgrade the entire container to full-width |
| Three or more different column counts of horizontal layouts simultaneously exist within one screen (e.g., some area 2 columns, some area 3 columns, some area 4 columns all appearing together) | Remove the intermediate layer; consolidate column counts; or change secondary horizontal structures to vertical lists |

**Circuit-breaking targets only the local block where the condition is triggered** — it does not require the entire page to degrade to single-column; other blocks are unaffected.

---

## Form Field Column Width Allocation Principles

Form field column widths are determined by the **predictability of user input values**, not by a skeleton equal-width grid.

- **Input value length and format are predictable** (option dropdown, date picker, quantity, short ID, etc.): May be placed side-by-side with other fields horizontally, but two conditions must be checked before doing so: ① the two fields semantically describe two ends of the same dimension (e.g., start/end time, area code + number), and side-by-side placement has cognitive value for the user; ② each field's label text does not wrap at the current column width
- **Input value is freely entered by user, length unpredictable** (name, email, address, description text, etc.): Must occupy the full row width; horizontal side-by-side with other fields is forbidden
- **Multi-line text input** (`<textarea>`): Always occupies full row width

**Self-check signal**: If a field's label needs to wrap at the current column width, the column is already too narrow — must widen or degrade to single-column. Label wrapping is the leading signal that input field width is insufficient.

---

## Card Main Content Area and Action Area Side-by-Side Width Protection

When descriptive text (title + body) and an action button group share a horizontal row inside a card without explicit flex declarations, buttons borrow width from the main content, compressing text into character-by-character wrapping — even on desktop.

- **Core principle**: description text is the main content and preferentially receives remaining width (`flex-1 min-w-0`); the action button group is auxiliary and keeps intrinsic size (`shrink-0`). The two flex roles must be explicitly opposed — never both left in browser-default allocation.
- **Assessment signal**: any description line wrapping unexpectedly at current card width (it could be single-line in a wider container) means the side-by-side structure failed to protect main content width.
- **Downgrade**: when the card is compressed by an outer multi-column skeleton or the button group is large, move buttons below the description text as their own row.

[FORBIDDEN] Description area without flex expansion (compressed by right-side buttons); button group without no-shrink (buttons themselves compressed); using "right-align buttons" as justification for no minimum-width protection on the text area; desktop showing description multi-line wrapping while the action area has excessive whitespace — structural imbalance.

---

## Text Overflow Mandatory Handling

Text overflow handling: see `html-implementation.md` (common) "Text Overflow Mandatory Handling (All Devices)".

---

## Information-Dense Page First-Screen Layering Constraints

The first screen of information-dense pages (admin, list, data dashboard) typically carries three content types with different width needs: **title/description text area**, **auxiliary status blocks** (sync time, today's updates), **statistics card grid** (KPIs). Placing them in the same horizontal main layout makes the text area degrade into character-by-character wrapping — even on wide viewports. Flex expansion only guarantees "can acquire remaining space", not "sufficient width for continuous Chinese reading", so once the stats grid greedily expands, the text area fails.

### First-Screen Three-Layer Structure Principle (default)

- **Title layer**: page title + description + auxiliary status info (inlined here; must not be an independent competing dimension)
- **Statistics layer**: stats card grid, horizontally filling available width
- **Action layer**: filters, search bar, batch operations

Stability-first: readability in admin pages outranks "dashboard-style horizontal fill" — better to layer than force side-by-side.

### High-Risk Horizontal Competition (proactively downgrade)

- Horizontal flex row: left title/description with flex expansion + right stats card grid declaring full-width expansion → natural width competition, text silently compressed
- Title description + auxiliary status block + stats grid all three side-by-side in one row → the small status block further compresses the text area

**Assessment signal**: simulate — if the stats grid expands to its content-needed width, can the remaining title/description width keep Chinese paragraphs continuously readable without wrapping? If not guaranteed, switch to top-to-bottom layering.

### Downgrade Strategies

- Move the stats card grid below the title area as its own row
- Auxiliary status info attaches to the end of the title layer or inlines as a lightweight tag at the right end of the title row
- If the title layer needs right-side action buttons, the button group declares no-shrink with remaining width preferentially allocated to text

[FORBIDDEN] Title/description area and stats card grid competing side-by-side in the same horizontal main layout; auxiliary status blocks as independent third competitors in a horizontal row; pursuing horizontal fill "to look more like a dashboard" at the expense of readability; relying on flex expansion alone without verifying actual readable width after stats cards expand.
