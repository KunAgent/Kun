# Aesthetics — Visual Quality System

This file defines the visual quality bar for page generation. It is not a generic design primer — it is the binding spec used to lift output from "acceptable" to "designed". Read it before generation. Every page must execute `operation-policies/page-generation-quality-gate.md` before declaring completion; read `self-check.md` deeply when the gate triggers it or when generating a brand / marketing Showcase home page.

Coverage: web pages, mobile App showcases, portfolio sites, editorial / graphic surfaces.
Audiences and businesses: finance, content, tools, e-commerce, education, healthcare, government, culture, B2B SaaS, C2C community, etc.

## How to Use This Spec

- **Principle over parameter**: Numeric values in this file (px, font sizes, color tokens) are defaults, not absolutes. When the business tone is clear (bank = trustworthy, kids = playful, culture = quiet), shift the whole stack while preserving the proportional relationships and rhythm discipline.
- **Tokens are placeholders, not colors**: `--brand`, `--ink`, and `--surface` are placeholder names. Free-explore projects must use exactly one brand hue and must not generate `secondary` or `accent` brand hues. State colors are separate semantic tokens only (`--state-success`, `--state-warning`, `--state-error`, `--state-info`) and are not brand colors. When a Design Library is assigned, replace placeholders with brand-prefixed equivalents (`var(--{prefix}-primary)`) per `page-generation-quality-gate.md > Gate 1 — Token Compliance`.
- **Layouts are interchangeable**: the Showcase Pattern Atlas (`showcase-patterns.md` §11) is the **preferred set** when the page is a Hero / Showcase / Landing surface. When the business does not fit (serious government / medical / annual reports), fall back to §2.1 rhythm patterns with restrained UI Kit usage — but North Star and the blacklist still apply.
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
7. **One Pattern per page** — when the page is a Hero / Showcase, pick exactly one Pattern from the Showcase Pattern Atlas (`showcase-patterns.md` §11); remaining sections fall back to §2.1 rhythm.
8. **Quality gate is non-optional** — execute `operation-policies/page-generation-quality-gate.md` before declaring completion for every page. Deep-read `self-check.md` only when the gate triggers it or when generating a brand / marketing Showcase home page.

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
- **[ABSOLUTE RULE] Headings must be words/phrases, NEVER sentences.** A heading is a noun phrase, brand name, or category label — max 8 CJK characters / 4 English words. Any sentence or descriptive text must be body copy, never a heading. No pageType exemption.
- Display scale is full-width only; in split columns (< 60% width), cap at H1. See §3.2 Heading Fit.
- Display size (≥ 36px) is ONLY for brand names ≤ 4 CJK chars or single KPI numbers.
- All Display/H1 headings require `text-wrap: balance` for even line distribution.
- Chinese pages default to a sans-serif stack unless the user explicitly asks for editorial, publishing, culture, or serif styling: `Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`. Do not mix serif and sans-serif Chinese headings/body copy by accident.
- Serif exception discipline: even for editorial / culture / publishing pages, choose exactly one CJK serif family for display/title usage and one body stack. Do not mix multiple serif families across headings, cards, hero, and nav. A Latin serif may be listed only as Latin fallback/accent for Latin words; it must not cause Chinese headings to render in a different serif from the rest of the page.
- Use at most 3 primary font weights per page. Prefer size, spacing, alignment, and color hierarchy before adding another weight.
- Chinese headings need comfortable line-height: H1/H2 generally `1.18-1.3`; body text generally `1.5-1.7`. Large CJK text with tight line-height fails.

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
--state-success success state only (optional)
--state-warning warning state only (optional)
--state-error   error/destructive state only (optional)
--state-info    informational state only (optional)
```

Rules:

- ≤ 6 hues total per page including black / white / gray.
- There is exactly one primary brand hue per project. `--brand` is the only main CTA / primary action / selected state hue.
- In free-explore mode, do not generate CSS variables named `--color-secondary`, `--color-accent`, `--secondary`, `--accent`, or their light/dark scales. Identity, category, member role, book type, and content type must be distinguished by text, icons, neutral tints, layout, or the single brand tint, not by extra brand hues.
- If status colors are needed, generate a separate `stateColors` set: `--state-success`, `--state-warning`, `--state-error`, and `--state-info`. These may only appear in success/warning/error/info states, validation, destructive actions, or status badges. They must not style family roles, book categories, recommendation types, avatars, progress ownership, or cards.
- Do not place multiple saturated color blocks side-by-side in one screen unless the user's brief explicitly asks for a multi-brand palette.
- 3+ stop linear / radial gradients are forbidden; only same-hue 8–15% lightness gradients allowed for surface depth.
- No neon glow, no rainbow strokes.
- Dark mode `--bg` lives in `#0B0B0F`–`#14141A`, never pure black; cards step up 4–6%.
- Use surface layering (bg → surface → surface-2) instead of borders to partition. Do not draw lines if surface depth can do the job.

