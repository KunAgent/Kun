# Nerv Design System

A design system reconstruction of **Nerv** — a futuristic, high-contrast monitoring dashboard brand built for operational intelligence, threat visibility, and dense technical readouts. The system is purpose-built for dashboard interfaces where status shifts, charted signals, and navigation hierarchy need to stay readable against near-black surfaces.

## Source

- **Source package:** token-only reconstruction; no original Figma filename is exposed in the current workspace snapshot.
- **Observed scope:** 54 exported CSS variables, 6 documented component JSON files, and 6 preview HTML pages covering action, container, data, chart, and navigation patterns.
- **Brand owner:** Nerv.

## What this design system covers

- **Foundations** — dual-theme color tokens, three named font families, a single exported radius token of `26.4px`, a base spacing token of `4.48px`, and a subtle shadow system built around `0px 2px 6px`.
- **Components** — 6 documented component families: Button, Card, Table, Chart, Navigation, and Sidebar.
- **Sample UI** — component previews are present in `preview/`; the orchestration summary also declares a dashboard kit target for `ui_kits/dashboard/index.html`.

## CONTENT FUNDAMENTALS

### Voice & tone

Nerv speaks in the language of command centers rather than consumer apps. Labels are short, technical, and noun-heavy: the system prefers terms like "Signal Load," "Threat Index," and "Audit Trail" over conversational phrases or promotional headlines. Actions are imperative and operational, as seen in commands such as "Launch Scan," "Acknowledge," and "Create Report." The tone is serious, compact, and unembellished. There is no evidence of emoji, playful punctuation, or soft reassurance language. Copy should feel as if it belongs inside a live monitoring surface where precision matters more than persuasion.

### Concrete copy examples

- Main navigation: *"Overview"*
- Monitoring metric: *"Signal Load"*
- Risk surface label: *"Threat Index"*
- Realtime feed module: *"Live Alerts"*
- Primary workspace label: *"Control Grid"*
- Primary action: *"Launch Scan"*
- Triage action: *"Acknowledge"*
- Reporting action: *"Create Report"*
- Chart title: *"Traffic Pulse"*
- Sidebar destination: *"Audit Trail"*

### When generating copy

- Prefer compact labels of one to three words, usually in title case.
- Use operational nouns and verbs: scan, control, alerts, incidents, status, trail, index, pulse.
- Keep actions directive and immediate; avoid polite helper phrasing such as "Please review" or "Would you like to..."
- Write for expert users who already understand the monitoring context; do not over-explain common dashboard concepts.
- Avoid emoji, marketing superlatives, and lifestyle language.

## VISUAL FOUNDATIONS

### Color

Nerv is built on a dark-first palette even when the exported base layer is stored in `:root`. The working background starts at `#0f0f10`, with adjacent surfaces at `#111112`, `#191b1e`, and `#1d1e20`, producing a tightly compressed charcoal range rather than a broad gray ladder. That tight neutral range is what gives the interface its editorial severity: panels feel stacked and distinct, but never soft.

The brand primary in the base token layer is `#ea343a`, a hot red that reads as alert, signal, and escalation rather than warmth. In the `.dark` theme, that role shifts to `#ff99cc`, turning the brand expression toward pink neon. This theme split is unusual and brand-specific: Nerv does not use one immutable accent, but a controlled red-to-pink shift depending on theme context. Supporting accents expand the system into technical-spectrum territory with `#5938ff`, `#94bdff`, `#e070ff`, and `#dbf4ff` in the primary chart palette, then `#14eb14`, `#73d6ff`, `#ffff00`, and `#ffcc00` in dark-mode charts. The result is a dashboard that treats data color as instrumentation, not decoration.

Semantic color is sparse and direct. Danger is fixed at `#ff3434`, reinforcing the system's alert posture. Informational emphasis is handled by relationship to the brand and chart colors rather than a separate neutral blue semantic lane. Sidebar tokens form their own hierarchy: `#1a1a1a` for the shell, `#cfd2dd` for text, `#ffc0cb` for highlighted primary elements, and `#ea343a` for accent moments in the base layer. In dark mode, those sidebar accents shift to `#ff99cc` and `#73d6ff`, keeping wayfinding energetic against `#181c25`.

