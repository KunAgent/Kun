import { describe, expect, it } from 'vitest'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { CompatModelClient } from './compat-model-client.js'
import { OPENCODE_SESSION_HEADER } from './compat-opencode-session.js'

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    threadId: 'thread-opencode',
    turnId: 'turn-opencode',
    model: 'big-pickle',
    systemPrompt: 'You are helpful.',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: new AbortController().signal,
    ...overrides
  }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<void> {
  for await (const _chunk of iterable) {
    // Drain the stream so the request is issued.
  }
}

function okJson(): Response {
  return new Response(JSON.stringify({
    choices: [{ index: 0, finish_reason: 'stop', message: { content: 'ok' } }]
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

async function capturedSessionHeader(input: {
  providerId?: string
  presetSource?: string
  baseUrl: string
  threadId?: string
}): Promise<{ session: string | null; authorization: string | null }> {
  let session: string | null = null
  let authorization: string | null = null
  const client = new CompatModelClient({
    providerId: input.providerId,
    presetSource: input.presetSource,
    baseUrl: input.baseUrl,
    apiKey: '',
    model: 'big-pickle',
    endpointFormat: 'chat_completions',
    nonStreaming: true,
    fetchImpl: (async (_url, init) => {
      const headers = new Headers(init?.headers)
      session = headers.get(OPENCODE_SESSION_HEADER)
      authorization = headers.get('authorization')
      return okJson()
    }) as typeof fetch
  })
  await drain(client.stream(request({ threadId: input.threadId ?? 'thread-opencode' })))
  return { session, authorization }
}

describe('CompatModelClient OpenCode session header', () => {
  it('sends x-opencode-session for OpenCode Free using the thread id', async () => {
    const captured = await capturedSessionHeader({
      providerId: 'opencode-free',
      presetSource: 'opencode-free',
      baseUrl: 'https://opencode.ai/zen/v1',
      threadId: 'thr_free'
    })
    expect(captured.session).toBe('thr_free')
    expect(captured.authorization).toBeNull()
  })

  it('sends x-opencode-session for OpenCode Go', async () => {
    const captured = await capturedSessionHeader({
      providerId: 'opencode-go',
      presetSource: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      threadId: 'thr_go'
    })
    expect(captured.session).toBe('thr_go')
  })

  it('does not send x-opencode-session for unrelated providers', async () => {
    const captured = await capturedSessionHeader({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com'
    })
    expect(captured.session).toBeNull()
  })
})
