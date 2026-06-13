import { describe, expect, it } from 'vitest'
import { DeepseekCompatModelClient } from './deepseek-compat-model-client.js'
import type { ModelRequest } from '../../ports/model-client.js'

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    model: 'glm-5.1',
    prefix: [],
    history: [],
    tools: [],
    stream: false,
    abortSignal: new AbortController().signal,
    ...overrides
  }
}

describe('DeepseekCompatModelClient GLM compatibility', () => {
  it('sends GLM thinking without DeepSeek reasoning_effort', async () => {
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> = {}
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response(JSON.stringify({
        id: 'chatcmpl-1',
        model: 'glm-5.1',
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'ok' }
        }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as typeof fetch

    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'sk-test',
      model: 'glm-5.1',
      nonStreaming: true,
      fetchImpl,
      modelCapabilities: () => ({
        id: 'glm-5.1',
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text'],
        reasoning: {
          supportedEfforts: ['off', 'high', 'max'],
          defaultEffort: 'max',
          requestProtocol: 'glm-chat-completions'
        }
      })
    })

    const chunks = []
    for await (const chunk of client.stream(request({ reasoningEffort: 'max' }))) {
      chunks.push(chunk)
    }

    expect(capturedUrl).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions')
    expect(capturedBody).toMatchObject({
      model: 'glm-5.1',
      stream: false,
      thinking: { type: 'enabled', clear_thinking: true }
    })
    expect(capturedBody).not.toHaveProperty('reasoning_effort')
    expect(chunks).toContainEqual({ kind: 'assistant_text_delta', text: 'ok' })
  })
})
