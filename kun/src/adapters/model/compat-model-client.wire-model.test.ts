import { describe, expect, it, vi } from 'vitest'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { resolveWireModelId } from './compat-capabilities.js'
import { CompatModelClient } from './compat-model-client.js'

const request = (model: string): ModelRequest => ({ threadId: 't', turnId: 'u', model, prefix: [], history: [], tools: [],
  abortSignal: new AbortController().signal })

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const out: ModelStreamChunk[] = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

describe('upstream model names', () => {
  it('substitutes the model id for *', () => {
    expect(resolveWireModelId('vendor/*', 'model-2')).toBe('vendor/model-2')
    expect(resolveWireModelId('fixed-name', 'model-2')).toBe('fixed-name')
  })
  it('sends the upstream name in the body while keeping Kun\'s id everywhere else', async () => {
    let body: Record<string, unknown> = {}
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ id: 'c', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
    }) as unknown as typeof fetch
    const capability = (model: string): ModelCapabilityMetadata => ({ id: model, inputModalities: ['text'], outputModalities: ['text'],
      supportsToolCalling: true, messageParts: ['text'], evidence: {} as never, ...(model === 'model-2' ? { wireModelId: 'relay-ns/*' } : {}) })
    const client = new CompatModelClient({ baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'model-2', endpointFormat: 'chat_completions',
      fetchImpl, modelCapabilities: capability, stream: false } as never)
    await drain(client.stream({ ...request('model-2'), stream: false } as ModelRequest))
    expect(body.model).toBe('relay-ns/model-2')
    await drain(client.stream({ ...request('model-3'), stream: false } as ModelRequest))
    expect(body.model).toBe('model-3')
  })
})
