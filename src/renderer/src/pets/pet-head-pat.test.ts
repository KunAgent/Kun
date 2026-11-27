import { describe, expect, it, vi } from 'vitest'
import { happyFrameColumn, PetHeadPatTracker } from './pet-head-pat'

describe('KuroCat-style pet head-patting tracker', () => {
  it('maps built-in pets to their verified closed-eye / happy-squint idle columns', () => {
    expect(happyFrameColumn('kun:xiao-kun')).toBe(3)
    expect(happyFrameColumn('kun:whale-girl')).toBe(3)
    expect(happyFrameColumn('kun:kurocat')).toBe(3)
    expect(happyFrameColumn('kun:ikun')).toBe(2)
    expect(happyFrameColumn('codex-custom:cat')).toBe(2)
  })

  it('ignores straight pass-throughs and lower-feet movement, then unlocks happy squint + hearts on back-and-forth head rub', () => {
    const tracker = new PetHeadPatTracker()
    const wake = vi.fn()
    tracker.setWake(wake)

    // Straight pass across the head in one direction does not falsely trigger petting.
    expect(tracker.noteMove(-0.4, -0.3, 0, 1000, 'kun:whale-girl')).toBe(false)
    expect(tracker.noteMove(-0.1, -0.3, 0, 1016, 'kun:whale-girl')).toBe(false)
    expect(tracker.noteMove(0.2, -0.3, 0, 1032, 'kun:whale-girl')).toBe(false)
    expect(wake).not.toHaveBeenCalled()

    // Reversing back across the head completes a rub stroke and activates cozy squint + floating particles.
    expect(tracker.noteMove(-0.05, -0.28, 0, 1048, 'kun:whale-girl')).toBe(true)
    expect(wake).toHaveBeenCalledTimes(1)

    let frame = tracker.step(1048, false)
    for (let t = 1064; t <= 1220; t += 16) frame = tracker.step(t, false)
    expect(frame.active).toBe(true)
    expect(frame.squint).toBeGreaterThan(0.75)
    expect(frame.particles.length).toBeGreaterThan(0)
    expect(frame.moving).toBe(true)

    // Leaving decays energy, squint, and particles cleanly back to zero-CPU sleep.
    tracker.leave()
    for (let t = 1240; t <= 3200; t += 40) frame = tracker.step(t, false)
    expect(frame.active).toBe(false)
    expect(frame.squint).toBe(0)
    expect(frame.particles).toHaveLength(0)
    expect(frame.moving).toBe(false)

    // Rubbing below the head zone (bottom feet / toolbar bridge) never triggers head-patting.
    expect(tracker.noteMove(-0.3, 0.72, 0, 3300, 'kun:xiao-kun')).toBe(false)
    expect(tracker.noteMove(0.3, 0.72, 0, 3320, 'kun:xiao-kun')).toBe(false)
    expect(tracker.noteMove(-0.3, 0.72, 0, 3340, 'kun:xiao-kun')).toBe(false)
    expect(tracker.isActive()).toBe(false)
  })

  it('activates cozy patting on a gentle click/tap without dragging', () => {
    const tracker = new PetHeadPatTracker()
    expect(tracker.noteTap(0.1, -0.2, 2000, 'kun:xiao-kun')).toBe(true)
    let frame = tracker.step(2000, false)
    for (let t = 2016; t <= 2160; t += 16) frame = tracker.step(t, false)
    expect(frame.active).toBe(true)
    expect(frame.particles.length).toBeGreaterThanOrEqual(2)
  })
})
