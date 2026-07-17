# Nimbus Core

A dark-first design system distilled from the existing `previews/` folder — **core subset (23 components)** retained to cover both UI Kits (`dashboard`, `dev-explorer`) plus settings panels. The canonical token source is `colors_and_type.css` (+ `css.json`).

## Open the Showcases

All HTML files reference `colors_and_type.css` via relative paths and run as static pages.

| Showcase | Path |
|----------|------|
| Component — Alert | `preview/component-alert.html` |
| Component — Buttons | `preview/component-buttons.html` |
| Component — Forms | `preview/component-forms.html` |
| Component — Table | `preview/component-table.html` |
| UI Kit — Dashboard | `ui_kits/dashboard/index.html` |
| UI Kit — Dev Explorer (IDE) | `ui_kits/dev-explorer/index.html` |

## What's Inside

- `colors_and_type.css` — authoritative token source (verbatim from the project root `colors_and_type.css`, marked `/* @dark-only */` with `/* @group-priority: brand-green, status, brand-blue, brand-purple, brand-yellow */`).
- `css.json` — machine-readable token projection (`color`, `font`, `radius`, `spacing`, plus empty `shadow`/`size` buckets reserved by spec).
- `scaffold.css` — page chrome: reset, body/html, headings, layout helpers (`.row`, `.col`, `.grid-*`, `.stack-*`), preview-page atoms (`.pv-header`, `.pv-section*`), shared atoms (`.ds-tooltip`, `.ds-popover`, `.ds-empty`, `.ds-code`, `.ds-kbd`, `.mono`/`.num`), plus the `@import` for JetBrains Mono. Hand-authored.
- `components/` — 23 component slugs (`{slug}.json` + a shared `index.json`). Each contract carries `category`, `tokensConsumed`, `domAnatomy`, and `provenance`.
- `preview/` — 23 component preview pages (`component-{slug}.html`). Each page embeds the canonical CSS for its `.ds-*` classes inside `<style>` between `/* @component-css-start */` and `/* @component-css-end */` markers.
- `ui_kits/` — 2 page-level showcases (`dashboard`, `dev-explorer`), each as a single interactive React 18 `index.html` with a sibling `quality-report.json`.
- `components.css` — aggregated component class definitions, **auto-generated** from the marker blocks above by `design-library-creator/scripts/extract-components-css.mjs`. Do not edit by hand — regenerate after editing the corresponding `preview/component-*.html` file.
- `uikit-plan.json` — component whitelist (2 core + 21 support) and slot assignments derived from `components/index.json` via `generate-uikit-plan.mjs`.
- `library-consumption.json` — recommended downstream read order for agents consuming this library.
- `assets/icons/` — 115 bundled SVG icons.
- `icons.js` — optional inline icon-sprite renderer.

## Token Highlights

| Group | Examples |
|-------|----------|
| Surface | `--bg-base-default #1A1B1D`, `--bg-base-secondary`, `--bg-overlay-l1..l4` |
| Brand | `--bg-brand #32F08C`, `--bg-brand-hover #0FDC78`, `--bg-brand-popup` |
| Status | `--status-{primary, success, alert, warning, error}-{default, hover, active, surface-l1..l3}` |
| Text / Icon | `--text-default #D1D3DB`, `--text-secondary`, `--icon-tertiary` |
| Border | `--border-neutral-l1..l3`, `--border-brand`, `--border-contrast` |
| Type — body | `--body-{xs, sm, md, base}-{font-family, font-size, font-weight, line-height}` (+ `*-strong`) |
| Type — heading | `--heading-{3xs..3xl}-...` |
| Code | `--code-editor-*`, `--code-terminal-*`, syntax hues `--code-{text, link, number, ...}` |
| Radii | `--radius-2 / 4 / 6 / 8 / 10 / full` |
| Spacers | `--spacer-0 / 4 / 6 / 8 / 12 / 16 / 24 / 32 / 40` |

## Naming Convention

