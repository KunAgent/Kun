# Aesthetics — Visual Quality System

This file defines the visual quality bar for page generation. It is not a generic design primer — it is the binding spec used to lift output from "acceptable" to "designed". Read it before generation. Every page must pass the checks in `self-check.md` before declaring completion; read `self-check.md` deeply when generating a brand / marketing Showcase home page.

Coverage: web pages, mobile App showcases, portfolio sites, editorial / graphic surfaces.
Audiences and businesses: finance, content, tools, e-commerce, education, healthcare, government, culture, B2B SaaS, C2C community, etc.

## How to Use This Spec

- **Principle over parameter**: Numeric values in this file (px, font sizes, color tokens) are defaults, not absolutes. When the business tone is clear (bank = trustworthy, kids = playful, culture = quiet), shift the whole stack while preserving the proportional relationships and rhythm discipline.
- **Tokens are placeholders, not colors**: `--brand`, `--accent`, `--ink`, `--surface` are placeholder names. Each project assigns concrete hues based on business, brand, and audience. What this spec governs is **usage rules** (accent area ≤ 5%, ≤ 6 hues per page), not specific hues. When a Design Library is assigned, replace placeholders with brand-prefixed equivalents (`var(--{prefix}-primary)`) per `SKILL.md > Token Compliance`.
- **Layouts are interchangeable**: §11 Showcase Pattern Atlas is the **preferred set** when the page is a Hero / Showcase / Landing surface. When the business does not fit (serious government / medical / annual reports), fall back to §2.1 rhythm patterns with restrained UI Kit usage — but North Star and the blacklist still apply.
- **Blacklist is the floor**: §0 North Star and §8 Anti-AI-Slop are non-negotiable. Other clauses can be deviated from only with a stronger visual rationale.

---

## 0. North Star — What Counts as "Designed"

A page is unqualified unless all five hold:

1. **Information focus is instant** — within 1 second the viewer can identify what the page is about.
2. **Rhythm is not flat** — whitespace, type scale, and composition clearly separate primary, secondary, and tertiary content. Not a wall of equal-weight cards.
3. **Detail is restrained** — radius, shadow, border, decoration each follow a single system; never stacked.
4. **Believability is real** — copy, data, imagery match the business; no Lorem, no placeholder language, no fabricated metrics.
5. **No AI smell** — no rainbow gradients, no colored-icon-tile feature walls, no neon glow, no particle noise, no generic AI-template structure.


## Mandatory Rules

The following are binding. Violations fail the quality gate.

1. **Token-First** — all colors, fonts, radii, shadows must come from §1 tokens or the brand-prefixed CSS variables when a Design Library is assigned. No invented values.
2. **Library-First** — when Design Library docs and UI Kits are assigned, follow them. Reimplementing from scratch when an HTML Reference is available is [FORBIDDEN].
3. **Visual blacklist** — every reverse pattern listed in §8 Anti-AI-Slop is a hard fail. Treat §8 as the single authoritative visual lint.
4. **State coverage is required** — any dynamic section must cover loading, empty, error, populated, edge.
5. **Form validation is required** — any form must include validation, submission, recovery states.
6. **Accessibility baseline** — meet WCAG 2.2 AA for contrast, touch target, focus visibility, semantic structure.
7. **One Pattern per page** — when the page is a Hero / Showcase, pick exactly one Pattern from §11 Showcase Pattern Atlas; remaining sections fall back to §2.1 rhythm.
8. **Quality gate is non-optional** — run the checks in `self-check.md` before declaring completion; full file for brand / marketing Showcase home pages.

---

## 1. Design Tokens

Tokens must be fixed as CSS variables before components are written. The names below are placeholders — when a Design Library is assigned, replace them with brand-prefixed equivalents.

### 1.1 Spacing (8pt grid)

| Token | Value | Usage |
| --- | --- | --- |
| `--s-1` | 4px | icon-to-text, tag inner padding |
| `--s-2` | 8px | tight control gaps |
| `--s-3` | 12px | card line spacing |
| `--s-4` | 16px | default control spacing |
| `--s-5` | 24px | in-block group spacing |
| `--s-6` | 32px | between cards |
| `--s-7` | 48px | between sections (mobile) |
| `--s-8` | 80px | between sections (desktop) |
| `--s-9` | 120px | hero vertical breathing (desktop) |

### 1.2 Type Scale

Desktop base 16px, mobile base 15px, with `clamp()`.

