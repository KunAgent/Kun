import { describe, expect, it } from 'vitest'
import {
  retimeKeyframeTrack,
  sampleKeyframeTrack,
  sampleKeyframedProperties,
  splitKeyframeTrack,
  trimKeyframeTrack
} from '../src/engine/keyframes.js'
import type { KeyframeTrack } from '../src/engine/schema.js'

const track: KeyframeTrack = {
  id: 'opacity-track',
  property: 'opacity',
  interpolation: 'linear',
  points: [
    { id: 'p0', frame: 0, value: 0 },
    { id: 'p1', frame: 50, value: 1 },
    { id: 'p2', frame: 100, value: 0 }
  ]
}

describe('keyframe planning', () => {
  it('samples hold, linear, and eased interpolation deterministically', () => {
    expect(sampleKeyframeTrack(track, 25)).toBe(0.5)
    expect(sampleKeyframeTrack({ ...track, interpolation: 'hold' }, 25)).toBe(0)
    expect(sampleKeyframeTrack({ ...track, interpolation: 'ease' }, 12)).toBeCloseTo(0.145152)
    expect(sampleKeyframeTrack(track, 200)).toBe(0)
    expect(sampleKeyframedProperties([track], 75)).toEqual({ opacity: 0.5 })
  })

  it('trims with synthesized boundary values and reports dropped points', () => {
    const result = trimKeyframeTrack(track, 25, 75)
    expect(result.track.points).toEqual([
      { id: 'opacity-track~start', frame: 0, value: 0.5 },
      { id: 'p1', frame: 25, value: 1 },
      { id: 'opacity-track~end', frame: 50, value: 0.5 }
    ])
    expect(result.notes).toEqual(expect.arrayContaining([
      { code: 'dropped-before', count: 1 },
      { code: 'dropped-after', count: 1 },
      { code: 'synthesized-start', count: 1 },
      { code: 'synthesized-end', count: 1 }
    ]))
  })

  it('splits into clip-local tracks with a shared sampled boundary', () => {
    const { left, right } = splitKeyframeTrack(track, 40, 100)
    expect(left.track.points.at(-1)).toMatchObject({ frame: 40, value: 0.8 })
    expect(right.track.points[0]).toMatchObject({ frame: 0, value: 0.8 })
    expect(right.track.points.at(-1)).toMatchObject({ frame: 60, value: 0 })
  })

  it('retimes, bounds the end, and deterministically deduplicates rounded frames', () => {
    const result = retimeKeyframeTrack({
      ...track,
      points: [
        { id: 'a', frame: 0, value: 0 },
        { id: 'b', frame: 1, value: 0.5 },
        { id: 'c', frame: 2, value: 1 }
      ]
    }, 100, 2)
    expect(result.track.points).toEqual([
      { id: 'c', frame: 0, value: 1 }
    ])
    expect(result.notes).toContainEqual({ code: 'deduplicated', count: 2 })
  })

  it('rejects unsorted or duplicate keyframe frames', () => {
    expect(() => sampleKeyframeTrack({
      ...track,
      points: [
        { id: 'a', frame: 10, value: 0 },
        { id: 'b', frame: 10, value: 1 }
      ]
    }, 10)).toThrow(/strictly frame-sorted/)
  })
})
