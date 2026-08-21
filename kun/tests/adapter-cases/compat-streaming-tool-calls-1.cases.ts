import { describe, expect, it } from 'vitest'

import {
  CompatModelClient,
  type CompatModelClientConfig,
  type ModelStreamLimits
} from '../../src/adapters/model/compat-model-client.js'

import {
  ModelStreamResourceBudget,
  ModelStreamResourceStateError,
  TOOL_ARGUMENT_PART_COMPACTION_WINDOW,
  type PendingToolCall
} from '../../src/adapters/model/model-stream-resource-budget.js'

import type { ModelCapabilityMetadata } from '../../src/contracts/capabilities.js'

import type { ModelRequest, ModelStreamChunk } from '../../src/ports/model-client.js'

type CapturedCall = { url: string; body: Record<string, unknown> }

function sseResponse(
  frames: string[],
  options: { close?: boolean; onCancel?: (reason: unknown) => void } = {}
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      if (options.close !== false) controller.close()
    },
    cancel(reason) {
      options.onCancel?.(reason)
    }
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function streamingFetch(
  frames: string[],
  calls: CapturedCall[] = [],
  responseOptions: { close?: boolean; onCancel?: (reason: unknown) => void } = {}
): typeof fetch {
  return (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) as Record<string, unknown> })
    return sseResponse(frames, responseOptions)
  }) as unknown as typeof fetch
}

function capability(overrides: Partial<ModelCapabilityMetadata> = {}): (model: string) => ModelCapabilityMetadata {
  return (model) => ({
    id: model,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text'],
    ...overrides
  })
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    threadId: 't1',
    turnId: 'u1',
    model: 'test-model',
    systemPrompt: 'You are a helpful assistant.',
    prefix: [],
    history: [],
    tools: [{ name: 'edit', description: 'edit a file', inputSchema: { type: 'object' } }],
    abortSignal: new AbortController().signal,
    ...overrides
  }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function toolCallCompletes(
  chunks: ModelStreamChunk[]
): Extract<ModelStreamChunk, { kind: 'tool_call_complete' }>[] {
  return chunks.filter(
    (c): c is Extract<ModelStreamChunk, { kind: 'tool_call_complete' }> =>
      c.kind === 'tool_call_complete'
  )
}

function completed(chunks: ModelStreamChunk[]): Extract<ModelStreamChunk, { kind: 'completed' }> {
  const last = chunks.at(-1)
  if (!last || last.kind !== 'completed') throw new Error('stream did not end with completed')
  return last
}

function expectResourceLimit(chunk: ModelStreamChunk | undefined, messagePrefix: string): void {
  expect(chunk).toMatchObject({ kind: 'error', code: 'stream_resource_limit' })
  if (!chunk || chunk.kind !== 'error') throw new Error('expected stream resource error')
  expect(chunk.message).toMatch(new RegExp(`^${messagePrefix}`))
  expect(chunk.message).toContain('responseBytes=')
  expect(chunk.message).toContain('frames=')
  expect(chunk.message).toContain('pendingToolCalls=')
  expect(chunk.message).toContain('pendingArgumentBytes=')
  expect(chunk.message).toContain('pendingArgumentFragments=')
}

function chatToolDelta(d: { index: number; id?: unknown; name?: string; args?: string }): string {
  const fn: Record<string, unknown> = {}
  if (d.name !== undefined) fn.name = d.name
  if (d.args !== undefined) fn.arguments = d.args
  const call: Record<string, unknown> = { index: d.index, function: fn }
  if (d.id !== undefined) call.id = d.id
  return frame({ choices: [{ index: 0, delta: { tool_calls: [call] } }] })
}

function chatFinish(reason: string): string {
  return frame({ choices: [{ index: 0, delta: {}, finish_reason: reason }] })
}

function chatToolCallDeltas(): string[] {
  return [
    chatToolDelta({ index: 0, id: 'call_1', name: 'edit', args: '{"path":' }),
    chatToolDelta({ index: 0, args: '"a.txt"}' })
  ]
}

