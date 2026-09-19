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

  it('tells the agent to write the scene file and apply it', () => {
    const prompt = formatExcalidrawScenePrompt({
      elements: [{ type: 'text', text: 'Checkout' }]
    }, { scenePath: '.kun-design/doc/excalidraw.json' })
    expect(prompt).toContain('Do not call design_update_shapes')
    expect(prompt).toContain('Checkout')
    expect(prompt).toContain('.kun-design/doc/excalidraw.json')
    expect(prompt).toContain('design_apply_excalidraw')
    expect(prompt).not.toContain('The user draws in Excalidraw')
    expect(formatExcalidrawScenePrompt(null)).toContain('empty')
  })
})
