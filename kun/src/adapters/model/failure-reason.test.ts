import { describe, expect, it } from 'vitest'
import {
  circuitCooldownMs,
  classifyModelFailure,
  httpRetryBudget,
  modelFailureMetadata,
  reasonAllowsFailover,
  retryAfterHeaderMs,
  retryDelayForBudget
} from './failure-reason.js'

const NOW = Date.parse('2026-09-24T12:00:00.000Z')

describe('classifyModelFailure', () => {
  it.each([
    // DeepSeek: 402 Insufficient Balance
    [{ status: 402, body: '{"error":{"message":"Insufficient Balance"}}' }, 'credit'],
    // OpenAI: 429 insufficient_quota is a billing failure, not a rate limit
    [{ status: 429, body: '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}' }, 'credit'],
    [{ status: 400, body: '{"error":{"message":"insufficient balance, please recharge"}}' }, 'credit'],
    [{ status: 403, body: '账户余额不足，请充值' }, 'credit'],
    [{ status: 403, body: '账户欠费已停用' }, 'credit'],
    // Quota-style failures (plan/usage limits) distinct from credit
    [{ status: 429, body: '{"error":{"code":"exceeded_current_quota_error"}}' }, 'quota'],
    [{ status: 403, body: '额度不足' }, 'quota'],
    [{ status: 429, body: '已达到套餐用量上限' }, 'quota'],
    [{ status: 429, body: 'usage limit reached for the month' }, 'quota'],
    // A bare 400 needs an explicit quota machine code; prose stays `request`.
    [{ status: 400, body: 'quota exceeded for this plan' }, 'request'],
    [{ status: 400, body: 'usage limit reached for the month' }, 'request'],
    [{ status: 400, body: '{"error":{"code":"exceeded_current_quota_error"}}' }, 'quota'],
    // Request-shape errors are never quota problems (A2 samples).
    [{ status: 400, body: 'exceeded model token limit: 262144' }, 'request'],
    [{ status: 400, body: '输入长度超过模型上限' }, 'request'],
    [{ status: 400, body: 'max_tokens exceeds the limit of 8192' }, 'request'],
    [{ status: 400, body: 'request exceeds the maximum context length' }, 'request'],
    // Rate limiting
    [{ status: 429 }, 'rate'],
    [{ status: 429, body: '{"error":{"type":"rate_limit_error"}}' }, 'rate'],
    [{ status: 429, body: 'Rate limit reached for requests (RPM)' }, 'rate'],
    [{ status: 400, body: '请求频率过高，已限流' }, 'rate'],
    // A 5xx mentioning billing is an upstream outage, not unpaid credit.
    [{ status: 500, body: 'upstream billing service timeout' }, 'other'],
    // Overloaded
    [{ status: 529, body: '{"error":{"type":"overloaded_error"}}' }, 'overloaded'],
    [{ status: 503, body: 'server busy, at capacity' }, 'overloaded'],
    // Status-only mappings
    [{ status: 401, body: 'invalid api key' }, 'auth'],
    [{ status: 403, body: 'forbidden' }, 'auth'],
    [{ status: 404, body: 'model not found' }, 'model'],
    [{ status: 400, body: 'bad request' }, 'request'],
    [{ status: 422, body: 'unprocessable' }, 'request'],
    [{ status: 500, body: 'internal error' }, 'other'],
    // In-stream business errors carry no HTTP status
    [{ providerCode: '1008', body: '余额不足' }, 'credit'],
    [{ providerCode: 'rate_limit', body: 'too many requests' }, 'rate'],
    [{ providerCode: '1234', body: 'unknown failure' }, 'other']
  ] as const)('classifies %j as %s', (input, expected) => {
    expect(classifyModelFailure({ ...input, now: NOW }).reason).toBe(expected)
  })

  it('parses Retry-After seconds and HTTP dates', () => {
    const headers = new Headers({ 'retry-after': '30' })
    expect(classifyModelFailure({ status: 429, headers, now: NOW }).retryAfterMs).toBe(30_000)
    const dated = new Headers({ 'retry-after': new Date(NOW + 5_000).toUTCString() })
    expect(classifyModelFailure({ status: 429, headers: dated, now: NOW }).retryAfterMs).toBe(5_000)
  })

  it('parses rate-limit reset headers (epoch seconds, durations, RFC3339)', () => {
    const epoch = new Headers({ 'x-ratelimit-reset-requests': String((NOW + 60_000) / 1_000) })
    const classified = classifyModelFailure({ status: 429, headers: epoch, now: NOW })
    expect(classified.retryAfterMs).toBe(60_000)
    expect(classified.resetAt).toBe(new Date(NOW + 60_000).toISOString())

    const duration = new Headers({ 'x-ratelimit-reset-tokens': '90s' })
    expect(classifyModelFailure({ status: 429, headers: duration, now: NOW }).resetAt)
      .toBe(new Date(NOW + 90_000).toISOString())

    const rfc3339 = new Headers({ 'anthropic-ratelimit-tokens-reset': new Date(NOW + 10_000).toISOString() })
    expect(classifyModelFailure({ status: 429, headers: rfc3339, now: NOW }).resetAt)
      .toBe(new Date(NOW + 10_000).toISOString())
  })

  it('picks the latest reset when no remaining dimension is exhausted', () => {
    const headers = new Headers({
      'x-ratelimit-reset-requests': String((NOW + 60_000) / 1_000),
      'x-ratelimit-reset-tokens': String((NOW + 5_000) / 1_000)
    })
    expect(classifyModelFailure({ status: 429, headers, now: NOW }).retryAfterMs).toBe(60_000)
  })

  it('prefers the reset of the dimension whose remaining count hit zero', () => {
    const headers = new Headers({
      'x-ratelimit-remaining-tokens': '0',
      'x-ratelimit-remaining-requests': '120',
      'x-ratelimit-reset-requests': '120ms',
      'x-ratelimit-reset-tokens': '6m0s'
    })
    const classified = classifyModelFailure({ status: 429, headers, now: NOW })
    expect(classified.retryAfterMs).toBe(360_000)
    expect(classified.resetAt).toBe(new Date(NOW + 360_000).toISOString())
  })

  it('pairs anthropic input/output dimensions with their resets', () => {
    const headers = new Headers({
      'anthropic-ratelimit-input-tokens-remaining': '0',
      'anthropic-ratelimit-input-tokens-reset': new Date(NOW + 30_000).toISOString(),
      'anthropic-ratelimit-output-tokens-remaining': '50',
      'anthropic-ratelimit-output-tokens-reset': new Date(NOW + 5_000).toISOString()
    })
    expect(classifyModelFailure({ status: 429, headers, now: NOW }).retryAfterMs).toBe(30_000)
  })

  it('keeps credit when only window resets hint a wait (insufficient_quota + reset header)', () => {
    const headers = new Headers({ 'x-ratelimit-reset-requests': '1s' })
    const classified = classifyModelFailure({
      status: 429,
      body: '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}',
      headers,
      now: NOW
    })
    expect(classified.reason).toBe('credit')
    expect(classified.retryAfterMs).toBe(1_000)
  })

  it('demotes credit to rate only on an explicit retry directive', () => {
    const headers = new Headers({ 'retry-after': '20' })
    const classified = classifyModelFailure({
      status: 429,
      body: '{"error":{"code":"insufficient_quota"}}',
      headers,
      now: NOW
    })
    expect(classified.reason).toBe('rate')
    expect(classified.retryAfterMs).toBe(20_000)
    const bodyHint = classifyModelFailure({
      status: 429,
      body: 'insufficient balance',
      retryAfterMs: 30_000,
      now: NOW
    })
    expect(bodyHint.reason).toBe('rate')
  })

  it('caps reset-derived delays at one hour', () => {
    const headers = new Headers({ 'retry-after': '7200' })
    expect(retryAfterHeaderMs(headers.get('retry-after'), NOW)).toBe(3_600_000)
  })
})

