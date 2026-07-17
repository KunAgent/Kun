# Barbie Design System

A design system reconstruction of Barbie as a dashboard product system: bright, editorial, and unapologetically pink, but organized for campaign planning, content operations, and performance monitoring rather than toy packaging alone. The current library is purpose-built for a dashboard UI where glamour needs to coexist with data density.

## Source

- **Library source:** `/data/user/work/barbie-library/orchestration-summary.json`
- **Generated library root:** `/workspace/.design_library/Barbie`
- **Kit type:** `dashboard`
- **Available generated scope:** foundations, token exports, preview pages, and component JSON analyses
- **Unavailable source metadata:** original Figma filename, page count, frame count, and brand-owner attribution were not exposed in the provided summary

## What this design system covers

- **Foundations** — light and dark color tokens, font-family tokens, a single oversized radius token, 4px spacing base, tracking, and a pink-tinted elevation system documented in `/workspace/.design_library/Barbie/colors_and_type.css` and `/workspace/.design_library/Barbie/css.json`
- **Components** — 6 documented component families in `/workspace/.design_library/Barbie/components/`: button, card, table, chart, navigation, and sidebar
- **Preview layer** — 6 HTML previews in `/workspace/.design_library/Barbie/preview/` for quick visual reference
- **System posture** — a partial but coherent dashboard library; no `SKILL.md`, `assets/`, or `ui_kits/dashboard/` output exists yet in the generated folder

## CONTENT FUNDAMENTALS

### Voice & tone

The language direction is concise, campaign-oriented, and commercially confident. Even in a playful brand world, the UI copy here behaves like a marketing operations tool: labels are short, presentation-first, and optimized for scanning. The tone does not sound technical or bureaucratic; it sounds editorial, with a bias toward launches, stories, boards, and pulse-style reporting. The extracted copy is entirely in English, title-cased more often than sentence-cased, and avoids filler helper text. There is no evidence of emoji use, slang, or jokey microcopy in the supplied library artifacts, so generated product copy should stay polished, energetic, and direct rather than whimsical to the point of novelty.

### Concrete copy examples

- Dashboard headline: *"Campaign Pulse"*
- Feature or release label: *"New Capsule Launch"*
- Primary productivity action: *"Add to Board"*
- KPI label: *"Audience Growth"*
- Performance module title: *"Top Performing Story"*

### When generating copy

- Prefer short editorial nouns and action phrases over long instructional sentences.
- Use campaign, audience, story, board, launch, and pulse language before generic admin terminology.
- Keep CTAs crisp and confident; the visual system already provides personality, so the copy should stay controlled.
- Favor title case for headers, cards, and KPI modules when matching the observed tone.
- Avoid overly technical back-office phrasing unless the component is explicitly data-heavy.

## VISUAL FOUNDATIONS

### Color

Barbie’s core system color is **`#e91e63`**, a saturated fashion pink used for primary actions, focus rings, chart accents, sidebar emphasis, and active navigation moments. It is not treated as a tiny accent; it is the governing brand signal. Around it sits a powdery supporting scale: **`#fce4ec`** for secondary surfaces and borders, **`#ff9ec5`** for softer accent fills, and **`#ffebf3`** / **`#fff0f6`** for blush backgrounds that replace neutral gray with cosmetic warmth. Text in light mode anchors on **`#310015`**, which gives the pink palette enough contrast without turning fully black. The chart palette deepens from **`#e91e63`** to **`#880e4f`**, so data visualization stays tonal instead of introducing unrelated hues.

Dark mode intensifies the same story rather than reinterpreting it. The background drops to **`#1a000e`**, cards to **`#2d001a`**, and the main active pink brightens to **`#ff007f`**, with additional accents like **`#ff4081`** and **`#f50057`**. This keeps the interface glossy and club-lit instead of muted. Semantic support is thin but explicit where present: destructive red is **`#d50000`** in light mode and **`#ff1744`** in dark mode. No dedicated success or warning tokens were supplied, so the palette currently expresses brand and danger far more strongly than neutral status communication.

