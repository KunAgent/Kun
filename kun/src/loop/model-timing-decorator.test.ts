import { describe, expect, it } from 'vitest'
import type { ModelClient, ModelStreamChunk } from '../ports/model-client.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../contracts/model-route-pool.js'
import { isPoolAliasActingRoute } from './model-step-preparation-helpers.js'
import { withModelTiming } from './model-timing-decorator.js'

class FakeRoutedClient implements ModelClient {
  readonly provider = 'route-pool'
  constructor(
    private readonly chunks: ModelStreamChunk[],
    private readonly clock: { value: number }
  ) {}
  get model(): string { return 'alias-model' }
  selectsRouteTargetDuringStream(): boolean { return true }
  routePools(): Array<{ id: string }> { return [{ id: 'pool-1' }] }
  async *stream(): AsyncIterable<ModelStreamChunk> {
    for (const chunk of this.chunks) {
      this.clock.value += 250
      yield chunk
    }
  }
}

function makeClient(chunks: ModelStreamChunk[], clock: { value: number }): ModelClient {
  return {
    provider: 'test',
    model: 'test-model',
    async *stream() {
      for (const chunk of chunks) {
        // Simulate network/provider latency so the decorator observes
        // non-zero TTFT and generation durations.
        clock.value += 250
        yield chunk
      }
    }
  }
}

const usageChunk = (completionTokens = 10): ModelStreamChunk => ({
  kind: 'usage',
  usage: { ...emptyUsageSnapshot(), completionTokens, totalTokens: completionTokens }
})

