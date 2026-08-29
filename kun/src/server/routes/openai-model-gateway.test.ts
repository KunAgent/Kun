import { describe, expect, it, vi } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { RoutePoolHealthStore } from '../../adapters/model/route-pool-model-client.js'
import type { ServerRuntime } from './server-runtime.js'
import { gatewayChatCompletions, gatewayModels, gatewayResponses, routePoolStatus } from './openai-model-gateway.js'
import { DEFAULT_SERVE_OPTIONS, ServeOptionsSchema } from '../../cli/cli-options.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../../contracts/model-route-pool.js'
import { buildRouter } from './index.js'
import { RoutePoolTestService } from '../../services/route-pool-test-service.js'

class GatewayModel implements ModelClient {
  provider = 'test'
  model = 'default'
  last?: ModelRequest
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.last = request
    yield { kind: 'assistant_text_delta', text: 'hello' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class HangingGatewayModel implements ModelClient {
  provider = 'test'
  model = 'default'
  returned = 0
  stream(): AsyncIterable<ModelStreamChunk> {
    const owner = this
    return { [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<ModelStreamChunk>>(() => undefined),
      return: async () => { owner.returned += 1; return { done: true, value: undefined } }
    }) }
  }
}

class ErrorGatewayModel implements ModelClient {
  provider = 'test'
  model = 'default'
  returned = 0
  stream(): AsyncIterable<ModelStreamChunk> {
    const owner = this
    let emitted = false
    return { [Symbol.asyncIterator]: () => ({
      next: async () => emitted
        ? new Promise<IteratorResult<ModelStreamChunk>>(() => undefined)
        : (emitted = true, { done: false, value: { kind: 'error', message: 'upstream failed' } }),
      return: async () => { owner.returned += 1; return { done: true, value: undefined } }
    }) }
  }
}

function authorizedRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: { authorization: 'Bearer public-gateway-key', ...init.headers }
  })
}

function runtime(enabled = true, modelClient: ModelClient = new GatewayModel()): ServerRuntime {
  const health = new RoutePoolHealthStore()
  const pools = [
    {
      id: 'pool', name: 'Pool', modelId: 'local-model', enabled: true, strategy: 'priority' as const,
      targets: [{ id: 'target', providerId: 'provider', modelId: 'real', enabled: true, weight: 1 }],
      failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
      healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
    },
    {
      id: 'coding-pool', name: 'Coding Pool', modelId: 'local-coding', enabled: true, strategy: 'adaptive' as const,
      targets: [{ id: 'coding-target', providerId: 'provider', modelId: 'real-coding', enabled: true, weight: 1 }],
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
      enabled: () => enabled,
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
      }
    }
  } as unknown as ServerRuntime
}

