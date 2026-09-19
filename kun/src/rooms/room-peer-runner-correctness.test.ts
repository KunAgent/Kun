import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomMessage } from '../contracts/rooms.js'
import { roomRunId } from './room-run-recording.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeModel, makeHarness, makeSilentModel } from '../../tests/loop-test-harness.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import { RoomMemberSchema } from '../contracts/rooms.js'
import type { RuntimeEvent } from '../contracts/events.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomPeerRunner } from './room-peer-runner.js'
import { RoomContextPending } from './room-rule-compression.js'
import { roomPeerTopicPage, roomPeerMetricPage } from './room-peer-api.js'
import { capturePeerUsageBaseline, readPeerTurnUsage } from './room-peer-runner-metrics.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import * as execution from './room-execution.js'
import * as contexts from './room-peer-context.js'
import * as triage from './room-peer-triage.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture(twoMembers = false) {
  const directory = await mkdtemp(join(tmpdir(), 'kun-peer-correctness-'))
  const store = new SqliteRoomStore({ path: join(directory, 'rooms.sqlite') })
  const h = makeHarness(makeFakeModel([]))
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate, dataDir: directory,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'fake' }), profiles: () => ({}), assertOwnership: async () => {} }
  const runner = new RoomPeerRunner(deps, () => {})
  cleanups.push(async () => { await runner.close(); await h.turns.interruptActiveTurns(); await store.close(); await rm(directory, { recursive: true, force: true }) })
  const service = new RoomService(store, () => {})
  const members = [RoomMemberSchema.parse({ id: 'coordinator', displayName: 'Coordinator', presetId: 'general', role: 'coordinator', revision: 0 }),
    ...(twoMembers ? [RoomMemberSchema.parse({ id: 'developer', displayName: 'Developer', presetId: 'general', role: 'developer', revision: 0 })] : [])]
  const room = (await service.create({ clientRequestId: 'room', name: 'Correctness', members })).room
  const sent = await service.send(room.id, { clientRequestId: 'input', body: 'Discuss the current design.', executionIntent: 'discussion' })
  const request = (await store.get<RoomRequestState>('request', sent.requestId))!
  await runner.state.initialize(request.value)
  const active = async () => (await runner.state.member(sent.requestId, 'coordinator'))!
  const finish = async () => {
    const member = await active(), activation = member.value.activation!
    const thread = (await h.threads.getMetadata(activation.threadId))!
    const turn = { ...thread.turns.find((value) => value.id === activation.turnId)!, status: 'completed' as const,
      startedAt: new Date(Date.now() - 100).toISOString(), finishedAt: new Date().toISOString() }
    await h.threadStore.upsert({ ...thread, turns: thread.turns.map((value) => value.id === turn.id ? turn : value) })
    return turn
  }
  return { store, h, deps, runner, service, room, sent, active, finish }
}

