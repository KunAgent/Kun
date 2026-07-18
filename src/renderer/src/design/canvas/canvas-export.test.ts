import { describe, expect, it, vi } from 'vitest'
import { createDefaultShape, createEmptyDocument } from './canvas-types'
import {
  bytesToBase64,
  canvasExportBounds,
  canvasRasterScale,
  extractCanvasAgentExportRequest,
  resolveCanvasExportImageSources
} from './canvas-export'

describe('canvas export bounds', () => {
  it('fits visible diagram content with export padding', () => {
    const document = createEmptyDocument()
    const rect = createDefaultShape('rect', 10, 20)
    rect.width = 100
    rect.height = 60
    document.objects[rect.id] = { ...rect, parentId: document.rootId }
    document.objects[document.rootId]!.children.push(rect.id)

    expect(canvasExportBounds(document, 10)).toEqual({ x: 0, y: 10, width: 120, height: 80 })
  })

  it('does not export an empty board', () => {
    expect(canvasExportBounds(createEmptyDocument())).toBeNull()
  })

  it('keeps normal diagrams at 2x and caps huge raster exports below the IPC byte ceiling', () => {
    expect(canvasRasterScale({ width: 1200, height: 800 })).toBe(2)
    const largeScale = canvasRasterScale({ width: 5000, height: 5000 })
    expect(largeScale).toBeCloseTo(Math.sqrt(10 * 1024 * 1024) / 5000)
    expect(Math.floor(5000 * largeScale) ** 2).toBeLessThanOrEqual(10 * 1024 * 1024)
  })

  it('base64-encodes large byte arrays without padding between chunks', () => {
    const bytes = Uint8Array.from({ length: 0x6000 + 5 }, (_, index) => index % 251)
    const wholeBinary = String.fromCharCode(...bytes)
    expect(bytesToBase64(bytes, btoa)).toBe(btoa(wholeBinary))
  })
})

describe('canvas agent export request', () => {
  it('accepts a matching deterministic PNG request', () => {
    expect(extractCanvasAgentExportRequest({
      exportRequest: {
        format: 'png',
        fileName: 'architecture-a1b2c3.png',
        relativePath: '.deepseekgui-images/architecture-a1b2c3.png'
      }
    })).toEqual({
      format: 'png',
      fileName: 'architecture-a1b2c3.png',
      relativePath: '.deepseekgui-images/architecture-a1b2c3.png'
    })
  })

  it('rejects traversal and extension mismatches', () => {
    expect(extractCanvasAgentExportRequest({
      exportRequest: {
        format: 'png',
        fileName: '../architecture.png',
        relativePath: '.deepseekgui-images/../architecture.png'
      }
    })).toBeNull()
    expect(extractCanvasAgentExportRequest({
      exportRequest: {
        format: 'svg',
        fileName: 'architecture.png',
        relativePath: '.deepseekgui-images/architecture.png'
      }
    })).toBeNull()
  })
})

describe('canvas export image sources', () => {
  it('inlines visible workspace SVG images and deduplicates repeated reads', async () => {
    const document = createEmptyDocument()
    const first = createDefaultShape('image', 0, 0)
    first.name = 'Architecture SVG'
    first.imageUrl = 'assets/architecture.svg'
    const second = createDefaultShape('image', 200, 0)
    second.imageUrl = first.imageUrl
    const hidden = createDefaultShape('image', 400, 0)
    hidden.visible = false
    hidden.imageUrl = 'assets/hidden.svg'
    for (const shape of [first, second, hidden]) {
      document.objects[shape.id] = { ...shape, parentId: document.rootId }
      document.objects[document.rootId]!.children.push(shape.id)
    }
    const dataUrl = 'data:image/svg+xml;base64,PHN2Zy8+'
    const loadImageSource = vi.fn(async () => dataUrl)

    const resolved = await resolveCanvasExportImageSources({
      document,
      workspaceRoot: '/workspace',
      loadImageSource
    })

    expect(loadImageSource).toHaveBeenCalledOnce()
    expect(loadImageSource).toHaveBeenCalledWith('/workspace', 'assets/architecture.svg')
    expect(resolved).toEqual(new Map([
      [first.id, dataUrl],
      [second.id, dataUrl]
    ]))
  })

  it('fails instead of silently exporting an unresolved image placeholder', async () => {
    const document = createEmptyDocument()
    const image = createDefaultShape('image', 0, 0)
    image.name = 'Missing SVG'
    image.imageUrl = 'assets/missing.svg'
    document.objects[image.id] = { ...image, parentId: document.rootId }
    document.objects[document.rootId]!.children.push(image.id)

    await expect(resolveCanvasExportImageSources({
      document,
      workspaceRoot: '/workspace',
      loadImageSource: async () => null
    })).rejects.toThrow('Whiteboard image "Missing SVG" is unavailable for export')
  })
})