| Role | Size | Line-height | Weight | Tracking |
| --- | --- | --- | --- | --- |
| Display | clamp(40px, 6vw, 88px) | 1.02 | 600 | -0.03em |
| H1 | clamp(28px, 3.5vw, 48px) | 1.1 | 600 | -0.02em |
| H2 | clamp(22px, 2.4vw, 32px) | 1.2 | 600 | -0.015em |
| H3 | 20px | 1.3 | 600 | -0.01em |
| Body-L | 18px | 1.55 | 400 | 0 |
| Body | 15–16px | 1.6 | 400 | 0 |
| Caption | 13px | 1.5 | 400 | 0.005em |
| Mono | 13–14px | 1.5 | 500 | 0 |

Rules:

- ≤ 4 different sizes per screen, with clear jumps. 14 / 15 / 16 in the same view is forbidden.
- Do not combine bold weight + colored block to emphasize the same heading; pick one.
- Chinese primary headings ≤ 20 characters; longer must split into title + subtitle.
- Display scale is full-width only; in split columns (< 60% width), cap at H1. See §3.2 Heading Fit.
- All Display/H1 headings require `text-wrap: balance` for even line distribution.

### 1.3 Color (5-channel palette, mandatory)

```
--bg          page base (one)
--surface     card / container (4–6% lighter or darker than --bg)
--surface-2   hover / selected (another 4% step)
--ink         primary text
--ink-2       secondary text (70% of --ink, or independent gray)
--ink-3       tertiary / placeholder (45%)
--line        divider / border (< 6% contrast vs --surface)
--brand       brand primary (single hue)
--brand-ink   text on brand fills
--accent      accent for CTA / data highlight (≤ 2 occurrences per screen)
```

Rules:

- ≤ 6 hues total per page including black / white / gray.
- Accent area ≤ 5%; never tile accent across backgrounds or icon walls.
- 3+ stop linear / radial gradients are forbidden; only same-hue 8–15% lightness gradients allowed for surface depth.
- No neon glow, no rainbow strokes.
- Dark mode `--bg` lives in `#0B0B0F`–`#14141A`, never pure black; cards step up 4–6%.
- Use surface layering (bg → surface → surface-2) instead of borders to partition. Do not draw lines if surface depth can do the job.

### 1.4 Radius / Border / Shadow

| Token | Value | Usage |
| --- | --- | --- |
| `--r-sm` | 6px | tag, input |
| `--r-md` | 12px | card, button |
| `--r-lg` | 20px | large container |
| `--r-pill` | 999px | tag / avatar only |
| `--border` | 1px solid var(--line) | sole border spec |
| `--shadow-1` | `0 1px 2px rgba(15,23,42,.06), 0 1px 1px rgba(15,23,42,.04)` | card default (`/* Card */`) |
| `--shadow-2` | `0 8px 24px -8px rgba(15,23,42,.18)` | float / popover (`/* Float */`) |
| `--shadow-3` | `0 24px 60px -20px rgba(15,23,42,.30)` | large overlay (`/* Overlay */`) |

Rules:

- ≤ 2 radius tiers per screen.
- Only the three shadows above; no colored shadows; no inner shadows for skeuomorphism.
- Border + shadow on the same element is forbidden.
- Containers must be justified by information value; shape is never decoration alone.

### 1.5 Motion

| Scenario | Duration | Easing |
| --- | --- | --- |
| Hover / color / opacity | 120–160ms | `cubic-bezier(.2,.8,.2,1)` |
| State transition / enter | 240–320ms | `cubic-bezier(.3,0,0,1)` |
| Block transition / route | 360–480ms | `cubic-bezier(.32,.72,0,1)` |
| Loading / marquee | any | `linear` |

Rules:

- Animate only `transform` / `opacity` / `clip-path` / `filter`.
- `transition: all` is forbidden; declare properties explicitly.
- `@media (prefers-reduced-motion: reduce)` must downgrade to 0.01ms.
- Touch devices must disable hover transitions.

---

## 2. Layout & Composition

### 2.1 Rhythm Pattern (pick one per page)

Pick one main rhythm to avoid card-wall defaults:

1. **Editorial 12-column offset** — title spans 8 cols left, body 6 cols right, image breaks the column gutter.
2. **Large / medium / small stacked** — first screen: oversized type + huge whitespace; second: medium-density info cards; third: dense list / table.
3. **Sticky-left, flowing-right** — left sticky index / TOC / chapter, right scrolling narrative.
4. **Asymmetric two-column** — main 7, side 5 (or 8/4); side carries pull quotes, data, captions, never repeats main content.
5. **Full-screen scenes (Showcase)** — each screen says one thing; 100vh slices + entrance motion.