describe('peer response failure recovery', () => {
  it('releases a malformed completed response with bounded retry while preserving its pending input', async () => {
    const f = await fixture()
    await f.runner.tick()
    const turn = await f.finish()
    vi.spyOn(execution, 'observeRoomTurn').mockResolvedValue({ status: 'completed', text: '', structured: { body: '', skip: false }, turn, error: undefined, resultError: undefined })
    await f.runner.tick()
    expect((await f.active()).value).toMatchObject({ state: 'failed', handledInboxSeq: 0, retryCount: 1 })
    expect((await f.active()).value.activation).toBeUndefined()
    expect((await f.active()).value.retryAt).toBeDefined()
    await f.runner.tick()
    expect((await f.runner.state.topic(f.sent.requestId))!.value.responseCount).toBe(1)
    expect((await f.store.list<{ outcome: string }>('peer_metric', { rootRequestId: f.sent.requestId }))[0].value.outcome).toBe('failed')
  })

  it('preserves an uncertain live activation instead of treating an observation failure as stopped', async () => {
    const f = await fixture()
    await f.runner.tick()
    const original = (await f.active()).value.activation
    vi.spyOn(execution, 'observeRoomTurn').mockRejectedValue(new Error('transport temporarily unavailable'))
    await f.runner.tick()
    expect((await f.active()).value).toMatchObject({ state: 'recovery_required', activation: original, handledInboxSeq: 0 })
  })

  it('exposes preparation errors before admission and avoids retrying every scheduler tick', async () => {
    const f = await fixture()
    const prepare = vi.spyOn(contexts, 'prepareRoomPeerContext').mockRejectedValue(new Error('Frozen rule bundle missing'))
    await f.runner.tick()
    await f.runner.tick()
    expect(prepare).toHaveBeenCalledTimes(1)
    expect((await f.active()).value).toMatchObject({ state: 'failed', waitingReason: 'preparation_failed', lastError: 'Frozen rule bundle missing', retryCount: 1 })
    expect((await f.active()).value.activation).toBeUndefined()
    expect((await f.runner.state.topic(f.sent.requestId))!.value.responseCount).toBe(0)
  })

  it('waits for pending agreement compression without marking a failure or spending response budget', async () => {
    const f = await fixture()
    vi.spyOn(contexts, 'prepareRoomPeerContext').mockRejectedValue(new RoomContextPending('Compression is in progress'))
    await f.runner.tick()
    expect((await f.active()).value).toMatchObject({ state: 'pending', waitingReason: 'context_compression', handledInboxSeq: 0 })
    expect((await f.active()).value.lastError).toBeUndefined()
    expect((await f.runner.state.topic(f.sent.requestId))!.value.responseCount).toBe(0)
  })

  it('releases a response whose thread creation failed before any admission was attempted', async () => {
    const f = await fixture()
    vi.spyOn(f.h.threads, 'create').mockRejectedValue(new Error('Native model is unavailable'))
    await f.runner.tick()
    expect((await f.active()).value).toMatchObject({ state: 'failed', handledInboxSeq: 0, retryCount: 1 })
    expect((await f.active()).value.activation).toBeUndefined()
  })

  it('promotes a member past a broken lightweight check while a human waits', async () => {
    const f = await fixture(true)
    f.deps.peerModels = { client: makeSilentModel(), roles: () => undefined }
    vi.spyOn(triage, 'roomPeerTriage').mockRejectedValue(new Error('Unexpected end of JSON input'))
    const runner = new RoomPeerRunner(f.deps, () => {}, { debounceMs: 0 })
    try {
      await runner.tick(new Set([f.room.id + ':coordinator']))
      await runner.tick(new Set([f.room.id + ':coordinator']))
      const member = (await runner.state.member(f.sent.requestId, 'developer'))!.value
      expect(member.activation?.phase).toBe('respond')
      expect(member.state).toBe('responding')
      const metrics = await f.store.list<{ outcome: string }>('peer_metric', { rootRequestId: f.sent.requestId })
      expect(metrics.map((row) => row.value.outcome)).toContain('fail_open')
    } finally { await runner.close() }
  })

  it('keeps a broken lightweight check closed when only peers are waiting', async () => {
    const f = await fixture(true)
    f.deps.peerModels = { client: makeSilentModel(), roles: () => undefined }
    const classify = vi.spyOn(triage, 'roomPeerTriage')
    classify.mockResolvedValueOnce({ action: 'skip', reason: 'No contribution', model: 'fake', elapsedMs: 1 })
    const runner = new RoomPeerRunner(f.deps, () => {}, { debounceMs: 0 })
    try {
      await runner.tick()
      await runner.tick()
      expect((await runner.state.member(f.sent.requestId, 'developer'))!.value.handledInboxSeq).toBeGreaterThan(0)
      const turn = await f.finish()
      vi.spyOn(execution, 'observeRoomTurn').mockResolvedValue({ status: 'completed', text: '',
        structured: { body: 'A peer finding.' }, turn, error: undefined, resultError: undefined })
      await runner.tick()
      classify.mockRejectedValue(new Error('Unexpected end of JSON input'))
      await runner.tick()
      await runner.tick()
      expect((await runner.state.member(f.sent.requestId, 'developer'))!.value)
        .toMatchObject({ state: 'failed', waitingReason: 'response_failed', retryCount: 1 })
      const metrics = await f.store.list<{ outcome: string }>('peer_metric', { rootRequestId: f.sent.requestId })
      expect(metrics.map((row) => row.value.outcome)).not.toContain('fail_open')
    } finally { await runner.close() }
  })

  it('reports disabled pending members without keeping an otherwise drained topic busy', async () => {
    const f = await fixture(true)
    const updates = (await f.runner.state.readUpdates(f.sent.requestId, 'coordinator'))!
    await putRoomDocument(f.store, 'peer_member', updates.member.id, f.room.id, {
      ...updates.member.value, state: 'idle', handledInboxSeq: updates.items.at(-1)!.seq
    }, updates.member)
    await f.service.update(f.room.id, { clientRequestId: 'disable-member', expectedRevision: f.room.revision,
      members: f.room.members.map((member) => ({ ...member, enabled: member.id !== 'developer' })) })
    await f.runner.tick()
    expect((await f.runner.state.topic(f.sent.requestId))!.value).toMatchObject({ status: 'idle', pauseReason: 'member_unavailable' })
    const page = await roomPeerTopicPage(f.runner.state, f.room.id)
    expect(page.topics[0].members.find((member) => member.memberId === 'developer')).toMatchObject({ pendingCount: 1, waitingReason: 'member_unavailable' })
  })
})

