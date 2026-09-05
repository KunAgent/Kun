import { describe, expect, it, vi } from 'vitest'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import {
  MAX_MODEL_REQUEST_TRACE_PROVIDER_ID_LENGTH,
  MAX_MODEL_REQUEST_TRACE_PROVIDER_KIND_LENGTH,
  MAX_MODEL_REQUEST_TRACE_TOOL_CATALOG_ENTRIES,
  MAX_MODEL_REQUEST_TRACE_TOOL_NAME_LENGTH,
  MODEL_REQUEST_TRACE_REDACTED_VALUE
} from '../../contracts/model-request-trace.js'
import { LlmDebugRecorder, type LlmDebugSink } from '../../services/llm-debug-recorder.js'
import { makeGoalContextItem, makeUserItem } from '../../domain/item.js'
import { CompatModelClient } from './compat-model-client.js'

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    threadId: 'thread-observe',
    turnId: 'turn-observe',
    model: 'test-model',
    systemPrompt: 'You are helpful.',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: new AbortController().signal,
    ...overrides
  }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function okJson(text = 'ok'): Response {
  return new Response(JSON.stringify({
    choices: [{ index: 0, finish_reason: 'stop', message: { content: text } }]
  }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-ok' }
  })
}

describe('CompatModelClient request observability', () => {
  it('retains metadata but not request content when the thread capture policy is disabled', async () => {
    const recorder = new LlmDebugRecorder({ shouldCapture: () => false })
    let calls = 0
    const client = new CompatModelClient({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      endpointFormat: 'chat_completions',
      nonStreaming: true,
      debugSink: recorder,
      fetchImpl: (async () => {
        calls += 1
        return okJson('not traced')
      }) as unknown as typeof fetch
    })

    const chunks = await drain(client.stream(request()))

    expect(calls).toBe(1)
    expect(chunks).toContainEqual({ kind: 'assistant_text_delta', text: 'not traced' })
    expect(recorder.snapshot()).toHaveLength(1)
    expect(recorder.snapshot()[0]).toMatchObject({
      captureContent: false,
      exchanges: [{ captureMode: 'metadata', request: { body: { text: '', originalBytes: 0 } } }]
    })
  })

  it('captures exact request JSON, redacted headers, raw SSE, response headers, and decoded output', async () => {
    const recorder = new LlmDebugRecorder()
    let transmittedBody = ''
    let transmittedAuthorization = ''
    const raw = [
      'data: {"choices":[{"index":0,"delta":{"content":"hello"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ].join('')
    const client = new CompatModelClient({
      baseUrl: 'https://user:password@provider.example/v1?api_key=query-secret&project=visible',
      apiKey: 'sk-provider-secret',
      model: 'test-model',
      endpointFormat: 'chat_completions',
      headers: { 'x-project': 'visible-project' },
      debugSink: recorder,
      fetchImpl: (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
        transmittedBody = init.body
        transmittedAuthorization = init.headers.Authorization
        return new Response(raw, {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            'x-request-id': 'req-stream',
            'set-cookie': 'provider-session=secret'
          }
        })
      }) as unknown as typeof fetch
    })

    const chunks = await drain(client.stream(request({
      tools: [{
        name: 'read',
        description: 'Read a file',
        inputSchema: { type: 'object' },
        providerKind: 'built-in',
        providerId: 'builtin'
      }]
    })))
    const page = await recorder.listThread('thread-observe')
    const trace = page.records[0]
    if (!trace.request) throw new Error('expected a request payload in the captured trace')

    expect(trace.request.body.text).toBe(transmittedBody)
    expect(JSON.parse(trace.request.body.text)).toHaveProperty('messages')
    expect(trace.toolCatalog).toEqual([{
      name: 'read',
      providerKind: 'built-in',
      providerId: 'builtin'
    }])
    expect(trace.request.body.text).not.toContain('providerKind')
    expect(trace.request.body.text).not.toContain('providerId')
    expect(transmittedAuthorization).toBe('Bearer sk-provider-secret')
    expect(trace.request.headers.values.Authorization).toBe(MODEL_REQUEST_TRACE_REDACTED_VALUE)
    expect(trace.request.headers.values['x-project']).toBe('visible-project')
    expect(trace.request.url).not.toContain('password')
    expect(trace.request.url).not.toContain('query-secret')
    expect(trace.request.urlRedacted).toBe(true)
    expect(trace.response).toMatchObject({ status: 200, statusText: '' })
    expect(trace.response?.headers.values['x-request-id']).toBe('req-stream')
    expect(trace.response?.headers.values['set-cookie']).toBe(MODEL_REQUEST_TRACE_REDACTED_VALUE)
    expect(trace.response?.body).toEqual({
      text: raw,
      capturedBytes: Buffer.byteLength(raw),
      originalBytes: Buffer.byteLength(raw),
      truncated: false
    })
    expect(trace.decoded?.text).toBe('hello')
    expect(trace.decoded?.stopReason).toBe('stop')
    expect(chunks).toContainEqual({ kind: 'assistant_text_delta', text: 'hello' })
  })

  it('redacts goal-context history from the retained trace without changing the provider request', async () => {
    const recorder = new LlmDebugRecorder()
    let transmittedBody = ''
    const goalText = 'Internal active-goal context must not be exposed through diagnostics.'
    const client = new CompatModelClient({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      endpointFormat: 'chat_completions',
      nonStreaming: true,
      debugSink: recorder,
      fetchImpl: (async (_url: string, init: { body: string }) => {
        transmittedBody = init.body
        return okJson('done')
      }) as unknown as typeof fetch
    })
    const history = [
      makeGoalContextItem({
        id: 'item_goal_context',
        threadId: 'thread-observe',
        turnId: 'turn-observe',
        goalKey: 'goal_debug',
        text: goalText
      }),
      makeUserItem({
        id: 'item_visible',
        threadId: 'thread-observe',
        turnId: 'turn-observe',
        text: 'visible continuation context'
      })
    ]

    await drain(client.stream(request({ history })))
    const trace = (await recorder.listThread('thread-observe')).records[0]
    if (!trace.request) throw new Error('expected a request payload in the captured trace')

    expect(transmittedBody).toContain(goalText)
    expect(trace.request.body.text).not.toContain(goalText)
    expect(trace.request.body.text).toContain('visible continuation context')
    expect(trace.request.body.text).toContain(MODEL_REQUEST_TRACE_REDACTED_VALUE)
  })

  it('records transient retries as separately ordered HTTP attempts', async () => {
    const recorder = new LlmDebugRecorder()
    let calls = 0
    const client = new CompatModelClient({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      endpointFormat: 'chat_completions',
      nonStreaming: true,
      retry: { maxAttempts: 1, initialDelayMs: 0, httpStatusCodes: [502] },
      debugSink: recorder,
      fetchImpl: (async () => {
        calls += 1
        return calls === 1
          ? new Response('bad gateway', { status: 502, headers: { 'content-type': 'text/plain' } })
          : okJson('retried')
      }) as unknown as typeof fetch
    })

    await drain(client.stream(request({
      tools: [{
        name: 'mcp_files_read',
        description: 'Read through MCP',
        inputSchema: { type: 'object' },
        providerKind: 'mcp',
        providerId: 'mcp:files'
      }]
    })))
    const traces = (await recorder.listThread('thread-observe')).records

    expect(traces).toHaveLength(2)
    expect([...traces].reverse().map((trace) => [trace.attempt, trace.attemptReason])).toEqual([
      [1, 'initial'],
      [2, 'transport_retry']
    ])
    expect(traces.find((trace) => trace.attempt === 1)?.response?.body?.text).toBe('bad gateway')
    expect(traces.find((trace) => trace.attempt === 1)?.response?.status).toBe(502)
    expect(traces.find((trace) => trace.attempt === 2)?.decoded?.text).toBe('retried')
    expect(traces[0].toolCatalog).toEqual(traces[1].toolCatalog)
  })

  it('records the stream-options compatibility fallback with its changed exact body', async () => {
    const recorder = new LlmDebugRecorder()
    const transmittedBodies: string[] = []
    const client = new CompatModelClient({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      endpointFormat: 'chat_completions',
      debugSink: recorder,
      fetchImpl: (async (_url: string, init: { body: string }) => {
        transmittedBodies.push(init.body)
        return transmittedBodies.length === 1
          ? new Response('{"error":"stream_options include_usage unsupported"}', {
              status: 400,
              headers: { 'content-type': 'application/json' }
            })
          : okJson('fallback')
      }) as unknown as typeof fetch
    })

    await drain(client.stream(request()))
    const traces = [...(await recorder.listThread('thread-observe')).records].reverse()

    expect(traces.map((trace) => trace.attemptReason)).toEqual(['initial', 'stream_options_fallback'])
    expect(traces.map((trace) => {
      if (!trace.request) throw new Error('expected a request payload in the captured trace')
      return trace.request.body.text
    })).toEqual(transmittedBodies)
    expect(JSON.parse(transmittedBodies[0])).toHaveProperty('stream_options')
    expect(JSON.parse(transmittedBodies[1])).not.toHaveProperty('stream_options')
    expect(traces[1].decoded?.text).toBe('fallback')
  })

  it('records transport errors and reports the unreachable request URL', async () => {
    const recorder = new LlmDebugRecorder()
    const client = new CompatModelClient({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      endpointFormat: 'chat_completions',
      retry: { maxAttempts: 0 },
      debugSink: recorder,
      fetchImpl: (async () => { throw new Error('socket unavailable') }) as unknown as typeof fetch
    })

    const chunks = await drain(client.stream(request()))
    const trace = (await recorder.listThread('thread-observe')).records[0]

    expect(trace.status).toBe('transport_error')
    expect(trace.error).toBe('socket unavailable')
    expect(chunks).toContainEqual(expect.objectContaining({
      kind: 'error',
      message:
        'model provider did not return a response from https://provider.example/v1/chat/completions: socket unavailable',
      failure: { category: 'network', failoverAllowed: true }
    }))
  })

  it('continues the provider call when observability capture itself fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let calls = 0
    const failingSink = {
      start: () => { throw new Error('trace storage unavailable') }
    } as unknown as LlmDebugSink
    const client = new CompatModelClient({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      endpointFormat: 'chat_completions',
      nonStreaming: true,
      debugSink: failingSink,
      fetchImpl: (async () => {
        calls += 1
        return okJson('still works')
      }) as unknown as typeof fetch
    })

    const chunks = await drain(client.stream(request()))

    expect(calls).toBe(1)
    expect(chunks).toContainEqual({ kind: 'assistant_text_delta', text: 'still works' })
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('provider request continues unchanged'))
    warning.mockRestore()
  })

  it('bounds the local tool catalog before retaining it', () => {
    const recorder = new LlmDebugRecorder()
    const round = recorder.start({
      threadId: 'thread-observe',
      turnId: 'turn-observe',
      provider: 'compat',
      model: 'test-model',
      toolCatalog: Array.from({ length: MAX_MODEL_REQUEST_TRACE_TOOL_CATALOG_ENTRIES + 20 }, (_, index) => ({
        name: `${index}-${'n'.repeat(MAX_MODEL_REQUEST_TRACE_TOOL_NAME_LENGTH + 20)}`,
        providerKind: 'k'.repeat(MAX_MODEL_REQUEST_TRACE_PROVIDER_KIND_LENGTH + 20),
        providerId: 'p'.repeat(MAX_MODEL_REQUEST_TRACE_PROVIDER_ID_LENGTH + 20)
      }))
    })

    const trace = recorder.beginHttpAttempt(round, {
      endpointFormat: 'chat_completions',
      attempt: 1,
      reason: 'initial',
      url: 'https://provider.example/v1/chat/completions',
      headers: {},
      bodyText: '{}'
    })

    expect(trace.toolCatalog).toHaveLength(MAX_MODEL_REQUEST_TRACE_TOOL_CATALOG_ENTRIES)
    expect(trace.toolCatalog?.[0].name.length).toBe(MAX_MODEL_REQUEST_TRACE_TOOL_NAME_LENGTH)
    expect(trace.toolCatalog?.[0].providerKind?.length).toBe(
      MAX_MODEL_REQUEST_TRACE_PROVIDER_KIND_LENGTH
    )
    expect(trace.toolCatalog?.[0].providerId?.length).toBe(
      MAX_MODEL_REQUEST_TRACE_PROVIDER_ID_LENGTH
    )
  })
})