describe('local OpenAI model gateway', () => {
  it('rejects unauthenticated gateway configuration on non-loopback hosts', () => {
    expect(ServeOptionsSchema.safeParse({ ...DEFAULT_SERVE_OPTIONS, dataDir: '/tmp/kun', host: '0.0.0.0', localModelGateway: { enabled: true } }).success).toBe(false)
    expect(ServeOptionsSchema.safeParse({ ...DEFAULT_SERVE_OPTIONS, dataDir: '/tmp/kun', host: '127.0.0.1', localModelGateway: { enabled: true } }).success).toBe(true)
  })
  it('lists every routed model exposed by the local provider', () => {
    const response = gatewayModels(runtime(), authorizedRequest('/v1/models'))
    expect(JSON.parse(response.body).data).toEqual([
      expect.objectContaining({ id: 'local-model', owned_by: 'kun-route-pool' }),
      expect.objectContaining({ id: 'local-coding', owned_by: 'kun-route-pool' })
    ])
  })

  it('reports the effective local gateway state with route status', () => {
    expect(JSON.parse(routePoolStatus(runtime(true)).body)).toMatchObject({
      localGateway: { enabled: true },
      pools: expect.arrayContaining([expect.objectContaining({ id: 'pool' })]),
      configuredPools: expect.arrayContaining([expect.objectContaining({ id: 'pool' })])
    })
    expect(JSON.parse(routePoolStatus(runtime(false)).body)).toMatchObject({
      localGateway: { enabled: false }
    })
  })

  it('returns a non-streaming chat completion with the public alias', async () => {
    const testRuntime = runtime()
    const response = await gatewayChatCompletions(testRuntime, authorizedRequest('/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }], stream: false })
    }))
    expect(response).not.toBeInstanceOf(Response)
    const body = JSON.parse((response as { body: string }).body)
    expect(body.model).toBe('local-model')
    expect(body.choices[0].message.content).toBe('hello')
    expect((testRuntime.modelClient as GatewayModel).last?.providerId).toBe(LOCAL_MODEL_GATEWAY_PROVIDER_ID)
  })

  it('streams Responses events and rejects unknown models', async () => {
    const streamed = await gatewayResponses(runtime(), authorizedRequest('/v1/responses', {
      method: 'POST', body: JSON.stringify({ model: 'local-model', input: 'hi', stream: true })
    }))
    expect(streamed).toBeInstanceOf(Response)
    expect(await (streamed as Response).text()).toContain('response.output_text.delta')
    const missing = await gatewayChatCompletions(runtime(), authorizedRequest('/v1/chat/completions', {
      method: 'POST', body: JSON.stringify({ model: 'missing', messages: [{ role: 'user', content: 'hi' }] })
    }))
    expect((missing as { status: number }).status).toBe(404)
  })

  it('maps tools and data images while releasing the completed request signal', async () => {
    const testRuntime = runtime()
    const controller = new AbortController()
    await gatewayChatCompletions(testRuntime, authorizedRequest('/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({
        model: 'local-model',
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'describe' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }
        ] }],
        tools: [{ type: 'function', function: { name: 'read', description: 'Read', parameters: { type: 'object' } } }]
      })
    }))
    const sent = (testRuntime.modelClient as GatewayModel).last
    expect(sent?.providerId).toBe(LOCAL_MODEL_GATEWAY_PROVIDER_ID)
    expect(sent?.tools).toEqual([expect.objectContaining({ name: 'read' })])
    expect(sent?.attachments).toEqual([expect.objectContaining({ mimeType: 'image/png' })])
    controller.abort()
    expect(sent?.abortSignal.aborted).toBe(false)
  })

  it('requires independent Bearer auth on all three public routes', async () => {
    expect(gatewayModels(runtime(), new Request('http://localhost/v1/models')).status).toBe(401)
    expect((await gatewayChatCompletions(runtime(), new Request('http://localhost/v1/chat/completions', {
      method: 'POST', body: '{}'
    }))).status).toBe(401)
    expect((await gatewayResponses(runtime(), new Request('http://localhost/v1/responses', {
      method: 'POST', body: '{}'
    }))).status).toBe(401)
  })

  it('rejects bodies larger than 2 MiB before model execution', async () => {
    const testRuntime = runtime()
    const response = await gatewayChatCompletions(testRuntime, authorizedRequest('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'local-model', messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }] })
    }))
    expect(response.status).toBe(413)
    expect((testRuntime.modelClient as GatewayModel).last).toBeUndefined()
  })

  it('keeps credential administration strict even when runtime is insecure', async () => {
    const testRuntime = runtime()
    testRuntime.insecure = true
    const router = buildRouter(testRuntime)
    const match = router.match('GET', '/v1/model-gateway/credential/status')!
    const unauthorized = await match.handler(new Request('http://localhost/v1/model-gateway/credential/status'), { params: match.params })
    expect(unauthorized.status).toBe(401)
    const authorized = await match.handler(new Request('http://localhost/v1/model-gateway/credential/status', {
      headers: { authorization: 'Bearer gateway-test-token' }
    }), { params: match.params })
    expect(authorized.status).toBe(200)
  })

  it('returns 504 at 120 seconds even when the upstream iterator ignores abort', async () => {
    vi.useFakeTimers()
    try {
      const model = new HangingGatewayModel()
      const pending = gatewayChatCompletions(runtime(true, model), authorizedRequest('/v1/chat/completions', {
        method: 'POST', body: JSON.stringify({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }] })
      }))
      await vi.advanceTimersByTimeAsync(120_000)
      await expect(pending).resolves.toMatchObject({ status: 504 })
      expect(model.returned).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes upstream iterators after non-streaming and streaming error chunks', async () => {
    const nonStreaming = new ErrorGatewayModel()
    const nonStreamingResponse = await gatewayChatCompletions(runtime(true, nonStreaming), authorizedRequest('/v1/chat/completions', {
      method: 'POST', body: JSON.stringify({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }], stream: false })
    }))
    expect(nonStreamingResponse.status).toBe(502)
    expect(nonStreaming.returned).toBe(1)

    const streaming = new ErrorGatewayModel()
    const streamingResponse = await gatewayChatCompletions(runtime(true, streaming), authorizedRequest('/v1/chat/completions', {
      method: 'POST', body: JSON.stringify({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    })) as Response
    expect(await streamingResponse.text()).toContain('upstream failed')
    expect(streaming.returned).toBe(1)
  })

  it('cancels a stream and releases its concurrency slot', async () => {
    const model = new HangingGatewayModel()
    const testRuntime = runtime(true, model)
    const make = () => gatewayChatCompletions(testRuntime, authorizedRequest('/v1/chat/completions', {
      method: 'POST', body: JSON.stringify({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    }))
    const first = await make() as Response
    const second = await make() as Response
    expect((await make()).status).toBe(429)
    await first.body!.cancel()
    await vi.waitFor(() => expect(model.returned).toBeGreaterThan(0))
    expect(await make()).toBeInstanceOf(Response)
    await second.body!.cancel()
  })

  it('registers an authenticated complete route test endpoint', async () => {
    const testRuntime = runtime()
    const router = buildRouter(testRuntime)
    const match = router.match('POST', '/v1/model-routes/pool/test')
    expect(match).toBeDefined()

    const unauthorized = await match!.handler(
      new Request('http://127.0.0.1/v1/model-routes/pool/test', { method: 'POST' }),
      { params: match!.params }
    )
    expect(unauthorized.status).toBe(401)

    const response = await match!.handler(
      new Request('http://127.0.0.1/v1/model-routes/pool/test', {
        method: 'POST',
        headers: { authorization: 'Bearer gateway-test-token' }
      }),
      { params: match!.params }
    )
    expect(response.status).toBe(202)
    const responseBody = response instanceof Response ? await response.text() : response.body
    expect(JSON.parse(responseBody)).toMatchObject({ test: { poolId: 'pool', status: 'queued' } })
    await vi.waitFor(() => {
      expect(testRuntime.modelGateway!.tests.list('pool')[0]).toMatchObject({ status: 'succeeded', output: 'hello' })
    })
    expect((testRuntime.modelClient as GatewayModel).last?.providerId).toBe(LOCAL_MODEL_GATEWAY_PROVIDER_ID)
  })
})
