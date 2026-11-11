import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { quickCreateAgent } from '../agents/agent-chat-entry.js'
import { controlDirectRequest } from '../agents/agent-direct-service.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { createTurnRecord } from '../domain/turn.js'
import { roomDiscussionBusy } from './room-discussion-scheduler.js'
import { ensureRoomThread } from './room-execution.js'
import { prepareRoomRun, updateRoomRun } from './room-run-recording.js'
import { RoomRuntime } from './room-runtime.js'
import type { RoomRequestState, RoomRuntimeDeps } from './room-runtime-types.js'
import { putRoomDocument } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { savePrivateRequestWithRunSettlement } from './private-request-run-settlement.js'
import type { RoomStoreCommit } from './room-store.js'

const mismatches = ['room', 'member', 'agent', 'thread', 'client', 'run-id', 'request-id', 'phase', 'turn-id'] as const
type Mismatch = typeof mismatches[number]
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-terminal-request-run-'))
  const path = join(root, 'rooms.sqlite')
  let store = new SqliteRoomStore({ path })
  const h = makeHarness(makeFakeModel([]))
  const deps: RoomRuntimeDeps = {
    store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), dataDir: root,
    model: () => ({ model: 'fake' }),
    profiles: () => ({ general: { mode: 'subagent', toolPolicy: 'inherit' } }),
    assertOwnership: async () => {}
  }
  let runtime = new RoomRuntime(deps)
  const created = await quickCreateAgent(runtime.agents, { clientRequestId: 'create' }, true)
  cleanups.push(async () => {
    await runtime.close()
    await h.turns.interruptActiveTurns()
    await store.close()
    await rm(root, { recursive: true, force: true })
  })
  const request = async (id: string) => (await store.get<RoomRequestState>('request', id))!
  const run = async (id: string) => (await store.get<RoomRunRecord>('room_run', id))!
  const saveRequest = async (id: string, patch: Partial<RoomRequestState>) => {
    const row = await request(id)
    await putRoomDocument(store, 'request', row.id, row.roomId!, { ...row.value, ...patch }, row)
  }
  const tick = async () => {
    // Use the production coordinator, including its persisted busy-lane scan.
    // As in room-runtime-scheduler.test.ts, drive bounded passes without timers.
    const driver = runtime as unknown as { stopped: boolean; tick(): Promise<unknown> }
    driver.stopped = false
    try { await driver.tick() } finally { driver.stopped = true }
  }
  const advance = async (id: string, ready: (value: RoomRequestState) => boolean) => {
    for (let pass = 0; pass < 12; pass++) {
      const row = await request(id)
      if (ready(row.value)) return row.value
      await tick()
    }
    return (await request(id)).value
  }
  const reopen = async () => {
    await runtime.close()
    await store.close()
    store = new SqliteRoomStore({ path })
    deps.store = store
    runtime = new RoomRuntime(deps)
  }
  // Repair fixtures deliberately represent persisted producer receipts, not a
  // renderer/HTTP end-to-end reproduction. Create their input with service.send
  // and Runtime, and their queued receipt with the real prepareRoomRun producer.
  const retainedRun = async (status: 'failed' | 'cancelled', identity?: Mismatch, body = 'Earlier request') => {
    const sent = await runtime.service.send(created.roomId, { clientRequestId: 'retained', body })
    await tick()
    const row = await request(sent.requestId)
    expect(row.value.privateInput).toBeDefined()
    const member = row.value.roomSnapshot.members[0]
    const producerMember = { ...member,
      ...(identity === 'member' ? { id: 'another-member' } : {}),
      ...(identity === 'agent' ? { participantAgentId: 'another-agent' } : {}) }
    const thread = await ensureRoomThread(deps, {
      id: identity === 'thread' ? 'another-thread' : row.value.threadId,
      roomId: identity === 'room' ? 'another-room' : created.roomId,
      requestId: row.id, rootRequestId: row.value.rootRequestId, member: producerMember,
      kind: 'conversation', workspace: row.value.privateWorkspace
    })
    let receipt = await prepareRoomRun(deps, thread,
      identity === 'client' ? 'private-another-request-0' : 'private-' + row.id + '-0',
      row.value.privateInput!, [], {
        requestId: identity === 'request-id' ? 'another-request' : row.id,
        rootRequestId: row.value.rootRequestId, triggerMessageId: row.value.sourceMessageId,
        phase: identity === 'phase' ? 'discussion' : 'conversation'
      })
    if (identity === 'run-id') {
      // Model a persisted malformed sibling at creation, never bypass the
      // store's immutable identity checks by editing an existing receipt.
      await updateRoomRun(store, receipt.id, { status: 'failed', outcome: 'failed', endedAt: new Date().toISOString() })
      receipt = { ...receipt, id: 'not-the-derived-run-id' }
      await putRoomDocument(store, 'room_run', receipt.id, receipt.roomId, receipt, null)
    }
    if (identity === 'turn-id') {
      await updateRoomRun(store, receipt.id, { turnId: 'unknown-turn' })
      receipt = (await run(receipt.id)).value
    }
    await saveRequest(row.id, { status, cancellationRequested: status === 'cancelled',
      // The real budget-failure path loses privateRunId before saving the request.
      ...(status === 'cancelled' ? { privateRunId: receipt.id } : {}),
      error: status === 'failed' ? 'source discussion stopped' : undefined })
    return { requestId: row.id, receipt, thread, member }
  }
  return {
    h, deps, created, tick, advance, reopen, request, run, saveRequest, retainedRun,
    get store() { return store }, get runtime() { return runtime }
  }
}

