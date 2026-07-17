# Aesthetic Self-Check Checklist

This is the deep post-generation checklist that makes the §0 North Star and §8 Anti-AI-Slop blacklist in `aesthetics/index.md` enforceable. Every page must pass `operation-policies/page-generation-quality-gate.md`; this file is deep-read only when that gate triggers it or when generating a brand / marketing Showcase home page.

When triggered, run three passes top-to-bottom. Any failure must be fixed before declaring completion. "Fix later" is not allowed.

- **Pass 1 — Design Review** confirms the page is directionally right.
- **Pass 2 — Aesthetic Lifting** confirms the page hits the visual lift bar.
- **Pass 3 — Infrastructure** confirms the page survives real production conditions.

---

## Pass 1 — Design Review

Before detailed checks, confirm the page passes this review. If two or more checks fail, stop and revise.

1. **Starts from the right context** — the page reflects the actual product, brand, design system, and business scenario. If it feels generic or interchangeable with another product, it is not ready.
2. **Has clear hierarchy** — there is a single instant focal point, readable structure, intentional rhythm. If it feels flat, noisy, or confused, it is not ready.
3. **Uses purposeful structure** — structure comes from composition, spacing, typography, and imagery. If it depends on filler, repeated containers, or decorative noise, it is not ready.
4. **Fits the scenario** — the layout and density fit the real business + user scenario. If it feels artificial, generic, or disconnected from real use, it is not ready.
5. **Holds up in real use** — coherent across states, edge cases, responsiveness, accessibility. If it only works as a polished screenshot, it is not ready.

---

## Pass 2 — Aesthetic Lifting Checklist

These checks correspond directly to `aesthetics/index.md`. Each line is a binary pass / fail.

### A. North Star (`index.md` §0)

- [ ] Information focus is identifiable within 1 second.
- [ ] Rhythm separates primary, secondary, tertiary content via whitespace, scale, composition.
- [ ] Detail is restrained: radius, shadow, border, decoration each follow a single system.
- [ ] Believability is real: copy, data, imagery match the business; no Lorem; no fabricated metrics.
- [ ] No AI smell: no rainbow gradients, no colored-icon-tile feature walls, no neon, no decorative particle noise without business meaning.

### B. System Discipline (`index.md` §1)

- [ ] All values come from tokens / brand-prefixed CSS variables; no inline raw HEX / RGB.
- [ ] Spacing follows 8pt grid; section vertical padding meets desktop ≥ 80px / mobile ≥ 48px.
- [ ] ≤ 4 type sizes per screen with clear jumps. 14 / 15 / 16 in the same view does not appear.
- [ ] Color count ≤ 6 per page; accent area ≤ 5%; no 3+ stop gradients; no rainbow strokes.
- [ ] ≤ 2 radius tiers per screen; only the three approved shadow tiers; border + shadow not stacked on the same element.
- [ ] Motion uses only transform / opacity / clip-path / filter; no `transition: all`; `prefers-reduced-motion` downgraded to 0.01ms; touch devices have hover transitions disabled.

### C. Composition (`index.md` §2)

- [ ] Page picks one explicit rhythm pattern from §2.1 (editorial / stacked / sticky+flow / asymmetric / scenes); default Hero + 3-column Feature + CTA is forbidden.
- [ ] Whitespace discipline holds (heading → body ≥ 24px; safe inset met).
- [ ] Grid is explicit: desktop 12 col / tablet 8 col / mobile single column.
- [ ] No card disease: cards carry information value, equal-height in the same block, nesting ≤ 2 levels.

### D. Detail Treatment (`index.md` §3, §4, §5, §6)

