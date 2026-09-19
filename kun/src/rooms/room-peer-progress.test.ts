import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { RoomTaskSchema } from '../contracts/room-tasks.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { RoomPeerStore } from './room-peer-state.js'
import { deliverRoomPeerTaskProgress } from './room-peer-progress.js'
import { ensureRoomThread } from './room-execution.js'
import type { RoomRuntimeDeps, RoomRequestState, RoomTaskExecution } from './room-runtime-types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-peer-progress-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const h = makeHarness(makeFakeModel([]))
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate, dataDir: root,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'fake' }), profiles: () => ({}), assertOwnership: async () => {} }
  cleanups.push(async () => { await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  const service = new RoomService(store, () => {}), peer = new RoomPeerStore(store)
  const room = (await service.create({ clientRequestId: 'room', name: 'Progress' })).room
  const sent = await service.send(room.id, { clientRequestId: 'source', body: 'Implement the requested layout.' })
  await peer.initialize((await store.get<RoomRequestState>('request', sent.requestId))!.value)
  const member = room.members.find((entry) => entry.id === 'developer')!
  const task = async () => {
    const value: RoomTaskExecution = { task: RoomTaskSchema.parse({ id: 'task', roomId: room.id, requestId: sent.requestId,
      sourceMessageId: sent.message.id, title: 'Layout', ownerMemberId: member.id, memberSnapshot: member,
      repositoryId: 'repo', workspaceId: 'task', executionThreadId: 'execution', status: 'needs_approval',
      stage: 'develop', requirementRevision: 0, revision: 0, updatedAt: new Date().toISOString() }),
      prompt: 'Implement layout', attachmentIds: [], dependencyTaskIds: [], attempt: 1, reworkRounds: 0, configuration: null }
    await putRoomDocument(store, 'task', 'task', room.id, value, null, 'task')
    return value
  }
  const inbox = () => store.list('peer_inbox', { rootRequestId: sent.requestId, limit: 1000 })
  return { store, h, deps, service, peer, room, sent, member, task, inbox }
}

describe('incremental peer progress delivery', () => {
  it('pages events instead of scanning idle task history and reaches milestones after a backlog', async () => {
    const f = await fixture()
    await f.store.commit({ requestId: 'unrelated-backlog', events: Array.from({ length: 220 }, (_, index) => ({
      roomId: f.room.id, kind: 'message.updated', payload: { id: 'old-' + index }
    })) })
    await f.task()
    const list = vi.spyOn(f.store, 'list')
    await deliverRoomPeerTaskProgress(f.deps, f.peer)
    expect(await f.inbox()).toHaveLength(3)
    await deliverRoomPeerTaskProgress(f.deps, f.peer)
    expect(await f.inbox()).toHaveLength(6)
    await deliverRoomPeerTaskProgress(f.deps, f.peer)
    expect(await f.inbox()).toHaveLength(6)
    expect(list.mock.calls.some(([kind]) => kind === 'task' || kind === 'request' || kind === 'peer_topic')).toBe(false)
  })

  it('replays an event after a lost cursor checkpoint without duplicating its committed deliveries', async () => {
    const f = await fixture()
    await f.task()
    const commit = f.store.commit.bind(f.store)
    const spy = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (input.puts?.some((put) => put.kind === 'peer_cursor')) throw new Error('Checkpoint transport failure')
      return commit(input)
    })
    await expect(deliverRoomPeerTaskProgress(f.deps, f.peer)).rejects.toThrow('Checkpoint transport failure')
    expect(await f.inbox()).toHaveLength(6)
    spy.mockRestore()
    await deliverRoomPeerTaskProgress(f.deps, f.peer)
    expect(await f.inbox()).toHaveLength(6)
    expect(await f.store.get('peer_cursor', 'peer-task-progress')).not.toBeNull()
  })

  it('delivers a changed native gate even when the task status and document revision are unchanged', async () => {
    const f = await fixture()
    await f.task()
    await ensureRoomThread(f.deps, { id: 'execution', roomId: f.room.id, taskId: 'task', member: f.member, kind: 'execution' })
    let gateId = 'approval-one'
    vi.spyOn(f.deps.approvals, 'pending').mockImplementation((threadId) => !threadId || threadId === 'execution'
      ? [{ id: gateId, threadId: 'execution' }] as never : [])
    await deliverRoomPeerTaskProgress(f.deps, f.peer)
    expect(await f.inbox()).toHaveLength(6)
    await deliverRoomPeerTaskProgress(f.deps, f.peer)
    expect(await f.inbox()).toHaveLength(6)
    gateId = 'approval-two'
    await deliverRoomPeerTaskProgress(f.deps, f.peer)
    expect(await f.inbox()).toHaveLength(9)
    expect((await f.store.get('task', 'task'))!.revision).toBe(0)
  })

  it('keeps newly active topics schedulable beyond a thousand stopped topics and paginates active topics', async () => {
    const f = await fixture(), original = (await f.peer.topic(f.sent.requestId))!.value
    for (let offset = 0; offset < 1202; offset += 500) {
      const rows = Array.from({ length: Math.min(500, 1202 - offset) }, (_, index) => {
        const number = offset + index, id = 'history-' + number
        return { kind: 'peer_topic' as const, id, roomId: f.room.id,
          value: { ...original, rootRequestId: id, status: number < 1001 ? 'stopped' : 'active' } }
      })
      await f.store.commit({ requestId: 'seed-' + offset, puts: rows,
        checks: rows.map((row) => ({ kind: row.kind, id: row.id, expectedRevision: null })) })
    }
    const topics = await f.peer.topics()
    expect(topics).toHaveLength(202)
    expect(topics.some((topic) => topic.id === 'history-1201')).toBe(true)
    expect(topics.every((topic) => topic.value.status === 'active')).toBe(true)
  })
})
