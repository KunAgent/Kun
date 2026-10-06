import { describe, expect, it, vi } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import type { ServerRuntime } from './server-runtime.js'
import { gatewayChatCompletions, gatewayResponses, gatewayModels, revealGatewayCredential } from './openai-model-gateway.js'
import { gatewayCountTokens, gatewayMessages } from './anthropic-messages-gateway.js'
import { makeModelRequest, responsesToChatInput } from './model-gateway-core.js'

type Wire = Record<string, any>
class ScriptedModel implements ModelClient {
  provider = 'fixture'
  model = 'fixture'
  last?: ModelRequest
  constructor(private readonly chunks: ModelStreamChunk[] = [{ kind: 'completed', stopReason: 'stop' }]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> { this.last = request; yield* this.chunks }
}
function runtime(modelClient: ModelClient = new ScriptedModel()): ServerRuntime {
  return {
    modelClient,
    modelConnections: { snapshot: async () => ({ providers: [{ id: 'fixture', kind: 'http', authType: 'api-key', configured: true, credentialStatus: 'ready', models: ['upstream'] }] }) },
    modelGateway: {
      enabled: () => true, exposeProviderModels: () => false,
      credentials: { verify: (value: string) => value === 'fixture-key' },
      pools: () => [{ id: 'fixture', modelId: 'local', enabled: true, targets: [{ id: 'target', enabled: true, providerId: 'fixture', modelId: 'upstream' }] }]
    }
  } as unknown as ServerRuntime
}
function request(body: Wire): Request {
  return new Request('http://localhost/v1/fixture', { method: 'POST', headers: { authorization: 'Bearer fixture-key' }, body: JSON.stringify({ model: 'local', ...body }) })
}
function parseBody(response: { body: string } | Response): Wire {
  expect(response).not.toBeInstanceOf(Response)
  return JSON.parse((response as { body: string }).body)
}
function events(text: string): Wire[] {
  return text.split('\n\n').flatMap((frame) => {
    const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
    return data && data !== '[DONE]' ? [JSON.parse(data)] : []
  })
}
const usage: Extract<ModelStreamChunk, { kind: 'usage' }> = { kind: 'usage', usage: {
  promptTokens: 100, completionTokens: 20, totalTokens: 120, cacheHitTokens: 40, cacheWriteTokens: 10,
  reasoningTokens: 3, cacheHitRate: 0.4, turns: 1, actualProviderId: 'private-provider'
} }
const user = [{ role: 'user', content: 'hello' }]

describe('Responses request fidelity', () => {
  it('preserves instructions, typed calls, outputs and assistant output_text history', async () => {
    const model = new ScriptedModel()
    const response = await gatewayResponses(runtime(model), request({
      instructions: 'Follow the exact schema',
      input: [
        { role: 'user', content: 'read' },
        { type: 'function_call', id: 'fc_item', call_id: 'call_1', name: 'read', arguments: '{"path":"/tmp/x"}' },
        { type: 'function_call_output', call_id: 'call_1', output: [{ type: 'input_text', text: 'contents' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'read it' }] },
        { role: 'user', content: 'summarize' }
      ],
      tools: [{ type: 'function', name: 'read', parameters: { type: 'object' }, strict: false }],
      max_output_tokens: 120, temperature: 0.1, top_p: 0.8, parallel_tool_calls: true,
      reasoning: { effort: 'high', summary: 'auto' }, include: ['reasoning.encrypted_content'], store: false
    }))
    expect(response.status).toBe(200)
    expect(model.last).toMatchObject({ systemPrompt: 'Follow the exact schema', maxTokens: 120, temperature: 0.1, topP: 0.8, reasoningEffort: 'high' })
    expect(model.last!.history.map((item) => item.kind)).toEqual(['user_message', 'tool_call', 'tool_result', 'assistant_text', 'user_message'])
    expect(model.last!.history[1]).toMatchObject({ callId: 'call_1', toolName: 'read', arguments: { path: '/tmp/x' } })
    expect(model.last!.history[2]).toMatchObject({ callId: 'call_1', output: 'contents' })
    expect(model.last!.history[3]).toMatchObject({ text: 'read it' })
  })

  it.each([
    { include: ['file_search_call.results'] },
    { input: [{ type: 'reasoning', encrypted_content: 'opaque', summary: [] }] },
    { previous_response_id: 'resp_previous' },
    { conversation: 'conv_previous' },
    { store: true }, { store: 'false' }, { background: {} },
    { background: true },
    { input: [{ type: 'item_reference', id: 'opaque' }] },
    { input: [{ type: 'function_call', call_id: 'a', name: 'f', arguments: '{bad' }] },
    { input: [{ type: 'function_call_output', output: 'missing call id' }] },
    { input: [{ type: 'function_call_output', call_id: 'orphan', output: 'lost context' }] },
    { input: [{ role: 'user', content: [{ type: 'input_file', file_id: 'opaque' }] }] },
    { tools: [{ type: 'web_search_preview' }] },
    { tools: [{ type: 'function', name: 'f', strict: true }] },
    { text: { format: { type: 'json_schema', schema: {} } } }
  ])('rejects unsupported or malformed Responses semantics: %j', async (extra) => {
    const model = new ScriptedModel()
    const response = await gatewayResponses(runtime(model), request({ input: 'hello', ...extra }))
    expect(response.status).toBe(400)
    expect(model.last).toBeUndefined()
    expect(parseBody(response).error.type).toBe('invalid_request_error')
  })

  it('enforces a named tool and supported JSON object output', () => {
    const input = responsesToChatInput({ model: 'local', input: 'hello', text: { format: { type: 'json_object' } },
      tools: [{ type: 'function', name: 'a' }, { type: 'function', name: 'b' }], tool_choice: { type: 'function', name: 'b' } })
    const sent = makeModelRequest(input, new AbortController().signal)
    expect(sent.requiredToolName).toBe('b')
    expect(sent.tools.map((tool) => tool.name)).toEqual(['b'])
    expect(sent.responseFormat).toBe('json_object')
  })

  it('keeps images on their own historical user messages', () => {
    const sent = makeModelRequest({ model: 'local', messages: [
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] },
      { role: 'assistant', content: 'old image' },
      { role: 'user', content: 'new question without image' }
    ] }, new AbortController().signal)
    expect(sent.attachments).toBeUndefined()
    expect(sent.messageAttachments?.gateway_item_0.images).toHaveLength(1)
  })
})

