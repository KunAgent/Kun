import { describe, expect, it } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { RoutePoolHealthStore } from '../../adapters/model/route-pool-model-client.js'
import type { ServerRuntime } from './server-runtime.js'
import { gatewayCountTokens, gatewayMessages } from './anthropic-messages-gateway.js'
import { RoutePoolTestService } from '../../services/route-pool-test-service.js'

class ScriptedModel implements ModelClient {
  provider = 'test'
  model = 'default'
  last?: ModelRequest
  constructor(private readonly script: ModelStreamChunk[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.last = request
    yield* this.script
  }
}

function textModel(): ScriptedModel {
  return new ScriptedModel([
    { kind: 'assistant_text_delta', text: 'hello' },
    { kind: 'completed', stopReason: 'stop' }
  ])
}

function runtime(modelClient: ModelClient = textModel(), inputModalities?: readonly string[]): ServerRuntime {
  const health = new RoutePoolHealthStore()
  const pools = [
    {
      id: 'pool', name: 'Pool', modelId: 'local-model', enabled: true, strategy: 'priority' as const,
      targets: [{ id: 'target', providerId: 'provider', modelId: 'real', enabled: true, weight: 1 }],
      failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
      healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
    }
  ]
  const tests = new RoutePoolTestService(modelClient, () => pools, health)
  return {
    runtimeToken: 'gateway-test-token',
    insecure: false,
    modelClient,
    modelGateway: {
      enabled: () => true,
      exposeProviderModels: () => false,
      pools: () => pools,
      configuredPools: () => pools,
      health,
      tests,
      credentials: {
        status: () => ({ configured: true }),
        verify: (candidate: string | null) => candidate === 'public-gateway-key',
        reveal: () => 'public-gateway-key',
        ensure: async () => ({ key: 'public-gateway-key', created: false }),
        rotate: async () => ({ key: 'rotated-gateway-key' }),
        revoke: async () => true
      },
      ...(inputModalities ? { modelCapabilities: () => ({ inputModalities }) } : {})
    }
  } as unknown as ServerRuntime
}

function authorizedRequest(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer public-gateway-key', ...headers },
    body: JSON.stringify(body)
  })
}

function sseEvents(text: string): Array<{ event: string; data: Record<string, unknown> }> {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  for (const block of text.split('\n\n')) {
    const match = /^event: (.+)\ndata: (.+)$/s.exec(block.trim())
    if (match) events.push({ event: match[1], data: JSON.parse(match[2]) as Record<string, unknown> })
  }
  return events
}