> Outputting "Hero + 3-column Feature + CTA" by default is forbidden unless the business explicitly demands a Landing template.

### 2.2 Whitespace Discipline

- Desktop sections vertical padding ≥ 80px; Showcase ≥ 120px.
- Mobile sections vertical padding ≥ 48px; card spacing ≥ 16px.
- Heading-to-body gap ≥ 24px; body paragraphs use 1.6 line-height — no extra margin.
- Safe inset to container edge ≥ 16px (mobile) / 24px (desktop).

### 2.3 Grid

- Desktop: 12 columns, `gap: 24px`, max-width 1200–1280px, side padding 32px.
- Tablet: 8 columns, `gap: 20px`.
- Mobile: single column + 16px safe inset; carousels use 24px peek.
- Nav must span full viewport width and exit document flow.

### 2.4 Container Discipline (avoid card disease)

- Cards must carry information value; do not wrap 1–2 fields in a card.
- Cards in the same block must be height-aligned (`align-items: stretch` or fixed `min-height`).
- Card nesting depth ≤ 2.
- Do not use "left color bar + rounded rectangle" alert ornament as decoration.

---

## 3. Typography

The highest ROI lever for visual lift.

- Default left-align. Center only for hero / pull quote / numeric heroes / posters / invitations / festival surfaces.
- Body line length 60–75 chars (Latin) / 28–34 chars (CJK).
- Title vs subtitle must differ on at least 2 of: size, weight, color.
- Numbers use Tabular Nums (`font-variant-numeric: tabular-nums`).
- Mixed CJK + Latin: separate `font-family` for Latin to avoid blurry default rendering.
- Avoid orphan single chars at line ends: `text-wrap: pretty` or manual `&nbsp;`.
- ≤ 2 type families per screen; one CJK + one Latin is sufficient.
- Hierarchy comes from size, spacing, alignment, contrast — before reaching for weight.

### 3.1 Font Selection

When autonomous font selection is needed, choose by business tone:

| Business tone | Latin direction | CJK direction |
| --- | --- | --- |
| Modern / tools / SaaS | `Inter`, `Geist` | `HarmonyOS Sans`, `PingFang SC`, `MiSans`, `Noto Sans SC` |
| Editorial / culture / publishing | `Fraunces`, `Instrument Serif`, `PP Editorial New` | `Source Han Serif`, `Noto Serif SC` |
| Brand / poster / heavy stripe | `Inter Tight`, `Space Grotesk`, `Migra`, `Druk` | bold sans (`MiSans Heavy`, `HarmonyOS Sans Bold`) |
| Kids / festive / playful | one decorative cut (`Lobster`, `Caveat`) as Hero accent only; body returns to sans | sans only |

**Safe defaults across CJK + Latin** when no business tone is provided: `Inter` + `Noto Sans SC` + `PingFang SC` + system UI stacks.

[FORBIDDEN]:
- Comic Sans, Papyrus, Brush Script, or decorative display fonts running through body copy.
- `Inter` / `Roboto` / `Arial` / `Poppins` / `DM Sans` / `Nunito` / `Quicksand` as the **sole** AI-default sans on every page — they collapse design distinctiveness. When chosen, pair with editorial intent or business reasoning.

---

## 4. Color & Surface

Second highest ROI lever after typography.

- Prefer monotone foundation + single accent: neutral or one selected hue carries 80–90% of visual weight; accent only on CTA, key data, link.
- Large brand fills: validate text contrast (≥ 4.5:1) before shipping.
- Avoid placing ≥ 2 brand-color blocks side-by-side in one block — unless the business is intrinsically multi-hue (kids / festive), and even then with explicit zoning.
- Data viz uses brand color + 60% / 30% derived steps as default; semantic dual-color (up / down, right / wrong) allowed but desaturated.

### 4.1 Business Tone × Palette Direction

The table gives directions, not exact hues — final tokens come from each project's brand.

| Tone | Direction | Accent examples |
| --- | --- | --- |
| Finance / tools / engineering | cool neutral + cool accent | mint, cyan, indigo |
| Content / culture / publishing | off-white + true black + warm spark | mustard, ochre, brick |
| E-commerce / retail / food | warm neutral + saturated accent | orange, tomato, cherry |
| Healthcare / government / education | cool neutral + low-sat accent | teal, navy, sage |
| Kids / entertainment / festival | multi-color but disciplined | dual complement (fuchsia + mint) |
| Luxury / fashion / beauty | true black + off-white + gold | gold, bronze, deep wine |

