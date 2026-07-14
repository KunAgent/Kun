import { describe, expect, it } from 'vitest'
import {
  IpcCancellationAckSchema,
  IpcCancellationRequestSchema,
  IpcOperationRequestSchema,
  IpcOperationTerminalSchema
} from './ipc-cancellation'

const timestamp = '2026-07-14T00:00:00.000Z'

describe('IPC cancellation contract', () => {
  it('uses one bounded request identity across the lifecycle', () => {
    const request = IpcOperationRequestSchema.parse({
      requestId: 'transfer_1',
      operation: 'project-export'
    })
    const cancel = IpcCancellationRequestSchema.parse({
      requestId: request.requestId,
      reason: 'user-requested',
      requestedAt: timestamp
    })
    const ack = IpcCancellationAckSchema.parse({
      requestId: cancel.requestId,
      status: 'accepted',
      acknowledgedAt: timestamp
    })
    expect(ack.requestId).toBe(request.requestId)
  })

  it('allows an idempotent acknowledgement for an already terminal request', () => {
    expect(IpcCancellationAckSchema.parse({
      requestId: 'probe_1',
      status: 'already-terminal',
      acknowledgedAt: timestamp
    }).status).toBe('already-terminal')
  })

  it('represents cancellation as a terminal outcome, not as an error-only response', () => {
    expect(IpcOperationTerminalSchema.parse({
      requestId: 'index_1',
      status: 'cancelled',
      finishedAt: timestamp
    }).status).toBe('cancelled')
  })

  it('rejects invalid timestamps, empty identities, and unbounded extra fields', () => {
    expect(() => IpcOperationRequestSchema.parse({ requestId: '', operation: 'probe' })).toThrow()
    expect(() => IpcCancellationRequestSchema.parse({
      requestId: 'probe_1',
      requestedAt: 'now'
    })).toThrow()
    expect(() => IpcOperationTerminalSchema.parse({
      requestId: 'probe_1',
      status: 'cancelled',
      finishedAt: timestamp,
      stack: 'secret'
    })).toThrow()
  })
})