- [ ] Default left-align; centered only in legitimate ceremonial use (hero / pull quote / numeric hero / poster).
- [ ] Title vs subtitle differs on at least 2 of size / weight / color.
- [ ] Tabular Nums applied to all numeric content.
- [ ] ≤ 2 type families per screen.
- [ ] One icon library, single stroke width, fixed size set.
- [ ] No "colored rounded square + white Lucide icon" feature grid.
- [ ] Floating widgets (when used) follow `showcase-patterns.md` §6.13 (≥ 2 around hero, ±2°–4° rotation, real data, no glass).
- [ ] Device mocks (when used) follow `showcase-patterns.md` §6.16 (single radius tier inside, real business surface, no system UI mimicry).
- [ ] In-app surface (when used) follows `showcase-patterns.md` §6.17 (homologous radius; single accent halo; real proportions).
- [ ] Store badges (when used) follow `showcase-patterns.md` §6.18 (height 36–44px, two-line type, single icon color).

### E. Believability

- [ ] All copy is business-specific; no "Insert title here", no "Lorem", no "示例标题".
- [ ] All metrics either come from user input or are absent. Fabricated quantified claims ("10x faster", "99.9% uptime") are not present.
- [ ] All avatars are real photos (or abstract monogram for B2B / government). No initials-on-color circles.
- [ ] All product / object proportions follow real-world ratios (credit cards 1.586:1, products 1:1 / 4:5, content covers 16:10 / 16:9).

### F. Anti-AI-Slop (`index.md` §8)

This list mirrors §8. Any single hit fails the gate.

- [ ] No rainbow / multi-stop gradient backgrounds.
- [ ] No colored rounded tile + white Lucide icon Feature Grid.
- [ ] No "left 4px colored bar + rounded card" alert ornament used as decoration.
- [ ] No glow / neon / holographic halos.
- [ ] No particle noise / star sparkles / floating geometric particles in the background unless the page qualifies for the Animation Library Exception and the effect stays behind content.
- [ ] No purple-blue-pink trio without business meaning.
- [ ] No centered hero stack: gradient title + dual CTA + 3-column Feature.
- [ ] No three equal feature cards as the dominant first content block after the hero unless the business explicitly requires equal comparison.
- [ ] No hero / first-screen pill or tag overload (> 5 pills/tags without real information value).
- [ ] No cards-inside-cards-inside-cards: consecutive visible card layers where each layer has background, border, or radius.
- [ ] No glass morphism + inner shadow + heavy blur stacked together.
- [ ] No "data-feel" charts (bars without scale or label).
- [ ] No ≥ 3 radius tiers or ≥ 3 shadow specs in the same screen.
- [ ] No mobile hero with single centered phone surrounded by emoji / dots / floating geometry.
- [ ] No in-screen UI mimicking system surfaces (Settings / Calculator / clock wallpaper).
- [ ] No emoji as functional icon (sparkles/rocket/target/lightning); use Lucide instead.
- [ ] No Tailwind default accent colors (`#6366f1`, `#8b5cf6`, `#3b82f6`) used as primary brand accent.
- [ ] No fabricated quantified claims not provided by the user.

**Design soul test**: A stranger seeing one screenshot can identify which product the page is for. If they cannot, the page is a template — fix it.

### G. Chinese Environment (`index.md` §9)

- [ ] Primary heading ≤ 20 Chinese characters; button copy ≤ 6 chars; tab copy ≤ 4 chars.
- [ ] No CJK letter-spacing > 0.05em.
- [ ] No text overlap, no clipping, no character-by-character vertical wrap.
- [ ] CJK + Latin uses separate font families.
- [ ] No narrow containers, dense side-by-side, or pill-heavy patterns that cramp Chinese.
- [ ] CJK heading in split-column (< 60% width) uses H1 scale, never Display.
- [ ] CJK headings use both `text-wrap: balance` and `word-break: keep-all`.

### G.5 Hard Visual Defects (Zero Tolerance — any single hit fails the gate)

These checks address the most common and severe visual defects. **A single violation immediately fails the page.**

