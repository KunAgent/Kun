export type RectEdges = {
  left: number
  top: number
  right: number
  bottom: number
}

export type RectSize = {
  width: number
  height: number
}

export type PageLocalRect = {
  x: number
  y: number
  width: number
  height: number
}

function renderedScale(renderedSize: number, localSize: number): number {
  const scale = localSize > 0 ? renderedSize / localSize : 1
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

/** Convert viewport coordinates back into the page's pre-CSS-zoom space. */
export function viewportRectToPageLocalRect(
  rect: RectEdges,
  renderedPage: RectEdges & RectSize,
  localPage: RectSize
): PageLocalRect {
  const scaleX = renderedScale(renderedPage.width, localPage.width)
  const scaleY = renderedScale(renderedPage.height, localPage.height)
  return {
    x: (rect.left - renderedPage.left) / scaleX,
    y: (rect.top - renderedPage.top) / scaleY,
    width: (rect.right - rect.left) / scaleX,
    height: (rect.bottom - rect.top) / scaleY
  }
}
