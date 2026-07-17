# Vibecamp Design System

A design system reconstruction of **Vibecamp** — an editorial, data-heavy dashboard product with a strong day/night mood shift.
The system is purpose-built for dashboards that need to feel both operational and expressive, with enough contrast to support analytics, schedules, check-ins, and community views without sliding into generic enterprise chrome.

## Source

- **Figma library:** Source filename was not exposed in the reconstruction inputs; this README is derived from the generated Vibecamp library artifacts and orchestration summary.
- **Pages:** Page count and top-level frame count were not exposed. Product context was inferred from artifact names, token semantics, and component content such as sidebar, chart, sessions, and check-in views.
- **Brand owner:** Vibecamp.

## What this design system covers

- **Foundations** — a brand-first dual-theme color system with semantic tokens plus compatibility aliases, three font families, a 4px spacing base, a single 18px radius, and intentionally quiet shadow tokens.
- **Components** — 6 documented component categories across action, container, data display, data visualization, and navigation patterns.
- **Sample previews & UI kit** — component preview HTML files for buttons, cards, tables, charts, navigation, and sidebar patterns, plus a dashboard kit target in `ui_kits/dashboard/index.html`.

## CONTENT FUNDAMENTALS

### Voice & tone

Vibecamp speaks in a direct product voice that is functional first, but not cold. The copy is short, dashboard-native, and biased toward labels, status, and action prompts rather than marketing lines. Even when the system becomes more editorial through typography and contrast, the wording stays plain: section names such as "Overview", "Sessions", "Community", and "Analytics" are matter-of-fact and operational. CTA language also stays concrete. Instead of abstract verbs, the interface prefers task language like "Create Session", "Publish Update", "Open Workspace", and "Manage Roles". There is no evidence of emoji, playful punctuation, or casual social phrasing in the extracted bundle, so generated copy should remain crisp, neutral, and product-facing.

### Concrete copy examples

- Main navigation: *"Overview"*
- Section navigation: *"Sessions"*
- Main navigation: *"Community"*
- Main navigation: *"Analytics"*
- Utility area: *"Settings"*
- Primary CTA: *"Create Session"*
- Publishing CTA: *"Publish Update"*
- Secondary CTA: *"Open Workspace"*
- Admin CTA: *"Manage Roles"*
- Data card: *"Active Sessions"*
- Data card: *"Community Pulse"*
- Data card: *"Peak Attendance"*
- Table headers: *"Stage", "Capacity", "Host", "Status"*
- Sidebar navigation: *"Dashboard", "Check-ins", "Channels"*

### When generating copy

- Prefer noun-led labels and explicit task verbs over slogans.
- Keep interface language short enough to work inside dense dashboard shells.
- Use copy that sounds like a tool for operators, coordinators, or program managers, not a consumer social app.
- Avoid emoji, hype language, and broad inspirational claims unless a future source bundle proves otherwise.
- When writing data states, pair the metric with a plain qualifier, as in "Updated 2m ago", "Sync queued", or "Low noise".

## VISUAL FOUNDATIONS

### Color

Vibecamp's color system now starts with a dedicated **brand first-position ten-step scale**: **`--brand-50`** through **`--brand-900`**. The core remains the familiar hot orange-red **`#f1481e`** at **`--brand-600`**, so the brand keeps its urgent, tactile, editorial attitude instead of drifting toward a safer tech blue. The token organization is closer to modern systems such as **Ant Design** and **shadcn**: a stable brand ramp sits underneath a semantic layer covering `background`, `card`, `popover`, `muted`, `foreground`, `primary`, `secondary`, `accent`, `input`, `border`, `ring`, `destructive`, `sidebar-*`, and `chart-*`.

That semantic layer is implemented as a compatibility upgrade rather than a reset. Light and dark themes now expose the common semantic tokens directly, while the legacy aliases such as **`--bg-background`**, **`--text-foreground`**, and **`--accent-primary`** remain available so existing previews, UI kit screens, and component references can keep working without a broad rewrite. Light mode still sits on warm industrial neutrals, now slightly tightened into a more coherent surface stack; dark mode stays in a brown-charcoal family and simply maps `--primary` to a brighter brand step for better contrast.

