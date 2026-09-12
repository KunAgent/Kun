import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRequestState, RoomRuntimeDeps, RoomTaskExecution } from './room-runtime-types.js'
import { RoomRequestRunner } from './room-request-runner.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'

const execution = vi.hoisted(() => ({ ensure: vi.fn(), enqueue: vi.fn(), observe: vi.fn() }))
vi.mock('./room-execution.js', () => ({
  ensureRoomThread: execution.ensure, enqueueRoomTurn: execution.enqueue, observeRoomTurn: execution.observe
}))
const exec = promisify(execFile)
const cleanups: Array<() => Promise<unknown>> = []
beforeEach(() => {
  execution.ensure.mockReset().mockResolvedValue(undefined)
  execution.enqueue.mockReset().mockImplementation(async (_deps, _threadId, key) => 'turn-' + key)
  execution.observe.mockReset().mockResolvedValue({ status: 'completed', text: JSON.stringify({ kind: 'answer', response: 'Coordinator answer' }) })
})
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(mode: 'directed' | 'autonomous' = 'autonomous') {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-request-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const repo = join(root, 'repo with spaces')
  await exec('git', ['init', '-b', 'develop', repo])
  await exec('git', ['-C', repo, 'config', 'user.name', 'Request Test'])
  await exec('git', ['-C', repo, 'config', 'user.email', 'request@example.test'])
  await writeFile(join(repo, 'file.txt'), 'baseline\n')
  await exec('git', ['-C', repo, 'add', '.'])
  await exec('git', ['-C', repo, 'commit', '-m', 'baseline'])
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  cleanups.push(() => store.close())
  const wake = vi.fn()
  const service = new RoomService(store, wake)
  const metadata = vi.fn().mockResolvedValue({ turns: [] })
  const steer = vi.fn().mockResolvedValue(undefined)
  const cancel = vi.fn().mockResolvedValue(undefined)
  const deps = {
    store, dataDir: root, model: () => ({ model: 'test-model', providerId: 'test-provider' }),
    profiles: () => ({}), threads: { getMetadata: metadata }, turns: { steerTurn: steer, cancelQueuedTurn: cancel }
  } as unknown as RoomRuntimeDeps
  const runner = new RoomRequestRunner(deps, service)
  const { room } = await service.create({ clientRequestId: 'create', name: 'Room', collaborationMode: mode,
    repositories: [{ id: 'repo', displayPath: repo }] })
  const request = async (requestId: string) => {
    const row = await store.get<RoomRequestState>('request', requestId)
    if (!row) throw new Error('test request missing')
    return row
  }
  const tick = async (requestId: string) => runner.tick(await request(requestId))
  return { root, repo, room, store, service, runner, deps, metadata, steer, cancel, wake, request, tick }
}
const assignment = (key = 'first', repositoryId = 'repo') => ({
  key, memberId: 'developer', repositoryId, title: 'Implement result', prompt: 'Add the requested result', dependsOn: []
})
async function createTask(f: Awaited<ReturnType<typeof fixture>>) {
  const sent = await f.service.send(f.room.id, { clientRequestId: 'execute', body: 'Implement result', executionIntent: 'execute' })
  await f.tick(sent.requestId)
  execution.observe.mockResolvedValueOnce({ status: 'completed', text: JSON.stringify({ kind: 'execute', response: 'Assigned', assignments: [assignment()] }) })
  await f.tick(sent.requestId)
  return (await f.store.list<RoomTaskExecution>('task', { roomId: f.room.id }))[0]
}

