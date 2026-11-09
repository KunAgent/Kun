import { describe, expect, it } from 'vitest'
import { defaultPetBottleRecipe } from '@shared/pets-bottle'
import type { PetVisit } from '@shared/pets-visits'
import { samplePetBottle } from './pet-bottle-motion'

const visit: PetVisit = { id: 1, primaryId: 'kun:xiao-kun', guestIds: [], reason: 'bottle', scene: 'gift',
  startedAt: 1000, playUntil: 8300, plannedPlayUntil: 8300, endsAt: 9200, seed: 0, bottleCount: 1 }
const base = { visit, width: 404, height: 300, mascotWidth: 112, primaryOrigin: { x: 202, y: 150 },
  recipe: defaultPetBottleRecipe(), reduced: false }

describe('logo-faithful bottle choreography', () => {
  it('falls, approaches, catches, inspects and celebrates before settling back at the saved position', () => {
    const phases = [.05, .25, .4, .6, .8, .95].map((p) => samplePetBottle({ ...base, now: 1000 + 8200 * p }).phase)
    expect(phases).toEqual(['falling', 'approaching', 'catching', 'inspecting', 'celebrating', 'settling'])
    expect(samplePetBottle({ ...base, now: 1000 }).actor).toMatchObject({ x: 202, y: 150 })
    expect(samplePetBottle({ ...base, now: 9200 })).toMatchObject({ actor: { x: 202, y: 150, pose: 'idle' }, bottle: { opacity: 0 } })
  })

  it('gives iKun a playful catch while Xiao Kun carefully lifts the same sealed bottle', () => {
    const now = 1000 + 8200 * .415
    const careful = samplePetBottle({ ...base, now })
    const bounce = samplePetBottle({ ...base, recipe: { ...base.recipe, catchStyle: 'bounce' }, now })
    expect(Math.abs(bounce.bottle.angle)).toBeGreaterThan(100)
    expect(Math.abs(careful.bottle.angle)).toBeLessThan(10)
    expect(bounce.bottle.y).toBeLessThan(careful.bottle.y)
  })

  it('fades an interrupted scene promptly without teleporting the resident', () => {
    const before = samplePetBottle({ ...base, now: 6000 })
    const interrupted = { ...visit, playUntil: 6000, endsAt: 6800 }
    expect(samplePetBottle({ ...base, visit: interrupted, now: 6000 }).actor.x).toBeCloseTo(before.actor.x)
    expect(samplePetBottle({ ...base, visit: interrupted, now: 6800 })).toMatchObject({ actor: { x: 202, y: 150 }, bottle: { opacity: 0 } })
  })

  it('keeps reduced-motion output still and keeps the resident within the stage near its edges', () => {
    expect(samplePetBottle({ ...base, reduced: true, now: 2000 }).actor)
      .toEqual(samplePetBottle({ ...base, reduced: true, now: 6000 }).actor)
    for (const mascotWidth of [80, 112, 224]) {
      const halfHeight = mascotWidth * 208 / 384
      for (const x of [mascotWidth / 2 + 6, 202, 404 - mascotWidth / 2 - 6]) {
        for (const y of [halfHeight + 6, 300 - halfHeight - 6]) for (let step = 0; step <= 40; step++) {
          const frame = samplePetBottle({ ...base, mascotWidth, primaryOrigin: { x, y }, now: 1000 + step / 40 * 8200 })
          expect(frame.actor.x - mascotWidth / 2).toBeGreaterThanOrEqual(0)
          expect(frame.actor.x + mascotWidth / 2).toBeLessThanOrEqual(404)
          expect(frame.actor.y - halfHeight).toBeGreaterThanOrEqual(0)
          expect(frame.actor.y + halfHeight).toBeLessThanOrEqual(300)
        }
      }
    }
  })
})