async function drain(stream: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const out: ModelStreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

describe('withModelTiming', () => {
  it('attaches TTFT and generation duration to the usage chunk of a text stream', async () => {
    const clock = { value: 0 }
    const client = withModelTiming(makeClient([
      { kind: 'assistant_text_delta', text: 'a' },
      { kind: 'assistant_text_delta', text: 'b' },
      usageChunk(),
      { kind: 'completed', stopReason: 'stop' }
    ], clock), { now: () => clock.value })

    const chunks = await drain(client.stream({
      threadId: 't', turnId: 'turn', model: 'm', prefix: [], history: [],
      tools: [], abortSignal: new AbortController().signal
    }))
    const usage = chunks.find((chunk) => chunk.kind === 'usage')
    expect(usage).toBeDefined()
    if (usage && usage.kind === 'usage') {
      // First text chunk arrived at 250ms; usage at 750ms.
      expect(usage.usage.requestTtftMs).toBe(250)
      expect(usage.usage.requestGenerationMs).toBe(500)
    }
  })

  it('falls back to the first tool chunk for pure tool-call rounds', async () => {
    const clock = { value: 0 }
    const client = withModelTiming(makeClient([
      { kind: 'tool_call_complete', callId: 'call_1', toolName: 'read', arguments: {} },
      usageChunk(5),
      { kind: 'completed', stopReason: 'tool_calls' }
    ], clock), { now: () => clock.value })

    const chunks = await drain(client.stream({
      threadId: 't', turnId: 'turn', model: 'm', prefix: [], history: [],
      tools: [], abortSignal: new AbortController().signal
    }))
    const usage = chunks.find((chunk) => chunk.kind === 'usage')
    if (usage && usage.kind === 'usage') {
      expect(usage.usage.requestTtftMs).toBe(250)
      expect(usage.usage.requestGenerationMs).toBe(250)
    }
  })

  it('passes streams without a usage chunk through unchanged', async () => {
    const clock = { value: 0 }
    const client = withModelTiming(makeClient([
      { kind: 'assistant_text_delta', text: 'hello' },
      { kind: 'completed', stopReason: 'stop' }
    ], clock), { now: () => clock.value })

    const chunks = await drain(client.stream({
      threadId: 't', turnId: 'turn', model: 'm', prefix: [], history: [],
      tools: [], abortSignal: new AbortController().signal
    }))
    expect(chunks).toEqual([
      { kind: 'assistant_text_delta', text: 'hello' },
      { kind: 'completed', stopReason: 'stop' }
    ])
  })

  it('does not time a stream that errors before any content chunk', async () => {
    const clock = { value: 0 }
    const client = withModelTiming(makeClient([
      { kind: 'error', message: 'boom' }
    ], clock), { now: () => clock.value })

    const chunks = await drain(client.stream({
      threadId: 't', turnId: 'turn', model: 'm', prefix: [], history: [],
      tools: [], abortSignal: new AbortController().signal
    }))
    expect(chunks).toEqual([{ kind: 'error', message: 'boom' }])
  })

  it('preserves chunk metadata such as route identity', async () => {
    const clock = { value: 0 }
    const route = { routePoolId: 'p', targetId: 'x', providerId: 'prov', modelId: 'm', requestedModelId: 'alias' }
    const client = withModelTiming(makeClient([
      { kind: 'assistant_text_delta', text: 'a' },
      { ...usageChunk(), route }
    ], clock), { now: () => clock.value })

    const chunks = await drain(client.stream({
      threadId: 't', turnId: 'turn', model: 'm', prefix: [], history: [],
      tools: [], abortSignal: new AbortController().signal
    }))
    const usage = chunks.find((chunk) => chunk.kind === 'usage')
    expect(usage?.route).toEqual({ routePoolId: 'p', targetId: 'x', providerId: 'prov', modelId: 'm', requestedModelId: 'alias' })
  })

  it('preserves prototype methods, accessors, and the timing wrapper on class-based clients', async () => {
    const clock = { value: 0 }
    const client = withModelTiming(new FakeRoutedClient([
      { kind: 'assistant_text_delta', text: 'a' },
      usageChunk(),
      { kind: 'completed', stopReason: 'stop' }
    ], clock), { now: () => clock.value })

    // Regression for route pools frozen under their public alias: object
    // spread dropped every prototype member, so these probes vanished.
    expect(client.selectsRouteTargetDuringStream?.({ model: 'alias-model', providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID })).toBe(true)
    expect(client.model).toBe('alias-model')
    expect(client.provider).toBe('route-pool')
    expect((client as unknown as FakeRoutedClient).routePools()).toEqual([{ id: 'pool-1' }])

    const chunks = await drain(client.stream({
      threadId: 't', turnId: 'turn', model: 'alias-model', prefix: [], history: [],
      tools: [], abortSignal: new AbortController().signal
    }))
    const usage = chunks.find((chunk) => chunk.kind === 'usage')
    if (usage && usage.kind === 'usage') {
      expect(usage.usage.requestTtftMs).toBe(250)
      expect(usage.usage.requestGenerationMs).toBe(250)
    }
  })
})

describe('isPoolAliasActingRoute', () => {
  const target = {
    routePoolId: 'pool-1',
    targetId: 'target-2',
    providerId: 'kimi',
    modelId: 'kimi-k3',
    requestedModelId: 'kk'
  }

  it('accepts a local-gateway alias resolving to a pool target', () => {
    expect(isPoolAliasActingRoute(
      { model: 'kk', providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID },
      target
    )).toBe(true)
  })

  it('accepts a route-pool provider alias resolving to its own pool target', () => {
    expect(isPoolAliasActingRoute(
      { model: 'kk', providerId: 'Route-Pool:pool-1' },
      target
    )).toBe(true)
  })

  it('rejects a concrete frozen route, another pool, or a different alias', () => {
    expect(isPoolAliasActingRoute({ model: 'kimi-k3', providerId: 'kimi' }, target)).toBe(false)
    expect(isPoolAliasActingRoute({ model: 'kk', providerId: 'route-pool:other' }, target)).toBe(false)
    expect(isPoolAliasActingRoute({ model: 'other-alias', providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID }, target)).toBe(false)
  })
})