describe('OpenAI wire output', () => {
  it('emits a complete, reconstructible Responses lifecycle with wire-format usage', async () => {
    const response = await gatewayResponses(runtime(new ScriptedModel([
      { kind: 'assistant_text_delta', text: 'Hel' }, { kind: 'assistant_text_delta', text: 'lo' }, usage,
      { kind: 'completed', stopReason: 'stop' }
    ])), request({ input: 'hello', stream: true })) as Response
    const text = await response.text()
    const output = events(text)
    expect(output.map((event) => event.type)).toEqual([
      'response.created', 'response.in_progress', 'response.output_item.added', 'response.content_part.added',
      'response.output_text.delta', 'response.output_text.delta', 'response.output_text.done',
      'response.content_part.done', 'response.output_item.done', 'response.completed'
    ])
    expect(output.map((event) => event.sequence_number)).toEqual(output.map((_, index) => index))
    for (const event of output) expect(text).toContain(`event: ${event.type}\ndata: `)
    const item = output[2].item
    expect(item).toMatchObject({ type: 'message', role: 'assistant', status: 'in_progress', content: [] })
    for (const event of output.slice(3, 8)) expect(event).toMatchObject({ item_id: item.id, output_index: 0, content_index: 0 })
    const terminal = output.at(-1)!.response
    expect(terminal.output).toEqual([expect.objectContaining({ id: item.id, status: 'completed', content: [{ type: 'output_text', text: 'Hello', annotations: [], logprobs: [] }] })])
    expect(terminal.usage).toEqual({ input_tokens: 100, output_tokens: 20, total_tokens: 120,
      input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 3 } })
    expect(text).not.toContain('private-provider')
    expect(text).not.toContain('promptTokens')
  })

  it('keeps parallel Chat tool indexes stable and does not duplicate complete arguments', async () => {
    const response = await gatewayChatCompletions(runtime(new ScriptedModel([
      { kind: 'tool_call_delta', callId: 'first', toolName: 'one', argumentsDelta: '{"x":' },
      { kind: 'tool_call_delta', callId: 'second', toolName: 'two', argumentsDelta: '{"y":2}' },
      { kind: 'tool_call_delta', callId: 'first', argumentsDelta: '1}' },
      { kind: 'tool_call_complete', callId: 'first', toolName: 'one', arguments: { x: 1 } },
      { kind: 'tool_call_complete', callId: 'second', toolName: 'two', arguments: { y: 2 } }, usage,
      { kind: 'completed', stopReason: 'tool_calls' }
    ])), request({ messages: user, stream: true, stream_options: { include_usage: true } })) as Response
    const text = await response.text()
    const output = events(text)
    expect(output[0].choices[0].delta.role).toBe('assistant')
    const calls = new Map<number, Wire>()
    for (const event of output) for (const delta of event.choices[0]?.delta.tool_calls ?? []) {
      const previous = calls.get(delta.index) ?? { arguments: '' }
      calls.set(delta.index, { ...previous, ...(delta.id ? { id: delta.id } : {}),
        ...(delta.function.name ? { name: delta.function.name } : {}), arguments: previous.arguments + (delta.function.arguments ?? '') })
    }
    expect([...calls]).toEqual([[0, { id: 'first', name: 'one', arguments: '{"x":1}' }], [1, { id: 'second', name: 'two', arguments: '{"y":2}' }]])
    expect(output.at(-2)!.choices[0].finish_reason).toBe('tool_calls')
    expect(output.at(-1)!).toMatchObject({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })
    expect(text.endsWith('data: [DONE]\n\n')).toBe(true)
    expect(output.every((event) => typeof event.created === 'number')).toBe(true)
  })

  it('streams complete-only Responses calls with distinct item/call IDs and final output', async () => {
    const response = await gatewayResponses(runtime(new ScriptedModel([
      { kind: 'tool_call_complete', callId: 'call_a', toolName: 'a', arguments: { x: 1 } },
      { kind: 'tool_call_complete', callId: 'call_b', toolName: 'b', arguments: {} },
      { kind: 'completed', stopReason: 'tool_calls' }
    ])), request({ input: 'hello', stream: true })) as Response
    const output = events(await response.text())
    const added = output.filter((event) => event.type === 'response.output_item.added')
    expect(added.map((event) => event.output_index)).toEqual([0, 1])
    expect(added[0].item).toMatchObject({ call_id: 'call_a', type: 'function_call', name: 'a', status: 'in_progress', arguments: '' })
    expect(added[0].item.id).not.toBe('call_a')
    expect(output.at(-1)!.response.output).toEqual([
      expect.objectContaining({ id: added[0].item.id, call_id: 'call_a', status: 'completed', arguments: '{"x":1}' }),
      expect.objectContaining({ id: added[1].item.id, call_id: 'call_b', status: 'completed', arguments: '{}' })
    ])
  })

  it.each([false, true])('reports length truncation rather than success with stream=%s', async (stream) => {
    const script: ModelStreamChunk[] = [{ kind: 'assistant_text_delta', text: 'partial' }, { kind: 'completed', stopReason: 'length' }]
    const chat = await gatewayChatCompletions(runtime(new ScriptedModel(script)), request({ messages: user, stream }))
    const chatBody = stream ? events(await (chat as Response).text()).at(-1)! : parseBody(chat)
    expect(chatBody.choices[0].finish_reason).toBe('length')
    const response = await gatewayResponses(runtime(new ScriptedModel(script)), request({ input: 'hello', stream }))
    const body = stream ? events(await (response as Response).text()).at(-1)!.response : parseBody(response)
    expect(body).toMatchObject({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })
  })

  it('assembles delta-only calls for nonstreaming clients without an empty text item', async () => {
    const response = await gatewayResponses(runtime(new ScriptedModel([
      { kind: 'tool_call_delta', callId: 'a', toolName: 'read', argumentsDelta: '{"p":1}' }, usage,
      { kind: 'completed', stopReason: 'tool_calls' }
    ])), request({ input: 'hello' }))
    expect(parseBody(response).output).toEqual([expect.objectContaining({ type: 'function_call', call_id: 'a', name: 'read', arguments: '{"p":1}', status: 'completed' })])
  })

  it('omits the optional Chat streaming usage event unless requested', async () => {
    const response = await gatewayChatCompletions(runtime(new ScriptedModel([usage, { kind: 'completed', stopReason: 'stop' }])), request({ messages: user, stream: true })) as Response
    expect(events(await response.text()).some((event) => event.usage)).toBe(false)
  })

  it.each<ModelStreamChunk>([
    { kind: 'error', message: 'upstream unavailable' },
    { kind: 'completed', stopReason: 'error' }
  ])('uses a failed Responses terminal on upstream failure: %j', async (chunk) => {
    const response = await gatewayResponses(runtime(new ScriptedModel([chunk])), request({ input: 'hello', stream: true })) as Response
    const output = events(await response.text())
    expect(output.at(-1)!).toMatchObject({ type: 'response.failed', response: { status: 'failed', error: { code: 'upstream_error' } } })
    expect(output.some((event) => event.type === 'response.completed')).toBe(false)
  })
})