### 1.4 Radius / Border / Shadow

| Token | Value | Usage |
| --- | --- | --- |
| `--r-xs` | 2px | compact tables, hairline control groups |
| `--r-sm` | 4px | tag, small input, dense controls |
| `--r-md` | 8px | default button, input, compact card |
| `--r-lg` | 16px | large card / panel maximum for ordinary pages |
| `--r-pill` | 999px | tag / avatar only |
| `--border` | 1px solid var(--line) | sole border spec |
| `--shadow-1` | `0 1px 2px rgba(15,23,42,.05), 0 1px 1px rgba(15,23,42,.03)` | card default |
| `--shadow-2` | `0 8px 24px -8px rgba(15,23,42,.18)` | float / popover |
| `--shadow-3` | `0 24px 60px -20px rgba(15,23,42,.30)` | large overlay (use sparingly) |

Rules:

- ≤ 2 radius tiers per screen.
- Ordinary pages use a 2 / 4 / 8 / 16px radius scale. Cards/buttons/inputs must not exceed 16px. A larger radius is allowed only when the user explicitly requests large/soft/round shapes in the current query; do not infer this from warm, family, lifestyle, playful, or consumer scenarios. Full pill radius is reserved for avatars, tags, segmented pills, and true pill buttons.
- Only the three shadows above; no colored shadows; no inner shadows for skeuomorphism.
- Ordinary/static cards, panels, tables, list items, and sections should prefer subtle border or surface layering; if they use shadow, every shadow color alpha must be `<= 0.05`. Deeper shadows are reserved only for real floating layers such as modal, popover, dropdown, drawer, tooltip, and toast.
- Border + shadow on the same element is forbidden unless it is a floating layer that needs both separation and elevation.
- Containers must be justified by information value; shape is never decoration alone.

### 1.5 Motion

| Scenario | Duration | Easing |
| --- | --- | --- |
| Hover / color / opacity | 120–160ms | `cubic-bezier(.2,.8,.2,1)` |
| State transition / enter | 240–320ms | `cubic-bezier(.3,0,0,1)` |
| Block transition / route | 360–480ms | `cubic-bezier(.32,.72,0,1)` |
| Loading / marquee | any | `linear` |

Rules:

- Animate only `transform` / `opacity` / `clip-path` / `filter`. `transition: all` is forbidden; declare properties explicitly.
- `@media (prefers-reduced-motion: reduce)` must downgrade to 0.01ms. Touch devices must disable hover transitions.
- Every primary interactive element must cover default, hover, active, focus-visible, and disabled states where applicable. This includes buttons, links, cards that navigate, tabs, form controls, CTA blocks, and media thumbnails.
- Button hover should show at most 2 clear feedback channels: color/lightness step, slight translate, icon translate, underline/border change, or elevation step. Do not stack scale + translate + shadow + glow.
- Every page needs one memorable business-relevant micro-interaction, such as a CTA icon sliding 2px, a card revealing a domain-specific detail on hover, a metric count-up, or a scroll reveal tied to the page story. It must support hierarchy, feedback, or comprehension; decorative motion alone fails.
- `motionIntensity` applies as: `1` = basic hover/focus only; `2-3` = default refined button/card/nav feedback plus light first-screen entrance; `4-5` = showcase/brand pages may add scroll reveal, count-up, subtle parallax, or canvas/particle atmosphere when business-appropriate.

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

- Desktop sections vertical padding ≥ 80px (Showcase ≥ 120px); mobile sections ≥ 48px; card spacing ≥ 16px.
- Heading-to-body gap ≥ 24px; body paragraphs use 1.6 line-height — no extra margin.
- Safe inset to container edge ≥ 16px (mobile) / 24px (desktop).

### 2.3 Grid

- Desktop: 12 columns, `gap: 24px`, max-width 1200–1280px, side padding 32px. Tablet: 8 columns, `gap: 20px`. Mobile: single column + 16px safe inset; carousels use 24px peek.
- Nav must span full viewport width and exit document flow.

