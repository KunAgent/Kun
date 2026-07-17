# Goldentime Design System

A design system reconstruction of **Goldentime** — a premium dashboard language for renewal planning, executive briefings, client reporting, and workspace governance.
The system is purpose-built for data-rich interfaces that still need to read with calm editorial polish rather than hard-edged operational severity.

> *"Keep the dashboard quiet: let neutral surfaces carry the information, and reserve stronger contrast for action or urgency."*

## Source

- **Figma library:** Not provided in the shipped bundle; this README is reconstructed from the generated Goldentime library artifacts.
- **Pages:** Original page count was not included. The output set contains 6 component previews and 1 dashboard UI kit.
- **Brand owner:** Goldentime.

## What this design system covers

- **Foundations** — semantic light/dark color tokens, Fraunces-led typography, a single large radius, quiet borders, and nearly invisible elevation.
- **Components** — 6 documented patterns covering action, container, form, navigation, table, and chart storytelling.
- **Sample kit** — a dashboard UI at `ui_kits/dashboard/index.html` showing overview, analytics, and settings flows.

## Content Fundamentals

### Voice & tone

Goldentime writes like an editorial team preparing a board deck, not like a generic analytics product. Labels stay short and sentence case, while supporting copy is deliberate, calm, and slightly literary: "Morning edition", "Quarter narrative", and "Current desk" all frame dashboard moments as composed briefings. The product avoids slang, hype, and exclamation. Even alerts and destructive paths are written with restraint, using steady verbs and explicit context instead of urgency theater. The result is premium and confident, with financial and membership language softened by a narrative cadence.

### Concrete copy examples

- Top-level action: *"Publish brief"*
- Search placeholder: *"Search reports, clients, or notes"*
- Overview hero: *"The membership brief is nearly ready to circulate."*
- Analytics insight: *"Renewal momentum is increasing with more confidence than volume."*
- Guardrail copy: *"Destructive actions are isolated, plainly labeled, and never compete with the primary save path."*

### When generating copy

- Prefer editorial nouns such as "brief", "board", "narrative", "cohort", and "workspace" over generic admin wording.
- Keep controls in sentence case and make actions feel intentional: "Review brief", "Export summary", "Prepare story".
- Pair metrics with interpretive notes, not just raw numbers, so the interface always explains what changed and why it matters.
- Write destructive or sensitive actions in plain language and separate them from the primary path instead of dramatizing them.

## Visual Foundations

### Color

Goldentime is anchored by a dark cocoa primary, `#3b352b`, used for both `--primary` and core foreground text. That choice gives the system authority without pushing it into stark black-and-white contrast. The light canvas is `#fbfaf9`, shared by `--background`, `--card`, and `--popover`, which keeps the entire product in a parchment-like register. Supporting warmth comes from `--secondary` at `#9b965f`, `--accent` at `#cbc0aa`, and `--muted` at `#eae6db`. Together they produce a premium neutral field where emphasis feels curated rather than promotional.

Rather than shipping a numeric brand scale, the library uses semantic token families for surfaces, text, status, chart, and sidebar contexts. Border and input tones stay soft at `#e1dccf` and `#eae6db`, while destructive feedback is the one clear departure from the palette at `#ef4444` with `#fafafa` text. Chart color is deliberately limited to five tokens, from `#d6d5c2` through `#f79b45`, so analytics can speak with contrast without overwhelming the rest of the dashboard.

The dark theme preserves the same editorial mood instead of becoming neon or purely utilitarian. Backgrounds move to `#060201`, text to `#e3dfd6`, secondary warmth to `#605039`, and accent warmth to `#806a4d`. Even in dark mode, Goldentime stays soft, warm, and controlled.

### Typography

The typographic signature is unusually singular: both `--font-sans` and `--font-serif` resolve to **Fraunces, ui-serif, serif**. That means the entire system leans into a serif-led voice, which is the clearest premium marker in the library. Instead of splitting interface text into a neutral sans and a decorative display face, Goldentime lets the same family carry headings, labels, and longer narrative passages so the whole UI feels authored.

Tracking is set globally to `0.01em`, adding just enough polish to keep headings and labels from feeling crowded. The output does not ship a separate font-size or weight ramp in `css.json`, so the practical typography guidance comes from the UI kit itself: headlines are spacious, supportive notes are short and interpretive, and KPI text is allowed to breathe. This matches the orchestration note that the Fraunces-led system should preserve breathing room over compression.

For implementation, the fallback path is explicit: if Fraunces is unavailable, the system falls back to `ui-serif, serif`, and `monospace` remains available through `--font-mono` for code-like or utility contexts. The important design decision is not a complex type ramp; it is the commitment to a serif-first dashboard voice.

### Spacing

Spacing is anchored to `--spacing: 0.3rem`, which resolves to `4.8px`. That is a slightly softer base than a strict 4px grid, and it helps Goldentime avoid the clipped feeling common in operational dashboards. The UI kit uses this rhythm to give cards, queue items, settings panels, and chart commentary room to read as short editorial blocks instead of dense control clusters.

