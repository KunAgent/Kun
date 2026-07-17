# Google Design System

A design system reconstruction of **Google** as a compact, analytical dashboard language.
The system is purpose-built for reporting-heavy product surfaces where metrics, campaign state, and performance summaries need to feel immediate without looking noisy.

## Source

- **Figma library:** Original library filename is not preserved in the generated artifacts.
- **Pages:** The current artifact set preserves token and component outputs, but not raw page or top-level frame counts.
- **Brand owner:** Google

## What this design system covers

- **Foundations** — dual-theme color tokens, typography families, radius, spacing, border behavior, and flat elevation rules.
- **Components** — 6 documented dashboard components: Button, Card, Table, Chart, Navigation, and Sidebar.
- **Sample UI kit** — `ui_kits/dashboard/index.html`, a dashboard-focused reference shell for data-dense layouts.

## CONTENT FUNDAMENTALS

### Voice & tone

The verbal layer is concise, operational, and distinctly product-facing. Labels read like dashboard controls rather than marketing copy: short nouns for destinations, direct metric names for reporting blocks, and clear action verbs for utilities. The tone is modern but restrained, with almost no decorative flourish. It feels analytical first, supportive second. There is no evidence of conversational filler, no playful punctuation, and no emoji usage. This is interface copy that assumes the user is here to inspect performance, compare outcomes, and act quickly.

### Concrete copy examples

- Navigation label: *"Overview"*
- Reporting label: *"Performance"*
- Metric summary: *"Active campaigns"*
- KPI label: *"Conversion rate"*
- Utility action: *"Export report"*

### When generating copy

- Prefer short title-case labels over sentence-style microcopy for navigation and summaries.
- Name the business concept directly: metrics, campaigns, performance, reports, and conversion outcomes should stay explicit.
- Use one dominant verb for each utility action, as in *Export report*, rather than soft phrasing.
- Keep supporting text neutral and factual; the interface should sound precise, not promotional.

## VISUAL FOUNDATIONS

### Color

This system uses a familiar Google-adjacent light palette in day mode, then pivots to a more aggressive accent strategy in dark mode. In light mode the brand primary is **`#4285f4`**, used for key actions, rings, chart emphasis, and sidebar activation. It is paired with a pale supporting blue **`#dbeafe`** for secondary and accent surfaces, which keeps dashboard states active without becoming loud. The working neutrals are bright and efficient: **`#ffffff`** for page and card surfaces, **`#f9f9fa`** for popovers, **`#eff1f4`** for muted fills, **`#ebebeb`** for borders, and **`#0e1115`** for primary text. This gives the interface a white-paper clarity that suits reporting dashboards.

Dark mode deliberately changes character instead of simply inverting the light theme. The primary accent shifts to **`#fc2c50`**, with **`#4a2026`** as its dark accent bed, while the page foundation rests on **`#161616`** and **`#1d1d1c`**. Supporting dark neutrals include **`#383838`** for muted and secondary blocks, **`#949494`** for muted text, and **`#ffffff`** for the focus ring. The result is more editorial and more high-contrast than the light theme, giving charts and urgent actions stronger visual charge.

Data visualization is where the palette opens up. In light mode, charts draw from **`#4285f4`**, **`#ea4335`**, **`#fbbc05`**, **`#0043ad`**, and **`#34a853`**, directly echoing a recognizable Google-style multicolor language. In dark mode, the chart palette becomes more electric: **`#2dccd3`**, **`#f1204a`**, **`#edbbe8`**, **`#fbeb35`**, and **`#baf6f0`**. This contrast matters: the rest of the system stays quiet so visualizations can carry the strongest color energy.

The overall color mood is clean, analytical, and modern. Light mode feels crisp and systematic; dark mode feels more branded and expressive. In both modes, the palette avoids warmth in backgrounds and uses color as a targeted signal rather than a constant decorative layer.

### Typography

The primary face is **DM Sans**, exposed through both `--font-sans` and `--font-serif`, which indicates the system does not actually distinguish between editorial and UI serif roles in the current token set. DM Sans is doing the work of interface labeling, dashboard summaries, and general product copy. Its rounded geometry softens the otherwise strict dashboard grid without undermining clarity.

For data-heavy or code-like details, the system uses **JetBrains Mono** via `--font-mono`. That pairing is useful in dashboards: DM Sans keeps navigation and summaries approachable, while JetBrains Mono can stabilize tabular numbers, dense labels, or technical metadata. Fallbacks are explicit rather than abstract: `ui-sans-serif`, `sans-serif`, and `system-ui` back up DM Sans, while `monospace` backs up JetBrains Mono.

Typography metadata is intentionally sparse in the generated token set. No explicit font-size scale, weight set, or line-height ladder is preserved in `css.json`, and tracking is fixed at **`0em`** through `--tracking-normal`. The practical reading is that font family is the primary typographic decision here, while sizing appears to be handled at the component layer rather than as a documented global type ramp.

### Spacing

Spacing is anchored to a micro-unit of **`3.84px`** via `--spacing: 0.24rem`. That is unusually fine-grained for a dashboard system and suggests an interface designed for dense reporting surfaces where small adjustments matter. Instead of relying on a blunt 4px or 8px-only rhythm, this token allows tighter tuning of chart gutters, data rows, navigation padding, and utility controls.

There is no full published spacing ladder in the current artifact set, but the single spacing token is enough to establish the character of the system: compact, tuned, and information-forward. Layouts should feel measured rather than airy.

### Radius

