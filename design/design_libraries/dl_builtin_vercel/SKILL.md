---
name: vercel-design-library-design
description: Use this skill to generate well-branded interfaces for Vercel. Contains colors, type, fonts, assets, and UI kit for prototyping dashboard UIs.
user-invocable: true
---
# Vercel Design Skill

Explore the available files in this skill before designing or implementing.

If creating visual artifacts, copy assets out and create static HTML files. If working on production code, use these files to stay aligned with Vercel's dashboard language.

If invoked without a specific task, ask what the user wants to build and then respond as a Vercel-focused dashboard designer.

## Quick map

- `colors_and_type.css` — drop-in CSS variables for colors, type, radius, shadow, spacing
- `css.json` — structured token data for programmatic use
- `preview/` — small HTML cards illustrating the documented components
- `components/index.json` — component index plus shared dashboard patterns

## Essentials at a glance


- solo-design prefix: `vercel` (semantic aliases such as `--vercel-background`, `--vercel-foreground`, and `--vercel-primary` are provided for stable consumption by `fill-html-head.mjs`).
- Primary emphasis flips between near-black `#121212` in light mode and soft neutral `#e5e5e5` in dark mode; the brand stays deliberately monochrome.
- Radius is a single `0.5rem`; cards and controls stay precise, square-leaning, and never playful.
- Density starts from a `0.25rem` spacing unit; dashboard layouts should feel compact and operational.
- Type stack: `Geist` for interface UI, `DM Serif Display` for editorial contrast, `Geist Mono` for technical notation.
- Voice: precise, technical, minimal; use short product language like “Deploy”, “Preview”, and “Observability”.
- Shadows stay nearly silent; borders and tonal shifts around `#121212` and `#e5e5e5` do most of the separation work.
- Brand quirk: monochrome is the default rule, and chart moments are the exception inside the dashboard language.

## Components

| Slug | Name | Key Insight |
|------|------|-------------|
| button | Button | Monochrome actions with a single decisive emphasis tier. |
| card | Card | Quiet surfaces with sharp information hierarchy and minimal ornament. |
| table | Table | Data tables should stay dense, readable, and operational rather than decorative. |
| chart | Chart | Charts reserve the blue scale for insight moments inside an otherwise monochrome UI. |
| navigation | Navigation | Navigation should feel editorial and compact, using contrast shifts instead of bright fills. |
| sidebar | Sidebar | Sidebar is a soft contextual frame, not a second accent canvas. |