describe('Anthropic supported semantics and explicit rejections', () => {
  it('supports the disabled-thinking client profile, top_p, named tools and tool-result errors', async () => {
    const model = new ScriptedModel()
    const response = await gatewayMessages(runtime(model), request({
      thinking: { type: 'disabled' }, output_config: {}, top_p: 0.5,
      tool_choice: { type: 'tool', name: 'read' }, tools: [{ name: 'read', input_schema: { type: 'object' } }],
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'c', name: 'read', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', content: 'no access', is_error: true }] }
      ]
    }))
    expect(response.status).toBe(200)
    expect(model.last).toMatchObject({ reasoningEffort: 'off', topP: 0.5, requiredToolName: 'read' })
    expect(model.last!.history[1]).toMatchObject({ kind: 'tool_result', toolName: 'read', isError: true, output: 'no access' })
  })

  it.each([
    { tool_choice: 'auto' }, { tool_choice: {} }, { tool_choice: { type: 'auto', unknown: true } },
    { output_config: 'invalid' }, { output_config: [] }, { thinking: true }, { stream: 'true' },
    { thinking: { type: 'enabled', budget_tokens: 1024, extra: true } }, { thinking: { type: 'interleaved' } },
    { stop_sequences: ['END'] }, { top_k: 20 }, { output_config: { effort: 'ultra' } }, { output_config: { format: {} } },
    { tool_choice: { type: 'any' } }, { tool_choice: { type: 'auto', disable_parallel_tool_use: 'invalid' } },
    { tools: [{ type: 'web_search_20250305', name: 'web_search' }] },
    { system: [{ type: 'document', source: {} }] },
    { messages: [{ role: 'user', content: [{ type: 'document', source: {} }] }] },
    { messages: [{ role: 'user', content: [{ type: 'thinking', thinking: 'not mine', signature: 'opaque' }] }] },
    { messages: [{ role: 'assistant', content: [{ type: 'server_tool_use', id: 'a', name: 'web_search', input: {} }] }] },
    { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'unknown', content: 'orphan' }] }] },
    { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/x.png' } }] }] }
  ])('rejects unsupported Anthropic semantics before inference: %j', async (extra) => {
    const model = new ScriptedModel()
    const response = await gatewayMessages(runtime(model), request({ messages: user, ...extra }))
    expect(response.status).toBe(400)
    expect(parseBody(response)).toMatchObject({ type: 'error', error: { type: 'invalid_request_error' } })
    expect(model.last).toBeUndefined()
    const count = await gatewayCountTokens(runtime(model), request({ messages: user, ...extra }))
    expect(count.status).toBe(400)
  })

  it.each([
    [{ thinking: { type: 'enabled', budget_tokens: 1024 } }, 'low'],
    [{ thinking: { type: 'enabled', budget_tokens: 20_000 } }, 'high'],
    [{ thinking: { type: 'adaptive' } }, 'auto'],
    [{ thinking: { type: 'adaptive' }, output_config: { effort: 'xhigh' } }, 'max'],
    [{ output_config: { effort: 'medium' } }, 'medium']
  ])('maps Anthropic thinking %j to reasoning effort %s', async (extra, effort) => {
    const model = new ScriptedModel()
    const response = await gatewayMessages(runtime(model), request({ messages: user, ...extra }))
    expect(response.status).toBe(200)
    expect(model.last?.reasoningEffort).toBe(effort)
  })

  it('replays thinking text as reasoning history without forwarding client signatures', async () => {
    const model = new ScriptedModel()
    const response = await gatewayMessages(runtime(model), request({
      thinking: { type: 'adaptive' },
      tools: [{ name: 'read', input_schema: { type: 'object' } }],
      messages: [
        { role: 'user', content: 'read it' },
        { role: 'assistant', content: [
          { type: 'thinking', thinking: 'I should read', signature: 'kungw1.client-held' },
          { type: 'redacted_thinking', data: 'opaque' },
          { type: 'tool_use', id: 'c1', name: 'read', input: {} }
        ] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'ok' }] }
      ]
    }))
    expect(response.status).toBe(200)
    expect(model.last!.history.find((item) => item.kind === 'assistant_reasoning')).toMatchObject({ text: 'I should read' })
    expect(JSON.stringify(model.last!.history)).not.toContain('kungw1.client-held')
    expect(JSON.stringify(model.last!.history)).not.toContain('opaque')
  })

  it('keeps interleaved tool argument streams in independent sequential blocks', async () => {
    const response = await gatewayMessages(runtime(new ScriptedModel([
      { kind: 'tool_call_delta', callId: 'a', toolName: 'one', argumentsDelta: '{"x":' },
      { kind: 'tool_call_delta', callId: 'b', toolName: 'two', argumentsDelta: '{"y":2}' },
      { kind: 'tool_call_delta', callId: 'a', argumentsDelta: '1}' },
      { kind: 'tool_call_complete', callId: 'a', toolName: 'one', arguments: { x: 1 } },
      { kind: 'tool_call_complete', callId: 'b', toolName: 'two', arguments: { y: 2 } }, usage,
      { kind: 'completed', stopReason: 'tool_calls' }
    ])), request({ messages: user, stream: true })) as Response
    const output = events(await response.text())
    const starts = output.filter((event) => event.type === 'content_block_start')
    expect(starts.map((event) => [event.index, event.content_block.id])).toEqual([[0, 'a'], [1, 'b']])
    const args = new Map<number, string>()
    for (const event of output.filter((entry) => entry.type === 'content_block_delta')) args.set(event.index, (args.get(event.index) ?? '') + event.delta.partial_json)
    expect([...args]).toEqual([[0, '{"x":1}'], [1, '{"y":2}']])
    expect(output.filter((event) => event.type === 'content_block_stop').map((event) => event.index)).toEqual([0, 1])
    expect(output.at(-2)!).toMatchObject({ type: 'message_delta', delta: { stop_reason: 'tool_use' },
      usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 } })
  })

  it('reports max_tokens over tool_use when a tool-bearing response is truncated', async () => {
    const response = await gatewayMessages(runtime(new ScriptedModel([
      { kind: 'tool_call_complete', callId: 'a', toolName: 'read', arguments: {} },
      { kind: 'completed', stopReason: 'length' }
    ])), request({ messages: user }))
    expect(parseBody(response).stop_reason).toBe('max_tokens')
  })
})

