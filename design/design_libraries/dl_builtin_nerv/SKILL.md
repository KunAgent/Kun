---
name: nerv-design
description: Use this skill to generate well-branded interfaces and assets for Nerv — a futuristic, high-contrast operational dashboard brand. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping dashboard UIs.
user-invocable: true
---

# Nerv Design Skill

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts such as mocks, prototypes, previews, or dashboard concepts, copy assets out and create static HTML files for the user to view. If working on production code, use the rules here and the token files to stay on-brand.

If the user invokes this skill without any other guidance, ask what they want to build, clarify the target surface, and act as an expert designer who can output either HTML artifacts or production-ready UI code.

## Quick map

- `README.md` — brand context, narrative guidance, and usage caveats
- `colors_and_type.css` — drop-in CSS variables for color, typography, radius, shadow, and spacing
- `css.json` — structured token export with exact hex, radius, spacing, font, and shadow values
- `components/index.json` — component index plus cross-component patterns for the system
- `components/button.json`, `components/card.json`, `components/table.json`, `components/chart.json`, `components/navigation.json`, `components/sidebar.json` — per-component anatomy, variants, and UI copy cues
- `preview/component-button.html`, `preview/component-card.html`, `preview/component-table.html`, `preview/component-chart.html`, `preview/component-navigation.html`, `preview/component-sidebar.html` — focused HTML previews for each component family
- `ui_kits/dashboard/index.html` — full dashboard UI kit reference for layout, hierarchy, and density

## Essentials at a glance

- Primary accent is hot alert red `#ea343a` in the base theme and flips to pink `#ff99cc` in dark mode; Nerv should feel urgent and synthetic, not calm or corporate.
- Core surfaces stay nearly black: background `#0f0f10`, card `#111112`, sidebar `#1a1a1a`; darker alternate surfaces shift to `#181c25` and `#2e3537` to keep the dashboard nocturnal.
- Radius is `1.65rem` (`26.4px`) everywhere important; the system is intentionally oversized and softened to create a sci-fi console silhouette instead of hard enterprise corners.
- Spacing starts at `0.28rem` (`4.48px`); default layouts should feel compact, operational, and data-dense rather than roomy or editorial.
- Fonts are explicit: `Geist` for interface copy, `Aleo` for serif contrast moments, and `Roboto Mono` for telemetry, metrics, and technical labels.
- Shadows stay whisper-light and close to the plane: `0 2px 6px` with `0.05-0.10` opacity; elevation exists, but it should never make panels feel fluffy or card-heavy.
- Data color is deliberately electric: `#5938ff`, `#94bdff`, `#e070ff`, and `#dbf4ff` support charts in the base palette, while dark mode adds `#14eb14`, `#73d6ff`, `#ffff00`, and `#ffcc00` for vivid signal contrast.
- Navigation is a signature pattern: dark rails pair with `sidebar-primary` pink `#ffc0cb` or `#ff99cc`, plus cyan accent `#73d6ff`, to mark active hierarchy with immediate scanability.
- Voice is terse, technical, and English-only; copy should sound like “Signal Load,” “Threat Index,” “Live Alerts,” and “Control Grid,” with no emoji, jokes, or consumer-app warmth.
