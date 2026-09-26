import { describe, expect, it, vi } from 'vitest'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { CompatModelClient } from './compat-model-client.js'

function request(): ModelRequest {
  return {
    threadId: 't1',
    turnId: 'u1',
    model: 'claude-test',
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

function messagesOkJson(): Response {
  return Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 }
  })
}

describe('CompatModelClient per-format endpoint overrides', () => {
  it('sends messages-format requests to endpoints.messages instead of baseUrl', async () => {
    const fetchImpl = vi.fn(async () => messagesOkJson()) as unknown as typeof fetch
    const client = new CompatModelClient({
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-test',
      model: 'claude-test',
      endpointFormat: 'messages',
      endpoints: { messages: 'https://relay.example.com/anthropic' },
      nonStreaming: true,
      retry: { initialDelayMs: 0 },
      fetchImpl
    })

    const chunks = await drain(client.stream(request()))

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://relay.example.com/anthropic/v1/messages',
      expect.anything()
    )
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
  })

  it('falls back to baseUrl when the active format has no override', async () => {
    const fetchImpl = vi.fn(async () => messagesOkJson()) as unknown as typeof fetch
    const client = new CompatModelClient({
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-test',
      model: 'claude-test',
      endpointFormat: 'messages',
      endpoints: { chat_completions: 'https://relay.example.com/openai/v1' },
      nonStreaming: true,
      retry: { initialDelayMs: 0 },
      fetchImpl
    })

    await drain(client.stream(request()))

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://relay.example.com/v1/messages',
      expect.anything()
    )
  })

  it('custom_endpoint always uses the raw baseUrl', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      choices: [{ index: 0, finish_reason: 'stop', message: { content: 'ok' } }]
    })) as unknown as typeof fetch
    const client = new CompatModelClient({
      baseUrl: 'https://relay.example.com/full/chat/completions',
      apiKey: 'sk-test',
      model: 'claude-test',
      endpointFormat: 'custom_endpoint',
      endpoints: { chat_completions: 'https://relay.example.com/openai/v1' },
      nonStreaming: true,
      retry: { initialDelayMs: 0 },
      fetchImpl
    })

    await drain(client.stream(request()))

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://relay.example.com/full/chat/completions',
      expect.anything()
    )
  })
})
