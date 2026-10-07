import { describe, expect, it } from 'vitest'
import type { ModelStreamChunk } from '../../ports/model-client.js'
import { GatewayRequestGuard } from './gateway-request-guard.js'
import type { GatewayUsageStream } from './gateway-usage.js'
import { admitGatewayStream, failureRetryHeaders, gatewayRetryHeaders } from './gateway-retry.js'

function stream(chunks: ModelStreamChunk[], delayMs = 0): GatewayUsageStream & { returned: boolean; finished: string[] } {
  const state = { returned: false, finished: [] as string[] }
  return Object.assign(state, {
    finish: async (outcome: string) => { state.finished.push(outcome) },
    async *[Symbol.asyncIterator]() {
      try {
        for (const chunk of chunks) {
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
          yield chunk
        }
      } finally { state.returned = true }
    }
  }) as GatewayUsageStream & { returned: boolean; finished: string[] }
}

async function drain(chunks: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const seen: ModelStreamChunk[] = []
  for await (const chunk of chunks) seen.push(chunk)
  return seen
}

describe('gateway retry timing', () => {
  it('rounds seconds up and states the reset instant', () => {
    expect(gatewayRetryHeaders(1_200, 0)).toEqual({ 'retry-after': '2', 'retry-after-ms': '1200', 'x-kun-limit-reset': '1970-01-01T00:00:01.200Z' })
    expect(gatewayRetryHeaders(0, 0)['retry-after']).toBe('1')
    expect(failureRetryHeaders({ category: 'request', failoverAllowed: false, resetAt: '1970-01-01T00:01:00.000Z' }, 0)['retry-after']).toBe('60')
    expect(failureRetryHeaders({ category: 'rate_limit', failoverAllowed: true, retryAfterMs: 5_000 }, 0)['retry-after-ms']).toBe('5000')
    expect(failureRetryHeaders({ category: 'request', failoverAllowed: false }, 0)).toEqual({})
  })
  it('reports when the token bucket refills', () => {
    let now = 0
    const guard = new GatewayRequestGuard({ verify: () => true }, { capacity: 1, refillPerSecond: 0.5, now: () => now })
    expect(guard.consumeToken()).toBe(true)
    expect(guard.consumeToken()).toBe(false)
    expect(guard.retryAfterMs()).toBe(2_000)
    now = 1_500
    expect(guard.consumeToken()).toBe(false)
    expect(guard.retryAfterMs()).toBe(500)
  })
})

describe('streaming admission', () => {
  it('returns a local refusal before any stream starts', async () => {
    const refusal: ModelStreamChunk = { kind: 'error', code: 'token_budget_exceeded', message: 'spent',
      failure: { category: 'request', localAdmission: true, httpStatus: 429, failoverAllowed: false } }
    const source = stream([refusal, { kind: 'completed', stopReason: 'error' }])
    const admitted = await admitGatewayStream(source, new AbortController().signal)
    expect(admitted).toEqual({ refused: refusal })
    expect(source.returned).toBe(true)
  })
  it('replays the first chunk and keeps the rest of a normal stream', async () => {
    const source = stream([{ kind: 'assistant_text_delta', text: 'a' }, { kind: 'assistant_text_delta', text: 'b' }, { kind: 'completed', stopReason: 'stop' }])
    const admitted = await admitGatewayStream(source, new AbortController().signal)
    if (!('chunks' in admitted)) throw new Error('expected a stream')
    expect(await drain(admitted.chunks)).toHaveLength(3)
    await admitted.chunks.finish('completed')
    expect(source.finished).toEqual(['completed'])
  })
  it('does not hold a slow upstream back, and an upstream error stays in the stream', async () => {
    const upstreamError: ModelStreamChunk = { kind: 'error', message: 'upstream 500', failure: { category: 'server', failoverAllowed: false } }
    const slow = stream([{ kind: 'assistant_text_delta', text: 'late' }, upstreamError], 40)
    const started = Date.now()
    const admitted = await admitGatewayStream(slow, new AbortController().signal, 10)
    expect(Date.now() - started).toBeLessThan(35)
    if (!('chunks' in admitted)) throw new Error('expected a stream')
    expect(await drain(admitted.chunks)).toEqual([{ kind: 'assistant_text_delta', text: 'late' }, upstreamError])
  })
  it('closes the source when the consumer stops early', async () => {
    const source = stream([{ kind: 'assistant_text_delta', text: 'a' }, { kind: 'assistant_text_delta', text: 'b' }])
    const admitted = await admitGatewayStream(source, new AbortController().signal)
    if (!('chunks' in admitted)) throw new Error('expected a stream')
    const iterator = admitted.chunks[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return?.()
    expect(source.returned).toBe(true)
  })
})
