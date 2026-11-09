import { describe, expect, it } from 'vitest'
import { PET_ROWS } from '@shared/pets'
import { frameAtElapsedMs, nextFrameDelayMs, totalCycleDurationMs } from './pet-animation'
import { PetAnimationLoop, type PetPaintTime } from './pet-animation-loop'

function fixture(paint: (time: PetPaintTime) => number | void, hz = 60) {
  let now = 0, id = 0
  const tasks = new Map<number, { at: number; callback: () => void }>()
  const add = (callback: () => void, at: number): number => { tasks.set(++id, { at, callback }); return id }
  const loop = new PetAnimationLoop({ now: () => now,
    frame: (callback) => add(callback, now + 1000 / hz), cancelFrame: (key) => { tasks.delete(key) },
    delay: (callback, ms) => add(callback, now + ms), cancelDelay: (key) => { tasks.delete(key) }
  }, paint)
  const advance = (ms: number): void => {
    const end = now + ms
    for (;;) {
      const next = [...tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!next || next[1].at > end) break
      now = next[1].at; tasks.delete(next[0]); next[1].callback()
    }
    now = end
  }
  return { loop, advance, tasks }
}
const active = { hidden: false, paused: false, reduced: false }

describe('pet animation scheduling', () => {
  it('holds open eyes and traverses the eyelids in under a quarter second', () => {
    expect(totalCycleDurationMs('idle')).toBe(6600)
    expect(PET_ROWS.idle.frameDurationsMs.slice(1, 5).reduce((a, b) => a + b)).toBeLessThan(250)
    expect(frameAtElapsedMs('idle', 3199).column).toBe(0)
    expect(frameAtElapsedMs('idle', 3435).column).toBe(5)
    expect(nextFrameDelayMs('idle', 3250)).toBe(5)
    const end = totalCycleDurationMs('waving') * 3
    expect(nextFrameDelayMs('waving', end)).toBe(3200)
  })

  it('sleeps between sprite boundaries and cancels the queued wake on disposal', () => {
    const frames: number[] = []
    const f = fixture(({ elapsed }) => {
      frames.push(frameAtElapsedMs('idle', elapsed).column)
      return nextFrameDelayMs('idle', elapsed)
    })
    f.loop.update(active)
    f.advance(10000)
    expect(frames.slice(0, 7)).toEqual([0, 1, 2, 3, 4, 5, 0])
    expect(frames.length).toBeLessThan(13)
    f.loop.dispose(); expect(f.tasks.size).toBe(0)
  })

  it.each([60, 120])('paints continuous motion at %s Hz without a second throttle', (hz) => {
    const frames: number[] = []
    const f = fixture(({ elapsed }) => { frames.push(elapsed) }, hz)
    f.loop.update(active); f.advance(1000)
    expect(frames.length).toBeGreaterThanOrEqual(hz)
    expect(frames.length).toBeLessThanOrEqual(hz + 1)
    f.loop.dispose()
  })

  it.each(['paused', 'hidden', 'reduced'] as const)('stops scheduling while %s and resumes without a time jump', (mode) => {
    const samples: PetPaintTime[] = []
    const f = fixture((time) => { samples.push(time) })
    f.loop.update(active); f.advance(100)
    f.loop.update({ ...active, [mode]: true }); const stopped = samples.length
    f.advance(30000)
    expect(samples.length).toBe(stopped); expect(f.tasks.size).toBe(0)
    f.loop.update(active); f.advance(20)
    expect(samples.at(-1)!.elapsed).toBeLessThan(125)
    f.loop.dispose()
  })
})
