import { describe, expect, it } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import type { ServerRuntime } from './server-runtime.js'
import { gatewayChatCompletions, gatewayResponses } from './openai-model-gateway.js'
import { gatewayMessages } from './anthropic-messages-gateway.js'
import { startNodeHttpServer } from '../node-http-server.js'
import { Router } from '../router.js'

const KEY = 'fixture-key'

/** An upstream that sends nothing until it is aborted, like a slow first token. */
class WaitsForAbort implements ModelClient {
  provider = 'fixture'
  model = 'fixture'
  aborted = false
  // eslint-disable-next-line require-yield
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    await new Promise<void>((resolve) => {
      const abort = (): void => { this.aborted = true; resolve() }
      request.abortSignal.addEventListener('abort', abort, { once: true })
      if (request.abortSignal.aborted) abort()
    })
  }
}

function runtime(modelClient: ModelClient): ServerRuntime {
  return {
    modelClient,
    modelConnections: { snapshot: async () => ({ revision: 1, providers: [{ id: 'alpha', name: 'Alpha', kind: 'http', authType: 'api-key',
      configured: true, credentialStatus: 'ready', endpointFormat: 'chat_completions', models: ['a1'] }] }) },
    modelGateway: { enabled: () => true, exposeProviderModels: () => true, credentials: { verify: (value: string | null) => value === KEY }, pools: () => [] }
  } as unknown as ServerRuntime
}

const within = <T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> =>
  Promise.race([promise, new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms))])

describe('streaming cancellation', () => {
  it.each([
    ['responses', '/v1/responses', { model: 'alpha/a1', input: 'hi', stream: true }, gatewayResponses],
    ['chat', '/v1/chat/completions', { model: 'alpha/a1', messages: [{ role: 'user', content: 'hi' }], stream: true }, gatewayChatCompletions],
    ['messages', '/v1/messages', { model: 'alpha/a1', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }], stream: true }, gatewayMessages]
  ] as const)('aborts the upstream and settles when the %s client disconnects before the first token', async (_name, path, body, handler) => {
    const model = new WaitsForAbort()
    const disconnect = new AbortController()
    const request = new Request(`http://127.0.0.1:18899${path}`, { method: 'POST', signal: disconnect.signal,
      headers: { authorization: `Bearer ${KEY}`, 'x-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const pending = (handler as (runtime: ServerRuntime, request: Request) => Promise<unknown>)(runtime(model), request)
    setTimeout(() => disconnect.abort(), 100)
    const result = await within(pending, 4_000)
    expect(result).not.toBe('timeout')
    if (result instanceof Response && result.body) {
      // The server cancels the body of a response whose client has gone.
      expect(await within(result.body.cancel(), 4_000)).not.toBe('timeout')
    }
    expect(model.aborted).toBe(true)
  })
  it.each([100, 2_500])('lets the server close when a real HTTP client disconnects %sms into a stream', async (delay) => {
    const model = new WaitsForAbort()
    const router = new Router()
    router.add('POST', '/v1/responses', (request) => gatewayResponses(runtime(model), request))
    const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
    const disconnect = new AbortController()
    const response = fetch(`http://127.0.0.1:${server.port}/v1/responses`, { method: 'POST', signal: disconnect.signal,
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'alpha/a1', input: 'hi', stream: true }) }).then(async (result) => { await result.text() }).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, delay))
    disconnect.abort()
    await response
    expect(await within(server.close(), 5_000)).not.toBe('timeout')
    expect(model.aborted).toBe(true)
  }, 15_000)
})
