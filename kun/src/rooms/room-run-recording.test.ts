import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { SendRoomMessageSchema } from '../contracts/rooms.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { ensureRoomThread, enqueueRoomTurn } from './room-execution.js'
import { roomRunId, updateRoomRun, observeRecordedRoomTurn, prepareRoomRun,
  reconcileRecordedRoomRuns, settleTerminalRoomRuns, recoverAbandonedRoomRuns } from './room-run-recording.js'
import { roomDiscussionBusy } from './room-discussion-scheduler.js'
import { RoomPeerStore } from './room-peer-state.js'
import { roomRunDetail } from './room-run-query.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'kun-run-recording-'))
  const store = new SqliteRoomStore({ path: join(directory, 'rooms.sqlite') })
  const h = makeHarness(makeFakeModel([]))
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate, dataDir: directory,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'fake' }), profiles: () => ({}), assertOwnership: async () => {} }
  cleanups.push(async () => { await h.turns.interruptActiveTurns(); await store.close(); await rm(directory, { recursive: true, force: true }) })
  const service = new RoomService(store, () => {})
  const room = (await service.create({ clientRequestId: 'create', name: 'Provenance' })).room
  const input = await service.send(room.id, { clientRequestId: 'input', body: 'Read-only original requirement' })
  const member = room.members[0]
  const thread = await ensureRoomThread(deps, { id: 'coordinator-thread', roomId: room.id,
    requestId: input.requestId, kind: 'coordination', member })
  return { h, deps, store, service, room, member, input, thread }
}

describe('room native run admission and publication', () => {
  it('preserves exact inputs, stable replay and distinct attempt identity', async () => {
    const f = await fixture()
    const first = await enqueueRoomTurn(f.deps, f.thread.id, 'attempt-1', 'Frozen supplemental prompt')
    expect(await enqueueRoomTurn(f.deps, f.thread.id, 'attempt-1', 'Frozen supplemental prompt')).toBe(first)
    await expect(enqueueRoomTurn(f.deps, f.thread.id, 'attempt-1', 'Different prompt')).rejects.toThrow('different input')
    const second = await enqueueRoomTurn(f.deps, f.thread.id, 'attempt-2', 'New attempt prompt')
    expect(second).not.toBe(first)
    const runs = await f.store.list<RoomRunRecord>('room_run', { roomId: f.room.id,
      phase: 'coordination', memberId: f.member.id, requestId: f.input.requestId, order: 'asc' })
    expect(runs).toHaveLength(2)
    expect(runs[0].value).toMatchObject({ threadId: f.thread.id, turnId: first,
      input: 'Read-only original requirement', triggerMessageId: f.input.message.id, attempt: 1 })
    expect(runs[1].value).toMatchObject({ turnId: second, attempt: 2, previousRunId: runs[0].id })
    expect((await f.store.get<{ prompt: string }>('context', runs[0].value.contextId!))?.value.prompt)
      .toBe('Frozen supplemental prompt')
    expect(await f.store.list('room_run', { roomId: f.room.id, clientRequestId: 'attempt-1' })).toHaveLength(1)
  })

  it('exposes a preview workspace only for the exact validated run', async () => {
    const f = await fixture()
    await enqueueRoomTurn(f.deps, f.thread.id, 'preview', 'Read')
    const id = roomRunId(f.room.id, 'preview')
    expect((await roomRunDetail(f.deps, f.room.id, id)).workspaceRoot).toBe(f.thread.workspace)
    const record = (await f.h.threadStore.get(f.thread.id))!
    await f.h.threadStore.upsert({ ...record, roomContext: { ...record.roomContext!, roomId: 'other-room' } })
    const mismatched = await roomRunDetail(f.deps, f.room.id, id)
    expect(mismatched.availability.status).toBe('scope_mismatch')
    expect(mismatched.workspaceRoot).toBeUndefined()
  })

  it('does not readmit an unknown execution after an uncertain queue failure', async () => {
    const f = await fixture()
    const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn').mockRejectedValue(new Error('Queue transport timed out'))
    await expect(enqueueRoomTurn(f.deps, f.thread.id, 'unknown', 'Frozen input')).rejects.toThrow('timed out')
    await expect(enqueueRoomTurn(f.deps, f.thread.id, 'unknown', 'Frozen input')).rejects.toThrow('requires reconciliation')
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect((await f.store.get<RoomRunRecord>('room_run', roomRunId(f.room.id, 'unknown')))?.value)
      .toMatchObject({ status: 'recovery_required', admissionAttempted: true })
  })

  it('retains a known model and partial usage when completion telemetry is unavailable', async () => {
    const f = await fixture()
    const turnId = await enqueueRoomTurn(f.deps, f.thread.id, 'partial-usage', 'Frozen input')
    const id = roomRunId(f.room.id, 'partial-usage')
    const usage = { ...emptyUsageSnapshot(), promptTokens: 12, completionTokens: 3, totalTokens: 15, turns: 1 }
    await updateRoomRun(f.store, id, { model: 'known-upstream-model', usage, usageStatus: 'partial' })
    const thread = (await f.h.threads.getMetadata(f.thread.id))!
    const turn = { ...thread.turns.find((entry) => entry.id === turnId)!,
      status: 'completed' as const, finishedAt: new Date().toISOString() }
    await observeRecordedRoomTurn(f.deps, thread, turn)
    const saved = (await f.store.get<RoomRunRecord>('room_run', id))!.value
    expect(saved).toMatchObject({ status: 'completed', model: 'known-upstream-model', usageStatus: 'partial', usage })
  })

  it('allows runtime-only atomic provenance and rejects source reassignment and user spoofing', async () => {
    const f = await fixture()
    const turnId = await enqueueRoomTurn(f.deps, f.thread.id, 'native', 'Frozen input')
    const id = roomRunId(f.room.id, 'native')
    expect(SendRoomMessageSchema.safeParse({ clientRequestId: 'spoof', body: 'Forged reply', originRunId: id }).success).toBe(false)
    await expect(f.service.append(f.room.id, 'wrong-member', 'Reply', 'developer', undefined, id))
      .rejects.toThrow('provenance')
    expect(await f.store.get('message', 'wrong-member')).toBeNull()
    await f.service.append(f.room.id, 'right-member', 'Reply', f.member.id, undefined, id)
    await expect(f.service.append(f.room.id, 'another-reply', 'Different publication', f.member.id, undefined, id))
      .rejects.toThrow('already published another message')
    const endedAt = new Date().toISOString()
    await updateRoomRun(f.store, id, { status: 'completed', endedAt })
    await updateRoomRun(f.store, id, { status: 'running', endedAt: undefined })
    const row = (await f.store.get<RoomRunRecord>('room_run', id))!
    expect(row.value).toMatchObject({ status: 'completed', endedAt })
    expect(row.value).toMatchObject({ turnId, outcome: 'published', publishedMessageId: 'right-member' })
    expect((await f.store.get<{ originRunId: string }>('message', 'right-member'))?.value.originRunId).toBe(id)
    await expect(f.store.commit({ requestId: 'reassign', checks: [{ kind: 'room_run', id, expectedRevision: row.revision }],
      puts: [{ kind: 'room_run', id, roomId: f.room.id, value: { ...row.value, turnId: 'different-turn' } }] }))
      .rejects.toThrow('identity cannot change')
  })
})

