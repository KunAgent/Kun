import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeHarness } from '../../tests/loop-test-harness.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { putRoomDocument } from '../rooms/room-service.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { Room } from '../contracts/rooms.js'
import { quickCreateAgent } from './agent-chat-entry.js'
import { AgentDirectRunner } from './agent-direct-runner.js'
import { directActivity } from './agent-direct-service.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'private-execution-'))
  const h = makeHarness({ provider: 'test', model: 'test', async *stream() { yield { kind: 'completed', stopReason: 'stop' } } })
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'test', providerId: 'test' }),
    profiles: () => ({}), assertOwnership: async () => {} }
  const rooms = new RoomRuntime(deps), runner = new AgentDirectRunner(deps, rooms.service)
  const created = await quickCreateAgent(rooms.agents, { clientRequestId: 'create' }, true)
  const sent = await rooms.service.send(created.roomId, { clientRequestId: 'send', body: 'Research a page' })
  for (let i = 0; i < 5; i++) {
    const row = (await store.get<RoomRequestState>('request', sent.requestId))!
    if (row.value.turnId) break
    await runner.tick(row)
  }
  const request = (await store.get<RoomRequestState>('request', sent.requestId))!
  await h.turns.startNextQueuedTurn(request.value.threadId)
  await runner.tick(request)
  const current = (await store.get<RoomRequestState>('request', sent.requestId))!
  const run = (await store.get<RoomRunRecord>('room_run', current.value.privateRunId!))!
  const thread = (await h.threads.getMetadata(current.value.threadId))!
  const room = await rooms.service.get(created.roomId)
  cleanup.push(async () => { await rooms.close(); await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  const activity = () => directActivity(rooms, room.id)
  return { root, h, store, deps, rooms, created, request: current, run, thread, room, activity }
}

it('reconstructs the exact live GUI execution from durable authority without admission or writes', async () => {
  const f = await fixture(), enqueue = vi.spyOn(f.h.turns, 'enqueueTurn'), commit = vi.spyOn(f.store, 'commit')
  const expected = { roomId: f.room.id, requestId: f.request.id, runId: f.run.id, threadId: f.thread.id, turnId: f.request.value.turnId }
  expect(await f.activity()).toHaveProperty('execution', expected)
  const reloaded = new RoomRuntime(f.deps)
  expect(await directActivity(reloaded, f.room.id)).toHaveProperty('execution', expected)
  expect(enqueue).not.toHaveBeenCalled()
  expect(commit).not.toHaveBeenCalled()
  await reloaded.close()
})

it.each(['cancelled', 'stopping', 'recovery_required', 'pending', 'steer', 'im', 'request-id', 'run-id'])(
  'does not expose a browser binding for a %s request', async (boundary) => {
    const f = await fixture(), value = structuredClone(f.request.value)
    if (boundary === 'steer') value.steer = { operationId: 'merge', targetTurnId: value.turnId!, targetRunId: f.run.id }
    else if (boundary === 'im') value.clientSurface = 'im'
    else if (boundary === 'request-id') value.id = 'foreign-request'
    else if (boundary === 'run-id') value.privateRunId = 'foreign-run'
    else value.status = boundary as RoomRequestState['status']
    await putRoomDocument(f.store, 'request', f.request.id, f.room.id, value, f.request)
    expect(await f.activity()).not.toHaveProperty('execution')
  })

it.each(['room', 'member', 'participant', 'request', 'turn', 'thread', 'merged', 'terminal'])(
  'rejects a run with mismatched %s ownership', async (boundary) => {
    const f = await fixture(), value = structuredClone(f.run.value)
    if (boundary === 'room') value.roomId = 'foreign-room'
    if (boundary === 'member') value.memberId = 'foreign-member'
    if (boundary === 'participant') value.participantAgentId = 'foreign-agent'
    if (boundary === 'request') value.requestId = 'foreign-request'
    if (boundary === 'turn') value.turnId = 'foreign-turn'
    if (boundary === 'thread') value.threadId = 'foreign-thread'
    if (boundary === 'merged') value.mergedIntoRunId = 'target-run'
    if (boundary === 'terminal') value.status = 'completed'
    const get = f.store.get.bind(f.store)
    vi.spyOn(f.store, 'get').mockImplementation((async (kind, id) =>
      kind === 'room_run' && id === f.run.id ? { ...f.run, value } : get(kind, id)) as typeof f.store.get)
    expect(await f.activity()).not.toHaveProperty('execution')
  })

it.each(['room', 'member', 'participant', 'workspace', 'turn-id', 'client-id', 'im', 'terminal', 'late-turn'])(
  'rejects a thread with %s mismatch or stale turn', async (boundary) => {
    const f = await fixture(), thread = structuredClone(f.thread), turn = thread.turns[0]
    if (boundary === 'room') thread.roomContext!.roomId = 'foreign-room'
    if (boundary === 'member') thread.roomContext!.memberId = 'foreign-member'
    if (boundary === 'participant') thread.roomContext!.participantAgentId = 'foreign-agent'
    if (boundary === 'workspace') thread.workspace = '/foreign-workspace'
    if (boundary === 'turn-id') turn.id = 'foreign-turn'
    if (boundary === 'client-id') turn.clientRequestId = 'foreign-request'
    if (boundary === 'im') turn.clientSurface = 'im'
    if (boundary === 'terminal') turn.status = 'completed'
    if (boundary === 'late-turn') {
      turn.status = 'completed'
      thread.turns.push({ ...turn, id: 'next-turn', status: 'running', clientRequestId: 'private-next-0' })
    }
    await f.h.threadStore.upsert(thread)
    expect(await f.activity()).not.toHaveProperty('execution')
  })

it.each(['epoch', 'workspace', 'permission', 'archived', 'disabled', 'member', 'cancelled-root'])(
  'fails closed when current %s authority changes', async (boundary) => {
    const f = await fixture(), room = structuredClone(f.room)
    if (boundary === 'epoch') room.privateEpoch = (room.privateEpoch ?? 0) + 1
    if (boundary === 'workspace') room.privateWorkspace = '/changed-workspace'
    if (boundary === 'permission') room.privateExecutionPolicy!.approvalReviewer = 'agent'
    if (boundary === 'archived') room.archivedAt = new Date().toISOString()
    if (boundary === 'disabled') room.members[0].enabled = false
    if (boundary === 'member') room.defaultMemberId = 'foreign-member'
    if (boundary === 'cancelled-root') {
      await putRoomDocument(f.store, 'request', f.request.id, f.room.id,
        { ...f.request.value, cancellationRequested: true }, f.request)
    } else await putRoomDocument(f.store, 'room', room.id, room.id, room,
      (await f.store.get<Room>('room', room.id))!)
    expect(await f.activity()).not.toHaveProperty('execution')
  })

it('revokes the binding when current Agent directory limits change', async () => {
  const f = await fixture(), agent = await f.rooms.agents.get(f.created.agentId)
  await f.rooms.agents.update(agent.id, { clientRequestId: 'revoke', expectedRevision: agent.revision, allowedRepositoryRoots: [] })
  expect(await f.activity()).not.toHaveProperty('execution')
})

it('drops the binding when cancellation races the authority read', async () => {
  const f = await fixture(), get = f.h.threads.getMetadata.bind(f.h.threads)
  let first = true
  vi.spyOn(f.h.threads, 'getMetadata').mockImplementation(async (id) => {
    if (first) {
      first = false
      await putRoomDocument(f.store, 'request', f.request.id, f.room.id,
        { ...f.request.value, cancellationRequested: true }, f.request)
    }
    return get(id)
  })
  expect(await f.activity()).not.toHaveProperty('execution')
})
it('drops the binding when the exact running turn finishes during validation', async () => {
  const f = await fixture(), finished = structuredClone(f.thread)
  finished.turns[0].status = 'completed'
  vi.spyOn(f.h.threads, 'getMetadata').mockResolvedValueOnce(f.thread).mockResolvedValueOnce(finished)
  expect(await f.activity()).not.toHaveProperty('execution')
})
it('keeps native IM approval presentation without granting a GUI browser binding', async () => {
  const f = await fixture(), approval = { id: 'pending-im-approval' }
  await putRoomDocument(f.store, 'request', f.request.id, f.room.id,
    { ...f.request.value, clientSurface: 'im' }, f.request)
  vi.spyOn(f.h.approvalGate, 'pending').mockReturnValue([approval] as never)
  const state = await f.activity()
  expect(state).not.toHaveProperty('execution')
  expect(state.approvals).toEqual([approval])
})
