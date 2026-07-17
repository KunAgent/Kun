# Page Information Density & Library Adaptation — Implementation Strategy

> **Audience**: This file is for **Sub-Agents** only. The Main Agent classifies each page and passes a `pageType` label; Sub-Agents read this file to understand the detailed layout strategy for each type.

---

## Cognitive Science Foundations (Laws of UX)

| Executable Design Rule | Applies To |
|----------------------|------------|
| A single decision screen must present at most **3–5 primary options**; fold remaining into "More" or progressive disclosure (Hick's Law) | Navigation, feature entries, action menus |
| Pricing pages: 3–4 tiers max, with one marked "Recommended". Product grids: 6–9 items per first screen viewport (Choice Overload) | Pricing, product catalogs, plan selectors |
| Related fields must be grouped; settings pages split into **≤ 5 named groups** with clear section headers (Miller's Law) | Forms, settings, dashboards with many metrics |
| Most important navigation items go **leftmost and rightmost** (or topmost and bottommost on mobile) (Serial Position Effect) | Navigation bars, tab bars, sidebar menus |
| Place a **celebration/success state** at the end of multi-step flows; keep middle steps calm and frictionless (Peak-End Rule) | Checkout flows, onboarding wizards, form submissions |
| The recommended pricing tier must be **visually distinct** (larger, different color, badge, lifted card) — not just labeled "Popular" (Von Restorff Effect) | Pricing tables, feature comparison |
| Intra-group spacing: **8–12px** (`gap-2` ~ `gap-3`); inter-group spacing: **32–48px** (`gap-8` ~ `gap-12`). The ratio must be ≥ 3:1 for grouping to register (Law of Proximity) | All layouts — cards, form fields, metric blocks |
| Cards need internal padding **≥ 16px** + a distinguishable surface (border OR background shade). Without both, the "region" doesn't register (Common Region) | Cards, panels, sections, modals |

### Application Priority

When density rules below conflict with these cognitive principles, **cognitive principles take priority** — they represent how human perception actually works, not arbitrary aesthetic preferences.

---

## Page-Type Layout Strategies

> **Identification**: Main Agent passes `pageType` (`information-dense` / `showcase` / `task-driven`).

**`information-dense`** — priority: scannability > clear actions > brand character
- Restrained title font size; Chinese titles must not pursue "large and impactful" — clarity first
- First-screen information blocks prioritize vertical expansion with clear separation between layers
- Action-entry column count is constrained by the longest label being single-line readable, never by visual neatness
- Decorative elements (large rounded overlays, large whitespace areas, showcase eyebrow titles) greatly reduced; brand character is conveyed through color accents (primary-color buttons, label backgrounds, top color blocks) and local font-weight differences, not space-consuming decorative structures

**`showcase`** — brand promotion / campaign landing / product introduction pages focused on **narrative and attractiveness** may use richer visual language: wide whitespace, decorative containers, varied layout rhythm. **However, the heading-must-be-words rule applies without exception**: hero titles remain short noun phrases (≤ 4 CJK chars / ≤ 2 words); marketing slogans and descriptive sentences go in subtitle/body text, never in heading tags or display-size text.

**`task-driven`** — priority: operational continuity > scannability > brand character
- Control areas must not be compressed into narrow columns beside read-only summary areas — controls need sufficient width for operability
- When a read-only summary sits beside controls, the summary takes the narrower column (secondary role); never equal-width side by side
- Explanatory content not requiring operation (policies, tips, notes) must not appear as independent equal-weight cards next to the control area; embed or collapse it

---

## Design Library "Restraint Mode" — Layout Adjustment Details

> **Trigger**: Restraint Mode is detected by the Main Agent and passed as a boolean flag (`libraryRestraintMode: true`); Sub-Agents only consume the flag.

### When Restraint Mode is Active

- Column count trends conservative (prefer fewer, wider columns over more narrow ones)
- Card fragmentation decreases (consolidate related information into fewer containers)
- Vertical information groups take priority over horizontal metric blocks
- Hard-edge, high-contrast design libraries amplify the defects of excessive layout density — what was "barely acceptable" multi-column cramming becomes obvious visual fragmentation with such Libraries

---

## Cross-type Coexistence Rule

**These three page types coexist within the same project.** The multi-column card rhythm of showcase pages must not be applied to information-dense or task-driven pages. Sub-Agents select the corresponding strategy based on the `pageType` label received from the Main Agent.

---

## Post-generation Crowding Self-check (Mandatory for all pages)

> After page content is written and before submission, must complete the following crowding self-check. If any single violation is found, it is a layout defect that must be fixed before submission.

### Universal Checks (all page types)

- **First-screen density**: more than 3 elements competing for the same readable width horizontally (avatar + name/level group + action buttons in one row)? → vertically layer lower-priority elements. Subordinate info (level badge, expiry notes) squeezed in the same row as primary info (name, key numbers)? → move to a separate row below
- **Function entry grid**: was "can the widest label display single-line within one cell" evaluated before choosing column count? If not, or the answer is no → downgrade column count. Chinese labels wrapping character-by-character (e.g., "礼赠中心" → "礼赠/中心" or vertical) → layout failure, not acceptable display
- **Multi-column layout (desktop + mobile)**: column content wrapping into vertical arrangement, charts severely compressed, or table columns forced to reduce → give that column more width or reduce column count. Nested columns: inner layer still uses full-page-width column count after the outer skeleton compressed the parent → re-evaluate inner column count

### Information-Dense Pages Only (when `pageType: "information-dense"`)

> Implementation details in `html-implementation-web.md` "Information-Dense Page First-Screen Layering Constraints"; the checks below verify compliance.

- Title description area + auxiliary status block + statistics card grid all horizontally parallel in the same first-screen main layout? → split into vertical layers (title layer / statistics layer / action layer)
- Text area's flex expansion the only width protection while the right-side stats grid declares full-width expansion? → flex expansion alone is insufficient; move the stats grid to a separate row
- Auxiliary status blocks standalone in a horizontal row creating three-way competition? → incorporate them inline within the title layer
- First screen stacking large border-radius nesting + large whitespace + large titles simultaneously? → choose one dominant visual language and downgrade the others

---

## Dashboard Mode — Layout Strategy

> **Identification**: `orchestration-summary.json.project.dashboardMode === true`

**Layout principles**:

| Dimension | Rule |
|-----------|------|
| Viewport | 1920×1080 as design baseline (NOT responsive — data screens are typically fixed-resolution displays) |
| Grid | CSS Grid as primary layout tool; recommend 12-column grid or asymmetric block divisions |
| Density | High density — 6-12 data modules visible per screen |
| Color | Dark theme by default (reduces glare in projection environments); data values use high-contrast bright accent colors |
| Typography | Numbers use `font-variant-numeric: tabular-nums` + monospace font family; headings use sans-serif |
| Charts | Chart.js `<canvas>` as primary visualization method; simple KPI metrics may use CSS-only progress bars |
| Spacing | Compact inter-module gaps (`gap-3` ~ `gap-4`) to maximize screen efficiency |

**Responsive exemption**:
- Dashboard mode pages **may** use fixed-width layouts (e.g., `w-[1920px]` or `max-w-[1920px] mx-auto`) because data screens do not require multi-device adaptation
- Quality Gate 4 (Responsive Layout) is **skipped** when `dashboardMode: true`
- Chart containers within the fixed shell should still use percentage widths for internal responsiveness

**Restrictions**:
- [FORBIDDEN] Using fixed pixel widths in non-dashboardMode projects
- [AVOID] Using `rounded-full` large pill-shaped cards in dashboard pages (data screens require clean, structured edges)

**Priority when conflicting with Restraint Mode**: If both `dashboardMode: true` and `libraryRestraintMode: true` are active, Dashboard Mode density rules take priority — high information density is the core requirement for data screens.

---

## Page Length Control — Prefer Short Pages with Multi-Level Navigation

> **Audience**: Main Agent (page planning) and Sub-Agents (content scoping).

Generated pages tend to be excessively long, packing all content into one scrollable surface — users lose context and the page feels like a wall of content. **Strategy: prefer splitting into multiple short pages over one long scrollable page.**

### Main Agent — Page Planning Rules

When planning page structure for a project (screen-height targets below are design intent, not checkable rules — the enforceable standard is the Sub-Agent section limit: mobile ≤ 4 / desktop ≤ 6 content sections):

1. **Mobile pages**: Aim for roughly ≤ 2 screen-heights of content. If planned content exceeds this, split into multiple pages connected by navigation.
2. **Desktop pages**: Aim for roughly ≤ 3 screen-heights of content. Landing/showcase pages may extend further with clear section rhythm.
3. **Task-driven pages**: Keep to 1 screen-height whenever possible — the user should see all actionable content without scrolling.
4. **Information-dense pages**: Use tabs, segmented controls, or progressive disclosure to keep visible content compact. Place secondary information in sub-pages.

### When to Split Pages

| Signal | Action |
|--------|--------|
| Page has > 5 distinct content sections | Split into 2-3 pages with clear navigation (tabs, bottom nav, or drill-down links) |
| Mobile page requires > 3 swipes to reach bottom | Move lower sections to dedicated sub-pages accessible via navigation |
| Mix of task-driven and informational content | Separate into "action page" + "detail/info page" |
| Unrelated feature areas on one page | Each feature area becomes its own page |

### Sub-Agent — Content Scoping Rules

- Do NOT cram all possible information onto one page. If the Main Agent's content brief feels dense, implement only the highest-priority sections and suggest remaining content for a linked sub-page.
- **Section limit (enforceable standard)**: Mobile pages ≤ 4 content sections (excluding header/footer). Desktop pages ≤ 6 content sections.
- Use "View more" / "查看详情" links to indicate content continues on another page rather than rendering everything inline; complex-detail cards show summary state on the list page with full detail on a dedicated detail page.

### Navigation Between Pages

Every split creates a navigation need — ensure buttons, links, or tabs exist to connect pages. Bottom tab bars, breadcrumbs, and "back" links must be consistent across all pages in the same project. The Main Agent's wiring strategy handles inter-page links; Sub-Agents create the DOM hooks (`data-dom-id`) for navigation elements.