> Color follows business tone × audience. Never default to "mint accent" as a universal solution.

---

## 5. Imagery

### 5.1 Icons

- One icon library per page (Lucide preferred); single stroke width (1.5px) and a fixed size set (16 / 20 / 24).
- [FORBIDDEN] Colored rounded square + white Lucide glyph as a Feature Grid pattern.
- Decorative icons must serve information; never stack them as ornament.
- [FORBIDDEN] Emoji as functional icon (sparkles / rocket / target / lightning) — use Lucide.

### 5.2 Photography

- Prefer real product shots, real portraits, real scenes that fit the business.
- [FORBIDDEN] Unsplash landscape stand-ins for business scenes.
- Apply uniform treatment (color tone / crop ratio / processing). No style mixing.
- Network failure must fall back to placeholder (same-hue + initial / geometry).
- `<img>` requires `alt`; semantic-empty imagery is unacceptable.

### 5.3 Vector Illustration

- ≤ 3 brand colors per illustration.
- Simple, system-consistent geometry.
- [FORBIDDEN] Over-rendered gradients, neon, 3D glass.
- Simple geometry + a single highlight beats complex rendering.

### 5.4 Image Prompt Direction

Three-part structure for any image generation prompt:

1. **Business subject + scenario** — start with the real product / user scenario / business theme. (e.g. for a car page: "luxury sedan car, dark studio lighting".)
2. **Style + quality direction** — tone, lighting, lens, mood; align with §4 palette direction and §5.2 treatment.
3. **Exclusion keywords** — common: `no text, no typography, no letters, no words, no neon, no colorful lights, no holographic effect, no rainbow gradient, no particle noise`.

[FORBIDDEN] Generic prompts ("modern office", "happy people"), prompts that omit business context, prompts that produce decorative-only imagery.

---

## 6. UI Kit (Reusable Minimum Set)

These 18 components cover ~80% of page needs; all values draw from §1 tokens.

- General: 6.1 Button / 6.2 Input / 6.3 Card / 6.4 Tag / 6.5 Nav / 6.6 List Item / 6.7 Stats / 6.8 Chart / 6.9 Empty / 6.10 Modal / 6.11 Toast / 6.12 Hero
- Lifting-only: 6.13 Floating Widget / 6.14 Editorial Banner / 6.15 Testimonial Wall / 6.16 Device Mock / 6.17 In-App Surface Set / 6.18 Store Badge

**General principles** (apply to all components):

- Do not invent components from scratch by default; prefer §6 UI Kit + assigned Library docs + shadcn / Tailwind / open-source patterns.
- Do not invent chart systems by default; prefer shadcn chart patterns or stable open-source charts.
- Every component takes its values from §1 tokens.
- Interactive elements must be `<button>` / `<a href>`, not `<div onclick>`; form inputs require labels; no heading-level skips.

### 6.1 Button

- Primary: `bg: --brand`, `color: --brand-ink`, `r: --r-md`, padding `12px 20px`, weight 600.
- Secondary: `bg: transparent`, `border: --border`, `color: --ink`.
- Text: `bg: transparent`, `color: --ink`, `underline-offset: 4px`.
- Hover: only `opacity: .92` or single `bg` step. No translate + scale + shadow stack.
- ≤ 1 primary button per screen.

### 6.2 Input / Form

- Heights 40 / 48; `r: --r-md`; `border: --border`; focus uses 2px `--brand` ring (no blurred box-shadow halo).
- Label above input, 13–14px, `--ink-2`.
- Six required states: default, hover, focus, disabled, error, success.
- Error text on its own line; never inside placeholder.
- Forms must cover validation, submission, recovery.

### 6.3 Card

- Default: `bg: --surface`, `r: --r-md`, `--shadow-1` OR `--border` (pick one).
- Padding `--s-5` / `--s-6`.
- Three-tier: title → body → meta (time / tag), meta in `--ink-3`.
- Same-block cards must be height-aligned.

### 6.4 Tag / Badge

- Height 22–24px; `r: --r-pill`; 12px font; padding `2px 8px`.
- Default `--surface-2 + --ink-2`; emphasized `--brand 8% + --brand`. No raw red / green / blue.
- ≤ 5 tags per region; spillover collapses to `+N`.
- Chinese > 4 chars must not use `r: --r-pill`; use `r: --r-md`.

### 6.5 Nav

