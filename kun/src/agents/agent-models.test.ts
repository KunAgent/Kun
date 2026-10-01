import { expect, it } from 'vitest'
import { agentModelOptions, assertAgentModel } from './agent-models.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import { AgentIdentitySchema } from '../contracts/agent-identities.js'
import { ModelConnectionSnapshotSchema } from '../contracts/model-connections.js'
const agent = AgentIdentitySchema.parse({ schemaVersion: 1, id: 'agent', name: 'Kun', createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z', revision: 0 })
const deps = {
  model: () => ({ providerId: 'one', model: 'main', accountId: 'account-one' }), profiles: () => ({}),
  peerModels: { roles: () => ({ smallModel: 'fast', smallModelProviderId: 'two', smallModelAccountId: 'account-two' }) },
  unsupportedProviderIds: () => ['sdk'],
  modelSnapshot: async () => ModelConnectionSnapshotSchema.parse({ schemaVersion: 1, proxyRoutingVersion: 1, revision: 0,
    defaultProviderId: 'one', defaultAccountId: 'account-one', defaultModel: 'main',
    providers: [{ id: 'one', accountId: 'account-one', name: 'One', kind: 'http', authType: 'api-key', endpointFormat: 'chat_completions', useProxy: false, configured: true, credentialStatus: 'ready', models: ['main', 'other'] },
      { id: 'two', accountId: 'account-two', name: 'Two', kind: 'http', authType: 'api-key', endpointFormat: 'chat_completions', useProxy: false, configured: true, credentialStatus: 'ready', models: ['fast'] },
      { id: 'sdk', accountId: 'sdk-account', name: 'SDK', kind: 'agent-sdk', authType: 'subscription', endpointFormat: 'chat_completions', useProxy: false, configured: true, credentialStatus: 'ready', models: ['native'] }] })
} as unknown as RoomRuntimeDeps
it('resolves main and lightweight inheritance with concrete provider and account identities', async () => {
  const result = await agentModelOptions(deps, agent)
  expect(result.main).toEqual({ providerId: 'one', accountId: 'account-one', model: 'main' })
  expect(result.fast).toEqual({ providerId: 'two', accountId: 'account-two', model: 'fast' })
  expect(result.mainSource).toBe('default'); expect(result.fastSource).toBe('default')
  const fixed = await agentModelOptions(deps, { ...agent, modelRef: { providerId: 'one', model: 'other' }, fastModelRef: { providerId: 'one', accountId: 'account-one', model: 'main' } })
  expect(fixed.main.model).toBe('other'); expect(fixed.main.accountId).toBe('account-one')
  expect(fixed.fast?.model).toBe('main'); expect(fixed.fastSource).toBe('agent')
})
it('does not silently adopt a replacement account or expose incompatible scoped providers as available', async () => {
  const result = await agentModelOptions(deps, { ...agent, modelRef: { providerId: 'one', accountId: 'deleted-account', model: 'main' } })
  expect(result.main.accountId).toBe('deleted-account'); expect(result.mainAvailable).toBe(false)
  expect(result.options.find((item) => item.providerId === 'sdk')?.available).toBe(false)
  await expect(assertAgentModel(deps, result.main)).rejects.toThrow('unavailable')
  await expect(assertAgentModel(deps, { providerId: 'two', accountId: 'account-one', model: 'fast' })).rejects.toThrow('unavailable')
  await expect(assertAgentModel(deps, { providerId: 'sdk', model: 'native' }, true)).rejects.toThrow('background')
})
it('falls back to main for background work only when no lightweight route is configured', async () => {
  const result = await agentModelOptions({ ...deps, peerModels: undefined }, agent)
  expect(result.fast).toEqual(result.main); expect(result.fastSource).toBe('main')
})
it('hides leftover OpenCode Free connections from bot inheritance and the picker', async () => {
  const leftoverSnapshot = ModelConnectionSnapshotSchema.parse({
    schemaVersion: 1, proxyRoutingVersion: 1, revision: 0,
    defaultProviderId: 'opencode-free', defaultAccountId: 'account-free', defaultModel: 'big-pickle',
    providers: [{
      id: 'opencode-free', accountId: 'account-free', name: 'OpenCore Free', presetSource: 'opencode-free',
      kind: 'http', authType: 'api-key', endpointFormat: 'chat_completions', useProxy: false,
      configured: true, credentialStatus: 'ready', models: ['big-pickle', 'gpt-5-nano']
    }, {
      id: 'one', accountId: 'account-one', name: 'One', kind: 'http', authType: 'api-key',
      endpointFormat: 'chat_completions', useProxy: false, configured: true, credentialStatus: 'ready',
      models: ['main', 'other']
    }, {
      id: 'two', accountId: 'account-two', name: 'Two', kind: 'http', authType: 'api-key',
      endpointFormat: 'chat_completions', useProxy: false, configured: true, credentialStatus: 'ready',
      models: ['fast']
    }, {
      id: 'sdk', accountId: 'sdk-account', name: 'SDK', kind: 'agent-sdk', authType: 'subscription',
      endpointFormat: 'chat_completions', useProxy: false, configured: true, credentialStatus: 'ready',
      models: ['native']
    }]
  })
  const leftoverDeps = {
    ...deps,
    model: () => ({ providerId: 'opencode-free', model: 'big-pickle' }),
    modelSnapshot: async () => leftoverSnapshot
  }
  const leftover = await agentModelOptions(leftoverDeps, agent)
  expect(leftover.options.map((item) => item.providerId)).not.toContain('opencode-free')
  expect(leftover.options.some((item) => item.model === 'big-pickle')).toBe(false)
  expect(leftover.inheritedMain).toEqual({ providerId: 'one', accountId: 'account-one', model: 'main' })
  expect(leftover.main).toEqual({ providerId: 'one', accountId: 'account-one', model: 'main' })
  await expect(assertAgentModel(leftoverDeps, { providerId: 'opencode-free', model: 'big-pickle' }))
    .rejects.toThrow('unavailable')
})
