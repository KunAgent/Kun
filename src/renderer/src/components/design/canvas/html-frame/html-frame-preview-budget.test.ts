import { describe, expect, it } from 'vitest'
import { createHtmlFrameShape } from '../../../../design/canvas/canvas-types'
import { HtmlFrameThumbnailCache, selectHtmlFramePreviewBudget } from './html-frame-preview-budget'

const frames = Array.from({ length: 24 }, (_, index) => ({
  ...createHtmlFrameShape(`Screen ${index}`, 0, 0, `artifact-${index}`, 'mobile'),
  id: `frame-${index}`
}))

describe('whiteboard preview budget', () => {
  it('progressively covers every board at 11% instead of dropping the first boards after ten', () => {
    const pending = new Set(frames.map((frame) => frame.id))
    const captured = new Set<string>()
    for (let step = 0; step < 12; step++) {
      const { liveIds, captureIds } = selectHtmlFramePreviewBudget(frames, new Set(), pending, 0.11)
      expect(liveIds.size).toBe(0)
      expect(captureIds.size).toBe(2)
      for (const id of captureIds) { pending.delete(id); captured.add(id) }
    }
    expect(captured.size).toBe(24)
    expect(selectHtmlFramePreviewBudget(frames, new Set(), pending, 0.11).captureIds.size).toBe(0)
  })

  it.each([0.05, 0.11, 0.25, 0.35, 0.5, 1])('bounds native guests at zoom %s and prioritizes selection', (zoom) => {
    const { liveIds, captureIds } = selectHtmlFramePreviewBudget(frames, new Set(['frame-0']), new Set(frames.map((f) => f.id)), zoom)
    expect(liveIds.has('frame-0')).toBe(true)
    expect(liveIds.size + captureIds.size).toBeLessThanOrEqual(10)
    expect([...captureIds].every((id) => !liveIds.has(id))).toBe(true)
  })

  it('reserves capture capacity even when many boards are selected', () => {
    const ids = new Set(frames.map((f) => f.id))
    const budget = selectHtmlFramePreviewBudget(frames, ids, ids, 0.11)
    expect(budget.liveIds.size).toBe(8)
    expect(budget.captureIds.size).toBe(2)
  })

  it('keeps paint order inputs unchanged', () => {
    const order = frames.map((f) => f.id)
    selectHtmlFramePreviewBudget(frames, new Set(), new Set(), 1)
    expect(frames.map((f) => f.id)).toEqual(order)
  })
})

describe('thumbnail memory budget', () => {
  it('evicts old images by bytes and correctly accounts for replacements', () => {
    const cache = new HtmlFrameThumbnailCache(20, 10)
    cache.set('a', '12345')
    cache.set('b', '12345')
    cache.set('a', '123')
    cache.set('c', '12')
    expect(cache.get('b')).toBe('12345')
    cache.set('d', '1')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe('123')
    cache.set('huge', 'x'.repeat(11))
    expect(cache.get('huge')).toBeUndefined()
  })

  it('bounds entry count and separates revision and workspace keys', () => {
    const cache = new HtmlFrameThumbnailCache(100, 2)
    cache.set('workspace-a:revision1', 'first')
    cache.set('workspace-a:revision2', 'new')
    cache.set('workspace-b:revision1', 'other')
    expect(cache.get('workspace-a:revision1')).toBeUndefined()
    expect(cache.get('workspace-a:revision2')).toBe('new')
    expect(cache.get('workspace-b:revision1')).toBe('other')
  })
})
