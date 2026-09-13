import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { SendRoomMessageSchema } from '../contracts/rooms.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { ensureRoomThread, enqueueRoomTurn } from './room-execution.js'
import { roomRunId, updateRoomRun, observeRecordedRoomTurn } from './room-run-recording.js'
import { RoomService } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'

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
