import { describe, expect, it, vi } from 'vitest'

import {
  CompatModelClient,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS
} from '../../src/adapters/model/compat-model-client.js'

import {
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeCompactionItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserItem
} from '../../src/domain/item.js'

import type { ModelRequest, ModelStreamChunk } from '../../src/ports/model-client.js'

function buildRequest(abortSignal: AbortSignal): ModelRequest {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    model: 'deepseek-chat',
    systemPrompt: 'You are a helpful assistant.',
    prefix: [],
    history: [],
    tools: [
      {
        name: 'echo',
        description: 'Echo a string back to the model.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text']
        }
      }
    ],
    abortSignal
  }
}

const READ_IMAGE_BASE64 = 'aW1hZ2UtYnl0ZXM='

function readImageToolRequest(model: string): ModelRequest {
  const request = buildRequest(new AbortController().signal)
  request.model = model
  request.tools = [{
    name: 'read',
    description: 'Read a file from the workspace.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  }]
  request.history = [
    makeToolCallItem({
      id: 'item_call_read',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_read',
      toolName: 'read',
      arguments: { path: 'img/diagram.png' },
      status: 'completed'
    }),
    makeToolResultItem({
      id: 'item_result_read',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_read',
      toolName: 'read',
      output: {
        path: '/workspace/img/diagram.png',
        relative_path: 'img/diagram.png',
        kind: 'image',
        mime_type: 'image/png',
        width: 16,
        height: 8,
        byte_size: 11,
        data_base64: READ_IMAGE_BASE64,
        note: 'Read image file [image/png]'
      }
    })
  ]
  return request
}

function collectKinds(chunks: ModelStreamChunk[]): string[] {
  return chunks.map((chunk) => chunk.kind)
}

function sseStream(payloads: Array<Record<string, unknown> | '[DONE]'>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(`data: ${payload === '[DONE]' ? payload : JSON.stringify(payload)}\n\n`))
      }
      controller.close()
    }
  })
}

describe('CompatModelClient', () => {

it('uses the current 7.5 minute stream idle timeout by default', () => {
    expect(DEFAULT_STREAM_IDLE_TIMEOUT_MS).toBe(450_000)
  })

it('uses request.model over client default model', async () => {
    const response = {
      id: 'r2',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'done'
          }
        }
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2
      }
    }
    const sentBodies: Array<{ model?: string }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new CompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-pro'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    expect(sentBodies[0]?.model).toBe('deepseek-v4-pro')
  })

