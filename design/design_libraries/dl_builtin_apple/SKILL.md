---
name: pinguo-apple-design
description: Use this skill to generate well-branded interfaces and assets for Pinguo — a consumer imaging product ecosystem. Contains essential design guidelines, colors, type, fonts, component references, and UI kit patterns for prototyping app UIs.
user-invocable: true
---

# Pinguo Design Skill

Explore the available files in this skill first, then use them to produce on-brand UI, prototypes, and implementation details for Pinguo.

If creating visual artifacts, build static HTML the user can review. If working on production code, copy the tokens and patterns here so the result keeps Pinguo's restrained, Apple-inspired merchandising feel.

If the user invokes this skill without further guidance, ask what they want to build, clarify platform and scope, and then respond as a senior product designer who can output HTML artifacts or production-ready UI code.

## Quick map

- `colors_and_type.css` — drop-in CSS variables for color, type, radius, shadow, spacing, and motion
- `css.json` — programmatic token export for tooling and implementation
- `components/index.json` — component index and cross-pattern summary
- `components/button.json` — capsule CTA hierarchy and commerce action patterns
- `components/card.json` — quiet container rules driven by border, spacing, and content
- `components/input.json` — rounded field behavior, placeholder contrast, and focus treatment
- `components/navigation.json` — Apple-store-like top navigation and secondary rail patterns
- `components/product-grid.json` — merchandising grid rules and product-card rhythm
- `components/comparison-table.json` — structured model comparison and spec scanning patterns
- `preview/component-button.html`, `preview/component-card.html`, `preview/component-input.html`, `preview/component-navigation.html`, `preview/component-product-grid.html`, `preview/component-comparison-table.html` — small HTML references for component behavior and styling
- `ui_kits/website/index.html` — full website-style click-through reference for layout, density, and content flow

## Essentials at a glance

- Primary accent is Pinguo Blue `#0066cc`: cool, commerce-aware, and precise; pair it with Space Black `#0a0a0a` and Silver Mist `#f5f5f7`, not loud multi-hue palettes.
- Radius is intentionally soft at `1.2rem`, but the brand still feels restrained; keep cards and media rounded, and keep buttons fully pill-shaped rather than sharp or overly playful.
- Spacing base is `0.24rem`; the system prefers whitespace over separators, with a practical scale of `4, 8, 12, 16, 24, 32, 48, 64, 96, 128`.
- Typography uses **DM Sans** for interface and editorial display, with **JetBrains Mono** for technical details or numeric/spec moments; hero display runs at `72–96px / 600 / -0.04em / 0.92`, body copy at `14–16px / 400 / 1.55`.
- Mobile interaction assumes a minimum touch target of `44 × 44pt` on a `390 × 844pt` frame, with a `44pt` status bar and `48pt` tab bar plus safe-area blur.
- Shadow philosophy is whisper-light: start with `1px` borders, use `0 1px 2px 0 rgba(0,0,0,0.04)` at rest, and reserve deeper elevation like `0 8px 24px -8px rgba(0,0,0,0.08)` for hover, drag, or overlays.
- Voice is editorial, precise, and calm; headlines stay short, confident, and often line-broken on purpose, while product UI avoids emoji and avoids conversational filler.
- Motion uses `cubic-bezier(0.32, 0.72, 0, 1)` with `150ms / 250ms / 350ms` timing bands, reinforcing polish without visible flourish.
- Imagery should be centered product photography on pure white or black grounds, or natural-light lifestyle shots; never mix illustration, emoji-like decoration, and competing warm/cool color stories on one page.