- Desktop top nav 64–72px; mobile top 56px; bottom tab 64–80px (with safe-area).
- Add 1px line or `--shadow-1` only after scroll; transparent or matched at rest.
- ≤ 1 backdrop-filter layer; never stack with border + shadow.

### 6.6 List Item

- Row height ≥ 56px (mobile) / 48px (desktop).
- Optional left icon + title + optional subtitle + right action / chevron.
- Title `--ink`, subtitle `--ink-2`, right icon 16px `--ink-3`.

### 6.7 Stats / KPI

- Numbers in Display or H1 + Tabular Nums.
- Unit one tier smaller in `--ink-2`.
- Prefer `--line` dividers over four separate cards.

### 6.8 Chart

- Single series defaults to `--brand`; multi-series steps brand lightness (80% / 60% / 40%).
- Grid lines `--line`; no dashed + multi-color combos.
- Hover shows one Tooltip; no crosshair + tooltip + marker triple stack.
- "Data-feel" charts (bars without scale or label) are forbidden.

### 6.9 Empty / Error / Loading

- Empty: single ≤ 96px gray icon + one-line title + one-line caption + secondary button.
- Error: do not default to red; `--ink` + `--accent` text; provide retry.
- Loading: skeleton over spinner; skeleton mirrors final layout.
- Cover loading, empty, error, populated, edge for any dynamic section.

### 6.10 Modal / Drawer

- Modal centered, max 480 / 640; Drawer right side 360–480.
- Backdrop `rgba(0,0,0,.4)` + `backdrop-filter: blur(2px)` max.
- Close button hit-area ≥ 32px at top-right 24px inset.
- Enter / leave 240ms `cubic-bezier(.3,0,0,1)`, transform + opacity only.

### 6.11 Toast

- Top or bottom 16–24px inset; `r: --r-md`; `--shadow-2`.
- One at a time; auto-dismiss 4s; no icon + colored block + border triple stack.

### 6.12 Hero

- Desktop vertical padding ≥ 120px; title at Display; subtitle Body-L max 2 lines.
- One primary + one secondary CTA; never ≥ 3 buttons abreast.
- Visual asset (product shot / illustration / video) must be real and meaningful, never decorative geometry.

### 6.13 Floating Widget

> Source: TwelveLabs hero-corner toasts, trae.ai pixel-map floats. Use to make a Hero asset breathe instead of becoming a centered island.

- ≥ 2 floats around the main asset; each carries one independent piece of info: stat, list, toast.
- Use `position: absolute` + `rotate(±2°–4°)` for slight offset; never align flush.
- Float bg `--surface` + 1px border + `--shadow-2`; no gradient or glass.
- Width 200–260px; never more visually prominent than the main asset.
- Real business data only; no "Lorem", no "Sample Stat".
- Avoid two floats of the same type adjacent (no two stats together).

### 6.14 Editorial Banner

> Source: AiiD'26 top strip `[Logo Block] + [Orange CTA Strip] + [Right Nav]`. More magazine than a navbar.

- Three columns: black Logo Block on the left, high-saturation accent CTA strip in the middle, secondary nav right.
- Logo Block uses Inter Tight 900; 20–30% larger than a normal nav.
- Banner carries only Logo + one CTA + 2 secondary links; overflow goes to a normal nav.
- Total height ≤ 56px; solid color, no glass.
- Accent area ≤ 1/3 banner width.

### 6.15 Testimonial Wall

> Source: trae.ai "Loved by Devs", AiiD'26 triple portrait.

- Each row holds 3–4 cards; **adjacent rows offset 40–60px horizontally**.
- Container has `mask-image: linear-gradient` fade-out (8% transparent at both ends).
- Each row contains 1–2 `.fade` cards (`opacity: .42`) for visual breath; hero card uses `.tall` with extra `min-height`.
- Avatars must be real photographs; no initials-on-color circles.
- Highlight one keyword per quote with accent color (`<span class="hl">`); ≤ 1 highlight per card.
- Card hover: `translateY(-2px)` + border color change only; no scale + shadow stack.

### 6.16 Device Mock

> Source: trae.ai / TwelveLabs / Linear / Cash App mobile heroes. Required when the product is mobile.

**Shell (recommended ranges, tunable per brand)**

- Width 280–320px; corner radius 36–44px (single tier per screen, never mix); shell color: deep charcoal (`#020202`–`#1A1A1A`) or brand-dark, never required to be pure black.
- One shadow tier: vertical deep + inset highlight + 1px frame; no colored glow, no stacked shadows.
- Pick one of: notch / dynamic island / camera punch hole. Never a flat black bar.
- Show at least one side button (volume / power) as a 2–3px bar slightly lighter than the shell.