This is not a compressed enterprise system. The orchestration summary explicitly favors breathing room over compression, and the shipped layouts confirm that choice: hero panels, KPI groups, and table headers all sit inside generous internal padding and measured gaps. The spacing system therefore behaves less like a raw scale and more like a pacing device for premium reading.

### Radius

- **32px / `2rem`** — the global `--radius` token gives cards, buttons, inputs, and panels a deliberately softened outline that pushes the system toward hospitality rather than hard-edged finance software.
- **32px / `2rem`** — because there is only one radius token, consistency matters more than hierarchy; shape language comes from repetition, not from mixing tight and loose corners.
- **32px / `2rem`** — the large curve works because surfaces stay quiet and warm. If contrast or elevation were stronger, the same radius would feel overly plush.

### Shadow / Elevation

Goldentime ships a broad named shadow set, from `--shadow-2xs` through `--shadow-2xl`, but the philosophy is intentionally anti-dramatic. Every token uses the same base geometry of `0px 2px 4px` with `0px` spread, and in the shipped light theme the opacity is `0`. Even `--shadow-sm` adds a second `0px 1px 2px -1px` layer, but that layer is also fully transparent. In practical terms, the library encodes elevation slots without asking designers to rely on them for hierarchy.

That makes borders and surface tone do the real organizational work. Panels are separated by warm neutral contrast, not by drop-shadow theatrics. The dark theme follows the same strategy, swapping the shadow color base but still keeping opacity at `0`, so Goldentime remains quiet in both modes.

### Borders

- Borders are soft and editorial, centered on `--border: #e1dccf` and `--input: #eae6db`, which keeps divisions visible without introducing a hard grid.
- Focus contrast comes from `--ring: #3b352b`, aligning interaction emphasis with the primary text color instead of inventing a separate electric focus accent.
- The border system supports the larger radius: because lines are gentle and low-contrast, rounded components still feel composed rather than inflated.

### Backgrounds

- Light mode uses `#fbfaf9` for background, card, and popover surfaces, creating a continuous paper-like field with only subtle tonal shifts.
- Sidebar surfaces stay inside the same family, with `--sidebar: #fbfaf9` and warm supporting accents rather than a separate dark rail.
- Dark mode moves the whole surface stack to `#060201`, preserving the same low-noise hierarchy rather than flipping into high-contrast inversion.

## Component Patterns

| Component | File | Key Insight |
|---|---|---|
| Button | `preview/component-button.html` | Primary actions are intentional and board-ready, while secondary and ghost treatments stay understated enough to preserve the editorial field. |
| Card | `preview/component-card.html` | Cards act as narrative modules, not just containers, so each one is expected to hold interpretation as well as data. |
| Input | `preview/component-input.html` | Inputs are framed as focused workspace tools for search, filtering, and settings, with clarity taking precedence over compact density. |
| Sidebar Navigation | `preview/component-sidebar-navigation.html` | The sidebar behaves like a table of contents for a premium dashboard, using short nouns, grouped sections, and light account context. |
| Data Table | `preview/component-data-table.html` | Tables stay warm and restrained so structured review can coexist with the broader editorial tone of the product. |
| Chart Panel | `preview/component-chart-panel.html` | Charts are treated as narrative evidence blocks, pairing headline metrics and commentary with a tightly scoped chart palette. |

## Index

- `README.md` — this narrative briefing for human designers.
- `colors_and_type.css` — the combined CSS token source for color, type, radius, shadow, spacing, and dark mode.
- `css.json` — structured token data with hex values, font families, spacing, radius, and shadow metadata.
- `components/index.json` — the component catalog, shared CSS variables, and tone guidelines for the library.
- `components/button.json`, `components/card.json`, `components/input.json`, `components/sidebar-navigation.json`, `components/data-table.json`, `components/chart-panel.json` — per-component definitions.
- `preview/component-button.html`, `preview/component-card.html`, `preview/component-input.html`, `preview/component-sidebar-navigation.html`, `preview/component-data-table.html`, `preview/component-chart-panel.html` — visual reference cards for foundations and component behavior.
- `ui_kits/dashboard/index.html` — the full dashboard sample showing Goldentime in overview, analytics, and settings contexts.

## Caveats / known substitutions

1. **Fraunces** is the only named interface family in the shipped tokens. If it is unavailable downstream, the fallback is **`ui-serif, serif`**, which preserves the editorial direction but will reduce some of the exact premium character.
2. **Typography scale and weights** were not shipped as explicit token values in `css.json`. This README therefore documents the family, tracking, and observed usage patterns, but not a formal numeric type ramp.
3. **Original source metadata** such as the Figma library filename and page count was not included in the provided inputs. The source section above is reconstructed from the generated artifact set rather than from bundle metadata.
4. **Copy examples** were sourced from the shipped dashboard UI kit because no separate `uiCopySamples` file was provided with the inputs. The examples are real Goldentime strings, but they come from output artifacts rather than raw bundle annotations.
5. **Iconography** was not shipped as a dedicated asset set. The previews rely on initials, simple glyphs, and inline marks, so any production icon system will need to be supplied separately while preserving the same restrained tone.
6. **Elevation tokens exist but are visually quiet**: the shadow set is formally present, yet the shipped opacity is `0`, so designers should treat border, spacing, and surface color as the primary hierarchy tools.
