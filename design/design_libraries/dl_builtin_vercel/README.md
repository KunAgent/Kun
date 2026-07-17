# Vercel Design System

A design system reconstruction of **Vercel** — a developer platform for deployment, preview environments, observability, usage tracking, and domain management. The resulting library is tuned for a dashboard context, so the system favors dense information layouts, crisp operational states, and a technical tone over brand theater.

## Source

- **Library source:** token-only design export
- **Pages:** unavailable in the source bundle
- **Brand owner:** Vercel

## What this design system covers

- **Foundations** — monochrome light and dark surfaces, a compact `4px` spacing base, a single `8px` radius, quiet shadow tokens, and three named font families.
- **Components** — `6` documented component categories: Button, Card, Table, Chart, Navigation, and Sidebar.
- **Sample kit** — component preview HTML files were generated, but no full dashboard UI kit is present in this output.

## Content Fundamentals

### Voice & tone

Vercel's voice in this library reads as precise, technical, and minimal. The copy cues are almost entirely noun- and verb-led, which makes the interface feel operational rather than promotional. Labels are short, confident, and utility-first; they describe destinations or capabilities without decoration. This tone works especially well for a developer dashboard because it keeps attention on status, data, and actions instead of brand messaging.

### Concrete copy examples

- Primary action: *"Deploy"*
- Environment context: *"Preview"*
- Platform capability: *"Observability"*
- Billing or telemetry label: *"Usage"*
- Infrastructure setting: *"Domains"*

### When generating copy

- Prefer single-word or two-word labels when the action is already obvious from context.
- Use product nouns such as deployment, preview, observability, usage, and domains as navigation anchors.
- Keep interface language literal and operational; avoid marketing superlatives or conversational filler.
- Let hierarchy, contrast, and placement carry emphasis before adding more words.

## Visual Foundations

### Color

Vercel's color system is defined by deliberate restraint. In light mode, the working canvas is bright and nearly paper-white, with `#ffffff` used for background, card, and popover surfaces, then slightly separated with muted fills at `#f5f5f5` and borders at `#e8e8e8`. Text stays almost black at `#0a0a0a`, while primary emphasis moves to `#121212`, so the brand signal comes from tonal authority rather than from a signature hue. This makes the system feel editorial, technical, and controlled.

Dark mode inverts that logic without becoming saturated. Background shifts to `#0a0a0a`, cards to `#171717`, and popovers or muted zones to `#262626`, while foreground content becomes `#fafafa`. The primary emphasis token flips to `#e5e5e5`, which keeps the interface monochrome even when the hierarchy changes. The overall effect is that emphasis comes from inversion and contrast, not from colorful fills.

Color becomes more expressive only in tightly scoped cases. Destructive states use `#e7000b` in light mode and `#ff6467` in dark mode, which keeps risk legible without introducing a broader warm palette. Charts are the one place where blue enters decisively, moving from `#91c5ff` through `#3a81f6`, `#2563ef`, and `#1a4eda` to `#1f3fad`. That blue ramp functions as an insight channel inside an otherwise monochrome product, so data visualization can feel vivid without making the rest of the dashboard noisy.

The sidebar palette follows the same principle. In light mode it stays soft at `#fafafa` with text at `#0a0a0a`, and in dark mode it becomes `#171717` with `#fafafa` text. A notable exception is dark-mode `--sidebar-primary` at `#1447e6`, which suggests that navigation can occasionally borrow from the platform's blue data emphasis when a selected state needs stronger orientation.

### Typography

Typography is one of the clearest signals of brand character in this library. **Geist** is the primary interface face, and its inclusion positions the system as modern, engineered, and intentionally product-native rather than generic. The fallback stack is `ui-sans-serif, sans-serif, system-ui`, so if Geist is unavailable the interface still remains clean and neutral. **DM Serif Display** appears as the serif counterpart, which introduces an editorial accent that can be used for moments of narrative contrast or product storytelling without changing the operational tone of the rest of the dashboard. **Geist Mono** handles code-like, technical, or numeric content and falls back to `ui-monospace, monospace`.

The available token export does not include explicit type-size, weight, or line-height scales, so this reconstruction cannot claim a full typographic ladder. What it does show is a role-based system: sans for interface structure, serif for selective contrast, and mono for technical notation. Letter spacing remains neutral at `0em`, which reinforces the overall sense of precision. In practical terms, the typography feels less like a marketing site system and more like a product shell for dense, high-confidence information.

### Spacing

