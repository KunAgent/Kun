import { describe, expect, it } from 'vitest'
import type { ModelConnectionProfile, ModelConnectionSnapshot } from '../../contracts/model-connections.js'
import type { ModelRoutePoolConfig } from '../../contracts/model-route-pool.js'
import { exposableProvider } from '../../domain/model-gateway-export-policy.js'
import type { HarnessTokenGrant } from '../../harness/harness-token-service.js'
import { gatewayExportStatus, listGatewayModels, resolveGatewayModel } from './model-gateway-core.js'
import type { ServerRuntime } from './server-runtime.js'

function provider(id: string, patch: Partial<ModelConnectionProfile> = {}): ModelConnectionProfile {
  return { id, accountId: id, name: id, kind: 'http', authType: 'api-key', configured: true,
    credentialStatus: 'ready', models: ['model'], useProxy: false, endpointFormat: 'chat_completions', ...patch }
}
const providers = () => [
  provider('key'), provider('backup'), provider('subscription', { authType: 'subscription' }),
  provider('oauth', { authType: 'oauth' }), provider('sdk', { kind: 'agent-sdk', authType: 'subscription' }),
  provider('missing', { credentialStatus: 'missing' }), provider('unreadable', { credentialStatus: 'unreadable' }),
  provider('unknown-health', { credentialStatus: undefined }), provider('unconfigured', { configured: false })
]
function pool(ids: string[], modelId = 'alias'): ModelRoutePoolConfig {
  return { id: modelId, name: modelId, modelId, enabled: true, strategy: 'priority',
    targets: ids.map((providerId) => ({ id: providerId, providerId, modelId: 'model', enabled: true, weight: 1 })),
    failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
    healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 } }
}
function runtime(pools = [pool(['subscription', 'sdk', 'key'])], failover: ModelConnectionSnapshot['failover'] = []): ServerRuntime {
  return { modelGateway: { pools: () => pools, configuredPools: () => pools, exposeProviderModels: () => true },
    modelConnections: { snapshot: async () => ({ providers: providers(), failover }) } } as unknown as ServerRuntime
}
function grant(ids: string[]): HarnessTokenGrant {
  return { grantId: 'grant', threadId: 'thread', harnessId: 'claude-code', scopes: ['gateway'],
    routes: ids.map((providerId) => ({ providerId, model: 'model', role: 'main' })),
    expiresAt: Number.MAX_SAFE_INTEGER, maxBodyBytes: 1000, maxConcurrent: 1 }
}
const group: ModelConnectionSnapshot['failover'] = [{ providerId: 'key', strategy: 'order',
  members: [{ providerId: 'key', enabled: true, models: ['model'] }, { providerId: 'backup', enabled: true, models: ['model'] }],
  fallbackTargets: [{ providerId: 'sdk', modelId: 'model' }, { providerId: 'oauth', modelId: 'model' }] }]