### 2.4 Container Discipline (avoid card disease)

- Cards must carry information value; do not wrap 1–2 fields in a card. Card nesting depth ≤ 2.
- Cards in the same block must be height-aligned (`align-items: stretch` or fixed `min-height`).
- Do not use "left color bar + rounded rectangle" alert ornament as decoration.

### 2.5 Alignment & CTA Discipline

- Repeated controls in one group must share a clear alignment axis: left edge, right edge, center line, or baseline. Buttons, tags, form controls, card titles, list rows, and nav items cannot visually drift inside the same group.
- Use explicit `gap-*`, grid gap, or flex gap for grouped controls. Never rely on incidental whitespace or text length to create spacing.
- Avoid orphan micro-rows: a full-width row must not contain only one small standalone element floating in empty space because of arbitrary padding or margin. If an element occupies its own row, either make the row structurally complete (for example title + metadata + action, label + value + control, breadcrumb + status + action), or place the single element with an explicit left, center, or right alignment that serves the layout. A lone chip, tab, icon button, tiny KPI, or small CTA in a broad row is allowed only when it intentionally aligns to an adjacent grid/column or acts as a deliberate centered focal control.
- CTA copy must be concise. Chinese CTA labels should be 2-6 characters; English CTA labels should be 1-3 words. If the action needs a long sentence, split it into title/supporting text plus a short button label.
- Do not turn long requirement phrases into headings or buttons. Compress them into scannable labels and put details in supporting copy.

---

## 3. Typography

The highest ROI lever for visual lift.

- Default left-align. Center only for hero / pull quote / numeric heroes / posters / invitations / festival surfaces.
- Body line length 60–75 chars (Latin) / 28–34 chars (CJK).
- Title vs subtitle must differ on at least 2 of: size, weight, color.
- Numbers use Tabular Nums (`font-variant-numeric: tabular-nums`).
- Mixed CJK + Latin: separate `font-family` for Latin to avoid blurry default rendering.
- Avoid orphan single chars at line ends: `text-wrap: pretty` or manual `&nbsp;`.
- ≤ 2 type families per screen; one CJK + one Latin is sufficient. If using a serif display style, keep it to one CJK serif family and apply it consistently to all title/display roles. Do not mix several serif faces such as `Playfair Display`, `Georgia`, `Noto Serif SC`, and `Source Han Serif` as competing heading systems.
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

For editorial / culture / publishing, the safe CJK-first stack is one of: `"Noto Serif SC", "Source Han Serif SC", serif` OR `"Source Han Serif SC", "Noto Serif SC", serif`. Pick one order and keep it project-wide. Do not place decorative Latin serif names before the CJK serif for Chinese headings; this often makes titles feel visually unrelated to the rest of the interface.

[FORBIDDEN]:
- Comic Sans, Papyrus, Brush Script, or decorative display fonts running through body copy.
- `Inter` / `Roboto` / `Arial` / `Poppins` / `DM Sans` / `Nunito` / `Quicksand` as the **sole** AI-default sans on every page — they collapse design distinctiveness. When chosen, pair with editorial intent or business reasoning.
- Mixing multiple serif display/title families on one page or across sibling pages. A heading that looks "dropped in" because it uses a different serif face from the shared type system fails typography quality.

---

## 4. Color & Surface

Second highest ROI lever after typography.

- Prefer monotone foundation + one brand hue: neutral or one selected hue carries 80–90% of visual weight. CTA, key data, and links use the single brand hue or its light/dark tints.
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

- One icon library per page (Lucide preferred); single stroke width (1.5px) and a fixed size set (16 / 20 / 24). Decorative icons must serve information; never stack them as ornament.
- [FORBIDDEN] Colored rounded square + white Lucide glyph as a Feature Grid pattern; [FORBIDDEN] Emoji as functional icon (sparkles / rocket / target / lightning) — use Lucide.

### 5.2 Photography

- Prefer real product shots, real portraits, real scenes that fit the business. [FORBIDDEN] Unsplash landscape stand-ins for business scenes.
- Apply uniform treatment (color tone / crop ratio / processing). No style mixing.
- Network failure must fall back to placeholder (same-hue + initial / geometry).
- `<img>` requires `alt`; semantic-empty imagery is unacceptable.

### 5.3 Vector Illustration