- [ ] **No bilingual title mixing**: The page uses exactly ONE language for all headings, labels, navigation text, and button copy. Only brand proper nouns and universal abbreviations (KPI, VIP, ID) may appear in a secondary language. Decorative English uppercase eyebrows (e.g., "CREATE FLOW", "ISSUE 04 · NATIVE TOPIC") on Chinese-language pages are forbidden.
- [ ] **No component overlap or collision**: No two non-background elements share overlapping bounding boxes. Absolutely positioned badges/tags do not touch or overlap heading text or other positioned elements. Adjacent components have a visible gap (≥ 8px).
- [ ] **Alignment mode is deliberate**: Every visible row/group chooses one alignment mode (left edge, right edge, center line, or baseline). Buttons, tags, form controls, card titles, list rows, table/toolbars, nav items, and icon+text groups do not drift against their peers.
- [ ] **No orphan micro-rows**: No full-width row contains only one small chip/tab/icon button/tiny CTA/KPI floating with arbitrary padding or margin. Single-element rows are allowed only when deliberately left/center/right aligned to the grid or when the row is completed by related title, metadata, status, action, filters, tabs, or summary content.
- [ ] **No sentence headings or long CTA labels**: Headings are short noun phrases, not full requirement sentences. CTA/button/tab/pill labels are short (Chinese 2-6 chars, English 1-3 words); explanatory copy is moved to body/subtitle text.
- [ ] **No oversized heading text blocks**: No heading that is a descriptive sentence (> 12 CJK chars or > 6 English words) is rendered at `text-4xl` (36px) or larger. CJK headings on mobile must not exceed `text-3xl` (30px). Any heading that wraps into 3+ lines at its rendered font-size is too large and must be reduced.
- [ ] **No button text wrapping**: Every `<button>` and button-styled `<a>` displays its label on a single line. If text wraps inside a button, reduce font-size or shorten copy — wrapping is never acceptable. All buttons must have `whitespace-nowrap`.

---

### H. Scenario Specifics (`index.md` §7, `showcase-patterns.md` §11)

When the page is a Hero / Showcase / Landing surface:

- [ ] Exactly one Pattern from `showcase-patterns.md` §11 (P-1 / P-2 / P-3 / P-4 / P-5) is used as the Hero.
- [ ] Pattern constraints fully met (e.g. P-1 KPI strip is 1px line dividers; P-5 dual phones each show different stories; P-5 ≤ 980px viewport downgrades to single phone, rotation removed).
- [ ] If business is unsuited to any P-x (serious government, medical, annual report), page falls back to §2.1 rhythm with restrained UI Kit; North Star and the blacklist still pass.

When the page is a mobile App Showcase:

- [ ] Stage uses §6.16 + §11.5 P-5 (`showcase-patterns.md`); outer device halo restricted to §6.16 shadow.
- [ ] In-screen content is real business (balance / order / cover / task / notice).
- [ ] ≥ 2 store badges per §6.18.
- [ ] Floats: 1–3, real business info, never littered.

When the page is a portfolio / personal site:

- [ ] Hero is Display + a single positioning sentence; no triple-tag list.
- [ ] Project list uses uniform thumbnail aspect; project detail covers background / role / process / outcome.

When the page is a graphic / print surface:

- [ ] Explicit grid (≥ 6 columns) and baseline grid (multiples of 4 / 8).
- [ ] Primary information ≥ 60% of visual area; whitespace ≥ 8% of short edge.

### I. Dark Mode (when `<html class="dark">`)

- [ ] Background is NOT pure #000000; uses `--bg` in #0B0B0F–#14141A range.
- [ ] Text is NOT pure #FFFFFF; uses `--ink` ≤ #E8E8EC.
- [ ] Cards use border (`rgba(255,255,255,.06)`) or elevated surface, not light-mode shadow values.
- [ ] Images have `brightness(.92) saturate(.92)` or equivalent darkening.
- [ ] Contrast ratio ≥ 4.5:1 tested against `--surface` (not `--bg`).

Deep read trigger: If 2+ items above fail or are uncertain, read `aesthetics/dark-mode.md`.

### J. Footer

- [ ] Multi-page project has consistent footer on every page.
- [ ] Footer uses `<footer>` semantic element.
- [ ] Footer links are real (not "Link 1"); ≤ 5 social icons if present.
- [ ] Mobile: footer columns stack single-file, not cramped side-by-side.

Deep read trigger: If footer is missing or malformed, read `aesthetics/navigation-footer.md`.

