import { describe, expect, it } from 'vitest'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'
import { emptyUsageSnapshot } from '../../contracts/usage.js'
import {
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserItem
} from '../../domain/item.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import { CompatModelClient } from './compat-model-client.js'
import { decodeCompatNonStreamingResponse } from './compat-non-streaming-decoder.js'

type CapturedCall = { body: Record<string, unknown>; url: string }

const TOOL = {
  name: 'read_file',
  description: 'Read one file',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false
  }
}

describe('CompatModelClient model-switch continuity', () => {
  for (const endpointFormat of ['chat_completions', 'responses', 'messages'] as const) {
    for (const thinking of [false, true]) {
      it(`projects a legal ${endpointFormat} history after switching to a ${thinking ? 'thinking' : 'non-thinking'} model`, async () => {
        const calls: CapturedCall[] = []
        const client = new CompatModelClient({
          baseUrl: 'https://provider.example/v1',
          apiKey: 'test-key',
          model: 'new-model',
          endpointFormat,
          nonStreaming: true,
          fetchImpl: captureJsonFetch(calls, endpointFormat),
          modelCapabilities: () => capabilities(endpointFormat)
        })

        const chunks = await drain(client.stream(switchedRequest(thinking)))
        expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
        expect(calls).toHaveLength(1)

        const serialized = JSON.stringify(calls[0]?.body)
        expect(serialized).not.toContain('private old reasoning')
        expect(serialized).not.toContain('gemini-signature-from-old-route')
        expect(serialized).not.toContain('anthropic-signature-from-old-route')
        expect(serialized).not.toContain('providerMetadata')
        assertToolPair(endpointFormat, calls[0]!.body)

        if (endpointFormat === 'chat_completions') {
          const messages = calls[0]!.body.messages as Array<Record<string, unknown>>
          const assistants = messages.filter((message) => message.role === 'assistant')
          if (thinking) {
            // Provider A's private reasoning belongs to an older turn. A
            // switch to provider B may retain the adapter's schema-required
            // blank placeholder, but it must not replay A's private text.
            expect(assistants.every((message) => typeof message.reasoning_content === 'string')).toBe(true)
            expect(assistants.every((message) => message.reasoning_content === ' ')).toBe(true)
          } else {
            expect(assistants.every((message) => !('reasoning_content' in message))).toBe(true)
          }
        } else if (endpointFormat === 'responses') {
          expect(serialized).not.toContain('reasoning_content')
          expect(serialized).not.toContain('thinking')
        } else {
          // A prior route's provider-neutral reasoning cannot be reconstructed
          // as an Anthropic thinking block: it has no valid signature.
          expect(serialized).not.toContain('reasoning_content')
          expect(serialized).not.toContain('"type":"thinking"')
          expect(serialized).not.toContain('redacted_thinking')
        }
      })
    }
  }

  it('keeps Chat reasoning_content inside the active tool-use turn', async () => {
    const calls: CapturedCall[] = []
    const client = new CompatModelClient({
      baseUrl: 'https://provider-b.example/v1',
      apiKey: 'test-key',
      model: 'new-model',
      endpointFormat: 'chat_completions',
      nonStreaming: true,
      fetchImpl: captureJsonFetch(calls, 'chat_completions'),
      modelCapabilities: () => capabilities('chat_completions')
    })
    const threadId = 'thread-active-chat'
    const turnId = 'turn-active-chat'
    const callId = 'call-active-chat'
    await drain(client.stream({
      threadId,
      turnId,
      model: 'new-model',
      providerId: 'provider-b',
      reasoningEffort: 'high',
      prefix: [],
      history: [
        makeUserItem({ id: 'user-active-chat', threadId, turnId, text: 'Read a.ts' }),
        makeAssistantReasoningItem({
          id: 'reason-active-chat', threadId, turnId, text: 'inspect active file', status: 'completed'
        }),
        makeToolCallItem({
          id: 'call-active-chat', threadId, turnId, callId, toolName: 'read_file',
          arguments: { path: 'a.ts' }, status: 'completed'
        }),
        makeToolResultItem({
          id: 'result-active-chat', threadId, turnId, callId, toolName: 'read_file',
          output: 'active contents', status: 'completed'
        })
      ],
      tools: [TOOL],
      abortSignal: new AbortController().signal
    }))

    const messages = calls[0]?.body.messages as Array<Record<string, unknown>>
    expect(messages.find((message) => Array.isArray(message.tool_calls))).toMatchObject({
      reasoning_content: 'inspect active file'
    })
  })

  it('round-trips exact signed and redacted Messages thinking only within the active tool turn', async () => {
    const calls: CapturedCall[] = []
    let attempt = 0
    const fetchImpl = (async (url: string, init: { body: string }) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) as Record<string, unknown> })
      attempt += 1
      if (attempt === 1) {
        return new Response(messagesToolStream(), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
      }
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'done' }],
        stop_reason: 'end_turn'
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as unknown as typeof fetch
    const client = new CompatModelClient({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'test-key',
      model: 'claude-thinking',
      endpointFormat: 'messages',
      fetchImpl,
      modelCapabilities: () => capabilities('messages')
    })
    const abortSignal = new AbortController().signal
    const firstRequest: ModelRequest = {
      threadId: 'thread-switch',
      turnId: 'turn-active',
      model: 'claude-thinking',
      reasoningEffort: 'high',
      prefix: [],
      history: [makeUserItem({
        id: 'user-active',
        threadId: 'thread-switch',
        turnId: 'turn-active',
        text: 'Inspect the file'
      })],
      tools: [TOOL],
      abortSignal
    }

    const first = await drain(client.stream(firstRequest))
    const completedCall = first.find((chunk) => chunk.kind === 'tool_call_complete')
    expect(completedCall).toMatchObject({
      kind: 'tool_call_complete',
      callId: 'toolu_active',
      providerMetadata: {
        anthropic: {
          thinkingBlocks: [
            { type: 'thinking', thinking: 'inspect first', signature: 'signed-thinking' },
            { type: 'redacted_thinking', data: 'opaque-redacted' }
          ]
        }
      }
    })
    if (!completedCall || completedCall.kind !== 'tool_call_complete') {
      throw new Error('expected a completed tool call')
    }

    const secondRequest: ModelRequest = {
      ...firstRequest,
      history: [
        ...firstRequest.history,
        makeAssistantReasoningItem({
          id: 'reason-active', threadId: 'thread-switch', turnId: 'turn-active',
          text: 'inspect first', status: 'completed'
        }),
        makeToolCallItem({
          id: 'call-active', threadId: 'thread-switch', turnId: 'turn-active',
          callId: completedCall.callId, toolName: completedCall.toolName,
          arguments: completedCall.arguments,
          providerMetadata: completedCall.providerMetadata,
          status: 'completed'
        }),
        makeToolResultItem({
          id: 'result-active', threadId: 'thread-switch', turnId: 'turn-active',
          callId: completedCall.callId, toolName: completedCall.toolName,
          output: 'file contents', status: 'completed'
        })
      ]
    }
    const second = await drain(client.stream(secondRequest))
    expect(second.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })

    const messages = calls[1]?.body.messages as Array<{
      role: string
      content: Array<Record<string, unknown>>
    }>
    const toolAssistant = messages.find((message) =>
      message.role === 'assistant' && message.content.some((block) => block.type === 'tool_use')
    )
    expect(toolAssistant?.content).toEqual([
      { type: 'thinking', thinking: 'inspect first', signature: 'signed-thinking' },
      { type: 'redacted_thinking', data: 'opaque-redacted' },
      {
        type: 'tool_use', id: 'toolu_active', name: 'read_file', input: { path: 'a.ts' },
        cache_control: { type: 'ephemeral' }
      }
    ])
    const toolResult = messages.find((message) =>
      message.role === 'user' && message.content.some((block) => block.type === 'tool_result')
    )
    expect(toolResult?.content[0]).toEqual({
      type: 'tool_result', tool_use_id: 'toolu_active', content: 'file contents',
      cache_control: { type: 'ephemeral' }
    })
  })

  it('captures exact Messages thinking metadata from a non-streaming tool response', () => {
    const chunks = decodeCompatNonStreamingResponse({
      content: [
        { type: 'thinking', thinking: 'inspect first', signature: 'signed-thinking' },
        { type: 'redacted_thinking', data: 'opaque-redacted' },
        { type: 'tool_use', id: 'toolu_one', name: 'read_file', input: { path: 'a.ts' } },
        { type: 'tool_use', id: 'toolu_two', name: 'read_file', input: { path: 'b.ts' } }
      ],
      stop_reason: 'tool_use'
    }, 'messages', {
      normalizeUsage: () => emptyUsageSnapshot(),
      parseToolArguments: (raw) => JSON.parse(raw) as Record<string, unknown>,
      payloadError: () => null
    })

    const calls = chunks.filter((chunk) => chunk.kind === 'tool_call_complete')
    expect(calls[0]).toMatchObject({
      kind: 'tool_call_complete',
      providerMetadata: {
        anthropic: {
          thinkingBlocks: [
            { type: 'thinking', thinking: 'inspect first', signature: 'signed-thinking' },
            { type: 'redacted_thinking', data: 'opaque-redacted' }
          ]
        }
      }
    })
    expect(calls[1]).not.toHaveProperty('providerMetadata')
  })

  it('turns an unrepaired provider 4xx into one terminal error without replaying the request', async () => {
    const calls: CapturedCall[] = []
    const fetchImpl = (async (url: string, init: { body: string }) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) as Record<string, unknown> })
      return new Response(JSON.stringify({
        error: { type: 'invalid_request_error', message: 'unsupported model parameter' }
      }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    }) as unknown as typeof fetch
    const client = new CompatModelClient({
      baseUrl: 'https://provider.example/v1', apiKey: 'test-key', model: 'new-model',
      endpointFormat: 'messages', fetchImpl, retry: { maxAttempts: 3 },
      modelCapabilities: () => capabilities('messages')
    })

    const chunks = await drain(client.stream(switchedRequest(true)))
    expect(calls).toHaveLength(1)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ kind: 'error', code: 'http_400' })
  })

  it('attributes provider, cache writes, billing, and service tier at the request boundary', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        cache_creation_input_tokens: 10
      }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch
    const client = new CompatModelClient({
      providerId: 'codex-work',
      baseUrl: 'https://proxy.example/v1',
      apiKey: 'test-key',
      model: 'gpt-5.6-sol',
      endpointFormat: 'chat_completions',
      nonStreaming: true,
      fetchImpl,
      billingKind: 'subscription'
    })
    const request = {
      ...switchedRequest(false),
      model: 'gpt-5.6-sol',
      serviceTier: 'priority' as const
    }
    const priority = await drain(client.stream(request))
    const priorityUsage = priority.find((chunk) => chunk.kind === 'usage')

    expect(priorityUsage).toMatchObject({
      kind: 'usage',
      usage: {
        actualProviderId: 'codex-work',
        actualModelId: 'gpt-5.6-sol',
        billingKind: 'subscription',
        serviceTier: 'priority',
        cacheWriteTokens: 10
      }
    })

    const standard = await drain(client.stream({ ...request, turnId: 'turn-standard', serviceTier: undefined }))
    const standardUsage = standard.find((chunk) => chunk.kind === 'usage')
    expect(standardUsage?.kind === 'usage' ? standardUsage.usage.serviceTier : 'missing').toBeUndefined()
  })

  it('attributes usage when debug recording exists but capture is disabled', async () => {
    const client = new CompatModelClient({
      providerId: 'codex-personal',
      baseUrl: 'https://proxy.example/v1',
      apiKey: 'test-key',
      model: 'gpt-5.6-terra',
      endpointFormat: 'chat_completions',
      nonStreaming: true,
      fetchImpl: (async () => new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        usage: { prompt_tokens: 80, completion_tokens: 10, total_tokens: 90 }
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
      billingKind: 'subscription',
      debugSink: new LlmDebugRecorder({ shouldCapture: () => false })
    })
    const chunks = await drain(client.stream({
      ...switchedRequest(false),
      model: 'gpt-5.6-terra',
      serviceTier: 'priority'
    }))
    const usage = chunks.find((chunk) => chunk.kind === 'usage')

    expect(usage).toMatchObject({
      kind: 'usage',
      usage: {
        actualProviderId: 'codex-personal',
        billingKind: 'subscription',
        serviceTier: 'priority'
      }
    })
  })
})

