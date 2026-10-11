import { describe, expect, it, vi } from 'vitest'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelRequest, ModelClient, ModelStreamChunk } from '../../ports/model-client.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { resolveGatewayModel } from '../../server/routes/model-gateway-core.js'
import { CompatModelClient } from './compat-model-client.js'
import { MultiProviderModelClient } from './multi-provider-model-client.js'
import { RoutePoolModelClient } from './route-pool-model-client.js'

const capability = (): ModelCapabilityMetadata => ({ id: 'model', inputModalities: ['text'], outputModalities: ['text'],
  supportsToolCalling: true, messageParts: ['text'] })
function request(patch: Partial<ModelRequest> = {}): ModelRequest {
  return { threadId: 'thread', turnId: 'turn', model: 'model', providerId: 'key', prefix: [], history: [], tools: [],
    abortSignal: new AbortController().signal, ...patch }
}
async function drain(stream: AsyncIterable<ModelStreamChunk>) {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
const unavailable: ModelStreamChunk = { kind: 'error', message: 'unavailable',
  failure: { category: 'unavailable', httpStatus: 503, failoverAllowed: true } }

describe('gateway concrete dispatch fence', () => {
  it('counts protocol-shape fallback POSTs against one shared HTTP attempt budget', async () => {
    const sent: string[] = []
    const clients = new Map<string, ModelClient>()
    for (const id of ['a', 'b', 'c']) {
      let attempts = 0
      clients.set(id, new CompatModelClient({ baseUrl: `https://${id}.example`, apiKey: 'api-key', model: 'model',
        fetchImpl: (async () => {
          sent.push(id)
          attempts += 1
          return attempts % 2 === 1 ? new Response('stream_options unsupported', { status: 400 })
            : new Response('unavailable', { status: 503 })
        }) as typeof fetch }))
    }
    const direct = new MultiProviderModelClient({ default: clients.get('a')!, providers: clients, gatewayClients: clients })
    const routed = new RoutePoolModelClient(direct, [], capability)
    routed.replaceFailoverGroups([{ providerId: 'a', strategy: 'order',
      members: ['a', 'b', 'c'].map((providerId) => ({ providerId, models: ['model'], enabled: true })), fallbackTargets: [] }])
    const chunks = await drain(routed.stream(request({ providerId: 'a', gatewayRouting: {
      allowedTargets: ['a', 'b', 'c'].map((providerId) => ({ providerId, modelId: 'model' })),
      assertCurrent: direct.gatewayDispatchGuard()
    } })))
    expect(sent).toEqual(['a', 'a', 'b', 'b'])
    expect(chunks.at(-1)).toMatchObject({ kind: 'error', code: 'route_attempt_budget_exhausted', failure: { failoverAllowed: false } })
  })

  it('rejects a changed client generation between primary failure and fallback', async () => {
    let router: MultiProviderModelClient
    const nativeStream = vi.fn(async function* () { yield { kind: 'assistant_text_delta' as const, text: 'native' } })
    const native: ModelClient = { model: 'model', provider: 'native-sdk', stream: nativeStream }
    const backup: ModelClient = { model: 'model', provider: 'http', async *stream() { yield unavailable } }
    const primary: ModelClient = { model: 'model', provider: 'http', async *stream() {
      router.replace({ default: primary, providers: new Map([['a', primary], ['b', native]]),
        gatewayClients: new Map([['a', primary]]) })
      yield unavailable
    } }
    const providers = new Map([['a', primary], ['b', backup]])
    router = new MultiProviderModelClient({ default: primary, providers, gatewayClients: providers })
    const routed = new RoutePoolModelClient(router, [{ id: 'pool', name: 'Pool', modelId: 'alias', enabled: true,
      strategy: 'priority', targets: ['a', 'b'].map((providerId) => ({ id: providerId, providerId, modelId: 'model', enabled: true, weight: 1 })),
      failurePolicy: { failoverHttpStatusCodes: [503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: false },
      healthPolicy: { failureThreshold: 3, cooldownMs: 1000, halfOpenMaxAttempts: 1 } }], capability)
    const chunks = await drain(routed.stream(request({ model: 'alias', providerId: undefined, gatewayRouting: {
      allowedTargets: ['a', 'b'].map((providerId) => ({ providerId, modelId: 'model' })), assertCurrent: router.gatewayDispatchGuard()
    } })))
    expect(chunks.at(-1)).toMatchObject({ kind: 'error', code: 'gateway_route_changed' })
    expect(nativeStream).not.toHaveBeenCalled()
  })

  it('requires trusted eligible concrete client identity even with a fresh generation proof', () => {
    const stream = vi.fn(async function* () { yield unavailable })
    const native: ModelClient = { provider: 'native-sdk', model: 'model', stream }
    const router = new MultiProviderModelClient({ default: native, providers: new Map([['key', native]]) })
    expect(() => router.stream(request({ gatewayRouting: { allowedTargets: [{ providerId: 'key', modelId: 'model' }],
      assertCurrent: router.gatewayDispatchGuard() } }))).toThrow(/configuration changed/)
    expect(stream).not.toHaveBeenCalled()
  })

  it.each(['router-generation', 'durable-revision'] as const)(
    'rechecks %s after awaited credential resolution and before fetch', async (mutation) => {
      let release!: () => void
      let resolving!: () => void
      const started = new Promise<void>((resolve) => { resolving = resolve })
      const waiting = new Promise<void>((resolve) => { release = resolve })
      const fetchImpl = vi.fn<typeof fetch>()
      const http = new CompatModelClient({ baseUrl: 'https://old.example', apiKey: '', model: 'model',
        fetchImpl, nonStreaming: true, resolveCredentials: async () => {
          resolving()
          await waiting
          return { apiKey: 'changed-subscription-token', refreshable: false }
        } })
      const providers = new Map<string, ModelClient>([['key', http]])
      const direct = new MultiProviderModelClient({ default: http, providers, gatewayClients: providers })
      let revision = 1
      const runtime = { directModelClient: direct, modelGateway: { pools: () => [], exposeProviderModels: () => true },
        modelConnections: { snapshot: async () => ({ revision, failover: [], providers: [{ id: 'key', kind: 'http',
          authType: 'api-key', configured: true, credentialStatus: 'ready', models: ['model'] }] }),
        assertRevision: async (expected: number) => { if (expected !== revision) throw new Error('revision changed') } }
      } as unknown as ServerRuntime
      const resolved = await resolveGatewayModel(runtime, 'key/model')
      expect(resolved).not.toBeNull()
      const routed = new RoutePoolModelClient(direct, [], capability)
      const finished = drain(routed.stream(request({ gatewayRouting: resolved!.gatewayRouting })))
      await started
      if (mutation === 'router-generation') direct.replace({ default: http, providers, gatewayClients: providers })
      else revision += 1
      release()
      expect((await finished).at(-1)).toMatchObject({ kind: 'error', code: 'gateway_route_changed',
        failure: { failoverAllowed: false } })
      expect(fetchImpl).not.toHaveBeenCalled()
    })
})