describe('truncated upstream streams', () => {
  it.each([false, true])('fails closed without a completion marker, stream=%s', async (stream) => {
    const chunks: ModelStreamChunk[] = [{ kind: 'assistant_text_delta', text: 'unfinished' }]
    for (const shape of ['chat', 'responses', 'anthropic'] as const) {
      const handler = shape === 'chat' ? gatewayChatCompletions : shape === 'responses' ? gatewayResponses : gatewayMessages
      const body = shape === 'responses' ? { input: 'hello', stream } : { messages: user, stream }
      const native = await handler(runtime(new ScriptedModel(chunks)), request(body))
      if (!stream) {
        expect(native.status).toBe(502)
        expect(parseBody(native).error.message).toContain('completion marker')
      } else {
        const output = events(await (native as Response).text())
        expect(JSON.stringify(output.at(-1))).toContain('completion marker')
        expect(output.some((event) => event.type === 'message_stop' || event.type === 'response.completed')).toBe(false)
      }
    }
  })
})

describe('uncooperative upstream cancellation', () => {
  const hangingModel: ModelClient = {
    provider: 'fixture', model: 'fixture',
    stream: () => ({ [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<ModelStreamChunk>>(() => undefined),
      return: () => new Promise<IteratorResult<ModelStreamChunk>>(() => undefined)
    }) })
  }
  it('times out even when upstream next and return both ignore abort', async () => {
    vi.useFakeTimers()
    try {
      const pending = gatewayResponses(runtime(hangingModel), request({ input: 'hello' }))
      await vi.advanceTimersByTimeAsync(120_000)
      await expect(pending).resolves.toMatchObject({ status: 504 })
    } finally { vi.useRealTimers() }
  })
  it('cancels and releases a stream slot without waiting for upstream return', async () => {
    const rt = runtime(hangingModel)
    const make = () => gatewayMessages(rt, request({ messages: user, stream: true }))
    const a = await make() as Response
    const b = await make() as Response
    expect((await make()).status).toBe(429)
    await a.body!.cancel()
    const c = await make() as Response
    expect(c).toBeInstanceOf(Response)
    await b.body!.cancel()
    await c.body!.cancel()
  })
})

