import { describe, expect, it } from 'vitest'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { kunAgent } from './kun-routes.js'
import { checkedModelInfo, fastServiceTier, nativeModelInfo, providerFastMode, providerModelInfo, routeModelInfo } from './model-info.js'

const unknown = { source: 'provider' as const, status: 'unknown' as const }
type Provider = Parameters<typeof providerModelInfo>[0]
const codex = (capabilities: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 'codex', name: 'Codex', kind: 'http',
  configured: true, credentialStatus: 'ready', models: Object.keys(capabilities), modelCapabilities: capabilities, ...extra }) as unknown as Provider
const capability = (id: string, extra: Record<string, unknown> = {}) => ({ id, inputModalities: ['text', 'image'], outputModalities: ['text'],
  supportsToolCalling: true, messageParts: ['text', 'input_image'], ...extra })

describe('mobile Code model info', () => {
  it("keeps a native Agent's own name and known inputs, and nothing that adds no information", () => {
    expect(nativeModelInfo('opus', { id: 'opus', displayName: ' Opus 4.7 ', inputModalities: ['image', 'audio', 'text'] }))
      .toEqual({ displayName: 'Opus 4.7', inputModalities: ['text', 'image'] })
    expect(nativeModelInfo('haiku', { id: 'haiku', displayName: 'haiku', inputModalities: ['audio'] })).toBeUndefined()
    expect(nativeModelInfo('long', { id: 'long', displayName: 'n'.repeat(161) })).toBeUndefined()
    expect(nativeModelInfo('m', undefined)).toBeUndefined()
  })

  it('shows inputs only as known evidence and Fast only on a Codex connection, as the desktop picker does', () => {
    const provider = codex({
      'gpt-5.5': capability('gpt-5.5', { serviceTiers: ['priority', 'flex'] }),
      'gpt-5.5-mini': capability('gpt-5.5-mini', { inputModalities: ['text'], serviceTiers: ['flex'] }),
      'gpt-5.5-nano': capability('gpt-5.5-nano', { evidence: { inputModalities: unknown } })
    })
    expect(providerModelInfo(provider, 'gpt-5.5')).toEqual({ inputModalities: ['text', 'image'], fastMode: 'supported' })
    expect(providerModelInfo(provider, 'GPT-5.5-MINI')).toEqual({ inputModalities: ['text'], fastMode: 'unsupported' })
    expect(providerModelInfo(provider, 'gpt-5.5-nano')).toEqual({ fastMode: 'unknown' })
    expect(providerModelInfo(provider, 'unlisted')).toEqual({ fastMode: 'unknown' })
    // Another Agent borrowing the connection never sends tiers.
    expect(providerModelInfo(provider, 'gpt-5.5', false)).toEqual({ inputModalities: ['text', 'image'] })
    expect(providerFastMode({ ...provider, id: 'openai', presetSource: 'openai' }, 'gpt-5.5')).toBeUndefined()
    expect(providerFastMode({ ...provider, id: 'my-relay', presetSource: 'Codex' }, 'gpt-5.5')).toBe('supported')
  })

  it('withholds a map the protocol self-check refuses', () => {
    const route = { label: 'Kun', models: ['a'], modelInfo: { b: { displayName: 'B' } } }
    expect(checkedModelInfo(route)).toEqual({ label: 'Kun', models: ['a'] })
    const valid = { label: 'Kun', models: ['a'], ...routeModelInfo(['a', 'b'], (model) => model === 'a' ? { displayName: 'A' } : undefined) }
    expect(valid.modelInfo).toEqual({ a: { displayName: 'A' } })
    expect(checkedModelInfo(valid)).toBe(valid)
    expect(routeModelInfo(['a'], () => undefined)).toEqual({})
  })

  it("describes Kun's own Codex route on the phone catalog", async () => {
    const runtime = { modelConnections: { snapshot: async () => ({ providers: [codex({ 'gpt-5.5': capability('gpt-5.5', { serviceTiers: ['priority'] }) })],
      routePools: [], defaultProviderId: 'codex' }) }, harnesses: { catalog: { get: () => undefined } } } as unknown as ServerRuntime
    expect((await kunAgent(runtime, [])).routes[0]).toMatchObject({ providerId: 'codex',
      modelInfo: { 'gpt-5.5': { inputModalities: ['text', 'image'], fastMode: 'supported' } } })
  })

  it("lets a phone's Fast request through only to a route that supports it", async () => {
    const runtime = { modelConnections: { snapshot: async () => ({ providers: [codex({
      fast: capability('fast', { serviceTiers: ['priority'] }), slow: capability('slow', { serviceTiers: [] }) })], defaultProviderId: 'codex' }) } } as unknown as ServerRuntime
    expect(await fastServiceTier(runtime, { model: 'fast' }, 'priority')).toBe('priority')
    expect(await fastServiceTier(runtime, { model: 'fast', harnessId: 'kun', providerId: 'codex' }, 'priority')).toBe('priority')
    expect(await fastServiceTier(runtime, { model: 'fast' }, undefined)).toBeUndefined()
    expect(await fastServiceTier(runtime, { model: 'slow' }, 'priority')).toBeUndefined()
    expect(await fastServiceTier(runtime, { model: 'fast', harnessId: 'codex' }, 'priority')).toBeUndefined()
    expect(await fastServiceTier(runtime, { model: 'fast', providerId: 'other' }, 'priority')).toBeUndefined()
  })
})