describe('terminal private request run ownership', () => {
  it.each([false, true])('settles the actual stop then reply failure and forwards FIFO (reopen=%s)', async (restart) => {
    const f = await fixture()
    const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
    const source = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'source', body: 'First response' })
    const admitted = await f.advance(source.requestId, value => Boolean(value.turnId))
    expect(admitted.turnId).toBeDefined()
    await controlDirectRequest(f.runtime, f.created.roomId, source.requestId, {
      action: 'stop', clientRequestId: 'stop-source', expectedRevision: (await f.request(source.requestId)).revision
    })
    const cancelled = await f.advance(source.requestId, value => value.status === 'cancelled')
    expect(cancelled.status).toBe('cancelled')
    const thread = await f.h.threads.getMetadata(cancelled.threadId)
    expect(thread?.turns.find(turn => turn.id === admitted.turnId)?.status).toBe('aborted')

    // This is the runtime side of the user interaction, not a GUI smoke test:
    // send inherits the cancelled root from the explicit reply; the budget guard
    // throws only AFTER prepareRoomRun durably creates its private queued run.
    const reply = await f.runtime.service.send(f.created.roomId, {
      clientRequestId: 'reply-to-stopped', body: 'Reply after cancelling', replyToMessageId: source.message.id
    })
    const failed = await f.advance(reply.requestId, value => value.status === 'failed')
    expect(failed.rootRequestId).toBe(source.requestId)
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('source discussion stopped')
    expect(failed.turnId).toBeUndefined()
    expect(failed.admissionAttempted).not.toBe(true)
    expect(enqueue).toHaveBeenCalledTimes(1)
    const receipts = await f.store.list<RoomRunRecord>('room_run', { requestId: reply.requestId })
    expect(receipts).toHaveLength(1)
    const receiptId = receipts[0].id
    await f.tick()
    expect((await f.run(receiptId)).value).toMatchObject({ status: 'failed', outcome: 'failed', endedAt: expect.any(String) })
    expect((await f.run(receiptId)).value.turnId).toBeUndefined()

    if (restart) await f.reopen()
    expect((await f.run(receiptId)).value).toMatchObject({ status: 'failed', outcome: 'failed', endedAt: expect.any(String) })
    const next = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'next', body: 'A new request' })
    const forward = await f.advance(next.requestId, value => Boolean(value.turnId))
    expect(forward.status).toBe('running')
    expect(forward.turnId).toBeDefined()
    expect(forward.rootRequestId).toBe(next.requestId)
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect((await f.h.threads.getMetadata(forward.threadId))?.turns
      .find(turn => turn.id === forward.turnId)?.clientRequestId).toBe('private-' + next.requestId + '-0')
  })

  it.each(['failed', 'cancelled'] as const)('repairs an already persisted %s request without a turn after reopen', async (status) => {
    const f = await fixture()
    const stale = await f.retainedRun(status)
    expect((await f.run(stale.receipt.id)).value.status).toBe('queued')
    await f.reopen()
    const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
    const next = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'next', body: 'Continue FIFO' })
    const forward = await f.advance(next.requestId, value => Boolean(value.turnId))
    expect((await f.run(stale.receipt.id)).value).toMatchObject({ status, outcome: status, endedAt: expect.any(String) })
    expect((await f.request(stale.requestId)).value.status).toBe(status)
    expect(forward.turnId).toBeDefined()
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0][0].request.clientRequestId).toBe('private-' + next.requestId + '-0')
    const settled = await f.run(stale.receipt.id)
    await f.tick()
    expect((await f.run(stale.receipt.id)).revision).toBe(settled.revision)
    await f.reopen()
    expect((await f.run(stale.receipt.id)).value).toEqual(settled.value)
  })

  it('advances the bounded repair cursor beyond 100 protected reservations', async () => {
    const f = await fixture()
    const room = await f.runtime.service.get(f.created.roomId)
    const thread = await ensureRoomThread(f.deps, { id: 'protected-thread', roomId: room.id,
      member: room.members[0], kind: 'conversation', workspace: f.deps.dataDir })
    const protectedIds: string[] = []
    for (let index = 0; index < 100; index++) {
      const sent = await f.runtime.service.send(room.id, { clientRequestId: 'protected-' + index, body: 'Unknown admission ' + index })
      const receipt = await prepareRoomRun(f.deps, thread, 'private-' + sent.requestId + '-0', sent.message.body, [], {
        requestId: sent.requestId, rootRequestId: sent.requestId, phase: 'conversation'
      })
      await updateRoomRun(f.store, receipt.id, { admissionAttempted: true })
      await f.saveRequest(sent.requestId, { status: 'failed', threadId: thread.id, admissionAttempted: true })
      protectedIds.push(receipt.id)
    }
    const safe = await f.retainedRun('failed')
    await f.reopen() // Reset the Runtime cursor after seeding all 101 receipts.
    await f.tick()
    expect((await f.run(safe.receipt.id)).value.status).toBe('queued')
    await f.tick()
    expect((await f.run(safe.receipt.id)).value).toMatchObject({ status: 'failed', outcome: 'failed', endedAt: expect.any(String) })
    const remaining = await f.store.list<RoomRunRecord>('room_run', { status: 'queued', order: 'asc', limit: 1000 })
    expect(remaining.map(row => row.id)).toEqual(protectedIds)
    for (const row of remaining) {
      expect(row.value.admissionAttempted).toBe(true)
      expect(row.value.endedAt).toBeUndefined()
    }
  })

  it('preserves full input and its immutable context while settling from a summary scan', async () => {
    const f = await fixture()
    const body = 'LONG_INPUT_START ' + 'reference material '.repeat(100) + ' LONG_INPUT_END'
    const stale = await f.retainedRun('failed', undefined, body)
    const before = await f.run(stale.receipt.id)
    expect(before.value.input).toBe(body)
    expect(before.value.input.length).toBeGreaterThan(800)
    const context = await f.store.get('context', before.value.contextId!)
    const summaries = await f.store.list<RoomRunRecord>('room_run', { requestId: stale.requestId, summaryOnly: true })
    expect(summaries[0].value.input).toBe(body.slice(0, 800))
    await f.reopen()
    await f.tick()
    const after = await f.run(stale.receipt.id)
    expect(after.value.status).toBe('failed')
    expect(after.value.input).toBe(body)
    expect(after.value.contextId).toBe(before.value.contextId)
    expect(after.value.createdAt).toBe(before.value.createdAt)
    expect(after.value.attachmentIds).toEqual(before.value.attachmentIds)
    expect(await f.store.get('context', before.value.contextId!)).toEqual(context)
  })

  it('terminalizes a cancelled pre-admission run through the actual Runtime cancellation branch', async () => {
    const f = await fixture()
    const stale = await f.retainedRun('cancelled')
    // Re-enter the production stop-consumption path, with no accepted turn.
    await f.saveRequest(stale.requestId, { status: 'stopping', cancellationRequested: true })
    await f.tick()
    expect((await f.request(stale.requestId)).value.status).toBe('cancelled')
    expect((await f.run(stale.receipt.id)).value).toMatchObject({ status: 'cancelled', outcome: 'cancelled', endedAt: expect.any(String) })
    const busy = await roomDiscussionBusy(f.deps)
    expect(busy.has(f.created.roomId + ':' + stale.member.id)).toBe(false)
    expect(busy.has('agent:' + stale.member.participantAgentId)).toBe(false)
  })
})

