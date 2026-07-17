---
name: barbie-design
description: Use this skill to generate well-branded interfaces and assets for Barbie — a playful, glossy dashboard design system. Contains essential design guidelines, colors, type, shadows, spacing, and documented UI components for prototyping dashboard UIs.
user-invocable: true
---
# Barbie Design Skill

Read the available library files first, then design or build interfaces that keep Barbie's dashboard language glossy, soft, and editorial rather than corporate.

If creating visual artifacts, copy assets or tokens out and make static HTML files the user can view. If working on production code, use the token files and component analyses below as the source of truth.

If the user invokes this skill without any other guidance, ask what they want to build, clarify the screen or flow, and respond like an expert designer who can output HTML artifacts or production code as needed.

## Quick map

- `colors_and_type.css` — drop-in tokens for color, typography, radius, shadow, tracking, and spacing
- `css.json` — programmatic token map with exact hex, px, and shadow values
- `components/index.json` — component index plus cross-component patterns and summary insights
- `components/button.json`, `components/card.json`, `components/table.json`, `components/chart.json`, `components/navigation.json`, `components/sidebar.json` — per-component analysis data
- `preview/component-button.html`, `preview/component-card.html`, `preview/component-table.html`, `preview/component-chart.html`, `preview/component-navigation.html`, `preview/component-sidebar.html` — reference HTML previews for the documented patterns

## Essentials at a glance

- Brand primary is `#e91e63` in light mode and shifts brighter to `#ff007f` in dark mode; keep the palette unapologetically pink, glossy, and high-contrast.
- Base surfaces stay airy with `#ffffff` background, `#fffafc` cards, and `#fff0f6` sidebar; dark mode flips to `#1a000e` and `#2d001a` instead of neutral gray.
- Radius is a single oversized `28.8px`; this plush curve is the system signature, so controls, cards, and navigation all feel toy-like and soft.
- Spacing is built on a `4px` base token; layouts should stay dashboard-dense but never cramped, with pink breathing room rather than hard enterprise grids.
- Type stack is explicit: `Inter` for UI, `Georgia` for editorial emphasis, and `JetBrains Mono` for utility data; tracking is tightened to `-0.02em`.
- Elevation uses pink-tinted shadows, not grayscale: `0px 5.5px 12.5px` with `#ff0059` at `0.08` opacity for default lift and `0.20` at `shadow-2xl` for hero emphasis.
- Primary actions should read as bright pink fills with white text, while secondary states fall back to powder tones like `#fce4ec` and blush accents like `#ff9ec5`.
- Signature UI patterns are the active pink sidebar capsule, the crisp navigation underline, airy performance tables, and charts built from the saturated pink scale `#e91e63` → `#880e4f`.
