import { describe, expect, it } from 'vitest'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import {
  projectPublicThreadRecord,
  projectPublicTurn,
  projectTimelineTurn
} from './thread-projection.js'

describe('Manager settlement projection', () => {
  it('keeps internal recovery provenance out of public turn and thread responses', () => {
    const turn = {
      ...createTurnRecord({
        id: 'turn_expired',
        threadId: 'thread_expired',
        prompt: 'continue',
        status: 'failed',
        createdAt: '2026-08-30T00:00:00.000Z'
      }),
      terminalCode: 'owner_lease_expired',
      managerLeaseSettlement: {
        code: 'owner_lease_expired' as const,
        ownerFlavor: 'production' as const,
        ownerInstanceId: 'runtime_old',
        fencingToken: 7,
        settledAt: '2026-08-30T00:01:00.000Z'
      }
    }
    const thread = createThreadRecord({
      id: turn.threadId,
      title: 'Expired owner',
      workspace: '/workspace',
      model: 'test-model',
      createdAt: turn.createdAt
    })
    thread.turns = [turn]

    for (const projected of [
      projectPublicTurn(turn),
      projectTimelineTurn(turn, turn.items),
      projectPublicThreadRecord(thread).turns[0]
    ]) {
      expect(projected).not.toHaveProperty('terminalCode')
      expect(projected).not.toHaveProperty('managerLeaseSettlement')
    }
  })
})