---

## Pass 3 — Infrastructure Checks

These items ensure the page's visual + style infrastructure is complete. Missing any single item causes partial or total style loss in production.

### Token Compliance

This check takes precedence over all others. A page that fails token compliance is unqualified regardless of visual quality.

- All colors, fonts, radii, and shadows must come from brand-prefixed CSS variables.
- Same semantic role must use the same token across the page.
- No hardcoded values outside the brand system.

[FORBIDDEN] Tailwind named color classes (`bg-blue-500`, `text-gray-200`), hard-coded HEX/RGB (`bg-[#5B4FE8]`), radius classes outside brand tiers (`rounded-2xl`, `rounded-3xl`).

**Quick text-search self-check** — any hit on the generated HTML is a violation:

| Search Pattern | What It Catches |
|--------------|----------------|
| `bg-red-`, `bg-blue-`, `bg-green-`, `bg-gray-`, `bg-slate-`, `bg-zinc-`, `bg-neutral-`, `bg-stone-`, etc. | Tailwind named colors in backgrounds |
| `text-red-`, `text-blue-`, `text-green-`, etc. | Tailwind named colors in text |
| `border-red-`, `border-blue-`, etc. | Tailwind named colors in borders |
| `bg-[#`, `text-[#`, `border-[#` | Hard-coded color values |
| `rounded-[` | Hard-coded radius values |
| `rounded-2xl`, `rounded-3xl` | Radius classes outside brand tiers |
| `#6366f1`, `#8b5cf6`, `#3b82f6` | Tailwind default accents masquerading as brand color |

### Library Conformance (Required when Design Library exists)

> This check verifies that the page implementation properly consumed and followed the Design Library's component documentation and UI Kit layout patterns. **Skip this section only when no Design Library exists.**

#### Component Doc Compliance

| Detection Signal | Design Goal |
|---------|---------|
| A UI element (button, card, table, form, nav) exists on the page, its component doc was assigned, but the implementation does not follow the doc's variant/size/state definitions | When a component doc is assigned, the implementation must match its spec — same variant structure, size options, state handling |
| Component HTML structure significantly differs from the doc's "HTML Reference" section | Implementation must adapt the HTML Reference as its starting point; reimplementing from scratch when a reference exists is [FORBIDDEN] |
| The component uses CSS classes, structures, or patterns not mentioned in the doc when the doc provides explicit guidance | Follow the doc's explicit guidance; only extend beyond it when the doc does not cover a specific need |

#### UI Kit Layout Compliance

| Detection Signal | Design Goal |
|---------|---------|
| Page layout architecture (section order, component composition, spacing rhythm) has no resemblance to the assigned UI Kit | The Kit's layout patterns serve as the baseline; deviations should be intentional improvements, not divergent reimaginations |
| Kit demonstrates a specific navigation pattern (sidebar, top-nav, bottom-tab) but the page uses a completely different one without justification | Navigation patterns should follow Kit precedent unless page requirements specifically demand otherwise |
| Kit uses a consistent component composition pattern (e.g., card structure) but the page invents a different pattern | Prefer Kit-demonstrated patterns for consistency with the Library's visual language |

#### Quick Self-check Method

Before declaring the page complete, verify:
1. For each assigned component doc: did I read it? Does my implementation match its variants/sizes/states?
2. For the assigned UI Kit: did I read it? Does my page layout echo its demonstrated patterns?
3. Can I point to specific elements in my HTML that were adapted from component HTML References?

**If the answer to any question is "no" and the corresponding Library resource was assigned — the page is non-conformant and must be revised.**

### Components, Charts, and Graphics

- Prefer mature systems (§6 UI Kit, shadcn, Lucide, stable open source) before inventing new ones.
- Single chart series uses `--brand`; multi-series steps brand lightness; grid `--line`; one Tooltip on hover (no crosshair + tooltip + marker triple stack).
- One icon library per page; single stroke width; fixed size set.

### Typography

