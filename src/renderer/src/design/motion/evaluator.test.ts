import { describe, expect, it } from 'vitest'
import type { CanvasMotionEasing, CanvasMotionTimeline, CanvasMotionTrack } from './canvas-motion-types'
import {
  advanceMotionPlayback,
  evaluateCubicBezier,
  evaluateMotionEasing,
  evaluateMotionTarget,
  evaluateMotionTrack,
  evaluateSpringEasing
} from './evaluator'

const linear = { type: 'linear' } as const

function track(overrides: Partial<CanvasMotionTrack> = {}): CanvasMotionTrack {
  return {
    id: 'track-x',
    targetShapeId: 'shape',
    property: 'x',
    operation: 'set',
    baseValue: 10,
    keyframes: [
      { id: 'key-0', timeMs: 0, value: 0, easing: linear },
      { id: 'key-1', timeMs: 1_000, value: 100, easing: linear }
    ],
    ...overrides
  }
}

describe('canvas motion evaluator', () => {
  it('interpolates set, offset, and scale tracks without changing their source', () => {
    const source = track()
    expect(evaluateMotionTrack(source, 500)).toBeCloseTo(50)
    expect(evaluateMotionTrack({ ...source, operation: 'offset' }, 500)).toBeCloseTo(60)
    expect(evaluateMotionTrack({ ...source, operation: 'offset' }, 500, 40)).toBeCloseTo(90)
    expect(evaluateMotionTrack({ ...source, operation: 'scale' }, 500)).toBeCloseTo(500)
    expect(source.keyframes[0].value).toBe(0)
  })

  it('never projects a non-finite result from finite persisted values', () => {
    const extreme = track({
      operation: 'scale',
      baseValue: Number.MAX_VALUE,
      keyframes: [
        { id: 'large-0', timeMs: 0, value: 2, easing: linear },
        { id: 'large-1', timeMs: 1_000, value: 2, easing: linear }
      ]
    })
    expect(evaluateMotionTrack(extreme, 500)).toBe(Number.MAX_VALUE)
    expect(Number.isFinite(evaluateCubicBezier(0.5, 0.5, Number.MAX_VALUE, 0.5, Number.MAX_VALUE))).toBe(true)
  })

  it('uses track-local keyframes with delay and an independently scaled span', () => {
    const delayed = track({ delayMs: 200, durationMs: 2_000 })
    expect(evaluateMotionTrack(delayed, 100)).toBe(0)
    expect(evaluateMotionTrack(delayed, 1_200)).toBeCloseTo(50)
    expect(evaluateMotionTrack(delayed, 2_200)).toBe(100)
  })

  it('evaluates named, hold, and cubic-bezier easing deterministically', () => {
    expect(evaluateMotionEasing(linear, 0.25)).toBe(0.25)
    expect(evaluateMotionEasing({ type: 'hold' }, 0.999)).toBe(0)
    expect(evaluateMotionEasing({ type: 'hold' }, 1)).toBe(1)
    expect(evaluateCubicBezier(0, 0.42, 0, 0.58, 1)).toBe(0)
    expect(evaluateCubicBezier(1, 0.42, 0, 0.58, 1)).toBe(1)
    expect(evaluateMotionEasing({ type: 'ease-in' }, 0.5)).toBeLessThan(0.5)
    expect(evaluateMotionEasing({ type: 'ease-out' }, 0.5)).toBeGreaterThan(0.5)
  })

  it('evaluates seekable underdamped, critical, and overdamped springs with exact endpoints', () => {
    const springs: CanvasMotionEasing[] = [
      { type: 'spring', mass: 1, stiffness: 120, damping: 8 },
      { type: 'spring', mass: 1, stiffness: 100, damping: 20 },
      { type: 'spring', mass: 1, stiffness: 100, damping: 30, initialVelocity: 2 }
    ]
    for (const spring of springs) {
      if (spring.type !== 'spring') continue
      expect(evaluateSpringEasing(0, spring)).toBe(0)
      expect(evaluateSpringEasing(1, spring)).toBe(1)
      expect(evaluateSpringEasing(0.37, spring)).toBe(evaluateSpringEasing(0.37, spring))
      expect(Number.isFinite(evaluateSpringEasing(0.5, spring))).toBe(true)
    }
  })

  it('evaluates a target projection and clamps absolute opacity', () => {
    const timeline: CanvasMotionTimeline = {
      id: 'timeline',
      frameId: '__root__',
      durationMs: 1_000,
      playback: 'once',
      tracks: [
        track(),
        track({
          id: 'track-opacity',
          property: 'opacity',
          baseValue: 1,
          keyframes: [
            { id: 'opacity-0', timeMs: 0, value: 1, easing: linear },
            { id: 'opacity-1', timeMs: 1_000, value: 2, easing: linear }
          ]
        })
      ]
    }

    expect(evaluateMotionTarget(timeline, 'shape', 500)).toEqual({ x: 50, opacity: 1 })
    expect(evaluateMotionTarget(timeline, 'other', 500)).toEqual({})
  })

  it('calculates once, loop, and ping-pong playback boundaries for arbitrary deltas', () => {
    expect(advanceMotionPlayback(900, 200, 1_000, 'once')).toEqual({
      timeMs: 1_000,
      direction: 1,
      playing: false,
      boundary: 'end'
    })
    expect(advanceMotionPlayback(900, 250, 1_000, 'loop')).toEqual({
      timeMs: 150,
      direction: 1,
      playing: true,
      boundary: 'wrapped'
    })
    expect(advanceMotionPlayback(900, 250, 1_000, 'ping-pong')).toEqual({
      timeMs: 850,
      direction: -1,
      playing: true,
      boundary: 'reversed'
    })
    expect(advanceMotionPlayback(1_000, 100, 1_000, 'ping-pong')).toMatchObject({
      timeMs: 900,
      direction: -1,
      boundary: 'reversed'
    })
    expect(advanceMotionPlayback(100, 250, 1_000, 'loop', -1)).toMatchObject({
      timeMs: 850,
      direction: -1,
      boundary: 'wrapped'
    })
    expect(advanceMotionPlayback(250, 100, 1_000, 'once', 1, 2)).toMatchObject({
      timeMs: 450,
      boundary: 'none'
    })
  })
})
