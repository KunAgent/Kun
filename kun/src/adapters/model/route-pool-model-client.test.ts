import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelRoutePoolConfig } from '../../contracts/model-route-pool.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../../contracts/model-route-pool.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { RoutePoolHealthStore, RoutePoolModelClient } from './route-pool-model-client.js'

const capability = (model: string): ModelCapabilityMetadata => ({
  id: model,
  inputModalities: model.includes('vision') ? ['text', 'image'] : ['text'],
  outputModalities: ['text'],
  supportsToolCalling: !model.includes('no-tools'),
  messageParts: model.includes('vision') ? ['text', 'image_url'] : ['text'],
  ...(model.includes('reasoning') ? { reasoning: { supportedEfforts: ['off', 'high'], defaultEffort: 'high', requestProtocol: 'deepseek-chat-completions' as const } } : {})
})

function pool(strategy: ModelRoutePoolConfig['strategy'] = 'priority'): ModelRoutePoolConfig {
  return {
    id: 'kimi-pool', name: 'Kimi pool', modelId: 'kimi-auto', enabled: true, strategy,
    targets: [
      { id: 'a', providerId: 'provider-a', modelId: 'kimi', enabled: true, weight: 1 },
      { id: 'b', providerId: 'provider-b', modelId: 'kimi-vision', enabled: true, weight: 3 },
      { id: 'c', providerId: 'provider-c', modelId: 'kimi-reasoning', enabled: true, weight: 1 }
    ],
    failurePolicy: { failoverHttpStatusCodes: [401, 403, 404, 408, 425, 429, 500, 502, 503, 504], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
    healthPolicy: { failureThreshold: 2, cooldownMs: 1_000, halfOpenMaxAttempts: 1 }
  }
}

function request(patch: Partial<ModelRequest> = {}): ModelRequest {
  return { threadId: 'thread', turnId: 'turn', model: 'kimi-auto', prefix: [], history: [], tools: [], abortSignal: new AbortController().signal, ...patch }
}

async function drain(stream: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

/** Minimal healthy target response: one content commit point plus completion. */
function successfulChunks(): ModelStreamChunk[] {
  return [
    { kind: 'assistant_text_delta', text: 'ok' },
    { kind: 'completed', stopReason: 'stop' }
  ]
}

const emptyUsage = () => ({
  promptTokens: 5,
  completionTokens: 1,
  totalTokens: 6,
  cacheHitRate: null,
  turns: 1
})

class FakeDirect implements ModelClient {
  provider = 'fake'
  model = 'default'
  seen: string[] = []
  constructor(private readonly behavior: (request: ModelRequest) => ModelStreamChunk[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.seen.push(`${request.providerId}/${request.model}`)
    yield* this.behavior(request)
  }
}

describe('RoutePoolModelClient', () => {
  it('fails over before content and attributes the selected target', async () => {
    const direct = new FakeDirect((input) => input.providerId === 'provider-a'
      ? [
          { kind: 'retrying', status: 429, attempt: 1, maxAttempts: 2, delayMs: 1 },
          { kind: 'error', message: 'limited', code: 'rate_limited', failure: { category: 'rate_limit', httpStatus: 429, failoverAllowed: true } }
        ]
      : [{ kind: 'assistant_text_delta', text: 'ok' }, { kind: 'completed', stopReason: 'stop' }])
    const client = new RoutePoolModelClient(direct, [pool()], capability)
    const chunks = await drain(client.stream(request()))
    expect(direct.seen).toEqual(['provider-a/kimi', 'provider-b/kimi-vision'])
    expect(chunks.find((chunk) => chunk.kind === 'assistant_text_delta')?.route).toMatchObject({ targetId: 'b', requestedModelId: 'kimi-auto' })
    expect(chunks.some((chunk) => chunk.kind === 'retrying')).toBe(false)
    expect(chunks.every((chunk) => !chunk.route || chunk.route.targetId === 'b')).toBe(true)
  })

  it('advertises only requests whose concrete target is selected during streaming', () => {
    const client = new RoutePoolModelClient(
      new FakeDirect(() => []),
      [pool()],
      capability
    )
    expect(client.selectsRouteTargetDuringStream({
      model: 'kimi-auto'
    })).toBe(true)
    expect(client.selectsRouteTargetDuringStream({
      model: 'kimi-auto',
      providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID
    })).toBe(true)
    expect(client.selectsRouteTargetDuringStream({
      model: 'kimi-auto',
      providerId: 'provider-a'
    })).toBe(false)
    expect(client.selectsRouteTargetDuringStream({
      model: 'kimi'
    })).toBe(false)
  })

  it('uses provider identity to disambiguate a routed alias from a concrete model', async () => {
    const sameAliasPool = { ...pool(), modelId: 'kimi' }
    const direct = new FakeDirect(() => successfulChunks())
    const client = new RoutePoolModelClient(direct, [sameAliasPool], capability)

    await drain(client.stream(request({ model: 'kimi', providerId: 'provider-a' })))
    await drain(client.stream(request({ model: 'kimi', providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID })))

    expect(direct.seen).toEqual(['provider-a/kimi', 'provider-a/kimi'])
    expect(client.health.snapshot(sameAliasPool.id).events).toHaveLength(1)
  })

  it('never replays after content starts', async () => {
    const direct = new FakeDirect(() => [
      { kind: 'tool_call_delta', callId: 'call', argumentsDelta: '{' },
      { kind: 'error', message: 'stream broke', failure: { category: 'network', failoverAllowed: true } }
    ])
    const chunks = await drain(new RoutePoolModelClient(direct, [pool()], capability).stream(request()))
    expect(direct.seen).toEqual(['provider-a/kimi'])
    expect(chunks.at(-1)).toMatchObject({ kind: 'error', message: 'stream broke' })
  })

  it('filters heterogeneous targets by request capability', async () => {
    const direct = new FakeDirect(() => successfulChunks())
    const client = new RoutePoolModelClient(direct, [pool()], capability)
    await drain(client.stream(request({ attachments: [{ id: 'i', name: 'i.png', mimeType: 'image/png', dataBase64: 'AA==' }] })))
    expect(direct.seen).toEqual(['provider-b/kimi-vision'])
  })

  it('rotates and weights requests and supports health strategies', async () => {
    const direct = new FakeDirect(() => successfulChunks())
    const health = new RoutePoolHealthStore()
    const round = pool('round-robin')
    const client = new RoutePoolModelClient(direct, [round], capability, health)
    await drain(client.stream(request())); await drain(client.stream(request())); await drain(client.stream(request()))
    expect(direct.seen).toEqual(['provider-a/kimi', 'provider-b/kimi-vision', 'provider-c/kimi-reasoning'])
    direct.seen = []
    client.replacePools([pool('weighted-round-robin')])
    await drain(client.stream(request())); await drain(client.stream(request()))
    expect(direct.seen[0]).toBe('provider-a/kimi')
    expect(direct.seen[1]).toBe('provider-b/kimi-vision')
    health.success(pool(), pool().targets[1], 100)
    health.success(pool(), pool().targets[0], 900)
    health.success(pool(), pool().targets[2], 1_200)
    direct.seen = []
    client.replacePools([pool('least-latency')])
    await drain(client.stream(request()))
    expect(direct.seen[0]).toBe('provider-b/kimi-vision')
    client.replacePools([pool('adaptive')])
    expect(client.routePools()[0].strategy).toBe('adaptive')
  })

  it('retains disabled pools as configured state without exposing them to routing', () => {
    const disabled = { ...pool(), enabled: false }
    const client = new RoutePoolModelClient(new FakeDirect(() => []), [disabled], capability)

    expect(client.routePools()).toEqual([])
    expect(client.configuredPools()).toEqual([disabled])
  })

  it('opens a circuit and returns an aggregate exhaustion error', async () => {
    const direct = new FakeDirect(() => [{ kind: 'error', message: 'down', failure: { category: 'unavailable', httpStatus: 503, failoverAllowed: true } }])
    const client = new RoutePoolModelClient(direct, [pool()], capability)
    const first = await drain(client.stream(request()))
    expect(first.at(-1)).toMatchObject({ kind: 'error', code: 'route_targets_exhausted' })
    await drain(client.stream(request()))
    const third = await drain(client.stream(request()))
    expect(third.at(-1)).toMatchObject({ kind: 'error', code: 'route_no_eligible_target' })
  })

  it('fails over when a target ends without any content and reports the surviving route', async () => {
    const direct = new FakeDirect((input) => input.providerId === 'provider-a'
      ? [{ kind: 'usage', usage: emptyUsage() }, { kind: 'completed', stopReason: 'stop' }]
      : successfulChunks())
    const client = new RoutePoolModelClient(direct, [pool()], capability)
    const chunks = await drain(client.stream(request()))
    expect(direct.seen).toEqual(['provider-a/kimi', 'provider-b/kimi-vision'])
    expect(chunks.find((chunk) => chunk.kind === 'assistant_text_delta')?.route)
      .toMatchObject({ targetId: 'b' })
    expect(chunks.some((chunk) => chunk.kind === 'usage')).toBe(false)
    expect(client.health.snapshot(pool().id).events[0]).toMatchObject({
      result: 'failure',
      message: 'route target provider-a/kimi completed without any content'
    })
  })

  it('fails over on an entirely empty target stream', async () => {
    const direct = new FakeDirect((input) => input.providerId === 'provider-a'
      ? []
      : successfulChunks())
    const client = new RoutePoolModelClient(direct, [pool()], capability)
    const chunks = await drain(client.stream(request()))
    expect(direct.seen).toEqual(['provider-a/kimi', 'provider-b/kimi-vision'])
    expect(chunks.at(-1)).toMatchObject({ kind: 'completed' })
  })

  it('returns aggregate exhaustion without fabricating completion when every target is empty', async () => {
    const direct = new FakeDirect(() => [
      { kind: 'usage', usage: emptyUsage() },
      { kind: 'completed', stopReason: 'stop' }
    ])
    const client = new RoutePoolModelClient(direct, [pool()], capability)
    const chunks = await drain(client.stream(request()))
    expect(direct.seen).toEqual(['provider-a/kimi', 'provider-b/kimi-vision', 'provider-c/kimi-reasoning'])
    expect(chunks.at(-1)).toMatchObject({ kind: 'error', code: 'route_targets_exhausted' })
    expect(chunks.some((chunk) => chunk.kind === 'completed')).toBe(false)
    expect(chunks.some((chunk) => chunk.kind === 'usage')).toBe(false)
  })

  it('restores bounded metrics but resets circuit state after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-route-health-'))
    const file = join(root, 'health.json')
    const first = new RoutePoolHealthStore(file)
    first.failure(pool(), pool().targets[0], 500, { category: 'rate_limit', httpStatus: 429, retryAfterMs: 60_000, failoverAllowed: true }, 'limited')
    await first.flush()
    expect(JSON.parse(await readFile(file, 'utf8')).metrics['kimi-pool:a'].failures).toBe(1)
    const restored = new RoutePoolHealthStore(file)
    await restored.load()
    expect(restored.snapshot().metrics['kimi-pool:a'].failures).toBe(1)
    expect(restored.available(pool(), pool().targets[0])).toBe(true)
  })
})