Overall, the color vibe is not enterprise-neutral. It is dark neon editorial: hot red and pink are used like warning beacons, cyan and violet behave like telemetry lights, and the narrow charcoal foundation keeps the whole system feeling technical, cinematic, and high-stakes.

### Typography

Nerv uses **Geist** as the primary interface face through `--font-sans`, with the fallback stack `ui-sans-serif, sans-serif, system-ui`. Geist is a good fit for the brand because it keeps labels crisp and modern without introducing humanist softness. **Aleo** is exported as `--font-serif`, giving the system a controlled serif contrast that can be reserved for special numerics, editorial callouts, or intelligence-summary moments where the dashboard wants a slightly more authored tone. **Roboto Mono** is the dedicated technical face, clearly intended for code-like readouts, node IDs, numeric telemetry, or tabular values that benefit from fixed character rhythm.

The available token package does not expose explicit typography scale tokens for size, weight, or line-height: `/workspace/.design_library/Nerv/css.json` shows empty `size`, `weight`, and `lineHeight` groups. That absence matters. It means the library defines family and tone, but not a complete typographic ramp. In practice, the copy samples and component set point to compact dashboard sizing rather than oversized display typography. Labels are short, metrics are expected to be high-contrast, and the mono face should be used selectively for precision moments rather than for full paragraphs.

For substitution, **Geist** can fall back to **Inter** when unavailable without materially changing the system's sharpness. **Aleo** can fall back to **Source Serif 4** or a comparable contemporary serif for isolated emphasis moments. **Roboto Mono** can fall back to **JetBrains Mono** or the generic `monospace` stack while preserving the intended technical cadence.

### Spacing

The base spacing token is `4.48px`, exported from `--spacing: 0.28rem`. That is an unusually fine-grained unit, and it explains why Nerv feels dense rather than spacious. A dashboard built on `4.48px` produces tight stacking increments of `8.96px`, `13.44px`, `17.92px`, `22.4px`, and `26.88px` through the alias layer's `--space-2` to `--space-6`. This is not a soft card layout system meant for marketing pages. It is a compact rhythm tuned for control clusters, KPI groupings, and layered data panels where more information must fit above the fold.

Because the token export contains only the base unit and derived aliases, spacing should be used as a proportional rhythm rather than rounded off into a generic `4px` or `8px` system. Nerv's density is part of its identity.

### Radius

- **`26.4px`** — the canonical exported radius token in `/workspace/.design_library/Nerv/css.json`; it defines the system's softened shell language across cards, buttons, and major panels.
- **`13.2px`** — implementation helper exposed as `--radius-sm` in `/workspace/.design_library/Nerv/colors_and_type.css`; derived from the source token rather than exported independently.
- **`19.8px`** — implementation helper exposed as `--radius-md`; also derived, not a native source token.

This radius strategy is what keeps Nerv from becoming purely brutalist. The colors are severe and the copy is terse, but the corners are notably rounded. That contrast creates a silhouette that feels futuristic rather than militaristic: hard data, soft edge geometry.

### Shadow / Elevation

Nerv keeps elevation close to the surface. The system does not rely on deep blur or dramatic lift. Instead, most named shadows are variations on a shared geometry of `0px 2px 6px 0px`.

1. **`shadow-xs` / `shadow-2xs`** — `0px 2px 6px 0px` with `#242523` at `0.05` opacity in the base theme. Used when separation is needed without obvious lift.
2. **`shadow-sm` / `shadow` / `shadow-md`** — the same core `0px 2px 6px` ambient layer plus a secondary tighter layer at `0.10` opacity. This is the default working elevation for panels and controls.
3. **`shadow-lg` / `shadow-xl` / `shadow-2xl`** — still restrained, increasing secondary spread rather than switching to theatrical blur. Even the strongest token stays disciplined and technical.

The philosophy is clear: elevation should clarify stacking order, not soften the product. Nerv wants surfaces to feel engineered and proximate.

### Borders

