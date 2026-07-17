# 21th Design System

A design system reconstruction of **21th Design Library** for an **analytics dashboard**. The system is defined by a square-first geometry, a monochrome shell, and a narrowly deployed electric blue accent that carries emphasis mostly inside charts rather than across the full interface.

The library is built for a **dashboard** kit in **light and dark** themes. Its current component set covers **button**, **card**, **input**, **sidebar navigation**, **data table**, and **chart panel** patterns.

## Overview

21th reads like an operator-facing product rather than a brand-led marketing surface. The visual foundation is almost entirely neutral: light mode runs on `#c5c9c9` page background, `#d8dada` panels, and `#111111` foreground text, while dark mode flips to `#0a0a0a` page background, `#1a1a1a` panels, and `#ffffff` text. The one strong chromatic exception is the accent blue `#0040ff`, supported by a light-mode chart ramp from `#0140ff` to `#bdcdff`.

The typography and spacing reinforce that utilitarian stance. `Geist Mono, ui-monospace, monospace` is the primary interface stack through `--font-sans` and `--font-mono`, `Geist, ui-sans-serif, sans-serif, system-ui` sits in the serif token slot, tracking is tightened to `-0.05em`, base spacing is `4px`, and the global radius token is `0px`. Shadows are not soft atmospheric depth; they are offset black marks beginning at `2px 2px 0px 0px`, making the interface feel printed, pressed, and deliberately blunt.

## Content Fundamentals

### Voice & tone

The copy style is concise, operational, and label-heavy. Most phrases are either short noun clusters such as “Overview”, “Analytics”, “Weekly Summary”, and “Signal Volume”, or direct command labels such as “Create View”, “Export CSV”, and “Pin Report”. That pattern suggests a product voice optimized for scanning in dense workflows: verbs are used when an action is required, nouns are used when orienting the user, and the interface avoids decorative language. No emoji appears in the provided copy samples, and nothing in the source material suggests conversational filler.

### Concrete copy examples

- Primary action: *“Create View”*
- Export action: *“Export CSV”*
- Search field: *“Search accounts”*
- Navigation item: *“Overview”*
- Navigation item: *“Analytics”*
- Navigation item: *“Settings”*
- Metric card: *“Weekly Summary”*
- Chart header: *“Signal Volume”*
- Chart context: *“Seven-day window”*
- Table header: *“Workspace”*
- Table header: *“Variance”*

### When generating copy

- Prefer short operator verbs for controls, following patterns like *“Create View”* and *“Export CSV”*.
- Prefer compact nouns for navigation and reporting surfaces, following patterns like *“Overview”*, *“Analytics”*, and *“Weekly Summary”*.
- Keep labels specific to analytics work: account, workspace, owner, status, variance, signal, channel, region, and date range all appear in the current component summaries.
- Do not add emoji or marketing-style flourish; the observed vocabulary stays functional and dashboard-appropriate.

## Visual Foundations

### Color

The working palette is built on restrained neutrals first. In light mode, the page background is `#c5c9c9`, the main panel surface is `#d8dada`, and the dominant text color is `#111111`. Supporting quiet text uses `#888888`. In dark mode, those values shift to `#0a0a0a` for the page, `#1a1a1a` for cards and popovers, `#333333` for secondary surfaces and borders, and `#aaaaaa` for muted text.

The accent strategy is intentionally narrow. The accent token is `#0040ff` in light mode, while the primary interface accent in dark mode collapses back into monochrome tokens such as `#222222` for `--accent` and `#ffffff` for `--primary`. That makes blue feel more special when it appears in data visualization. The light-mode chart scale runs through `#0140ff`, `#386aff`, `#6b90ff`, `#94afff`, and `#bdcdff`; the dark-mode chart set changes character and uses `#60a5fa`, `#f472b6`, `#34d399`, `#fbbf24`, and `#818cf8`. Destructive color is `#d73333` in light mode and `#ef4444` in dark mode.

The overall color mood is analytical rather than expressive. Most of the interface weight comes from black, white, and gray contrast, with blue reserved for charts and selective emphasis.

### Typography

Typography is defined more by family and tracking than by a large published scale. `--font-sans` is `Geist Mono, ui-monospace, monospace`, and `--font-mono` repeats the same stack, which makes the interface read as monospace-first. `--font-serif` is `Geist, ui-sans-serif, sans-serif, system-ui`, even though its practical role here is closer to a secondary sans fallback than a traditional serif voice.

Tracking is set to `-0.05em`, producing a compact editorial cadence across the UI. The token set does not publish font-size, font-weight, or line-height values in `css.json`, so the most reliable typography guidance in this library is family choice plus tightened spacing. In practice, the voice should stay compact, tabular, and suitable for dashboards dense with labels, metrics, and filters.

### Spacing

The base spacing token is `4px` through `--spacing: 0.25rem`. The orchestration summary explicitly calls out a compact dashboard density, and the component set supports that reading: toolbar actions, filter rows, tables, and chart panels are all framed as tight, analytical modules rather than spacious editorial cards. No secondary spacing scale is published beyond the base token, so composition should stay aligned to a strict `4px` rhythm.

### Radius

The global radius token is `0px`. This is the clearest signature in the library: shape language is square-first, corners are intentionally crisp, and the component index describes the overall system as “square-first composition with 0 radius and crisp borders.”

Implementation aliases exist in `colors_and_type.css` as `--radius-sm: calc(var(--radius) - 4px)`, `--radius-md: calc(var(--radius) - 2px)`, `--radius-lg: var(--radius)`, and `--radius-xl: calc(var(--radius) + 4px)`. Because the source radius is `0rem`, only the base reading of zero-radius corners should be treated as the design truth unless a consuming implementation deliberately clamps or overrides those derived aliases.

