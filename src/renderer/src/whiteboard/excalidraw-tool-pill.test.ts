import { describe, expect, it } from 'vitest'
import { EXCALIDRAW_PILL_COMPACT_WIDTH, excalidrawPillLayout } from './excalidraw-tool-pill'

describe('excalidrawPillLayout', () => {
  it('keeps every shape inline on a wide board', () => {
    const { inline, overflow } = excalidrawPillLayout(900)
    expect(inline.map((tool) => tool.type)).toContain('image')
    expect(overflow.map((tool) => tool.type)).toEqual(['laser', 'frame', 'embeddable'])
  })

  it('moves line, image and eraser into the overflow menu on a narrow board', () => {
    const { inline, overflow } = excalidrawPillLayout(EXCALIDRAW_PILL_COMPACT_WIDTH - 1)
    expect(inline.map((tool) => tool.type)).toEqual(['rectangle', 'diamond', 'ellipse', 'arrow', 'freedraw', 'text'])
    expect(overflow.map((tool) => tool.type)).toEqual(['line', 'image', 'eraser', 'laser', 'frame', 'embeddable'])
  })

  it('treats an unmeasured board as wide', () => {
    expect(excalidrawPillLayout(0).inline).toHaveLength(9)
  })
})
