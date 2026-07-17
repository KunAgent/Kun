---
name: minimal-dashboard-design
description: Use this skill to generate well-branded interfaces for Minimal Dashboard. Contains colors, type, tokens, component references, previews, and a dashboard UI kit for prototyping dashboard UIs.
user-invocable: true
---
# Minimal Dashboard Design Skill

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts, copy assets out and create static HTML files. If working on production code, read the rules here to become an expert in designing with this brand.

## Quick map

- `colors_and_type.css` — drop-in CSS variables for colors, type, radius, shadow, and spacing
- `css.json` — structured token export for programmatic use
- `components/index.json` — component index and cross-component patterns
- `components/button.json`, `components/card.json`, `components/table.json`, `components/chart.json`, `components/navigation.json`, `components/sidebar.json` — per-component reference data
- `preview/component-button.html`, `preview/component-card.html`, `preview/component-table.html`, `preview/component-chart.html`, `preview/component-navigation.html`, `preview/component-sidebar.html` — small HTML previews of the component set
- `ui_kits/dashboard/index.html` — full click-through dashboard kit reference

## Essentials at a glance


- solo-design prefix: `minimal` (semantic aliases such as `--minimal-background`, `--minimal-foreground`, and `--minimal-primary` are provided for stable consumption by `fill-html-head.mjs`).
- Brand: `#2563ef` signature blue (brand-600) — the system's single accent, used on primary actions, links, active states, focus rings, and charts. Delivered as a 10-step scale (brand-50 → brand-900).
- Color families: six groups — `brand`, `background`, `text`, `icon` as 10-step scales, plus `state-success` and `state-error` functional sets — exposed as primitives with a semantic role layer and `--color-*` aliases for authoring.
- Radius: `25.2px` is the shared soft radius — one rounded corner language applied broadly across the system.
- Spacing: `4px` is the base spacing token — compact dashboard density is expected, and no explicit control-height token is supplied in the orchestration summary.
- Type: **Geist** for sans UI, **DM Serif Display** for emphasis, and **Geist Mono** for data-heavy or numeric contexts.
- Voice: concise and neutral, built from labels such as “Overview,” “Revenue,” “Active Users,” “Team,” and “Settings.”
- Shadows: shadow tokens exist, but they are effectively zeroed out — the system stays flat and relies on contrast over elevation.
- Brand quirk: charts draw their five stops from the brand scale, so data viz is the most vivid release of the same blue while the rest of the UI stays calm, tonal, and restrained.

## Components

| Slug | Name | Key Insight |
|------|------|-------------|
| button | Button | Dense, calm actions with high-contrast fills and no decorative shadow. |
| card | Card | Framed content blocks that rely on border contrast rather than depth. |
| table | Table | Quietly structured data views with subtle dividers and restrained state color. |
| chart | Chart | The main chromatic release point and the system's clearest visual accent. |
| navigation | Navigation | Editorial and quiet, using spacing and weight shifts over bright fills. |
| sidebar | Sidebar | A first-class tonal pattern, not just a bordered container on the side. |
