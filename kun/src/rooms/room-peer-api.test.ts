import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { RoomTaskSchema } from '../contracts/room-tasks.js'
import { RoomRuntime } from './room-runtime.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { putRoomDocument } from './room-service.js'
import { deliverRoomPeerTaskProgress } from './room-peer-api.js'
import type { RoomRuntimeDeps, RoomRequestState, RoomTaskExecution } from './room-runtime-types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function fixture(intent: 'discussion' | 'auto' = 'discussion') {
  const directory = await mkdtemp(join(tmpdir(), 'kun-peer-api-'))
  const store = new SqliteRoomStore({ path: join(directory, 'rooms.sqlite') })
  const h = makeHarness(makeFakeModel([]))
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), dataDir: directory,
    model: () => ({ model: 'fake' }), profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps)
  cleanups.push(async () => { await runtime.close(); await h.turns.interruptActiveTurns();
    await store.close(); await rm(directory, { recursive: true, force: true }) })
  const room = (await runtime.service.create({ clientRequestId: 'room', name: 'Peer API room' })).room
  const sent = await runtime.service.send(room.id, { clientRequestId: 'goal', body: 'Compare the design choices.', executionIntent: intent })
  const request = async (id = sent.requestId) => (await store.get<RoomRequestState>('request', id))!
  const peer = runtime.peers.state
  const tick = async () => {
    const driver = runtime as unknown as { stopped: boolean; tick(): Promise<void> }
    driver.stopped = false
    try { await driver.tick() } finally { driver.stopped = true }
  }
  return { store, h, deps, runtime, room, sent, request, peer, tick }
}