- Hierarchy is clear (size + spacing + alignment + contrast before weight).
- Headings, body, supporting text do not collapse into one visual level.
- Chinese text remains restrained, readable, structurally stable.
- If using serif for editorial/culture/publishing tone, all Chinese
  title/display roles use one consistent CJK serif family. No page mixes several
  serif faces that make headings look visually unrelated or "dropped in".
- Numbers use Tabular Nums.

[FORBIDDEN] Inter / Roboto / Arial / Poppins / DM Sans / Nunito / Quicksand applied as the sole system on every page when a business-tone choice exists per `index.md` §3.1 Font Selection.

### Color and Surface

- Color usage is restrained and consistent.
- Accent appears only where focus or action requires it.
- Backgrounds and surfaces feel continuous, not fragmented; surface depth used for partition before borders.
- No neon, no rainbow, no decorative saturation.

[FORBIDDEN] Blue-purple / neon / high-saturation pink gradients, rainbow gradients, neon-colored blurred light spots.

### Layout and Shape

- Layout has rhythm, hierarchy, and breathing room.
- No repetitive card walls, equal-emphasis layouts, or over-containerization.
- Containers are justified by information value.
- Shape language is consistent and structurally meaningful (≤ 2 radius tiers per screen).
- Navigation is taken out of document flow and spans full viewport width.
- On mobile, every section carries an irreplaceable narrative role; adjacent sections use different layout arrangements.

### Imagery

- Icons and images match the business scenario and page meaning.
- No decorative icon wrappers, no semantically empty imagery, no generic visual filler.
- Image and icon style is consistent within the page.
- Image generation prompts begin with business keywords (not "modern office" / "happy people"), with quality and exclusion keywords appended.

[FORBIDDEN] DOM placeholders instead of real images; colored background wrappers around icons used purely for decoration.

### Motion

- Motion supports hierarchy, feedback, or interaction.
- Subtle and purposeful.
- No decorative motion that distracts from content.

### State and Real Use

- Data surfaces account for loading, empty, error, populated, edge states.
- Forms include validation, submission, recovery.
- Not just the happy path.

### Accessibility Baseline

- Every `<img>` has `alt`.
- Every form input has an associated `<label>`.
- No heading level skips (h1 to h3 is forbidden).
- Buttons and links have accessible names or `aria-label`.
- No `outline: none` without a `:focus-visible` replacement.
- Touch targets ≥ 24×24px.
- Color is not the sole information carrier (status dots have text labels).
- Interactive elements are native (`<button>`, `<a href>`), not `<div onclick>`.

### Style Integrity

**Required `<head>` elements** — verify each exists exactly once:

| Element | Why It Matters |
|---------|---------------|
| `<script src="...@tailwindcss/browser@4">` | Tailwind CSS runtime — without it, all utility classes are ineffective |
| `<script src="...lucide@1.7.0">` | Lucide Icons CDN — without it, all icons fail to render |
| `<style id="theme-vars">` with `:root { ... }` block | Light mode CSS variable definitions |
| `<style id="theme-vars">` with `.dark { ... }` block | Dark mode CSS variable definitions |
| `@theme inline { ... }` block | Tailwind v4 bridge configuration |
| `@layer base { ... }` block | Base styles (body bg, font, table word-breaking) |
| `lucide.createIcons()` script at `<body>` bottom | Lucide icon initialization |

**Required element attributes:**

| Element | Required Attribute |
|---------|-------------------|
| `<html>` | `class="light"` or `class="dark"` |
| `<html>` | `lang="..."` |
| `<body>` | `min-h-screen font-sans antialiased` |

[FORBIDDEN] Manually rewriting `<head>` content, deleting `<style id="theme-vars">`, modifying the `@theme inline` bridge.

### Metadata Leak

- No node IDs, indices, file paths, or technical identifiers shown as visible text.
- Visible text is business semantics only; canvas / system internals never leak.
- Technical fields belong to DOM attributes or JSON config, never visible text.

### Responsive & Overflow Defense

**Responsive layout:**

- Multi-column layouts must downgrade responsively.
- Image-text side-by-side stacks vertically on mobile, upgrades to side-by-side on desktop.
- No fixed-pixel widths; fluid layout only.
- Images adapt to container width.