describe('gateway admission cleanup', () => {
  it.each(['chat', 'responses', 'anthropic'])('releases leases after registry errors on %s', async (shape) => {
    const rt = runtime()
    const original = rt.modelConnections!.snapshot
    rt.modelConnections!.snapshot = async () => { throw new Error('/private/credential-store unavailable') }
    const handler = shape === 'chat' ? gatewayChatCompletions : shape === 'responses' ? gatewayResponses : gatewayMessages
    const body = shape === 'responses' ? { input: 'hello' } : { messages: user }
    for (let index = 0; index < 3; index++) {
      const response = await handler(rt, request(body))
      expect(response.status).toBe(503)
      expect(JSON.stringify(parseBody(response))).not.toContain('/private/')
    }
    rt.modelConnections!.snapshot = original
    expect((await handler(rt, request(body))).status).toBe(200)
  })
})

describe('malformed upstream tool output', () => {
  it.each([false, true])('rejects inconsistent completed arguments with stream=%s', async (stream) => {
    const chunks: ModelStreamChunk[] = [
      { kind: 'tool_call_delta', callId: 'a', toolName: 'read', argumentsDelta: '{"x":1}' },
      { kind: 'tool_call_complete', callId: 'a', toolName: 'read', arguments: { x: 2 } },
      { kind: 'completed', stopReason: 'tool_calls' }
    ]
    for (const handler of [gatewayChatCompletions, gatewayMessages]) {
      const response = await handler(runtime(new ScriptedModel(chunks)), request({ messages: user, stream }))
      if (stream) expect(JSON.stringify(events(await (response as Response).text()).at(-1))).toContain('error')
      else expect(response.status).toBe(502)
    }
  })
})

