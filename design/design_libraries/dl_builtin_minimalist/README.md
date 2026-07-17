# Minimal Dashboard Design System

A design system reconstruction of **Minimal Dashboard** — a neutral, data-dense dashboard interface for analytics and operational views. The library reads as minimal, precise, and editorial rather than promotional, using tight grayscale contrast and carefully rationed color to support information hierarchy. It is best understood as a dashboard system where framing, cadence, and restraint matter more than overt brand theater.

### Source: Figma library name not provided, page count not provided, brand owner not provided.
### What this covers: Foundations with a six-family token system (`brand`, `background`, `text`, `icon` as 10-step scales plus `state-success` / `state-error`), a `#2563ef` signature-blue brand, Geist + DM Serif Display + Geist Mono typography, `25.2px` radius, `4px` spacing, 6 component families, 6 preview pages, and a sample dashboard kit at `ui_kits/dashboard/index.html`.

## Content Fundamentals

### Voice & tone

Minimal Dashboard speaks in short, operational labels rather than explanatory or aspirational phrases. The observed language is neutral, direct, and UI-native: it names views, metrics, teams, and settings without decorative verbs or motivational framing. That makes the system suitable for dense analytic contexts where labels must stay compact inside navigation, cards, tables, and sidebars. The overall tone is calm under load: precise enough for data work, but not cold enough to feel technical for its own sake.

### Concrete copy examples

- "Overview"
- "Revenue"
- "Active Users"
- "Team"
- "Settings"

### When generating copy

- Prefer short destination names and metric labels over sentence-length microcopy.
- Use concrete operational nouns for sections, views, people, and settings.
- Keep the wording professional and restrained; the system does not imply playful or emotional language.
- Write for dense interfaces where labels must survive in cards, tables, side navigation, and utility menus.

## Visual Foundations

### Color

Color is organized into six families through a two-layer token architecture: a **primitive layer** of raw scales and a **semantic layer** that maps those scales onto interface roles for light and dark themes. Four families — `brand`, `background`, `text`, and `icon` — are delivered as full **10-step scales** (`50` lightest → `900` darkest), following the perceptually-tuned convention popularized by Tailwind and Radix. The two functional states — `state-success` and `state-error` — are delivered as compact sets (`base`, `foreground`, `subtle`, `border`, `text`) rather than scales, because feedback color needs precise pairings, not a ramp.

`brand` is a refined signature blue, running from `#eff4ff` (brand-50) to `#16307f` (brand-900) with `#2563ef` (brand-600) as the identity stop. It is the system's single accent and it earns its keep everywhere emphasis is needed: primary buttons, links, active navigation, focus rings, and — most visibly — charts. The five chart stops are drawn directly from the brand scale (`brand-300/500/600/700/800`), so data visualization reads as a concentrated, deliberate release of the same hue rather than a separate palette. Structure stays quiet; insight gets the color.

Neutrals do most of the heavy lifting and are kept strictly grayscale. `background` is the surface ramp — `#ffffff` for light page/card/popover, `#f5f5f5` for muted separation, and `#0a0a0a` → `#171717` → `#262626` for dark surfaces. `text` is the ink ramp, anchored by `#0a0a0a` for foreground and softened to `#858585` for muted copy, inverting to `#fafafa` / `#a1a1a1` in dark mode. `icon` is a parallel neutral ramp for glyph fills (the bundled SVGs use `currentColor`, so they inherit it automatically).

Feedback color is sparse and intentional. `state-error` preserves the established destructive red (`#cf001c` light, `#dc2626` dark) and adds matching `subtle` / `border` / `text` tones for badges and inline alerts. `state-success` introduces a restrained green (`#16a34a` light, `#22c55e` dark) with the same structure. The sidebar remains a first-class tonal sub-system, drawing its base from `background`, its primary from `brand`, and its accents and borders from the neutral ramp. The overall mood stays minimal and precise — mostly black, white, and gray — with a confident blue carrying brand identity and analytical emphasis.

### Typography

Typography is one of the clearest places where this library creates hierarchy without adding noise. The main UI face is **Geist**, exposed as `Geist, ui-sans-serif, sans-serif, system-ui`, which suits the system’s precise and modern dashboard posture. For emphasis, the library uses **DM Serif Display**, exposed as `DM Serif Display, ui-serif, serif`; that pairing introduces a more editorial note without turning the interface into a marketing surface. For code, tabular data, or technical readouts, the mono face is **Geist Mono**, exposed as `Geist Mono, ui-monospace, monospace`.

No explicit font-size, weight, or line-height tokens were provided in the source data, so the type system is defined more by family assignment than by a published scale. Even so, the available tokens imply a clear rhythm: sans for most interface scaffolding, serif for selective emphasis, and mono for structured information. In practice, this means hierarchy should be created conservatively. The system feels strongest when typography stays quiet in everyday UI and only uses the serif face sparingly to mark featured values, editorial headings, or moments that need a slightly more authored voice.

### Spacing

