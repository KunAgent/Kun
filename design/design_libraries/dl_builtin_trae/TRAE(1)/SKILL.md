# Nimbus Core Design System

> Dark-first product design system (core subset — 23 components covering both UI Kits). Tokens authored verbatim from the project root `colors_and_type.css`; component/UI-Kit references derived from the `previews/` HTML pages.

## Library Layout

> The library root directory shown below is named `nimbus-core/` for documentation. The **deployed location is consumer-defined** — it can be `node_modules/@nimbus/core/`, `packages/design/nimbus-core/`, a CDN base URL, or anywhere else. All paths in this document are **relative to the library root**; treat the root prefix as `{NIMBUS_ROOT}` and resolve it from your consumer project.

```
{NIMBUS_ROOT}/                 # nimbus-core library root (location is consumer-defined)
├── colors_and_type.css        # Authoritative token source (verbatim, dark-only)
├── css.json                   # Machine-readable token projection (auto-generated)
├── scaffold.css               # Page chrome: reset, layout helpers, shared atoms (hand-authored)
├── components.css             # Aggregated component class definitions — AUTO-GENERATED
├── icons.js                   # Inline icon sprite renderer
├── uikit-plan.json            # Component whitelist + slot assignments + screen blueprint
├── library-consumption.json   # Recommended downstream read order for agents
├── assets/
│   └── icons/                 # 115 bundled SVG icons (default + .0c0c0d / status-tinted variants)
├── components/                # Component layer (1 JSON contract per slug, 23 total)
│   ├── index.json
│   ├── activity-rail.json     │ ├── page-header.json
│   ├── alert.json             │ ├── pagination.json
│   ├── avatar.json            │ ├── setting-row.json
│   ├── buttons.json           │ ├── stat-card.json
│   ├── cards.json             │ ├── status-bar.json
│   ├── chat-composer.json     │ ├── table.json
│   ├── dialog.json            │ ├── table-panel.json
│   ├── editor-tabs.json       │ ├── tabs.json
│   ├── file-tree.json         │ ├── tag.json
│   ├── forms.json             │ └── workbench-titlebar.json
│   ├── kbd.json               │
│   ├── menu.json              │
│   └── nav-list.json          │
├── preview/                   # 23 component preview pages (1 HTML per slug)
└── ui_kits/                   # Page-level showcases composing components + tokens
    ├── dashboard/index.html
    └── dev-explorer/index.html
```

> `scaffold.css` is hand-authored and stable. `components.css` is **regenerated** by `design-library-creator/scripts/extract-components-css.mjs`, which scans every `preview/component-*.html` for the CSS between `/* @component-css-start */` and `/* @component-css-end */` markers inside its `<style>` block and aggregates the result. Edit component CSS in the preview HTML, then re-run the script — never edit `components.css` directly.

## Brand Essentials

- **Surface**: dark canvas `--bg-base-default #1A1B1D`, layered with `--bg-base-secondary` / `--bg-base-tertiary` and `--bg-overlay-l1..l4` tints.
- **Primary text**: `--text-default #D1D3DB`; muted: `--text-secondary` / `--text-tertiary`.
- **Brand accent**: `--bg-brand #32F08C` (green), with `--bg-brand-hover` and `--bg-brand-popup` tint.
- **Status palette**: primary / success / alert / warning / error each provide `default | hover | active | surface-l1..l3`.
- **Typography**: SF Pro / SF Pro Text body, JetBrains Mono for code; heading scale `3xs → 3xl`, body scale `xs → base` with `*-strong` 500-weight pairs.
- **Radii**: `2 / 4 / 6 / 8 / 10 / full`. **Spacers**: `0 / 4 / 6 / 8 / 12 / 16 / 24 / 32 / 40`.

## Token Naming Convention

Tokens preserve their source naming verbatim. There are no portable aliases — components consume the source variables directly:

