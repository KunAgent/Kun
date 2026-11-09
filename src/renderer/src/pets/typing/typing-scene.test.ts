import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PetSummary } from '@shared/pets'
import { bodyPoint } from '../joint/geometry'
import { armLayerContact, armLayerMatrix, armLayerPoint } from '../joint/arm-layer'
import { createRigMesh, paintRigVertices } from '../joint/mesh'
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
      const contact = armLayerContact(actor, side, actor.armLayers!.cutouts[side]), key = side ? frame.keyboard!.right : frame.keyboard!.left
      expect(contact.x).toBeCloseTo(key.x)
      expect(contact.y).toBeCloseTo(key.y + key.depth!)
      expect(actor.armLayers!.contactY[side]).toBeCloseTo(contact.y)
    }
    expect(actor.rig.row).toBe(pet.sourceId === 'ikun' ? 5 : 0)
  })

  it.each(pets)('rotates $sourceId arms without stretching or pulling face/body pixels', (pet) => {
    for (const size of [80, 112, 224]) {
      let body: number[] | undefined
      let scales: number[] | undefined
      for (const down of [0, .2, .5, .8, 1]) {
        const frame = typingScene({ pet, width: 404, height: 350, mascotWidth: size, origin: { x: 202, y: 160 },
          motion: { left: { down, glow: 0 }, right: { down: 1 - down, glow: 0 }, moving: true },
          now: 1200, enteredAt: 1000, expiresAt: 2800, paused: false })
        const actor = frame.actors[0], currentScales: number[] = []
        for (const side of [0, 1] as const) {
          const matrix = armLayerMatrix(actor, side), rig = actor.rig.arms[side]
          const pivot = armLayerPoint(actor, side, rig.shoulder), shoulder = bodyPoint(actor, rig.shoulder)
          expect(pivot.x).toBeCloseTo(shoulder.x)
          expect(pivot.y).toBeCloseTo(shoulder.y)
          expect(matrix.a * matrix.c + matrix.b * matrix.d).toBeCloseTo(0)
          const scale = Math.hypot(matrix.a, matrix.b)
          expect(Math.hypot(matrix.c, matrix.d)).toBeCloseTo(scale)
          currentScales.push(scale)
          expect(armLayerContact(actor, side, actor.armLayers!.cutouts[side]).y).toBeLessThanOrEqual(actor.armLayers!.contactY[side] + .001)
        }
        if (scales) currentScales.forEach((scale, side) => expect(scale).toBeCloseTo(scales![side]))
        scales = currentScales
        const mesh = createRigMesh(actor.rig), data = paintRigVertices(mesh, actor, 0)
        const positions = Array.from(data).filter((_, index) => index % 5 < 2)
        if (body) expect(positions).toEqual(body)
        body = positions
      }
    }
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

  it('gives Xiao Kun two inward blue wings and a compact keyboard, preserving the other pets', () => {
    for (const pet of pets) {
      const frame = typingScene({ pet, width: 204, height: 190, mascotWidth: 112, origin: { x: 102, y: 80 },
        motion: { left: { down: 1, glow: 1 }, right: { down: 1, glow: 1 }, moving: false },
        now: 1200, enteredAt: 1000, expiresAt: 2800, paused: false })
      const actor = frame.actors[0], keyboard = frame.keyboard!
      if (pet.sourceId === 'xiao-kun') {
        expect(keyboard.theme).toBe('xiao-kun')
        expect(keyboard.width).toBeCloseTo(112 * .98)
        expect(actor.hands[0].x).toBeGreaterThan(bodyPoint(actor, actor.rig.arms[0].shoulder).x)
        expect(actor.hands[1].x).toBeLessThan(bodyPoint(actor, actor.rig.arms[1].shoulder).x)
        expect(keyboard.left.y).toBeCloseTo(keyboard.right.y)
        expect(actor.armLayers!.cutouts.every((cutout) => cutout.source?.row === 7)).toBe(true)
      } else {
        expect(keyboard.theme).toBeUndefined()
        expect(keyboard.width).toBeCloseTo(112 * 1.12)
        expect(actor.armLayers!.cutouts.every((cutout) => !cutout.source)).toBe(true)
      }
    }
  })

  it('shows a brief contact accent without repeating it during holds or reduced motion', () => {
    const input = { pet: pets[0], width: 204, height: 190, mascotWidth: 112, origin: { x: 102, y: 80 },
      motion: { left: { down: 1, glow: .8 }, right: { down: 0, glow: 0 }, moving: true },
      now: 1200, enteredAt: 1000, expiresAt: 2800, paused: false }
    expect(typingScene(input).keyboard!.left.impact).toBeGreaterThan(0)
    expect(typingScene({ ...input, reduced: true }).keyboard!.left.impact).toBe(0)
    expect(typingScene({ ...input, paused: true }).keyboard!.left.impact).toBe(0)
    for (const [down, glow] of [[1, .2], [0, .8], [0, 0]]) {
      const frame = typingScene({ ...input, motion: { ...input.motion, left: { down, glow } } })
      expect(frame.keyboard!.left.impact).toBe(0)
    }
  })
})