Spacing is built on a `4px` base token, exposed as both `spacing` and `space-4`. That is a compact unit, and it fits the broader character of the library: dense, disciplined, and dashboard-native rather than roomy or presentation-led. With only a single explicit base token available, the safest reading is that layout rhythm should stay snapped to small increments and avoid oversized padding that would dilute the system’s restrained framing.

The source bundle does not provide a full spacing range or control height set, but the `4px` base is enough to infer the intended cadence. This is a system for tight cards, measured gutters, and compact navigation, where separation is created through repeatable increments and border structure rather than through large blocks of whitespace.

### Radius

Radius is singular and distinctive. The token output exposes `25.2px` as both `radius` and `radius-md`, which means the system currently favors one soft contour instead of a tiered corner hierarchy. In a louder visual language, that number might feel playful; here, set against monochrome surfaces and zeroed shadows, it reads as calm and polished.

- `25.2px` is the shared corner value for controls and framed surfaces when consistency matters more than semantic variation.
- `25.2px` works especially well for cards and containers that need gentle enclosure without depth-based elevation.
- `25.2px` should remain the default rounded gesture unless a product team intentionally introduces additional radius tiers outside the current token set.

### Shadow / Elevation

Elevation is intentionally suppressed. The orchestration summary notes that shadow tokens exist but are effectively zeroed for a flat look, and `css.json` confirms that `shadow-xs`, `shadow-sm`, `shadow`, `shadow-md`, `shadow-lg`, and `shadow-xl` all resolve to `0px 0px 0px 0px` with `#000000` at `0` opacity. Even the dark-theme shadow variants remain transparent. This is not an omission; it is a compositional choice. Depth is replaced by border contrast, surface tone, and spacing discipline. Cards should read as framed blocks, buttons should rely on fill contrast, and navigation should shift through weight and tone rather than lift.

### Borders

- Borders are structural, not decorative, drawn from the `background` neutral ramp: `#e5e5e5` (background-300) in light mode and `#262626` (background-700) in dark mode do much of the interface framing.
- Inputs share the same neutral border tokens, keeping form boundaries consistent with ambient structure rather than introducing a separate input tone.
- Ring values use the brand scale for a focused, on-brand focus state: `#3a81f6` (brand-500) across themes, with a neutral `#a3a3a3` sidebar ring for quieter contexts.

### Backgrounds

- Light-mode backgrounds are almost entirely paper-white, with `#ffffff` (background-50) shared across background, card, and popover.
- Muted surfaces use `#f5f5f5` (background-200), creating separation through tonal steps rather than colored panels.
- Dark-mode backgrounds move through `#0a0a0a`, `#171717`, and `#262626` (background-900 → 700), keeping tonal contrast tight and composed.

## Component Patterns

| Component | File | Key Insight |
|---|---|---|
| Button | `components/button.json` | Actions should feel dense and calm, using high-contrast fills and no decorative shadow. |
| Card | `components/card.json` | Cards should read as framed content blocks, relying on border contrast rather than depth. |
| Table | `components/table.json` | Tables should stay quietly structured, with subtle dividers and restrained state color. |
| Chart | `components/chart.json` | Charts are the only vivid accent in the system and carry most of the chromatic energy. |
| Navigation | `components/navigation.json` | Navigation should feel editorial and quiet, using spacing and weight shifts over bright fills. |
| Sidebar | `components/sidebar.json` | Sidebar is a first-class pattern with its own tonal system, not just a bordered container. |

## Index

- `colors_and_type.css` — drop-in CSS variables: a primitive layer (`brand`/`background`/`text`/`icon` 10-step scales + `state-success`/`state-error` sets), a semantic role layer for light/dark, a `--color-*` alias layer for authoring, plus typography, radius, spacing, and shadow.
- `css.json` — structured token export mirroring the same six families, with `state-*` dark variants and a `semantic.light` / `semantic.dark` role map that references the primitives.
- `components/index.json` — component index and cross-component entry point.
- `components/button.json`, `components/card.json`, `components/table.json`, `components/chart.json`, `components/navigation.json`, `components/sidebar.json` — the 6 component data files generated for this library.
- `preview/component-button.html`, `preview/component-card.html`, `preview/component-table.html`, `preview/component-chart.html`, `preview/component-navigation.html`, `preview/component-sidebar.html` — preview pages for the 6 component families.
- `ui_kits/dashboard/index.html` — sample dashboard kit page for seeing the system assembled as a fuller UI.
- `README.md` — this narrative briefing for human designers and implementers.

## Caveats / known substitutions

1. The source bundle did not provide a Figma library name, page count, or brand owner, so the source line records those fields as unavailable instead of inferring them.
2. No designer quote or rationale annotation was included in the source data, so this README does not fabricate one.
3. Font family tokens are available, but no explicit size, weight, or line-height tokens were exposed, so the typography section stays analytical rather than inventing a type ramp.
4. The orchestration summary warns that the source specification provided tokens only, and that component definitions plus UI copy were inferred from dashboard defaults; component guidance here should therefore be read as a reconstruction.
5. The library exposes a generated dashboard kit path, but the source evidence is still strongest in tokens, previews, and inferred component patterns rather than in a fully sourced authored application flow.
