import { describe, expect, it } from 'vitest'
import { PET_SCENE_IDS } from '@shared/pets-ensemble'
import type { PetSummary } from '@shared/pets'
import type { PetVisit } from '@shared/pets-visits'
import { samplePetVisit } from './pet-visit-motion'

const cast = ['xiao-kun', 'gpt-girl', 'claude-girl', 'kimi-girl'].map((id) => ({
  id: `kun:${id}`, sourceId: id, displayName: id, spriteVersionNumber: 1
})) as PetSummary[]
const visit: PetVisit = { id: 1, primaryId: 'kun:xiao-kun', guestIds: cast.slice(1).map((pet) => pet.id),
  reason: 'random', scene: 'chase', startedAt: 1000, playUntil: 10000, plannedPlayUntil: 10000, endsAt: 11600, seed: .2 }
const base = { visit, cast, width: 404, height: 300, primaryOrigin: { x: 202, y: 150 }, mascotWidth: 112, reduced: false }

describe('finite pet visit choreography', () => {
  it('arrives from different directions, plays in a non-row formation, waves goodbye and restores the host position', () => {
    const initial = samplePetVisit({ ...base, now: visit.startedAt })
    expect(initial.phase).toBe('arriving')
    expect(initial.actors[0]).toMatchObject({ x: 202, y: 150, scale: 1, opacity: 1 })
    expect(initial.actors.slice(1).every((actor) => actor.opacity === 0)).toBe(true)
    expect(initial.actors.some((actor) => actor.x < 0)).toBe(true)
    expect(initial.actors.some((actor) => actor.x > 404)).toBe(true)
    const middle = samplePetVisit({ ...base, now: 6000 })
    expect(middle.phase).toBe('playing')
    expect(new Set(middle.actors.map((actor) => Math.round(actor.y))).size).toBeGreaterThan(2)
    expect(samplePetVisit({ ...base, now: 10500 }).phase).toBe('departing')
    const end = samplePetVisit({ ...base, now: visit.endsAt })
    expect(end.actors[0]).toMatchObject({ x: 202, y: 150, scale: 1, opacity: 1 })
    expect(end.actors.slice(1).every((actor) => actor.opacity === 0)).toBe(true)
  })

  it('does not teleport a visitor when typing interrupts its entrance or play', () => {
    for (const time of [1800, 6000]) {
      const before = samplePetVisit({ ...base, now: time })
      const interrupted = samplePetVisit({ ...base, visit: { ...visit, playUntil: time, endsAt: time + 800 }, now: time })
      for (let i = 0; i < cast.length; i++) {
        expect(interrupted.actors[i].x).toBeCloseTo(before.actors[i].x)
        expect(interrupted.actors[i].y).toBeCloseTo(before.actors[i].y)
        expect(interrupted.actors[i].opacity).toBeCloseTo(before.actors[i].opacity)
        expect(interrupted.actors[i].y - interrupted.actors[i].lift).toBeCloseTo(before.actors[i].y - before.actors[i].lift)
      }
      const halfway = samplePetVisit({ ...base, visit: { ...visit, playUntil: time, endsAt: time + 800 }, now: time + 400 })
      expect(halfway.actors[1].opacity).toBeLessThan(interrupted.actors[1].opacity)
    }
  })

  it('keeps every play scene inside the stage at different pet sizes and ends large-pet scaling at one', () => {
    for (const scene of PET_SCENE_IDS) for (const mascotWidth of [80, 112, 224]) {
      for (const now of [3000, 6000, 9500]) {
        const state = samplePetVisit({ ...base, mascotWidth, visit: { ...visit, scene }, now })
        for (const actor of state.actors) {
          const halfWidth = actor.size * actor.scale / 2
          const halfHeight = halfWidth * 208 / 192
          expect(actor.x - halfWidth).toBeGreaterThanOrEqual(0)
          expect(actor.x + halfWidth).toBeLessThanOrEqual(404)
          expect(actor.y - halfHeight).toBeGreaterThanOrEqual(0)
          expect(actor.y + halfHeight).toBeLessThanOrEqual(300)
        }
      }
      expect(samplePetVisit({ ...base, mascotWidth, visit: { ...visit, scene }, now: 11600 }).actors[0].scale).toBe(1)
    }
  })

  it('keeps reduced-motion visits still and supports a custom resident alongside built-ins', () => {
    const custom = [{ ...cast[0], id: 'kun-local:custom', sourceId: 'custom' }, ...cast.slice(1)]
    const a = samplePetVisit({ ...base, cast: custom, reduced: true, now: 3000 })
    const b = samplePetVisit({ ...base, cast: custom, reduced: true, now: 6000 })
    expect(a.actors).toEqual(b.actors)
    expect(a.actors.every((actor) => actor.pose === 'idle' && actor.tilt === 0 && actor.lift === 0)).toBe(true)
  })
})
