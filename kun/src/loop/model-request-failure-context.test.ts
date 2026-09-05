import { describe, expect, it, vi } from 'vitest'
import {
  modelPreflightFailureContext,
  modelRequestFailureContext,
  recordModelPreflightFailure
} from './model-request-failure-context.js'

const request = { providerId: 'codex', model: 'gpt-5.6-sol' }

describe('model request failure context', () => {
  it('classifies provider responses with actual route identity', () => {
    expect(modelRequestFailureContext({
      request,
      code: 'http_503',
      failure: {
        category: 'unavailable', responseReceived: true, httpStatus: 503,
        providerCode: 'server_is_overloaded', providerId: 'codex-route',
        modelId: 'gpt-5.6-sol', retryAfterMs: 4_000, failoverAllowed: true
      }
    })).toEqual({
      requestState: 'provider_responded', providerId: 'codex-route', model: 'gpt-5.6-sol',
      httpStatus: 503, providerCode: 'server_is_overloaded', category: 'unavailable',
      retryAfterMs: 4_000
    })
  })

  it('classifies transport failures without claiming a provider response', () => {
    expect(modelRequestFailureContext({
      request, code: 'model_provider_unreachable',
      failure: { category: 'network', failoverAllowed: true }
    })).toMatchObject({
      requestState: 'sent_no_response', providerId: 'codex', model: 'gpt-5.6-sol',
      category: 'network'
    })
  })

  it('recognizes known local preflight failures', () => {
    expect(modelPreflightFailureContext(new Error('unknown model provider: codex'), request))
      .toMatchObject({
        code: 'model_request_not_sent',
        context: { requestState: 'not_sent', providerId: 'codex', model: 'gpt-5.6-sol' }
      })
    expect(modelPreflightFailureContext(new Error('unexpected adapter crash'), request)).toBeNull()
  })

  it('records a durable preflight error and remembered terminal failure', async () => {
    const rememberFailure = vi.fn()
    const record = vi.fn(async (event) => event)
    await expect(recordModelPreflightFailure({
      error: new Error('protected model credential is unavailable'), request,
      threadId: 'thread_1', turnId: 'turn_1', rememberFailure,
      events: { record } as never
    })).resolves.toBe(true)
    expect(rememberFailure).toHaveBeenCalledWith('turn_1', expect.objectContaining({
      modelRequestFailure: expect.objectContaining({ requestState: 'not_sent' })
    }))
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error', modelRequestFailure: expect.objectContaining({ requestState: 'not_sent' })
    }))
  })
})
