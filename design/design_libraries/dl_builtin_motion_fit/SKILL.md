---
name: motionfit-design
description: Use this skill to generate well-branded interfaces for MotionFit. Contains colors, type, fonts, component references, and a UI kit for prototyping dashboard UIs.
user-invocable: true
---
# MotionFit Design Skill

Explore the available files in this skill. If `README.md` is present later, read it first.

If creating visual artifacts, copy assets out and create static HTML files. If working on production code, read the token and component references here to become fluent in this brand.

If the user invokes this skill without further guidance, ask what they want to design and respond like an expert designer who can output static HTML artifacts or production-ready UI code.

## Quick map

- `colors_and_type.css` — drop-in CSS variables for colors, type, radius, shadow, and spacing
- `css.json` — structured token JSON for programmatic consumption
- `preview/` — small HTML cards illustrating foundations and key components
- `ui_kits/dashboard/` — full click-thru dashboard reference for layout, density, and pattern reuse
- `components/index.json` — component index and cross-component patterns

## Essentials at a glance

- Brand accent shifts by mode: `#ff4000` in light UI and `#00ff85` in dark UI — intense, athletic, and progress-driven rather than soft or lifestyle-coded.
- Radius is locked to `0px` — every control and surface stays sharp, mechanical, and performance-focused.
- Spacing runs on a `4px` base token; no global control-height token is defined, so keep mobile layouts compact instead of inventing a taller default.
- Type is `Orbitron` for the primary sans voice, with `serif` and `monospace` fallbacks kept generic and secondary.
- Voice is short, imperative, and metric-led: "Start Workout", "Recovery Score", and "Daily Streak" set a disciplined, no-fluff tone.
- Shadows are effectively flat: `2px 2px 0.5px 0px` with `0` opacity across the token set, so hierarchy comes from contrast, borders, and accent color.
- Dark surfaces anchor the system: `#0a0a0a`, `#161616`, and `#27272a` carry most UI structure, with bright accent hits used sparingly for action and status.
- Signature quirk: performance visuals pull from electric chart colors like `#d6ff0a`, `#6200ff`, `#00ff1e`, and `#ff3def`, giving analytics a synthetic training-lab feel.

## Components

| Slug | Name | Key Insight |
|------|------|-------------|
| button | Button | Primary actions feel fast and committed through hard edges, compact density, and a single hot accent. |
| card | Card | Cards frame metrics and sessions on dark surfaces where contrast, not elevation, carries hierarchy. |
| bottom-nav | Bottom Navigation | Bottom navigation keeps route switching mobile-first, with the active destination called out by the accent system. |
| input | Input | Inputs support search and goal entry with compact rhythm and sharp industrial framing. |
| avatar | Avatar | Avatars act as identity markers for profile, streak, and leaderboard contexts without softening the visual system. |
| chip | Chip | Chips express training filters and selection states through terse labels and accent-led state changes. |
