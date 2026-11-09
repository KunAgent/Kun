import { describe, expect, it } from 'vitest'
import { canvasSectionHeaderLayout } from './CanvasSectionsOverlay'

describe('section header overview layout', () => {
  it.each([0.05, 0.11, 0.25])('uses compact labels within the section width at zoom %s', (zoom) => {
    const layout = canvasSectionHeaderLayout(
      { x: 100, y: 600, width: 800, height: 844 },
      { x: 0, y: 0, width: 1000 / zoom, height: 800 / zoom }, 1000, 800
    )
    expect(layout.compact).toBe(true)
    expect(layout.width).toBeCloseTo(800 * zoom)
    expect(layout.height).toBe(20)
    expect(layout.top + layout.height).toBeCloseTo(layout.boardTop - 4)
  })

  it('leaves space for board chrome at normal zoom', () => {
    const layout = canvasSectionHeaderLayout(
      { x: 100, y: 600, width: 1280, height: 800 },
      { x: 0, y: 0, width: 2000, height: 1600 }, 1000, 800
    )
    expect(layout.compact).toBe(false)
    expect(layout.boardTop - layout.top - layout.height).toBe(30)
  })

  it('shares SVG meet scaling and letterbox offsets with board previews', () => {
    const layout = canvasSectionHeaderLayout(
      { x: 1000, y: 500, width: 390, height: 844 },
      { x: 1000, y: 500, width: 1600, height: 1000 }, 1200, 800
    )
    expect(layout.zoom).toBe(0.75)
    expect(layout.left).toBe(0)
    expect(layout.boardTop).toBe(25)
  })
})