describe('Room request admission and coordination', () => {
  it('rejects the entire assignment batch before storing tasks if a later repository is unauthorized', async () => {
    const f = await fixture()
    const sent = await f.service.send(f.room.id, { clientRequestId: 'batch', body: 'Implement both', executionIntent: 'execute' })
    await f.tick(sent.requestId)
    execution.observe.mockResolvedValueOnce({ status: 'completed', text: JSON.stringify({ kind: 'execute', response: 'Assigned',
      assignments: [assignment(), assignment('second', 'not-allowed')] }) })
    await expect(f.tick(sent.requestId)).rejects.toThrow('repository_denied')
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
    expect(await f.store.list('workspace', { roomId: f.room.id })).toHaveLength(0)
  })

  it('has the addressed developer answer in their own discussion turn even when the coordinator returns answer', async () => {
    const f = await fixture('directed')
    const sent = await f.service.send(f.room.id, { clientRequestId: 'mention', body: 'What would you change?', mentionMemberIds: ['developer'], executionIntent: 'discussion' })
    await f.tick(sent.requestId)
    await f.tick(sent.requestId)
    expect((await f.request(sent.requestId)).value.discussions?.map((item) => item.memberId)).toEqual(['developer'])
    await f.tick(sent.requestId)
    expect(execution.ensure.mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'discussion', member: { id: 'developer' } })
    execution.observe.mockResolvedValueOnce({ status: 'completed', text: 'Actual developer response' })
    await f.tick(sent.requestId)
    await f.tick(sent.requestId)
    const replies = (await f.store.list<RoomMessage>('message', { roomId: f.room.id }))
      .filter((row) => row.value.authorKind === 'member')
    expect(replies.map((row) => [row.value.authorMemberId, row.value.body])).toEqual([['developer', 'Actual developer response']])
    expect((await f.request(sent.requestId)).value.status).toBe('completed')
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
  })

  it('keeps admitted member configuration frozen after the room is edited', async () => {
    const f = await fixture()
    const sent = await f.service.send(f.room.id, { clientRequestId: 'frozen', body: 'Implement result', executionIntent: 'execute' })
    const changedMembers = f.room.members.map((member) => member.id === 'developer'
      ? { ...member, displayName: 'Changed name', roleNotes: 'Changed responsibility', revision: 1 } : member)
    await f.service.update(f.room.id, { clientRequestId: 'edit', expectedRevision: f.room.revision, members: changedMembers })
    await f.tick(sent.requestId)
    execution.observe.mockResolvedValueOnce({ status: 'completed', text: JSON.stringify({ kind: 'execute', response: 'Assigned', assignments: [assignment()] }) })
    await f.tick(sent.requestId)
    const task = (await f.store.list<RoomTaskExecution>('task', { roomId: f.room.id }))[0].value.task
    expect(task.memberSnapshot.displayName).toBe('开发')
    expect(task.memberSnapshot.roleNotes).toBe('')
    expect(task.memberSnapshot.modelRef).toEqual({ model: 'test-model', providerId: 'test-provider' })
  })

  it('stops new admissions after archive while allowing an already admitted request to finish', async () => {
    const f = await fixture()
    const sent = await f.service.send(f.room.id, { clientRequestId: 'before-archive', body: 'Discuss this' })
    await f.service.update(f.room.id, { clientRequestId: 'archive', expectedRevision: f.room.revision, archived: true })
    await expect(f.service.send(f.room.id, { clientRequestId: 'after-archive', body: 'New request' })).rejects.toThrow('restore the room')
    await f.tick(sent.requestId)
    await f.tick(sent.requestId)
    expect((await f.request(sent.requestId)).value.status).toBe('completed')
    expect(await f.service.send(f.room.id, { clientRequestId: 'before-archive', body: 'Discuss this' })).toEqual(sent)
  })
})

