# Showcase Patterns — Lifting Components & Pattern Atlas

> Read only when generating brand/marketing Showcase pages, hero-led home pages, or mobile app showcase pages — triggered per `index.md` §12 on-demand loading.
>
> This file hosts the lifting-only UI Kit components (§6.13–§6.18) and the Showcase Pattern Atlas (§11) extracted from `aesthetics/index.md`. Section numbers are preserved so existing cross-references (`§6.16`, `§11.5`, etc.) remain valid. All values draw from `index.md` §1 tokens; §0 North Star and §8 Anti-AI-Slop remain the floor.

---

## Lifting Components (§6.13–§6.18)

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
- Background: same-hue micro gradient + a single radial halo for energy; halo color = a light scale of the single brand color (e.g. `var(--brand)` / brand-prefixed primary at low alpha). Never introduce `--accent` / `--secondary` variables (see index.md §1.3).
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

One Pattern per Hero / Showcase; the rest of the page falls back to index.md §2.1 rhythm.

> When the business does not fit any P-x (serious government, medical, corporate annual report), drop back to index.md §2.1 rhythm + §6 UI Kit with restrained execution. North Star (§0) and the Anti-AI-Slop blacklist (§8) still apply.