describe('modelFailureMetadata', () => {
  it('allows failover for deterministic reasons even on unusual statuses', () => {
    for (const [status, body] of [
      [400, '{"error":{"code":"exceeded_current_quota_error"}}'],
      [401, '余额不足'],
      [403, 'insufficient credit']
    ] as const) {
      const failure = modelFailureMetadata({ status, body })
      expect(failure.failoverAllowed).toBe(true)
      expect(failure.responseReceived).toBe(true)
      expect(failure.httpStatus).toBe(status)
    }
  })

  it('keeps request-model failures non-failoverable like the legacy map', () => {
    const failure = modelFailureMetadata({ status: 400, body: 'bad request' })
    expect(failure).toMatchObject({
      category: 'request',
      reason: 'request',
      failoverAllowed: false
    })
  })

  it('maps in-stream quota errors to failover-allowed metadata', () => {
    const failure = modelFailureMetadata({
      providerCode: 'exceeded_current_quota_error',
      body: 'exceeded current quota',
      responseReceived: true
    })
    expect(failure.reason).toBe('quota')
    expect(failure.category).toBe('quota')
    expect(failure.failoverAllowed).toBe(true)
  })
})

describe('httpRetryBudget', () => {
  const policy = { maxAttempts: 5 }

  it('never retries credit or quota failures', () => {
    expect(httpRetryBudget({ reason: 'credit', policy }).maxAttempts).toBe(0)
    expect(httpRetryBudget({ reason: 'quota', policy }).maxAttempts).toBe(0)
  })

  it('lets a single provider keep its configured retries, floored at the hint', () => {
    expect(httpRetryBudget({ reason: 'rate', retryAfterMs: 5_000, policy }))
      .toEqual({ maxAttempts: 5, minDelayMs: 5_000 })
    expect(httpRetryBudget({ reason: 'rate', policy }).maxAttempts).toBe(5)
  })

  it('refuses same-target waits past sixty seconds on a single provider', () => {
    expect(httpRetryBudget({ reason: 'rate', retryAfterMs: 360_000, policy }).maxAttempts).toBe(0)
    expect(httpRetryBudget({ reason: 'rate', retryAfterMs: 60_001, policy }).maxAttempts).toBe(0)
    expect(httpRetryBudget({ reason: 'rate', retryAfterMs: 60_000, policy }))
      .toEqual({ maxAttempts: 5, minDelayMs: 60_000 })
  })

  it('waits once for a short provider Retry-After when alternatives exist', () => {
    expect(httpRetryBudget({ reason: 'rate', retryAfterMs: 5_000, policy, alternatives: 2 }))
      .toEqual({ maxAttempts: 1, fixedDelayMs: 5_000 })
  })

  it('skips same-target rate retries when failover alternatives exist', () => {
    expect(httpRetryBudget({ reason: 'rate', retryAfterMs: 60_000, policy, alternatives: 2 }).maxAttempts).toBe(0)
    expect(httpRetryBudget({ reason: 'rate', retryAfterMs: 21_000, policy, alternatives: 1 }).maxAttempts).toBe(0)
    expect(httpRetryBudget({ reason: 'rate', policy, alternatives: 1 }).maxAttempts).toBe(0)
  })

  it('caps overload retries to one fast attempt when alternatives exist', () => {
    expect(httpRetryBudget({ reason: 'overloaded', policy, alternatives: 1 }))
      .toEqual({ maxAttempts: 1, delayCapMs: 3_000 })
    expect(httpRetryBudget({ reason: 'other', policy, alternatives: 1 }))
      .toEqual({ maxAttempts: 1, delayCapMs: 3_000 })
  })

  it('keeps the configured policy for other reasons without alternatives', () => {
    expect(httpRetryBudget({ reason: 'auth', policy }).maxAttempts).toBe(5)
    expect(httpRetryBudget({ reason: 'request', policy }).maxAttempts).toBe(5)
    expect(httpRetryBudget({ reason: 'overloaded', policy }).maxAttempts).toBe(5)
  })
})