**Inner Surface (combine freely; ≥ 4 segments per screen)**

1. **Status bar**: locked 9:41 + system icons, Tabular Nums.
2. **Greeting / hero zone**: title ≤ 12 chars; accent only on the keyword (name / number / status).
3. **Business primary card**: balance / wallet card for finance, cart / order for e-commerce, cover / list for content, task / dataset for tools.
4. **Quick grid / action panel**: 4–6 icon tiles; corner radius "homologous" to the shell (`shell R / inner R ≈ 2:1`).
5. **Grouped list / content stream**: by time / category / priority.
6. **Tab bar / bottom action**: see §6.17.3.

[FORBIDDEN]

- Off-screen scattered emoji / particles around the device (canonical AI-slop mobile hero).
- ≥ 3 radius tiers in the same inner surface.
- Replicating iOS / Android system UI (Settings / Calculator) as a stand-in for a business screen.

### 6.17 In-App Surface Set

> Pairs with §6.16. Replace per business: finance → balance / card / tab; e-commerce → product hero / cart / tab; content → cover / feed / tab; tools → progress / action / tab.

#### 6.17.1 Hero Surface (business primary card)

- Radius homologous to the shell (e.g. shell 42 → inner ≈ 22).
- Background: same-hue micro gradient + a single radial accent halo for energy; halo color = `--accent`.
- Primary number / primary content uses Display + Tabular Nums; currency / unit / sub-info one tier down.
- Status indicator (up/down, progress, stage) uses pill or chip in a single accent. No tri-color mix.
- Auxiliary viz (sparkline / progress / mini bar) is single series, stroke 1.5–2px.

#### 6.17.2 Visual Object Card (virtual card / product / cover)

- Aspect follows content: credit cards `aspect-ratio: 1.586/1`; products 1:1 or 4:5; content covers 16:10 / 16:9.
- Inner padding homologous to shell.
- Gradient lightness range ≤ 10–15%; multi-color collages allowed only when the business itself is multi-hue (kids / festive).
- Required elements (per business): brand name / product name / key value / status emblem; emblem is vector SVG, not a generic icon-library fallback.

#### 6.17.3 Tab Bar / Bottom Action

- 4–5 tabs; height 48–56px; radius matches inner card or one tier larger.
- Selected: solid bg + inverse icon, OR bold + accent border. Pick one.
- ≤ 1 backdrop-filter; never stack with border + shadow.
- Text + icon retained for government / accessibility / older audiences; icon-only allowed only for high-density Showcase.

### 6.18 Store Badge

> Apple / Google official badges, simplified. Pair ≥ 2 for any mobile app or product hero. When the business is not an app download, replace with subscription / booking / experience CTA badges using the same structure.

- Height 36–44px; radius matches button; bg one step deeper than surface or brand primary, with 1px border.
- Two-line type: line 1 Mono small / `letter-spacing: .14em` / uppercase / `--ink-3`; line 2 Display small / weight 700 / `--ink`.
- Left icon 18–20px, single color, same hue as text.
- Multi-badge spacing 8–12px.

---

## 7. Three Scenario Lifts

### 7.1 Mobile App (Showcase Lift)

> Concerns visual lift only. Baseline UX (44pt touch targets, safe areas) is assumed.

- **Stage over device**: prefer §6.16 Device Mock + §11.5 P-5 Phone Stage; single-device centered allowed only when the tone is restrained (medical, government), and only with real business surface inside.
- **In-screen content must be real**: balances, orders, covers, tasks, notices — real business data and copy. No Settings / Calculator / Lorem.
- **Real avatars / real assets**: real photography or project shots; no initials-on-color or random emoji (B2B / government may use abstract monogram).
- **Paired CTAs**: ≥ 2 entry points (download / subscribe / book / try) using §6.18 dual structure.
- **No colored halo around the device**: outer halo is restricted to §6.16 shadow specs.
- **Tab bar follows business**: dense Showcase may use icon-only; education / government / older audiences keep icon + label.
- **Floats**: 1–3 widgets carrying real business info; never littered with floats.

### 7.2 Personal Site / Portfolio

- Hero uses Display + a single positioning sentence; no "fullstack / UI / photography" tag triple.
- Project list shows thumbnail + project name + one-line description + year; thumbnail aspect uniform (4:3 or 16:10 recommended).
- Project detail page uses sticky-left or editorial layout; must include background, role, process, outcome.
- Contact section lists only working channels; no decorative social-icon walls.

