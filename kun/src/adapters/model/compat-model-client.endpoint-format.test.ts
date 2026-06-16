import { describe, expect, it } from 'vitest'
import { CompatModelClient } from './compat-model-client.js'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

// A single provider (OpenCode Go) routes some models over chat completions
// and others over Anthropic Messages. The wire format is resolved per request
// model from its capability metadata, falling back to the provider format.

type CapturedCall = { url: string; body: Record<string, unknown> }

function modelCapabilities(
  overrides: Record<string, ModelEndpointFormat>
): (model: string) => ModelCapabilityMetadata {
  return (model) => ({
    id: model,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text'],
    ...(overrides[model] ? { endpointFormat: overrides[model] } : {})
  })
}

function fakeFetch(calls: CapturedCall[]): typeof fetch {
  return (async (url: string, init: { body: string }) => {
    const target = String(url)
    calls.push({ url: target, body: JSON.parse(init.body) as Record<string, unknown> })
    const json = target.endsWith('/messages')
      ? { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }
      : { choices: [{ index: 0, finish_reason: 'stop', message: { content: 'ok' } }] }
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as unknown as typeof fetch
}

function request(model: string): ModelRequest {
  return {
    threadId: 't1',
    turnId: 'u1',
    model,
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

describe('CompatModelClient per-model endpointFormat', () => {
  it('routes an override model to the Anthropic Messages endpoint while others use chat completions', async () => {
    const calls: CapturedCall[] = []
    const client = new CompatModelClient({
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKey: 'sk-test',
      model: 'glm-5.1',
      endpointFormat: 'chat_completions',
      nonStreaming: true,
      fetchImpl: fakeFetch(calls),
      modelCapabilities: modelCapabilities({ 'minimax-m3': 'messages' })
    })

    const messagesChunks = await drain(client.stream(request('minimax-m3')))
    const chatChunks = await drain(client.stream(request('glm-5.1')))

    // The override model hits /messages with the Anthropic body shape.
    expect(calls[0].url).toBe('https://opencode.ai/zen/go/v1/messages')
    expect(calls[0].body.max_tokens).toBeDefined()
    expect(calls[0].body).not.toHaveProperty('stream_options')

    // The non-override model inherits the provider format → /chat/completions.
    expect(calls[1].url).toBe('https://opencode.ai/zen/go/v1/chat/completions')
    expect(calls[1].body.messages).toBeDefined()

    // Both responses still materialize cleanly through their respective parsers.
    expect(messagesChunks.some((c) => c.kind === 'assistant_text_delta')).toBe(true)
    expect(messagesChunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
    expect(chatChunks.some((c) => c.kind === 'assistant_text_delta')).toBe(true)
    expect(chatChunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
  })

  it('sets the Anthropic auth + version headers only for the messages-routed model', async () => {
    const headerCalls: Array<Record<string, string>> = []
    const capturingFetch = (async (_url: string, init: { headers: Record<string, string> }) => {
      headerCalls.push(init.headers)
      const target = String(_url)
      const json = target.endsWith('/messages')
        ? { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }
        : { choices: [{ index: 0, finish_reason: 'stop', message: { content: 'ok' } }] }
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as unknown as typeof fetch
    const client = new CompatModelClient({
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKey: 'sk-test',
      model: 'glm-5.1',
      endpointFormat: 'chat_completions',
      nonStreaming: true,
      fetchImpl: capturingFetch,
      modelCapabilities: modelCapabilities({ 'minimax-m3': 'messages' })
    })

    await drain(client.stream(request('minimax-m3')))
    await drain(client.stream(request('glm-5.1')))

    expect(headerCalls[0]['anthropic-version']).toBe('2023-06-01')
    expect(headerCalls[0]['x-api-key']).toBe('sk-test')
    expect(headerCalls[1]['anthropic-version']).toBeUndefined()
    expect(headerCalls[1]['x-api-key']).toBeUndefined()
    expect(headerCalls[1].Authorization).toBe('Bearer sk-test')
  })
})
