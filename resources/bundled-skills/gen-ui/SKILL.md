---
name: gen-ui
description: "Build interactive HTML widgets (simulators, explorers, calculators, UI mockups) inline in desktop conversations with render_widget."
---

# Interactive Widgets (Gen UI)
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

Use `render_widget` to show a small interactive page inside the current desktop conversation. It is available only when the tool is advertised for this turn.

## When to build a widget
- Build one when seeing or manipulating something makes the answer clearer: parameter explorers ("what happens when…"), simulations, algorithm step-throughs, interactive charts, calculators, timelines, or UI mockups with alternatives.
- Do not build one for a plain table (answer in Markdown), a static structure (Mermaid code block), a simple governed chart (`render_chart` when advertised), or decoration.
- A request for a website, app page, component, or any project change is project work: edit the workspace instead of rendering a widget.

## Output contract
- Call `render_widget` with `title` (short, user facing) and `html` (an HTML fragment). Use `path` instead of `html` only to re-render an existing `.html` file in the workspace.
- Write a fragment: markup plus optional `<style>` and `<script>`. No `<!doctype>`, `<html>`, `<head>` or `<body>`.
- Give the root element a unique id and query it with `document.getElementById`. Never depend on `document.currentScript`.
- Keep it under 1 MB. Aggregate, sample, or round large data instead of inlining raw rows.
- Use `mode: "wide"` only for a full desktop application mockup or panels that must stay side by side. Everything else uses the default inline mode.
- Do not use `fetch`, XHR, WebSocket, forms that submit, `window.open`, or browser storage for important data. The page has no network access except static libraries.
- After the tool call, reply with at most a short conclusion. Never describe the HTML, announce a widget, or repeat the data shown in it.

## Libraries
- Bundled and offline: `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js`, `https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js`, `https://cdn.jsdelivr.net/npm/lucide@0.544.0/dist/umd/lucide.min.js`. Use these exact URLs in a literal `<script src="…">`.
- Other files may load from cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com or esm.sh when the user is online. Prefer plain SVG, Canvas and DOM for small visuals.

## Styling
- The page background is transparent and follows Kun's light or dark theme. Use the theme variables instead of fixed colors: `--foreground`, `--muted-foreground`, `--card`, `--muted`, `--border`, `--brand`, `--destructive`, `--success`, `--warning`, and `--viz-series-1` … `--viz-series-6` for data series.
- Base classes are available: `.card`, `.stack`, `.row`, `.grid-2`, `.grid-3`, `.btn`, `.btn-primary`, `.badge`, `.form-label`, `.text-muted`, `.text-small`, `.tabular-nums`, `.viz-dotted-background`. Form controls, tables and SVG text already follow the theme.
- Keep text readable: secondary text uses `--muted-foreground`, never lighter. Use one accent for the primary measure; add series colors only for real categories.
- For product mockups, define the product's own colors and type at the mockup root (use `light-dark()` when it should follow the theme) instead of the widget classes, and frame small mockups on `.viz-dotted-background`.
- Charts: label axes with quantities and units, size SVGs from their container width (redraw on `ResizeObserver`), and keep labels at 11px or larger.

## Composition
- Choose the smallest composition that answers the question: a compact control row, one dominant visual, and at most one line of live detail.
- Show live values next to the control that changes them. Add only the controls the user needs; do not invent search, filter or reset UI.
- For UI alternatives, show two or three distinct variants (tabs or a small carousel) rather than one.

## State and follow-ups
- `window.kun.widgetState` is the last saved snapshot (`{ modelContent, privateContent }`) or `null`. Restore from it on load and on the `kun:set_globals` window event.
- After a meaningful interaction, call `window.kun.setWidgetState({ modelContent, privateContent }).catch(() => {})`. The snapshot is at most 16 KiB. `modelContent` holds choices the user may ask about next (it is attached to their next message); `privateContent` holds view details worth restoring. Never save on load.
- For drill-down actions, add a clearly labeled button whose click handler calls `await window.kun.sendFollowUpMessage({ prompt, title })` with the selected values in the prompt. The user may be asked to confirm.
- Links: use normal `<a href="https://…">` anchors, or call `window.kun.openExternal({ href })` from a click handler. Only http(s) URLs open.

## Quality check before calling the tool
- Every queried element exists, no undefined identifiers, and the main interaction updates the visual.
- Text is legible in both light and dark themes, nothing overflows at a 360px width, and numbers that change use `.tabular-nums`.
