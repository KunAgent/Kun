import { describe, expect, it } from 'vitest'
import { defaultPetVisits } from '@shared/pets-visits'
import { defaultPetBottleRecipe } from '@shared/pets-bottle'
import { PetVisitDirector, type PetVisitContext } from './pet-visit-director'

const context = (patch: Partial<PetVisitContext> = {}): PetVisitContext => ({
  primaryId: 'kun:xiao-kun', pets: [], preferences: { ...defaultPetVisits(), enabled: false }, visible: true,
  reduced: false, blocked: false, working: false, inputActive: false, modelPetId: null, modelChangedAt: 0,
  completedKeys: [], ...patch
})
const request = (id: string, at: number, count = 1) => ({ id, kind: 'bottle' as const, createdAt: at, bottleCount: count })

describe('bottle event scenes', () => {
  it('plays a solo event even when random visits are paused, then returns to solo', () => {
    const director = new PetVisitDirector(() => 0), ctx = context()
    director.update(ctx, 1000)
    const scene = director.request(request('one', 2000), ctx, 2000)!
    expect(scene).toMatchObject({ reason: 'bottle', guestIds: [], bottleCount: 1 })
    expect(scene.endsAt - scene.startedAt).toBe(defaultPetBottleRecipe().durationMs)
    expect(director.update(ctx, scene.endsAt)).toBeNull()
  })

  it('coalesces a burst without extending the scene and deduplicates a replay', () => {
    const director = new PetVisitDirector(() => 0), ctx = context()
    const first = director.request(request('one', 1000), ctx, 1000)!
    const second = director.request(request('two', 1200, 2), ctx, 1200)!
    expect(second).toMatchObject({ id: first.id, bottleCount: 3, endsAt: first.endsAt })
    expect(director.request(request('two', 1200, 2), ctx, 1300)?.bottleCount).toBe(3)
  })

  it('allows a short work-state settlement, but never replays an old cue after prolonged input', () => {
    const director = new PetVisitDirector(() => 0), ctx = context()
    expect(director.request(request('one', 1000), { ...ctx, working: true }, 1000)).toBeNull()
    expect(director.update(ctx, 1500)?.reason).toBe('bottle')
    const busy = new PetVisitDirector(() => 0)
    busy.update(ctx, 1000)
    expect(busy.request(request('busy', 2000), { ...ctx, inputActive: true }, 2000)).toBeNull()
    busy.update({ ...ctx, inputActive: true }, 10000)
    expect(busy.update(ctx, 18000)).toBeNull()
    expect(busy.update(ctx, 24000)).toBeNull()
  })

  it('cancels on user input or account/presentation invalidation and honors disabled feedback', () => {
    const director = new PetVisitDirector(() => 0), ctx = context()
    expect(director.request(request('off', 1000), { ...ctx, eventsEnabled: false }, 1000)).toBeNull()
    director.request(request('one', 2000), ctx, 2000)
    expect(director.update({ ...ctx, inputActive: true }, 3000)?.endsAt).toBe(3800)
    expect(director.request({ id: 'reset', kind: 'clear-bottle', createdAt: 3100 }, ctx, 3100)).toBeNull()
  })

  it('uses a brief still notice in reduced-motion mode', () => {
    const director = new PetVisitDirector(() => 0), ctx = context({ reduced: true })
    const scene = director.request(request('one', 1000), ctx, 1000)!
    expect(scene.endsAt - scene.startedAt).toBe(3000)
    expect(director.update(ctx, scene.endsAt)).toBeNull()
  })
})
