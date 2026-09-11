import { describe, expect, it } from 'vitest'
import { RoomDispatchIntentSchema, RoomDispatchReconciler } from './room-dispatch-reconciler.js'
import { createRoomTaskWorktree } from './task-workspace-service.js'
import { SendRoomMessageSchema } from '../contracts/rooms.js'

const pending = {
  id: 'dispatch_one', roomId: 'room_one', taskId: 'task_one', stepId: 'step_one',
  attemptId: 'attempt_one', threadId: 'thread_one', clientRequestId: 'request_one',
  requestFingerprint: 'a'.repeat(64), state: 'pending' as const, revision: 0
}

describe('room boundary regressions', () => {
  it('rejects an admitted intent without a valid turn identity', () => {
    for (const turnId of [undefined, '', '   ']) {
      expect(RoomDispatchIntentSchema.safeParse({ ...pending, state: 'admitted', turnId }).success).toBe(false)
    }
  })
  it('does not save a malformed admission result', async () => {
    let writes = 0
    const reconciler = new RoomDispatchReconciler({
      load: async () => pending,
      save: async () => { writes += 1 },
      assertOwnership: async () => {}
    }, {
      ensureThread: async () => {},
      findAdmission: async () => ({ status: 'found', turnId: '', requestFingerprint: pending.requestFingerprint }),
      enqueue: async () => ({ turnId: '' })
    })
    await expect(reconciler.dispatch(pending.id)).rejects.toThrow()
    expect(writes).toBe(0)
  })
  it('rejects a relative destination before ownership or Git side effects', async () => {
    let ownershipChecks = 0
    await expect(createRoomTaskWorktree({
      repository: { root: '/not-used', commonDir: '/not-used/.git', head: 'a'.repeat(40),
        branch: 'refs/heads/develop', dirty: false, operationInProgress: false },
      taskId: 'task_one', destination: 'relative-directory',
      assertOwnership: async () => { ownershipChecks += 1 }
    })).rejects.toThrow('absolute paths')
    expect(ownershipChecks).toBe(0)
  })
  it('accepts attachment-only messages but rejects empty messages', () => {
    expect(SendRoomMessageSchema.safeParse({ clientRequestId: 'one', body: '', attachmentIds: ['attachment'] }).success).toBe(true)
    expect(SendRoomMessageSchema.safeParse({ clientRequestId: 'one', body: '' }).success).toBe(false)
  })
})
