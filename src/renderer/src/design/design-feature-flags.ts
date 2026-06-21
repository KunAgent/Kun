/**
 * Feature flags for the design workspace.
 *
 * `DESIGN_CANVAS_ENABLED` gates the Figma-style SVG design canvas
 * (`kind: 'canvas'` artifacts — the ShapeOps editor, the canvas layers panel,
 * the canvas section in the sidebar, and the "新建画布" entry point). It is
 * hidden while the canvas is still under development; all of the underlying
 * code is intact, so flipping this back to `true` restores the feature.
 *
 * The HTML design flow (DesignProjectCanvas, artifact previews, implement →
 * code) is unaffected by this flag.
 */
export const DESIGN_CANVAS_ENABLED: boolean = false