- ≤ 3 brand colors per illustration; simple, system-consistent geometry. Simple geometry + a single highlight beats complex rendering.
- [FORBIDDEN] Over-rendered gradients, neon, 3D glass.

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
- Lifting-only (in `showcase-patterns.md`): 6.13 Floating Widget / 6.14 Editorial Banner / 6.15 Testimonial Wall / 6.16 Device Mock / 6.17 In-App Surface Set / 6.18 Store Badge

**General principles** (apply to all components):

- Do not invent components from scratch by default; prefer §6 UI Kit + assigned Library docs + shadcn / Tailwind / open-source patterns.
- Do not invent chart systems by default; prefer shadcn chart patterns or stable open-source charts.
- Every component takes its values from §1 tokens.
- Interactive elements must be `<button>` / `<a href>`, not `<div onclick>`; form inputs require labels; no heading-level skips.

### 6.1 Button

- Primary: `bg: --brand`, `color: --brand-ink`, `r: --r-md`, padding `12px 20px`, weight 600. Secondary: `bg: transparent`, `border: --border`, `color: --ink`. Text: `bg: transparent`, `color: --ink`, `underline-offset: 4px`.
- Hover: use a single color/lightness step plus optionally one subtle motion detail such as `translateY(-1px)` or icon `translateX(2px)`. No translate + scale + shadow + glow stack.
- Active: reverse or dampen the hover movement, typically `translateY(0)` or `scale(.99)`.
- Focus-visible: 2px brand ring or underline treatment with sufficient contrast; do not remove outline without replacement.
- ≤ 1 primary button per screen.

### 6.2 Input / Form

- Heights 40 / 48; `r: --r-md`; `border: --border`; focus uses 2px `--brand` ring (no blurred box-shadow halo). Label above input, 13–14px, `--ink-2`.
- Six required states: default, hover, focus, disabled, error, success. Error text on its own line; never inside placeholder.
- Forms must cover validation, submission, recovery.

### 6.3 Card

- Default: `bg: --surface`, `r: --r-md`, `--shadow-1` OR `--border` (pick one). Padding `--s-5` / `--s-6`.
- Interactive cards require hover/focus-visible state. Use `translateY(-2px)` plus border/surface step only; no scale + shadow stack.
- Three-tier: title → body → meta (time / tag), meta in `--ink-3`. Same-block cards must be height-aligned.

### 6.4 Tag / Badge

- Height 22–24px; `r: --r-pill`; 12px font; padding `2px 8px`. Chinese > 4 chars must not use `r: --r-pill`; use `r: --r-md`.
- Default `--surface-2 + --ink-2`; emphasized `--brand 8% + --brand`. No raw red / green / blue.
- ≤ 5 tags per region; spillover collapses to `+N`.

### 6.5 Nav

- Desktop top nav 64–72px; mobile top 56px; bottom tab 64–80px (with safe-area). Add 1px line or `--shadow-1` only after scroll; transparent or matched at rest.
- ≤ 1 backdrop-filter layer; never stack with border + shadow.

### 6.6 List Item

- Row height ≥ 56px (mobile) / 48px (desktop); optional left icon + title + optional subtitle + right action / chevron.
- Title `--ink`, subtitle `--ink-2`, right icon 16px `--ink-3`.

### 6.7 Stats / KPI

- Numbers in Display or H1 + Tabular Nums; unit one tier smaller in `--ink-2`.
- Prefer `--line` dividers over four separate cards.

### 6.8 Chart

- Single series defaults to `--brand`; multi-series steps brand lightness (80% / 60% / 40%). Grid lines `--line`; no dashed + multi-color combos.
- Hover shows one Tooltip; no crosshair + tooltip + marker triple stack. "Data-feel" charts (bars without scale or label) are forbidden.

### 6.9 Empty / Error / Loading

- Empty: single ≤ 96px gray icon + one-line title + one-line caption + secondary button.
- Error: use `--state-error` only for real error/destructive state; otherwise use `--ink` plus neutral surface; provide retry.
- Loading: skeleton over spinner; skeleton mirrors final layout.
- Cover loading, empty, error, populated, edge for any dynamic section.

### 6.10 Modal / Drawer

- Modal centered, max 480 / 640; Drawer right side 360–480. Backdrop `rgba(0,0,0,.4)` + `backdrop-filter: blur(2px)` max.
- Close button hit-area ≥ 32px at top-right 24px inset. Enter / leave 240ms `cubic-bezier(.3,0,0,1)`, transform + opacity only.

