import { describe, expect, it } from 'vitest'

import {
  CompatModelClient
} from '../../src/adapters/model/compat-model-client.js'

import {
  createCompatRequestCodecs
} from '../../src/adapters/model/compat-request-builder.js'

import {
  COMPAT_RESPONSES_REASONING,
  type CompatChatMessage
} from '../../src/adapters/model/compat-request-codecs.js'

import type { ModelRequest, ModelStreamChunk } from '../../src/ports/model-client.js'

import {
  makeAssistantTextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserItem
} from '../../src/domain/item.js'

type CapturedCall = { url: string; body: Record<string, unknown> }

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
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

function captureFetch(
  calls: CapturedCall[],
  respond: (attempt: number) => Response
): typeof fetch {
  return (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) as Record<string, unknown> })
    return respond(calls.length)
  }) as unknown as typeof fetch
}

function responsesClient(
  fetchImpl: typeof fetch,
  baseUrl = 'https://provider.example/v1/responses',
  endpointFormat: 'responses' | 'custom_endpoint' = 'responses'
): CompatModelClient {
  return new CompatModelClient({
    baseUrl,
    apiKey: 'sk-test',
    model: 'test-model',
    endpointFormat,
    retry: { initialDelayMs: 0 },
    fetchImpl
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
    (chunk): chunk is Extract<ModelStreamChunk, { kind: 'tool_call_complete' }> =>
      chunk.kind === 'tool_call_complete'
  )
}

function completedMessage(text: string): Record<string, unknown> {
  return {
    id: 'msg_1',
    type: 'message',
    content: [{ type: 'output_text', text }]
  }
}

describe('CompatModelClient Responses reasoning round-trip', () => {

it('attaches a completed reasoning item to the following tool call', async () => {
    const reasoning = {
      id: 'rs_1',
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'Thinking.' }],
      encrypted_content: 'enc_blob'
    }
    const call = {
      id: 'call_1',
      call_id: 'call_1',
      type: 'function_call',
      name: 'edit',
      arguments: '{"path":"a.txt"}'
    }
    const chunks = await drain(responsesClient((async () => sseResponse([
      frame({ type: 'response.output_item.done', output_index: 0, item: reasoning }),
      frame({ type: 'response.output_item.done', output_index: 1, item: call }),
      frame({ type: 'response.completed', response: { status: 'completed', output: [reasoning, call] } }),
      'data: [DONE]\n\n'
    ])) as unknown as typeof fetch).stream(request()))

    const calls = toolCallCompletes(chunks)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.providerMetadata).toEqual({
      responses: {
        reasoningItems: [{
          type: 'reasoning',
          id: 'rs_1',
          summary: [{ type: 'summary_text', text: 'Thinking.' }],
          encrypted_content: 'enc_blob'
        }]
      }
    })
  })

it('attaches reasoning items materialized only by response.completed', async () => {
    const reasoning = { id: 'rs_9', type: 'reasoning', encrypted_content: 'enc_late' }
    const call = {
      id: 'call_9',
      call_id: 'call_9',
      type: 'function_call',
      name: 'edit',
      arguments: '{}'
    }
    const chunks = await drain(responsesClient((async () => sseResponse([
      frame({ type: 'response.completed', response: { status: 'completed', output: [reasoning, call] } }),
      'data: [DONE]\n\n'
    ])) as unknown as typeof fetch).stream(request()))

    expect(toolCallCompletes(chunks)[0]?.providerMetadata).toEqual({
      responses: { reasoningItems: [{ type: 'reasoning', id: 'rs_9', encrypted_content: 'enc_late' }] }
    })
  })

it('replays stored reasoning items immediately ahead of their function_call', () => {
    const codecs = createCompatRequestCodecs()
    const reasoningItem = { type: 'reasoning', id: 'rs_1', encrypted_content: 'enc' }
    const messages: CompatChatMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'edit', arguments: '{"path":"a.txt"}' },
          [COMPAT_RESPONSES_REASONING]: [reasoningItem]
        }]
      },
      { role: 'tool', content: 'done', tool_call_id: 'call_1' }
    ]
    const body = codecs.build({
      request: request(),
      model: 'test-model',
      messages,
      tools: [],
      stream: true,
      endpointFormat: 'responses',
      baseUrl: 'https://provider.example/v1/responses',
      isCodex: false,
      isCodexLite: false,
      codexNativeImageGeneration: false
    })
    const input = body.input as Array<Record<string, unknown>>
    const callIndex = input.findIndex((item) => item.type === 'function_call')
    expect(callIndex).toBeGreaterThan(0)
    expect(input[callIndex - 1]).toEqual(reasoningItem)
    expect(input.some((item) => item.type === 'function_call_output')).toBe(true)
  })

it('requests encrypted reasoning content on every Codex request', () => {
    const codecs = createCompatRequestCodecs()
    const body = codecs.build({
      request: request(),
      model: 'gpt-5.6-luna',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      stream: true,
      endpointFormat: 'responses',
      baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
      isCodex: true,
      isCodexLite: false,
      codexNativeImageGeneration: false
    })
    expect(body.include).toEqual(['reasoning.encrypted_content'])
  })