function capabilities(endpointFormat: ModelEndpointFormat): ModelCapabilityMetadata {
  const requestProtocol = endpointFormat === 'messages'
    ? 'anthropic-thinking' as const
    : endpointFormat === 'responses'
      ? 'openai-responses' as const
      : 'openai-chat-completions' as const
  return {
    id: 'new-model',
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text'],
    endpointFormat,
    reasoning: {
      supportedEfforts: ['off', 'high'],
      defaultEffort: 'high',
      requestProtocol
    }
  }
}

function switchedRequest(thinking: boolean): ModelRequest {
  const threadId = 'thread-switch'
  const oldTurnId = 'turn-old'
  const turnId = 'turn-new'
  const callId = 'call-old'
  return {
    threadId,
    turnId,
    model: 'new-model',
    providerId: 'provider-b',
    reasoningEffort: thinking ? 'high' : 'off',
    prefix: [],
    history: [
      makeUserItem({ id: 'user-old', threadId, turnId: oldTurnId, text: 'Read a.ts' }),
      makeAssistantReasoningItem({
        id: 'reason-old', threadId, turnId: oldTurnId, text: 'private old reasoning', status: 'completed'
      }),
      makeAssistantTextItem({
        id: 'text-old', threadId, turnId: oldTurnId, text: 'I will inspect it.', status: 'completed'
      }),
      makeToolCallItem({
        id: 'call-old', threadId, turnId: oldTurnId, callId, toolName: 'read_file',
        arguments: { path: 'a.ts' }, status: 'completed',
        providerMetadata: {
          gemini: { thoughtSignature: 'gemini-signature-from-old-route' },
          anthropic: {
            thinkingBlocks: [{
              type: 'thinking',
              thinking: 'private old reasoning',
              signature: 'anthropic-signature-from-old-route'
            }]
          }
        }
      }),
      makeToolResultItem({
        id: 'result-old', threadId, turnId: oldTurnId, callId, toolName: 'read_file',
        output: 'old contents', status: 'completed'
      }),
      makeAssistantTextItem({
        id: 'answer-old', threadId, turnId: oldTurnId, text: 'The file is valid.', status: 'completed'
      }),
      makeUserItem({ id: 'user-new', threadId, turnId, text: 'Continue with the new model' })
    ],
    tools: [TOOL],
    abortSignal: new AbortController().signal
  }
}