describe('terminal request cleanup retains uncertain executions', () => {
  it.each(['queued', 'running', 'missing', 'unreadable'] as const)('keeps admitted %s identity occupied after reopen', async (state) => {
    const f = await fixture()
    const stale = await f.retainedRun('failed')
    const turnId = 'retained-turn'
    if (state === 'queued' || state === 'running') {
      await f.h.threadStore.upsert({ ...stale.thread, turns: [createTurnRecord({
        id: turnId, threadId: stale.thread.id, clientRequestId: stale.receipt.clientRequestId,
        prompt: stale.receipt.input, status: state
      })] })
    }
    await updateRoomRun(f.store, stale.receipt.id, { admissionAttempted: true,
      ...(state === 'queued' || state === 'running' ? { turnId } : {}) })
    await f.saveRequest(stale.requestId, { admissionAttempted: true,
      ...(state === 'queued' || state === 'running' ? { turnId } : {}) })
    await f.reopen()
    if (state === 'unreadable') {
      const metadata = f.h.threads.getMetadata.bind(f.h.threads)
      vi.spyOn(f.h.threads, 'getMetadata').mockImplementation(async id => {
        if (id === stale.thread.id) throw new Error('temporary transport failure')
        return metadata(id)
      })
    }
    const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
    const next = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'blocked', body: 'Wait for original execution' })
    for (let pass = 0; pass < 4; pass++) await f.tick()
    const retained = (await f.run(stale.receipt.id)).value
    expect(['queued', 'running', 'recovery_required']).toContain(retained.status)
    expect(retained.endedAt).toBeUndefined()
    expect(retained.outcome).toBeUndefined()
    expect((await f.request(next.requestId)).value.turnId).toBeUndefined()
    expect(enqueue).not.toHaveBeenCalled()
    const busy = await roomDiscussionBusy(f.deps)
    expect(busy.has(f.created.roomId + ':' + stale.member.id)).toBe(true)
    expect(busy.has('agent:' + stale.member.participantAgentId)).toBe(true)
    await f.reopen()
    expect((await f.run(stale.receipt.id)).value.endedAt).toBeUndefined()
  })

  it.each(['queued', 'running', 'unreadable', 'steer', 'merged'] as const)('retains %s evidence when both admission flags are absent', async (evidence) => {
    const f = await fixture()
    const stale = await f.retainedRun('failed')
    if (evidence === 'queued' || evidence === 'running') {
      await f.h.threadStore.upsert({ ...stale.thread, turns: [createTurnRecord({
        id: 'unreceipted-turn', threadId: stale.thread.id, clientRequestId: stale.receipt.clientRequestId,
        prompt: stale.receipt.input, status: evidence
      })] })
    }
    if (evidence === 'unreadable') {
      const metadata = f.h.threads.getMetadata.bind(f.h.threads)
      vi.spyOn(f.h.threads, 'getMetadata').mockImplementation(async id => {
        if (id === stale.thread.id) throw new Error('temporary transport failure')
        return metadata(id)
      })
    }
    if (evidence === 'steer') await f.saveRequest(stale.requestId, { steer: {
      operationId: 'steer-operation', targetTurnId: 'unreceipted-turn', targetRunId: 'target-run'
    } })
    if (evidence === 'merged') await updateRoomRun(f.store, stale.receipt.id, { mergedIntoRunId: 'target-run' })
    await f.tick()
    const retained = (await f.run(stale.receipt.id)).value
    expect(['queued', 'running', 'recovery_required']).toContain(retained.status)
    expect(retained.outcome).toBeUndefined()
    expect(retained.endedAt).toBeUndefined()
    expect((await roomDiscussionBusy(f.deps)).has(f.created.roomId + ':' + stale.member.id)).toBe(true)
  })

  it.each(['running-run', 'started-run', 'request-turn'] as const)('retains %s evidence even without an admission flag', async (evidence) => {
    const f = await fixture()
    const stale = await f.retainedRun('failed')
    if (evidence === 'running-run') await updateRoomRun(f.store, stale.receipt.id, { status: 'running' })
    if (evidence === 'started-run') await updateRoomRun(f.store, stale.receipt.id, { startedAt: new Date().toISOString() })
    if (evidence === 'request-turn') await f.saveRequest(stale.requestId, { turnId: 'unknown-turn' })
    const before = await f.run(stale.receipt.id)
    await f.tick()
    expect(await f.run(stale.receipt.id)).toEqual(before)
    expect((await roomDiscussionBusy(f.deps)).has(f.created.roomId + ':' + stale.member.id)).toBe(true)
  })

  it.each(['request', 'run'] as const)('retains unknown admission recorded only on the %s', async (owner) => {
    const f = await fixture()
    const stale = await f.retainedRun('cancelled')
    if (owner === 'request') await f.saveRequest(stale.requestId, { admissionAttempted: true })
    else await updateRoomRun(f.store, stale.receipt.id, { admissionAttempted: true })
    await f.tick()
    const retained = (await f.run(stale.receipt.id)).value
    expect(['queued', 'running', 'recovery_required']).toContain(retained.status)
    expect(retained.endedAt).toBeUndefined()
    expect((await roomDiscussionBusy(f.deps)).has(f.created.roomId + ':' + stale.member.id)).toBe(true)
  })
})

