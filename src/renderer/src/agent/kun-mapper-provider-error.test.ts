import { describe, expect, it } from 'vitest'
import {
  runtimeErrorFromEvent,
  runtimeErrorFromItem,
  systemErrorBlockFromItem
} from './kun-mapper-projection'

const provenance = {
  requestState: 'provider_responded' as const,
  providerId: 'codex',
  model: 'gpt-5.6-sol',
  providerCode: 'server_is_overloaded',
  category: 'unavailable' as const
}

describe('Kun provider error projection', () => {
  it('preserves provenance and redacts provider messages from live events', () => {
    const projected = runtimeErrorFromEvent({
      kind: 'error', threadId: 'thread_1', turnId: 'turn_1', seq: 1,
      timestamp: '2026-08-31T00:00:00.000Z',
      message: 'provider rejected Authorization: Bearer sk-secret-value-1234567890',
      modelRequestFailure: provenance
    }, 'fallback')
    expect(projected.modelRequestFailure).toEqual(provenance)
    expect(projected.message).not.toContain('sk-secret-value')
  })

  it('preserves interruption details from both event and durable item', () => {
    const details = { modelFailure: { responsePhase: 'interrupted', partialOutput: true } }
    const event = runtimeErrorFromEvent({ kind: 'error', threadId: 'thread_1', turnId: 'turn_1',
      seq: 1, timestamp: '2026-08-31T00:00:00.000Z', code: 'stream_disconnected', message: 'ended', details }, 'fallback')
    expect(event.details).toEqual(details)
    const item = { id: 'error_1', threadId: 'thread_1', turnId: 'turn_1', role: 'system' as const,
      status: 'failed', createdAt: '2026-08-31T00:00:00.000Z', kind: 'error',
      code: 'stream_disconnected', message: 'ended', details }
    expect(systemErrorBlockFromItem(item)).toMatchObject({ streamPartialOutput: true })
  })

  it('restores the same provenance from a durable Error Item', () => {
    const item = {
      id: 'error_1', threadId: 'thread_1', turnId: 'turn_1', role: 'system' as const,
      status: 'failed', createdAt: '2026-08-31T00:00:00.000Z', kind: 'error',
      message: 'overloaded', modelRequestFailure: provenance
    }
    expect(runtimeErrorFromItem(item).modelRequestFailure).toEqual(provenance)
    expect(systemErrorBlockFromItem(item)).toMatchObject({
      runtimeError: true, modelRequestFailure: provenance
    })
  })
})
