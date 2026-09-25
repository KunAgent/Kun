import { describe, expect, it } from 'vitest'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelFailoverGroup } from '../../contracts/model-route-pool.js'
import type { ProviderQuotaEntry } from '../../contracts/provider-quota.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { RoutePoolHealthStore, RoutePoolModelClient } from './route-pool-model-client.js'

const capability = (): ModelCapabilityMetadata => ({
  id: 'any',
  inputModalities: ['text'],
  outputModalities: ['text'],
  supportsToolCalling: true,
  messageParts: ['text']
})

function group(patch: Partial<ModelFailoverGroup> = {}): ModelFailoverGroup {
  return {
    providerId: 'acct-a',
    members: [
      { providerId: 'acct-a', enabled: true, models: ['model-x'] },
      { providerId: 'acct-b', enabled: true, models: ['model-x'] }
    ],
    strategy: 'order',
    fallbackTargets: [
      { providerId: 'backup-1', modelId: 'backup-model' },
      { providerId: 'backup-2', modelId: 'backup-model' }
    ],
    ...patch
  }
}

function request(patch: Partial<ModelRequest> = {}): ModelRequest {
  return {
    threadId: 'thread',
    turnId: 'turn',
    model: 'model-x',
    providerId: 'acct-a',
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

const ok = (): ModelStreamChunk[] => [
  { kind: 'assistant_text_delta', text: 'ok' },
  { kind: 'completed', stopReason: 'stop' }
]

const fail = (): ModelStreamChunk[] => [
  {
    kind: 'error',
    message: 'upstream failed',
    code: 'http_500',
    failure: { category: 'unavailable', httpStatus: 500, failoverAllowed: true }
  }
]

const credit = (): ModelStreamChunk[] => [
  {
    kind: 'error',
    message: 'insufficient credit',
    code: 'http_402',
    failure: { category: 'quota', reason: 'credit', httpStatus: 402, failoverAllowed: true }
  }
]

const rate = (): ModelStreamChunk[] => [
  {
    kind: 'error',
    message: 'rate limited',
    code: 'http_429',
    failure: { category: 'rate_limit', reason: 'rate', httpStatus: 429, failoverAllowed: true }
  }
]

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

function quotaEntry(providerId: string, usedPercent: number): ProviderQuotaEntry {
  return {
    providerId,
    providerName: providerId,
    status: 'available',
    metrics: [{ id: 'quota', label: 'quota', unit: '%', usedPercent }]
  }
}

describe('failover group routing', () => {
  it('tries every member before cross-provider fallbacks, keeping fallback order', async () => {
    const direct = new FakeDirect((input) =>
      input.providerId === 'backup-1' ? ok() : fail())
    const client = new RoutePoolModelClient(direct, [], capability)
    client.replaceFailoverGroups([group({ strategy: 'rotate' })])

    const chunks = await drain(client.stream(request()))
    // Rotate members first, then both fallbacks in configured order.
    expect(direct.seen.slice(0, 2).sort()).toEqual(['acct-a/model-x', 'acct-b/model-x'])
    expect(direct.seen[2]).toBe('backup-1/backup-model')
    expect(chunks.some((chunk) => chunk.kind === 'route_switching')).toBe(true)
    expect(chunks.at(-1)).toMatchObject({ kind: 'completed' })
  })

  it('honors configured member order for the `order` strategy', async () => {
    const direct = new FakeDirect((input) =>
      input.providerId === 'acct-b' ? ok() : fail())
    const client = new RoutePoolModelClient(direct, [], capability)
    client.replaceFailoverGroups([group({ strategy: 'order' })])

    await drain(client.stream(request({ providerId: 'acct-a' })))
    expect(direct.seen.slice(0, 2)).toEqual(['acct-a/model-x', 'acct-b/model-x'])

    // A request addressed to a non-representative member starts there.
    direct.seen = []
    const direct2 = new FakeDirect((input) =>
      input.providerId === 'acct-a' ? ok() : fail())
    const client2 = new RoutePoolModelClient(direct2, [], capability)
    client2.replaceFailoverGroups([group({ strategy: 'order' })])
    await drain(client2.stream(request({ providerId: 'acct-b' })))
    expect(direct2.seen[0]).toBe('acct-b/model-x')
  })

  it('pins thread affinity on the successful member under `smart`', async () => {
    const direct = new FakeDirect((input) =>
      input.providerId === 'acct-b' ? ok() : fail())
    const client = new RoutePoolModelClient(direct, [], capability)
    client.replaceFailoverGroups([group({ strategy: 'smart' })])

    await drain(client.stream(request()))
    expect(direct.seen.slice(0, 2)).toEqual(['acct-a/model-x', 'acct-b/model-x'])

    // The next request in the same thread starts at the account that
    // produced content and never touches acct-a again.
    direct.seen = []
    await drain(client.stream(request()))
    expect(direct.seen).toEqual(['acct-b/model-x'])
  })

  it('rotates only across members under `rotate`, never into fallbacks', async () => {
    const direct = new FakeDirect(() => ok())
    const client = new RoutePoolModelClient(direct, [], capability)
    client.replaceFailoverGroups([group({ strategy: 'rotate' })])

    await drain(client.stream(request()))
    await drain(client.stream(request()))
    await drain(client.stream(request()))
    await drain(client.stream(request()))
    expect(direct.seen).toEqual([
      'acct-a/model-x', 'acct-b/model-x', 'acct-a/model-x', 'acct-b/model-x'
    ])
  })

  it('spreads load under `least-used` using served-token counts', async () => {
    const usage = (total: number): ModelStreamChunk[] => [
      { kind: 'assistant_text_delta', text: 'ok' },
      {
        kind: 'usage',
        usage: {
          promptTokens: total - 1,
          completionTokens: 1,
          totalTokens: total,
          cacheHitRate: null,
          turns: 1
        }
      },
      { kind: 'completed', stopReason: 'stop' }
    ]
    const direct = new FakeDirect((input) => usage(input.providerId === 'acct-a' ? 5_000 : 10))
    const client = new RoutePoolModelClient(direct, [], capability)
    client.replaceFailoverGroups([group({ strategy: 'least-used' })])

    // First request: equal usage, stable member order picks acct-a.
    await drain(client.stream(request()))
    expect(direct.seen).toEqual(['acct-a/model-x'])
    // acct-a now owns 5000 tokens; the next request starts at acct-b.
    await drain(client.stream(request()))
    expect(direct.seen[1]).toBe('acct-b/model-x')
  })

  it('orders smart members by quota usage below the exhaustion tier', async () => {
    const direct = new FakeDirect(() => ok())
    const client = new RoutePoolModelClient(direct, [], capability)
    client.replaceFailoverGroups([group({
      strategy: 'smart',
      members: [
        { providerId: 'acct-a', enabled: true, models: ['model-x'] },
        { providerId: 'acct-b', enabled: true, models: ['model-x'] },
        // The request enters through a disabled member so no member claims
        // the explicitly-requested tier and quota ordering decides.
        { providerId: 'acct-c', enabled: false, models: ['model-x'] }
      ]
    })])
    client.setQuotaLookup((providerId) =>
      providerId === 'acct-a' ? quotaEntry(providerId, 95) :
      providerId === 'acct-b' ? quotaEntry(providerId, 40) :
      undefined)

    await drain(client.stream(request({ providerId: 'acct-c' })))
    // acct-b (40% used) outranks acct-a (95% used) despite config order.
    expect(direct.seen[0]).toBe('acct-b/model-x')
  })

  it('skips a definitively exhausted member while a fallback remains', async () => {
    const direct = new FakeDirect((input) =>
      input.providerId === 'acct-b' ? ok() : fail())
    const client = new RoutePoolModelClient(direct, [], capability)
    client.replaceFailoverGroups([group({ strategy: 'order' })])
    client.setQuotaLookup((providerId) =>
      providerId === 'acct-a' ? quotaEntry(providerId, 100) : undefined)

    await drain(client.stream(request()))
    expect(direct.seen[0]).toBe('acct-b/model-x')
    expect(direct.seen).not.toContain('acct-a/model-x')
  })

  it('keeps the explicitly requested member as a candidate without a declared model', async () => {
    const direct = new FakeDirect(() => ok())
    const client = new RoutePoolModelClient(direct, [], capability)
    client.replaceFailoverGroups([group({
      members: [
        { providerId: 'acct-a', enabled: true, models: ['model-x'] },
        { providerId: 'acct-b', enabled: true, models: ['other-model'] }
      ]
    })])

    await drain(client.stream(request({ providerId: 'acct-b', model: 'model-x' })))
    expect(direct.seen).toContain('acct-b/model-x')
  })

  it('never lets a non-requested member serve a model it did not declare', async () => {
    const direct = new FakeDirect(() => ok())
    const client = new RoutePoolModelClient(direct, [], capability)
    client.replaceFailoverGroups([group({
      members: [
        { providerId: 'acct-a', enabled: true, models: ['other-model'] },
        { providerId: 'acct-b', enabled: true, models: ['model-x'] }
      ]
    })])

    await drain(client.stream(request({ providerId: 'acct-a', model: 'model-x' })))
    // acct-a only runs because it was explicitly requested.
    expect(direct.seen[0]).toBe('acct-a/model-x')
    expect(direct.seen).not.toContain('acct-a/other-model')
  })

  it('opens the account circuit on credit failures and skips every member model', async () => {
    const direct = new FakeDirect((input) =>
      input.providerId === 'acct-a' ? credit() : ok())
    const client = new RoutePoolModelClient(direct, [], capability)
    client.replaceFailoverGroups([group({
      members: [
        { providerId: 'acct-a', enabled: true, models: ['model-x', 'model-y'] },
        { providerId: 'acct-b', enabled: true, models: ['model-x', 'model-y'] }
      ]
    })])

    await drain(client.stream(request()))
    expect(direct.seen.slice(0, 2)).toEqual(['acct-a/model-x', 'acct-b/model-x'])

    // The deterministic credit failure closed member:acct-a — a different
    // model on the same account must also skip it.
    direct.seen = []
    await drain(client.stream(request({ model: 'model-y' })))
    expect(direct.seen[0]).toBe('acct-b/model-y')
    expect(direct.seen).not.toContain('acct-a/model-y')
  })

  it('opens only the model circuit on transient failures, keeping other models served', async () => {
    const direct = new FakeDirect((input) =>
      input.providerId === 'acct-a' ? rate() : ok())
    const health = new RoutePoolHealthStore()
    const client = new RoutePoolModelClient(direct, [], capability, health)
    client.replaceFailoverGroups([group({
      members: [
        { providerId: 'acct-a', enabled: true, models: ['model-x', 'model-y'] },
        { providerId: 'acct-b', enabled: true, models: ['model-x', 'model-y'] }
      ]
    })])

    // Seed an open model-scoped circuit for acct-a/model-x.
    health.state('provider-failover:acct-a', 'member:acct-a:model-x')
      .circuitOpenUntil = Date.now() + 60_000

    direct.seen = []
    await drain(client.stream(request()))
    expect(direct.seen[0]).toBe('acct-b/model-x')
    expect(direct.seen).not.toContain('acct-a/model-x')

    // model-y on the same account is unaffected by the model-x circuit.
    direct.seen = []
    await drain(client.stream(request({ model: 'model-y' })))
    expect(direct.seen[0]).toBe('acct-a/model-y')
  })

  it('keeps fallbacks behind members even when the group strategy reorders', async () => {
    const direct = new FakeDirect(() => ok())
    const client = new RoutePoolModelClient(direct, [], capability)
    client.replaceFailoverGroups([group({ strategy: 'least-used' })])

    for (let index = 0; index < 4; index += 1) {
      await drain(client.stream(request()))
    }
    expect(direct.seen.every((entry) => !entry.startsWith('backup-'))).toBe(true)
  })
})
