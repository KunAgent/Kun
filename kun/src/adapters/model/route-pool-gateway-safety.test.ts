import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelRoutePoolConfig } from '../../contracts/model-route-pool.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { GATEWAY_MAX_ROUTE_ATTEMPTS, GATEWAY_REQUEST_TIMEOUT_MS } from './gateway-routing-budget.js'
import { RoutePoolHealthStore, RoutePoolModelClient } from './route-pool-model-client.js'

const capabilities = (): ModelCapabilityMetadata => ({ id: 'model', inputModalities: ['text'],
  outputModalities: ['text'], messageParts: ['text'], supportsToolCalling: true })
const target = (id: string) => ({ id, providerId: id, modelId: 'model', enabled: true, weight: 1 })
const route = (ids = ['a', 'b', 'c']): ModelRoutePoolConfig => ({ id: 'pool', name: 'Pool', modelId: 'alias', enabled: true,
  strategy: 'priority', targets: ids.map(target),
  failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: false },
  healthPolicy: { failureThreshold: 3, cooldownMs: 1000, halfOpenMaxAttempts: 1 } })
const fail = (): ModelStreamChunk => ({ kind: 'error', message: 'unavailable',
  failure: { category: 'unavailable', httpStatus: 503, failoverAllowed: true } })
const request = (ids = ['a', 'b', 'c'], patch: Partial<ModelRequest> = {}): ModelRequest => ({
  model: 'alias', threadId: 'thread', turnId: 'turn', prefix: [], history: [], tools: [],
  abortSignal: new AbortController().signal, gatewayRouting: { allowedTargets: ids.map(target) }, ...patch })
async function drain(stream: AsyncIterable<ModelStreamChunk>) {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
function direct(run: (input: ModelRequest) => AsyncIterable<ModelStreamChunk>) {
  const seen: ModelRequest[] = []
  const client: ModelClient = { provider: 'test', model: 'model', stream(input) { seen.push(input); return run(input) } }
  return { seen, client }
}
afterEach(() => vi.useRealTimers())

describe('gateway route bounds and disclosure', () => {
  it('caps all routed attempts and disables multiplying per-provider retries', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const fake = direct(async function* () { yield fail() })
    const client = new RoutePoolModelClient(fake.client, [route(ids)], capabilities)
    const chunks = await drain(client.stream(request(ids)))
    expect(fake.seen).toHaveLength(GATEWAY_MAX_ROUTE_ATTEMPTS)
    expect(fake.seen.every((entry) => entry.maxRetryAttempts === 0)).toBe(true)
    expect(chunks.at(-1)).toMatchObject({ code: 'route_attempt_budget_exhausted' })
  })

  it('never sends the request to alias targets excluded by export admission', async () => {
    const fake = direct(async function* () { yield fail() })
    const client = new RoutePoolModelClient(fake.client, [route()], capabilities)
    await drain(client.stream(request(['b'])))
    expect(fake.seen.map((entry) => entry.providerId)).toEqual(['b'])
  })

  it('never expands a grant allowlist through account-group members or fallbacks', async () => {
    const fake = direct(async function* () { yield fail() })
    const client = new RoutePoolModelClient(fake.client, [], capabilities)
    client.replaceFailoverGroups([{ providerId: 'a', strategy: 'order',
      members: ['a', 'b'].map((providerId) => ({ providerId, enabled: true, models: ['model'] })),
      fallbackTargets: [{ providerId: 'c', modelId: 'model' }] }])
    await drain(client.stream(request(['a'], { model: 'model', providerId: 'a' })))
    expect(fake.seen.map((entry) => entry.providerId)).toEqual(['a'])
    const rejected = await drain(client.stream(request(['a'], { model: 'model', providerId: 'other' })))
    expect(rejected.at(-1)).toMatchObject({ code: 'gateway_route_not_allowed' })
    expect(fake.seen).toHaveLength(1)
  })

  it.each<ModelStreamChunk>([
    { kind: 'assistant_text_delta', text: 'partial' },
    { kind: 'assistant_reasoning_delta', text: 'thinking' },
    { kind: 'tool_call_delta', callId: 'call', argumentsDelta: '{' },
    { kind: 'tool_call_complete', callId: 'call', toolName: 'search', arguments: {} }
  ])('never retries after content or tool commitment: $kind', async (committed) => {
    const fake = direct(async function* () { yield committed; yield fail() })
    const client = new RoutePoolModelClient(fake.client, [route()], capabilities)
    const chunks = await drain(client.stream(request()))
    expect(fake.seen).toHaveLength(1)
    expect(chunks.at(-1)).toMatchObject({ kind: 'error', message: 'unavailable' })
  })

  it('uses one deadline and stops a hanging provider without trying another target', async () => {
    vi.useFakeTimers()
    let upstreamSignal: AbortSignal | undefined
    const fake = direct((input) => {
      upstreamSignal = input.abortSignal
      return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) }
    })
    const client = new RoutePoolModelClient(fake.client, [route()], capabilities)
    const completed = drain(client.stream(request()))
    await vi.advanceTimersByTimeAsync(GATEWAY_REQUEST_TIMEOUT_MS)
    expect((await completed).at(-1)).toMatchObject({ code: 'route_deadline_exceeded' })
    expect(upstreamSignal?.aborted).toBe(true)
    expect(fake.seen).toHaveLength(1)
  })

  it('does not reset the shared deadline when changing targets', async () => {
    vi.useFakeTimers()
    const fake = direct(async function* (input) {
      if (input.providerId === 'a') {
        await new Promise((resolve) => setTimeout(resolve, 100_000))
        yield fail()
      } else await new Promise(() => undefined)
    })
    const client = new RoutePoolModelClient(fake.client, [route()], capabilities)
    const completed = drain(client.stream(request()))
    await vi.advanceTimersByTimeAsync(GATEWAY_REQUEST_TIMEOUT_MS)
    expect((await completed).at(-1)).toMatchObject({ code: 'route_deadline_exceeded' })
    expect(fake.seen.map((entry) => entry.providerId)).toEqual(['a', 'b'])
  })

  it('preserves native routing independently of gateway attempt and export limits', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const fake = direct(async function* () { yield fail() })
    const client = new RoutePoolModelClient(fake.client, [route(ids)], capabilities)
    await drain(client.stream(request([], { gatewayRouting: undefined })))
    expect(fake.seen).toHaveLength(ids.length)
    expect(fake.seen.every((entry) => entry.maxRetryAttempts === undefined)).toBe(true)
  })

  it('does not start an upstream attempt after cancellation', async () => {
    const abort = new AbortController()
    abort.abort()
    const fake = direct(async function* () { yield fail() })
    const client = new RoutePoolModelClient(fake.client, [route()], capabilities)
    expect((await drain(client.stream(request(undefined, { abortSignal: abort.signal })))).at(-1))
      .toMatchObject({ code: 'route_request_aborted' })
    expect(fake.seen).toHaveLength(0)
  })

  it('honors Retry-After on the first unavailable failure before the threshold', () => {
    let now = 1000
    const health = new RoutePoolHealthStore(undefined, () => now)
    health.failure(route(), target('a'), 1, { category: 'unavailable', httpStatus: 503,
      retryAfterMs: 30_000, failoverAllowed: true }, 'retry later')
    expect(health.available(route(), target('a'))).toBe(false)
    now += 30_000
    expect(health.available(route(), target('a'))).toBe(true)
  })
})
