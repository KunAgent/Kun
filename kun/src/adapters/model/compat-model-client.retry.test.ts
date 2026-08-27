import { describe, expect, it, vi } from 'vitest'
import { CompatModelClient } from './compat-model-client.js'
import type { ModelRequestRetryConfig } from '../../config/kun-config.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

// Retry behavior is enabled by default and provider-configurable. Keep custom
// status lists and zero delays explicit where tests need deterministic timing.

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
  return new Response(
    JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { content: 'ok' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

// Mirrors the real ALB 502 the user hit: HTML body, not JSON.
function gatewayError(status: number): Response {
  return new Response(
    `<html><head><title>${status}</title></head><body><center>${status}</center><center>alb</center></body></html>`,
    { status, headers: { 'content-type': 'text/html' } }
  )
}

function interruptedSse(frame: string): Response {
  const encoder = new TextEncoder()
  let read = false
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!read) {
        read = true
        controller.enqueue(encoder.encode(frame))
        return
      }
      controller.error(new Error('terminated'))
    }
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
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

describe('CompatModelClient transient gateway retry', () => {
  it('does not request or emit an error when the turn was already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn() as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request(controller.signal)))

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(chunks).toEqual([])
  })

  it('retries a 502 Bad Gateway and then succeeds', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return calls === 1 ? gatewayError(502) : okJson()
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 1, initialDelayMs: 0, httpStatusCodes: [502] }).stream(request())
    )

    expect(calls).toBe(2)
    expect(chunks).toContainEqual(expect.objectContaining({
      kind: 'retrying',
      status: 502,
      attempt: 1,
      maxAttempts: 1,
      delayMs: 0,
      failureSummary: 'provider returned an HTML response (502)'
    }))
    expect(chunks.some((c) => c.kind === 'assistant_text_delta')).toBe(true)
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
    expect(chunks.some((c) => c.kind === 'error')).toBe(false)
  })

  it('does not retry when the provider explicitly disables retries', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return gatewayError(502)
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 0, initialDelayMs: 0, httpStatusCodes: [502] })
        .stream(request())
    )

    expect(calls).toBe(1)
    expect(chunks.some((c) => c.kind === 'error')).toBe(true)
  })

  it('summarizes HTML challenge pages in user-visible HTTP errors', async () => {
    const html = `
      <html>
        <head><title>Challenge</title></head>
        <body>
          <h2><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></h2>
          ${'<svg><path d="M37.5324 16.8707" /></svg>'.repeat(100)}
        </body>
      </html>
    `
    const fetchImpl = (async () =>
      new Response(html, { status: 403, headers: { 'content-type': 'text/html' } })
    ) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))
    const error = chunks.find((c) => c.kind === 'error')

    expect(error).toMatchObject({
      kind: 'error',
      code: 'http_403'
    })
    expect(error && error.kind === 'error' ? error.message : '').toContain('HTML challenge page')
    expect(error && error.kind === 'error' ? error.message : '').not.toContain('<svg>')
    expect(error && error.kind === 'error' ? error.message.length : 0).toBeLessThan(240)
  })

  it('redacts credentials from retry details persisted for the conversation', async () => {
    const credential = 'sk-abcdefghijklmnop'
    const fetchImpl = (async () => new Response(
      JSON.stringify({ error: `provider rejected api_key=${credential}` }),
      { status: 503, headers: { 'content-type': 'application/json' } }
    )) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 1, initialDelayMs: 0, httpStatusCodes: [503] })
        .stream(request())
    )
    const retry = chunks.find((chunk) => chunk.kind === 'retrying')
    const detail = retry?.kind === 'retrying' ? retry.failureSummary : undefined

    expect(detail).toContain('<redacted>')
    expect(detail).not.toContain(credential)
  })

  it('stops retrying silently when the request is aborted during backoff', async () => {
    const controller = new AbortController()
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      // Abort while the (failed) response is in hand, so the backoff sees it.
      controller.abort()
      return gatewayError(503)
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 1, initialDelayMs: 1_000, httpStatusCodes: [503] }).stream(
        request(controller.signal)
      )
    )

    expect(calls).toBe(1)
    expect(chunks.some((c) => c.kind === 'error')).toBe(false)
  })
})