describe('Room task amendments and incremental messages', () => {
  it('reuses the durable steering operation after a crash between runtime admission and room commit', async () => {
    const f = await fixture()
    const taskRow = await createTask(f)
    const task = taskRow.value.task
    await putRoomDocument(f.store, 'task', task.id, f.room.id,
      { ...taskRow.value, task: { ...task, status: 'running' }, turnId: 'running-turn' }, taskRow, task.id)
    f.metadata.mockResolvedValue({ turns: [{ id: 'running-turn', status: 'running' }] })
    const sent = await f.service.send(f.room.id, { clientRequestId: 'steer', body: 'Handle empty input', taskId: task.id, executionIntent: 'execute' })
    const commit = f.store.commit.bind(f.store)
    let failCommit = true
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (input.requestId.startsWith('amend-') && failCommit) {
        failCommit = false
        throw new Error('Simulated disconnect after steering admission')
      }
      return commit(input)
    })
    await expect(f.tick(sent.requestId)).rejects.toThrow('after steering admission')
    await f.tick(sent.requestId)
    expect(f.steer).toHaveBeenCalledTimes(2)
    expect(f.steer.mock.calls[0][0]).toEqual(f.steer.mock.calls[1][0])
    expect(f.steer.mock.calls[0][0]).toMatchObject({ operationId: sent.requestId, turnId: 'running-turn' })
    expect((await f.store.get<RoomTaskExecution>('task', task.id))?.value.task.requirementRevision).toBe(1)
    expect((await f.request(sent.requestId)).value.status).toBe('completed')
  })

  it('applies a replayed amendment request only once and cancels the old queued turn first', async () => {
    const f = await fixture()
    const taskRow = await createTask(f)
    const task = taskRow.value.task
    await putRoomDocument(f.store, 'task', task.id, f.room.id,
      { ...taskRow.value, turnId: 'old-queued-turn' }, taskRow, task.id)
    f.metadata.mockResolvedValue({ turns: [{ id: 'old-queued-turn', status: 'queued' }] })
    const cancellationOrder: string[] = []
    f.cancel.mockImplementation(async () => { cancellationOrder.push('cancel') })
    const commit = f.store.commit.bind(f.store)
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (input.requestId.startsWith('amend-')) cancellationOrder.push('commit')
      return commit(input)
    })
    const input = { clientRequestId: 'amend', body: 'Also handle empty input', taskId: task.id, executionIntent: 'execute' }
    const sent = await f.service.send(f.room.id, input)
    expect(await f.service.send(f.room.id, input)).toEqual(sent)
    await f.tick(sent.requestId)
    expect(await f.service.send(f.room.id, input)).toEqual(sent)
    const amended = (await f.store.get<RoomTaskExecution>('task', task.id))!.value
    expect(cancellationOrder).toEqual(['cancel', 'commit'])
    expect(amended.task.requirementRevision).toBe(1)
    expect(amended.attempt).toBe(2)
    expect(amended.turnId).toBeUndefined()
    expect(amended.prompt.match(/Also handle empty input/g)).toHaveLength(1)
    expect((await f.request(sent.requestId)).value.status).toBe('completed')
  })

  it('does not replace queued execution if its cancellation fails', async () => {
    const f = await fixture()
    const taskRow = await createTask(f)
    const task = taskRow.value.task
    await putRoomDocument(f.store, 'task', task.id, f.room.id,
      { ...taskRow.value, turnId: 'old-queued-turn' }, taskRow, task.id)
    f.metadata.mockResolvedValue({ turns: [{ id: 'old-queued-turn', status: 'queued' }] })
    f.cancel.mockRejectedValueOnce(new Error('Queue is unavailable'))
    const sent = await f.service.send(f.room.id, { clientRequestId: 'amend', body: 'More work', taskId: task.id, executionIntent: 'execute' })
    await expect(f.tick(sent.requestId)).rejects.toThrow('Queue is unavailable')
    const unchanged = (await f.store.get<RoomTaskExecution>('task', task.id))!.value
    expect(unchanged.turnId).toBe('old-queued-turn')
    expect(unchanged.task.requirementRevision).toBe(0)
    expect((await f.request(sent.requestId)).value.status).toBe('pending')
  })

  it('publishes a stable message identity and sequence with increasing body revisions only when content changes', async () => {
    const f = await fixture()
    await f.service.publish(f.room.id, 'stream-message', 'First', 'developer')
    const first = (await f.store.get<RoomMessage>('message', 'stream-message'))!
    await f.service.publish(f.room.id, 'stream-message', 'First more', 'developer')
    const updated = (await f.store.get<RoomMessage>('message', 'stream-message'))!
    expect(updated.seq).toBe(first.seq)
    expect(updated.value.bodyRevision).toBe(1)
    await f.service.publish(f.room.id, 'stream-message', 'First more', 'developer')
    expect((await f.store.get<RoomMessage>('message', 'stream-message'))?.revision).toBe(updated.revision)
    expect(await f.store.list('message', { roomId: f.room.id })).toHaveLength(1)
    await expect(f.service.publish(f.room.id, 'stream-message', 'Different owner', 'reviewer')).rejects.toThrow('identity mismatch')
  })

  it.each(['discussion', 'auto'] as const)('keeps a completed task and its accepted delivery unchanged for a %s question', async (intent) => {
    const f = await fixture()
    const taskRow = await createTask(f)
    const task = { ...taskRow.value.task, status: 'completed' as const, latestDeliveryId: 'delivery-one',
      acceptedDeliveryId: 'delivery-one', applicationStatus: 'applied', verificationStatus: 'passed' }
    await putRoomDocument(f.store, 'task', task.id, f.room.id, { ...taskRow.value, task }, taskRow, task.id)
    const delivery = { id: 'delivery-one', taskId: task.id, versionHash: 'a'.repeat(40),
      summary: 'Added empty input handling', diffArtifactId: 'diff-one' }
    await putRoomDocument(f.store, 'delivery', delivery.id, f.room.id, delivery, null, task.id)
    await putRoomDocument(f.store, 'artifact', 'diff-one', f.room.id, '+ if (!input) return null', null, task.id)
    const before = await f.store.get('task', task.id)
    const sent = await f.service.send(f.room.id, { clientRequestId: 'question', body: 'What did this task change?',
      taskId: task.id, executionIntent: intent })
    await f.tick(sent.requestId)
    if (intent === 'auto') {
      await f.tick(sent.requestId)
      expect(execution.enqueue.mock.calls.at(-1)?.[3]).toContain('A referenced task is context, not authorization')
      await f.tick(sent.requestId)
    }
    await f.tick(sent.requestId)
    expect(execution.ensure.mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'discussion', member: { id: 'developer' } })
    const prompt = execution.enqueue.mock.calls.at(-1)?.[3] as string
    expect(prompt).toContain(delivery.versionHash)
    expect(prompt).toContain(delivery.summary)
    expect(prompt).toContain('+ if (!input) return null')
    expect(prompt).toContain('the task repository is not mounted here')
    expect(prompt).toContain('request a formal review when needed')
    expect(execution.ensure.mock.calls.at(-1)?.[1].workspace).toBeUndefined()
    execution.observe.mockResolvedValueOnce({ status: 'completed', text: 'The fixed delivery added empty input handling.' })
    await f.tick(sent.requestId)
    await f.tick(sent.requestId)
    expect((await f.request(sent.requestId)).value.status).toBe('completed')
    expect(await f.store.get('task', task.id)).toEqual(before)
    expect(f.steer).not.toHaveBeenCalled()
    expect(f.cancel).not.toHaveBeenCalled()
  })

  it('classifies a running task question without steering and uses the frozen task state in its reply', async () => {
    const f = await fixture()
    const taskRow = await createTask(f)
    const task = { ...taskRow.value.task, status: 'running' as const, latestProgress: 'Still checking input' }
    await putRoomDocument(f.store, 'task', task.id, f.room.id, { ...taskRow.value, task, turnId: 'live' }, taskRow, task.id)
    f.metadata.mockResolvedValue({ turns: [{ id: 'live', status: 'running' }] })
    const sent = await f.service.send(f.room.id, { clientRequestId: 'progress', body: 'How is this going?', taskId: task.id })
    await f.tick(sent.requestId)
    const latest = (await f.store.get<RoomTaskExecution>('task', task.id))!
    await putRoomDocument(f.store, 'task', task.id, f.room.id,
      { ...latest.value, task: { ...task, latestProgress: 'Now finishing' } }, latest, task.id)
    const before = await f.store.get('task', task.id)
    await f.tick(sent.requestId)
    await f.tick(sent.requestId)
    await f.tick(sent.requestId)
    expect(execution.ensure.mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'discussion' })
    expect(execution.enqueue.mock.calls.at(-1)?.[3]).toContain('Still checking input')
    expect(execution.enqueue.mock.calls.at(-1)?.[3]).not.toContain('Now finishing')
    expect(f.steer).not.toHaveBeenCalled()
    expect(f.cancel).not.toHaveBeenCalled()
    expect(await f.store.get('task', task.id)).toEqual(before)
  })

  it('amends an automatic referenced request only after the coordinator classifies it as explicit execution', async () => {
    const f = await fixture()
    const taskRow = await createTask(f)
    const sent = await f.service.send(f.room.id, { clientRequestId: 'fix', body: 'Also handle empty input', taskId: taskRow.id })
    await f.tick(sent.requestId)
    await f.tick(sent.requestId)
    expect(await f.store.get('task', taskRow.id)).toEqual(taskRow)
    execution.observe.mockResolvedValueOnce({ status: 'completed', text: JSON.stringify({ kind: 'execute', response: 'Apply this additional requirement' }) })
    await f.tick(sent.requestId)
    const amended = (await f.store.get<RoomTaskExecution>('task', taskRow.id))!.value
    expect(amended.task.requirementRevision).toBe(1)
    expect(amended.prompt).toContain('Also handle empty input')
    expect((await f.request(sent.requestId)).value.status).toBe('completed')
  })

  it('preserves an applying delivery receipt for recovery instead of starting an amendment', async () => {
    const f = await fixture()
    const taskRow = await createTask(f)
    const task = { ...taskRow.value.task, status: 'completed' as const, latestDeliveryId: 'delivery-one',
      acceptedDeliveryId: 'delivery-one', applicationStatus: 'applying' }
    await putRoomDocument(f.store, 'task', task.id, f.room.id, { ...taskRow.value, task }, taskRow, task.id)
    const before = await f.store.get('task', task.id)
    const sent = await f.service.send(f.room.id, { clientRequestId: 'more', body: 'Add another change',
      taskId: task.id, executionIntent: 'execute' })
    await f.tick(sent.requestId)
    expect((await f.request(sent.requestId)).value.status).toBe('needs_input')
    expect(await f.store.get('task', task.id)).toEqual(before)
    expect(f.steer).not.toHaveBeenCalled()
    expect(f.cancel).not.toHaveBeenCalled()
  })

  it.each(['execute', 'auto'] as const)('keeps a read-only reviewer question separate from %s formal review assignment', async (intent) => {
    const f = await fixture()
    const taskRow = await createTask(f)
    const sent = await f.service.send(f.room.id, { clientRequestId: 'review-question', body: 'What should we check?',
      taskId: taskRow.id, mentionMemberIds: ['reviewer'], executionIntent: 'discussion' })
    await f.tick(sent.requestId)
    await f.tick(sent.requestId)
    expect(execution.ensure.mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'discussion', member: { id: 'reviewer' } })
    expect(await f.store.get('task', taskRow.id)).toEqual(taskRow)
    const review = await f.service.send(f.room.id, { clientRequestId: 'review', body: 'Review only SQL injection risks',
      taskId: taskRow.id, mentionMemberIds: ['reviewer'], executionIntent: intent, attachmentIds: ['review-spec'] })
    await f.tick(review.requestId)
    if (intent === 'auto') {
      await f.tick(review.requestId)
      execution.observe.mockResolvedValueOnce({ status: 'completed', text: JSON.stringify({ kind: 'execute', response: 'Review the existing delivery read-only' }) })
      await f.tick(review.requestId)
    }
    const reviewed = (await f.store.get<RoomTaskExecution>('task', taskRow.id))!.value
    expect(reviewed.reviewer?.id).toBe('reviewer')
    expect(reviewed.reviewRequest).toEqual({ body: 'Review only SQL injection risks', attachmentIds: ['review-spec'] })
  })

  it('inspects an explicitly selected repository instead of the member default during discussion', async () => {
    const f = await fixture('directed')
    const distinctPath = join(f.root, 'other-repository')
    await exec('git', ['clone', f.repo, distinctPath])
    await f.service.update(f.room.id, { clientRequestId: 'repositories', expectedRevision: f.room.revision,
      repositories: [{ id: 'repo', displayPath: f.repo }, { id: 'other', displayPath: distinctPath }],
      members: f.room.members.map((member) => ({ ...member, allowedRepositoryIds: ['repo', 'other'] })) })
    const sent = await f.service.send(f.room.id, { clientRequestId: 'inspect', body: 'Explain this repository',
      mentionMemberIds: ['developer'], repositoryId: 'other', executionIntent: 'discussion' })
    await f.tick(sent.requestId)
    await f.tick(sent.requestId)
    await f.tick(sent.requestId)
    expect(execution.ensure.mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'discussion', workspace: await realpath(distinctPath) })
  })
})
