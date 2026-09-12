import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
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