### 7.3 Graphic / Print Surfaces

- Establish an explicit grid (≥ 6 columns) and a baseline grid (multiples of 4 / 8).
- Primary information takes ≥ 60% of visual area.
- Title vs body contrast in different family or markedly different weight.
- Whitespace ≥ 8% of short edge length.
- Never combine ≥ 3 colored blocks + gradient bg simultaneously.

---

## 8. Anti-AI-Slop Blacklist

Any one of these = unqualified.

- Rainbow / multi-stop linear / radial gradient backgrounds.
- Colored rounded tile + white Lucide icon Feature Grid.
- "Left 4px colored bar + rounded card" alert ornament.
- Glow / neon / holographic halos.
- Particle noise / star sparkles / floating geometric particles in the background.
- Purple-blue-pink trio without business meaning.
- Hero center stack: gradient title + dual CTA + 3-column Feature.
- Three equal feature cards as the dominant first content block immediately after the hero, unless the business explicitly requires equal comparison.
- Hero / first-screen pill or tag overload: more than 5 pills/tags without real information value.
- Cards-inside-cards-inside-cards: consecutive visible card layers where each layer has its own background, border, or radius.
- Glass morphism + inner shadow + heavy blur all at once.
- "Data-feel" charts (bars without scale or label).
- Filler copy: Lorem Ipsum, "Insert title here", "示例标题".
- ≥ 3 radius tiers or ≥ 3 shadow specs in the same screen.
- Type scale ambiguity (13 / 14 / 15 / 16 same view).
- Mobile hero with a single centered phone surrounded by emoji / dots / floating geometry (canonical AI-slop mobile pattern).
- In-screen mobile UI mimicking system surfaces (Settings / Calculator / clock wallpaper) as stand-in business.
- Visual objects (credit cards, product shots, content covers) freehanded without honoring real business proportions.
- Emoji as functional icon (sparkles / rocket / target / lightning) — use Lucide instead.
- Tailwind default accent colors (`#6366f1`, `#8b5cf6`, `#3b82f6`) used as primary brand accent.
- Fabricated quantified claims not provided by the user.

---

## 9. Chinese Environment Requirements

- Primary heading ≤ 20 chars; button copy ≤ 6 chars; tab copy ≤ 4 chars.
- CJK `letter-spacing` must not exceed 0.05em.
- Mixed CJK + Latin: separate font families; the half-space between them is a CSS concern, never typed full-width spaces in copy.
- Never break-cut titles: use `word-break: keep-all` + `overflow-wrap: break-word`.
- Vertical type only when the page is genuinely editorial and content fits.
- [FORBIDDEN] text overlap, text clipping, awkward line breaks.
- Primary heading, secondary heading, body, supporting text must show clear hierarchy via size, color, spacing.
- Avoid narrow containers, dense side-by-side layouts, pill-heavy patterns that cramp Chinese.
- Chinese > 4 characters must not use `rounded-full`; downgrade to `rounded-lg`.
- **Split-column heading cap**: CJK heading in a column < 60% viewport width → cap at H1; never Display. A 7-char CJK title at Display scale in a 50% column will ALWAYS break uglily.
- All CJK headings must apply `text-wrap: balance` + `word-break: keep-all`.
- Pre-write sizing: at 1280px, 50% column ≈ 580px; H1 max 48px fits 12 CJK chars/line. Titles ≤ 12 chars → single line; 13-24 → two balanced lines. Exceed → restructure layout.

---

## 10. Self-Check

The post-generation checklist lives in `aesthetics/self-check.md`. After every page is generated, run the checklist top-to-bottom; any failure must be fixed before declaring completion. "Fix later" is not allowed.

---

## 11. Showcase Pattern Atlas

Five high-end patterns distilled from trae.ai / TwelveLabs / TikTok Brand Hub / AiiD'26 / m3 expressive / stateofaidesign.com / microsoft.ai. Any Hero / Showcase / Landing surface must pick one and execute it. Default three-segment Hero output is forbidden.

**Reference URLs (direction signals, not templates to copy)**

- Web: `https://www.trae.ai/`, `https://tiktokbrandhub.com/`, `https://www.twelvelabs.io/`, `https://stateofaidesign.com/`, `https://microsoft.ai/`
- Mobile: `https://m3.material.io/blog/building-with-m3-expressive`, `https://www.trae.ai/`
- Editorial / Graphic: `https://stateofaidesign.com/`, `https://microsoft.ai/`, `https://www.twelvelabs.io/`

### 11.1 P-1 · Deep Stage

