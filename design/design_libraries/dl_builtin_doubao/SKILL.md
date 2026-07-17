# Doubao Design Library Skill

Use this design library for English-language AI dashboard experiences that should feel minimal, cool-toned, technical, and calm. The library is complete, but its component model was inferred from the token system rather than extracted from authored component specs, so prefer consistency with the shared tokens and preview pages when extending it.

## Snapshot

- Library: `doubao`
- Brand: `Doubao`
- Product type: `AI dashboard`
- Kit type: `dashboard`
- Language: `en`
- Generation mode: `inferred-from-tokens`
- Generated artifacts: `README.md`, `SKILL.md`, `colors_and_type.css`, `css.json`, `components/index.json`, `components/button.json`, `components/search-input.json`, `components/app-card.json`, `components/sidebar-nav.json`, `components/data-table.json`, `components/chat-composer.json`, `preview/component-button.html`, `preview/component-search-input.html`, `preview/component-app-card.html`, `preview/component-sidebar-nav.html`, `preview/component-data-table.html`, `preview/component-chat-composer.html`, `ui_kits/dashboard/index.html`
- Skipped artifacts: `none`

## Token System Summary

- CSS variable coverage: 55 variables, no icon set bundled
- Primary action color: `--primary` = `#0065fd`
- App background: `--background` = `#ffffff`
- Main text: `--foreground` = `#0e1115`
- Muted surface: `--muted` = `#eff1f4`
- Border color: `--border` = `#e7eaef`
- Focus ring: `--ring` = `#557fff`
- Sidebar surface: `--sidebar` = `#eff1f4`
- Shared radius: `--radius` = `19.2px`
- Shared spacing unit: `--spacing` = `3.84px`
- Sans font: `Stack Sans Text, ui-sans-serif, sans-serif, system-ui`
- Serif font: `Source Serif 4, serif`
- Mono font: `JetBrains Mono, monospace`
- Shadow direction: minimal elevation with border-led separation

## Implementation Guidance

1. Keep layouts compact and dashboard-dense by scaling spacing from the single global spacing token.
2. Prefer crisp borders and tonal contrast over visible drop shadows.
3. Use the shared radius token consistently so controls feel rounded but still technical.
4. Use brand blue for primary actions, muted surfaces for secondary actions, and destructive tokens only for destructive intent.
5. Follow preview pages first when deciding spacing, hierarchy, and component composition.

## Semantic Roles

- `background` -> `background`
- `foreground` -> `foreground`
- `primary` -> `primary`
- `destructive` -> `destructive`

## Quick Map

### Components

- `components/button.json` -> Button (`action`) -> preview: `preview/component-button.html`
- `components/search-input.json` -> Search Input (`form`) -> preview: `preview/component-search-input.html`
- `components/app-card.json` -> App Card (`content`) -> preview: `preview/component-app-card.html`
- `components/sidebar-nav.json` -> Sidebar Navigation (`navigation`) -> preview: `preview/component-sidebar-nav.html`
- `components/data-table.json` -> Data Table (`data-display`) -> preview: `preview/component-data-table.html`
- `components/chat-composer.json` -> Chat Composer (`ai-interaction`) -> preview: `preview/component-chat-composer.html`

### Preview

- `preview/component-button.html` -> primary and secondary action reference
- `preview/component-search-input.html` -> compact search field reference
- `preview/component-app-card.html` -> application/content card reference
- `preview/component-sidebar-nav.html` -> dashboard sidebar navigation reference
- `preview/component-data-table.html` -> dense tabular data reference
- `preview/component-chat-composer.html` -> AI input/composer reference

### UI Kit

- `ui_kits/dashboard/index.html` -> assembled Doubao dashboard kit reference

## Core Files

- `colors_and_type.css` -> production-ready token CSS
- `css.json` -> structured token export
- `components/index.json` -> library manifest and cross-component rules
- `README.md` -> general library overview
- `SKILL.md` -> implementation-oriented usage guidance

## Warnings

- Components were inferred from the token system and product type because the source material did not include authored component specs.
- Treat preview files and shared tokens as the source of truth when expanding the library.

## Essentials at a glance

- solo-design prefix: `doubao` (semantic aliases such as `--doubao-background`, `--doubao-foreground`, and `--doubao-primary` are provided for stable consumption by `fill-html-head.mjs`).
