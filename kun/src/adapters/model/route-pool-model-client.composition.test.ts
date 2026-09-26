import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelRoutePoolConfig } from '../../contracts/model-route-pool.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { MultiProviderModelClient } from './multi-provider-model-client.js'
import { RoutePoolHealthStore, RoutePoolModelClient } from './route-pool-model-client.js'

const capability = (): ModelCapabilityMetadata => ({
  id: 'any',
  inputModalities: ['text'],
  outputModalities: ['text'],
  supportsToolCalling: true,
  messageParts: ['text']
})

function pool(): ModelRoutePoolConfig {
  return {
    id: 'auto-pool',
    name: 'Auto pool',
    modelId: 'auto',
    enabled: true,
    strategy: 'priority',
    targets: [
      { id: 'a', providerId: 'provider-a', modelId: 'model-x', enabled: true, weight: 1 },
      { id: 'b', providerId: 'provider-b', modelId: 'model-y', enabled: true, weight: 1 }
    ],
    failurePolicy: {
      failoverHttpStatusCodes: [401, 403, 404, 408, 425, 429, 500, 502, 503, 504],
      failoverOnNetworkError: true,
      failoverOnTimeout: true,
      failoverOnAuthError: true
    },
    healthPolicy: { failureThreshold: 2, cooldownMs: 1_000, halfOpenMaxAttempts: 1 }
  }
}

function request(patch: Partial<ModelRequest> = {}): ModelRequest {
  return {
    threadId: 'thread',
    turnId: 'turn-1',
    model: 'auto',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: new AbortController().signal,
    ...patch
  }
}

async function drain(stream: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function fakeProvider(
  providerId: string,
  behavior: (request: ModelRequest) => ModelStreamChunk[]
): ModelClient & { calls: number } {
  const client = {
    provider: providerId,
    model: 'm',
    calls: 0,
    async *stream(req: ModelRequest) {
      client.calls += 1
      yield* behavior(req)
    }
  }
  return client as ModelClient & { calls: number }
}

describe('RoutePoolModelClient over MultiProviderModelClient (production composition)', () => {
  it('fails over across providers within one turn', async () => {
    const providerA = fakeProvider('provider-a', () => [{
      kind: 'error',
      message: 'quota exceeded',
      code: 'http_429',
      failure: { category: 'quota', reason: 'quota', httpStatus: 429, failoverAllowed: true }
    }])
    const providerB = fakeProvider('provider-b', () => [
      { kind: 'assistant_text_delta', text: 'ok' },
      { kind: 'completed', stopReason: 'stop' }
    ])
    const direct = new MultiProviderModelClient({
      default: providerA,
      providers: new Map([
        ['provider-a', providerA],
        ['provider-b', providerB]
      ])
    })
    const health = new RoutePoolHealthStore()
    const client = new RoutePoolModelClient(direct, [pool()], capability, health)

    const chunks = await drain(client.stream(request()))

    expect(providerA.calls).toBe(1)
    expect(providerB.calls).toBe(1)
    expect(chunks.some((c) => c.kind === 'route_switching')).toBe(true)
    const text = chunks.find((c) => c.kind === 'assistant_text_delta')
    expect(text).toMatchObject({ text: 'ok' })
    expect(text?.route?.providerId).toBe('provider-b')
    expect(chunks.some((c) => c.kind === 'error')).toBe(false)
    // The healthy failover target must not be blamed for the switch.
    expect(health.state('auto-pool', 'b').failures).toBe(0)
    expect(health.state('auto-pool', 'a').failures).toBe(1)
  })

  it('still rejects a silent provider change within a turn', async () => {
    const providerA = fakeProvider('provider-a', () => [])
    const providerB = fakeProvider('provider-b', () => [])
    const direct = new MultiProviderModelClient({
      default: providerA,
      providers: new Map([
        ['provider-a', providerA],
        ['provider-b', providerB]
      ])
    })
    const client = new RoutePoolModelClient(direct, [], capability)

    direct.stream(request({ providerId: 'provider-a', model: 'model-x' }))
    expect(() => direct.stream(request({ providerId: 'provider-b', model: 'model-y' })))
      .toThrow(/model provider changed within turn/)
    expect(client.model).toBe('m')
  })

  it('routes gateway requests whose turnId is fresh per request', async () => {
    const providerA = fakeProvider('provider-a', () => [{
      kind: 'error',
      message: 'insufficient credit',
      code: 'http_402',
      failure: { category: 'quota', reason: 'credit', httpStatus: 402, failoverAllowed: true }
    }])
    const providerB = fakeProvider('provider-b', () => [
      { kind: 'assistant_text_delta', text: 'ok' },
      { kind: 'completed', stopReason: 'stop' }
    ])
    const direct = new MultiProviderModelClient({
      default: providerA,
      providers: new Map([
        ['provider-a', providerA],
        ['provider-b', providerB]
      ])
    })
    const client = new RoutePoolModelClient(direct, [pool()], capability)

    const chunks = await drain(client.stream(request({ turnId: `turn_${randomUUID()}` })))
    expect(providerB.calls).toBe(1)
    expect(chunks.some((c) => c.kind === 'error')).toBe(false)
  })

  it('rejects a route selection whose target does not match the request provider', async () => {
    const providerA = fakeProvider('provider-a', () => [])
    const direct = new MultiProviderModelClient({
      default: providerA,
      providers: new Map([['provider-a', providerA]])
    })
    expect(() =>
      direct.stream(request({
        providerId: 'provider-a',
        routeSelection: { kind: 'route-pool', id: 'p1', targetProviderId: 'provider-b' }
      }))
    ).toThrow(/target mismatch/)
  })
})