- Borders are critical to structure because the neutral palette is tightly compressed; `#303136` in the base theme and `#444444` in dark mode do much of the work of separating modules.
- Inputs use `#444650` in the base layer, which is slightly brighter than the border token and helps form fields stay visible without glowing.
- Sidebar boundaries become even darker at `#0d0d0d`, reinforcing a rail-like shell around navigation.

### Backgrounds

- Surface layering stays within a narrow band from `#0f0f10` to `#1d1e20`, so background changes are subtle and structural.
- The dark theme broadens slightly to `#181c25` and `#2e3537`, allowing pink and cyan accents to read more vividly.
- Popovers are not dramatically lighter than cards; they remain within the same tonal family, which prevents overlays from feeling disconnected from the dashboard shell.

### Animation

- No motion tokens are exported, which suggests animation is not a primary identity carrier in the token package.
- Interaction feedback should therefore come from contrast shifts, border emphasis, and accent color transitions rather than spring-heavy choreography.
- Any future motion should stay fast, directional, and utility-first to match the monitoring context.

### Iconography

- No icon assets are present in the current workspace snapshot, so the visual language has to be inferred from the dashboard tone rather than from a supplied icon set.
- The brand supports sharp, technical iconography: line-based marks, compact status glyphs, and geometric wayfinding symbols will fit the system best.
- Avoid playful rounded pictograms or overly detailed skeuomorphic icons; they would conflict with the terse copy and dense paneling.

## Component Patterns

| Component | File | Key Insight |
|---|---|---|
| Button | `preview/component-button.html` | Rounded actions pair hot accent emphasis with terse command labels such as "Launch Scan." |
| Card | `preview/component-card.html` | Cards are the main dashboard module: dark shells, bright metrics, and compact eyebrow labeling. |
| Table | `preview/component-table.html` | Tables keep separators quiet and use accent or destructive states only when records need triage attention. |
| Chart | `preview/component-chart.html` | Charts are where Nerv becomes most neon, using pink, cyan, violet, and yellow as telemetry signals against dark surfaces. |
| Navigation | `preview/component-navigation.html` | Navigation uses thin rails and active accent markers rather than bulky tabs or oversized chrome. |
| Sidebar | `preview/component-sidebar.html` | Sidebar hierarchy is driven directly by the dedicated sidebar token family, with active states treated as luminous anchors. |

## Index

- `README.md` — this file.
- `colors_and_type.css` — CSS variables for color, type, radius, shadow, and spacing.
- `css.json` — structured JSON token export with exact hex, radius, spacing, and shadow values.
- `components/index.json` — component index plus cross-component patterns.
- `components/button.json` — action component anatomy, variants, and UI copy samples.
- `components/card.json` — container component anatomy and dense dashboard card structures.
- `components/table.json` — data display patterns for operational rows and alert states.
- `components/chart.json` — chart structures backed directly by chart color tokens.
- `components/navigation.json` — top and section navigation patterns for dashboard wayfinding.
- `components/sidebar.json` — sidebar-specific anatomy and active-state hierarchy.
- `preview/` — component preview HTML pages for the documented families.
- `ui_kits/dashboard/index.html` — declared dashboard kit target in the orchestration summary; not present in the current workspace snapshot.
- `SKILL.md` — companion agent manifest in a full library build; not included in this task snapshot.

## Caveats / known substitutions

1. **Geist**, **Aleo**, and **Roboto Mono** may not be installed in every runtime environment. Substitute **Inter** for Geist, **Source Serif 4** for Aleo, and **JetBrains Mono** or `monospace` for Roboto Mono when necessary.
2. **Component structures are partly inferred.** The source warning states: "Source file provided tokens only; component structures were inferred from the token system and dashboard scope."
3. **Typography ramp data is incomplete.** The current token export does not include explicit size, weight, or line-height tokens, so only font-family intent can be documented with certainty.
4. **Icon assets are missing.** No `assets/` icon package is present in the current workspace snapshot, so icon style guidance is inferred from the palette and product type rather than from source files.
5. **The dashboard UI kit is declared but absent.** `ui_kits/dashboard/index.html` appears in the orchestration summary but is not present in `/workspace/.design_library/Nerv/` at the time of writing.
