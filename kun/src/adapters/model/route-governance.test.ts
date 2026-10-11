import { describe, expect, it } from 'vitest'
import { ModelRoutePoolConfigSchema } from '../../contracts/model-route-pool.js'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { RoutePoolModelClient, RoutePoolHealthStore } from './route-pool-model-client.js'
import { capabilitySupportsRequest, routeCapabilityGuarantees } from './route-capability-contract.js'
import { withGatewayRoutingBudget } from './gateway-routing-budget.js'

const pool = () => ModelRoutePoolConfigSchema.parse({ id: 'route', name: 'Route', modelId: 'coding', enabled: true,
  strategy: 'round-robin', targets: ['a', 'b'].map((id) => ({ id, providerId: id, modelId: 'model' })),
  failurePolicy: { failoverHttpStatusCodes: [500], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
  healthPolicy: { failureThreshold: 1, cooldownMs: 1000, halfOpenMaxAttempts: 1 } })
const cap = (provider = 'a'): ModelCapabilityMetadata => ({ id: 'model', supportsToolCalling: provider === 'a',
  inputModalities: ['text'], outputModalities: ['text'], messageParts: ['text'], contextWindowTokens: provider === 'a' ? 100 : 200 })
const request = (): ModelRequest => ({ threadId: 'thread', turnId: 'turn', model: 'coding', prefix: [], history: [], tools: [], abortSignal: new AbortController().signal })
async function collect(stream: AsyncIterable<ModelStreamChunk>) { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks }
function fixture() {
  const seen: string[] = []
  const direct = { provider: 'fixture', model: 'model', async *stream(input: ModelRequest): AsyncIterable<ModelStreamChunk> {
    seen.push(input.providerId!); yield { kind: 'assistant_text_delta', text: 'OK' }; yield { kind: 'completed', stopReason: 'stop' }
  } }
  const config = pool(), health = new RoutePoolHealthStore()
  const client = new RoutePoolModelClient(direct, [config], (_model, provider) => cap(provider), health)
  return { client, config, health, seen }
}
describe('route contracts and recovery', () => {
  it('explains the real next strategy order without consuming its cursor', async () => {
    const f = fixture()
    expect(f.client.previewOrder(f.config, f.config.targets).map((target) => target.id)).toEqual(['a', 'b'])
    expect(f.client.previewOrder(f.config, f.config.targets).map((target) => target.id)).toEqual(['a', 'b'])
    await collect(f.client.stream(request()))
    expect(f.client.previewOrder(f.config, f.config.targets).map((target) => target.id)).toEqual(['b', 'a'])
    await collect(f.client.stream(request())); expect(f.seen).toEqual(['a', 'b'])
  })
  it('publishes minima and leaves unknown facts outside the guarantee', () => {
    const unknown = { ...cap(), evidence: { supportsToolCalling: { source: 'adapter' as const, status: 'unknown' as const } } }
    expect(routeCapabilityGuarantees([cap('a'), cap('b')])).toMatchObject({ tools: false, contextWindowTokens: 100 })
    expect(routeCapabilityGuarantees([cap(), unknown])).toMatchObject({ tools: false, contextWindowTokens: undefined })
  })
  it('guaranteed routes reject unsupported requests while filter mode selects a capable target', async () => {
    const f = fixture(), input = { ...request(), tools: [{ name: 'read', description: 'Read', inputSchema: { type: 'object' } }] }
    f.client.replacePools([{ ...f.config, capabilityMode: 'guaranteed' }])
    expect((await collect(f.client.stream(input))).at(-1)).toMatchObject({ code: 'route_capability_not_guaranteed' })
    expect(f.seen).toEqual([])
    f.client.replacePools([{ ...f.config, capabilityMode: 'request-filter' }])
    await collect(f.client.stream(input)); expect(f.seen).toEqual(['a'])
  })
  it('manual recovery opens one bounded probe and cancellation releases it', () => {
    const config = pool(), target = config.targets[0], health = new RoutePoolHealthStore(undefined, () => 1000)
    health.failure(config, target, 10, { category: 'authentication', reason: 'auth', failoverAllowed: true }, 'auth')
    expect(health.available(config, target)).toBe(false)
    health.retry(config, target); expect(health.available(config, target)).toBe(true)
    health.begin(config, target); expect(health.available(config, target)).toBe(false)
    health.abandon(config, target); expect(health.available(config, target)).toBe(true)
    health.begin(config, target); health.success(config, target, 10); expect(health.available(config, target)).toBe(true)
  })
  it('does not silently lower reasoning effort or drop explicit JSON/parallel requirements', () => {
    const low = { ...cap(), reasoning: { supportedEfforts: ['off' as const, 'low' as const], defaultEffort: 'low' as const, requestProtocol: 'openai-responses' as const } }
    expect(capabilitySupportsRequest(low, { ...request(), reasoningEffort: 'high' })).toBe(false)
    expect(capabilitySupportsRequest(cap(), { ...request(), responseFormat: 'json_object' })).toBe(false)
    expect(capabilitySupportsRequest(cap(), { ...request(), parallelToolCalls: true, tools: [{ name: 'read', description: 'read', inputSchema: {} }] })).toBe(false)
  })
  it('records recovery success before completed is delivered and releases an early-return lease', async () => {
    const f = fixture(), target = f.config.targets[0]
    f.health.retry(f.config, target)
    for await (const chunk of f.client.stream(request())) if (chunk.kind === 'completed') break
    expect(f.health.state(f.config.id, target.id).successes).toBe(1)
    expect(f.health.available(f.config, target)).toBe(true)
    f.health.retry(f.config, target)
    for await (const chunk of f.client.stream(request())) if (chunk.kind === 'assistant_text_delta') break
    expect(f.health.available(f.config, target)).toBe(true)
  })
  it('acquires all recovery tiers atomically and refuses concurrent over-admission', () => {
    const f = fixture(), target = f.config.targets[0], modelTier = { ...target, id: 'model-tier' }
    f.health.retry(f.config, modelTier)
    const release = f.health.acquire(f.config, [target, modelTier])!
    expect(f.health.acquire(f.config, [target, modelTier])).toBeUndefined()
    release(); release()
    expect(f.health.available(f.config, modelTier)).toBe(true)
  })
  it('cannot dispatch after an inherited absolute deadline and keeps one request identity', async () => {
    let dispatched = 0
    const chunks = await collect(withGatewayRoutingBudget({ ...request(), requestId: 'stable', deadlineAt: Date.now() - 1 }, async function* () {
      dispatched++; yield { kind: 'completed', stopReason: 'stop' }
    }))
    expect(dispatched).toBe(0); expect(chunks[0]).toMatchObject({ code: 'route_deadline_exceeded' })
    await collect(withGatewayRoutingBudget({ ...request(), requestId: 'stable' }, async function* (input) {
      expect(input.requestId).toBe('stable'); expect(input.routingBudget?.requestId).toBe('stable')
      expect(input.deadlineAt).toBe(input.routingBudget?.deadlineAt)
      yield { kind: 'completed', stopReason: 'stop' }
    }))
  })
})
