import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PetOverlayBootstrap, PetSummary } from '@shared/pets'
import { defaultPetInteractions, emptyPetPresence, type PetPresenceSnapshot } from '@shared/pets-interactions'
import { usePetPresence } from './use-pet-presence'

afterEach(() => vi.useRealTimers())

describe('overlay presence lifecycle', () => {
  it('keeps model context without making a permanent companion and expires input feedback', async () => {
    vi.useFakeTimers(); vi.setSystemTime(10000)
    let deliver!: (snapshot: PetPresenceSnapshot) => void
    const unsubscribe = vi.fn()
    const bridge = { onPresenceChanged: (handler: typeof deliver) => { deliver = handler; return unsubscribe } }
    const pets = ['gpt', 'claude'].map((name) => ({
      id: `kun:${name}-girl`, sourceId: `${name}-girl`, source: 'kun-builtin', displayName: name,
      available: true, spritesheetUrl: 'kun-pet://asset/test', interactions: { ...defaultPetInteractions(), modelAliases: [name] }
    })) as PetSummary[]
    let result!: ReturnType<typeof usePetPresence>
    function View({ boot }: { boot: PetOverlayBootstrap }) { result = usePetPresence(bridge, boot); return null }
    const boot = { ensemblePets: pets, presence: emptyPetPresence(), reactionsEnabled: true } as PetOverlayBootstrap
    let view!: ReturnType<typeof create>
    await act(async () => { view = create(createElement(View, { boot })) })
    await act(async () => deliver({ revision: 2, input: null, model: { model: 'gpt-5', provider: '' }, modelChangedAt: 10000 }))
    expect(result.presence.model?.model).toBe('gpt-5')
    expect(result.active).toBe(false)
    await act(async () => deliver({ revision: 3, input: null, model: { model: 'claude-sonnet', provider: '' }, modelChangedAt: 10000 }))
    expect(result.presence.model?.model).toBe('claude-sonnet')
    await act(async () => view.update(createElement(View, { boot: { ...boot, presence: { ...emptyPetPresence(), revision: 1 } } })))
    expect(result.presence.model?.model).toBe('claude-sonnet')
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(result.active).toBe(false)
    await act(async () => deliver({ revision: 4, model: null, modelChangedAt: 0,
      input: { kind: 'typing', level: 0, expiresAt: Date.now() + 1800 } }))
    expect(result.input?.kind).toBe('typing')
    await act(async () => { vi.advanceTimersByTime(1801) })
    expect(result.active).toBe(false)
    await act(async () => deliver({ revision: 5, model: null, modelChangedAt: 0,
      input: { kind: 'speaking', level: .5, expiresAt: Date.now() + 1800 } }))
    await act(async () => view.update(createElement(View, { boot: { ...boot, reactionsEnabled: false } })))
    expect(result.active).toBe(false)
    await act(async () => view.unmount())
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
