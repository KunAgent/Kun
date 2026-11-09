import { describe, expect, it, vi } from 'vitest'
import { CompatModelClient } from './compat-model-client.js'
import { gatewaySafeModelChunk } from './gateway-model-privacy.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

const request: ModelRequest = {
  threadId: 'thread', turnId: 'turn', model: 'test-model', systemPrompt: 'test',
  prefix: [], history: [], tools: [], abortSignal: new AbortController().signal
}

function interruptedStream(mode: 'read' | 'truncated' | 'idle'): Response {
  const encoder = new TextEncoder()
  let sent = false
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(encoder.encode(
          'data: {"type":"response.output_text.delta","delta":"部分 🐈"}\n\n'
        ))
      } else if (mode === 'read') controller.error(new Error('connection reset'))
      else if (mode === 'truncated') controller.close()
      else return new Promise<void>(() => {})
    }
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('partial stream delivery', () => {
  it.each([
    ['read', 'stream_read_error'],
    ['truncated', 'stream_truncated'],
    ['idle', 'stream_idle_timeout']
  ] as const)('does not replay visible text after %s failure', async (mode, code) => {
    const fetchImpl = vi.fn(async () => interruptedStream(mode))
    const client = new CompatModelClient({
      baseUrl: 'https://provider.example/v1/responses', apiKey: 'fixture', model: 'test-model',
      endpointFormat: 'responses', streamIdleTimeoutMs: 50,
      retry: { maxAttempts: 5, initialDelayMs: 0, httpStatusCodes: [429, 503] }, fetchImpl
    })
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(request)) chunks.push(chunk)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(chunks.filter((chunk) => chunk.kind === 'assistant_text_delta')).toEqual([
      { kind: 'assistant_text_delta', text: '部分 🐈' }
    ])
    expect(chunks.at(-1)).toMatchObject({ kind: 'error', code,
      failure: { responsePhase: 'interrupted', partialOutput: true, failoverAllowed: false } })
    expect(chunks.some((chunk) => chunk.kind === 'completed' || chunk.kind === 'retrying')).toBe(false)
  })
})

function streamThenReadError(frame: string, message = 'original read failure'): Response {
  const encoder = new TextEncoder()
  let sent = false
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(encoder.encode(frame))
      } else {
        controller.error(new Error(message))
      }
    }
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function recoveryClient(fetchImpl: typeof fetch, maxAttempts = 2): CompatModelClient {
  return new CompatModelClient({
    baseUrl: 'https://provider.example/v1/responses', apiKey: 'fixture', model: 'test-model',
    endpointFormat: 'responses',
    retry: { maxAttempts, initialDelayMs: 0, httpStatusCodes: [503] }, fetchImpl
  })
}

async function collect(client: CompatModelClient, modelRequest = request): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of client.stream(modelRequest)) chunks.push(chunk)
  return chunks
}

describe('stream recovery failure boundaries', () => {
  it('stops silently if the turn is aborted while posting a recovery request', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        return new Response('', { headers: { 'content-type': 'text/event-stream' } })
      }
      controller.abort()
      throw new Error('cancelled while reconnecting')
    })
    const chunks = await collect(recoveryClient(fetchImpl), { ...request, abortSignal: controller.signal })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(chunks.some((chunk) => chunk.kind === 'error')).toBe(false)
  })

  it('describes a shared retry budget consumed by HTTP failures without claiming stream retries', async () => {
    const fetchImpl = vi.fn(async () => fetchImpl.mock.calls.length === 1
      ? new Response('unavailable', { status: 503 })
      : new Response('', { headers: { 'content-type': 'text/event-stream' } }))
    const chunks = await collect(recoveryClient(fetchImpl, 1))
    const error = [...chunks].reverse().find((chunk) => chunk.kind === 'error')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(error?.kind === 'error' ? error.message : '').toContain('all 1 configured request retries were exhausted')
    expect(error?.kind === 'error' ? error.message : '').not.toContain('stream retries')
  })

  it.each(['stream_read_error', 'provider_rejected'])(
    'preserves provider error %s when the transport subsequently fails', async (code) => {
      const fetchImpl = vi.fn(async () => streamThenReadError(
        `data: ${JSON.stringify({ error: { code, message: 'provider rejected request' } })}\n\n`
      ))
      const chunks = await collect(recoveryClient(fetchImpl))
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(chunks.filter((chunk) => chunk.kind === 'retrying')).toEqual([])
      expect(chunks.filter((chunk) => chunk.kind === 'error')).toEqual([
        expect.objectContaining({ kind: 'error', code, message: 'provider rejected request',
          failure: expect.objectContaining({ responseReceived: true }) })
      ])
    }
  )
})