Tokens **preserve the source naming verbatim** — there are no `--color-*` portable aliases. Components consume `var(--bg-*)`, `var(--text-*)`, `var(--status-*-*)` directly. Do not rename, scale-up, or invent values; if a missing variant is needed, run `refine-library` to extend the source first.

## Generation Notes

- HTML structures from the original `previews/` files were preserved unchanged. Only the two `<link>` paths (and one `<script>` path for `icons.js`) were rewritten to point at the library root.
- `data.html` was split into three component files (`avatar.html`, `tag.html`, `table.html`) per the agreed classification.
- Foundational token-preview pages (`colors`, `typography`, `spacing`, `radius`) are intentionally **not** present — they are represented by `colors_and_type.css` + `css.json` only.
- UI Kits ship as interactive React 18 single-file showcases (`<script type="text/babel">` + Babel Standalone CDN), capped at `max-width: 1184px` per design-library-creator skill spec.

## Downstream Consumption Guide (重要)

本设计系统三层契约，下游消费时**按场景挑文件**，不要盲目复制 UIKit。

### 三层契约

| 层 | 文件 | 用途 | 是否可直接复制 |
|---|---|---|---|
| **Tokens** | `colors_and_type.css` + `css.json` | 颜色/字号/圆角/间距等设计语言 | ✅ 直接 link 或读 css.json |
| **Components** | `components.css` + `preview/component-*.html` | 单个组件的 markup + class | ✅ 复制 markup，引用 components.css |
| **UIKit Showcase** | `ui_kits/{type}/index.html` | 页面级**样品展示**（max-width 1184px） | ❌ **不要直接复制根容器** |

### UIKit 是 Showcase，不是 Page Template

UIKit 受 design-library-creator skill 硬约束：`max-width: 1184px` + 不允许 `transform: scale`。它是**给设计师看产品长什么样的样品**，不是给开发抄到 1920/2560 真实画布的母版。直接 copy 会导致两侧大片留白。

### 正确的下游消费流程

```
你要做：在自己画布上生成一个 IDE 风格页面
  ↓
1. 读 ui_kits/dev-explorer/index.html → 看页面"结构骨架"
   （titlebar + activity-bar + sidebar + editor + chat）
  ↓
2. 看每个 region 用了哪些 .ds-* 类
   （sidebar 用 .ds-filetree、editor 用 .ds-editortabs ...）
  ↓
3. 进 preview/component-{slug}.html 拿干净的组件 markup
   （preview 不带 1184 容器，组件级是 fluid 的）
  ↓
4. 在你自己的画布上写外层 grid
   - 不要继承 UIKit 的 .uikit-shell (max-width: 1184)
   - 不要继承 UIKit 的根 grid-template-columns（那是为 1184 调的比例）
   - 只继承组件层级的 markup + class
   - 顶层用 100vw / 100% / auto-fit grid 自适应你的画布
```

### 快速参考表

| 你想做什么 | 应该读 |
|---|---|
| 用品牌色/字号/间距 token | [colors_and_type.css](./colors_and_type.css) 或 [css.json](./css.json) |
| 写一个按钮 / 表单 / 表格 | `preview/component-{slug}.html` + `components.css` |
| 写一个完整的页面（自定义画布） | UIKit 看**结构思路** + preview 拿组件 markup + 自己写外层 grid |
| 看有哪些组件可用 | [components/index.json](./components/index.json) |

### UIKit 内层组件其实是流体的

注意：UIKit 的 1184 限制只在**最外层 `.uikit-shell` 容器**。内层所有 `.ds-*` 组件都是 fluid 的（`min-width: 0` + `1fr` + `minmax(0, 1fr)`）。所以正确做法是：把内层 region 整段 copy 出来，外层换成你自己的画布尺寸 grid。

## Icons

Bundled SVG icons live at `assets/icons/` (115 files). Optional runtime sprite renderer at `icons.js`.

## Next Steps

- Refine or extend tokens → `refine-library` workflow.
- Add new components → `expand-components` workflow.
- Spin up an additional kit type → `generate-additional-kit` workflow.
