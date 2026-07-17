# Screen Craft — Scenario Layout Discipline for UIKit Screens

> Distilled from the solo-design page-generation system (visual-zero-tolerance,
> html-implementation-mobile, page-density-strategy). Read AFTER `aesthetics/index.md`.
> `index.md` governs visual language; this file governs how each SCREEN TYPE is
> structured so it reads as a real product screen, not a component arrangement.
> Sections: §1 applies to ALL kit types; §2 app; §3 dashboard; §4 website/web.

---

## 1. Zero-Tolerance Rules (all kit types — check before AND after writing)

1. **Single language**: all headings, labels, buttons, nav items use exactly ONE
   language (match the brand's `language`). Exceptions: brand names, universal
   abbreviations (KPI, VIP, ID).
2. **Headings are words, never sentences**: any title-like text (screen title,
   card title, list-item title, modal title, nav/tab label) ≤ 8 CJK chars or
   ≤ 4 English words. No sentence-ending punctuation (。？！….?!). If a heading
   wraps to 2 lines, the font-size is too large. Descriptions go in body text.
3. **Nothing above headings**: no eyebrow/kicker/overline text, tag rows, tab
   bars, or decorative icons stacked directly above a heading inside its
   section. Only global navigation or the previous section may precede it.
4. **Text on background is centered on both axes**: every button, chip, badge,
   tab, pill uses flex centering (`align-items:center; justify-content:center`)
   with symmetric padding and single-line text. Fixed height without vertical
   centering is forbidden.
5. **No component overlap**: minimum 8px gap between adjacent components;
   absolutely-positioned badges keep ≥12px clearance from readable text.
6. **Radius comes from the library**: never enlarge/shrink border-radius "to
   look better". Source priority: component class in components.css → radius
   token in colors_and_type.css → conservative small radius. `rounded-full`
   pills are forbidden for CJK text longer than 4 characters.
7. **Strict reproduction, not style imitation**: the component library is a
   specification, not an inspiration board. Component DOM anatomy, state
   treatment, and proportions must match components.css/anatomy exactly. If a
   needed role is not covered, compose existing components first; a custom
   element built from tokens only is the last resort.
8. **CTA copy is short**: CJK 2-6 chars, English 1-3 words. Long action phrases
   split into supporting text + short button label.

## 1.1 Cognitive Density Laws (all kit types)

- A single decision screen presents at most **3-5 primary options**; fold the
  rest into "more" or progressive disclosure (Hick's Law).
- Intra-group spacing 8-12px, inter-group spacing 32-48px — the ratio must be
  ≥ 3:1 or grouping does not register (Law of Proximity).
- Cards need internal padding ≥ 16px AND a distinguishable surface (border or
  background shade); otherwise the region does not register (Common Region).
- Grid column count is constrained by the LONGEST label being single-line
  readable in one cell — never by visual neatness. CJK labels wrapping
  character-by-character into vertical stacks is layout failure, not display.
- Adjacent sections must have perceptibly different layout structures; if two
  neighboring blocks share the same grid/flex skeleton, restructure or merge.

## 1.2 Text Overflow Is Mandatory, Not Optional (all kit types)

- Every text node inside a width-constrained container declares truncation:
  single-line → `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`;
  multi-line → `-webkit-line-clamp: 2/3`.
- Flex children carrying truncated text need `min-width: 0` on themselves and
  cooperative parents, or truncation silently fails.
- Truncation is a SAFETY NET, not a layout fix: if a primary title shows "…"
  at design width, the layout itself is wrong — rearrange, don't truncate.

---

## 2. App Kits (`ui_kits/app/`) — Phone Screen Discipline

### 2.1 Nesting & Screen Efficiency

- Visible container nesting ≤ 2 layers: along any DOM path, at most ONE
  ancestor may carry independent `background + radius + padding` before the
  content node. Sub-regions inside a card use dividers, spacing, or font-weight
  for grouping — never their own card shell.
- Screen efficiency (content width / frame width) ≥ 75%. Stacked padding from
  nested cards is the main thief; flatten before shrinking text.
- 3+ semantic levels (list → group → item): only level 1 gets a visible
  container; deeper levels use bold titles, dividers, spacing, or a left rule.

### 2.2 Main Content Owns the Row (BLOCKING)

- Inside any card/list row, the primary content (title + body) receives full
  available width. Auxiliary blocks (status pill, ID/order-number block,
  time/ETA summary, metric chip) move to their own row — top tag row
  (right-aligned with `justify-between`) or a bottom summary band.
- BLOCKING pattern: first screen renders a "left tag column + right
  independent time/ETA/metric block" two-column split. Match = violation,
  even if nothing visibly truncates yet. Fold time info into the tag row or
  give it its own band below the title.
- Identity headers (avatar + name + level + expiry + actions) convey priority
  by VERTICAL layering, not horizontal compression: name single-line readable;
  badges below the name when they squeeze it; actions on their own row or
  pinned top-right.

### 2.3 Screen Restraint

- Each screen ≤ 5 content blocks (excluding status bar/header/bottom nav, per
  the dispatch prompt budget); every block must serve an irreplaceable
  narrative role — "yet another showcase group" gets merged or cut.
- Target ≤ 2 frame-heights of scrollable content per screen. More content
  belongs on another screen reachable via navigation, with the link rendered.
- Action-entry grids: entries differentiate by icon + label, not container
  shells. If per-entry container decoration outweighs its icon + text, drop
  the shells and share the parent background.

### 2.4 Radius vs Width

- Border-radius downgrades as containers narrow: phone cards default to the
  library's medium radius; large radius on narrow containers (< 200px) erodes
  content space. Downgrade order when text can't fit single-line:
  reduce padding → downgrade radius → reduce font-size → truncate.
  Wrapping a 2-4 char label vertically is never acceptable.

## 3. Dashboard Kits (`ui_kits/dashboard/`) — Density Is the Feature

- High density is the requirement: 6-12 data modules visible per screen,
  compact inter-module gaps (12-16px). Sparse dashboards read as empty, not
  clean.
- Numbers use `font-variant-numeric: tabular-nums`; KPI values are the largest
  text on screen, their labels the quietest.
- First screen must NOT horizontally cram title + status + stats grid + actions
  into one readable width. Split into vertical layers: title layer (title +
  inline status), stats layer (KPI grid), action layer (filters/search).
- Tables: header `white-space:nowrap`; cells truncate or line-clamp; one text
  action + one icon action max per row — never stacked full-width buttons in a
  cell.
- Charts render plausible data: ≥ 12 points with a believable trend; no empty
  charts, no all-equal bars.
- `rounded-full` pill cards are forbidden — data surfaces need structured
  edges.
- Sidebar/nav labels truncate; the content column always carries `min-width:0`.

## 4. Website Kits (`ui_kits/website/`) — Narrative With Discipline

- Showcase pages may use rich visual language (wide whitespace, varied rhythm),
  but hero headings stay short noun phrases (≤ 4 CJK chars / ≤ 2 words);
  slogans live in the subtitle.
- Information-dense sub-pages (pricing detail, docs index) switch to
  scannability-first: restrained title sizes, vertical layering, fewer
  decorative containers.
- Pricing: 3-4 tiers max, exactly one visually distinct "recommended" tier
  (lifted card / different surface — not just a label).
- Avoid three equal feature cards as the dominant first block after the hero
  unless the business genuinely compares three equal things.
- Each section's layout must differ from its neighbor; repeated grid skeletons
  across consecutive sections are a structure-deduplication violation.

---

## 5. Post-Write Screen Check (run per screen before Write)

| # | Check | Standard |
|---|-------|----------|
| 1 | Headings | All title-like text ≤ 8 CJK / 4 words, no sentence punctuation, nothing stacked above |
| 2 | Main-content width (app) | No first-screen right-column auxiliary block; primary title gets full row; no "…" on primary titles |
| 3 | Nesting (app) | No DOM path with 2+ background+radius+padding ancestors |
| 4 | Truncation | Every width-constrained text node declares truncate/line-clamp; flex parents have min-width:0 |
| 5 | Grid labels | Longest label single-line readable per cell, else column count reduced |
| 6 | Centered chrome | Buttons/chips/tabs/badges flex-centered both axes, single-line |
| 7 | Density fit | app: ≤5 content blocks/screen; dashboard: 6-12 modules visible; website: adjacent sections structurally distinct |
| 8 | Fidelity | Every component matches components.css anatomy; radius from library tokens only |

Any failure → fix before Write. "Add truncate and move on" is not a fix for
layout-competition failures (#2).
