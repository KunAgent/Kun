import { describe, expect, it } from 'vitest'
import { CompatModelClient } from './compat-model-client.js'
import { MultiProviderModelClient } from './multi-provider-model-client.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

// Workflow / scheduled-task / IM-bridge can pick a non-runtime provider per
// request. The same Kun process must route those requests to a per-provider
// HTTP client, leaving requests without a providerId on the default client.

type CapturedCall = { url: string; authorization: string }

function fakeFetch(calls: CapturedCall[]): typeof fetch {
  return (async (url: string, init: { headers?: Record<string, string> }) => {
    calls.push({
      url: String(url),
      authorization: init.headers?.Authorization ?? ''
    })
    return new Response(
      JSON.stringify({
        choices: [{ index: 0, finish_reason: 'stop', message: { content: 'ok' } }]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as unknown as typeof fetch
}

function request(model: string, providerId?: string): ModelRequest {
  return {
    threadId: 't1',
    turnId: 'u1',
    model,
    ...(providerId ? { providerId } : {}),
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

describe('MultiProviderModelClient', () => {
  it('routes provider ids case-insensitively and fails closed for unknown ids', async () => {
    const defaultCalls: CapturedCall[] = []
    const minimaxCalls: CapturedCall[] = []
    const defaultClient = new CompatModelClient({
      baseUrl: 'https://default.example/v1',
      apiKey: 'sk-default',
      model: 'deepseek-v4-pro',
      fetchImpl: fakeFetch(defaultCalls)
    })
    const minimaxClient = new CompatModelClient({
      baseUrl: 'https://minimax.example/anthropic',
      apiKey: 'sk-minimax',
      model: 'MiniMax-M3',
      fetchImpl: fakeFetch(minimaxCalls)
    })
    const router = new MultiProviderModelClient({
      default: defaultClient,
      providers: new Map([['minimax-token-plan', minimaxClient]])
    })

    await drain(router.stream(request('deepseek-v4-pro')))
    await drain(router.stream(request('MiniMax-M3', ' MINIMAX-TOKEN-PLAN ')))
    expect(() => router.stream(request('deepseek-v4-pro', 'unknown-provider')))
      .toThrow('unknown_provider_id: unknown-provider')

    expect(defaultCalls).toHaveLength(1)
    expect(defaultCalls[0].url).toContain('default.example')
    expect(defaultCalls[0].authorization).toBe('Bearer sk-default')
    expect(minimaxCalls).toHaveLength(1)
    expect(minimaxCalls[0].url).toContain('minimax.example')
    expect(minimaxCalls[0].authorization).toBe('Bearer sk-minimax')
  })

  it('exposes the default client\'s config so loop-side diagnostics keep working for single-provider deployments', () => {
    const defaultClient = new CompatModelClient({
      baseUrl: 'https://default.example/v1',
      apiKey: 'sk-default',
      model: 'deepseek-v4-pro'
    })
    const router = new MultiProviderModelClient({ default: defaultClient })
    expect(router.model).toBe('deepseek-v4-pro')
    expect((router.config as { baseUrl?: string }).baseUrl).toBe('https://default.example/v1')
  })
})