function makeClient(
  fetchImpl: typeof fetch,
  modelCapabilities?: (model: string) => ModelCapabilityMetadata,
  streamLimits?: Partial<ModelStreamLimits>,
  retry?: CompatModelClientConfig['retry']
) {
  return new CompatModelClient({
    baseUrl: 'https://provider.example/v1/chat/completions',
    apiKey: 'sk-test',
    model: 'test-model',
    endpointFormat: 'chat_completions',
    fetchImpl,
    ...(modelCapabilities ? { modelCapabilities } : {}),
    ...(streamLimits ? { streamLimits } : {}),
    ...(retry ? { retry } : {})
  })
}

function makeResponsesClient(frames: string[]): CompatModelClient {
  return new CompatModelClient({
    baseUrl: 'https://provider.example/v1/responses',
    apiKey: 'sk-test',
    model: 'test-model',
    endpointFormat: 'responses',
    fetchImpl: streamingFetch(frames)
  })
}

describe('CompatModelClient streaming tool-call finalization', () => {

it('keeps done-only Responses text and reasoning without duplicating completed output', async () => {
    const message = {
      id: 'msg_1',
      type: 'message',
      content: [{ type: 'output_text', text: 'Done-only answer.' }]
    }
    const reasoning = {
      id: 'reason_1',
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'Done-only reasoning.' }]
    }
    const chunks = await drain(makeResponsesClient([
      frame({ type: 'response.output_item.done', output_index: 0, item: message }),
      frame({ type: 'response.output_item.done', output_index: 1, item: reasoning }),
      frame({ type: 'response.completed', response: { status: 'completed', output: [message, reasoning] } })
    ]).stream(request()))

    expect(chunks.filter((chunk) => chunk.kind === 'assistant_text_delta')).toEqual([
      { kind: 'assistant_text_delta', text: 'Done-only answer.' }
    ])
    expect(chunks.filter((chunk) => chunk.kind === 'assistant_reasoning_delta')).toEqual([
      { kind: 'assistant_reasoning_delta', text: 'Done-only reasoning.' }
    ])
    expect(completed(chunks).stopReason).toBe('stop')
  })

it('keeps Responses text and a function call from the same response exactly once', async () => {
    const message = {
      id: 'msg_1',
      type: 'message',
      content: [{ type: 'output_text', text: 'Hello world.' }]
    }
    const call = {
      id: 'call_1',
      call_id: 'call_1',
      type: 'function_call',
      name: 'edit',
      arguments: '{"path":"a.txt"}'
    }
    const chunks = await drain(makeResponsesClient([
      frame({
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 0,
        delta: 'Hello '
      }),
      frame({ type: 'response.output_item.done', output_index: 0, item: message }),
      frame({ type: 'response.output_item.done', output_index: 1, item: call }),
      frame({ type: 'response.completed', response: { status: 'completed', output: [message, call] } })
    ]).stream(request()))

    expect(chunks.filter((chunk) => chunk.kind === 'assistant_text_delta')).toEqual([
      { kind: 'assistant_text_delta', text: 'Hello ' },
      { kind: 'assistant_text_delta', text: 'world.' }
    ])
    expect(toolCallCompletes(chunks)).toEqual([{
      kind: 'tool_call_complete', callId: 'call_1', toolName: 'edit', arguments: { path: 'a.txt' }
    }])
    expect(completed(chunks).stopReason).toBe('tool_calls')
  })

it('deduplicates anonymous Responses deltas against identified completed output', async () => {
    const message = {
      id: 'msg_1',
      type: 'message',
      content: [{ type: 'output_text', text: 'Hello world.' }]
    }
    const chunks = await drain(makeResponsesClient([
      frame({
        type: 'response.output_text.delta',
        content_index: 0,
        delta: 'Hello '
      }),
      frame({
        type: 'response.completed',
        response: { status: 'completed', output: [message] }
      })
    ]).stream(request()))

    expect(chunks.filter((chunk) => chunk.kind === 'assistant_text_delta')).toEqual([
      { kind: 'assistant_text_delta', text: 'Hello ' },
      { kind: 'assistant_text_delta', text: 'world.' }
    ])
    expect(completed(chunks).stopReason).toBe('stop')
  })

it('uses response.completed.output_text as a final Responses fallback', async () => {
    const chunks = await drain(makeResponsesClient([
      frame({ type: 'response.completed', response: { status: 'completed', output_text: 'Completed fallback.' } })
    ]).stream(request()))
    expect(chunks).toEqual([
      { kind: 'assistant_text_delta', text: 'Completed fallback.' },
      { kind: 'completed', stopReason: 'stop' }
    ])
  })

