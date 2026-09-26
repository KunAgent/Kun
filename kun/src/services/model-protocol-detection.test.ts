import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectProviderProtocols } from './model-protocol-detection.js'

type SiteKind = 'chat_only' | 'messages_only' | 'relay'

const CHAT_SSE = [
  'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":"stop"}]}',
  'data: [DONE]',
  ''
].join('\n\n')

const RESPONSES_SSE = [
  'data: {"type":"response.output_text.delta","delta":"hi","item_id":"i1","output_index":0,"content_index":0}',
  'data: {"type":"response.completed","response":{"id":"r1","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}',
  ''
].join('\n\n')

const MESSAGES_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg1","type":"message","role":"assistant","content":[],"model":"m","stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
  'event: message_stop\ndata: {"type":"message_stop"}',
  ''
].join('\n\n')

function fakeFetchFor(site: SiteKind): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = new Headers(init?.headers)
    const hasBearer = headers.has('authorization')
    const hasAnthropic = headers.has('x-api-key')
    const pathname = new URL(url).pathname
    const reject = (status: number) =>
      new Response(JSON.stringify({ error: { message: `HTTP ${status}` } }), {
        status,
        headers: { 'content-type': 'application/json' }
      })
    if (pathname.endsWith('/models')) {
      // Listing uses whichever auth family the site accepts; relays take both.
      const openaiOk = site !== 'messages_only'
      const anthropicOk = site !== 'chat_only'
      if (hasAnthropic && !anthropicOk) return reject(401)
      if (!hasAnthropic && !openaiOk) return reject(401)
      const model = site === 'messages_only' ? 'claude-relay-1' : 'acme-chat-1'
      return new Response(JSON.stringify({ data: [{ id: model }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const sse = (body: string) =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    if (pathname.endsWith('/chat/completions')) {
      return site === 'messages_only' ? reject(404) : sse(CHAT_SSE)
    }
    if (pathname.endsWith('/responses')) {
      return site === 'relay' ? sse(RESPONSES_SSE) : reject(404)
    }
    if (pathname.endsWith('/messages')) {
      return site === 'chat_only' ? reject(404) : sse(MESSAGES_SSE)
    }
    return reject(404)
  }) as typeof fetch
}

function formatResult(result: Awaited<ReturnType<typeof detectProviderProtocols>>, format: string) {
  const entry = result.formats.find((row) => row.format === format)
  expect(entry).toBeDefined()
  return entry!
}

describe('detectProviderProtocols', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks only chat as usable on a chat-completions-only site', async () => {
    vi.stubGlobal('fetch', fakeFetchFor('chat_only'))
    const result = await detectProviderProtocols({
      baseUrl: 'https://chat-only.example.test/v1',
      credential: 'sk-test',
      verifyModel: 'acme-chat-1'
    })
    const chat = formatResult(result, 'chat_completions')
    const responses = formatResult(result, 'responses')
    const messages = formatResult(result, 'messages')
    // The OpenAI listing covers both OpenAI formats; only chat verifies.
    expect(chat).toMatchObject({ ok: true, listed: true, verified: true })
    expect(responses).toMatchObject({ listed: true, verified: false })
    expect(messages).toMatchObject({ ok: false, listed: false, verified: false })
    expect(result.recommended).toBe('chat_completions')
  })

  it('marks only messages as usable on an anthropic-only site', async () => {
    vi.stubGlobal('fetch', fakeFetchFor('messages_only'))
    const result = await detectProviderProtocols({
      baseUrl: 'https://anth-only.example.test',
      credential: 'sk-test'
    })
    const chat = formatResult(result, 'chat_completions')
    const messages = formatResult(result, 'messages')
    expect(chat).toMatchObject({ ok: false, listed: false, verified: false })
    expect(messages).toMatchObject({ ok: true, listed: true, verified: true })
    // The listed claude-* model drives the messages recommendation.
    expect(result.recommended).toBe('messages')
  })

  it('verifies every format on a relay that accepts both auth styles', async () => {
    vi.stubGlobal('fetch', fakeFetchFor('relay'))
    const result = await detectProviderProtocols({
      baseUrl: 'https://relay.example.test/v1',
      credential: 'sk-test',
      verifyModel: 'gpt-4o-mini'
    })
    for (const entry of result.formats) {
      expect(entry).toMatchObject({ ok: true, listed: true, verified: true })
    }
    // gpt-* prefers the responses protocol among verified formats.
    expect(result.recommended).toBe('responses')
  })

  it('recommends messages for claude models when several formats verify', async () => {
    vi.stubGlobal('fetch', fakeFetchFor('relay'))
    const result = await detectProviderProtocols({
      baseUrl: 'https://relay.example.test/v1',
      credential: 'sk-test',
      verifyModel: 'claude-sonnet-4'
    })
    expect(result.recommended).toBe('messages')
  })

  it('never recommends an unverified format', async () => {
    vi.stubGlobal('fetch', fakeFetchFor('chat_only'))
    const result = await detectProviderProtocols({
      baseUrl: 'https://chat-only.example.test/v1',
      credential: 'sk-test',
      // A claude-* name still cannot promote messages: it never verified.
      verifyModel: 'claude-sonnet-4'
    })
    expect(result.recommended).toBe('chat_completions')
  })

  it('leaves formats unverified and un-recommended without a model to probe', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const result = await detectProviderProtocols({
      baseUrl: 'https://empty-catalog.example.test/v1',
      credential: 'sk-test'
    })
    for (const entry of result.formats) {
      expect(entry.listed).toBe(true)
      expect(entry.verified).toBe(false)
    }
    expect(result.recommended).toBeUndefined()
    // Only the two listing requests ran — no inference probes.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