### Typography

The primary UI face is **Inter**, defined in `/workspace/.design_library/Barbie/colors_and_type.css` as `--font-sans: 'Inter', -apple-system, sans-serif`. That choice makes sense for a dashboard: it keeps the pink-heavy visual language readable and modern instead of decorative. For editorial contrast, the system also exposes **Georgia** as `--font-serif`, which suggests selective use for storytelling moments, campaign spotlights, or presentation-style cards rather than dense controls. Utility and data contexts use **JetBrains Mono** as `--font-mono`, giving metrics, IDs, and tabular moments a more operational texture.

The major limitation is that the source export includes **font families only**. No font-size, font-weight, or line-height tokens were present in `/workspace/.design_library/Barbie/css.json`, so the library communicates typographic mood but not a complete scale. That means implementation should preserve the role split exactly as observed—Inter for the working interface, Georgia for editorial emphasis, JetBrains Mono for utilitarian readouts—while treating detailed size hierarchy as an inferred layer that still needs design confirmation.

### Spacing

The spacing base is **`4px`**, exposed as `--spacing: 0.25rem`. That small base fits the dashboard framing in the orchestration summary: compact enough for dense KPI layouts, but softened by large radius and pink shadows so it never feels severe. There are no additional spacing tokens listed beyond the base unit, which implies rhythm is meant to be composed from multiples of 4 rather than from a broad named scale.

### Radius

The radius story is deliberately singular. The exported system contains one radius token, **`28.8px`** (`--radius: 1.8rem`), and that oversized value is the key visual quirk of the library. Buttons, cards, nav capsules, and highlighted containers all inherit a plush, toy-like silhouette from this single decision. Because there is no smaller companion radius set in the exported tokens, the system reads as consistently rounded rather than hierarchically rounded; softness is not an accent, it is the baseline.

### Shadow / Elevation

This library uses one repeated shadow primitive more than a conventional elevation ladder. The base shadow is pink-tinted, with **`0px 5.5px 12.5px 0px`** geometry and **`#ff0059`** as the source color in light mode. The exported levels `shadow-2xs` through `shadow-2xl` mostly restack that same blur and offset with opacity shifts from **0.04** to **0.20**, while some mid-level tokens add a secondary low blur line such as `0px 1px 2px -1px` or `0px 4px 6px -1px`. The effect is less architectural than cosmetic: elevation feels like glow-enhanced polish rather than depth in a sober enterprise sense.

In dark mode, the geometry remains the same but the shadow color flips to black. That preserves spatial consistency while letting the color system, not the shadow, do most of the expressive work. Cards therefore feel lifted, but the pink palette still carries the emotional signature.

### Borders

- Border and input lines rely on **`#fce4ec`** in light mode, so separation stays blush-toned rather than gray.
- Sidebar borders use **`#fff0f6`**, making the navigation shell blend into the broader soft-pink canvas.
- In dark mode, borders recede heavily into **`#1a000e`** and **`#12000a`**, which favors contrast through fill and typography instead of hard outlines.

### Backgrounds

- The system background is pure white at **`#ffffff`**, but cards shift slightly warmer to **`#fffafc`**, avoiding sterile flatness.
- Muted surfaces use **`#ffebf3`**, so secondary panels still remain inside the Barbie color universe.
- Sidebar surfaces use **`#fff0f6`** in light mode and **`#12000a`** in dark mode, helping navigation feel like a branded frame rather than an external shell.

### Animation

- No animation tokens or timing values were included in the provided outputs.
- Motion should therefore be treated as inferred behavior, not a documented part of this library.
- If motion is added later, it should support polish and confidence, not bounce or novelty that would undermine dashboard readability.

### Iconography

- No icon assets were generated in `/workspace/.design_library/Barbie/assets/`; that directory does not exist in the current output.
- Component JSON files assume optional icons in places such as buttons, but no concrete icon set is documented yet.
- Any production iconography should stay crisp and modern, letting the pink system provide emotion while icons remain functional.

## Component Patterns