it('builds chat completions URLs for base URLs with and without version segments', async () => {
    const cases = [
      ['https://zenmux.ai/api', 'https://zenmux.ai/api/v1/chat/completions'],
      ['https://zenmux.ai/api/v1', 'https://zenmux.ai/api/v1/chat/completions'],
      ['https://zenmux.ai/api/v1/', 'https://zenmux.ai/api/v1/chat/completions'],
      ['https://zenmux.ai/api/v2', 'https://zenmux.ai/api/v2/chat/completions'],
      ['https://api.deepseek.com/beta', 'https://api.deepseek.com/v1/chat/completions'],
      ['https://api.deepseek.com', 'https://api.deepseek.com/v1/chat/completions']
    ]

    for (const [baseUrl, expectedUrl] of cases) {
      const sentUrls: string[] = []
      const fetchImpl: typeof fetch = async (url) => {
        sentUrls.push(String(url))
        return new Response(JSON.stringify({
          id: 'url',
          model: 'deepseek-chat',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      const client = new CompatModelClient({
        baseUrl,
        apiKey: 'k',
        model: 'deepseek-chat',
        fetchImpl,
        nonStreaming: true
      })

      for await (const _chunk of client.stream(buildRequest(new AbortController().signal))) {
        // drain
      }

      expect(sentUrls[0]).toBe(expectedUrl)
    }
  })

it('uses the Responses API format when selected', async () => {
    const sentUrls: string[] = []
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      sentUrls.push(String(url))
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify({
        id: 'resp_1',
        status: 'completed',
        output_text: 'done',
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new CompatModelClient({
      baseUrl: 'https://example.com/api/v1',
      apiKey: 'k',
      model: 'gpt-5-mini',
      endpointFormat: 'responses',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.maxTokens = 128
    request.responseFormat = 'json_object'
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    expect(sentUrls[0]).toBe('https://example.com/api/v1/responses')
    expect(sentBodies[0]).toMatchObject({
      model: 'deepseek-chat',
      max_output_tokens: 128,
      text: { format: { type: 'json_object' } }
    })
    expect(sentBodies[0]?.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'system', content: 'You are a helpful assistant.' })
    ]))
    expect(sentBodies[0]?.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'echo',
        parameters: expect.objectContaining({ type: 'object' })
      })
    ])
    expect(chunks).toEqual([
      { kind: 'assistant_text_delta', text: 'done' },
      expect.objectContaining({ kind: 'usage', usage: expect.objectContaining({ promptTokens: 2, completionTokens: 3 }) }),
      { kind: 'completed', stopReason: 'stop' }
    ])
  })

it('sends Codex subscription reasoning max as xhigh with summaries enabled', async () => {
    const sentUrls: string[] = []
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      sentUrls.push(String(url))
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify({
        id: 'resp_codex',
        status: 'completed',
        output_text: 'done'
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new CompatModelClient({
      baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
      apiKey: 'codex-access',
      model: 'gpt-5.5',
      endpointFormat: 'custom_endpoint',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'gpt-5.5'
    request.reasoningEffort = 'max'
    for await (const _chunk of client.stream(request)) {
      // drain
    }

    expect(sentUrls[0]).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(sentBodies[0]).toMatchObject({
      model: 'gpt-5.5',
      stream: true,
      instructions: ' ',
      input: [{
        role: 'system',
        content: 'You are a helpful assistant.'
      }],
      store: false,
      reasoning: { effort: 'xhigh', summary: 'auto' },
      include: ['reasoning.encrypted_content']
    })
    expect(sentBodies[0]).not.toHaveProperty('messages')
    expect(sentBodies[0]?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_generation' })
    ]))
  })

it('does not add Codex native image generation for gpt-5.3-codex-spark', async () => {
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify({
        id: 'resp_codex_spark',
        status: 'completed',
        output_text: 'done'
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new CompatModelClient({
      baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
      apiKey: 'codex-access',
      model: 'gpt-5.3-codex-spark',
      endpointFormat: 'custom_endpoint',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'gpt-5.3-codex-spark'
    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const tools = sentBodies[0]?.tools as Array<Record<string, unknown>> | undefined
    expect(tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'echo'
      })
    ])
    expect(tools?.some((tool) => tool.type === 'image_generation')).toBe(false)
  })

it('injects read-tool images as chat completions image parts for vision models', async () => {
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify({
        id: 'cmpl_read_image',
        model: 'vision-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new CompatModelClient({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'vision-model',
      endpointFormat: 'chat_completions',
      fetchImpl,
      nonStreaming: true,
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text', 'image_url']
      })
    })

    for await (const _chunk of client.stream(readImageToolRequest('vision-model'))) {
      // drain
    }

    const messages = sentBodies[0]?.messages as Array<{ role: string; content: unknown }> | undefined
    const toolMessage = messages?.find((message) => message.role === 'tool')
    const imageMessage = messages?.find((message) =>
      message.role === 'user' && Array.isArray(message.content)
    )

    expect(String(toolMessage?.content ?? '')).toContain('"kind":"image"')
    expect(String(toolMessage?.content ?? '')).not.toContain(READ_IMAGE_BASE64)
    expect(imageMessage?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('tool call(s) above returned the following image') }),
      { type: 'image_url', image_url: { url: `data:image/png;base64,${READ_IMAGE_BASE64}` } }
    ])
  })

it('keeps read-tool image results as text for text-only models', async () => {
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify({
        id: 'cmpl_text_read_image',
        model: 'text-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new CompatModelClient({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'text-model',
      endpointFormat: 'chat_completions',
      fetchImpl,
      nonStreaming: true,
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text']
      })
    })

    for await (const _chunk of client.stream(readImageToolRequest('text-model'))) {
      // drain
    }

    const messages = sentBodies[0]?.messages as Array<{ role: string; content: unknown }> | undefined
    expect(messages?.some((message) => Array.isArray(message.content))).toBe(false)
    const toolContent = String(messages?.find((message) => message.role === 'tool')?.content ?? '')
    expect(toolContent).toContain('"kind":"image"')
    expect(toolContent).not.toContain(READ_IMAGE_BASE64)
  })

