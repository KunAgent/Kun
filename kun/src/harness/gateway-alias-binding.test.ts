import { describe, expect, it } from 'vitest'
import { freezeHarnessGatewayAliases } from './gateway-alias-binding.js'
import { HarnessTokenService } from './harness-token-service.js'
import { ModelConnectionSnapshotSchema } from '../contracts/model-connections.js'
import { resolveGatewayModel, listGatewayModels } from '../server/routes/model-gateway-core.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'

function snapshot() {
  return ModelConnectionSnapshotSchema.parse({ schemaVersion: 1, proxyRoutingVersion: 1, revision: 1,
    providers: ['one', 'two'].map((id) => ({ id, accountId: id, name: id, kind: 'http', authType: 'api-key',
      endpointFormat: 'chat_completions', baseUrl: 'https://example.test', configured: true, useProxy: false,
      credentialStatus: 'ready', models: ['model'] })), routePools: [{ id: 'coding', name: 'Coding', modelId: 'route/coding',
      targets: ['one', 'two'].map((providerId) => ({ id: providerId, providerId, modelId: 'model' })),
      failurePolicy: { failoverHttpStatusCodes: [429], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: false },
      healthPolicy: { failureThreshold: 3, cooldownMs: 1000, halfOpenMaxAttempts: 1 } }] })
}
describe('structured Agent alias grants', () => {
  it('freezes approved alias targets and keeps discovery, resolution and reissue inside that scope', async () => {
    const state = snapshot(), tokens = new HarnessTokenService()
    const aliases = freezeHarnessGatewayAliases(state, { main: { routeId: 'coding', allowedConnectionIds: ['one'] } })
    const base = { harnessId: 'codex', threadId: 'thread', credentialIdentity: 'profile', scopes: ['gateway'] as const }
    const key = tokens.issue({ ...base, aliasRoutes: aliases })
    const grant = tokens.verify(key)!
    const runtime = { harnessTokens: tokens, modelConnections: { snapshot: async () => state },
      modelGateway: { pools: () => state.routePools } } as unknown as ServerRuntime
    const resolved = await resolveGatewayModel(runtime, 'route/coding', grant)
    expect(resolved?.gatewayRouting.allowedTargets).toEqual([{ providerId: 'one', modelId: 'model' }])
    expect(resolved?.providerId).toBeUndefined()
    expect((await listGatewayModels(runtime, grant)).map((model) => model.id)).toEqual(['route/coding'])
    expect(await resolveGatewayModel(runtime, 'kun/two/model', grant)).toBeNull()
    const widened = tokens.issue({ ...base, aliasRoutes: freezeHarnessGatewayAliases(state,
      { main: { routeId: 'coding', allowedConnectionIds: ['one', 'two'] } }) })
    expect(widened).not.toBe(key)
    expect(grant.aliasRoutes?.[0].targets).toHaveLength(1)
    state.routePools[0].targets = state.routePools[0].targets.filter((target) => target.providerId !== 'one')
    expect(await resolveGatewayModel(runtime, 'route/coding', grant)).toBeNull()
    expect(await listGatewayModels(runtime, grant)).toEqual([])
  })
  it('never promotes a native subscription to an exportable alias target', () => {
    const state = snapshot(); state.providers[0].authType = 'subscription'
    expect(() => freezeHarnessGatewayAliases(state, { main: { routeId: 'coding', allowedConnectionIds: ['one'] } })).toThrow('no approved exportable target')
  })
})