describe('CompatModelClient network retry', () => {
  it('uses the default five-retry budget and recovers from fetch failures', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      if (calls <= 5) throw new TypeError('fetch failed')
      return okJson()
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { initialDelayMs: 0 }).stream(request())
    )
    const retries = chunks.filter((chunk) => chunk.kind === 'retrying')

    expect(calls).toBe(6)
    expect(retries).toHaveLength(5)
    expect(retries[0]).toEqual(expect.objectContaining({
      kind: 'retrying',
      attempt: 1,
      maxAttempts: 5,
      delayMs: 0,
      reason: 'network',
      failureSummary: expect.stringContaining('model provider did not return a response')
    }))
    expect(retries.at(-1)).toEqual(expect.objectContaining({
      kind: 'retrying',
      attempt: 5,
      maxAttempts: 5,
      delayMs: 0,
      reason: 'network',
      failureSummary: expect.stringContaining('model provider did not return a response')
    }))
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
    expect(chunks.some((chunk) => chunk.kind === 'error')).toBe(false)
  })

  it('surfaces the fetch failure after the default five retries are exhausted', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { initialDelayMs: 0 }).stream(request())
    )

    expect(calls).toBe(6)
    expect(chunks.filter((chunk) => chunk.kind === 'retrying')).toHaveLength(5)
    expect(chunks.at(-1)).toMatchObject({
      kind: 'error',
      code: 'model_provider_unreachable',
      message: expect.stringContaining('model provider did not return a response'),
      failure: { category: 'network', failoverAllowed: true }
    })
  })

  it('stops a network retry silently while waiting in backoff when the request is cancelled', async () => {
    const controller = new AbortController()
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      setTimeout(() => controller.abort(), 0)
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 5, initialDelayMs: 10_000 })
        .stream(request(controller.signal))
    )

    expect(calls).toBe(1)
    expect(chunks).toContainEqual(expect.objectContaining({
      kind: 'retrying',
      attempt: 1,
      maxAttempts: 5,
      delayMs: expect.any(Number),
      reason: 'network',
      failureSummary: expect.stringContaining('model provider did not return a response')
    }))
    expect(chunks.at(-1)).toMatchObject({
      kind: 'retrying'
    })
    expect(chunks.some((chunk) => chunk.kind === 'error')).toBe(false)
  })

  it('preserves the concrete network cause when the provider never responds', async () => {
    const fetchImpl = (async () => {
      const cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.luna.example'), {
        code: 'ENOTFOUND'
      })
      throw Object.assign(new TypeError('fetch failed'), { cause })
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 1, initialDelayMs: 0 }).stream(request())
    )
    const retry = chunks.find((chunk) => chunk.kind === 'retrying')
    const detail = retry?.kind === 'retrying' ? retry.failureSummary : ''

    expect(detail).toContain('model provider did not return a response')
    expect(detail).toContain('getaddrinfo ENOTFOUND api.luna.example')
  })
})

