type PdfTextLayerStyle = Pick<CSSStyleDeclaration, 'setProperty'>

export type PdfTextLayerViewportScale = {
  scale: number
  userUnit: number
}

/**
 * pdf.js positions TextLayer spans with CSS calculations based on these
 * variables. Without them, the inline font-size/width declarations are
 * invalid and the invisible selection layer no longer matches the canvas.
 */
export function applyPdfTextLayerScale(
  style: PdfTextLayerStyle,
  viewport: PdfTextLayerViewportScale
): void {
  style.setProperty('--scale-factor', String(viewport.scale))
  style.setProperty('--user-unit', String(viewport.userUnit))
  style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit))
  style.setProperty('--scale-round-x', '1px')
  style.setProperty('--scale-round-y', '1px')
}

/**
 * PDF.js measures and caches its minimum browser font size synchronously when
 * TextLayer rendering starts. Measuring beneath the app's body zoom makes the
 * invisible hit layer smaller than the canvas whenever UI scale is below 1.
 * Restore the zoom immediately after render() returns its promise so the page
 * never paints at the temporary scale.
 */
export function startPdfTextLayerRenderWithoutUiZoom<T>(
  render: () => T,
  bodyStyle: Pick<CSSStyleDeclaration, 'zoom'> = document.body.style
): T {
  const previousZoom = bodyStyle.zoom
  bodyStyle.zoom = '1'
  try {
    return render()
  } finally {
    bodyStyle.zoom = previousZoom
  }
}