Spacing is compact and systematic. The base token is `4px` (`0.25rem`), which is small enough to support dashboard density while still producing a readable rhythm when multiplied upward. Combined with the restrained color model, this spacing choice suggests that Vercel's interface should feel efficient, tightly packed, and intentionally aligned rather than spacious or lifestyle-oriented. The source bundle does not expose additional spacing steps, but the `4px` base alone already indicates an information-first layout philosophy.

### Radius

The radius model is intentionally singular. Both the CSS token file and the structured JSON resolve the shared radius token to `8px` (`0.5rem`), and there is no evidence of a softer secondary radius family. That means the design language is not trying to create personality through shape variety; instead, it uses one consistent corner treatment to keep surfaces precise and interoperable.

- **`8px`** — the default corner treatment for cards, controls, and other standard surfaces.
- **No alternate radius family is exposed** — this keeps the system disciplined and reduces visual noise across a dense dashboard.

### Shadow / Elevation

Elevation is deliberately muted to the edge of disappearance. The token set defines named layers from `shadow-2xs` through `shadow-2xl`, but they all resolve to black at `0` opacity. Even the structural values stay restrained, typically using a `0 1px` vertical offset with `0px` blur in the core tokens. In other words, the system preserves the API surface of a shadow scale without depending on visible shadow rendering to separate layers.

That decision matters because it shifts hierarchy back onto borders, background tone, and spacing. In light mode, surfaces are separated by white-on-gray relationships and pale borders such as `#e8e8e8`; in dark mode, the same job is done by tonal steps between `#0a0a0a`, `#171717`, and `#262626`. The resulting interface feels flatter, calmer, and more exact than most SaaS dashboards that rely on soft elevation.

### Borders and backgrounds

- Borders are thin and quiet, with `#e8e8e8` in light mode and `#282828` in dark mode doing most of the structural work.
- Backgrounds are layered through small tonal steps instead of decorative contrast: `#ffffff` to `#f5f5f5` in light mode, `#0a0a0a` to `#262626` in dark mode.
- Inputs inherit this same discipline through `#e5e5e5` in light mode and `#343434` in dark mode, which keeps fields integrated into the surrounding surfaces instead of making them look like separate widgets.

## Component Patterns

| Component | File | Key Insight |
|---|---|---|
| Button | `preview/component-button.html` | Primary actions should win through tonal inversion, not through extra color or weight. |
| Card | `preview/component-card.html` | Cards are quiet containers that rely on information hierarchy and border definition rather than elevated chrome. |
| Table | `preview/component-table.html` | Data presentation should stay dense, readable, and operational, with decoration kept subordinate to scanability. |
| Chart | `preview/component-chart.html` | Blue tokens are reserved for insight moments so charts can stand out inside a mostly monochrome dashboard. |
| Navigation | `preview/component-navigation.html` | Navigation should feel editorial and compact, using contrast shifts instead of bright fills. |
| Sidebar | `preview/component-sidebar.html` | The sidebar acts as a soft contextual frame, not as a second accent surface competing with the main content. |

## Index

- `README.md` — the human-readable brand narrative for this design library.
- `colors_and_type.css` — the canonical token file for colors, fonts, radius, shadows, and spacing.
- `css.json` — structured token data for programmatic consumption.
- `components/index.json` — component inventory plus cross-component pattern guidance.
- `components/button.json`, `components/card.json`, `components/table.json`, `components/chart.json`, `components/navigation.json`, `components/sidebar.json` — per-component structured analysis files.
- `preview/component-button.html`, `preview/component-card.html`, `preview/component-table.html`, `preview/component-chart.html`, `preview/component-navigation.html`, `preview/component-sidebar.html` — lightweight preview pages for reviewing the reconstructed patterns.

## Caveats / known substitutions

1. **The source bundle only contained design tokens.** Component structures, product framing, and some interaction implications were inferred from token names and generated previews rather than from a complete source library.
2. **No Figma page or frame metadata was available.** This README cannot document page counts, screen inventory, or source hierarchy because that information was absent from the provided data.
3. **Typography roles are known, but the type scale is incomplete.** The available tokens name `Geist`, `DM Serif Display`, and `Geist Mono`, yet they do not expose explicit size, weight, or line-height tokens. As a result, this documentation describes family usage rather than a full text-scale specification.
4. **Font fallback is stack-based rather than asset-based.** If Geist, DM Serif Display, or Geist Mono are not available in a target environment, the system falls back to `ui-sans-serif`, `ui-serif`, `serif`, `ui-monospace`, and `monospace`, which preserves structure but may soften some of the brand's typographic character.
5. **No icons or asset directory were generated.** This output focuses on tokens, component JSON, and preview HTML, so any iconography or illustration layer would need to be supplied separately.
