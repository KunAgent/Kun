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
})