describe('terminal request settlement bounds long error summaries', () => {
  it('repairs a historical reservation with a long error while preserving the request', async () => {
    const f = await fixture()
    const stale = await f.retainedRun('failed')
    const error = 'E'.repeat(5000) + ' ORIGINAL_ERROR_END'
    await f.saveRequest(stale.requestId, { error })
    const before = await f.request(stale.requestId)
    const receipt = await f.run(stale.receipt.id)
    const commit = vi.spyOn(f.store, 'commit')
    await f.tick()
    const settled = await f.run(stale.receipt.id)
    expect(settled.value).toMatchObject({ status: 'failed', outcome: 'failed', endedAt: expect.any(String), error: error.slice(0, 4000) })
    expect(settled.value.error!.length).toBeLessThanOrEqual(4000)
    expect(await f.request(stale.requestId)).toEqual(before)
    expect(settled.revision).toBe(receipt.revision + 1)
    const transaction = commit.mock.calls.find(([input]) => input.puts?.some(put => put.kind === 'room_run' && put.id === receipt.id))?.[0]
    expect(transaction?.checks).toEqual(expect.arrayContaining([
      { kind: 'request', id: before.id, expectedRevision: before.revision },
      { kind: 'room_run', id: receipt.id, expectedRevision: receipt.revision }
    ]))
  })

  it('atomically saves a failed request with a long error and a bounded run summary', async () => {
    const f = await fixture()
    const stale = await f.retainedRun('failed')
    await f.saveRequest(stale.requestId, { status: 'pending', error: undefined })
    const before = await f.request(stale.requestId)
    const receipt = await f.run(stale.receipt.id)
    const error = 'E'.repeat(4001) + ' ORIGINAL_ERROR_END'
    const commit = vi.spyOn(f.store, 'commit')
    await savePrivateRequestWithRunSettlement(f.deps, before, { ...before.value, status: 'failed', error })
    const saved = await f.request(stale.requestId)
    const settled = await f.run(stale.receipt.id)
    expect(saved.value).toEqual({ ...before.value, status: 'failed', error })
    expect(saved.revision).toBe(before.revision + 1)
    expect(settled.value).toMatchObject({ status: 'failed', outcome: 'failed', endedAt: expect.any(String), error: error.slice(0, 4000) })
    expect(settled.value.error!.length).toBeLessThanOrEqual(4000)
    expect(settled.revision).toBe(receipt.revision + 1)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0][0].checks).toEqual(expect.arrayContaining([
      { kind: 'request', id: before.id, expectedRevision: before.revision },
      { kind: 'room_run', id: receipt.id, expectedRevision: receipt.revision }
    ]))
  })
})

