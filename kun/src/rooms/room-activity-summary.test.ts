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
    await f.store.commit({ requestId: 'other-room-task', checks: [{ kind: 'task', id: 'other-task', expectedRevision: null }],
      puts: [{ kind: 'task', id: 'other-task', roomId: 'another-room',
        value: { task: { id: 'other-task', status: 'completed' } } }] })
    await integration(f, 'other-room-integration', { status: 'ready' }, 'other-task', 'another-room')
    expect(await roomActivitySummary(f.store, f.room.id)).toEqual({ runningCount: 1, attentionCount: 1 })
    expect(await f.product.attention()).toEqual({ attentionCount: 2 })
  })

  it('counts beyond a page of pending integrations and ignores completed history', async () => {
    const f = await fixture()
    for (let start = 0; start < 1007; start += 500) {
      const puts: NonNullable<RoomStoreCommit['puts']> = []
      for (let i = start; i < Math.min(1007, start + 500); i++) {
        const id = 'integration_' + i
        const taskId = 'unique-task-' + i
        puts.push({ kind: 'task', id: taskId, roomId: f.room.id, taskId,
          value: { task: { id: taskId, status: 'completed' } } })
        puts.push({ kind: 'integration', id, roomId: f.room.id, taskId,
          value: { taskId, status: i < 1005 ? 'ready' : 'applied', diff: 'omitted history' } })
      }
      await f.store.commit({ requestId: 'batch-' + start, puts,
        checks: puts.map((put) => ({ kind: put.kind, id: put.id, expectedRevision: null })) })
    }
    expect(await roomActivitySummary(f.store, f.room.id)).toEqual({ runningCount: 0, attentionCount: 1005 })
  })

  it('ignores orphan integrations and superseded peer requests', async () => {
    const f = await fixture()
    await integration(f, 'orphan', { status: 'ready' }, 'missing-task')
    await f.store.commit({ requestId: 'peer-history', checks: [
      { kind: 'request', id: 'root', expectedRevision: null },
      { kind: 'request', id: 'old', expectedRevision: null },
      { kind: 'request', id: 'older', expectedRevision: null }
    ], puts: [
      { kind: 'request', id: 'root', roomId: f.room.id, value: {
        id: 'root', status: 'completed', collaborationProtocol: 'peer', rootRequestId: 'root',
        peerLatestRequestId: 'latest', message: { body: 'Root' } } },
      { kind: 'request', id: 'old', roomId: f.room.id, value: {
        id: 'old', status: 'needs_input', collaborationProtocol: 'peer', rootRequestId: 'root',
        message: { body: 'Old clarify' } } },
      { kind: 'request', id: 'older', roomId: f.room.id, value: {
        id: 'older', status: 'failed', collaborationProtocol: 'peer', rootRequestId: 'root',
        message: { body: 'Older fail' } } }
    ] })
    expect(await roomActivitySummary(f.store, f.room.id)).toEqual({ runningCount: 0, attentionCount: 0 })
    expect(await f.product.attention()).toEqual({ attentionCount: 0 })
    expect((await f.product.requestPage(f.room.id, { attentionOnly: true })).requests).toEqual([])
    await f.store.commit({ requestId: 'peer-current', checks: [{ kind: 'request', id: 'latest', expectedRevision: null }],
      puts: [{ kind: 'request', id: 'latest', roomId: f.room.id, value: {
        id: 'latest', status: 'needs_input', collaborationProtocol: 'peer', rootRequestId: 'root',
        message: { body: 'Need a repository' }, sourceMessageId: 'source' } }] })
    expect(await roomActivitySummary(f.store, f.room.id)).toEqual({ runningCount: 0, attentionCount: 1 })
    expect((await f.product.requestPage(f.room.id, { attentionOnly: true })).requests.map((row) => row.id))
      .toEqual(['latest'])
    await f.store.commit({ requestId: 'legacy-clarify', checks: [{ kind: 'request', id: 'legacy', expectedRevision: null }],
      puts: [{ kind: 'request', id: 'legacy', roomId: f.room.id, value: {
        id: 'legacy', status: 'needs_input', collaborationProtocol: 'legacy',
        message: { body: 'Independent clarify' }, sourceMessageId: 'legacy-source' } }] })
    expect(await roomActivitySummary(f.store, f.room.id)).toEqual({ runningCount: 0, attentionCount: 2 })
  })
})