The supporting palette still behaves like Vibecamp rather than generic dashboard chrome. Charts continue to mix warm and digital accents, destructive remains anchored by **`#ef4444`**-style alert red, and sidebar tokens keep a heavier shell presence. Overall, the system now reads as a more mature theme architecture while preserving Vibecamp's warm-neutral base, high contrast, and orange-red editorial charge.

### Typography

Vibecamp uses three named families, and each one has a clear job. **Geist** is the primary UI face through `--font-sans`, and it carries navigation, body copy, buttons, and most operational text. **Playfair Display** is available as `--font-serif`, introducing a more editorial register that can be used for contrast moments, campaign framing, or hero-like numerics when the product wants personality. **Roboto Mono** appears as `--font-mono`, and the previews use mono styling for compact labels, eyebrows, and small metadata cues that need a coded or systems-oriented tone.

The extracted tokens do not expose a formal type ramp, weight scale, or line-height set in `css.json`, so this reconstruction cannot truthfully claim canonical sizes like display, title, or body tiers. What the preview files do show is a practical operating range: button labels at **13px/1**, body copy around **12px–14px**, metadata around **10px–11px**, and uppercase mono labels with widened tracking around **`.08em`**. The typography system therefore reads as compact and disciplined in execution, but incomplete as a tokenized scale. If a production team needs a locked type spec, it will need to be recovered from the source design file rather than this bundle alone.

### Spacing

The spacing base is **4px** via `--spacing: 0.25rem`, and the components consistently build from that unit rather than from arbitrary jumps. Previews use multiples like 6px, 8px, 12px, 16px, and 18px-equivalent padding combinations, which makes the system feel aligned without becoming cramped. The density is not ultra-compact enterprise density. Buttons use a **40px** minimum height for primary and secondary actions, while the ghost button drops to **32px**. Cards and sidebars lean on generous internal padding derived from the 4px base, so the system favors readability and shape over maximum information compression.

### Radius

Vibecamp is built around one dominant radius value: **18px**. That is large enough to make every component feel soft and chunky, but because the rest of the system is high-contrast and operational, the softness reads as intentional character rather than casual friendliness.

- **18px** — primary buttons, secondary buttons, cards, sidebars, and shell surfaces.
- **10px** — derived inner treatment in sidebar items through `calc(var(--radius) - 8px)`, creating a tighter nested geometry inside an already soft outer frame.
- **999px** — used only for tiny dot indicators in previews, functioning as a utility circle rather than a foundation radius token.

The important pattern is consistency. Vibecamp does not show a multi-radius philosophy for different component families. It shows one strong corner signature repeated across the system.

### Shadow / Elevation

Vibecamp exposes a full shadow naming ladder from **`--shadow-2xs`** through **`--shadow-2xl`**, but the philosophy is deliberately anti-dramatic. In light mode the base shadow color is **`#95959d`** at **0 opacity**; in dark mode it becomes **`#000000`** at **0 opacity**. Representative values such as **`2px 2px 10px 4px rgba(149, 149, 157, 0)`** and **`2px 2px 10px 4px rgba(0, 0, 0, 0)`** technically exist, but visually they disappear.

That means hierarchy is created by color blocking, border contrast, and radius silhouette rather than by floating cards. This is consistent with the editorial-utilitarian mix: surfaces feel placed, not lifted. If elevation needs to increase in future implementations, it should do so very carefully, because visible shadow would materially change the product's current tone.

### Borders

- Borders are quiet but omnipresent, anchored by **`#cfcfcf`** in light mode and **`#3a3633`** in dark mode.
- Inputs and shells rely on border contrast more than on fill contrast to define structure.
- Sidebar-specific borders use **`#d6d3d1`** in light mode, reinforcing the warm-neutral palette instead of default gray UI chrome.

### Backgrounds

- Light mode background **`#e0e0e0`** is noticeably darker than pure white, which prevents the dashboard from feeling sterile.
- Card surfaces move lighter to **`#f2f2f2`**, while popovers move to **`#f5f5f4`**, creating subtle but readable layering.
- Dark mode stays in a brown-charcoal family rather than a blue-black family, with **`#1e1b18`** and **`#2c2825`** carrying most of the shell.

