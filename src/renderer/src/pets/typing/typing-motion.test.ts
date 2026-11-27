import { describe, expect, it } from 'vitest'
import { updatePetTyping, type PetTypingState } from '@shared/pets-typing'
import { PetTypingMotion } from './typing-motion'

function advance(motion: PetTypingMotion, state: PetTypingState, start: number, end: number) {
  let result = motion.sample(state, start)
  for (let now = start + 8; now <= end; now += 8) result = motion.sample(state, now)
  return result
}

describe('Bongo-style typing motion', () => {
  it('shows a short tap even if press and release occur between frames, then settles', () => {
    const motion = new PetTypingMotion()
    const down = updatePetTyping(undefined, 1, 1, 1000), up = updatePetTyping(down, 0, 0, 1005)
    const peak = advance(motion, up, 1016, 1064)
    expect(peak.left.down).toBeGreaterThan(.85)
    expect(peak.right.down).toBe(0)
    const resting = advance(motion, up, 1064, 1600)
    expect(resting).toMatchObject({ left: { down: 0, glow: 0 }, right: { down: 0, glow: 0 }, moving: false })
  })
  it('holds without auto-tapping, releases smoothly, and synchronizes both paws on space', () => {
    const motion = new PetTypingMotion(), down = updatePetTyping(undefined, 3, 3, 1000)
    const held = advance(motion, down, 1000, 1800)
    expect(held.left.down).toBe(1); expect(held.right.down).toBe(1); expect(held.moving).toBe(false)
    const still = advance(motion, updatePetTyping(down, 3, 0, 1800), 1800, 2300)
    expect(still).toEqual(held)
    const up = updatePetTyping(down, 0, 0, 2300)
    expect(motion.sample(up, 2316).left.down).toBeGreaterThan(0)
    expect(advance(motion, up, 2316, 2800).left.down).toBe(0)
  })
  it('still animates a fresh key or release after the renderer slept between held-state updates', () => {
    const motion = new PetTypingMotion(), left = updatePetTyping(undefined, 1, 1, 1000)
    advance(motion, left, 1000, 1600)
    const both = updatePetTyping(left, 3, 2, 2200)
    const press = motion.sample(both, 2200)
    expect(press.left.down).toBe(1)
    expect(press.right.down).toBeGreaterThan(0)
    expect(press.right.down).toBeLessThan(1)
    advance(motion, both, 2200, 2800)
    const up = updatePetTyping(both, 0, 0, 3400)
    const release = motion.sample(up, 3400)
    expect(release.left.down).toBeGreaterThan(0)
    expect(release.left.down).toBeLessThan(1)
    expect(advance(motion, up, 3400, 3900).left.down).toBe(0)
  })

  it('does not replay an old hit on resume and keeps reduced-motion feedback state-based', () => {
    const motion = new PetTypingMotion(), down = updatePetTyping(undefined, 2, 2, 1000)
    motion.sample(down, 1000)
    const up = updatePetTyping(down, 0, 0, 1020)
    expect(motion.sample(up, 5000).right.down).toBe(0)
    expect(motion.sample(down, 5010, true)).toMatchObject({ left: { down: 0 }, right: { down: 1 }, moving: false })
    expect(motion.sample(up, 5020, true)).toMatchObject({ right: { down: 0, glow: 0 }, moving: false })
  })

  it('leads with eye gaze ahead of head tilt, supports concurrent mouse + 1-hand typing, and settles to sleep', () => {
    const motion = new PetTypingMotion()
    const cursor = { nx: 0.8, ny: 0.4, gx: 0.9, gy: -0.3, buttons: 1, wheelSeq: 1, wheelDir: -1 as const, deskActiveAt: 1000, active: true }
    const early = motion.sample(undefined, 1032, false, false, { cursor, typingActive: false })
    expect(early.gaze!.x / 0.9).toBeGreaterThan((early.headTilt! / (0.9 * 0.066)))

    // Press a left-hand key (e.g. WASD) while viewer-left paw (pet's right hand) holds the left-side mouse:
    // viewer-right paw strikes cleanly while viewer-left paw stays on the mouse.
    const typed = updatePetTyping(undefined, 1, 1, 1100, { col: 1, row: 1 })
    let concurrent = motion.sample(typed, 1100, false, false, { cursor, typingActive: true })
    for (let now = 1108; now <= 1160; now += 8) {
      concurrent = motion.sample(typed, now, false, false, { cursor, typingActive: true })
    }
    expect(concurrent.left.onMouse).toBe(true)
    expect(concurrent.right.down).toBeGreaterThan(0.8)
    expect(concurrent.mouse?.leftButton).toBe(true)
    expect(concurrent.mouse?.wheelGlow).toBeGreaterThan(0)
    expect(concurrent.pops?.some((p) => p.kind === 'key')).toBe(true)

    // When mouse button is released and a newer right-hand key is struck, viewer-left paw immediately returns to keyboard.
    const releasedMouse = { ...cursor, buttons: 0, deskActiveAt: 1100 }
    const rightKey = updatePetTyping(typed, 2, 2, 1180, { col: 5, row: 1 })
    let twoHand = motion.sample(rightKey, 1180, false, false, { cursor: releasedMouse, typingActive: true })
    for (let now = 1188; now <= 1300; now += 8) {
      twoHand = motion.sample(rightKey, now, false, false, { cursor: releasedMouse, typingActive: true })
    }
    expect(twoHand.left.onMouse).toBe(false)
    expect(twoHand.left.down).toBeGreaterThan(0.8)

    // Space strike highlights spacebar and spawns a space pop badge.
    const spaceHit = updatePetTyping(rightKey, 3, 3, 1320, { col: 2, row: 2 })
    const spaceSample = motion.sample(spaceHit, 1320, false, false, { cursor: releasedMouse, typingActive: true })
    expect(spaceSample.space?.glow).toBeGreaterThan(0.8)
    expect(spaceSample.pops?.some((p) => p.kind === 'space')).toBe(true)

    // Release everything and advance past the 2s desk hold: all springs settle cleanly (moving === false).
    const idleState = updatePetTyping(spaceHit, 0, 0, 1360)
    const settledCursor = { ...cursor, gx: 0, gy: 0, buttons: 0, active: false }
    let settled = motion.sample(idleState, 3400, false, false, { cursor: settledCursor, typingActive: false })
    for (let now = 3416; now <= 4400; now += 16) {
      settled = motion.sample(idleState, now, false, false, { cursor: settledCursor, typingActive: false })
    }
    expect(settled.desk).toBe(0)
    expect(settled.pops).toBeUndefined()
    expect(settled.moving).toBe(false)
    expect(settled.gaze).toEqual({ x: 0, y: 0 })
  })

  it('spawns key pop badges on a resumed burst even when PetPresence resets sequence to 1, and glides out smoothly over the final 480ms', () => {
    const motion = new PetTypingMotion()
    // Burst 1: 3 strikes on left paw.
    let state = updatePetTyping(undefined, 1, 1, 1000, { col: 0, row: 1 })
    state = updatePetTyping(state, 1, 1, 1040, { col: 1, row: 1 })
    state = updatePetTyping(state, 0, 1, 1080, { col: 2, row: 1 })
    let sample = motion.sample(state, 1080, false, false, { typingActive: true, deskExpiresAt: 9080 })
    for (let t = 1096; t <= 1400; t += 16) {
      sample = motion.sample(state, t, false, false, { typingActive: true, deskExpiresAt: 9080 })
    }
    expect(sample.desk).toBeGreaterThan(0.95)

    // 3s pause: server TTL expired and rebuilt state starting back at sequence = 1 with newer struckAt = 4200.
    const burst2 = updatePetTyping(undefined, 1, 1, 4200, { col: 1, row: 0 })
    const resumed = motion.sample(burst2, 4216, false, false, { typingActive: true, deskExpiresAt: 12200 })
    expect(resumed.pops?.some((p) => p.kind === 'key')).toBe(true)
    expect(resumed.desk).toBeGreaterThan(0.95)

    // During final 480ms before deskExpiresAt (11720..12200), desk smoothly glides toward 0.
    const idle = updatePetTyping(burst2, 0, 0, 4260)
    let midExit = motion.sample(idle, 11720, false, false, { typingActive: true, deskExpiresAt: 12200 })
    for (let t = 11736; t <= 11960; t += 16) {
      midExit = motion.sample(idle, t, false, false, { typingActive: true, deskExpiresAt: 12200 })
    }
    expect(midExit.desk!).toBeLessThan(0.85)
    expect(midExit.desk!).toBeGreaterThan(0.05)
  })

  it('recovers sub-frame mouse taps via clickSeq, mirrors keyboard rows toward the pet, and kicks subtle board bounce', () => {
    const motion = new PetTypingMotion()
    // Fast trackpad tap already released (buttons: 0) by the time the first frame samples, with clickSeq=1 & clickMask=1.
    const fastTapCursor = {
      nx: 0.4, ny: 0.5, gx: -0.4, gy: 0.2,
      buttons: 0, wheelSeq: 0, wheelDir: 0 as const,
      clickSeq: 1, clickMask: 1, clickedAt: 1990,
      deskActiveAt: 1990, active: true
    }
    const tapFrame = motion.sample(undefined, 2000, false, false, { cursor: fastTapCursor, typingActive: false })
    expect(tapFrame.mouse?.leftPress).toBe(1)
    expect(tapFrame.pops?.some((p) => p.kind === 'mouse-left')).toBe(true)

    // Subsequent middle-click rising edge spawns mouse-middle badge and middlePress.
    const mmbCursor = { ...fastTapCursor, clickSeq: 2, clickMask: 4, clickedAt: 2040, deskActiveAt: 2040 }
    const mmbFrame = motion.sample(undefined, 2048, false, false, { cursor: mmbCursor, typingActive: false })
    expect(mmbFrame.mouse?.middlePress).toBeGreaterThan(0.9)
    expect(mmbFrame.pops?.some((p) => p.kind === 'mouse-middle')).toBe(true)

    // Striking a front/number-row key (user row 0 -> mirrored row 2) kicks board bounce and drives row toward 2.
    const topRowHit = updatePetTyping(undefined, 1, 1, 2100, { col: 1, row: 0 })
    let afterKey = motion.sample(topRowHit, 2108, false, false, { cursor: mmbCursor, typingActive: true })
    expect(afterKey.bounce).toBeGreaterThan(0)
    for (let t = 2116; t <= 2220; t += 8) {
      afterKey = motion.sample(topRowHit, t, false, false, { cursor: mmbCursor, typingActive: true })
    }
    expect(afterKey.right.row!).toBeGreaterThan(1.7)
  })
})
