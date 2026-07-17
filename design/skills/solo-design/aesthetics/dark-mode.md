# Dark Mode System

> **Trigger**: Quality Gate 8 fires when `<html class="dark">` is detected or project uses dark theme.

## Surface Stack

| Token | Light mode | Dark mode | Rule |
|-------|-----------|-----------|------|
| `--bg` | #FFFFFF | #0B0B0F – #14141A | Never pure #000000 |
| `--surface` | 4–6% lighter than bg | 4–6% lighter than bg (→ #1A1A22 – #1E1E26) | Layering direction stays same |
| `--surface-2` | +4% step | +4% step (→ #242430) | Hover/selected |
| `--line` | < 6% contrast vs surface | rgba(255,255,255, .08–.12) | Subtler than light |
| `--shadow-*` | per §1.4 | opacity × 2, blur × 1.5; add 1px inset `rgba(255,255,255,.03)` top border | Simulate light direction |

## Text & Contrast

- `--ink`: #E8E8EC (never pure white — causes halation)
- `--ink-2`: rgba(232,232,236, .70)
- `--ink-3`: rgba(232,232,236, .45)
- Minimum contrast ratio remains 4.5:1 (WCAG AA) — test against `--surface` not `--bg`

## Image & Illustration

- Photography: apply `brightness(.92) saturate(.92)` overlay to prevent blow-out
- Icons: stroke color inherits `currentColor`; no static white/black fills
- Decorative surfaces: same-hue micro-texture or subtle noise preferred over solid blocks

## Component Adjustments

- Cards: prefer border (`rgba(255,255,255,.06)`) over shadow; shadow-only floats feel invisible in dark
- Buttons (primary): keep brand fill; secondary → ghost border `rgba(255,255,255,.12)`
- Inputs: border `rgba(255,255,255,.10)`; focus ring 2px brand at 60% opacity
- Modal backdrop: `rgba(0,0,0,.6)` + `backdrop-filter: blur(4px)` (stronger than light)

## [FORBIDDEN]

- Pure black (#000000) as page background
- Pure white (#FFFFFF) as text (halation)
- Light-mode shadow values (invisible in dark)
- Colored shadows as "dark mode decoration"
- Gradient backgrounds with lightness variance > 15%
