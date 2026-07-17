---
name: google-design
description: Use this skill to generate well-branded interfaces and assets for Google — a clean analytical dashboard system. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping dashboard UIs.
user-invocable: true
---
# Google Design Skill

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts such as mocks, dashboards, or throwaway prototypes, copy assets out and build static HTML files the user can review. If working on production code, use the rules here and the token files to stay on-brand.

If the user invokes this skill without further direction, ask what they want to build, clarify the target screen or workflow, and then act like a senior product designer who can output either HTML artifacts or production-ready UI code.

## Quick map

- `README.md` — brand context, dashboard intent, and system-wide design reasoning
- `colors_and_type.css` — source of light/dark tokens for color, type, radius, shadow, and spacing
- `css.json` — structured token values for programmatic use and exact hex/px lookup
- `components/index.json` — component inventory plus cross-component interaction patterns
- `preview/component-button.html` through `preview/component-sidebar.html` — focused HTML references for key components
- `ui_kits/dashboard/index.html` — full dashboard UI kit showing layout, density, navigation, and chart usage

## Essentials at a glance

- Primary color is `#4285f4` in light mode, but the main accent flips to `#fc2c50` in dark mode; preserve that mode-specific energy instead of forcing one universal brand blue.
- Surface design is flat and analytical: backgrounds stay near `#ffffff`, `#f9f9fa`, and `#eff1f4` in light mode, while hierarchy comes from borders like `#ebebeb`, not soft shadows.
- Radius is a single `8px` baseline (`--radius: 0.5rem`); keep shapes structured and gently rounded, with no extra-soft 12–24px cards.
- Spacing runs on a tight `3.84px` micro-unit; prefer compact dashboard rhythm and avoid oversized marketing-page padding.
- Typography is `DM Sans` for interface copy and `JetBrains Mono` for data-heavy or technical details; keep the overall voice crisp, modern, and quietly functional.
- Shadow philosophy is nearly zero-elevation: shadow tokens exist, but their opacity is `0`, so depth should come from tonal contrast, borders, and panel grouping.
- Chart color is where the system becomes expressive: light mode uses `#4285f4`, `#ea4335`, `#fbbc05`, `#0043ad`, and `#34a853`; dark mode switches to brighter high-contrast data colors.
- Sidebar styling is a signature pattern, not a default shell: light mode uses a dedicated sidebar wash `#f0f6ff`, while dark mode uses `#171717` with stronger accent navigation states.
- Controls should feel compact and dashboard-first, roughly `32px` tall in practice, with emphasis carried by color and outline clarity rather than bulky sizing or raised chrome.