describe('room run terminal recovery and lane accounting', () => {
  async function failRequest(f: Awaited<ReturnType<typeof fixture>>, status: 'failed' | 'cancelled' = 'failed') {
    const row = (await f.store.get<RoomRequestState>('request', f.input.requestId))!
    await putRoomDocument(f.store, 'request', row.id, row.roomId!, { ...row.value, status }, row)
  }

  it('does not reserve a lane for an unadmitted run, without mutating it on reads', async () => {
    const f = await fixture()
    const run = await prepareRoomRun(f.deps, f.thread, 'unadmitted', 'Frozen input', [])
    const before = await f.store.get('room_run', run.id)
    const events = await f.store.events(f.room.id)
    expect(await roomDiscussionBusy(f.deps)).toEqual(new Set())
    await failRequest(f)
    expect(await roomDiscussionBusy(f.deps)).toEqual(new Set())
    expect(await f.store.get('room_run', run.id)).toEqual(before)
    expect((await f.store.events(f.room.id)).filter((event) => event.kind === 'room_run.updated'))
      .toEqual(events.filter((event) => event.kind === 'room_run.updated'))
  })

  it('retains a real queued turn until terminal settlement cancels that exact turn', async () => {
    const f = await fixture()
    const turnId = await enqueueRoomTurn(f.deps, f.thread.id, 'queued', 'Frozen input')
    const id = roomRunId(f.room.id, 'queued')
    await updateRoomRun(f.store, id, { admissionAttempted: false })
    await failRequest(f, 'cancelled')
    expect((await roomDiscussionBusy(f.deps)).has(f.room.id + ':' + f.member.id)).toBe(true)
    await settleTerminalRoomRuns(f.deps, f.input.requestId)
    expect((await f.h.threads.getMetadata(f.thread.id))?.turns.find((turn) => turn.id === turnId)?.status).toBe('aborted')
    expect((await f.store.get<RoomRunRecord>('room_run', id))?.value).toMatchObject({ status: 'cancelled', outcome: 'cancelled' })
    expect(await roomDiscussionBusy(f.deps)).toEqual(new Set())
    const revision = (await f.store.get('room_run', id))!.revision
    await settleTerminalRoomRuns(f.deps, f.input.requestId)
    expect((await f.store.get('room_run', id))!.revision).toBe(revision)
  })

  it('keeps a running turn occupied even if its request already failed', async () => {
    const f = await fixture()
    const turnId = await enqueueRoomTurn(f.deps, f.thread.id, 'running', 'Frozen input')
    await f.h.turns.startNextQueuedTurn(f.thread.id)
    await failRequest(f)
    await settleTerminalRoomRuns(f.deps, f.input.requestId)
    expect((await f.h.threads.getMetadata(f.thread.id))?.turns.find((turn) => turn.id === turnId)?.status).toBe('running')
    expect((await roomDiscussionBusy(f.deps)).has(f.room.id + ':' + f.member.id)).toBe(true)
  })

  it('requires stop proof for an uncertain admission while explicit reconciliation settles unadmitted records', async () => {
    const f = await fixture()
    const orphan = await prepareRoomRun(f.deps, f.thread, 'orphan', 'Never admitted', [])
    const uncertain = await prepareRoomRun(f.deps, f.thread, 'unknown', 'Lost receipt', [])
    await updateRoomRun(f.store, uncertain.id, { admissionAttempted: true })
    await failRequest(f)
    await reconcileRecordedRoomRuns(f.deps, { roomId: f.room.id, requestId: f.input.requestId })
    expect((await f.store.get<RoomRunRecord>('room_run', orphan.id))?.value).toMatchObject({ status: 'failed', outcome: 'failed' })
    expect((await f.store.get<RoomRunRecord>('room_run', uncertain.id))?.value.status).toBe('recovery_required')
    expect((await roomDiscussionBusy(f.deps)).has(f.room.id + ':' + f.member.id)).toBe(true)
    f.deps.proveStopped = async () => true
    await settleTerminalRoomRuns(f.deps, f.input.requestId)
    expect((await f.store.get<RoomRunRecord>('room_run', uncertain.id))?.value.status).toBe('failed')
    expect(await roomDiscussionBusy(f.deps)).toEqual(new Set())
  })

  it('recovers missing requests and aged unadmitted runs, leaving fresh preparations and peer reservations alone', async () => {
    const f = await fixture()
    const old = new Date(Date.now() - 6 * 60_000).toISOString()
    const missing = await prepareRoomRun(f.deps, f.thread, 'missing-request', 'Frozen input', [], { requestId: 'missing' })
    const expired = await prepareRoomRun(f.deps, f.thread, 'expired', 'Frozen input', [])
    const fresh = await prepareRoomRun(f.deps, f.thread, 'fresh', 'Frozen input', [])
    const peer = await prepareRoomRun(f.deps, f.thread, 'peer-reservation', 'Frozen input', [],
      { phase: 'discussion', rootRequestId: f.input.requestId })
    const request = (await f.store.get<RoomRequestState>('request', f.input.requestId))!
    await new RoomPeerStore(f.store).initialize(request.value)
    await updateRoomRun(f.store, expired.id, { createdAt: old })
    await updateRoomRun(f.store, peer.id, { createdAt: old })
    await recoverAbandonedRoomRuns(f.deps)
    expect((await f.store.get<RoomRunRecord>('room_run', missing.id))?.value.status).toBe('failed')
    expect((await f.store.get<RoomRunRecord>('room_run', expired.id))?.value).toMatchObject({ status: 'failed', error: 'admission never started' })
    expect((await f.store.get<RoomRunRecord>('room_run', fresh.id))?.value.status).toBe('queued')
    expect((await f.store.get<RoomRunRecord>('room_run', peer.id))?.value.status).toBe('queued')
    expect((await roomDiscussionBusy(f.deps, true)).has(f.room.id + ':' + f.member.id)).toBe(true)
    const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
    await expect(enqueueRoomTurn(f.deps, f.thread.id, 'expired', 'Frozen input')).rejects.toThrow('already ended')
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('bounds startup repair to three pages and uses sequence cursors while settled rows leave the scan', async () => {
    const f = await fixture()
    const sample = await prepareRoomRun(f.deps, f.thread, 'sample', 'Frozen input', [])
    await failRequest(f)
    const puts = Array.from({ length: 600 }, (_, index) => ({ kind: 'room_run' as const, id: 'repair-' + index,
      roomId: f.room.id, value: { ...sample, id: 'repair-' + index, clientRequestId: 'repair-' + index } }))
    await f.store.commit({ requestId: 'repair-page-fixture', puts,
      checks: puts.map(({ kind, id }) => ({ kind, id, expectedRevision: null })) })
    const list = vi.spyOn(f.store, 'list')
    await recoverAbandonedRoomRuns(f.deps)
    expect(list.mock.calls.filter(([kind]) => kind === 'room_run')).toHaveLength(3)
    expect(await f.store.list('room_run', { roomId: f.room.id, status: ['queued', 'running', 'recovery_required'] })).toHaveLength(1)
  }, 15_000)
})
