import { afterEach, describe, expect, it } from 'vitest'
import { productServiceFixture } from '../../tests/room-product-service-test-fixture.js'
import { roomActivitySummary } from './room-activity-summary.js'
import type { RoomStoreCommit } from './room-store.js'

const fixtures: Awaited<ReturnType<typeof productServiceFixture>>[] = []
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close() })
async function fixture() {
  const f = await productServiceFixture()
  fixtures.push(f)
  await f.updateTask({ task: { ...f.execution.task, status: 'completed' } })
  return f
}
async function integration(f: Awaited<ReturnType<typeof fixture>>, id: string, value: object, taskId = f.execution.task.id, roomId = f.room.id) {
  await f.store.commit({ requestId: id, checks: [{ kind: 'integration', id, expectedRevision: null }],
    puts: [{ kind: 'integration', id, roomId, taskId, value: { taskId, ...value } }] })
}

describe('room task and integration activity badges', () => {
  it.each([
    [{ status: 'preparing' }, 1, 0],
    [{ status: 'validating' }, 1, 0],
    [{ status: 'validating', attention: { approvalIds: ['approval'], userInputIds: [] } }, 1, 1],
    [{ status: 'validating', attention: { approvalIds: [], userInputIds: ['input'] } }, 1, 1],
    [{ status: 'recovery_required' }, 0, 1],
    [{ status: 'conflict' }, 0, 1],
    [{ status: 'ready' }, 0, 1],
    [{ status: 'failed' }, 0, 1],
    [{ status: 'failed', cancelRequested: true }, 0, 0],
    [{ status: 'failed', cancelRequested: true, applyIntent: { candidateSha: 'uncertain' } }, 0, 1],
    [{ status: 'applied' }, 0, 0]
  ] as const)('includes completed task integrations in state %j', async (value, runningCount, attentionCount) => {
    const f = await fixture()
    await integration(f, 'integration', value)
    expect(await roomActivitySummary(f.store, f.room.id)).toEqual({ runningCount, attentionCount })
    expect(await f.product.attention()).toEqual({ attentionCount })
  })

  it('deduplicates task and multiple integration needs per task while retaining both independent categories', async () => {
    const f = await fixture()
    await f.updateTask({ task: { ...f.execution.task, status: 'awaiting_acceptance' } })
    await integration(f, 'integration-ready', { status: 'ready' })
    await integration(f, 'integration-gate', { status: 'validating', attention: { approvalIds: ['one', 'two'], userInputIds: ['three'] } })
    expect(await roomActivitySummary(f.store, f.room.id)).toEqual({ runningCount: 1, attentionCount: 1 })
    await integration(f, 'other-room-integration', { status: 'ready' }, f.execution.task.id, 'another-room')
    expect(await roomActivitySummary(f.store, f.room.id)).toEqual({ runningCount: 1, attentionCount: 1 })
    expect(await f.product.attention()).toEqual({ attentionCount: 2 })
  })

  it('counts beyond a page of pending integrations and ignores completed history', async () => {
    const f = await fixture()
    for (let start = 0; start < 1007; start += 500) {
      const puts: NonNullable<RoomStoreCommit['puts']> = []
      for (let i = start; i < Math.min(1007, start + 500); i++) {
        const id = 'integration_' + i
        puts.push({ kind: 'integration', id, roomId: f.room.id, taskId: 'unique-task-' + i,
          value: { taskId: 'unique-task-' + i, status: i < 1005 ? 'ready' : 'applied', diff: 'omitted history' } })
      }
      await f.store.commit({ requestId: 'batch-' + start, puts,
        checks: puts.map((put) => ({ kind: put.kind, id: put.id, expectedRevision: null })) })
    }
    expect(await roomActivitySummary(f.store, f.room.id)).toEqual({ runningCount: 0, attentionCount: 1005 })
  })
})
