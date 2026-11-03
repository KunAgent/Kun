import { describe, expect, it } from 'vitest'
import { remoteFixture } from '../testing/runtime.test-support.js'

describe('Goal revision control through the native remote boundary', () => {
  it('goal CAS excludes usage counters, preserves budgets and refuses competing writes', async () => {
    const f = await remoteFixture()
    try {
      const thread = await f.code(), empty = await f.call('goal.get', { threadId: thread.id })
      const created = (await f.call('goal.update', { threadId: thread.id, expectedRevision: empty.revision,
        objective: 'Implement safely', tokenBudget: 100 })).receipt.result
      await f.h.threads.recordGoalUsage(thread.id, 5)
      expect((await f.call('goal.get', { threadId: thread.id })).revision).toBe(created.revision)
      const paused = (await f.call('goal.update', { threadId: thread.id, expectedRevision: created.revision, status: 'paused' })).receipt
      expect(paused.result.goal).toMatchObject({ status: 'paused', tokensUsed: 5, tokenBudget: 100 })
      expect((await f.call('goal.clear', { threadId: thread.id, expectedRevision: created.revision })).receipt.error?.code).toBe('REVISION_CONFLICT')
      const cleared = (await f.call('goal.clear', { threadId: thread.id, expectedRevision: paused.result.revision })).receipt
      expect(cleared.result.goal).toBeNull()
      expect(cleared.result.revision).not.toBe(empty.revision)
      expect((await f.call('goal.update', { threadId: thread.id, expectedRevision: empty.revision, objective: 'stale recreate' })).receipt.error?.code).toBe('REVISION_CONFLICT')
    } finally { await f.close() }
  })
})
