import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { makeHarness } from '../../tests/loop-test-harness.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { defaultLocalTools } from '../adapters/tool/local-tool-host.js'
import type { RoomMessage } from '../contracts/rooms.js'
import { RoomRunRecordSchema, type RoomRunRecord } from '../contracts/room-runs.js'
import { roomResultProvider } from '../rooms/room-result-tools.js'
import { roomDiscussionBusy } from '../rooms/room-discussion-scheduler.js'
import { roomRunId } from '../rooms/room-run-recording.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import { putRoomDocument } from '../rooms/room-service.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { QueuedTurnDispatcher } from '../server/queued-turn-dispatcher.js'
import { quickCreateAgent } from './agent-chat-entry.js'
import { controlDirectRequest } from './agent-direct-service.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-reply-cancel-'))
  const entered = deferred(), release = deferred()
  let holdTurnId: string | undefined
  const progress = new Map<string, number>()
  const h = makeHarness({ provider: 'test', model: 'fake', async *stream(request) {
    const step = progress.get(request.turnId) ?? 0
    progress.set(request.turnId, step + 1)
    if (step === 1 && request.turnId === holdTurnId) { entered.resolve(); await release.promise }
    if (step < 2) yield { kind: 'tool_call_complete', callId: request.turnId + '-' + step,
      toolName: 'send_im_message', arguments: { text: step ? 'Done.' : 'Working.', phase: step ? 'final' : 'start' } }
    yield { kind: 'completed', stopReason: step < 2 ? 'tool_calls' : 'stop' }
  } })
  h.toolHost.replaceRuntimeComponents({ registry: new CapabilityRegistry([
    { id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: defaultLocalTools }, roomResultProvider(h.threadStore)
  ]) })
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'fake', providerId: 'test' }),
    profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps)
  const created = await quickCreateAgent(runtime.agents, { clientRequestId: 'create' }, true)
  const row = async (id: string) => (await store.get<RoomRequestState>('request', id))!
  const tick = async () => {
    const driver = runtime as unknown as { stopped: boolean; tick(): Promise<unknown> }
    driver.stopped = false
    try { await driver.tick() } finally { driver.stopped = true }
  }
  const send = (clientRequestId: string, reply?: { id: string; rootRequestId?: string }) => runtime.service.send(created.roomId,
    { clientRequestId: clientRequestId.replaceAll(' ', '-'), body: clientRequestId,
      replyToMessageId: reply?.id, rootRequestId: reply?.rootRequestId })
  const admit = async (id: string) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      await tick()
      const value = (await row(id)).value
      if (value.turnId || ['failed', 'cancelled', 'recovery_required'].includes(value.status)) return value
    }
    throw new Error('request never admitted')
  }
  const finish = async (id: string) => {
    for (let attempt = 0; attempt < 15; attempt++) {
      await tick()
      const value = (await row(id)).value
      if (['completed', 'failed', 'cancelled'].includes(value.status)) return value
      const thread = await h.threads.getMetadata(value.threadId)
      if (thread?.turns.find((turn) => turn.id === value.turnId)?.status === 'queued') {
        const started = await h.turns.startNextQueuedTurn(thread.id)
        if (started) await h.loop.runTurn(thread.id, started.turnId)
      }
    }
    throw new Error('request never finished')
  }
  const approve = setInterval(() => { for (const pending of h.approvalGate.pending()) h.approvalGate.decide(pending.id, 'allow') }, 5)
  cleanups.push(async () => { release.resolve(); clearInterval(approve); await runtime.close();
    await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  return { root, h, store, deps, runtime, created, row, tick, send, admit, finish, entered, release,
    hold: (turnId: string) => { holdTurnId = turnId } }
}

it('completes a reply to an aborted response and then admits the next message through the scheduler', async () => {
  const f = await fixture()
  const source = await f.send('Original request')
  const original = await f.admit(source.requestId)
  const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
  f.hold(original.turnId!)
  await f.h.turns.startNextQueuedTurn(original.threadId)
  const execution = f.h.loop.runTurn(original.threadId, original.turnId!)
  try {
    await f.entered.promise
    const response = (await f.store.list<RoomMessage>('message', { roomId: f.created.roomId }))
      .find((message) => message.value.authorKind === 'member')!.value
    await controlDirectRequest(f.runtime, f.created.roomId, source.requestId,
      { action: 'stop', clientRequestId: 'stop', expectedRevision: (await f.row(source.requestId)).revision })
    f.release.resolve()
    await execution
    await f.tick()
    expect((await f.row(source.requestId)).value.status).toBe('cancelled')
    const reply = await f.send('Please continue', response)
    expect(reply.message).toMatchObject({ rootRequestId: reply.requestId, replyToMessageId: response.id,
      displayThreadRootId: response.displayThreadRootId ?? response.id })
    const done = await f.finish(reply.requestId)
    expect(done.status).toBe('completed')
    expect(done.threadId).toBe(original.threadId)
    expect((await roomDiscussionBusy(f.deps)).size).toBe(0)
    const third = await f.send('Another request')
    const last = await f.finish(third.requestId)
    expect(last.status).toBe('completed')
    expect(last.turnId).not.toBe(done.turnId)
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(await f.store.list('room_run', { roomId: f.created.roomId, status: ['queued', 'running', 'recovery_required'] })).toEqual([])
  } finally { f.release.resolve(); await execution }
}, 15_000)

it('rejects a stopped response budget before recording a run and lets the next user message complete', async () => {
  const f = await fixture()
  const source = await f.send('Original request')
  expect((await f.finish(source.requestId)).status).toBe('completed')
  const reply = await f.send('Reply accepted just before Stop', source.message)
  const root = await f.row(source.requestId)
  await putRoomDocument(f.store, 'request', root.id, root.roomId!,
    { ...root.value, status: 'cancelled', cancellationRequested: true }, root)
  const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
  const failed = await f.admit(reply.requestId)
  expect(failed).toMatchObject({ status: 'failed', error: 'source discussion stopped' })
  expect(await f.store.list('room_run', { requestId: reply.requestId })).toHaveLength(0)
  expect(enqueue).not.toHaveBeenCalled()
  expect((await roomDiscussionBusy(f.deps)).size).toBe(0)
  expect((await f.finish((await f.send('Next request')).requestId)).status).toBe('completed')
})

it('repairs a persisted failed request with an orphan queued run on runtime startup', async () => {
  const f = await fixture()
  const sent = await f.send('Failed admission')
  const request = await f.row(sent.requestId)
  await putRoomDocument(f.store, 'request', request.id, request.roomId!, { ...request.value, status: 'failed' }, request)
  const now = new Date().toISOString()
  const clientRequestId = 'private-' + request.id + '-0'
  const run = RoomRunRecordSchema.parse({ id: roomRunId(f.created.roomId, clientRequestId), roomId: f.created.roomId,
    requestId: request.id, rootRequestId: request.id, phase: 'conversation', memberId: f.created.agentId,
    participantAgentId: f.created.agentId, memberLabel: 'Kun', attempt: 1, clientRequestId,
    input: 'Failed admission', status: 'queued', createdAt: now, updatedAt: now })
  await putRoomDocument(f.store, 'room_run', run.id, run.roomId, run, null)
  expect((await roomDiscussionBusy(f.deps)).size).toBe(0)
  await f.runtime.close()
  await f.store.close()
  const store = new SqliteRoomStore({ path: join(f.root, 'rooms.sqlite') })
  const runtime = new RoomRuntime({ ...f.deps, store })
  const dispatcher = new QueuedTurnDispatcher({ turns: f.h.turns, threadStore: f.h.threadStore,
    runTurn: (threadId, turnId) => f.h.loop.runTurn(threadId, turnId) })
  f.h.turns.setTurnQueuedHook((id) => dispatcher.requestDrain(id))
  f.h.turns.setTurnSettledHook((id, status) => dispatcher.onTurnSettled(id, status))
  cleanups.push(async () => { await runtime.close(); await dispatcher.dispose(); await store.close() })
  runtime.start()
  await vi.waitFor(async () => {
    expect((await store.get<RoomRunRecord>('room_run', run.id))?.value).toMatchObject({ status: 'failed', outcome: 'failed' })
  })
  expect((await roomDiscussionBusy(runtime.deps)).size).toBe(0)
  const fresh = await runtime.service.send(f.created.roomId, { clientRequestId: 'after-restart', body: 'Continue' })
  await vi.waitFor(async () => {
    expect((await store.get<RoomRequestState>('request', fresh.requestId))?.value.status).toBe('completed')
  }, { timeout: 8_000 })
}, 15_000)

it('settles a prepared steering run when saving its intent fails before any steer call', async () => {
  const f = await fixture()
  const first = await f.admit((await f.send('Running request')).requestId)
  await f.h.turns.startNextQueuedTurn(first.threadId)
  const second = await f.send('Steer this request')
  await f.tick()
  const commit = f.store.commit.bind(f.store)
  const failure = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
    if (input.puts?.some((put) => put.kind === 'request' && put.id === second.requestId && (put.value as RoomRequestState).steer)) {
      throw new Error('steer preparation failed')
    }
    return commit(input)
  })
  const steer = vi.spyOn(f.h.turns, 'steerTurn')
  await f.tick()
  failure.mockRestore()
  expect((await f.row(second.requestId)).value.status).toBe('failed')
  expect(steer).not.toHaveBeenCalled()
  const runs = await f.store.list<RoomRunRecord>('room_run', { requestId: second.requestId })
  expect(runs).toHaveLength(1)
  expect(runs[0].value).toMatchObject({ status: 'failed', outcome: 'failed', error: 'steer preparation failed' })
})
