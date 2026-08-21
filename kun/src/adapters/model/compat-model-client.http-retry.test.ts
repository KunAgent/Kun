import { describe, expect, it } from 'vitest'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { CompatModelClient } from './compat-model-client.js'

function request(): ModelRequest {
  return {
    threadId: 't1',
    turnId: 'u1',
    model: 'glm-5.3',
    systemPrompt: 'You are a helpful assistant.',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: new AbortController().signal
  }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function okJson(): Response {
  return Response.json({
    choices: [{ index: 0, finish_reason: 'stop', message: { content: 'ok' } }]
  })
}

function zhipuNetworkError(): Response {
  return Response.json({
    error: {
      code: '1234',
      message: '网络错误，错误id：202608202039104d5ba28007854303，请稍后重试'
    }
  }, { status: 500 })
}

function client(fetchImpl: typeof fetch): CompatModelClient {
  return new CompatModelClient({
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
    apiKey: 'sk-test',
    model: 'glm-5.3',
    endpointFormat: 'custom_endpoint',
    nonStreaming: true,
    retry: { initialDelayMs: 0 },
    fetchImpl
  })
}

describe('CompatModelClient default HTTP retry policy', () => {
  it('retries the observed Zhipu HTTP 500 network error and recovers', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return calls === 1 ? zhipuNetworkError() : okJson()
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    expect(calls).toBe(2)
    expect(chunks).toContainEqual(expect.objectContaining({
      kind: 'retrying',
      status: 500,
      attempt: 1,
      maxAttempts: 5,
      delayMs: 0,
      failureSummary: expect.stringContaining('网络错误')
    }))
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
    expect(chunks.some((chunk) => chunk.kind === 'error')).toBe(false)
  })

  it('exhausts all five default retries for a persistent HTTP 500', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return zhipuNetworkError()
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    expect(calls).toBe(6)
    expect(chunks.filter((chunk) => chunk.kind === 'retrying')).toHaveLength(5)
    expect(chunks.at(-1)).toMatchObject({
      kind: 'error',
      code: 'http_500',
      failure: {
        category: 'unavailable',
        httpStatus: 500,
        providerCode: '1234',
        failoverAllowed: true
      }
    })
  })

  it('does not retry an unconfigured deterministic HTTP 501', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response('not implemented', { status: 501 })
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    expect(calls).toBe(1)
    expect(chunks.some((chunk) => chunk.kind === 'retrying')).toBe(false)
    expect(chunks.at(-1)).toMatchObject({ kind: 'error', code: 'http_501' })
  })
})