| Component | File | Key Insight |
|---|---|---|
| Button | `preview/component-button.html` | Rounded CTA with high-contrast pink fill and white text. |
| Card | `preview/component-card.html` | Core insight card with elevated pink-shadow treatment. |
| Table | `preview/component-table.html` | Readable performance table with airy row rhythm. |
| Chart | `preview/component-chart.html` | Campaign bars using saturated pink scale. |
| Navigation | `preview/component-navigation.html` | Horizontal app navigation with crisp active underline. |
| Sidebar | `preview/component-sidebar.html` | Full navigation rail with active pink capsule. |

Across components, three patterns recur in `/workspace/.design_library/Barbie/components/index.json`: a single oversized radius token that keeps every silhouette soft, primary actions that rely on saturated pink with white text, and data surfaces that choose blush neutrals plus pink-tinted shadows instead of grayscale enterprise chrome. That combination is what makes the dashboard feel recognizably Barbie without losing operational clarity.

## Generated file index

- `/workspace/.design_library/Barbie/README.md` — this file
- `/workspace/.design_library/Barbie/colors_and_type.css` — combined CSS token file for color, type, spacing, radius, tracking, and shadows
- `/workspace/.design_library/Barbie/css.json` — structured JSON token export with hex values and shadow primitives
- `/workspace/.design_library/Barbie/components/index.json` — component index and cross-component patterns
- `/workspace/.design_library/Barbie/components/button.json` — button anatomy, variables, and variant dimensions
- `/workspace/.design_library/Barbie/components/card.json` — card anatomy, variables, and variant dimensions
- `/workspace/.design_library/Barbie/components/chart.json` — chart component analysis
- `/workspace/.design_library/Barbie/components/navigation.json` — top navigation analysis
- `/workspace/.design_library/Barbie/components/sidebar.json` — sidebar analysis
- `/workspace/.design_library/Barbie/components/table.json` — table analysis
- `/workspace/.design_library/Barbie/preview/component-button.html` — button preview page
- `/workspace/.design_library/Barbie/preview/component-card.html` — card preview page
- `/workspace/.design_library/Barbie/preview/component-chart.html` — chart preview page
- `/workspace/.design_library/Barbie/preview/component-navigation.html` — navigation preview page
- `/workspace/.design_library/Barbie/preview/component-sidebar.html` — sidebar preview page
- `/workspace/.design_library/Barbie/preview/component-table.html` — table preview page

## Caveats / known substitutions

1. **Font scale data is incomplete.** `/workspace/.design_library/Barbie/css.json` includes family tokens for Inter, Georgia, and JetBrains Mono, but it does not include size, weight, or line-height tokens. Any detailed typography scale in implementation is therefore inferred, not directly observed.
2. **Font availability is fallback-based.** Inter falls back to `-apple-system, sans-serif`; Georgia falls back to generic `serif`; JetBrains Mono falls back to generic `monospace`. The family intent is explicit, but exact rendering may vary by platform if those preferred fonts are unavailable.
3. **Semantic color coverage is partial.** Destructive tokens are defined, but dedicated success, warning, and info token sets are not present in the exported JSON. Additional status colors should be added carefully rather than improvised ad hoc.
4. **Radius hierarchy is intentionally flat but also limited.** Only one exported radius token, `28.8px`, is available. That makes the visual signature clear, but it leaves no documented smaller radius for compact data widgets or tight table treatments.
5. **Icon and asset coverage is incomplete.** The expected `assets/` directory described by the output spec is absent from the current generated library, so iconography guidance remains conceptual rather than asset-backed.
6. **The library output is structurally partial.** The output spec describes `SKILL.md` and `ui_kits/<type>/index.html` as part of a complete design library, but neither exists in `/workspace/.design_library/Barbie` at the time of writing.
7. **Some component analyses are AI-inferred.** Several files explicitly cite evidence such as “AI-inferred from dashboard preset and source tokens,” so anatomy and variant dimensions should be treated as strong reconstruction work, not as verbatim source documentation.