describe('gateway request persistence controls', () => {
  it.each([{ store: true }, { store: 'false' }, { background: {} }, { background: true }])('rejects Chat persistence controls: %j', async (extra) => {
    const model = new ScriptedModel()
    const response = await gatewayChatCompletions(runtime(model), request({ messages: user, ...extra }))
    expect(response.status).toBe(400)
    expect(model.last).toBeUndefined()
  })
})

describe('Chat history validation', () => {
  it('preserves explicit assistant reasoning and linked tool names', () => {
    const sent = makeModelRequest({ model: 'local', messages: [
      { role: 'assistant', content: null, reasoning_content: 'check first', tool_calls: [{ id: 'a', type: 'function', function: { name: 'read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'a', content: 'ok' }
    ] }, new AbortController().signal)
    expect(sent.history[0]).toMatchObject({ kind: 'assistant_reasoning', text: 'check first' })
    expect(sent.history[2]).toMatchObject({ kind: 'tool_result', toolName: 'read' })
  })
})

describe('gateway privacy and reasoning capability guard', () => {
  it('uses no-store for models, token estimates, credential reveal and protocol errors', async () => {
    const rt = runtime()
    rt.modelGateway!.credentials.reveal = () => 'fixture-secret'
    const responses = [
      await gatewayModels(rt, request({})),
      await gatewayCountTokens(rt, request({ messages: user })),
      revealGatewayCredential(rt),
      await gatewayResponses(rt, request({ input: 'hello', store: true })),
      await gatewayMessages(rt, new Request('http://localhost/v1/messages', { method: 'POST', body: '{}' }))
    ]
    for (const response of responses) expect(response.headers).toMatchObject({ 'cache-control': 'no-store' })
  })
  it.each([false, true])('uses no-store for every generation protocol, stream=%s', async (stream) => {
    for (const handler of [gatewayChatCompletions, gatewayResponses, gatewayMessages]) {
      const body = handler === gatewayResponses ? { input: 'hello', stream } : { messages: user, stream }
      const response = await handler(runtime(), request(body))
      if (response instanceof Response) {
        expect(response.headers.get('cache-control')).toBe('no-store')
        await response.text()
      } else expect(response.headers['cache-control']).toBe('no-store')
    }
  })
  it('rejects explicitly thinking-required models before inference', async () => {
    const model = new ScriptedModel()
    const rt = runtime(model)
    rt.modelGateway!.modelCapabilities = () => ({ reasoning: { supportedEfforts: ['high'], defaultEffort: 'high', requestProtocol: 'anthropic-thinking' } }) as never
    const response = await gatewayMessages(rt, request({ messages: user, thinking: { type: 'disabled' } }))
    expect(response.status).toBe(400)
    expect(parseBody(response).error.message).toContain('cannot disable thinking')
    expect(model.last).toBeUndefined()
  })
  it('does not infer unknown reasoning capability is unsupported', async () => {
    const model = new ScriptedModel()
    const rt = runtime(model)
    rt.modelGateway!.modelCapabilities = () => ({ inputModalities: ['text'] }) as never
    const response = await gatewayMessages(rt, request({ messages: user, thinking: { type: 'disabled' } }))
    expect(response.status).toBe(200)
    expect(model.last!.reasoningEffort).toBe('off')
  })
  it('returns the Anthropic rate_limit_error envelope when the public bucket is depleted', async () => {
    const rt = runtime()
    for (let count = 0; count < 20; count++) expect((await gatewayMessages(rt, request({ messages: user }))).status).toBe(200)
    const response = await gatewayMessages(rt, request({ messages: user }))
    expect(response.status).toBe(429)
    expect(parseBody(response).error.type).toBe('rate_limit_error')
  })
})
