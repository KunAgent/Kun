import { afterEach, describe, expect, it } from 'vitest'
import { nativeFollowUpTargetFingerprint } from '../../domain/native-followup-target.js'
import { RoomTaskSchema } from '../../contracts/room-tasks.js'
import { WorkbenchLinkSchema } from '../../contracts/workbench-links.js'
import { putRoomDocument } from '../../rooms/room-service.js'
import { updateWorkbenchLink } from '../../workbench-bridge/link-store.js'
import { followUpFixture, type FollowUpFixture } from './followup-test-support.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture() { const f = await followUpFixture(); cleanups.push(f.cleanup); return f }
const action = (clientRequestId: string, expectedControlRevision: number) => ({ clientRequestId, expectedControlRevision })
async function enable(f: FollowUpFixture) { return f.followUp.enable('agent-1', f.commitment.id, f.enable) }
async function own(f: FollowUpFixture, target: object, ownership = 'owned') {
  return f.followUp.link('agent-1', f.commitment.id, { ...action('link', 0), target, ownership, userEvidence: f.userEvidence })
}
async function workbench(f: FollowUpFixture, threadId: string) {
  const now = new Date().toISOString()
  const link = WorkbenchLinkSchema.parse({ schemaVersion: 1, id: 'workbench', roomId: f.room.id,
    participantAgentId: 'agent-1', memberId: f.room.members[0]!.id, kind: 'code_task', surface: 'code',
    status: 'awaiting_confirmation', origin: { kind: 'user', action: 'send_to_bot' },
    request: { title: 'Fix existing work', goal: 'Apply the agreed repair', workspaceRoot: f.directory },
    messageId: 'workbench-card', threadId, createdAt: now, updatedAt: now })
  await putRoomDocument(f.store, 'workbench_link', link.id, f.room.id, link, null)
  return link
}
async function roomTask(f: FollowUpFixture, threadId: string, id = 'room-task') {
  const task = RoomTaskSchema.parse({ id, roomId: f.room.id, requestId: 'request', sourceMessageId: f.source.id,
    title: 'Fix existing work', ownerMemberId: f.room.members[0]!.id, memberSnapshot: f.room.members[0],
    repositoryId: 'repo', workspaceId: 'workspace', executionThreadId: threadId, status: 'queued', stage: 'develop',
    requirementRevision: 0, revision: 0, updatedAt: new Date().toISOString() })
  const execution = { task, prompt: 'Fix existing work', attachmentIds: [], dependencyTaskIds: [], attempt: 1,
    reworkRounds: 0, configuration: null }
  await putRoomDocument(f.store, 'task', id, f.room.id, execution, null)
  return execution
}

