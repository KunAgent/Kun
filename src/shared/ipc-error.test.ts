import { describe, expect, it } from 'vitest'
import { AppIpcErrorSchema } from './ipc-error'

describe('AppIpcErrorSchema', () => {
  it('accepts a bounded retryable error with primitive details', () => {
    const error = {
      code: 'provider_unavailable',
      message: 'The provider is temporarily unavailable.',
      retryable: true,
      incidentId: 'inc_123',
      details: { status: 503, provider: 'deepseek', retryAfterMs: 1000 }
    }

    expect(AppIpcErrorSchema.parse(error)).toEqual(error)
  })

  it('rejects stacks, nested objects, and unknown fields', () => {
    expect(() => AppIpcErrorSchema.parse({
      code: 'internal_error',
      message: 'failed',
      retryable: false,
      stack: 'secret stack'
    })).toThrow()
    expect(() => AppIpcErrorSchema.parse({
      code: 'internal_error',
      message: 'failed',
      retryable: false,
      details: { nested: { secret: true } }
    })).toThrow()
  })

  it('bounds messages, identifiers, and detail field counts', () => {
    const details = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`field${index}`, true])
    )

    expect(() => AppIpcErrorSchema.parse({
      code: 'internal_error',
      message: 'failed',
      retryable: false,
      details
    })).toThrow()
    expect(() => AppIpcErrorSchema.parse({
      code: 'x'.repeat(129),
      message: 'failed',
      retryable: false
    })).toThrow()
  })
})