### 6.11 Toast

- Top or bottom 16–24px inset; `r: --r-md`; `--shadow-2`. One at a time; auto-dismiss 4s; no icon + colored block + border triple stack.

### 6.12 Hero

- Desktop vertical padding ≥ 120px; subtitle Body-L max 2 lines.
- Hero title MUST be a short noun phrase (brand name, product name, or category label ≤ 4 CJK chars / ≤ 2 words) at Display size. [FORBIDDEN] using a sentence or slogan as the hero title — move sentences to subtitle/body below the title.
- One primary + one secondary CTA; never ≥ 3 buttons abreast.
- Visual asset (product shot / illustration / video) must be real and meaningful, never decorative geometry.

### 6.13–6.18 Lifting Components (moved)

§6.13–6.18 lifting components (Floating Widget, Editorial Banner, Testimonial Wall, Device Mock, In-App Surface Set, Store Badge) moved to `aesthetics/showcase-patterns.md` — read on demand per §12.

---

## 7. Three Scenario Lifts

### 7.1 Mobile App (Showcase Lift)

> Concerns visual lift only. Baseline UX (44pt touch targets, safe areas) is assumed.

- **Stage over device**: prefer Device Mock (§6.16) + P-5 Phone Stage (§11.5) in `showcase-patterns.md`; single-device centered allowed only when the tone is restrained (medical, government), and only with real business surface inside.
- **In-screen content must be real**: balances, orders, covers, tasks, notices — real business data and copy. No Settings / Calculator / Lorem.
- **Real avatars / real assets**: real photography or project shots; no initials-on-color or random emoji (B2B / government may use abstract monogram).
- **Paired CTAs**: ≥ 2 entry points (download / subscribe / book / try) using the §6.18 dual structure (`showcase-patterns.md`).
- **No colored halo around the device**: outer halo is restricted to §6.16 shadow specs (`showcase-patterns.md`).
- **Tab bar follows business**: dense Showcase may use icon-only; education / government / older audiences keep icon + label.
- **Floats**: 1–3 widgets carrying real business info; never littered with floats.

### 7.2 Personal Site / Portfolio

- Hero uses Display + a single positioning sentence; no "fullstack / UI / photography" tag triple.
- Project list shows thumbnail + project name + one-line description + year; thumbnail aspect uniform (4:3 or 16:10 recommended).
- Project detail page uses sticky-left or editorial layout; must include background, role, process, outcome.
- Contact section lists only working channels; no decorative social-icon walls.

### 7.3 Graphic / Print Surfaces

- Establish an explicit grid (≥ 6 columns) and a baseline grid (multiples of 4 / 8). Primary information takes ≥ 60% of visual area.
- Title vs body contrast in different family or markedly different weight. Whitespace ≥ 8% of short edge length.
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

The post-generation deep checklist lives in `aesthetics/self-check.md`. Every page must pass `operation-policies/page-generation-quality-gate.md`; deep-read `self-check.md` only when the gate triggers it or when generating a brand / marketing Showcase home page. When triggered, run the checklist top-to-bottom; any failure must be fixed before declaring completion. "Fix later" is not allowed.

---

## 11. Showcase Pattern Atlas (moved)

§11 Showcase Pattern Atlas (P-1 Deep Stage / P-2 Quote Mosaic / P-3 Editorial Cover / P-4 Heavy Type Stripe / P-5 Phone Stage + decision tree) moved to `aesthetics/showcase-patterns.md` — read on demand per §12.

---

## 12. Extended Specs (On-Demand)

The following topics have dedicated spec files. Sub-Agents read them **only when triggered by the Quality Gate** or explicitly needed:

| Topic | File | Trigger Condition |
|-------|------|-------------------|
| Dark Mode surface/text/shadow/image rules | `aesthetics/dark-mode.md` | `<html class="dark">` detected or project theme is dark |
| Footer patterns & deep navigation (sidebar, mega-menu, breadcrumb) | `aesthetics/navigation-footer.md` | Every multi-page project (footer) or complex nav structure |
| Lifting components (§6.13–6.18) + Showcase Pattern Atlas (§11) | `aesthetics/showcase-patterns.md` | Generating brand/marketing Showcase pages, hero-led home pages, or mobile app showcase pages |

These files extend — never contradict — the rules in this document. §0 North Star and §8 Anti-AI-Slop remain the floor.
