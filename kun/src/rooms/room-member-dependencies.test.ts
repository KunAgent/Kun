import { afterEach, describe, expect, it } from 'vitest'
import { productServiceFixture } from '../../tests/room-product-service-test-fixture.js'
import type { RoomRequestState, RoomTaskExecution } from './room-runtime-types.js'
import type { RoomStoreCommit } from './room-store.js'

const fixtures: Awaited<ReturnType<typeof productServiceFixture>>[] = []
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close() })
async function fixture() { const f = await productServiceFixture(); fixtures.push(f); return f }
function remove(f: Awaited<ReturnType<typeof fixture>>, memberId: string, extra: object = {}) {
  return { clientRequestId: 'remove_' + memberId, expectedRevision: f.room.revision,
    members: f.room.members.filter((member) => member.id !== memberId).map((member) =>
      member.reviewPolicy?.reviewerMemberId === memberId ? { ...member, reviewPolicy: undefined } : member), ...extra }
}

async function seedTasks(f: Awaited<ReturnType<typeof fixture>>, count: number, activeAt: number, reviewer = false) {
  const other = f.room.members.find((member) => member.id === 'coordinator')!
  for (let start = 0; start < count; start += 500) {
    const puts: NonNullable<RoomStoreCommit['puts']> = []
    for (let i = start; i < Math.min(count, start + 500); i++) {
      const id = 'task_seed_' + i
      const owner = i === activeAt && !reviewer ? f.execution.task.memberSnapshot : other
      const value: RoomTaskExecution = { ...f.execution,
        task: { ...f.execution.task, id, ownerMemberId: owner.id, memberSnapshot: owner, status: 'running' },
        ...(i === activeAt && reviewer ? { reviewer: f.room.members.find((member) => member.id === 'reviewer')! } : {}) }
      puts.push({ kind: 'task', id, roomId: f.room.id, taskId: id, value })
    }
    await f.store.commit({ requestId: 'seed-' + start, puts,
      checks: puts.map((put) => ({ kind: put.kind, id: put.id, expectedRevision: null })) })
  }
}

describe('safe room member removal', () => {
  it('finds an active owner beyond the first thousand task records', async () => {
    const f = await fixture()
    await seedTasks(f, 1005, 1004)
    await expect(f.service.update(f.room.id, remove(f, 'developer'))).rejects.toThrow('existing task')
    expect((await f.service.get(f.room.id)).members.some((member) => member.id === 'developer')).toBe(true)
  })

  it('protects a frozen reviewer after the first task page even though another member owns the task', async () => {
    const f = await fixture()
    await seedTasks(f, 1005, 1004, true)
    await expect(f.service.update(f.room.id, remove(f, 'reviewer'))).rejects.toThrow('existing task')
  })

  it('protects configured future review dependencies and blocks removedAt as well as deletion', async () => {
    const f = await fixture()
    await f.updateTask({ task: { ...f.execution.task, status: 'queued', memberSnapshot: {
      ...f.execution.task.memberSnapshot, reviewPolicy: { reviewerMemberId: 'reviewer', allowAutomaticRework: true, maxReworkRounds: 2 } } } })
    await expect(f.service.update(f.room.id, remove(f, 'reviewer'))).rejects.toThrow('existing task')
    await expect(f.service.update(f.room.id, { clientRequestId: 'tombstone', expectedRevision: f.room.revision,
      members: f.room.members.map((member) => member.id === 'reviewer' ? {
        ...member, enabled: false, removedAt: new Date().toISOString() } : member) })).rejects.toThrow('existing task')
  })

  it('retains an accepted request roster until pending coordination or discussion finishes', async () => {
    const f = await fixture()
    const sent = await f.service.send(f.room.id, { clientRequestId: 'accepted', body: 'Discuss a solution.' })
    await expect(f.service.update(f.room.id, remove(f, 'reviewer'))).rejects.toThrow('existing request')
    const request = (await f.store.get<RoomRequestState>('request', sent.requestId))!
    await f.store.commit({ requestId: 'finish-request', checks: [{ kind: 'request', id: request.id, expectedRevision: request.revision }],
      puts: [{ kind: 'request', id: request.id, roomId: f.room.id, value: { ...request.value, status: 'completed' } }] })
    expect((await f.service.update(f.room.id, remove(f, 'reviewer'))).room.members.some((member) => member.id === 'reviewer')).toBe(false)
  })

  it.each(['preparing', 'conflict', 'validating', 'ready', 'recovery_required'])('retains reviewers used by %s integration on a completed task', async (status) => {
    const f = await fixture()
    await f.updateTask({ task: { ...f.execution.task, status: 'completed' }, reviewer: f.room.members.find((member) => member.id === 'reviewer')! })
    await f.store.commit({ requestId: 'integration', checks: [{ kind: 'integration', id: 'integration', expectedRevision: null }],
      puts: [{ kind: 'integration', id: 'integration', roomId: f.room.id, taskId: f.execution.task.id,
        value: { id: 'integration', taskId: f.execution.task.id, status } }] })
    await expect(f.service.update(f.room.id, remove(f, 'reviewer'))).rejects.toThrow('existing integration')
  })

  it('retains an owner while a direct application is unresolved and fails closed for missing integration ownership', async () => {
    const f = await fixture()
    await f.store.commit({ requestId: 'application', checks: [{ kind: 'attempt', id: 'application', expectedRevision: null }],
      puts: [{ kind: 'attempt', id: 'application', roomId: f.room.id, taskId: f.execution.task.id, value: { status: 'applying' } }] })
    await expect(f.service.update(f.room.id, remove(f, 'developer'))).rejects.toThrow('existing application')
    await f.store.commit({ requestId: 'orphan-integration', checks: [{ kind: 'integration', id: 'orphan', expectedRevision: null }],
      puts: [{ kind: 'integration', id: 'orphan', roomId: f.room.id, taskId: 'missing', value: { status: 'validating' } }] })
    await expect(f.service.update(f.room.id, remove(f, 'reviewer'))).rejects.toThrow('cannot be verified')
  })

  it('allows disabling or editing active members without changing their frozen execution configuration', async () => {
    const f = await fixture()
    await f.updateTask({ task: { ...f.execution.task, status: 'running' } })
    const frozen = (await f.task()).value.task.memberSnapshot
    const result = await f.service.update(f.room.id, { clientRequestId: 'disable', expectedRevision: f.room.revision,
      members: f.room.members.map((member) => member.id === 'developer' ? { ...member, enabled: false, displayName: 'New name' } : member) })
    expect(result.room.members.find((member) => member.id === 'developer')).toMatchObject({ enabled: false, displayName: 'New name' })
    expect((await f.task()).value.task.memberSnapshot).toEqual(frozen)
  })

  it('does not block removal because of finished history or activity in another room', async () => {
    const f = await fixture()
    await f.updateTask({ task: { ...f.execution.task, status: 'completed' }, reviewer: f.room.members.find((member) => member.id === 'reviewer')! })
    await f.store.commit({ requestId: 'other-room', checks: [{ kind: 'task', id: 'other', expectedRevision: null }],
      puts: [{ kind: 'task', id: 'other', roomId: 'different-room', taskId: 'other', value: {
        ...f.execution, task: { ...f.execution.task, id: 'other', roomId: 'different-room', status: 'running' } } }] })
    const body = remove(f, 'developer')
    const result = await f.service.update(f.room.id, body)
    expect(result.room.members.some((member) => member.id === 'developer')).toBe(false)
    expect(await f.service.update(f.room.id, body)).toEqual(result)
    expect((await f.task()).value.task.memberSnapshot.id).toBe('developer')
  })
})
