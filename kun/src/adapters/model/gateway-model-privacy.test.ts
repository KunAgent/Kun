import { describe, expect, it, vi } from 'vitest'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { gatewayChatCompletions, gatewayResponses } from '../../server/routes/openai-model-gateway.js'
import { gatewayMessages } from '../../server/routes/anthropic-messages-gateway.js'
import { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import { CompatModelClient } from './compat-model-client.js'

const secret = 'synthetic-provider-secret-for-regression'
function request(gateway: boolean): ModelRequest {
  return { threadId: 'privacy-thread', turnId: 'privacy-turn', model: 'model', prefix: [], history: [],
    systemPrompt: 'private-prompt-marker', tools: [], abortSignal: new AbortController().signal,
    ...(gateway ? { gatewayRouting: { allowedTargets: [{ providerId: 'provider', modelId: 'model' }] } } : {}) }
}
async function drain(stream: AsyncIterable<ModelStreamChunk>) {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
function client(recorder: LlmDebugRecorder, fetchImpl: typeof fetch) {
  return new CompatModelClient({ baseUrl: 'https://offline.example/v1', apiKey: secret, model: 'model',
    endpointFormat: 'chat_completions', nonStreaming: true, debugSink: recorder, fetchImpl,
    retry: { maxAttempts: 0 } })
}

describe('gateway provider privacy', () => {
  it.each([true, false])('bypasses every debug hook only for gateway traffic: %s', async (gateway) => {
    const recorder = new LlmDebugRecorder({ shouldCapture: () => true })
    const start = vi.spyOn(recorder, 'start')
    const capture = vi.spyOn(recorder, 'captureChunk')
    const upstream = client(recorder, (async () => new Response(JSON.stringify({ choices: [{
      finish_reason: 'tool_calls', message: { content: 'private-response-marker', tool_calls: [{
        id: 'call', type: 'function', function: { name: 'read', arguments: '{"value":"private-argument-marker"}' }
      }] }
    }] }), { headers: { 'content-type': 'application/json' } })) as typeof fetch)
    const result = await drain(upstream.stream(request(gateway)))
    expect(result.some((chunk) => chunk.kind === 'assistant_text_delta')).toBe(true)
    if (gateway) {
      expect(start).not.toHaveBeenCalled()
      expect(capture).not.toHaveBeenCalled()
      expect(recorder.snapshot()).toEqual([])
    } else {
      expect(start).toHaveBeenCalledOnce()
      const retained = JSON.stringify(recorder.snapshot())
      expect(retained).toContain('private-prompt-marker')
      expect(retained).toContain('private-response-marker')
      expect(retained).toContain('private-argument-marker')
    }
  })

  it.each([false, true])('never forwards or logs a provider-echoed credential (stream=%s)', async (stream) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      for (const [handler, shape] of [[gatewayChatCompletions, 'chat'], [gatewayResponses, 'responses'], [gatewayMessages, 'messages']] as const) {
        const recorder = new LlmDebugRecorder({ shouldCapture: () => true })
        const runtime = {
          modelGateway: { enabled: () => true, exposeProviderModels: () => true, pools: () => [],
            credentials: { verify: (key: string) => key === 'public-client-key' } },
          modelConnections: { snapshot: async () => ({ providers: [{ id: 'provider', kind: 'http', authType: 'api-key',
            configured: true, credentialStatus: 'ready', selectedModel: 'model', models: ['model'] }], failover: [] }) },
          modelClient: client(recorder, (async () => new Response(JSON.stringify({ error: {
            message: `Invalid credential ${secret}`, code: secret
          } }), { status: 401 })) as typeof fetch)
        } as unknown as ServerRuntime
        const response = await handler(runtime, new Request('http://127.0.0.1/v1/test', {
          method: 'POST', headers: { authorization: 'Bearer public-client-key' },
          body: JSON.stringify({ model: 'provider/model', stream, ...(shape === 'responses' ? { input: 'hello' }
            : { messages: [{ role: 'user', content: 'hello' }], max_tokens: 32 }) })
        }))
        const body = response instanceof Response ? await response.text() : response.body
        expect(body).not.toContain(secret)
        expect(body).toContain('401')
        expect(JSON.stringify(recorder.snapshot())).not.toContain(secret)
      }
      expect(JSON.stringify(warn.mock.calls)).not.toContain(secret)
    } finally { warn.mockRestore() }
  })

  it.each(['transport', 'sse'])('sanitizes %s error diagnostics before routing or persistence', async (kind) => {
    const recorder = new LlmDebugRecorder({ shouldCapture: () => true })
    const upstream = new CompatModelClient({ baseUrl: 'https://offline.example/v1', apiKey: secret,
      model: 'model', debugSink: recorder, retry: { maxAttempts: 0 }, fetchImpl: (async () => {
        if (kind === 'transport') throw new Error(`connection failed ${secret}`)
        return new Response(`data: ${JSON.stringify({ error: { message: secret, code: secret } })}\n\n`, {
          headers: { 'content-type': 'text/event-stream' }
        })
      }) as typeof fetch })
    const chunks = await drain(upstream.stream(request(true)))
    expect(chunks.some((chunk) => chunk.kind === 'error')).toBe(true)
    expect(JSON.stringify(chunks)).not.toContain(secret)
    expect(recorder.snapshot()).toEqual([])
  })
})