> Use: mobile App hero, SaaS product hero. Refs: trae.ai, TwelveLabs.

Constraints:

- BG `#0A0A0A` (never pure black).
- Pixel-grid + radial mask only in the upper-right hero zone, density 14×14px.
- Display `clamp(48px, 7vw, 104px)`; ghost-stroke + accent + default — three layers.
- ≥ 2 floats per §6.13.
- Footer KPI strip uses 1px line dividers, never four separate cards.

### 11.2 P-2 · Quote Mosaic

> Use: testimonials, "loved by devs", community vibe. Ref: trae.ai "Loved by Devs".

Constraints:

- Centered oversized Display (≥ 100px) followed by ≤ 2 lines of subtitle + 3 mono pills (location / count / status).
- Container uses `mask-image` fade (8% at both ends).
- Three rows offset 0 / -60px / +40px — must be asymmetric.
- Real-photo avatars; no initials.

### 11.3 P-3 · Editorial Cover

> Use: report covers, brand posters, year-in-review. Refs: AiiD'26 State of AI Design Report, stateofaidesign.com.

Constraints:

- Top Editorial Banner (§6.14) + oversized Display + oval emblem combo.
- Title may use a single "highlighter" word (`::after` underline) and stroke-outline font; ≤ 1 per screen.
- Triple portraits 4:5 grayscale + colored underline; `Coming soon` mono corner mark.
- Only one of three may expand into Q&A; the other two stay name + role.

### 11.4 P-4 · Heavy Type Stripe

> Use: portfolio hero, brand definition page. Refs: tiktokbrandhub.com "A brand built for discovery.", microsoft.ai.

Constraints:

- One sentence + one media element. No subtitle, no CTA.
- Type at `clamp(64px, 10vw, 160px)`; line-height 0.92.
- Media may overlay a solid SVG outline (shield, ring) as compositional cue.
- No three-stack hero (title + subtitle + dual CTA).

### 11.5 P-5 · Phone Stage

> Use: mobile App hero / Showcase. Refs: trae.ai, Linear iOS, Cash App. Layout container for §6.16 + §6.17 + §6.18.

Constraints (recommended + optional):

- Stage container uses `perspective: 800–1600px`; dual-phone offset is preferred for narrative tension; single phone centered is acceptable (restrained tones).
- Dual phones rotate opposite directions (front +3°, back -6°), overlap 30–40%; single phone may sit upright with slight perspective.
- Each phone tells a different story: main + detail / list + detail / dashboard + workflow. Same screen twice = unqualified.
- Floats ≥ 1; multiples sit at diagonal corners with rotation opposite to the phone for tension; single float hugs the asset.
- Hero copy + visual asset in two columns (recommended 1.1fr / .9fr; mobile single column). Right column carries kicker + paragraph + dual CTA + dual badge; missing items ≤ 1 type.
- Footer KPI strip prefers 1px line dividers; four separate cards allowed only with strict height alignment.
- ≤ 980px viewport: dual phones downgrade to single phone + static float stack; rotation must be removed.

### 11.6 Pattern Decision Tree

```
Need to show a "mobile product"?
- Yes -> P-5 Phone Stage
- No  -> Need to show a "Web / SaaS product"?
        - Yes -> P-1 Deep Stage (dark) / lighter variant (airy)
        - No  -> Need to show "people / feedback / community"?
                - Yes -> P-2 Quote Mosaic
                - No  -> "Annual report / poster / publication / cultural"?
                        - Yes -> P-3 Editorial Cover
                        - No  -> P-4 Heavy Type Stripe
```

One Pattern per Hero / Showcase; the rest of the page falls back to §2.1 rhythm.

> When the business does not fit any P-x (serious government, medical, corporate annual report), drop back to §2.1 rhythm + §6 UI Kit with restrained execution. North Star (§0) and the Anti-AI-Slop blacklist (§8) still apply.

---

## 12. Extended Specs (On-Demand)

The following topics have dedicated spec files. Sub-Agents read them **only when triggered by the Quality Gate** or explicitly needed:

| Topic | File | Trigger Condition |
|-------|------|-------------------|
| Dark Mode surface/text/shadow/image rules | `aesthetics/dark-mode.md` | `<html class="dark">` detected or project theme is dark |
| Footer patterns & deep navigation (sidebar, mega-menu, breadcrumb) | `aesthetics/navigation-footer.md` | Every multi-page project (footer) or complex nav structure |

These files extend — never contradict — the rules in this document. §0 North Star and §8 Anti-AI-Slop remain the floor.
