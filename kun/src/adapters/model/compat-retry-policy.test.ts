import { describe, expect, it } from 'vitest'
import {
  normalizeModelRequestRetryConfig,
  parseRetryAfterMs,
  retryDelayMs
} from './compat-retry-policy.js'

describe('compat retry policy', () => {
  it('defaults to five retries after the initial request', () => {
    expect(normalizeModelRequestRetryConfig(undefined)).toEqual({
      maxAttempts: 5,
      initialDelayMs: 3_000,
      httpStatusCodes: [429, 500, 502, 503, 504]
    })
  })

  it('normalizes limits and retryable statuses', () => {
    expect(normalizeModelRequestRetryConfig({
      maxAttempts: 99,
      initialDelayMs: -5,
      httpStatusCodes: [503, 429, 503, 200]
    })).toEqual({ maxAttempts: 10, initialDelayMs: 0, httpStatusCodes: [429, 503] })
  })

  it('honors numeric and date Retry-After values', () => {
    expect(parseRetryAfterMs('2', 1_000)).toBe(2_000)
    expect(parseRetryAfterMs('Thu, 01 Jan 1970 00:00:03 GMT', 1_000)).toBe(2_000)
  })

  it('uses deterministic bounded jitter when Retry-After is absent', () => {
    const response = new Response('', { status: 503 })
    expect(retryDelayMs(response, 100, 1, { random: () => 0 })).toBe(160)
    expect(retryDelayMs(response, 100, 1, { random: () => 1 })).toBe(240)
  })
})
