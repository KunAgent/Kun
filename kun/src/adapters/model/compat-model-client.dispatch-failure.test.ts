import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { modelRequestFailureContext } from '../../loop/model-request-failure-context.js'
import { CompatModelClient } from './compat-model-client.js'

function request(extra: Partial<ModelRequest> = {}): ModelRequest {
  return {
    threadId: 'fixture-thread', turnId: 'fixture-turn', model: 'fixture-model',
    providerId: 'fixture-provider', systemPrompt: 'Fixture', prefix: [],
    history: [], tools: [], abortSignal: new AbortController().signal,
    maxRetryAttempts: 0, ...extra
  }
}

async function failure(fetchImpl: typeof fetch, input = request()) {
  const client = new CompatModelClient({
    baseUrl: 'https://provider.invalid/v1', apiKey: 'fixture-credential',
    providerId: 'fixture-provider', model: 'fixture-model',
    endpointFormat: 'chat_completions', nonStreaming: true, fetchImpl
  })
  for await (const chunk of client.stream(input)) {
    if (chunk.kind === 'error') return chunk
  }
  throw new Error('Expected fixture model failure')
}

function context(error: Extract<ModelStreamChunk, { kind: 'error' }>) {
  return modelRequestFailureContext({ request: request(), code: error.code, failure: error.failure })
}

afterEach(() => vi.restoreAllMocks())

describe('CompatModelClient dispatch failure provenance', () => {
  it('records a rejected local guard as unsent without fetching or exposing its exception', async () => {
    const fetchImpl = vi.fn(async () => Response.json({}))
    const error = await failure(fetchImpl, request({
      beforeProviderDispatch: async () => { throw new Error('private guard detail') }
    }))
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(error).toMatchObject({
      code: 'provider_configuration_changed',
      failure: { requestSent: false, responseReceived: false, failoverAllowed: false }
    })
    expect(error.failure).not.toHaveProperty('httpStatus')
    expect(error.message).not.toContain('private guard detail')
    expect(context(error)).toEqual({
      requestState: 'not_sent', providerId: 'fixture-provider', model: 'fixture-model',
      category: 'request', reason: 'request'
    })
  })

  it('keeps an actual provider HTTP 503 as a provider response', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn(async () => Response.json({
      error: { code: 'overloaded', message: 'Fixture temporarily unavailable' }
    }, { status: 503 }))
    const error = await failure(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(error.failure).toMatchObject({ httpStatus: 503 })
    expect(error.failure?.requestSent).not.toBe(false)
    expect(context(error)).toMatchObject({ requestState: 'provider_responded', httpStatus: 503 })
  })

  it('keeps a transport failure without a response distinct from a local guard refusal', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Fixture network failure') })
    const error = await failure(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(error.code).toBe('model_provider_unreachable')
    expect(error.failure?.requestSent).not.toBe(false)
    expect(context(error)).toMatchObject({ requestState: 'sent_no_response', category: 'network' })
  })
})
