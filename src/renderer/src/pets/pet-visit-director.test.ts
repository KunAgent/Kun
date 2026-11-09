import { PET_SCENES } from './pet-ensemble-catalog'
import { describe, expect, it } from 'vitest'
import type { PetSummary } from '@shared/pets'
import { defaultPetInteractions } from '@shared/pets-interactions'
import { defaultPetVisits, type PetVisit } from '@shared/pets-visits'
import { PetVisitDirector, type PetVisitContext } from './pet-visit-director'

const pets: PetSummary[] = ['xiao-kun', 'ikun', 'whale-girl'].map((id) => ({
  id: `kun:${id}`, sourceId: id, displayName: id, description: '', source: 'kun-builtin', available: true,
  sourceMissing: false, spriteVersionNumber: 1, spritesheetUrl: `kun-pet://asset/${id}`, interactions: defaultPetInteractions()
}))
const context = (patch: Partial<PetVisitContext> = {}): PetVisitContext => ({
  primaryId: 'kun:xiao-kun', pets, preferences: defaultPetVisits(), visible: true, reduced: false,
  blocked: false, working: false, inputActive: false, modelPetId: null, modelChangedAt: 0, completedKeys: [], ...patch
})
function advance(director: PetVisitDirector, ctx: PetVisitContext, from: number, to: number): PetVisit | null {
  let result: PetVisit | null = null
  for (let now = from; now <= to; now += 1000) result = director.update(ctx, now)
  return result
}

