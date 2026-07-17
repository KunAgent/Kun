---
name: vibecamp-design
description: Use this skill to generate well-branded interfaces and assets for Vibecamp — a bold, editorial dashboard product. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping dashboard UIs.
user-invocable: true
---

# Vibecamp Design Skill

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts or production code, depending on the need.

## Quick map

- `README.md` — brand context, voice, and visual foundations
- `colors_and_type.css` — source of the `brand` ten-step scale, semantic theme tokens, compatibility aliases, `Geist`, `Playfair Display`, `Roboto Mono`, `4px` spacing, `18px` radius, and quiet shadow tokens
- `css.json` — structured token mirror of the CSS variables
- `components/index.json` — component index plus cross-component patterns
- `components/button.json`, `components/card.json`, `components/table.json`, `components/chart.json`, `components/navigation.json`, `components/sidebar.json` — per-component analysis data
- `preview/` — HTML previews for button, card, table, chart, navigation, and sidebar
- `ui_kits/dashboard/index.html` — full dashboard walkthrough reference

## Essentials at a glance


- solo-design prefix: `vibe` (semantic aliases such as `--vibe-background`, `--vibe-foreground`, and `--vibe-primary` are provided for stable consumption by `fill-html-head.mjs`).
- Color is organized brand-first: `--brand-50` through `--brand-900` lead the palette, with `#f1481e` anchored at `--brand-600` and dark mode promoting a brighter brand step for `--primary`.
- Radius is one rule: `18px` (`1.125rem`) across cards, buttons, and shell surfaces. The silhouette should feel soft and chunky, not sharp.
- Spacing base is `4px` (`0.25rem`). Use it to build generous internal padding instead of ultra-dense enterprise compression.
- Fonts are fixed: `Geist` for UI, `Playfair Display` for editorial contrast, and `Roboto Mono` for numeric or code-like accents. Do not flatten everything into a single sans.
- Semantic tokens and compatibility aliases coexist. Prefer `--background`, `--foreground`, `--primary`, `--card`, `--accent`, `--border`, `--ring`, `--sidebar-*`, and `--chart-*`, but preserve legacy aliases when touching older previews.
- Light surfaces stay warm with paper-like neutrals and dark text; dark mode stays brown-charcoal rather than blue-black. Avoid cold white canvases or icy dark shells.
- Navigation carries visual weight through deep neutral secondary/sidebar accents, and charts should continue to mix warm and digital notes instead of flattening into generic analytics colors.
- Shadows are intentionally quiet: the core shadow uses `2px 2px 10px 4px` with opacity `0`. Depth should come from color blocking and contrast, not visible lift.
- Voice is short and utilitarian: labels like `Overview`, `Sessions`, `Community`, `Analytics`, and `Settings` set the tone without decorative marketing language.