describe('bounded exact-turn peer metrics', () => {
  it('differences cumulative usage and excludes earlier or unrelated turns', async () => {
    const f = await fixture()
    await f.runner.tick()
    const activation = (await f.active()).value.activation!
    const usage = (prompt: number, completion: number) => ({ ...emptyUsageSnapshot(), promptTokens: prompt,
      completionTokens: completion, totalTokens: prompt + completion, turns: prompt / 10 })
    await f.h.events.record({ kind: 'usage', threadId: activation.threadId, turnId: 'previous', usage: usage(100, 10) })
    const baseline = await capturePeerUsageBaseline(f.deps, activation.threadId)
    await f.h.events.record({ kind: 'usage', threadId: activation.threadId, turnId: activation.turnId, model: 'fake', usage: usage(120, 15) })
    await f.h.events.record({ kind: 'usage', threadId: activation.threadId, turnId: 'unrelated', usage: usage(130, 17) })
    await f.h.events.record({ kind: 'usage', threadId: activation.threadId, turnId: activation.turnId, model: 'fake', usage: usage(150, 22) })
    vi.spyOn(f.h.sessionStore, 'loadEventsSince').mockRejectedValue(new Error('unbounded history is forbidden'))
    expect(await readPeerTurnUsage(f.deps, { ...activation, ...baseline })).toMatchObject({
      usageStatus: 'complete', model: 'fake', usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50 }
    })
  })

  it('records a response skip with actual usage and generation without inventing first-publication latency', async () => {
    const f = await fixture()
    await f.runner.tick()
    const activation = (await f.active()).value.activation!
    await f.h.events.record({ kind: 'usage', threadId: activation.threadId, turnId: activation.turnId,
      model: 'fake', usage: { ...emptyUsageSnapshot(), promptTokens: 20, completionTokens: 4, totalTokens: 24, turns: 1 } })
    const turn = await f.finish()
    vi.spyOn(execution, 'observeRoomTurn').mockResolvedValue({ status: 'completed', text: '', structured: { skip: true }, turn, error: undefined, resultError: undefined })
    await f.runner.tick()
    const page = await roomPeerMetricPage(f.runner.state, f.room.id, f.sent.requestId)
    expect(page.metrics[0]).toMatchObject({ phase: 'response', outcome: 'skipped', generation: 1,
      usageStatus: 'complete', usage: { totalTokens: 24 } })
    expect(page.metrics[0].firstResponseMs).toBeUndefined()
    expect(page.firstResponseAggregation).toBe('minimum_published_response_per_generation')
  })

  it('caps event inspection and reports partial telemetry instead of scanning unlimited history', async () => {
    const f = await fixture()
    await f.runner.tick()
    const activation = (await f.active()).value.activation!
    let yielded = 0
    vi.spyOn(f.h.sessionStore, 'iterateEventsSince').mockImplementation(async function* () {
      for (let seq = 1; seq < 100_000; seq++) {
        yielded++
        yield { kind: 'usage', threadId: activation.threadId, turnId: activation.turnId, seq,
          timestamp: new Date().toISOString(), usage: { ...emptyUsageSnapshot(), promptTokens: seq, totalTokens: seq } } as RuntimeEvent
      }
    })
    const result = await readPeerTurnUsage(f.deps, { ...activation, usageSinceSeq: 0, usageBaseline: emptyUsageSnapshot() })
    expect(result.usageStatus).toBe('partial')
    expect(yielded).toBeLessThanOrEqual(4097)
  })
})