describe('occasional pet visits', () => {
  it('invites DS for shared bubbles and uses the model pet’s joint scene', () => {
    const scripted: PetSummary[] = pets.map((pet) => ({ ...pet, interactions: { ...defaultPetInteractions(),
      visits: { arrival: 'walk', scenes: ['bubbles', 'dance'] } } }))
    const ctx = context({ pets: scripted }), manual = new PetVisitDirector(() => 0)
    expect(manual.request({ id: 'shared', kind: 'invite', createdAt: 1000, scene: 'study' }, ctx, 1000))
      .toMatchObject({ scene: 'bubbles', guestIds: ['kun:whale-girl'] })
    const director = new PetVisitDirector(() => 0); director.update(ctx, 1000)
    const switched = { ...ctx, modelPetId: 'kun:whale-girl', modelChangedAt: 2000 }
    director.update(switched, 2000)
    const visit = director.update(switched, 3000)!
    expect(visit.scene).toBe('bubbles')
    expect(visit.playUntil - visit.startedAt).toBe(PET_SCENES.bubbles.duration + 1600)
  })

  it('starts solo, invites from installed pets without any selection, and returns to solo after one scene', () => {
    const director = new PetVisitDirector(() => 0), ctx = context()
    expect(director.update(ctx, 1000)).toBeNull()
    expect(advance(director, ctx, 2000, 240000)).toBeNull()
    const visit = director.update(ctx, 241000)!
    expect(visit.reason).toBe('random')
    expect(visit.guestIds).toHaveLength(1)
    expect(visit.guestIds).not.toContain(ctx.primaryId)
    expect(visit.playUntil - visit.startedAt).toBe(PET_SCENES[visit.scene].duration + 1600)
    expect(visit.endsAt - visit.startedAt).toBeLessThanOrEqual(21200)
    expect(director.update(ctx, visit.endsAt)).toBeNull()
    expect(advance(director, ctx, visit.endsAt + 1000, visit.endsAt + 89000)).toBeNull()
  })

  it('settles rapid model changes on the latest model and cancels stale guests politely', () => {
    const director = new PetVisitDirector(() => 0)
    director.update(context(), 1000)
    director.update(context({ modelPetId: 'kun:ikun', modelChangedAt: 2000 }), 2000)
    const ctx = context({ modelPetId: 'kun:whale-girl', modelChangedAt: 2200 })
    director.update(ctx, 2200)
    expect(director.update(ctx, 2900)).toBeNull()
    const visit = director.update(ctx, 3100)!
    expect(visit).toMatchObject({ reason: 'model', guestIds: ['kun:whale-girl'] })
    const next = context({ modelPetId: 'kun:ikun', modelChangedAt: 3300 })
    const leaving = director.update(next, 3300)!
    expect(leaving.endsAt).toBe(4100)
    expect(director.update(next, 4100)).toBeNull()
    expect(advance(director, next, 5100, 14100)).toBeNull()
  })

  it('does not replay an invitation that was interrupted by typing or an urgent task', () => {
    const director = new PetVisitDirector(() => 0)
    director.update(context(), 1000)
    const model = context({ modelPetId: 'kun:ikun', modelChangedAt: 2000 })
    director.update(model, 2000)
    director.update({ ...model, inputActive: true }, 2400)
    expect(advance(director, model, 3400, 16400)).toBeNull()
    expect(advance(director, { ...model, working: true }, 17400, 300400)).toBeNull()
    expect(director.update(model, 301000)).toBeNull()
  })

  it('backs out of an automatic visit on new input, while explicit invitations still work when automatic visits are paused', () => {
    const director = new PetVisitDirector(() => 0)
    director.update(context(), 1000)
    const ctx = context({ modelPetId: 'kun:ikun', modelChangedAt: 2000 })
    director.update(ctx, 2000)
    director.update(ctx, 3000)
    expect(director.update({ ...ctx, inputActive: true }, 3500)?.endsAt).toBe(4300)
    expect(director.update({ ...ctx, inputActive: true }, 4300)).toBeNull()
    const quiet = context({ preferences: { enabled: false, frequency: 'balanced' } })
    const request = { id: 'manual', kind: 'invite' as const, createdAt: 5000, scene: 'tea' as const }
    const visit = director.request(request, quiet, 5000)!
    expect(visit).toMatchObject({ reason: 'manual', scene: 'bubbles' })
    expect(director.request(request, quiet, 5100)?.startedAt).toBe(5000)
  })

  it('forgets elapsed timers after sleep, hiding, or changing the resident pet', () => {
    const director = new PetVisitDirector(() => 0), ctx = context()
    director.update(ctx, 1000)
    director.request({ id: 'one', kind: 'invite', createdAt: 2000 }, ctx, 2000)
    expect(director.update({ ...ctx, visible: false }, 2100)).toBeNull()
    expect(director.update(ctx, 600000)).toBeNull()
    expect(director.request({ id: 'old', kind: 'invite', createdAt: 2000 }, ctx, 600001)).toBeNull()
    director.request({ id: 'two', kind: 'invite', createdAt: 600002 }, ctx, 600002)
    expect(director.update({ ...ctx, primaryId: 'kun:ikun' }, 600003)).toBeNull()
    expect(director.update(ctx, 1000)).toBeNull()
  })

  it('follows a reduced built-in roster automatically and avoids repeating a visitor or scene when alternatives exist', () => {
    const director = new PetVisitDirector(() => 0), ctx = context()
    director.update(ctx, 1000)
    const first = director.request({ id: 'one', kind: 'invite', createdAt: 2000 }, ctx, 2000)!
    const second = director.request({ id: 'two', kind: 'invite', createdAt: 3000 }, ctx, 3000)!
    expect(second.guestIds[0]).not.toBe(first.guestIds[0])
    expect(second.scene).not.toBe(first.scene)
    const smaller = { ...ctx, pets: pets.filter((pet) => pet.id === ctx.primaryId || pet.sourceId === 'whale-girl') }
    const third = director.request({ id: 'three', kind: 'invite', createdAt: 4000 }, smaller, 4000)!
    expect(third.guestIds).toEqual(['kun:whale-girl'])
  })

  it('occasionally invites both remaining companions without turning them into a persistent team', () => {
    const director = new PetVisitDirector(() => .99), ctx = context()
    director.update(ctx, 1000)
    const visit = director.request({ id: 'group', kind: 'invite', createdAt: 2000 }, ctx, 2000)!
    expect(visit.guestIds).toHaveLength(2)
    expect(new Set(visit.guestIds).size).toBe(2)
    expect(director.update(ctx, visit.endsAt)).toBeNull()
  })

  it('caps automatic invitations even if models keep changing', () => {
    const director = new PetVisitDirector(() => 0)
    let ctx = context(), now = 1000
    director.update(ctx, now)
    const started: number[] = []
    for (let index = 0; index < 4; index++) {
      const next = now + 110000
      advance(director, ctx, now + 1000, next - 1000)
      now = next
      ctx = context({ modelPetId: index % 2 ? 'kun:ikun' : 'kun:whale-girl', modelChangedAt: now })
      director.update(ctx, now)
      const visit = director.update(ctx, now + 1000)
      if (visit) started.push(visit.id)
      now += 1000
    }
    expect(started).toHaveLength(3)
  })

  it('ignores restored completions, but can celebrate a fresh result or a long input break', () => {
    const director = new PetVisitDirector(() => 0)
    director.update(context({ completedKeys: ['old'] }), 1000)
    expect(director.update(context({ completedKeys: ['old'] }), 2000)).toBeNull()
    const completed = context({ completedKeys: ['old', 'new'] })
    director.update(completed, 3000)
    expect(director.update(completed, 5500)?.reason).toBe('celebration')
    const breaks = new PetVisitDirector(() => 0)
    breaks.update(context(), 1000)
    advance(breaks, context({ inputActive: true }), 2000, 94000)
    breaks.update(context(), 95000)
    expect(breaks.update(context(), 99000)?.reason).toBe('break')
  })
})