describe('retryDelayForBudget', () => {
  const response = (headers: Record<string, string>) => ({
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }
  })

  it('applies fixed delay, then floors and caps the computed backoff', () => {
    expect(retryDelayForBudget({
      response: response({}),
      budget: { fixedDelayMs: 5_000 },
      initialDelayMs: 1_000,
      attempt: 0
    })).toBe(5_000)

    // minDelayMs raises the backoff to the provider-declared wait.
    const floored = retryDelayForBudget({
      response: response({}),
      budget: { minDelayMs: 5_000 },
      initialDelayMs: 100,
      attempt: 0
    })
    expect(floored).toBe(5_000)

    // delayCapMs still trims a larger backoff.
    const capped = retryDelayForBudget({
      response: response({ 'retry-after': '60' }),
      budget: { delayCapMs: 3_000 },
      initialDelayMs: 100,
      attempt: 0
    })
    expect(capped).toBe(3_000)
  })
})

describe('circuitCooldownMs', () => {
  const policy = {
    failureThreshold: 3,
    cooldownMs: 60_000,
    creditCooldownMs: 1_800_000,
    quotaCooldownMs: 900_000,
    authCooldownMs: 1_800_000,
    maxCooldownMs: 600_000
  }

  it.each(['credit', 'quota', 'rate', 'auth'] as const)('opens on the first %s failure', (reason) => {
    expect(circuitCooldownMs({ reason, consecutiveFailures: 1, policy, now: NOW }).open).toBe(true)
  })

  it('uses reason-specific durations', () => {
    expect(circuitCooldownMs({ reason: 'credit', consecutiveFailures: 1, policy, now: NOW }).durationMs).toBe(1_800_000)
    expect(circuitCooldownMs({ reason: 'auth', consecutiveFailures: 1, policy, now: NOW }).durationMs).toBe(1_800_000)
    expect(circuitCooldownMs({ reason: 'rate', consecutiveFailures: 1, policy, now: NOW }).durationMs).toBe(60_000)
    expect(circuitCooldownMs({ reason: 'rate', retryAfterMs: 12_000, consecutiveFailures: 1, policy, now: NOW }).durationMs).toBe(12_000)
  })

  it('prefers the provider reset time for quota failures', () => {
    const resetAt = new Date(NOW + 120_000).toISOString()
    expect(circuitCooldownMs({ reason: 'quota', resetAt, consecutiveFailures: 1, policy, now: NOW }).durationMs).toBe(120_000)
    expect(circuitCooldownMs({ reason: 'quota', consecutiveFailures: 1, policy, now: NOW }).durationMs).toBe(900_000)
  })

  it('stays closed below the threshold for other failures, then backs off exponentially', () => {
    expect(circuitCooldownMs({ reason: 'other', consecutiveFailures: 2, policy, now: NOW }).open).toBe(false)
    expect(circuitCooldownMs({ reason: 'other', consecutiveFailures: 3, policy, now: NOW }).durationMs).toBe(60_000)
    expect(circuitCooldownMs({ reason: 'other', consecutiveFailures: 4, policy, now: NOW }).durationMs).toBe(120_000)
    expect(circuitCooldownMs({ reason: 'other', consecutiveFailures: 10, policy, now: NOW }).durationMs).toBe(600_000)
  })
})

describe('reasonAllowsFailover', () => {
  it('allows credit/quota/rate/overloaded only', () => {
    for (const reason of ['credit', 'quota', 'rate', 'overloaded'] as const) {
      expect(reasonAllowsFailover(reason)).toBe(true)
    }
    for (const reason of ['auth', 'model', 'request', 'other'] as const) {
      expect(reasonAllowsFailover(reason)).toBe(false)
    }
  })
})