**Overflow protection:**

- Tag / badge text stays single line.
- On mobile, auxiliary rounded blocks inside cards take their own line, never sit beside main content.
- KPI numbers and numeric content [FORBIDDEN] from wrapping.
- Table headers stay single line.
- Narrow-column CJK that breaks character-by-character into vertical layout is forbidden.
- Narrow-screen tables provide horizontal scrolling.
- Long text columns limit displayed line count; full content via tooltip.

---

## What to Do When Something Fails

1. **One or two failures**: fix in place; re-run the affected pass section before declaring completion.
2. **Three or more failures in Pass 1 or Pass 2.A / 2.F**: the visual direction is wrong. Stop, re-pick the `index.md` §2.1 rhythm or `showcase-patterns.md` §11 Pattern, and regenerate the page. Patching cosmetic details is not enough.
3. **Any Pass 3 Token Compliance failure**: page is unqualified regardless of how it looks. Replace inline values with brand-prefixed variables before any visual review.

---

## Automatable Checks

Several checks are already enforced by `scan-design-directory.mjs` at the Main Agent validation gate; the Sub-Agent self-check remains the first line of defense (catching issues before the gate). Status column reflects current implementation.

| Check | Automation Method | Status |
|-------|-------------------|--------|
| Tailwind default HEX as accent | grep for `#6366f1` / `#8b5cf6` / `#3b82f6` in HTML | Implemented in scan script (HTML quality rules) |
| Raw HEX count outside `:root` | count unique color literals | Implemented in scan script (hardcoded color check) |
| Hard-coded radius values | grep `rounded-[`, `rounded-2xl`, `rounded-3xl` | Implemented in scan script (free-explore CSS rules) |
| External placeholder image URLs | grep for known placeholder domains | Implemented in scan script (image path validity) |
| Missing `<head>` elements | verify required scripts / tags exist exactly once | Implemented in scan script (HTML infrastructure) |
| Emoji as icon | regex for emoji in visible text contexts | LLM self-check only |
| AI-default font as sole family | grep `font-family` for Inter / Roboto / Poppins without companion brand stack | LLM self-check only |
| Type-scale ambiguity | scan for 14 / 15 / 16 px coexisting in the same component | LLM self-check only |
| Metadata leak in visible text | grep node IDs, file paths, technical identifiers | LLM self-check only |
| Fabricated quantified claims | regex for digit + x or % cross-checked against user-provided data | LLM self-check only |

---

## Anti-AI-Slop Severity Grading

> **Scope boundary**: This check applies ONLY to HTML/CSS code quality. Generated image files (`assets/*.jpg`) are **explicitly excluded** from AI-slop inspection — the Agent cannot read binary image content and must not make quality judgments about images based on assumptions. If `GenerateImage` returned success, the image passes this check unconditionally.

> Supplements Pass 2.F with severity levels. Pass 2.F checkboxes catch the pattern; this section grades the severity.

### P0 — Must Fix (any single hit disqualifies the page)