it('forces streamed requests against the Codex Responses endpoint', async () => {
    const calls: CapturedCall[] = []
    const client = responsesClient(
      captureFetch(calls, () => sseResponse([
        frame({
          type: 'response.completed',
          response: { status: 'completed', output: [completedMessage('ok')] }
        }),
        'data: [DONE]\n\n'
      ])),
      'https://chatgpt.com/backend-api/codex/responses',
      'custom_endpoint'
    )
    const chunks = await drain(client.stream(request({ stream: false, model: 'gpt-5.6-luna' })))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body.stream).toBe(true)
    expect(chunks.at(-1)).toMatchObject({ kind: 'completed' })
  })

it('retries a rejected non-streaming request as a stream', async () => {
    const calls: CapturedCall[] = []
    const client = responsesClient(captureFetch(calls, (attempt) =>
      attempt === 1
        ? Response.json({ detail: 'Stream must be set to true' }, { status: 400 })
        : sseResponse([
            frame({
              type: 'response.completed',
              response: { status: 'completed', output: [completedMessage('ok')] }
            }),
            'data: [DONE]\n\n'
          ])
    ))
    const chunks = await drain(client.stream(request({ stream: false })))
    expect(calls).toHaveLength(2)
    expect(calls[0]?.body.stream).toBe(false)
    expect(calls[1]?.body.stream).toBe(true)
    expect(chunks.at(-1)).toMatchObject({ kind: 'completed' })
  })

it('drops tool rounds without replayable reasoning on a reasoning-required 400', async () => {
    const calls: CapturedCall[] = []
    const client = responsesClient(captureFetch(calls, (attempt) =>
      attempt === 1
        ? Response.json({
            error: {
              message:
                "Item 'call_old' of type 'function_call' was provided without its required 'reasoning' item"
            }
          }, { status: 400 })
        : sseResponse([
            frame({
              type: 'response.completed',
              response: { status: 'completed', output: [completedMessage('ok')] }
            }),
            'data: [DONE]\n\n'
          ])
    ))
    const history = [
      makeUserItem({ id: 'u0', turnId: 't0', threadId: 't1', text: 'first' }),
      makeToolCallItem({
        id: 'tc_old', turnId: 't0', threadId: 't1',
        callId: 'call_old', toolName: 'edit', arguments: { path: 'a.txt' },
        status: 'completed'
      }),
      makeToolResultItem({
        id: 'tr_old', turnId: 't0', threadId: 't1',
        callId: 'call_old', toolName: 'edit', output: 'done'
      }),
      makeToolCallItem({
        id: 'tc_new', turnId: 't1', threadId: 't1',
        callId: 'call_new', toolName: 'edit', arguments: { path: 'b.txt' },
        status: 'completed',
        providerMetadata: {
          responses: {
            reasoningItems: [{ type: 'reasoning', id: 'rs_2', encrypted_content: 'enc' }]
          }
        }
      }),
      makeToolResultItem({
        id: 'tr_new', turnId: 't1', threadId: 't1',
        callId: 'call_new', toolName: 'edit', output: 'done again'
      })
    ]
    const chunks = await drain(client.stream(request({ history })))
    expect(calls).toHaveLength(2)
    const retriedInput = calls[1]?.body.input as Array<Record<string, unknown>>
    const functionCalls = retriedInput.filter((item) => item.type === 'function_call')
    expect(functionCalls.map((item) => item.call_id)).toEqual(['call_new'])
    expect(
      retriedInput.some((item) => item.type === 'function_call_output' && item.call_id === 'call_old')
    ).toBe(false)
    expect(retriedInput.some((item) => item.type === 'reasoning' && item.id === 'rs_2')).toBe(true)
    expect(chunks.at(-1)).toMatchObject({ kind: 'completed' })
  })

it('rebuilds chat-completions history with reasoning_content after a thinking-mode 400', async () => {
    const calls: CapturedCall[] = []
    const client = new CompatModelClient({
      baseUrl: 'https://provider.example/v1/chat/completions',
      apiKey: 'sk-test',
      model: 'thinking-model',
      endpointFormat: 'chat_completions',
      retry: { initialDelayMs: 0 },
      fetchImpl: captureFetch(calls, (attempt) =>
        attempt === 1
          ? Response.json({
              error: { message: 'The reasoning_content in the thinking mode must be passed back' }
            }, { status: 400 })
          : sseResponse([
              frame({ choices: [{ index: 0, delta: { content: 'ok' } }] }),
              frame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
              'data: [DONE]\n\n'
            ])
      )
    })
    const history = [
      makeUserItem({ id: 'u0', turnId: 't0', threadId: 't1', text: 'first' }),
      makeAssistantTextItem({ id: 'a0', turnId: 't0', threadId: 't1', text: 'answer' })
    ]
    const chunks = await drain(client.stream(request({ history })))
    expect(calls).toHaveLength(2)
    const firstMessages = calls[0]?.body.messages as Array<Record<string, unknown>>
    const retriedMessages = calls[1]?.body.messages as Array<Record<string, unknown>>
    expect(firstMessages.some((message) => typeof message.reasoning_content === 'string')).toBe(false)
    expect(
      retriedMessages.some(
        (message) => message.role === 'assistant' && typeof message.reasoning_content === 'string'
      )
    ).toBe(true)
    expect(chunks.at(-1)).toMatchObject({ kind: 'completed' })
  })
})