describe('tracked commitments at legacy and native persistence boundaries', () => {
  it.each(['thread', 'workbench_link', 'room_task'] as const)('freezes the real %s target authority at ownership', async (kind) => {
    const f = await fixture(), target = f.addTarget()
    const wb = kind === 'workbench_link' ? await workbench(f, target.threadId) : undefined
    const task = kind === 'room_task' ? await roomTask(f, target.threadId) : undefined
    const requested = kind === 'thread' ? target : kind === 'workbench_link'
      ? { kind, linkId: wb!.id, threadId: target.threadId } : { kind, taskId: task!.task.id }
    const original = f.stub.threads.get(target.threadId)!
    await enable(f)
    const linked = await own(f, requested)
    expect(linked.link.nativeTarget).toEqual({ threadId: target.threadId, fingerprint: nativeFollowUpTargetFingerprint(original) })
    const before = await f.store.get('commitment_link', linked.link.id)
    const changed = { ...linked.link, nativeTarget: { ...linked.link.nativeTarget!, fingerprint: 'b'.repeat(64) } }
    await expect(putRoomDocument(f.store, 'commitment_link', linked.link.id, f.room.id, changed, before))
      .rejects.toThrow('identity cannot change')
    expect(await f.store.get('commitment_link', linked.link.id)).toEqual(before)
  })

  it.each(['pause', 'disable', 'stop'] as const)('does not let old Workbench confirm bypass %s', async (controlAction) => {
    const f = await fixture(), target = f.addTarget()
    const wb = await workbench(f, target.threadId)
    await enable(f); await own(f, target)
    if (controlAction === 'stop') await f.followUp.stop('agent-1', f.commitment.id, {
      ...action('stop', 1), scope: 'commitment', targetId: f.commitment.id })
    else await f.followUp.action('agent-1', f.commitment.id, controlAction, action(controlAction, 1))
    await expect(updateWorkbenchLink(f.store, f.room.id, wb.id, () => ({ status: 'queued' }))).rejects.toThrow('legacy start')
    expect((await f.store.get('workbench_link', wb.id))!.revision).toBe(0)
    expect(f.stub.calls.enqueued).toEqual([])
  })

  it('allows an authorized initial native claim but rechecks a claim after control changes', async () => {
    const f = await fixture(), target = f.addTarget(), wb = await workbench(f, target.threadId)
    await enable(f); await own(f, target)
    await updateWorkbenchLink(f.store, f.room.id, wb.id, () => ({ status: 'queued' }))
    await f.followUp.action('agent-1', f.commitment.id, 'pause', action('pause', 1))
    await expect(updateWorkbenchLink(f.store, f.room.id, wb.id, () => ({ admissionAttempted: true }))).rejects.toThrow('legacy start')
    expect((await f.store.get('workbench_link', wb.id))!.revision).toBe(1)
  })

  it('guards RoomTask starts and Workbench aliases of that same execution', async () => {
    const f = await fixture(), target = f.addTarget(), execution = await roomTask(f, target.threadId)
    const wb = await workbench(f, target.threadId)
    await enable(f); await own(f, { kind: 'room_task', taskId: execution.task.id })
    await f.followUp.action('agent-1', f.commitment.id, 'pause', action('pause', 1))
    const prior = (await f.store.get('task', execution.task.id))!
    await expect(putRoomDocument(f.store, 'task', execution.task.id, f.room.id,
      { ...execution, task: { ...execution.task, status: 'running' } }, prior)).rejects.toThrow('legacy start')
    await expect(updateWorkbenchLink(f.store, f.room.id, wb.id, () => ({ status: 'queued' }))).rejects.toThrow('legacy start')
    await expect(putRoomDocument(f.store, 'task', execution.task.id, f.room.id,
      { ...execution, task: { ...execution.task, executionThreadId: 'replacement' } }, prior)).rejects.toThrow('release the owned')
  })

  it.each(['thread', 'room_task', 'workbench_link'] as const)('one real execution cannot gain a second owner using a %s alias', async (alias) => {
    const f = await fixture(), target = f.addTarget(), execution = await roomTask(f, target.threadId)
    const wb = await workbench(f, target.threadId), secondTask = await roomTask(f, target.threadId, 'second-task')
    await enable(f); await own(f, { kind: 'room_task', taskId: execution.task.id })
    const second = await f.commitments.create('agent-1', { ...f.create, clientRequestId: 'second' })
    await f.followUp.enable('agent-1', second.id, f.enable)
    const secondTarget = alias === 'thread' ? target : alias === 'room_task'
      ? { kind: alias, taskId: secondTask.task.id } : { kind: alias, linkId: wb.id, threadId: target.threadId }
    await expect(f.followUp.link('agent-1', second.id, { ...action('second-link', 0), target: secondTarget,
      ownership: 'owned', userEvidence: f.userEvidence })).rejects.toThrow('active owner')
    expect((await f.followUp.get('agent-1', second.id)).links).toEqual([])
  })

  it('rejects raw legacy writes without the matching control revision or authorization change', async () => {
    const f = await fixture(); await enable(f)
    const { revision: _revision, ...value } = f.commitment
    const put = { kind: 'agent_commitment' as const, id: value.id, roomId: f.room.id,
      value: { ...value, objective: 'Broaden the authorized scope' } }
    const check = { kind: put.kind, id: put.id, expectedRevision: 0 }
    await expect(f.store.commit({ requestId: 'raw-update', checks: [check], puts: [put] })).rejects.toThrow('control revision')
    const checks = [check, { kind: 'commitment_control' as const, id: value.id, expectedRevision: 0 }]
    await expect(f.store.commit({ requestId: 'raw-update', checks, puts: [put] })).rejects.toThrow('atomically')
    await expect(f.store.commit({ requestId: 'raw-complete', checks, puts: [{ ...put, value: {
      ...value, status: 'completed', finishedAt: value.updatedAt, acceptanceEvidence: [{ summary: 'Unversioned completion' }] } }] }))
      .rejects.toThrow('versioned acceptance')
    expect(await f.commitments.get('agent-1', value.id)).toEqual(f.commitment)
  })

  it('never reports a stop or permits reopen from a text/turn ending without physical stop proof', async () => {
    const f = await fixture(), target = f.addTarget('writer', 'running')
    await enable(f); await own(f, target)
    await f.followUp.stop('agent-1', f.commitment.id, { ...action('stop', 1), scope: 'commitment', targetId: f.commitment.id })
    const reopen = { ...f.enable, clientRequestId: 'reopen', expectedControlRevision: 2, expectedCommitmentRevision: 1 }
    expect((await f.followUp.get('agent-1', f.commitment.id)).stage).toBe('stopping')
    await expect(f.followUp.reopen('agent-1', f.commitment.id, reopen)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' })
    f.stub.threads.get(target.threadId)!.turns[0]!.status = 'completed'
    f.deps.proveStopped = async () => false
    expect((await f.followUp.get('agent-1', f.commitment.id)).stage).toBe('stopping')
    await expect(f.followUp.reopen('agent-1', f.commitment.id, reopen)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' })
    f.deps.proveStopped = async () => true
    expect((await f.followUp.get('agent-1', f.commitment.id)).stage).toBe('stopped')
    expect((await f.followUp.reopen('agent-1', f.commitment.id, reopen)).control.generation).toBe(3)
  })

  it('checks the destination owner when a legacy native object is rebound from an unowned thread', async () => {
    const f = await fixture(), protectedTarget = f.addTarget('protected'), other = f.addTarget('unowned')
    const wb = await workbench(f, other.threadId)
    await enable(f); await own(f, protectedTarget)
    await f.followUp.action('agent-1', f.commitment.id, 'pause', action('pause', 1))
    await expect(updateWorkbenchLink(f.store, f.room.id, wb.id, () => ({
      threadId: protectedTarget.threadId, status: 'queued', admissionAttempted: true
    }))).rejects.toThrow('legacy start')
    expect((await f.store.get('workbench_link', wb.id))!.value).toMatchObject({ threadId: other.threadId, status: 'awaiting_confirmation' })
  })

  it.each([true, false])('checks final physical ownership regardless of link-first=%s put order', async (linkFirst) => {
    const f = await fixture(), protectedTarget = f.addTarget('protected'), other = f.addTarget('unowned')
    const execution = await roomTask(f, other.threadId)
    await enable(f)
    const first = await own(f, protectedTarget)
    const second = await f.commitments.create('agent-1', { ...f.create, clientRequestId: 'second' })
    await f.followUp.enable('agent-1', second.id, f.enable)
    const newLink = { ...first.link, id: 'second-owner', commitmentId: second.id,
      target: { kind: 'room_task' as const, taskId: execution.task.id } }
    const ownerPut = { kind: 'commitment_link' as const, id: newLink.id, roomId: f.room.id, value: newLink }
    const taskPut = { kind: 'task' as const, id: execution.task.id, roomId: f.room.id,
      value: { ...execution, task: { ...execution.task, executionThreadId: protectedTarget.threadId } } }
    const requestId = 'ownership-batch-' + linkFirst
    await expect(f.store.commit({ requestId, checks: [
      { kind: 'commitment_link', id: newLink.id, expectedRevision: null },
      { kind: 'task', id: execution.task.id, expectedRevision: 0 }
    ], puts: linkFirst ? [ownerPut, taskPut] : [taskPut, ownerPut] })).rejects.toThrow('active owner')
    expect(await f.store.get('commitment_link', newLink.id)).toBeNull()
    expect((await f.store.get('task', execution.task.id))!.value).toMatchObject({ task: { executionThreadId: other.threadId } })
    expect(await f.store.getRequest(requestId)).toBeNull()
  })

  it('accepts positive stop proof for a never-started owned thread, but never assumes an empty history is proof', async () => {
    const f = await fixture(), target = f.addTarget('never-started')
    f.stub.threads.get(target.threadId)!.turns = []
    await enable(f); await own(f, target)
    await f.followUp.stop('agent-1', f.commitment.id, { ...action('stop', 1), scope: 'commitment', targetId: f.commitment.id })
    const reopen = { ...f.enable, clientRequestId: 'reopen', expectedControlRevision: 2, expectedCommitmentRevision: 1 }
    f.deps.proveStopped = async () => false
    expect((await f.followUp.get('agent-1', f.commitment.id)).stage).toBe('stopping')
    await expect(f.followUp.reopen('agent-1', f.commitment.id, reopen)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' })
    f.deps.proveStopped = async () => true
    expect((await f.followUp.get('agent-1', f.commitment.id)).stage).toBe('stopped')
    await expect(f.followUp.reopen('agent-1', f.commitment.id, reopen)).resolves.toMatchObject({ control: { trackingEnabled: true } })
  })

  it('does not stop or take ownership of a referenced target', async () => {
    const f = await fixture(), target = f.addTarget('referenced', 'running')
    await enable(f)
    const linked = await own(f, target, 'referenced')
    expect(linked.link.nativeTarget).toBeUndefined()
    await expect(f.followUp.stop('agent-1', f.commitment.id, { ...action('stop-target', 1), scope: 'target',
      targetId: linked.link.id, expectedTargetRevision: 0 })).rejects.toThrow('active owned target')
    await f.followUp.stop('agent-1', f.commitment.id, { ...action('stop-all', 1), scope: 'commitment', targetId: f.commitment.id })
    expect((await f.followUp.get('agent-1', f.commitment.id)).stage).toBe('stopped')
    expect(f.stub.calls.interrupted).toEqual([])
    expect(f.stub.threads.get(target.threadId)!.turns[0]!.status).toBe('running')
  })
})