describe('persistent room run provenance', () => {
  it('reserves a response before thread creation and retains failures without a public reply', async () => {
    const f = await fixture()
    vi.spyOn(f.h.threads, 'create').mockImplementation(async () => {
      const runs = await f.store.list<RoomRunRecord>('room_run', { roomId: f.room.id, phase: 'discussion' })
      expect(runs).toHaveLength(1)
      expect(runs[0].value).toMatchObject({ status: 'queued', input: 'Discuss the current design.' })
      expect(runs[0].value.threadId).toBeUndefined()
      throw new Error('Provider unavailable')
    })
    await f.runner.tick()
    const run = (await f.store.list<RoomRunRecord>('room_run', { roomId: f.room.id }))[0].value
    expect(run).toMatchObject({ status: 'failed', outcome: 'failed', error: 'Provider unavailable' })
    expect(run.contextId).toBeDefined()
    expect(run.endedAt).toBeDefined()
    expect((await f.active()).value.activation).toBeUndefined()
    expect(await f.store.list('message', { roomId: f.room.id })).toHaveLength(1)
  })

  it('reconciles a lost admission receipt using the original identity across runner restart', async () => {
    const f = await fixture()
    const original = f.h.turns.enqueueTurn.bind(f.h.turns)
    const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn').mockImplementation(async (input) => {
      const row = await f.store.get<RoomRunRecord>('room_run', roomRunId(f.room.id, input.request.clientRequestId!))
      expect(row?.value.status).toBe('queued')
      await original(input)
      throw new Error('Receipt lost')
    })
    await f.runner.tick()
    const active = (await f.active()).value.activation!
    expect(active.turnId).toBeDefined()
    const record = (await f.store.get<RoomRunRecord>('room_run', roomRunId(f.room.id, active.clientRequestId)))!.value
    expect(record).toMatchObject({ threadId: active.threadId, turnId: active.turnId })
    await f.runner.close()
    const restarted = new RoomPeerRunner(f.deps, () => {})
    try { await restarted.tick(); await restarted.tick() } finally { await restarted.close() }
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(await f.store.list('room_run', { roomId: f.room.id, phase: 'discussion' })).toHaveLength(1)
  })

  it('publishes message provenance atomically even when the subsequent metric write fails', async () => {
    const f = await fixture()
    await f.runner.tick()
    const active = (await f.active()).value.activation!
    const turn = await f.finish()
    vi.spyOn(execution, 'observeRoomTurn').mockResolvedValue({ status: 'completed', text: '',
      structured: { body: 'A durable concrete finding.' }, turn })
    const commit = f.store.commit.bind(f.store)
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (input.puts?.some((put) => put.kind === 'peer_metric')) throw new Error('Metric storage failed')
      return commit(input)
    })
    await f.runner.tick()
    const message = (await f.store.list<RoomMessage>('message', { roomId: f.room.id }))
      .find((row) => row.value.authorKind === 'member')!.value
    expect(message.originRunId).toBe(roomRunId(f.room.id, active.clientRequestId))
    expect((await f.store.get<RoomRunRecord>('room_run', message.originRunId!))?.value)
      .toMatchObject({ turnId: active.turnId, outcome: 'published', publishedMessageId: message.id })
    expect((await f.active()).value.activation).toBeUndefined()
    await f.runner.tick()
    expect((await f.store.list<RoomMessage>('message', { roomId: f.room.id }))
      .filter((row) => row.value.authorKind === 'member')).toHaveLength(1)
  })

  it('keeps a failed lightweight check separate from a native conversation', async () => {
    const f = await fixture(true)
    const runner = new RoomPeerRunner(f.deps, () => {}, { debounceMs: 0 })
    try {
      await runner.tick(new Set([f.room.id + ':coordinator']))
      const runs = await f.store.list<RoomRunRecord>('room_run', { roomId: f.room.id, memberId: 'developer', phase: 'triage' })
      expect(runs).toHaveLength(1)
      expect(runs[0].value).toMatchObject({ status: 'failed', outcome: 'failed', phase: 'triage' })
      expect(runs[0].value.threadId).toBeUndefined()
      expect(runs[0].value.turnId).toBeUndefined()
    } finally { await runner.close() }
  })
})