describe('terminal request cleanup uses atomic ownership checks', () => {
  it.each(['request', 'run'] as const)('does not release a reservation after a %s admission CAS race', async (owner) => {
    const f = await fixture()
    const stale = await f.retainedRun('failed')
    const requestBefore = await f.request(stale.requestId)
    const runBefore = await f.run(stale.receipt.id)
    const commit = f.store.commit.bind(f.store)
    let attempted: RoomStoreCommit | undefined
    vi.spyOn(f.store, 'commit').mockImplementation(async input => {
      const settlement = input.puts?.some(put => put.kind === 'room_run' && put.id === stale.receipt.id &&
        ['failed', 'cancelled'].includes((put.value as RoomRunRecord).status))
      if (settlement && !attempted) {
        attempted = input
        // An admission wins between settlement's reads and its transaction.
        // Commit through the original store, so the proposed CAS really loses.
        const row = owner === 'request' ? requestBefore : runBefore
        await commit({ requestId: 'concurrent-admission-' + owner,
          checks: [{ kind: row.kind, id: row.id, expectedRevision: row.revision }],
          puts: [{ kind: row.kind, id: row.id, roomId: row.roomId,
            value: { ...row.value, admissionAttempted: true } }] })
      }
      return commit(input)
    })
    await f.tick()
    expect(attempted).toBeDefined()
    expect(attempted?.checks).toEqual(expect.arrayContaining([
      { kind: 'request', id: requestBefore.id, expectedRevision: requestBefore.revision },
      { kind: 'room_run', id: runBefore.id, expectedRevision: runBefore.revision }
    ]))
    const retained = (await f.run(stale.receipt.id)).value
    expect(retained.status).toBe('queued')
    expect(retained.outcome).toBeUndefined()
    expect(retained.endedAt).toBeUndefined()
    expect((await roomDiscussionBusy(f.deps)).has(f.created.roomId + ':' + stale.member.id)).toBe(true)
    expect(owner === 'request' ? (await f.request(stale.requestId)).value.admissionAttempted : retained.admissionAttempted).toBe(true)
  })
})

describe('terminal request cleanup checks exact provenance', () => {
  it.each(mismatches)('does not terminalize a queued run with mismatched %s', async (identity) => {
    const f = await fixture()
    const stale = await f.retainedRun('failed', identity)
    const before = await f.run(stale.receipt.id)
    await f.reopen()
    await f.tick()
    const after = await f.run(stale.receipt.id)
    expect(after.value).toEqual(before.value)
    expect(after.revision).toBe(before.revision)
    expect(after.value.status).toBe('queued')
  })
})
