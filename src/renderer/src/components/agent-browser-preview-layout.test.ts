import { describe, expect, it } from 'vitest'
import {
  BROWSER_PREVIEW_CHROME, moveBrowserPreview, resizeBrowserPreview, resolveBrowserPreviewFrame,
  type BrowserPreviewResizeDirection
} from './agent-browser-preview-layout'

const container = { width: 1200, height: 900 }
const start = { x: 200, y: 150, width: 642, height: 522 }

describe('browser floating preview layout', () => {
  it('starts with a 640 by 400 readable viewport and clamps dragging inside the conversation', () => {
    const frame = resolveBrowserPreviewFrame(container)
    expect(frame).toEqual({ x: 546, y: 366, width: 642, height: 522 })
    expect(moveBrowserPreview({ x: -100, y: 2000 }, frame, container)).toEqual({ x: 12, y: 366 })
    expect(moveBrowserPreview({ x: 2000, y: -100 }, frame, container)).toEqual({ x: 546, y: 12 })
  })

  it('fits a small conversation without overwriting the width chosen for a larger one', () => {
    const geometry = { width: 642, position: { x: 100, y: 100 } }
    const small = resolveBrowserPreviewFrame({ width: 200, height: 120 }, geometry)
    expect(small.width).toBe(176)
    expect(small.height).toBe(96)
    expect(small.x).toBeGreaterThanOrEqual(0)
    expect(small.y).toBeGreaterThanOrEqual(0)
    expect(resolveBrowserPreviewFrame(container, geometry).width).toBe(642)
  })

  it('reserves a useful fallback instead of rendering a miniature page', () => {
    expect(resolveBrowserPreviewFrame({ width: 600, height: 350 })).toMatchObject({ width: 576, height: 326 })
  })

  it('expands to a centered 920 by 575 viewport without changing saved geometry', () => {
    const geometry = { width: 482, position: { x: 20, y: 30 } }
    expect(resolveBrowserPreviewFrame(container, geometry, false, true)).toEqual({ x: 139, y: 102, width: 922, height: 697 })
    expect(resolveBrowserPreviewFrame(container, geometry)).toEqual({ x: 20, y: 30, width: 482, height: 422 })
  })

  it('keeps the opposite corner anchored during proportional resizing', () => {
    expect(resizeBrowserPreview(start, 'se', { x: 160, y: 100 }, container))
      .toEqual({ x: 200, y: 150, width: 802, height: 622 })
    expect(resizeBrowserPreview(start, 'nw', { x: -160, y: -100 }, container))
      .toEqual({ x: 40, y: 50, width: 802, height: 622 })
  })

  it.each(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as BrowserPreviewResizeDirection[])('keeps %s resizing bounded and preserves the page aspect ratio, excluding chrome', (direction) => {
    const frame = resizeBrowserPreview(start, direction, { x: 4000, y: -4000 }, container)
    expect(frame.x).toBeGreaterThanOrEqual(12)
    expect(frame.y).toBeGreaterThanOrEqual(12)
    expect(frame.x + frame.width).toBeLessThanOrEqual(container.width - 12)
    expect(frame.y + frame.height).toBeLessThanOrEqual(container.height - 12)
    expect((frame.width - 2) / (frame.height - BROWSER_PREVIEW_CHROME)).toBeCloseTo(1.6, 1)
  })

  it('makes approval readable without losing the chosen compact size', () => {
    const geometry = { width: 482, position: { x: 500, y: 200 } }
    expect(resolveBrowserPreviewFrame(container, geometry, true).width).toBe(642)
    expect(resolveBrowserPreviewFrame(container, geometry).width).toBe(482)
  })
})