describe('CompatModelClient interrupted stream retry', () => {
  it('retries an HTTP 200 stream terminated after reasoning without duplicating reasoning', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      if (calls === 1) {
        return interruptedSse(
          'data: {"type":"response.reasoning_summary_text.delta","delta":"plan"}\n\n'
        )
      }
      return new Response(
        [
          'data: {"type":"response.reasoning_summary_text.delta","delta":"plan"}\n\n',
          'data: {"type":"response.output_text.delta","delta":"done"}\n\n',
          'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n'
        ].join(''),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    }) as unknown as typeof fetch
    const streamClient = new CompatModelClient({
      baseUrl: 'https://provider.example/v1/responses',
      apiKey: 'sk-test',
      model: 'gpt-5.6-sol',
      endpointFormat: 'responses',
      retry: { maxAttempts: 1, initialDelayMs: 0, httpStatusCodes: [429, 503] },
      fetchImpl
    })

    const chunks = await drain(streamClient.stream({ ...request(), model: 'gpt-5.6-sol' }))

    expect(calls).toBe(2)
    expect(chunks.filter((chunk) => chunk.kind === 'assistant_reasoning_delta')).toEqual([
      { kind: 'assistant_reasoning_delta', text: 'plan' }
    ])
    expect(chunks).toContainEqual(expect.objectContaining({
      kind: 'retrying',
      status: 200,
      attempt: 1,
      maxAttempts: 1,
      delayMs: 0,
      reason: 'stream_transport',
      failureSummary: expect.any(String)
    }))
    expect(chunks).toContainEqual({ kind: 'assistant_text_delta', text: 'done' })
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
    expect(chunks.some((chunk) => chunk.kind === 'error')).toBe(false)
  })

  it('retries a terminated stream after final text and emits only the unseen suffix', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      if (calls === 1) {
        return interruptedSse(
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\n'
        )
      }
      return new Response(
        [
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
          'data: {"type":"response.output_text.delta","delta":" done"}\n\n',
          'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n'
        ].join(''),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    }) as unknown as typeof fetch
    const streamClient = new CompatModelClient({
      baseUrl: 'https://provider.example/v1/responses',
      apiKey: 'sk-test',
      model: 'gpt-5.6-sol',
      endpointFormat: 'responses',
      retry: { maxAttempts: 3, initialDelayMs: 0, httpStatusCodes: [429, 503] },
      fetchImpl
    })

    const chunks = await drain(streamClient.stream({ ...request(), model: 'gpt-5.6-sol' }))

    expect(calls).toBe(2)
    expect(chunks.filter((chunk) => chunk.kind === 'assistant_text_delta')).toEqual([
      { kind: 'assistant_text_delta', text: 'partial' },
      { kind: 'assistant_text_delta', text: ' done' }
    ])
    expect(chunks).toContainEqual(expect.objectContaining({
      kind: 'retrying',
      attempt: 1,
      maxAttempts: 3,
      reason: 'stream_transport'
    }))
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
    expect(chunks.some((chunk) => chunk.kind === 'error')).toBe(false)
  })

  it('uses another configured retry when a replay diverges from visible text', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      if (calls === 1) {
        return interruptedSse(
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\n'
        )
      }
      if (calls === 2) {
        return interruptedSse(
          'data: {"type":"response.output_text.delta","delta":"different"}\n\n'
        )
      }
      return new Response(
        [
          'data: {"type":"response.output_text.delta","delta":"partial recovery"}\n\n',
          'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n'
        ].join(''),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    }) as unknown as typeof fetch
    const streamClient = new CompatModelClient({
      baseUrl: 'https://provider.example/v1/responses',
      apiKey: 'sk-test',
      model: 'gpt-5.6-sol',
      endpointFormat: 'responses',
      retry: { maxAttempts: 2, initialDelayMs: 0, httpStatusCodes: [429, 503] },
      fetchImpl
    })

    const chunks = await drain(streamClient.stream({ ...request(), model: 'gpt-5.6-sol' }))

    expect(calls).toBe(3)
    expect(chunks.filter((chunk) => chunk.kind === 'retrying')).toHaveLength(2)
    expect(chunks.filter((chunk) => chunk.kind === 'assistant_text_delta')).toEqual([
      { kind: 'assistant_text_delta', text: 'partial' },
      { kind: 'assistant_text_delta', text: ' recovery' }
    ])
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
  })

  it('defers a tool call until a retried stream completes and emits it once', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      const toolCall =
        'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"edit","arguments":"{\\"path\\":\\"a.txt\\"}"}}\n\n'
      if (calls === 1) return interruptedSse(toolCall)
      return new Response(
        toolCall +
          'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    }) as unknown as typeof fetch
    const streamClient = new CompatModelClient({
      baseUrl: 'https://provider.example/v1/responses',
      apiKey: 'sk-test',
      model: 'gpt-5.6-sol',
      endpointFormat: 'responses',
      retry: { maxAttempts: 3, initialDelayMs: 0, httpStatusCodes: [429, 503] },
      fetchImpl
    })

    const chunks = await drain(streamClient.stream({ ...request(), model: 'gpt-5.6-sol' }))

    expect(calls).toBe(2)
    expect(chunks.filter((chunk) => chunk.kind === 'tool_call_complete')).toEqual([{
      kind: 'tool_call_complete',
      callId: 'call_1',
      toolName: 'edit',
      arguments: { path: 'a.txt' }
    }])
    expect(chunks.filter((chunk) => chunk.kind === 'retrying')).toHaveLength(1)
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'tool_calls' })
  })

  it('retries a reasoning-only terminated stream five times and then exhausts the budget', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return interruptedSse(
        'data: {"type":"response.reasoning_summary_text.delta","delta":"plan"}\n\n'
      )
    }) as unknown as typeof fetch
    const streamClient = new CompatModelClient({
      baseUrl: 'https://provider.example/v1/responses',
      apiKey: 'sk-test',
      model: 'gpt-5.6-sol',
      endpointFormat: 'responses',
      retry: { maxAttempts: 5, initialDelayMs: 0, httpStatusCodes: [429, 503] },
      fetchImpl
    })

    const chunks = await drain(streamClient.stream({ ...request(), model: 'gpt-5.6-sol' }))
    const retries = chunks.filter((chunk) => chunk.kind === 'retrying')

    expect(calls).toBe(6)
    expect(retries).toHaveLength(5)
    expect(retries.every((chunk) => chunk.kind === 'retrying' && 'reason' in chunk && chunk.reason === 'stream_transport')).toBe(true)
    expect(chunks.filter((chunk) => chunk.kind === 'assistant_reasoning_delta')).toEqual([
      { kind: 'assistant_reasoning_delta', text: 'plan' }
    ])
    const exhaustedError = chunks.at(-1)
    expect(exhaustedError).toMatchObject({
      kind: 'error',
      code: 'stream_read_error',
      failure: { category: 'network', failoverAllowed: true }
    })
    expect(exhaustedError?.kind === 'error' ? exhaustedError.message : '').toContain('all 5 configured stream retries were exhausted')
  })

  it('does not retry a reasoning-only terminated stream when maxAttempts is zero', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return interruptedSse(
        'data: {"type":"response.reasoning_summary_text.delta","delta":"plan"}\n\n'
      )
    }) as unknown as typeof fetch
    const streamClient = new CompatModelClient({
      baseUrl: 'https://provider.example/v1/responses',
      apiKey: 'sk-test',
      model: 'gpt-5.6-sol',
      endpointFormat: 'responses',
      retry: { maxAttempts: 0, initialDelayMs: 0, httpStatusCodes: [429, 503] },
      fetchImpl
    })

    const chunks = await drain(streamClient.stream({ ...request(), model: 'gpt-5.6-sol' }))

    expect(calls).toBe(1)
    expect(chunks.some((chunk) => chunk.kind === 'retrying')).toBe(false)
    expect(chunks.at(-1)).toMatchObject({
      kind: 'error',
      code: 'stream_read_error'
    })
  })
})