### Animation

- No motion tokens were exposed in the bundle.
- Preview files use short transitions around **`.16s`** for hover, color, border, and slight transform changes.
- Motion should therefore stay brisk and low-theater, supporting control feedback rather than spectacle.

### Iconography

- No exported icons were included in the available variables for this library.
- Preview files use simple dots, text initials, and structural placeholders instead of a branded icon set.
- Any production iconography should match the system's high-contrast, low-decoration approach and avoid thin, delicate strokes that would feel out of place beside 18px corners.

## Component Patterns

| Component | File | Key Insight |
|---|---|---|
| Button | `preview/component-button.html` | Primary actions feel tactile because a hot accent sits inside a large 18px silhouette, while ghost actions stay lean at 32px height. |
| Card | `preview/component-card.html` | Cards are warm, padded, and editorial, using neutral surfaces and restrained borders instead of sterile white blocks. |
| Table | `preview/component-table.html` | Table patterns balance roomy spacing with muted dividers so dense operational data stays readable. |
| Chart | `preview/component-chart.html` | Charts inherit the brand palette directly, especially through warm light-mode accents and blue-violet dark-mode scales. |
| Navigation | `preview/component-navigation.html` | Top-level navigation uses dark structure and compact labels to keep orientation strong without overpowering the content area. |
| Sidebar | `preview/component-sidebar.html` | Sidebar is a first-class brand surface, supported by dedicated sidebar tokens rather than generic shell styling. |

## Index

- `README.md` — this file.
- `SKILL.md` — agent entry point for using the Vibecamp design library as a skill.
- `colors_and_type.css` — combined CSS variables for the brand scale, semantic color tokens, compatibility aliases, typography, spacing, radius, and shadows.
- `css.json` — structured token export for programmatic consumption.
- `components/index.json` — component index plus cross-component patterns.
- `components/button.json` — button anatomy, variants, copy examples, and token references.
- `components/card.json` — card structures and content patterns.
- `components/table.json` — table structures and density patterns.
- `components/chart.json` — chart structures and palette usage.
- `components/navigation.json` — top navigation, tabs, and segmented navigation patterns.
- `components/sidebar.json` — sidebar structures and shell-specific token usage.
- `preview/component-button.html` — button preview.
- `preview/component-card.html` — card preview.
- `preview/component-table.html` — table preview.
- `preview/component-chart.html` — chart preview.
- `preview/component-navigation.html` — navigation preview.
- `preview/component-sidebar.html` — sidebar preview.
- `ui_kits/dashboard/index.html` — dashboard UI kit target for a fuller click-through reference.

## Caveats / known substitutions

1. **Product context** is partly inferred rather than fully declared. The strongest evidence comes from artifact names and token semantics such as `sidebar`, `chart`, session-related labels, and dashboard-oriented preview content.
2. **Typography tokens are incomplete.** The bundle names the families **Geist**, **Playfair Display**, and **Roboto Mono**, but it does not expose a formal size, weight, or line-height scale in `css.json`. Any detailed type ramp would be a reconstruction, not an observed fact.
3. **Font availability may vary by runtime.** If **Geist** is unavailable, substitute **Inter** or a close modern grotesk for UI text. If **Playfair Display** is unavailable, substitute **Georgia** only for editorial contrast moments, not for core UI. If **Roboto Mono** is unavailable, substitute a system monospace stack such as **ui-monospace**, **SFMono-Regular**, or **Consolas**.
4. **Shadow tokens exist but are visually silent.** The current library documents them as-is because opacity is explicitly `0`; raising opacity would change the brand's tone and should be treated as a design decision, not a cleanup.
5. **No icon set was provided.** Any future icon layer should be treated as a substitution and designed to match the system's solid, high-contrast character.
6. **The generated artifact list references `SKILL.md` and `ui_kits/dashboard/index.html`, but those files were not available for direct inspection during this README pass.** They are included here because they are part of the requested output contract for the library.
