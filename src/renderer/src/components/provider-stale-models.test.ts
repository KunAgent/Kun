import { describe, expect, it } from 'vitest'
import type { ProviderConfigurationSnapshot } from '@shared/provider-configuration'
import { planStaleModelRemoval } from './provider-stale-models'

const policy = (allowedModelIds: string[]) => ({ mode: 'scoped', enabled: true, allowedRouteIds: [], allowedModelIds, allowedConnectionIds: ['one'],
  allowedProtocols: ['chat_completions'], maxConcurrent: 2, requestsPerMinute: 60, burst: 20, maxBodyBytes: 2_097_152, requestTimeoutMs: 120_000 })
const target = (id: string, providerId: string, modelId: string) => ({ id, providerId, modelId, enabled: true, weight: 1 })
const snapshot = {
  schemaVersion: 2, revision: 3, activeRevision: 3, defaultProviderId: 'one', defaultModel: 'gone-b',
  configuration: { gatewayPolicies: { gc_a: policy(['one/gone-a', 'one/kept', 'two/gone-a']), gc_b: policy(['one/kept']) } },
  connections: [{ id: 'one', models: ['kept', 'gone-a', 'gone-b', 'hidden'] }],
  routePools: [
    { id: 'coding', name: 'Coding', targets: [target('t1', 'one', 'gone-a'), target('t2', 'one', 'kept')], pick: 't1',
      rules: [{ id: 'r1', enabled: true, use: 't1', when: {} }, { id: 'r2', enabled: true, use: 't2', when: {} }] },
    { id: 'solo', name: 'Solo', targets: [target('s1', 'one', 'gone-b')] }
  ],
  failover: [], localModelGateway: {}, fieldSources: {}
} as unknown as ProviderConfigurationSnapshot
const catalog = { source: 'provider', models: ['kept', 'new-one'], manualModels: ['hidden'] }

describe('stale model removal', () => {
  it('finds models the provider stopped listing, wherever they are used, except ones added by hand', () => {
    const plan = planStaleModelRemoval(snapshot, 'one', catalog, new Map([['gc_a', 'Codex']]))
    expect(plan.models).toEqual([
      { id: 'gone-a', selected: true, routes: ['Coding'], keys: ['Codex'], isDefault: false },
      { id: 'gone-b', selected: true, routes: ['Solo'], keys: [], isDefault: true }
    ])
  })
  it('removes them in one reviewed change and never empties a route', () => {
    const plan = planStaleModelRemoval(snapshot, 'one', catalog)
    expect(plan.operations).toContainEqual({ kind: 'patch-connection', connectionId: 'one', patch: { models: ['kept', 'hidden'] } })
    const routes = plan.operations.find((operation) => operation.kind === 'set-routes')
    expect(routes && 'routes' in routes ? routes.routes : []).toEqual([
      expect.objectContaining({ id: 'coding', targets: [target('t2', 'one', 'kept')], pick: undefined, rules: [{ id: 'r2', enabled: true, use: 't2', when: {} }] }),
      expect.objectContaining({ id: 'solo', targets: [target('s1', 'one', 'gone-b')] })
    ])
    expect(plan.keptRoutes).toEqual(['Solo'])
    const policies = plan.operations.filter((operation) => operation.kind === 'set-client-policy')
    // Only the key that allowed a stale model changes; another provider's model of the same name stays.
    expect(policies).toEqual([expect.objectContaining({ clientId: 'gc_a', policy: expect.objectContaining({ allowedModelIds: ['one/kept', 'two/gone-a'] }) })])
  })
  it('does nothing unless the list came from the provider itself', () => {
    expect(planStaleModelRemoval(snapshot, 'one', { ...catalog, source: 'catalog' }).models).toEqual([])
    expect(planStaleModelRemoval(snapshot, 'one', { ...catalog, identityChanged: true }).models).toEqual([])
    expect(planStaleModelRemoval(snapshot, 'one', null).models).toEqual([])
  })
})
