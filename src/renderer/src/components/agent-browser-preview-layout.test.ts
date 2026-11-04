import { describe, expect, it } from 'vitest'
import {
  BROWSER_PREVIEW_CHROME, moveBrowserPreview, resizeBrowserPreview, resolveBrowserPreviewFrame,
  type BrowserPreviewResizeDirection
} from './agent-browser-preview-layout'

const container = { width: 1000, height: 700 }
const start = { x: 300, y: 200, width: 320, height: 216 }

describe('browser floating preview layout', () => {
  it('starts as a compact preview above the conversation edge and clamps dragging inside it', () => {
    const frame = resolveBrowserPreviewFrame(container)
    expect(frame).toEqual({ x: 668, y: 472, width: 320, height: 216 })
    expect(moveBrowserPreview({ x: -100, y: 2000 }, frame, container)).toEqual({ x: 12, y: 472 })
    expect(moveBrowserPreview({ x: 2000, y: -100 }, frame, container)).toEqual({ x: 668, y: 12 })
  })

  it('fits a small conversation without overwriting the width chosen for a larger one', () => {
    const geometry = { width: 640, position: { x: 100, y: 100 } }
    const small = resolveBrowserPreviewFrame({ width: 200, height: 120 }, geometry)
    expect(small.width).toBeLessThanOrEqual(176)
    expect(small.height).toBeLessThanOrEqual(96)
    expect(small.x).toBeGreaterThanOrEqual(0)
    expect(small.y).toBeGreaterThanOrEqual(0)
    expect(resolveBrowserPreviewFrame(container, geometry).width).toBe(640)
  })

  it('keeps the opposite corner anchored during proportional resizing', () => {
    expect(resizeBrowserPreview(start, 'se', { x: 160, y: 100 }, container))
      .toEqual({ x: 300, y: 200, width: 480, height: 316 })
    expect(resizeBrowserPreview(start, 'nw', { x: -160, y: -100 }, container))
      .toEqual({ x: 140, y: 100, width: 480, height: 316 })
  })

  it.each(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as BrowserPreviewResizeDirection[])('keeps %s resizing within the conversation and preserves the page aspect ratio', (direction) => {
    const frame = resizeBrowserPreview(start, direction, { x: 4000, y: -4000 }, container)
    expect(frame.x).toBeGreaterThanOrEqual(12)
    expect(frame.y).toBeGreaterThanOrEqual(12)
    expect(frame.x + frame.width).toBeLessThanOrEqual(container.width - 12)
    expect(frame.y + frame.height).toBeLessThanOrEqual(container.height - 12)
    expect(frame.width / (frame.height - BROWSER_PREVIEW_CHROME)).toBeCloseTo(1.6, 1)
  })

  it('makes an approval readable without losing the chosen compact size', () => {
    const geometry = { width: 320, position: { x: 500, y: 200 } }
    expect(resolveBrowserPreviewFrame(container, geometry, true).width).toBe(480)
    expect(resolveBrowserPreviewFrame(container, geometry).width).toBe(320)
  })
})