function captureJsonFetch(calls: CapturedCall[], endpointFormat: ModelEndpointFormat): typeof fetch {
  return (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) as Record<string, unknown> })
    const response = endpointFormat === 'messages'
      ? { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }
      : endpointFormat === 'responses'
        ? {
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }]
          }
        : { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as unknown as typeof fetch
}

function assertToolPair(endpointFormat: ModelEndpointFormat, body: Record<string, unknown>): void {
  if (endpointFormat === 'chat_completions') {
    const messages = body.messages as Array<Record<string, unknown>>
    expect(messages.some((message) => Array.isArray(message.tool_calls))).toBe(true)
    expect(messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call-old')).toBe(true)
    return
  }
  if (endpointFormat === 'responses') {
    const input = body.input as Array<Record<string, unknown>>
    expect(input.some((item) => item.type === 'function_call' && item.call_id === 'call-old')).toBe(true)
    expect(input.some((item) => item.type === 'function_call_output' && item.call_id === 'call-old')).toBe(true)
    return
  }
  const messages = body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>
  expect(messages.some((message) =>
    message.role === 'assistant' && message.content.some((block) => block.type === 'tool_use' && block.id === 'call-old')
  )).toBe(true)
  expect(messages.some((message) =>
    message.role === 'user' && message.content.some((block) => block.type === 'tool_result' && block.tool_use_id === 'call-old')
  )).toBe(true)
}

function messagesToolStream(): string {
  return [
    { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'inspect first' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed-thinking' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'opaque-redacted' } },
    { type: 'content_block_stop', index: 1 },
    {
      type: 'content_block_start', index: 2,
      content_block: { type: 'tool_use', id: 'toolu_active', name: 'read_file', input: {} }
    },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":"a.ts"}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } },
    { type: 'message_stop' }
  ].map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join('')
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}
