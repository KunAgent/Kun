import { describe, expect, it } from 'vitest'
import { ErrorEvent, TurnLifecycleEvent } from './events.js'
import { ErrorTurnItem } from './items.js'
import { ModelRequestFailureContextSchema } from './model-request-failure.js'

const providerFailure = {
  requestState: 'provider_responded' as const,
  providerId: 'codex',
  model: 'gpt-5.6-sol',
  httpStatus: 503,
  providerCode: 'server_is_overloaded',
  category: 'unavailable' as const,
  retryAfterMs: 3_000
}

describe('model request failure provenance contracts', () => {
  it('accepts safe structured provider failure metadata', () => {
    expect(ModelRequestFailureContextSchema.parse(providerFailure)).toEqual(providerFailure)
  })

  it('persists provenance on live, terminal, and item contracts', () => {
    expect(ErrorEvent.parse({
      seq: 1, timestamp: '2026-08-31T00:00:00.000Z', threadId: 'thread_1',
      turnId: 'turn_1', kind: 'error', message: 'overloaded',
      modelRequestFailure: providerFailure
    }).modelRequestFailure).toEqual(providerFailure)
    expect(TurnLifecycleEvent.parse({
      seq: 2, timestamp: '2026-08-31T00:00:01.000Z', threadId: 'thread_1',
      turnId: 'turn_1', kind: 'turn_failed', message: 'overloaded',
      modelRequestFailure: providerFailure
    }).modelRequestFailure).toEqual(providerFailure)
    expect(ErrorTurnItem.parse({
      id: 'error_1', threadId: 'thread_1', turnId: 'turn_1', role: 'system',
      status: 'failed', createdAt: '2026-08-31T00:00:00.000Z', kind: 'error',
      message: 'overloaded', modelRequestFailure: providerFailure
    }).modelRequestFailure).toEqual(providerFailure)
  })

  it('keeps legacy errors valid without provenance', () => {
    expect(ErrorEvent.parse({
      seq: 1, timestamp: '2026-08-31T00:00:00.000Z', threadId: 'thread_1',
      kind: 'error', message: 'legacy failure'
    }).modelRequestFailure).toBeUndefined()
  })
})