it('accepts CRLF-delimited SSE frames', async () => {
    const frames = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: 'stop' }] })}\r\n\r\n`
    ]
    const chunks = await drain(makeClient(streamingFetch(frames)).stream(request()))
    expect(chunks).toEqual(expect.arrayContaining([{ kind: 'assistant_text_delta', text: 'hello' }]))
    expect(completed(chunks).stopReason).toBe('stop')
  })

it('reports malformed or truncated SSE instead of completing a partial response', async () => {
    const malformed = await drain(makeClient(streamingFetch(['data: {bad-json}\n\n'])).stream(request()))
    expect(malformed).toEqual([{ kind: 'error', message: 'model stream contained invalid SSE JSON', code: 'stream_invalid_frame' }])

    const truncated = await drain(makeClient(
      streamingFetch([
        frame({ choices: [{ index: 0, delta: { content: 'partial' } }] })
      ]),
      undefined,
      undefined,
      { maxAttempts: 0 }
    ).stream(request()))
    expect(truncated).toEqual([
      { kind: 'assistant_text_delta', text: 'partial' },
      expect.objectContaining({
        kind: 'error',
        message: expect.stringContaining('model stream ended before a terminal frame'),
        code: 'stream_truncated'
      })
    ])
  })

it('emits a tool call when chat_completions ends with finish_reason "tool_calls" (no double emit)', async () => {
    const frames = [...chatToolCallDeltas(), chatFinish('tool_calls'), 'data: [DONE]\n\n']
    const chunks = await drain(makeClient(streamingFetch(frames)).stream(request()))
    const calls = toolCallCompletes(chunks)
    expect(calls).toHaveLength(1)
    expect(calls[0].toolName).toBe('edit')
    expect(calls[0].arguments).toEqual({ path: 'a.txt' })
    expect(completed(chunks).stopReason).toBe('tool_calls')
  })

it('recovers a tool call the provider mislabeled as finish_reason "stop"', async () => {
    // Regression: previously dropped silently because finishReason !== 'tool_calls'.
    const frames = [...chatToolCallDeltas(), chatFinish('stop'), 'data: [DONE]\n\n']
    const chunks = await drain(makeClient(streamingFetch(frames)).stream(request()))
    const calls = toolCallCompletes(chunks)
    expect(calls).toHaveLength(1)
    expect(calls[0].arguments).toEqual({ path: 'a.txt' })
    // A recovered call means it was really a tool-call turn.
    expect(completed(chunks).stopReason).toBe('tool_calls')
  })

it('recovers a tool call when the stream ends with a bare [DONE] and no finish_reason', async () => {
    const frames = [...chatToolCallDeltas(), 'data: [DONE]\n\n']
    const chunks = await drain(makeClient(streamingFetch(frames)).stream(request()))
    expect(toolCallCompletes(chunks)).toHaveLength(1)
    expect(completed(chunks).stopReason).toBe('tool_calls')
  })

it('surfaces truncated arguments as __raw (instead of dropping) on finish_reason "length"', async () => {
    // Only the first (incomplete) delta arrives, then the model hits its cap.
    const frames = [
      chatToolDelta({ index: 0, id: 'call_1', name: 'edit', args: '{"path":' }),
      chatFinish('length'),
      'data: [DONE]\n\n'
    ]
    const chunks = await drain(makeClient(streamingFetch(frames)).stream(request()))
    const calls = toolCallCompletes(chunks)
    expect(calls).toHaveLength(1)
    expect(calls[0].arguments).toHaveProperty('__raw', '{"path":')
    // Truncation stays visible as 'length' so the loop can warn the user.
    expect(completed(chunks).stopReason).toBe('length')
  })

it('keeps bash arguments together when the provider supplies the call id late', async () => {
    const frames = [
      chatToolDelta({ index: 0, name: 'bash', args: '{"command":"printf ' }),
      chatToolDelta({ index: 0, id: 'call_bash', args: 'hello"}' }),
      chatFinish('tool_calls')
    ]
    const chunks = await drain(makeClient(streamingFetch(frames)).stream(request()))
    expect(toolCallCompletes(chunks)).toEqual([{
      kind: 'tool_call_complete',
      callId: 'call_bash',
      toolName: 'bash',
      arguments: { command: 'printf hello' }
    }])
  })

  it('treats an empty chat fragment id as omitted and keeps the indexed tool call', async () => {
    const frames = [
      chatToolDelta({ index: 0, id: 'call_grep', name: 'grep', args: '{"pattern":"plan' }),
      chatToolDelta({ index: 0, id: '', args: 'Worktree"}' }),
      chatFinish('tool_calls')
    ]
    const chunks = await drain(makeClient(streamingFetch(frames)).stream(request()))
    expect(toolCallCompletes(chunks)).toEqual([{
      kind: 'tool_call_complete',
      callId: 'call_grep',
      toolName: 'grep',
      arguments: { pattern: 'planWorktree' }
    }])
    expect(completed(chunks).stopReason).toBe('tool_calls')
  })

  it('treats a null chat fragment id as omitted and keeps the indexed tool call', async () => {
    const frames = [
      chatToolDelta({ index: 0, id: 'call_grep', name: 'grep', args: '{"pattern":"plan' }),
      chatToolDelta({ index: 0, id: null, args: 'Worktree"}' }),
      chatFinish('tool_calls')
    ]
    const chunks = await drain(makeClient(streamingFetch(frames)).stream(request()))
    expect(toolCallCompletes(chunks)).toEqual([{
      kind: 'tool_call_complete',
      callId: 'call_grep',
      toolName: 'grep',
      arguments: { pattern: 'planWorktree' }
    }])
    expect(completed(chunks).stopReason).toBe('tool_calls')
  })

  it('migrates a null-id indexed call when a later chat fragment supplies the id', async () => {
    const frames = [
      chatToolDelta({ index: 0, id: null, name: 'read', args: '{"path":"src/' }),
      chatToolDelta({ index: 0, id: 'call_read', args: 'main.ts"}' }),
      chatFinish('tool_calls')
    ]
    const chunks = await drain(makeClient(streamingFetch(frames)).stream(request()))
    expect(toolCallCompletes(chunks)).toEqual([{
      kind: 'tool_call_complete',
      callId: 'call_read',
      toolName: 'read',
      arguments: { path: 'src/main.ts' }
    }])
  })

  it.each([
    { label: 'number', id: 42 },
    { label: 'object', id: { value: 'do-not-log-provider-id' } },
    { label: 'oversized string', id: 'x'.repeat(513) },
    { label: 'control-character string', id: 'call_secret\nvalue' }
  ])('rejects an invalid $label chat fragment id with a redacted protocol error', async ({ id }) => {
    const chunks = await drain(makeClient(streamingFetch([
      chatToolDelta({ index: 0, id, name: 'grep', args: '{"pattern":"secret"}' })
    ])).stream(request()))
    expect(chunks.at(-1)).toEqual({
      kind: 'error',
      code: 'stream_tool_call_protocol',
      message: 'model stream tool-call protocol error: provider call id is invalid (pendingToolCalls=0)'
    })
    expect(JSON.stringify(chunks.at(-1))).not.toContain('do-not-log-provider-id')
    expect(JSON.stringify(chunks.at(-1))).not.toContain('call_secret')
    expect(JSON.stringify(chunks.at(-1))).not.toContain('Cannot read properties')
  })

  it('merges an anonymous chat fragment into the only pending tool call', async () => {
    const frames = [
      chatToolDelta({ index: 0, id: 'call_bash', name: 'bash', args: '{"command":"echo ' }),
      frame({ choices: [{ index: 0, delta: { tool_calls: [{ function: { arguments: 'safe"}' } }] } }] }),
      chatFinish('tool_calls')
    ]
    const chunks = await drain(makeClient(streamingFetch(frames)).stream(request()))
    expect(toolCallCompletes(chunks)[0]).toMatchObject({
      callId: 'call_bash', arguments: { command: 'echo safe' }
    })
  })

  it('rejects an anonymous fragment with multiple candidates using redacted diagnostics', async () => {
    const secret = 'do-not-log-this-command'
    const chunks = await drain(makeClient(streamingFetch([
      chatToolDelta({ index: 0, id: 'call_1', name: 'bash', args: '{"command":"one"}' }),
      chatToolDelta({ index: 1, id: 'call_2', name: 'bash', args: '{"command":"two"}' }),
      frame({ choices: [{ index: 0, delta: { tool_calls: [{ function: { arguments: secret } }] } }] })
    ])).stream(request()))
    expect(chunks.at(-1)).toEqual({
      kind: 'error',
      code: 'stream_tool_call_protocol',
      message: 'model stream tool-call protocol error: fragment omitted both id and index with multiple candidates (pendingToolCalls=2)'
    })
    expect(JSON.stringify(chunks)).not.toContain(secret)
  })

  it('migrates a Responses index identity when output_item.done supplies the call id', async () => {
    const call = {
      type: 'function_call', call_id: 'response_bash', name: 'bash',
      arguments: '{"command":"echo ok"}'
    }
    const chunks = await drain(makeResponsesClient([
      frame({
        type: 'response.function_call_arguments.delta', output_index: 0,
        delta: '{"command":"echo '
      }),
      frame({ type: 'response.output_item.done', output_index: 0, item: call }),
      frame({ type: 'response.completed', response: { status: 'completed', output: [call] } })
    ]).stream(request()))
    expect(toolCallCompletes(chunks)).toEqual([{
      kind: 'tool_call_complete', callId: 'response_bash', toolName: 'bash',
      arguments: { command: 'echo ok' }
    }])
  })

  it('rejects a pending call without a tool name instead of silently dropping it', async () => {
    const chunks = await drain(makeClient(streamingFetch([
      chatToolDelta({ index: 0, id: 'secret-provider-id', args: '{"command":"secret"}' }),
      chatFinish('tool_calls')
    ])).stream(request()))
    expect(chunks.at(-1)).toEqual({
      kind: 'error',
      code: 'stream_tool_call_protocol',
      message: 'model stream tool-call protocol error: pending call is missing a tool name (pendingToolCalls=1)'
    })
    const diagnostic = JSON.stringify(chunks.at(-1))
    expect(diagnostic).not.toContain('secret-provider-id')
    expect(diagnostic).not.toContain('"secret"')
  })

it('does not emit a tool call when no tool deltas were streamed', async () => {
    const frames = [
      frame({ choices: [{ index: 0, delta: { content: 'hello' } }] }),
      chatFinish('stop'),
      'data: [DONE]\n\n'
    ]
    const chunks = await drain(makeClient(streamingFetch(frames)).stream(request()))
    expect(toolCallCompletes(chunks)).toHaveLength(0)
    expect(completed(chunks).stopReason).toBe('stop')
  })

  it('merges indexless Anthropic argument and stop frames into the sole tool block', async () => {
    const frames = [
      frame({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_bash', name: 'bash' } }),
      frame({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"command":"echo ok"}' } }),
      frame({ type: 'content_block_stop' }),
      frame({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }),
      frame({ type: 'message_stop' })
    ]
    const client = new CompatModelClient({
      baseUrl: 'https://provider.example/anthropic',
      apiKey: 'sk-test',
      model: 'test-model',
      endpointFormat: 'messages',
      fetchImpl: streamingFetch(frames)
    })
    const chunks = await drain(client.stream(request()))
    expect(toolCallCompletes(chunks)).toEqual([{
      kind: 'tool_call_complete', callId: 'toolu_bash', toolName: 'bash',
      arguments: { command: 'echo ok' }
    }])
  })

it('recovers an Anthropic Messages tool_use block cut off before content_block_stop', async () => {
    const frames = [
      frame({ type: 'message_start', message: { usage: { input_tokens: 10 } } }),
      frame({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'edit' } }),
      frame({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"a.txt"}' } }),
      // No content_block_stop — stream is cut off, then the message ends.
      frame({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }),
      frame({ type: 'message_stop' })
    ]
    const client = new CompatModelClient({
      baseUrl: 'https://provider.example/anthropic',
      apiKey: 'sk-test',
      model: 'test-model',
      endpointFormat: 'messages',
      fetchImpl: streamingFetch(frames)
    })
    const chunks = await drain(client.stream(request()))
    const calls = toolCallCompletes(chunks)
    expect(calls).toHaveLength(1)
    expect(calls[0].toolName).toBe('edit')
    expect(calls[0].arguments).toEqual({ path: 'a.txt' })
  })

})
