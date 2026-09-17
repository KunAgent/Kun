import { describe, expect, it } from 'vitest'
import { formatExcalidrawScenePrompt, summarizeExcalidrawScene } from './excalidraw-outbound'

describe('excalidraw outbound', () => {
  it('summarizes live elements and skips deleted ones', () => {
    const summary = summarizeExcalidrawScene({
      elements: [
        { type: 'arrow', isDeleted: true },
        { type: 'text', text: 'API gateway', isDeleted: false },
        { type: 'rectangle' }
      ]
    })
    expect(summary.elementCount).toBe(2)
    expect(summary.elements).toEqual([
      { type: 'text', text: 'API gateway' },
      { type: 'rectangle' }
    ])
  })

  it('tells the agent not to mutate ShapeOps on an Excalidraw board', () => {
    const prompt = formatExcalidrawScenePrompt({
      elements: [{ type: 'text', text: 'Checkout' }]
    })
    expect(prompt).toContain('Do not call design_update_shapes')
    expect(prompt).toContain('Checkout')
    expect(formatExcalidrawScenePrompt(null)).toContain('empty')
  })
})