describe('preserving the first interrupted stream failure', () => {
  it('retains a sanitized first cause when a later reconnect fails', async () => {
    const fetchImpl = vi.fn(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        return streamThenReadError(
          'data: {"type":"response.reasoning_summary_text.delta","delta":"plan"}\n\n',
          'original read failure fixture'
        )
      }
      throw new Error('reconnection failed')
    })
    const chunks = await collect(recoveryClient(fetchImpl, 1))
    const error = [...chunks].reverse().find((chunk) => chunk.kind === 'error')
    expect(error).toMatchObject({ kind: 'error', code: 'model_provider_unreachable',
      failure: { firstStreamFailure: { code: 'stream_read_error', message: expect.stringContaining('original read failure') } } })
    expect(JSON.stringify(error)).not.toContain('fixture')
    expect(JSON.stringify(gatewaySafeModelChunk(error!))).not.toContain('original read failure')
  })

  it.each(['bodyless', 'oversized-http', 'invalid-json', 'provider-json'] as const)(
    'retains the initial stream failure if recovery returns %s', async (kind) => {
      const fetchImpl = vi.fn(async () => {
        if (fetchImpl.mock.calls.length === 1) return streamThenReadError(
          'data: {"type":"response.reasoning_summary_text.delta","delta":"plan"}\n\n',
          'original read failure fixture'
        )
        if (kind === 'bodyless') return new Response(null, { status: 204 })
        if (kind === 'oversized-http') return new Response('x'.repeat(1024 * 1024 + 1), { status: 400 })
        const json = kind === 'invalid-json'
          ? '{broken'
          : JSON.stringify({ error: { code: 'provider_rejected', message: 'provider rejected' } })
        return new Response(json, { headers: { 'content-type': 'application/json' } })
      })
      const chunks = await collect(recoveryClient(fetchImpl, 1))
      const error = [...chunks].reverse().find((chunk) => chunk.kind === 'error')
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(error).toMatchObject({ kind: 'error', failure: { firstStreamFailure: {
        code: 'stream_read_error', message: expect.stringContaining('original read failure')
      } } })
      expect(JSON.stringify(error)).not.toContain('fixture')
      expect(JSON.stringify(gatewaySafeModelChunk(error!))).not.toContain('original read failure')
      if (kind === 'provider-json') expect(error).toMatchObject({
        code: 'provider_rejected', message: 'provider rejected'
      })
    }
  )

  it('redacts the configured credential from a terminal partial-stream error', async () => {
    const fetchImpl = vi.fn(async () => streamThenReadError(
      'data: {"type":"response.output_text.delta","delta":"visible"}\n\n',
      'socket reset fixture'
    ))
    const chunks = await collect(recoveryClient(fetchImpl))
    const error = [...chunks].reverse().find((chunk) => chunk.kind === 'error')
    expect(JSON.stringify(error)).toContain('socket reset')
    expect(JSON.stringify(error)).not.toContain('fixture')
  })
})

class AnomalousStreamClient extends CompatModelClient {
  constructor(private readonly scriptedChunks: ModelStreamChunk[], fetchImpl: typeof fetch) {
    super({
      baseUrl: 'https://provider.example/v1/responses', apiKey: 'fixture', model: 'test-model',
      endpointFormat: 'responses',
      retry: { maxAttempts: 2, initialDelayMs: 0, httpStatusCodes: [] }, fetchImpl
    })
  }

  protected override async *streamSse(): AsyncIterable<ModelStreamChunk> {
    yield* this.scriptedChunks
  }
}

describe('anomalous terminal ordering', () => {
  it.each(['usage', 'completed'] as const)(
    'does not retry committed tool/media or report success when %s precedes an error',
    async (boundary) => {
      const fetchImpl = vi.fn(async () => new Response('', { headers: { 'content-type': 'text/event-stream' } }))
      const tool: ModelStreamChunk = { kind: 'tool_call_complete', callId: 'call_1', toolName: 'edit', arguments: {} }
      const image: ModelStreamChunk = { kind: 'image_generation_complete', imageBase64: 'aW1hZ2U=', mimeType: 'image/png' }
      const marker: ModelStreamChunk = boundary === 'usage'
        ? { kind: 'usage', usage: { promptTokens: 0, completionTokens: 1, totalTokens: 1, cacheHitRate: null, turns: 1 } }
        : { kind: 'completed', stopReason: 'stop' }
      const error: ModelStreamChunk = { kind: 'error', code: 'stream_read_error', message: 'late read error',
        failure: { category: 'network', failoverAllowed: true, responsePhase: 'interrupted' } }
      const chunks = await collect(new AnomalousStreamClient([tool, image, marker, error], fetchImpl))
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(chunks.filter((chunk) => chunk.kind === 'tool_call_complete')).toEqual([tool])
      expect(chunks.filter((chunk) => chunk.kind === 'image_generation_complete')).toEqual([image])
      expect(chunks.some((chunk) => chunk.kind === 'completed' || chunk.kind === 'retrying')).toBe(false)
      expect(chunks.at(-1)).toMatchObject({ kind: 'error', code: 'stream_read_error',
        failure: { failoverAllowed: false } })
    }
  )
})