describe('peer topic API and Runtime admission', () => {
  it('admits one native member turn for explicit discussion without a second coordinator loop', async () => {
    const f = await fixture()
    const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
    await f.tick()
    await f.tick()
    expect(f.room.collaborationMode).toBe('peer')
    expect((await f.request()).value).toMatchObject({ status: 'completed', peerCoordinationDone: true })
    expect(enqueue).toHaveBeenCalledTimes(1)
    const id = enqueue.mock.calls[0][0].threadId
    expect((await f.h.threads.getMetadata(id))?.roomContext).toMatchObject({
      kind: 'discussion', collaborationProtocol: 'peer', rootRequestId: f.sent.requestId
    })
    expect(await f.h.threads.getMetadata((await f.request()).value.threadId)).toBeNull()
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
  })

  it('persists and replays stop before signalling the original coordinator', async () => {
    const f = await fixture('auto')
    await f.tick()
    const original = await f.request()
    expect(original.value.turnId).toBeDefined()
    const topic = (await f.peer.topic(f.sent.requestId))!
    const cancel = vi.spyOn(f.h.turns, 'cancelQueuedTurn')
    const input = { clientRequestId: 'stop-topic', expectedRevision: topic.revision }
    const first = await f.runtime.stopPeerTopic(f.room.id, f.sent.requestId, input)
    const after = (await f.peer.topic(f.sent.requestId))!
    expect(after.value).toMatchObject({ status: 'stopping', generation: topic.value.generation + 1 })
    expect((await f.request()).value).toMatchObject({ cancellationRequested: true, status: 'stopping' })
    expect(cancel).not.toHaveBeenCalled()
    const events = await f.store.events(f.room.id)
    expect(await f.runtime.stopPeerTopic(f.room.id, f.sent.requestId, input)).toEqual(first)
    expect(await f.store.events(f.room.id)).toEqual(events)
    await f.tick()
    expect(cancel).toHaveBeenCalledWith({ threadId: original.value.threadId, turnId: original.value.turnId })
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
    await expect(f.runtime.stopPeerTopic(f.room.id, f.sent.requestId, { ...input, body: 'changed payload' })).rejects.toThrow('identity conflict')
  })

  it('isolates topic summaries and stop operations by room', async () => {
    const f = await fixture()
    await f.peer.initialize((await f.request()).value)
    const other = (await f.runtime.service.create({ clientRequestId: 'other', name: 'Private other room' })).room
    const sent = await f.runtime.service.send(other.id, { clientRequestId: 'other-goal', body: 'Other secret discussion.' })
    await f.peer.initialize((await f.request(sent.requestId)).value)
    const firstPage = await f.runtime.peerTopics(f.room.id, 50)
    const otherPage = await f.runtime.peerTopics(other.id, 50)
    expect(firstPage.topics.map((topic) => topic.rootRequestId)).toEqual([f.sent.requestId])
    expect(JSON.stringify(firstPage)).not.toContain('Other secret discussion')
    expect(firstPage.topics[0]).toMatchObject({ pendingCount: 3, responseCount: 0, triageCount: 0 })
    expect(otherPage.topics.map((topic) => topic.rootRequestId)).toEqual([sent.requestId])
    await expect(f.runtime.stopPeerTopic(other.id, f.sent.requestId, {
      clientRequestId: 'wrong-room-stop', expectedRevision: firstPage.topics[0].revision
    })).rejects.toThrow('topic not found')
  })

  it('does not abandon an admitted old coordinator when new user input supersedes its request', async () => {
    const f = await fixture('auto')
    await f.tick()
    const old = await f.request()
    expect(old.value.turnId).toBeDefined()
    const next = await f.runtime.service.send(f.room.id, { clientRequestId: 'continue', rootRequestId: f.sent.requestId,
      body: 'Only discuss the visual hierarchy.', executionIntent: 'discussion' })
    await f.tick()
    await f.tick()
    const priorThread = await f.h.threads.getMetadata(old.value.threadId)
    expect(priorThread?.turns.some((turn) => ['queued', 'running'].includes(turn.status))).toBe(false)
    expect((await f.request()).value.status).toBe('cancelled')
    expect((await f.request(next.requestId)).value.status).toBe('completed')
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
  })

  it('delivers task milestones once without reawakening members for unchanged status text revisions', async () => {
    const f = await fixture()
    await f.peer.initialize((await f.request()).value)
    const member = f.room.members.find((value) => value.id === 'developer')!
    const task = RoomTaskSchema.parse({ id: 'task', roomId: f.room.id, requestId: f.sent.requestId,
      sourceMessageId: f.sent.message.id, title: 'Implement layout', ownerMemberId: member.id,
      memberSnapshot: member, repositoryId: 'repo', workspaceId: 'workspace', executionThreadId: 'task-thread',
      status: 'needs_approval', stage: 'develop', requirementRevision: 0, revision: 0, updatedAt: new Date().toISOString() })
    const execution: RoomTaskExecution = { task, prompt: 'Implement layout', attachmentIds: [], dependencyTaskIds: [],
      attempt: 1, reworkRounds: 0, configuration: null }
    await putRoomDocument(f.store, 'task', task.id, f.room.id, execution, null, task.id)
    await deliverRoomPeerTaskProgress(f.deps, f.peer)
    const firstCount = (await f.store.list('peer_inbox', { rootRequestId: f.sent.requestId, limit: 100 })).length
    expect(firstCount).toBe(6)
    await deliverRoomPeerTaskProgress(f.deps, f.peer)
    expect(await f.store.list('peer_inbox', { rootRequestId: f.sent.requestId, limit: 100 })).toHaveLength(firstCount)
    const previous = (await f.store.get<RoomTaskExecution>('task', task.id))!
    await putRoomDocument(f.store, 'task', task.id, f.room.id,
      { ...previous.value, task: { ...previous.value.task, latestProgress: 'Still waiting for approval', revision: 1 } }, previous, task.id)
    await deliverRoomPeerTaskProgress(f.deps, f.peer)
    expect(await f.store.list('peer_inbox', { rootRequestId: f.sent.requestId, limit: 100 })).toHaveLength(firstCount)
    const changed = (await f.store.get<RoomTaskExecution>('task', task.id))!
    await putRoomDocument(f.store, 'task', task.id, f.room.id,
      { ...changed.value, task: { ...changed.value.task, status: 'awaiting_acceptance', latestDeliveryId: 'delivery', revision: 2 } }, changed, task.id)
    await deliverRoomPeerTaskProgress(f.deps, f.peer)
    expect(await f.store.list('peer_inbox', { rootRequestId: f.sent.requestId, limit: 100 })).toHaveLength(firstCount + 3)
  })

  it('validates and persists the public per-room execution concurrency setting', async () => {
    const f = await fixture()
    const room = (await f.runtime.service.create({ clientRequestId: 'limit-one', name: 'One worker', maxConcurrentTasks: 1 })).room
    expect(room.maxConcurrentTasks).toBe(1)
    const changed = await f.runtime.service.update(room.id, { clientRequestId: 'limit-two', expectedRevision: room.revision, maxConcurrentTasks: 2 })
    expect(changed.room.maxConcurrentTasks).toBe(2)
    await expect(f.runtime.service.update(room.id, { clientRequestId: 'invalid-limit', expectedRevision: changed.room.revision, maxConcurrentTasks: 3 })).rejects.toThrow()
  })
})
