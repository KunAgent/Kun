import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PetSummary } from '@shared/pets'
import { skinPoint } from '../joint/geometry'
import { typingScene } from './typing-scene'

const pets = ['xiao-kun', 'ikun', 'whale-girl'].map((id): PetSummary => ({
  ...JSON.parse(readFileSync(`resources/pets/${id}/pet.json`, 'utf8')),
  id: `kun:${id}`, sourceId: id, source: 'kun-builtin', available: true, sourceMissing: false
}))

describe('keyboard and paw contact', () => {
  it.each(pets)('keeps $sourceId hands on the depressed keycaps without a second laptop', (pet) => {
    const frame = typingScene({ pet, width: 204, height: 190, mascotWidth: 112, origin: { x: 102, y: 80 },
      motion: { left: { down: 1, glow: 1 }, right: { down: 1, glow: 1 }, moving: true },
      now: 1200, enteredAt: 1000, expiresAt: 2800, paused: false })
    expect(frame.actors).toHaveLength(1)
    expect(frame.objects).toHaveLength(0)
    const actor = frame.actors[0]
    for (const side of [0, 1] as const) {
      const contact = skinPoint(actor, actor.rig.arms[side].hand), key = side ? frame.keyboard!.right : frame.keyboard!.left
      expect(contact.x).toBeCloseTo(key.x)
      expect(contact.y).toBeCloseTo(key.y + 1.8)
    }
    expect(actor.rig.row).toBe(pet.sourceId === 'ikun' ? 5 : 0)
  })

  it('fits the desktop at both edges and restores the original anchor as it fades', () => {
    for (const pet of pets) for (const width of [180, 204, 404]) for (const size of [80, 112, 224]) {
      const input = { pet, width, height: 250, mascotWidth: size, origin: { x: width - 30, y: 210 },
        motion: { left: { down: 0, glow: 0 }, right: { down: 0, glow: 0 }, moving: false },
        now: 1200, enteredAt: 1000, expiresAt: 2800, paused: false }
      const board = typingScene(input).keyboard!
      expect(board.x - 9).toBeGreaterThanOrEqual(0)
      expect(board.x + board.width + 9).toBeLessThanOrEqual(width)
      expect(board.y + board.height + 14).toBeLessThanOrEqual(input.height)
      const end = typingScene({ ...input, now: 2800 })
      expect(end.actors[0].root.x).toBe(input.origin.x)
      expect(end.actors[0].soloBlend).toBe(1)
    }
  })
})
