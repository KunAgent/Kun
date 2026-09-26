import { describe, expect, it } from 'vitest'
import {
  canvasEnginePersistField,
  isKunCanvasDocumentEmpty,
  normalizeCanvasEngine
} from './canvas-engine'

describe('canvas-engine', () => {
  it('treats missing and unknown values as kun', () => {
    expect(normalizeCanvasEngine(undefined)).toBe('kun')
    expect(normalizeCanvasEngine('canvas')).toBe('kun')
    expect(normalizeCanvasEngine('excalidraw')).toBe('excalidraw')
  })

  it('omits the default engine from persisted records', () => {
    expect(canvasEnginePersistField('kun')).toEqual({})
    expect(canvasEnginePersistField(undefined)).toEqual({})
    expect(canvasEnginePersistField('excalidraw')).toEqual({ engine: 'excalidraw' })
  })

  it('treats a root-only Kun document as empty', () => {
    expect(isKunCanvasDocumentEmpty(null)).toBe(true)
    expect(isKunCanvasDocumentEmpty({
      rootId: '__root__',
      objects: { __root__: { children: [] } }
    })).toBe(true)
    expect(isKunCanvasDocumentEmpty({
      rootId: '__root__',
      objects: { __root__: { children: ['shape-1'] } }
    })).toBe(false)
  })
})
