import { describe, expect, it } from 'vitest'
import { defaultPetInteractions, parsePetInteractionPack, parsePetPresenceSignal } from './pets-interactions'

describe('declarative pet interaction packages', () => {
  it('copies valid recipes and rejects executable, invalid or oversized configuration', () => {
    const pack = defaultPetInteractions()
    expect(parsePetInteractionPack(pack)).toEqual(pack)
    expect(parsePetInteractionPack(pack)?.clips).not.toBe(pack.clips)
    for (const patch of [{ version: 2 }, { modelAliases: ['claude.*'] }, { modelAliases: Array(20).fill('gpt') },
      { greeting: { states: ['__proto__'], durationMs: 5000 } }, { greeting: { states: ['idle'], durationMs: Infinity } },
      { clips: { ...pack.clips, typing: { state: 'running', tempo: 99, strength: .5 } } }]) {
      expect(parsePetInteractionPack({ ...pack, ...patch })).toBeNull()
    }
  })

  it('validates input telemetry and strips text, audio and arbitrary fields', () => {
    expect(parsePetPresenceSignal({ type: 'input', source: 'voice:1', kind: 'listening', level: .3,
      transcript: 'private', audioBase64: 'private' })).toEqual({ type: 'input', source: 'voice:1', kind: 'listening', level: .3 })
    for (const patch of [{ level: NaN }, { level: Infinity }, { level: 2 }, { kind: 'execute' }, { source: '../test' }]) {
      expect(parsePetPresenceSignal({ type: 'input', source: 'typing:1', kind: 'typing', level: 0, ...patch })).toBeNull()
    }
    expect(parsePetPresenceSignal({ type: 'model', model: 'gpt-5', provider: 'openai', announce: true, apiKey: 'secret' }))
      .toEqual({ type: 'model', model: 'gpt-5', provider: 'openai', announce: true })
    expect(parsePetPresenceSignal({ type: 'model', model: 'x'.repeat(201), provider: '', announce: true })).toBeNull()
  })
})
