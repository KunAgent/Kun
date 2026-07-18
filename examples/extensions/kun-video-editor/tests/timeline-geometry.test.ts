import { describe, expect, it } from 'vitest'
import {
  createTimelineViewport,
  frameToTimelineX,
  hitTestTimeline,
  layoutTimelineItems,
  normalizeTimelineRange,
  scrollTimelineBy,
  timelineXToFrame,
  visibleTimelineRange,
  zoomTimelineAt
} from '../src/engine/timeline-geometry.js'

const lanes = [
  { trackId: 'video-1', top: 0, height: 40, order: 0 },
  { trackId: 'audio-1', top: 44, height: 32, order: 1 }
]

describe('timeline geometry', () => {
  it('converts frames and pixels round-trip and preserves the zoom anchor', () => {
    const viewport = createTimelineViewport({
      scrollFrame: 100,
      pixelsPerFrame: 2,
      widthPixels: 600,
      durationFrames: 1_000
    })
    expect(frameToTimelineX(viewport, 175)).toBe(150)
    expect(timelineXToFrame(viewport, 150, 'round')).toBe(175)

    const zoomed = zoomTimelineAt(viewport, 240, 4)
    expect(timelineXToFrame(zoomed, 240)).toBe(timelineXToFrame(viewport, 240))
    expect(visibleTimelineRange(zoomed)).toEqual({ startFrame: 160, endFrame: 310 })
    expect(scrollTimelineBy(zoomed, 80).scrollFrame).toBe(180)
  })

  it('normalizes reverse range selection and clamps scrolling at duration', () => {
    expect(normalizeTimelineRange(90, 30)).toEqual({ startFrame: 30, endFrame: 90 })
    expect(createTimelineViewport({
      scrollFrame: 999,
      pixelsPerFrame: 2,
      widthPixels: 200,
      durationFrames: 500
    }).scrollFrame).toBe(400)
  })

  it('window-lays out many clips and reports virtualization counts', () => {
    const items = Array.from({ length: 300 }, (_, index) => ({
      id: `clip-${index}`,
      trackId: index % 2 === 0 ? 'video-1' : 'audio-1',
      startFrame: index * 10,
      endFrame: index * 10 + 8
    }))
    const result = layoutTimelineItems({
      scrollFrame: 1_000,
      pixelsPerFrame: 1,
      widthPixels: 300,
      durationFrames: 3_000
    }, lanes, items, 0)

    expect(result.items.length).toBe(30)
    expect(result.hiddenBefore).toBe(100)
    expect(result.hiddenAfter).toBe(170)
    expect(result.items[0]).toMatchObject({ left: 0, width: 8, top: 0 })
    expect(result.truncated).toBe(0)
  })

  it('hard-bounds a 64-track, ten-thousand-clip visible window', () => {
    const manyLanes = Array.from({ length: 64 }, (_, index) => ({
      trackId: `track-${index}`,
      top: index * 20,
      height: 20,
      order: index
    }))
    const items = Array.from({ length: 10_000 }, (_, index) => ({
      id: `dense-${index}`,
      trackId: `track-${index % manyLanes.length}`,
      startFrame: 0,
      endFrame: 10
    }))
    const result = layoutTimelineItems({
      scrollFrame: 0,
      pixelsPerFrame: 1,
      widthPixels: 300,
      durationFrames: 300
    }, manyLanes, items, 0)

    expect(result.items).toHaveLength(2_000)
    expect(result.truncated).toBe(8_000)
    expect(result.hiddenBefore + result.hiddenAfter).toBe(0)
  })

  it('hit-tests playhead, trim handles, clip body, range, lane, and time', () => {
    const viewport = createTimelineViewport({
      scrollFrame: 0,
      pixelsPerFrame: 2,
      widthPixels: 600,
      durationFrames: 500
    })
    const itemRects = layoutTimelineItems(viewport, lanes, [{
      id: 'clip-a',
      trackId: 'video-1',
      startFrame: 20,
      endFrame: 80
    }], 0).items

    expect(hitTestTimeline({ viewport, lanes, itemRects, x: 100, y: 20, playheadFrame: 50 }))
      .toEqual({ kind: 'playhead', frame: 50 })
    expect(hitTestTimeline({ viewport, lanes, itemRects, x: 41, y: 20 }))
      .toMatchObject({ kind: 'item', itemId: 'clip-a', region: 'trim-start' })
    expect(hitTestTimeline({ viewport, lanes, itemRects, x: 100, y: 20 }))
      .toMatchObject({ kind: 'item', itemId: 'clip-a', region: 'body', frame: 50 })
    expect(hitTestTimeline({ viewport, lanes, itemRects, x: 159, y: 20 }))
      .toMatchObject({ kind: 'item', itemId: 'clip-a', region: 'trim-end' })
    expect(hitTestTimeline({
      viewport,
      lanes,
      itemRects,
      x: 200,
      y: 90,
      selectedRange: { startFrame: 90, endFrame: 120 }
    })).toMatchObject({ kind: 'range', frame: 100 })
    expect(hitTestTimeline({ viewport, lanes, itemRects, x: 400, y: 50 }))
      .toEqual({ kind: 'empty', frame: 200, trackId: 'audio-1' })
  })
})
