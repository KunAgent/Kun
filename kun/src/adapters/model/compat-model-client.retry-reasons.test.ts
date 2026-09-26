import { describe, expect, it } from 'vitest'
import { CompatModelClient } from './compat-model-client.js'
import type { ModelRequestRetryConfig } from '../../config/kun-config.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

function request(signal?: AbortSignal): ModelRequest {
  return {
    threadId: 't1',
    turnId: 'u1',
    model: 'glm-5.1',
    systemPrompt: 'You are a helpful assistant.',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: signal ?? new AbortController().signal
  }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function okJson(): Response {
  return Response.json(
    { choices: [{ index: 0, finish_reason: 'stop', message: { content: 'ok' } }] },
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

function client(fetchImpl: typeof fetch, retry?: ModelRequestRetryConfig): CompatModelClient {
  return new CompatModelClient({
    baseUrl: 'https://provider.example/v1',
    apiKey: 'sk-test',
    model: 'glm-5.1',
    endpointFormat: 'chat_completions',
    nonStreaming: true,
    retry,
    fetchImpl
  })
}

describe('CompatModelClient failure-reason retry routing', () => {
  it('does not retry a 402 insufficient-balance failure', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return Response.json({ error: { message: 'Insufficient Balance' } }, { status: 402 })
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 5, initialDelayMs: 0, httpStatusCodes: [402, 429] }).stream(request())
    )

    expect(calls).toBe(1)
    expect(chunks.some((c) => c.kind === 'retrying')).toBe(false)
    const error = chunks.find((c) => c.kind === 'error')
    expect(error?.failure?.reason).toBe('credit')
    expect(error?.failure?.failoverAllowed).toBe(true)
  })

  it('does not retry a 429 insufficient_quota failure', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return Response.json(
        { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } },
        { status: 429 }
      )
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 5, initialDelayMs: 0, httpStatusCodes: [429] }).stream(request())
    )

    expect(calls).toBe(1)
    const error = chunks.find((c) => c.kind === 'error')
    expect(error?.failure?.reason).toBe('credit')
  })

  it('fails over immediately on rate limits when alternatives are declared', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return Response.json({ error: { message: 'rate limited' } }, { status: 429 })
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 5, initialDelayMs: 0, httpStatusCodes: [429] })
        .stream({ ...request(), failover: { alternatives: 1 } })
    )

    expect(calls).toBe(1)
    expect(chunks.some((c) => c.kind === 'retrying')).toBe(false)
  })

  it('waits once for a short Retry-After on rate limits', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return calls === 1
        ? Response.json({ error: { message: 'slow down' } }, {
            status: 429,
            headers: { 'retry-after': '2' }
          })
        : okJson()
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 5, initialDelayMs: 0, httpStatusCodes: [429] }).stream(request())
    )

    expect(calls).toBe(2)
    expect(chunks).toContainEqual(expect.objectContaining({
      kind: 'retrying',
      status: 429,
      delayMs: 2_000
    }))
  })

  it('caps same-target overload retries to one fast attempt when alternatives exist', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return calls < 3
        ? Response.json({ error: { message: 'overloaded' } }, { status: 529 })
        : okJson()
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 5, initialDelayMs: 60_000, httpStatusCodes: [500, 529] })
        .stream({ ...request(), failover: { alternatives: 1 } })
    )

    // One capped retry (delay <= 3s cap) then the response succeeded.
    expect(calls).toBe(2)
    expect(chunks).toContainEqual(expect.objectContaining({
      kind: 'retrying',
      status: 529,
      delayMs: 3_000
    }))
  })
})