Radius is centered on a single baseline token: **`8px`**. That number gives the system a softened modern feel without pushing it into a card-heavy consumer aesthetic. The alias layer derives a small family from that baseline: **`4px`** (`--google-radius-sm`), **`6px`** (`--google-radius-md`), **`8px`** (`--google-radius-lg`), and **`12px`** (`--google-radius-xl`). Even with those derivations, the visual message remains consistent: corners are softened, but structure is preserved.

In practice, **8px** is the key signature. It makes cards, buttons, and dashboard containers feel contemporary while still compatible with dense enterprise layouts. This is not a sharp-cornered system, but it is also not pill-driven by default.

### Shadow / Elevation

The system defines a large alias family for elevation, but almost all of it is intentionally silent. `--shadow-2xs`, `--shadow-xs`, `--shadow-sm`, `--shadow`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`, and `--shadow-2xl` all resolve to transparent shadows because the shadow color opacity is **`0`** in both themes. Even where the primitives specify a **`3px`** y-offset, the visual result is effectively flat.

This means hierarchy is not communicated by blur or lift. It is communicated by tone, border, sectioning, and selective color contrast. That is a strong dashboard choice: it keeps data surfaces crisp and prevents stacked cards from becoming muddy. Elevation here exists as a structural API, not as a visible visual style.

### Borders

- Light mode borders use **`#ebebeb`**, with inputs at **`#e2e3e4`** and sidebar borders at **`#e7eaef`**.
- Dark mode collapses border contrast into the surface family, using **`#1d1d1c`** for general borders and **`#404040`** for sidebar structure.
- The ring color is a primary state signal: **`#4285f4`** in light mode and **`#ffffff`** in dark mode.
- Borders do the work that shadows do not; use thin separators generously to preserve scanability in dense layouts.

### Backgrounds

- Light mode is dominated by **`#ffffff`** and **`#f9f9fa`**, which makes charts and calls to action read sharply.
- Muted surfaces at **`#eff1f4`** provide low-contrast grouping without introducing a second strong hue.
- The sidebar has its own pale shell in light mode at **`#f0f6ff`**, creating a subtle workspace frame.
- Dark mode relies on **`#161616`**, **`#1d1d1c`**, and **`#171717`**, keeping the shell cohesive while reserving saturated color for charts and active states.

### Animation

- No motion tokens are preserved in the generated artifacts, so animation should stay minimal and utilitarian.
- Because focus is carried by border, ring, and color changes, transitions should emphasize opacity, color, and small background shifts rather than large movement.
- Dense dashboards built on this system should feel immediate; motion should confirm state, not compete with data.

### Iconography

- No icon asset set is included in the current library output, so icon style must be inferred from the surrounding UI language.
- The flat visual model suggests simple, geometric, low-stroke-complexity icons rather than ornamental illustrations.
- Active and focus states should align with **`#4285f4`** in light mode, **`#0065fd`** in the dark sidebar context, and **`#ffffff`** for dark-mode ring emphasis when needed.

## Component Patterns

| Component | File | Key Insight |
|---|---|---|
| Button | `preview/component-button.html` | Actions stay crisp and flat, with color carrying emphasis instead of elevation. |
| Card | `preview/component-card.html` | Cards rely on border and tonal contrast more than depth, keeping containers low-noise. |
| Table | `preview/component-table.html` | Dense information remains readable through muted text and clear row separation. |
| Chart | `preview/component-chart.html` | Charts are the strongest color moments and should stand out against restrained surfaces. |
| Navigation | `preview/component-navigation.html` | Navigation is subdued; active state and focus ring provide the key cues. |
| Sidebar | `preview/component-sidebar.html` | A dedicated sidebar palette turns navigation into a branded workspace shell. |

Across components, three cross-patterns define the system. First, prefer flat surfaces and thin borders before adding any sense of lift. Second, use the strongest primary color for one dominant action or focal visualization per region. Third, maintain dense layouts with compact spacing and quiet text, then use accent contrast only where decisions need to happen.

## Index

- `README.md` — this file
- `colors_and_type.css` — CSS variables for color, typography families, radius, shadow aliases, and spacing
- `css.json` — structured token export for programmatic consumption
- `components/index.json` — component index, summary, and cross-component patterns
- `components/button.json` — action component analysis
- `components/card.json` — container component analysis
- `components/table.json` — data display component analysis
- `components/chart.json` — data visualization component analysis
- `components/navigation.json` — top-level navigation analysis
- `components/sidebar.json` — workspace shell navigation analysis
- `preview/` — small HTML previews for each documented component
- `ui_kits/dashboard/index.html` — full dashboard reference UI
- `SKILL.md` — expected skill manifest in the standard library structure; not present in the current artifact set

## Caveats / known substitutions

1. **DM Sans** and **JetBrains Mono** are named in the token set, but no font files are bundled here. The system therefore relies on installed fonts or browser fallbacks such as `ui-sans-serif`, `system-ui`, and `monospace`. This may slightly change metrics and wrapping.
2. The current artifacts preserve **font family**, **radius**, **spacing**, and **color tokens**, but do not preserve a full **type scale**, **weight map**, or **line-height system**. Any production implementation will need to infer or define those values at the component level.
3. The original **Figma filename, page count, and frame count** were not retained in `orchestration-summary.json`, so this README describes the generated library rather than a full source-document audit.
4. **Shadow tokens** exist structurally, but their opacity is **0** in both themes. Any visible elevation seen in downstream implementations should be treated as a local adaptation, not a canonical foundation rule.
5. **Icon assets** are absent from the current output. Until an asset set is added, iconography should be implemented as simple geometric SVGs that match the flat, analytical dashboard language.
6. **SKILL.md** is listed in the expected library structure but is not currently present in `/workspace/.design_library/google`. This README therefore serves as the primary narrative reference for the library at this stage.