describe('model gateway export policy', () => {
  it('requires ready configured API-key HTTP credentials, with unknown health failing closed', () => {
    expect(providers().filter(exposableProvider).map((entry) => entry.id)).toEqual(['key', 'backup'])
  })

  it('filters native-only and unusable alias targets without losing valid aliases', async () => {
    const value = runtime([pool(['subscription', 'sdk'], 'blocked'), pool(['sdk', 'key'])])
    const listed = await listGatewayModels(value)
    expect(listed.map((entry) => entry.id)).toEqual(['alias', 'key/model', 'backup/model'])
    expect(await resolveGatewayModel(value, 'blocked')).toBeNull()
    expect(await resolveGatewayModel(value, 'alias')).toEqual({ model: 'alias',
      gatewayRouting: { allowedTargets: [{ providerId: 'key', modelId: 'model' }] } })
  })

  it('reports blocked export targets without erasing native configured pool state', async () => {
    const value = runtime([pool(['sdk', 'key']), pool(['missing'], 'blocked')])
    expect(await gatewayExportStatus(value)).toEqual({
      exportableModelIds: ['alias', 'key/model', 'backup/model'],
      gatewayExportPools: [
        { id: 'alias', modelId: 'alias', exportable: true, targets: [
          { id: 'sdk', providerId: 'sdk', modelId: 'model', exportable: false, reason: 'native_provider' },
          { id: 'key', providerId: 'key', modelId: 'model', exportable: true }
        ] },
        { id: 'blocked', modelId: 'blocked', exportable: false, targets: [
          { id: 'missing', providerId: 'missing', modelId: 'model', exportable: false, reason: 'credential_not_ready' }
        ] }
      ]
    })
    expect(value.modelGateway!.configuredPools()).toHaveLength(2)
  })

  it('rejects undeclared direct models and forbids the public credential from kun/ addressing', async () => {
    expect(await resolveGatewayModel(runtime(), 'key/undeclared')).toBeNull()
    expect(await resolveGatewayModel(runtime(), 'kun/key/model')).toBeNull()
    const value = runtime()
    value.modelGateway!.exposeProviderModels = () => false
    expect(await resolveGatewayModel(value, 'key/model')).toBeNull()
    expect(await resolveGatewayModel(value, 'alias')).not.toBeNull()
  })

  it('requires the same ready export eligibility for grants and discovery', async () => {
    const value = runtime()
    const scope = grant(providers().map((entry) => entry.id))
    expect((await listGatewayModels(value, scope)).map((entry) => entry.id)).toEqual(['kun/key/model', 'kun/backup/model'])
    for (const id of ['subscription', 'oauth', 'sdk', 'missing', 'unreadable', 'unknown-health']) {
      expect(await resolveGatewayModel(value, `kun/${id}/model`, scope)).toBeNull()
    }
    expect(await resolveGatewayModel(value, 'kun/backup/model', grant(['key']))).toBeNull()
  })

  it('permits configured API-key fallback while grant scope prevents disclosure to other accounts', async () => {
    const value = runtime([], group)
    expect((await resolveGatewayModel(value, 'key/model'))?.gatewayRouting.allowedTargets).toEqual([
      { providerId: 'key', modelId: 'model' }, { providerId: 'backup', modelId: 'model' }
    ])
    expect((await resolveGatewayModel(value, 'kun/key/model', grant(['key'])))?.gatewayRouting.allowedTargets)
      .toEqual([{ providerId: 'key', modelId: 'model' }])
  })

  it('never resolves stale aliases without the provider registry', async () => {
    const value = runtime()
    value.modelConnections = undefined
    expect(await listGatewayModels(value)).toEqual([])
    expect(await resolveGatewayModel(value, 'alias')).toBeNull()
  })
})


describe('legacy direct model identity', () => {
  it('resolves slash-containing stable connection IDs from declared pairs', async () => {
    const value = runtime([]), connection = provider('legacy/relay', { models: ['vendor/model'] })
    value.modelConnections!.snapshot = async () => ({ providers: [connection], failover: [] } as unknown as ModelConnectionSnapshot)
    expect((await listGatewayModels(value)).map((entry) => entry.id)).toEqual(['legacy/relay/vendor/model'])
    expect(await resolveGatewayModel(value, 'legacy/relay/vendor/model')).toMatchObject({ providerId: 'legacy/relay', model: 'vendor/model' })
  })
  it('rejects ambiguous direct addresses in discovery and inference instead of rebinding an account', async () => {
    const value = runtime([]), connections = [provider('legacy/relay'), provider('legacy', { models: ['relay/model'] })]
    value.modelConnections!.snapshot = async () => ({ providers: connections, failover: [] } as unknown as ModelConnectionSnapshot)
    expect(await listGatewayModels(value)).toEqual([])
    expect(await resolveGatewayModel(value, 'legacy/relay/model')).toBeNull()
  })
})