it('injects read-tool images as Responses API input_image parts for vision models', async () => {
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify({
        id: 'resp_read_image',
        status: 'completed',
        output_text: 'ok'
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new CompatModelClient({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'vision-model',
      endpointFormat: 'responses',
      fetchImpl,
      nonStreaming: true,
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text', 'input_image']
      })
    })

    for await (const _chunk of client.stream(readImageToolRequest('vision-model'))) {
      // drain
    }

    const input = sentBodies[0]?.input as Array<Record<string, unknown>> | undefined
    expect(input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_read',
        output: expect.stringContaining('"kind":"image"')
      })
    ]))
    expect(String(input?.find((item) => item.type === 'function_call_output')?.output ?? '')).not.toContain(READ_IMAGE_BASE64)
    expect(input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.arrayContaining([
          { type: 'input_image', image_url: `data:image/png;base64,${READ_IMAGE_BASE64}` }
        ])
      })
    ]))
  })

it('injects read-tool images as Anthropic image blocks for vision models', async () => {
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify({
        id: 'msg_read_image',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn'
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new CompatModelClient({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'vision-model',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true,
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text', 'image_url']
      })
    })

    for await (const _chunk of client.stream(readImageToolRequest('vision-model'))) {
      // drain
    }

    const messages = sentBodies[0]?.messages as Array<{ role: string; content: Array<Record<string, unknown>> }> | undefined
    const userMessage = messages?.find((message) => message.role === 'user')
    expect(userMessage?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool_result',
        tool_use_id: 'call_read',
        content: expect.stringContaining('"kind":"image"')
      }),
      expect.objectContaining({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: READ_IMAGE_BASE64
        }
      })
    ]))
    const toolResult = userMessage?.content.find((part) => part.type === 'tool_result')
    expect(String(toolResult?.content ?? '')).not.toContain(READ_IMAGE_BASE64)
  })

it('maps Responses API cached input token details into cache telemetry', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({
        id: 'resp_cache',
        status: 'completed',
        output_text: 'cached',
        usage: {
          input_tokens: 400,
          output_tokens: 20,
          total_tokens: 420,
          input_tokens_details: { cached_tokens: 300 }
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    const client = new CompatModelClient({
      baseUrl: 'https://example.com/api/v1',
      apiKey: 'k',
      model: 'gpt-5-mini',
      endpointFormat: 'responses',
      fetchImpl,
      nonStreaming: true
    })

    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    const usageChunk = chunks.find((chunk) => chunk.kind === 'usage')
    const usage = usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage : null
    expect(usage).not.toBeNull()
    expect(usage).toMatchObject({
      promptTokens: 400,
      completionTokens: 20,
      totalTokens: 420,
      cachedTokens: 300,
      cacheHitTokens: 300,
      cacheMissTokens: 100
    })
    expect(usage?.cacheHitRate).toBeCloseTo(0.75)
  })

it('uses the Anthropic Messages API format when selected', async () => {
    const sentUrls: string[] = []
    const sentBodies: Array<Record<string, unknown>> = []
    const sentHeaders: Array<Record<string, string>> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      sentUrls.push(String(url))
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      sentHeaders.push(init?.headers as Record<string, string>)
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new CompatModelClient({
      baseUrl: 'https://claude.example',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-5',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    expect(sentUrls[0]).toBe('https://claude.example/v1/messages')
    expect(sentHeaders[0]).toMatchObject({
      Authorization: 'Bearer anthropic-key',
      'x-api-key': 'anthropic-key',
      'anthropic-version': '2023-06-01'
    })
    expect(sentBodies[0]).toMatchObject({
      model: 'deepseek-chat',
      // Non-reasoning messages default (raised from 4096 so reasoning models
      // don't truncate their tool calls; this model has no reasoning metadata).
      max_tokens: 8192,
      system: [{
        type: 'text',
        text: 'You are a helpful assistant.',
        cache_control: { type: 'ephemeral' }
      }],
      messages: [],
      tools: [{
        name: 'echo',
        description: 'Echo a string back to the model.',
        input_schema: expect.objectContaining({ type: 'object' })
      }]
    })
    expect(chunks).toEqual([
      { kind: 'assistant_text_delta', text: 'hello' },
      expect.objectContaining({ kind: 'usage', usage: expect.objectContaining({ promptTokens: 4, completionTokens: 2 }) }),
      { kind: 'completed', stopReason: 'stop' }
    ])
  })

})