describe('CompatModelClient refreshed credentials', () => {
  it('keeps one Codex session across sequential calls and a 401 credential refresh', async () => {
    const sessionIds: string[] = []
    const authorization: string[] = []
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      sessionIds.push(headers.get('session_id') ?? '')
      const value = headers.get('authorization') ?? ''
      authorization.push(value)
      return value === 'Bearer old-access'
        ? Response.json({ error: 'expired' }, { status: 401 })
        : Response.json({ output_text: 'ok', status: 'completed' })
    }) as unknown as typeof fetch
    let resolution = 0
    const oauthClient = new CompatModelClient({
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      apiKey: 'old-access',
      model: 'gpt-5.6-sol',
      endpointFormat: 'responses',
      nonStreaming: true,
      fetchImpl,
      resolveCredentials: async (rejectedAccessToken?: string) => ({
        apiKey: rejectedAccessToken ? 'new-access' : 'old-access',
        headers: { session_id: `credential-session-${++resolution}` },
        refreshable: true
      })
    })

    await drain(oauthClient.stream({ ...request(), model: 'gpt-5.6-sol' }))
    await drain(oauthClient.stream({ ...request(), model: 'gpt-5.6-sol', turnId: 'u2' }))

    expect(authorization).toEqual([
      'Bearer old-access',
      'Bearer new-access',
      'Bearer old-access',
      'Bearer new-access'
    ])
    expect(sessionIds).toHaveLength(4)
    expect(sessionIds[0]).not.toBe('')
    expect(new Set(sessionIds)).toEqual(new Set([sessionIds[0]]))
    expect(sessionIds[0]).not.toMatch(/^credential-session-/)
  })

  it('refreshes a rejected OAuth bearer once and retries the request with the new token', async () => {
    const authorization: string[] = []
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const value = new Headers(init?.headers).get('authorization') ?? ''
      authorization.push(value)
      return value === 'Bearer old-access'
        ? Response.json({ error: 'expired' }, { status: 401 })
        : Response.json({ output_text: 'ok', status: 'completed' })
    }) as unknown as typeof fetch
    const resolverCalls: Array<string | undefined> = []
    const oauthClient = new CompatModelClient({
      baseUrl: 'https://cli-chat-proxy.grok.com/v1',
      apiKey: 'old-access',
      model: 'grok-4.5',
      endpointFormat: 'responses',
      nonStreaming: true,
      fetchImpl,
      resolveCredentials: async (rejectedAccessToken?: string) => {
        resolverCalls.push(rejectedAccessToken)
        return rejectedAccessToken
          ? {
              apiKey: 'new-access',
              headers: { 'X-XAI-Token-Auth': 'xai-grok-cli' },
              refreshable: true
            }
          : {
              apiKey: 'old-access',
              headers: { 'X-XAI-Token-Auth': 'xai-grok-cli' },
              refreshable: true
            }
      }
    })

    const chunks = await drain(oauthClient.stream({
      ...request(),
      model: 'grok-4.5'
    }))

    expect(authorization).toEqual(['Bearer old-access', 'Bearer new-access'])
    expect(resolverCalls).toEqual([undefined, 'old-access'])
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
    expect(chunks.some((chunk) => chunk.kind === 'error')).toBe(false)
  })

  it('does not retry a 401 for non-refreshable credentials', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return Response.json({ error: 'invalid key' }, { status: 401 })
    }) as unknown as typeof fetch
    const plainClient = new CompatModelClient({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'plain-key',
      model: 'glm-5.1',
      endpointFormat: 'chat_completions',
      nonStreaming: true,
      fetchImpl,
      resolveCredentials: async () => ({
        apiKey: 'plain-key',
        refreshable: false
      })
    })

    const chunks = await drain(plainClient.stream(request()))

    expect(calls).toBe(1)
    expect(chunks).toContainEqual(expect.objectContaining({ kind: 'error', code: 'http_401' }))
  })

  it('retries once after stripping temperature/top_p on fixed-sampling 400s', async () => {
    const bodies: Array<Record<string, unknown>> = []
    let calls = 0
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls += 1
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      if (calls === 1) {
        return Response.json({
          error: { message: 'invalid temperature: only 1 is allowed for this model' }
        }, { status: 400 })
      }
      return okJson()
    }) as unknown as typeof fetch
    const samplingClient = new CompatModelClient({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'sk-test',
      model: 'custom-fixed-model',
      endpointFormat: 'chat_completions',
      nonStreaming: true,
      fetchImpl
    })

    const chunks = await drain(samplingClient.stream({
      ...request(),
      model: 'custom-fixed-model',
      temperature: 0,
      topP: 1
    }))

    expect(calls).toBe(2)
    expect(bodies[0]).toMatchObject({ temperature: 0, top_p: 1 })
    expect(bodies[1]).not.toHaveProperty('temperature')
    expect(bodies[1]).not.toHaveProperty('top_p')
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
  })
})