### Shadow / Elevation

Shadow in 21th behaves like a printed offset edge, not a blur field. The primitive tokens are `--shadow-x: 2px`, `--shadow-y: 2px`, `--shadow-blur: 0px`, `--shadow-spread: 0px`, with black as the shadow color.

The published layers are:

1. **2XS / XS:** `2px 2px 0px 0px hsl(0 0% 0% / 0.50)` — the lightest stamped edge.
2. **SM / Default:** `2px 2px 0px 0px hsl(0 0% 0% / 1.00), 2px 1px 2px -1px hsl(0 0% 0% / 1.00)` — the standard control and panel presence.
3. **MD:** `2px 2px 0px 0px hsl(0 0% 0% / 1.00), 2px 2px 4px -1px hsl(0 0% 0% / 1.00)` — a slightly deeper but still hard-edged lift.
4. **LG:** `2px 2px 0px 0px hsl(0 0% 0% / 1.00), 2px 4px 6px -1px hsl(0 0% 0% / 1.00)` — used when a panel needs stronger separation.
5. **XL:** `2px 2px 0px 0px hsl(0 0% 0% / 1.00), 2px 8px 10px -1px hsl(0 0% 0% / 1.00)` — the most expanded layered elevation.
6. **2XL:** `2px 2px 0px 0px hsl(0 0% 0% / 2.50)` — an extreme token published in the source set.

The philosophy is consistent with the orchestration summary: shadows act like keylines with force, not ambient softness.

### Borders

Borders are bright and emphatic in light mode, with `#ffffff` used for both `--border` and `--input`. In dark mode, borders shift to `#333333`, keeping edges visible without softening the square geometry. The component summaries repeatedly reinforce this pattern with phrases like “bright border”, “crisp borders”, and “strong contrast”.

### Backgrounds

Surface structure is simple and hierarchical. The page background is `#c5c9c9` in light mode and `#0a0a0a` in dark mode. Cards, popovers, muted surfaces, and sidebar panels cluster around `#d8dada` in light mode, while dark surfaces divide into `#1a1a1a` panels and `#333333` secondary planes. This makes the shell feel systematic and controlled, with little decorative variation.

### Animation

No animation tokens are defined in the available token set or orchestration summary. Motion guidance should therefore be treated as unspecified rather than inferred.

### Iconography

No icon tokens, icon files, or icon rules are defined in `available-variables.json` or the component summaries. Iconography should therefore be treated as unspecified in this version of the library.

## Component Patterns

| Component | File | Key Insight |
|---|---|---|
| Button | `preview/component-button.html` | Sharp, zero-radius action control with offset shadow and monochrome weight. |
| Card | `preview/component-card.html` | Flat analytical panel with bright border and strict spacing rhythm. |
| Input | `preview/component-input.html` | Dense field treatment with strong contrast, mono typing, and visible focus. |
| Sidebar Navigation | `preview/component-sidebar-nav.html` | A dedicated sidebar token family creates a command-center shell anchored by grayscale contrast. |
| Data Table | `preview/component-data-table.html` | A compact reporting grid uses accent sparingly and reserves red for exceptions. |
| Chart Panel | `preview/component-chart-panel.html` | The blue chart scale lives inside neutral containers so data, not chrome, carries the color emphasis. |

Across components, the same system rules repeat: `4px` spacing, `0px` radius, black offset shadows, a monochrome shell, and a blue accent that stays scarce enough to remain meaningful.

## Index

- `README.md` — this file
- `colors_and_type.css` — source token file for color, font family, radius, shadow, tracking, and spacing
- `css.json` — extracted token values in hex and structured JSON form
- `components/index.json` — component inventory and cross-component patterns
- `components/button.json` — action control summary and UI copy samples
- `components/card.json` — analytical surface summary and metric card structure
- `components/input.json` — filter and search field summary
- `components/sidebar-nav.json` — navigation shell summary
- `components/data-table.json` — reporting grid summary
- `components/chart-panel.json` — chart container summary
- `preview/component-button.html` — preview reference for button pattern
- `preview/component-card.html` — preview reference for card pattern
- `preview/component-input.html` — preview reference for input pattern
- `preview/component-sidebar-nav.html` — preview reference for sidebar navigation pattern
- `preview/component-data-table.html` — preview reference for data table pattern
- `preview/component-chart-panel.html` — preview reference for chart panel pattern

## Caveats

1. **Component specificity is reconstructed.** The orchestration summary states that the source CSS does not define component-level specs, so the current component set is reconstructed from token families and dashboard context rather than extracted from a deeper source spec.
2. **UI copy coverage is limited.** The orchestration summary warns that the English copy is intentionally generic but product-appropriate because no UI copy source was provided outside token names. All examples in this README are therefore restricted to the observed samples already present in the summary and component JSON files.
3. **Typography scale data is incomplete.** `css.json` publishes font families but does not publish font-size, font-weight, or line-height tokens, so those values should be treated as unavailable rather than guessed.
4. **Font availability may vary by runtime.** The source tokens specify `Geist Mono, ui-monospace, monospace` and `Geist, ui-sans-serif, sans-serif, system-ui`. If Geist Mono or Geist is unavailable in a target environment, the defined fallback stacks are the documented substitutions.
5. **Radius aliases need care.** The base radius token is `0rem`, while derived aliases subtract `4px` and `2px` for smaller sizes. Those aliases exist in the source CSS, but they should not be read as evidence of rounded corners in the design language.
6. **Animation and iconography are unspecified.** No animation or icon tokens are provided in the available token inventory, so any motion or icon decisions belong to downstream implementation rather than this documented source set.
