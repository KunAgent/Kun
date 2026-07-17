---
name: 21th-design
description: Use this skill to generate well-branded interfaces and assets for 21th — an analytics dashboard system with light/dark themes, mono-led typography, square geometry, offset shadows, and restrained electric-blue accents. Contains token CSS, parsed token JSON, component specs, and preview HTML for dashboard UI work.
user-invocable: true
---

# 21th Design Skill

Use this skill for dense analytics dashboard work in the 21th visual language. Read the available files, then build static HTML prototypes or production UI that stays square, compact, and contrast-heavy.

If the user invokes this skill without much direction, ask what dashboard surface they need, then propose an on-brand layout using the existing token and component files.

## Quick map

- `SKILL.md` — agent entry point for the 21th library
- `colors_and_type.css` — live light/dark tokens for color, type, radius, shadow, spacing, and semantic aliases
- `css.json` — parsed hex, font, shadow, radius, and spacing values
- `components/index.json` — component inventory plus cross-component patterns
- `components/button.json` — action control guidance and sample labels
- `components/card.json` — panel surface guidance
- `components/chart-panel.json` — chart container guidance
- `components/data-table.json` — reporting grid guidance
- `components/input.json` — filter and search field guidance
- `components/sidebar-nav.json` — dashboard navigation shell guidance
- `preview/component-button.html` — rendered button states and sizes
- `preview/component-card.html` — rendered card treatments
- `preview/component-chart-panel.html` — rendered chart panel treatments
- `preview/component-data-table.html` — rendered data table treatments
- `preview/component-input.html` — rendered input and select-like field states
- `preview/component-sidebar-nav.html` — rendered sidebar navigation treatments

## Essentials at a glance

- Working primary is `#111111`, while the brand signal is `#0040ff`: use black for core controls and reserve the electric blue for charts, highlights, and one emphasized action per row.
- Light mode runs on `#c5c9c9` page background, `#d8dada` cards, and `#111111` text; dark mode flips to `#0a0a0a` page, `#1a1a1a` panels, and `#ffffff` text for the same high-contrast dashboard read.
- Typography is deliberately code-leaning: `Geist Mono` drives both `--font-sans` and `--font-mono`, while `Geist` is the serif-side support face; the interface should feel technical, compact, and editorial rather than friendly.
- Tracking defaults to `-0.05em`; keep labels tight, especially on structural copy and small uppercase markers that need a terse command-center cadence.
- Radius is `0px` (`0rem`) across the system; square corners are not a suggestion, they are the core shape language that keeps every panel and control feeling strict and analytical.
- Spacing starts at `4px`; the default button height is `36px`, small buttons are `30px`, large buttons are `42px`, standard inputs are `40px`, and large select-like fields are `44px`.
- Shadows are hard-offset, not soft: the base shadow language is `2px 2px 0px 0px #000000` with `0px` blur, so elevation should read like a printed keyline or mechanical stamp.
- Destructive color is `#d73333` in light mode and `#ef4444` in dark mode; use it sparingly for deletion, danger, or irreversible state changes only.
- The signature interaction quirk is mechanical motion: buttons hover with `translate(-1px, -1px)` and press with `translate(1px, 1px)`, so feedback should feel punched and tactile rather than soft.
- Voice stays short and operational, using real labels like “Create View”, “Export CSV”, “Search accounts”, “Overview”, “Analytics”, and “Weekly Summary”; keep copy concise, functional, and emoji-free.
