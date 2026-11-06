import { afterEach, describe, expect, it, vi } from 'vitest'
import { PET_IPC } from '../../shared/pets'
import { PET_PRESENCE_TTL_MS } from '../../shared/pets-interactions'
import { PetPresence } from './pet-presence'
import { petIpcHandlers, type PetIpcApi } from './pet-ipc'

afterEach(() => vi.useRealTimers())

describe('ephemeral pet presence', () => {
  it('expires abandoned inputs and prioritizes speech without one sender clearing another', () => {
    vi.useFakeTimers(); vi.setSystemTime(10000)
    const publish = vi.fn()
    const presence = new PetPresence(publish)
    presence.update(1, { type: 'input', source: 'same', kind: 'typing', level: 0 })
    presence.update(2, { type: 'input', source: 'same', kind: 'listening', level: .73 })
    presence.update(1, { type: 'input', source: 'same', kind: 'idle', level: 0 })
    expect(presence.snapshot().input).toMatchObject({ kind: 'listening', level: .7 })
    presence.update(1, { type: 'input', source: 'tts', kind: 'speaking', level: .5 })
    expect(presence.snapshot().input?.kind).toBe('speaking')
    presence.update(1, { type: 'input', source: 'tts', kind: 'idle', level: 0 })
    expect(presence.snapshot().input?.kind).toBe('listening')
    vi.advanceTimersByTime(PET_PRESENCE_TTL_MS + 1)
    expect(presence.snapshot().input).toBeNull()
    expect(publish.mock.lastCall?.[0].input).toBeNull()
    presence.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('seeds the initial model quietly and keeps only the latest actual switch', () => {
    vi.useFakeTimers(); vi.setSystemTime(10000)
    const publish = vi.fn(), presence = new PetPresence(publish)
    presence.update(1, { type: 'model', model: 'gpt-5', provider: 'openai', announce: false })
    expect(presence.snapshot().modelChangedAt).toBe(0)
    presence.update(1, { type: 'model', model: 'claude-sonnet', provider: 'anthropic', announce: true })
    expect(presence.snapshot().modelChangedAt).toBe(10000)
    vi.advanceTimersByTime(100)
    presence.update(1, { type: 'model', model: 'gpt-5', provider: 'openai', announce: true })
    const revision = presence.snapshot().revision
    presence.update(1, { type: 'model', model: 'gpt-5', provider: 'openai', announce: true })
    expect(presence.snapshot()).toMatchObject({ revision, model: { model: 'gpt-5' }, modelChangedAt: 10100 })
    presence.clear()
    expect(presence.snapshot()).toMatchObject({ model: null, input: null, modelChangedAt: 0 })
    presence.dispose()
  })

  it('bounds active sources and releases the expiry timer on shutdown', () => {
    vi.useFakeTimers()
    const presence = new PetPresence(() => undefined)
    for (let i = 0; i < 100; i++) presence.update(1, { type: 'input', source: `key:${i}`, kind: 'typing', level: 0 })
    for (let i = 68; i < 100; i++) presence.update(1, { type: 'input', source: `key:${i}`, kind: 'idle', level: 0 })
    expect(presence.snapshot().input).toBeNull()
    presence.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects foreign senders, subframes, invalid levels and model changes from the overlay', () => {
    const api = { updatePresence: vi.fn(),
      allows: (event: { isMainFrame: boolean; senderKind: string }, kinds: string[]) => event.isMainFrame && kinds.includes(event.senderKind) }
    const handler = petIpcHandlers(api as unknown as PetIpcApi)[PET_IPC.updatePetPresence]
    const main = { senderId: 1, isMainFrame: true, senderKind: 'main' as const }
    const signal = { type: 'input', source: 'voice:1', kind: 'listening', level: .5 }
    handler({ ...main, senderKind: 'other' }, signal)
    handler({ ...main, isMainFrame: false }, signal)
    handler(main, { ...signal, level: 2 })
    handler({ ...main, senderKind: 'overlay' }, { type: 'model', model: 'gpt-5', provider: 'openai', announce: true })
    expect(api.updatePresence).not.toHaveBeenCalled()
    handler(main, signal)
    handler({ ...main, senderKind: 'overlay' }, signal)
    expect(api.updatePresence).toHaveBeenCalledTimes(2)
  })
})
