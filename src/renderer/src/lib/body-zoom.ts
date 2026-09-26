/**
 * The shell scales the whole UI with `body { zoom: var(--ds-ui-scale) }`
 * (see styles/base-shell/window-navigation-logo.css). In current Electron,
 * `getBoundingClientRect`, `view.coordsAtPos`, and floating-ui all return
 * viewport coordinates already multiplied by that zoom, while `style.left`
 * and `style.top` on elements inside `body` are interpreted in pre-zoom CSS
 * pixels and get scaled again on render. Every overlay positioned from
 * measured rectangles must convert back through `toLayoutPx` first.
 * `scrollTop`/`scrollLeft` are already CSS pixels and must not be divided.
 */
export function bodyZoom(): number {
  if (typeof window === 'undefined') return 1
  const parsed = Number.parseFloat(window.getComputedStyle(document.body).zoom)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export function toLayoutPx(visualPx: number, zoom = bodyZoom()): number {
  return visualPx / zoom
}