| # | AI-Slop Signal | Detection Method | Fix Direction |
|---|---------------|-----------------|---------------|
| 1 | **Tailwind default color as accent** | Search for `#6366f1`, `#8b5cf6`, `#3b82f6`, `#06b6d4`, `#10b981`, `#f59e0b` or their CSS variable equivalents used as the primary brand accent (not as status colors) | All accent colors must come from brand CSS variables. The fact that indigo-500 "looks nice" is exactly why every AI picks it |
| 2 | **"Trust gradient" in Hero section** | Visual: hero background uses a blue→purple, purple→pink, or blue→cyan gradient that isn't defined in the brand CSS system | Gradients only within same-hue lightness channel; cross-hue gradients must come from brand CSS or be eliminated |
| 3 | **Emoji as functional icons** | Search HTML for emoji characters (✨🚀🎯⚡🔥💡📊💪🎉✅❌⭐) used as feature/section icons | Use Lucide icons or brand icon system. Emoji convey "demo mockup," not "shipping product" |
| 4 | **Font mismatch with brand CSS** | Brand CSS specifies a Serif display font but headings render in Sans-serif (or vice versa) | `font-family` must always resolve to `var(--{prefix}-font-*)`. Never override with a "safer" font |
| 4b | **Serif family mixing** | Multiple different serif faces are used for Chinese headings/title areas in one page or sibling pages | Choose one CJK serif display stack project-wide; remove decorative Latin serif prefixes from Chinese headings |
| 5 | **Rounded card + left color bar** pattern | Cards that have `border-left: 3-4px solid [accent]` + large border-radius — the classic "AI Dashboard tile" | If the brand doesn't explicitly call for this pattern, it is a template artifact. Use surface differentiation (background shade, elevation) instead |
| 6 | **Fabricated metrics** | Page displays quantified claims like "10× faster", "99.9% uptime", "500+ integrations", "Trusted by 10,000+ teams" that weren't provided by the user | All numeric claims must come from user-provided content. When no real data exists, use qualitative copy or leave placeholder markers for user to fill |
| 7 | **Filler copy** | Search for: "Lorem ipsum", "Feature One/Two/Three", "Your tagline here", "Description goes here", "Coming soon" | All copy must be contextually meaningful. If you don't know the real copy, write realistic placeholder copy derived from the business scenario |

### P1 — Should Fix (accumulated hits indicate template-level output)

| # | AI-Slop Signal | Detection Method |
|---|---------------|-----------------|
| 8 | **Standard section railroad** | Page follows the exact sequence: Hero → Features grid → Social proof → Pricing → FAQ → CTA — with no variation, unique section, or content-specific structure |
| 9 | **External placeholder images** | `src` attributes point to `unsplash.com`, `placehold.co`, `placeholder.com`, `via.placeholder.com`, `picsum.photos` |
| 10 | **Excessive raw HEX values** | More than 12 distinct HEX/RGB/HSL values appear outside `:root` / `<style id="theme-vars">` blocks |
| 11 | **`var(--{prefix}-primary)` overuse** | The primary/accent variable is referenced more than 6 times on a single screen viewport (count all `bg-*`, `text-*`, `border-*` that resolve to the accent) |
| 12 | **Homogeneous 3-column grid** | All feature/benefit sections use identical 3-column card grids with [icon → title → description] structure, no layout variation |
| 13 | **Generic CTA text** | Buttons say "Get Started", "Learn More", "Sign Up Now", "Try Free" without any product-specific language |
| 14 | **system-ui for display text** | Headings ≥ 24px using `font-family: system-ui` or `ui-sans-serif` without a brand-specific font declaration |
| 15 | **Dead interactive controls** | Buttons/links/cards use only `cursor-pointer` or static styles with no hover/focus-visible/active feedback |
| 16 | **Generic hover cloning** | Every button/card has the same hover behavior regardless of hierarchy, brand tone, or business action |
| 17 | **Motion overstacking** | The same element combines scale + translate + shadow + glow/filter on hover or entrance |
| 18 | **Decorative particle clutter** | Particles/floating elements obscure content, compete with CTAs, or have no business meaning |
| 19 | **Unjustified animation library** | GSAP/particle libraries are imported only to implement ordinary hover/button/card feedback that CSS can handle |

### Soul Injection Formula (80/20 Rule)

A well-designed page is **80% proven patterns + 20% unique decisions**. The 20% should live in:

1. **One bold visual decision** — an unusual font pairing, a single strong accent color, an unconventional aspect ratio, an asymmetric layout
2. **Copy micro-interactions** — "Start tracking" beats "Get started"; "See what changed" beats "Learn more"; verbs that reference the actual product action
3. **One memorable micro-interaction** — a button that shifts 2px on press, a card that subtly rotates on hover, a number that counts up on scroll-into-view
4. **One insider detail** — something only a person who has used the product would think to put on the page (specific feature name, workflow shortcut, domain-specific metric)

**Quick self-check**: After page generation, ask: "Which specific element on this page would I remember tomorrow?" If the answer is "nothing" — the 20% is missing.