describe('anthropic-compatible gateway messages', () => {
  it('accepts x-api-key authentication', async () => {
    const response = await gatewayMessages(runtime(), authorizedRequest(
      { model: 'local-model', messages: [{ role: 'user', content: 'hi' }] },
      { authorization: '', 'x-api-key': 'public-gateway-key' }
    ))
    expect(response.status).toBe(200)
    const body = JSON.parse((response as { body: string }).body)
    expect(body.type).toBe('message')
  })

  it('returns Anthropic-shaped errors for auth and missing models', async () => {
    const unauthorized = await gatewayMessages(runtime(), new Request('http://localhost/v1/messages', {
      method: 'POST', body: '{}'
    }))
    expect(unauthorized.status).toBe(401)
    expect(JSON.parse((unauthorized as { body: string }).body)).toMatchObject({
      type: 'error',
      error: { type: 'authentication_error' }
    })

    const missing = await gatewayMessages(runtime(), authorizedRequest({
      model: 'nope', messages: [{ role: 'user', content: 'hi' }]
    }))
    expect(missing.status).toBe(404)
    expect(JSON.parse((missing as { body: string }).body)).toMatchObject({
      type: 'error',
      error: { type: 'not_found_error' }
    })
  })

  it('maps stop reasons and reports input/output usage', async () => {
    const truncated = await gatewayMessages(
      runtime(new ScriptedModel([
        { kind: 'assistant_text_delta', text: 'partial' },
        { kind: 'usage', usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16, cacheHitRate: null, turns: 1 } },
        { kind: 'completed', stopReason: 'length' }
      ])),
      authorizedRequest({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }] })
    )
    const body = JSON.parse((truncated as { body: string }).body)
    expect(body.stop_reason).toBe('max_tokens')
    expect(body.usage).toEqual({ input_tokens: 12, output_tokens: 4 })
  })

  it('streams tool_use blocks and ends with stop_reason tool_use', async () => {
    const streamed = await gatewayMessages(
      runtime(new ScriptedModel([
        { kind: 'assistant_text_delta', text: 'calling' },
        { kind: 'tool_call_complete', callId: 'call_1', toolName: 'read', arguments: { path: '/tmp/x' } },
        { kind: 'usage', usage: { promptTokens: 9, completionTokens: 7, totalTokens: 16, cacheHitRate: null, turns: 1 } },
        { kind: 'completed', stopReason: 'tool_calls' }
      ])),
      authorizedRequest({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    ) as Response
    expect(streamed.status).toBe(200)
    const events = sseEvents(await streamed.text())
    const toolBlock = events.find((entry) =>
      entry.event === 'content_block_start' &&
      (entry.data.content_block as { type?: string })?.type === 'tool_use'
    )
    expect(toolBlock).toBeDefined()
    const delta = events.find((entry) => entry.event === 'message_delta')
    expect((delta?.data.delta as { stop_reason?: string })?.stop_reason).toBe('tool_use')
    expect(delta?.data.usage).toMatchObject({ input_tokens: 9, output_tokens: 7 })
  })

  it('emits error events instead of openai envelopes on stream failure', async () => {
    const streamed = await gatewayMessages(
      runtime(new ScriptedModel([{ kind: 'error', message: 'upstream died' }])),
      authorizedRequest({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    ) as Response
    const events = sseEvents(await streamed.text())
    const error = events.find((entry) => entry.event === 'error')
    expect(error?.data.error).toMatchObject({ type: 'api_error', message: 'upstream died' })
  })

  it('converts multi-turn tool_use/tool_result history', async () => {
    const model = new ScriptedModel([
      { kind: 'assistant_text_delta', text: 'done' },
      { kind: 'completed', stopReason: 'stop' }
    ])
    await gatewayMessages(runtime(model), authorizedRequest({
      model: 'local-model',
      messages: [
        { role: 'user', content: 'read the file' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read', input: { path: '/x' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file body' }] },
        { role: 'user', content: 'summarize' }
      ]
    }))
    const kinds = model.last!.history.map((item) => item.kind)
    expect(kinds).toEqual(['user_message', 'tool_call', 'tool_result', 'user_message'])
    const toolCall = model.last!.history[1]
    expect(toolCall).toMatchObject({ callId: 't1', toolName: 'read', arguments: { path: '/x' } })
    const toolResult = model.last!.history[2]
    expect(toolResult).toMatchObject({ callId: 't1', output: 'file body' })
  })

  it('drops thinking blocks and orphan tool_result blocks on input', async () => {
    const model = new ScriptedModel([
      { kind: 'assistant_text_delta', text: 'ok' },
      { kind: 'completed', stopReason: 'stop' }
    ])
    const response = await gatewayMessages(runtime(model), authorizedRequest({
      model: 'local-model',
      messages: [
        { role: 'assistant', content: [
          { type: 'thinking', thinking: 'hmm', signature: 'sig' },
          { type: 'text', text: 'answer' }
        ] },
        { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'orphan_call', content: 'stale' },
          { type: 'text', text: 'next' }
        ] }
      ]
    }))
    expect(response.status).toBe(200)
    const kinds = model.last!.history.map((item) => item.kind)
    expect(kinds).toEqual(['assistant_text', 'user_message'])
  })

  it('rejects image inputs for models without vision support', async () => {
    const imageMessage = {
      role: 'user',
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } }]
    }
    const textOnly = await gatewayMessages(
      runtime(textModel(), ['text']),
      authorizedRequest({ model: 'local-model', messages: [imageMessage] })
    )
    expect(textOnly.status).toBe(400)
    expect(JSON.parse((textOnly as { body: string }).body)).toMatchObject({
      type: 'error',
      error: { type: 'invalid_request_error' }
    })

    const model = textModel()
    const vision = await gatewayMessages(
      runtime(model, ['text', 'image']),
      authorizedRequest({ model: 'local-model', messages: [imageMessage] })
    )
    expect(vision.status).toBe(200)
    expect(model.last?.attachments).toHaveLength(1)
  })

  it('streams tool argument deltas and closes the block on tool_call_complete', async () => {
    const streamed = await gatewayMessages(
      runtime(new ScriptedModel([
        { kind: 'tool_call_delta', callId: 'c1', toolName: 'read', argumentsDelta: '{"pa' },
        { kind: 'tool_call_delta', callId: 'c1', argumentsDelta: 'th":"/x"}' },
        { kind: 'tool_call_complete', callId: 'c1', toolName: 'read', arguments: { path: '/x' } },
        { kind: 'completed', stopReason: 'tool_calls' }
      ])),
      authorizedRequest({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    ) as Response
    const events = sseEvents(await streamed.text())
    const starts = events.filter((entry) =>
      entry.event === 'content_block_start' &&
      (entry.data.content_block as { type?: string })?.type === 'tool_use'
    )
    expect(starts).toHaveLength(1)
    const deltas = events.filter((entry) => entry.event === 'content_block_delta')
    expect(deltas.map((entry) => (entry.data.delta as { partial_json?: string }).partial_json))
      .toEqual(['{"pa', 'th":"/x"}'])
    const stops = events.filter((entry) => entry.event === 'content_block_stop')
    expect(stops).toHaveLength(1)
    const delta = events.find((entry) => entry.event === 'message_delta')
    expect((delta?.data.delta as { stop_reason?: string })?.stop_reason).toBe('tool_use')
  })

  it('streams reasoning as thinking content blocks', async () => {
    const streamed = await gatewayMessages(
      runtime(new ScriptedModel([
        { kind: 'assistant_reasoning_delta', text: 'ponder' },
        { kind: 'assistant_text_delta', text: 'answer' },
        { kind: 'completed', stopReason: 'stop' }
      ])),
      authorizedRequest({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    ) as Response
    const events = sseEvents(await streamed.text())
    const blocks = events
      .filter((entry) => entry.event === 'content_block_start')
      .map((entry) => (entry.data.content_block as { type?: string }).type)
    expect(blocks).toEqual(['thinking', 'text'])
    const thinkingDelta = events.find((entry) =>
      entry.event === 'content_block_delta' &&
      (entry.data.delta as { type?: string }).type === 'thinking_delta'
    )
    expect((thinkingDelta?.data.delta as { thinking?: string }).thinking).toBe('ponder')
  })
})

describe('anthropic count_tokens endpoint', () => {
  function countRequest(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
    return new Request('http://localhost/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer public-gateway-key', ...headers },
      body: JSON.stringify(body)
    })
  }

  it('returns an estimated input_tokens with the x-kun-estimate header', async () => {
    const response = await gatewayCountTokens(runtime(), countRequest({
      model: 'local-model',
      system: 'you are helpful',
      messages: [{ role: 'user', content: 'count these tokens please' }],
      tools: [{ name: 'read', description: 'read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }]
    }))
    expect(response.status).toBe(200)
    expect(response.headers['x-kun-estimate']).toBe('true')
    expect(response.headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(response.body) as { input_tokens: number }
    expect(body.input_tokens).toBeGreaterThan(0)
  })

  it('rejects missing credentials and unknown models', async () => {
    const unauthorized = await gatewayCountTokens(runtime(), new Request('http://localhost/v1/messages/count_tokens', {
      method: 'POST', body: '{}'
    }))
    expect(unauthorized.status).toBe(401)
    const missing = await gatewayCountTokens(runtime(), countRequest({
      model: 'nope', messages: [{ role: 'user', content: 'hi' }]
    }))
    expect(missing.status).toBe(404)
    const malformed = await gatewayCountTokens(runtime(), countRequest({ model: 'local-model' }))
    expect(malformed.status).toBe(400)
  })
})