- `--bg-*` surface fills (base / overlay / brand / menu / tooltip / invert)
- `--text-*` and `--icon-*` content tokens (mirroring color states)
- `--border-neutral-l1..l3`, `--border-brand`, `--border-contrast`
- `--status-{primary|success|alert|warning|error}-{default|hover|active|surface-l1..l3}`
- `--accent-*`, `--brand-{green|red|yellow|blue|purple}-100..1000`, `--viz-*`
- Typography: `--{body|heading}-{size}-{font-family|font-size|font-weight|line-height}`
- Code: `--code-editor-*`, `--code-terminal-*`, plus `--code-{text|doc|link|number|action|...}` hues.

> Components reference tokens directly via `var(--token-name)`. Do **not** rename tokens; do **not** introduce new color scales.

## Components (23)

| Slug | Type | Notes |
|------|------|-------|
| activity-rail | IDE rail | vertical activity bar with active state + divider |
| alert | Notification matrix | 4 tones × simple/complex layouts |
| avatar | User chip | sm/md/lg, square/accent, stacked group + overflow |
| buttons | Button matrix | brand/primary/ghost/danger × sizes × states |
| cards | Surface card | header / actions decorations |
| chat-composer | AI input | tool row + model chip + mic + send |
| dialog | Modal | overlay + footer actions |
| editor-tabs | IDE tabs | layered tab strip + close affordance + actions |
| file-tree | IDE explorer | multi-depth rows, chevron, file-type colors |
| forms | Form controls | input / textarea / select / checkbox / radio / switch |
| kbd | Shortcut hint | keyboard key caps |
| menu | Dropdown menu | section labels, shortcut, destructive item |
| nav-list | Sidebar nav | grouped menu items with active state |
| page-header | Page head | title + actions region |
| pagination | Page navigator | numeric pages with ellipsis |
| setting-row | Preference row | title + description + control (select / button / select-with-icon); group panels with `.ds-settingrow__group` + `.ds-settingrow__grouplabel` |
| stat-card | KPI card | tabular numerals + delta |
| status-bar | IDE status bar | status items + dot indicators |
| table | Data table | avatar + tag cells, toolbar/footer, scoped status colors |
| table-panel | Table container | bordered table with toolbar + footer pagination slot |
| tabs | Tabs | underline / filled / closable styles |
| tag | Status tag | default / success / warning / danger / brand / count / neutral-strong |
| workbench-titlebar | IDE top bar | traffic lights + project selector + icon actions |

## UI Kits (2)

| Type | Composition |
|------|-------------|
| dashboard | KPI stats + recent-activity table |
| dev-explorer | IDE shell: title-bar + activity-bar + explorer + editor + chat + status bar |

Each UI Kit is a single, self-contained interactive React 18 `index.html` that links `../../colors_and_type.css` and `../../components.css`, renders icons via `../../assets/icons/*.svg`, and writes a sibling `quality-report.json`. The shell is capped at `max-width: 1184px` per design-library-creator skill spec — UI Kits are showcases, not real-canvas page templates (see README → "Downstream Consumption Guide").

## Icons

Bundled SVG icons live at `assets/icons/` (115 files). Optional runtime sprite renderer at `icons.js`.

## Authoring Rules

1. **Never hardcode hex/rem values.** Always reference `var(--token)`.
2. **Status color is local.** Tag/cell-level colorization only — never tint full table rows.
3. **Surface lifts.** Use `--bg-base-secondary` (regular) and `--bg-base-tertiary` (raised) for layered surfaces.
4. **Borders stay neutral.** `--border-neutral-l1` for default chrome; only state-specific borders use status/brand.
5. **Icons are 2px stroke** rendered through `icons.js`; size via `data-size`.

## Out of Scope (Not Generated)

- Token-only previews (`colors`, `typography`, `spacing`, `radius`) — by user request, foundational previews are NOT included; they are represented purely by `colors_and_type.css` + `css.json`.
- Auto-derived light theme — source tokens are dark-only (`/* @dark-only */`).
- React UI Kit interactivity — UI Kits ship as static HTML showcases, matching the source `previews/` structure.

## Conversation Continuity

- Add components: `expand-components`
- Refine tokens or rename groups: `refine-library`
- Generate an additional kit (e.g., mobile / marketing site): `generate-additional-kit`
