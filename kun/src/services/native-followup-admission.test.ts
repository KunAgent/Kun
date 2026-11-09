import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { FollowUpReceiptSchema } from '../contracts/collaboration-effects.js'
import type { NativeFollowUpAdmission } from '../contracts/native-followup-requests.js'
import type { ThreadExecutionLease } from '../contracts/runtime-flavor.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { queueRevision } from '../domain/remote-policy-revision.js'
import { createThreadRecord } from '../domain/thread.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnConflictError, TurnService, type TurnServiceDeps } from './turn-service.js'

const threadId = 'thr_native_followup'
const admission: NativeFollowUpAdmission = {
  requestId: 'request_followup_1', effectId: 'effect_1', attemptId: 'attempt_1',
  admissionKey: 'admission_1', fingerprint: 'a'.repeat(64)
}
const request = { prompt: 'Continue the same bounded code task', model: 'deepseek-v4-pro', clientRequestId: admission.requestId }
const input = { threadId, request }
const options = { nativeFollowUp: admission }
const nowIso = () => '2026-11-02T01:00:00.000Z'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function harness(patch: Partial<TurnServiceDeps> = {}) {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const bus = new InMemoryEventBus()
  const guard: NonNullable<TurnServiceDeps['withFollowUpAdmission']> = async (_input, operation) => operation()
  const deps: TurnServiceDeps = {
    threadStore, sessionStore, nowIso, ids: new SequentialIdGenerator(),
    events: new RuntimeEventRecorder({ eventBus: bus, sessionStore, allocateSeq: (id) => bus.allocateSeq(id), nowIso }),
    inflight: new InflightTracker(), steering: new SteeringQueue(), compactor: new ContextCompactor(),
    withFollowUpAdmission: guard, ...patch
  }
  const turns = new TurnService(deps)
  await threadStore.upsert(createThreadRecord({ id: threadId, title: 'Native follow-up', workspace: '/tmp/native-followup', model: request.model }))
  return {
    turns, threadStore, sessionStore, deps,
    restart: () => new TurnService(deps),
    lookup: (service = turns) => service.lookupNativeFollowUpRequest({ threadId, admission })
  }
}

afterEach(() => vi.restoreAllMocks())

describe('native follow-up durable request receipts', () => {
  it('reports unknown for a missing request or thread without creating negative authority', async () => {
    const h = await harness()
    expect(FollowUpReceiptSchema.parse(await h.lookup())).toMatchObject({ state: 'unknown', reason: 'native_request_not_proven' })
    expect(await h.threadStore.get(threadId)).not.toHaveProperty('nativeFollowUpRequests')
    expect(await h.turns.lookupNativeFollowUpRequest({ threadId: 'thr_missing', admission })).toMatchObject({ state: 'unknown' })
  })

  it('returns unknown when native metadata or lease authority is unavailable', async () => {
    const h = await harness()
    const metadata = vi.spyOn(h.threadStore, 'getMetadata').mockRejectedValue(new Error('Manager disconnected'))
    expect(await h.lookup()).toMatchObject({ state: 'unknown', reason: 'native_query_unavailable' })
    metadata.mockRestore()
    await h.turns.enqueueTurn(input, options)
    h.deps.executionLeases = {
      acquire: async () => { throw new Error('unavailable') }, release: async () => undefined,
      shutdown: async () => undefined, owner: async () => { throw new Error('unavailable') }
    }
    expect(await h.lookup()).toMatchObject({ state: 'unknown', reason: 'native_query_unavailable' })
  })

  it('persists one native queued turn and replays the same receiver identity', async () => {
    const guarded = vi.fn()
    const guard: NonNullable<TurnServiceDeps['withFollowUpAdmission']> = async (_input, operation) => { guarded(); return operation() }
    const h = await harness({ withFollowUpAdmission: guard })
    const first = await h.turns.enqueueTurn(input, options)
    expect(first.status).toBe('queued')
    expect(await h.turns.enqueueTurn(input, options)).toEqual(first)
    expect(await h.turns.startTurn(input)).toMatchObject({ threadId, turnId: first.turnId, userMessageItemId: first.userMessageItemId, status: 'queued' })
    expect(guarded).toHaveBeenCalledTimes(2)
    const receipt = FollowUpReceiptSchema.parse(await h.lookup())
    expect(receipt).toMatchObject({ receiver: 'native', state: 'accepted', targetRefId: first.turnId, threadId, turnId: first.turnId })
    expect((await h.threadStore.get(threadId))?.turns).toHaveLength(1)
    expect((await h.sessionStore.loadItems(threadId)).filter((row) => row.kind === 'user_message')).toHaveLength(1)
  })

  it('rejects same-key prompt, semantic fingerprint and permit-identity conflicts', async () => {
    const h = await harness()
    await h.turns.enqueueTurn(input, options)
    await expect(h.turns.enqueueTurn({ threadId, request: { ...request, prompt: 'different task' } }, options)).rejects.toThrow(/different.*request/)
    await expect(h.turns.enqueueTurn(input, { nativeFollowUp: { ...admission, fingerprint: 'b'.repeat(64) } })).rejects.toThrow(/different native follow-up/)
    await expect(h.turns.enqueueTurn(input, { nativeFollowUp: { ...admission, admissionKey: 'another_permit' } })).rejects.toThrow(/different native follow-up/)
    await expect(h.turns.lookupNativeFollowUpRequest({ threadId, admission: { ...admission, fingerprint: 'b'.repeat(64) } })).rejects.toThrow(/different native follow-up/)
    expect((await h.threadStore.get(threadId))?.turns).toHaveLength(1)
  })

  it('does not allow an ordinary queued edit to change an immutable native effect payload', async () => {
    const h = await harness()
    const accepted = await h.turns.enqueueTurn({ threadId, request: { ...request, clientSurface: 'api' } }, options)
    const before = (await h.threadStore.get(threadId))!
    await expect(h.turns.editQueuedTurn({ threadId, turnId: accepted.turnId, expectedRevision: queueRevision(before),
      operationId: 'edit_owned_native', text: 'replace the task', attachmentIds: [] })).rejects.toMatchObject({ code: 'TASK_BUSY' })
    expect(await h.threadStore.get(threadId)).toEqual(before)
    expect((await h.sessionStore.loadItems(threadId)).find((row) => row.id === accepted.userMessageItemId))
      .toMatchObject({ kind: 'user_message', text: request.prompt })
  })

  it('cannot execute a restored queued snapshot after the native request already started', async () => {
    const h = await harness()
    const accepted = await h.turns.enqueueTurn(input, options)
    const snapshot = structuredClone((await h.threadStore.get(threadId))!)
    await h.turns.startNextQueuedTurn(threadId)
    expect((await h.threadStore.get(threadId))?.nativeFollowUpRequests?.[0]?.executionStartedAt).toBeTruthy()
    await h.threadStore.upsert(snapshot)
    const restarted = h.restart()
    expect(await h.lookup(restarted)).toMatchObject({ state: 'unknown', reason: 'native_execution_outcome_not_proven' })
    await expect(restarted.startNextQueuedTurn(threadId)).rejects.toThrow(/not executable/)
    expect(restarted.isTurnExecutionActive(accepted.turnId)).toBe(false)
    expect((await h.threadStore.get(threadId))?.turns[0]?.status).toBe('queued')
  })

  it('never reports an in-progress retry as negative when the wall clock moves backwards', async () => {
    let clock = nowIso()
    const h = await harness({ nowIso: () => clock })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failedAppend = vi.spyOn(h.sessionStore, 'appendItem').mockRejectedValueOnce(new Error('append unavailable'))
    await expect(h.turns.enqueueTurn(input, options)).rejects.toMatchObject({ code: 'queue_admission_uncertain' })
    expect(await h.lookup()).toMatchObject({ state: 'known_not_admitted' })
    failedAppend.mockRestore()
    clock = '2026-11-02T00:00:00.000Z'
    const entered = deferred(), release = deferred()
    const append = h.sessionStore.appendItem.bind(h.sessionStore)
    vi.spyOn(h.sessionStore, 'appendItem').mockImplementation(async (id, item) => {
      entered.resolve(); await release.promise
      return append(id, item)
    })
    const retry = h.turns.enqueueTurn(input, options)
    await entered.promise
    expect(await h.lookup()).toMatchObject({ state: 'preparing' })
    release.resolve()
    await retry
    expect(await h.lookup()).toMatchObject({ state: 'accepted' })
  })

  it('fails closed when the host admission guard is absent or requestId differs', async () => {
    const h = await harness({ withFollowUpAdmission: undefined })
    await expect(h.turns.enqueueTurn(input, options)).rejects.toThrow(/capability is unavailable/)
    await expect(h.turns.enqueueTurn(input, { nativeFollowUp: { ...admission, requestId: 'other_request' } })).rejects.toThrow(/requestId mismatch/)
    expect((await h.threadStore.get(threadId))?.turns).toHaveLength(0)
    expect(await h.lookup()).toMatchObject({ state: 'unknown' })
  })

  it('exposes preparing during a blocked canonical append, never absence or accepted', async () => {
    const h = await harness()
    const entered = deferred(), release = deferred()
    const append = h.sessionStore.appendItem.bind(h.sessionStore)
    vi.spyOn(h.sessionStore, 'appendItem').mockImplementation(async (id, item) => {
      if (item.kind === 'user_message') { entered.resolve(); await release.promise }
      return append(id, item)
    })
    const pending = h.turns.enqueueTurn(input, options)
    await entered.promise
    expect(FollowUpReceiptSchema.parse(await h.lookup())).toMatchObject({ state: 'preparing' })
    await expect(h.turns.startTurn(input)).rejects.toThrow(/outcome is still unknown/)
    release.resolve()
    await pending
    expect(await h.lookup()).toMatchObject({ state: 'accepted' })
  })

  it('only creates a negative receipt after durable item rollback, then reuses the original turn id', async () => {
    const h = await harness()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const append = vi.spyOn(h.sessionStore, 'appendItem').mockRejectedValueOnce(new Error('append unavailable'))
    await expect(h.turns.enqueueTurn(input, options)).rejects.toMatchObject({ code: 'queue_admission_uncertain' })
    const negative = FollowUpReceiptSchema.parse(await h.lookup())
    expect(negative.state).toBe('known_not_admitted')
    expect((await h.threadStore.get(threadId))?.turns).toHaveLength(0)
    expect(await h.sessionStore.loadItems(threadId)).toHaveLength(0)
    await expect(h.turns.startTurn(input)).rejects.toThrow(/host admission permit/)
    append.mockRestore()
    const retried = await h.turns.enqueueTurn(input, options)
    expect(retried.turnId).toBe(negative.turnId)
    expect(await h.lookup()).toMatchObject({ state: 'accepted', turnId: retried.turnId })
    expect((await h.sessionStore.loadItems(threadId)).filter((row) => row.kind === 'user_message')).toHaveLength(1)
  })

  it('keeps failed rollback preparing and cannot blindly re-admit that request', async () => {
    const h = await harness()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(h.sessionStore, 'appendItem').mockRejectedValue(new Error('append unavailable'))
    vi.spyOn(h.sessionStore, 'loadItemSnapshot').mockRejectedValue(new Error('history unavailable'))
    await expect(h.turns.enqueueTurn(input, options)).rejects.toMatchObject({ code: 'queue_admission_uncertain' })
    expect(await h.lookup()).toMatchObject({ state: 'preparing' })
    await expect(h.turns.startTurn(input)).rejects.toThrow(/outcome is still unknown/)
    expect((await h.threadStore.get(threadId))?.turns).toHaveLength(1)
  })

  it.each([false, true])('reconciles a crashed pending receiver on restart (canonical item durable: %s)', async (durable) => {
    const h = await harness()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const append = h.sessionStore.appendItem.bind(h.sessionStore)
    const appendSpy = vi.spyOn(h.sessionStore, 'appendItem').mockImplementation(async (id, item) => {
      if (durable) await append(id, item)
      throw new Error('lost append response')
    })
    const rewrite = vi.spyOn(h.sessionStore, 'loadItemSnapshot').mockRejectedValue(new Error('runtime exited'))
    await expect(h.turns.enqueueTurn(input, options)).rejects.toMatchObject({ code: 'queue_admission_uncertain' })
    const preparing = await h.lookup()
    expect(preparing.state).toBe('preparing')
    appendSpy.mockRestore(); rewrite.mockRestore()
    const restarted = h.restart()
    const accepted = await restarted.enqueueTurn(input, options)
    expect(accepted.turnId).toBe(preparing.turnId)
    expect(await h.lookup(restarted)).toMatchObject({ state: 'accepted', turnId: preparing.turnId })
    expect((await h.threadStore.get(threadId))?.turns).toHaveLength(1)
    expect((await h.sessionStore.loadItems(threadId)).filter((row) => row.kind === 'user_message')).toHaveLength(1)
  })

  it('does not expose an old negative snapshot while a newer preparation can still commit', async () => {
    const h = await harness()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const append = vi.spyOn(h.sessionStore, 'appendItem').mockRejectedValueOnce(new Error('append unavailable'))
    await expect(h.turns.enqueueTurn(input, options)).rejects.toMatchObject({ code: 'queue_admission_uncertain' })
    const negative = structuredClone((await h.threadStore.get(threadId))!)
    expect(negative.nativeFollowUpRequests?.[0]).toMatchObject({ phase: 'known_not_admitted', preparationRevision: 1 })
    append.mockRestore()
    const entered = deferred(), release = deferred()
    const commit = h.threadStore.upsertIfRevision.bind(h.threadStore)
    let blocked = false
    vi.spyOn(h.threadStore, 'upsertIfRevision').mockImplementation(async (next, revision) => {
      if (!blocked && next.turns.some((turn) => turn.admissionCompletedAt)) {
        blocked = true; entered.resolve(); await release.promise
      }
      return commit(next, revision)
    })
    const retry = h.turns.enqueueTurn(input, options).then(() => null, (error: unknown) => error)
    await entered.promise
    await h.threadStore.upsert(negative)
    expect(await h.lookup()).toMatchObject({ state: 'preparing' })
    expect((await h.threadStore.get(threadId))?.nativeFollowUpRequests?.[0]?.preparationRevision).toBe(2)
    release.resolve()
    expect(await retry).toMatchObject({ code: 'queue_admission_uncertain' })
    expect(await h.lookup()).toMatchObject({ state: 'preparing' })
    expect((await h.threadStore.get(threadId))?.turns).toHaveLength(0)
  })

  it('cannot publish a negative receipt when metadata changes during the verified rollback', async () => {
    const h = await harness()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(h.sessionStore, 'appendItem').mockRejectedValueOnce(new Error('append unavailable'))
    const commit = h.threadStore.upsertIfRevision.bind(h.threadStore)
    vi.spyOn(h.threadStore, 'upsertIfRevision').mockImplementation(async (next, revision) => {
      if (next.nativeFollowUpRequests?.[0]?.phase === 'known_not_admitted') {
        await h.threadStore.upsert({ ...(await h.threadStore.get(threadId))!, title: 'Concurrent metadata writer' })
      }
      return commit(next, revision)
    })
    await expect(h.turns.enqueueTurn(input, options)).rejects.toMatchObject({ code: 'queue_admission_uncertain' })
    expect(await h.lookup()).toMatchObject({ state: 'preparing' })
    expect((await h.threadStore.get(threadId))?.turns[0]?.admissionPending).toBe(true)
  })

  it('observes a lost completion response rather than rolling back an admitted turn', async () => {
    const h = await harness()
    const upsert = h.threadStore.upsertIfRevision.bind(h.threadStore)
    let lost = false
    vi.spyOn(h.threadStore, 'upsertIfRevision').mockImplementation(async (next, revision) => {
      const stored = await upsert(next, revision)
      if (!lost && next.turns.some((turn) => turn.admissionCompletedAt)) {
        lost = true
        throw new Error('lost response after durable rename')
      }
      return stored
    })
    const accepted = await h.turns.enqueueTurn(input, options)
    expect(lost).toBe(true)
    expect(await h.lookup()).toMatchObject({ state: 'accepted', turnId: accepted.turnId })
    expect((await h.threadStore.get(threadId))?.turns).toHaveLength(1)
  })

  it('checks host permission again on promotion and installs the abort controller before releasing the guard', async () => {
    let h: Awaited<ReturnType<typeof harness>>
    const stages: string[] = []
    const guard: NonNullable<TurnServiceDeps['withFollowUpAdmission']> = async (entry, operation) => {
      stages.push(entry.stage)
      const result = await operation()
      if (entry.stage === 'promote') {
        const record = await h.threadStore.get(threadId)
        expect(h.turns.isTurnExecutionActive(record!.turns[0].id)).toBe(true)
      }
      return result
    }
    h = await harness({ withFollowUpAdmission: guard })
    const accepted = await h.turns.enqueueTurn(input, options)
    expect(await h.turns.startNextQueuedTurn(threadId)).toEqual({ turnId: accepted.turnId })
    expect(stages).toEqual(['enqueue', 'enqueue', 'promote'])
    expect(await h.lookup()).toMatchObject({ state: 'in_flight' })
    await h.turns.finishTurn({ threadId, turnId: accepted.turnId, status: 'completed' })
    expect(await h.lookup()).toMatchObject({ state: 'terminal', terminalStatus: 'completed' })
  })

  it('does not promote when stop wins at the host admission barrier', async () => {
    const entered = deferred(), release = deferred()
    let stopped = false
    const guard: NonNullable<TurnServiceDeps['withFollowUpAdmission']> = async (entry, operation) => {
      if (entry.stage === 'promote') { entered.resolve(); await release.promise }
      if (stopped) throw new TurnConflictError('follow-up permit revoked by stop')
      return operation()
    }
    const h = await harness({ withFollowUpAdmission: guard })
    const accepted = await h.turns.enqueueTurn(input, options)
    const promote = h.turns.startNextQueuedTurn(threadId)
    await entered.promise
    stopped = true; release.resolve()
    await expect(promote).rejects.toThrow(/revoked by stop/)
    expect(h.turns.isTurnExecutionActive(accepted.turnId)).toBe(false)
    expect((await h.threadStore.get(threadId))?.turns[0].status).toBe('queued')
    expect(await h.lookup()).toMatchObject({ state: 'accepted' })
  })

  it('does not call a terminal record stopped while its native execution lease still exists', async () => {
    let owner: ThreadExecutionLease | null = null
    const h = await harness({ executionLeases: {
      acquire: async (id, turnId) => (owner = { threadId: id, turnId, ownerFlavor: 'production', ownerInstanceId: 'native_owner',
        fencingToken: 1, acquiredAt: nowIso(), expiresAt: '2026-11-02T02:00:00.000Z' }),
      release: async () => undefined, owner: async () => owner, shutdown: async () => undefined
    } })
    const accepted = await h.turns.enqueueTurn(input, options)
    await h.turns.startNextQueuedTurn(threadId)
    await h.turns.finishTurn({ threadId, turnId: accepted.turnId, status: 'completed' })
    expect(await h.lookup()).toMatchObject({ state: 'in_flight', reason: 'native_terminal_boundary_unwinding' })
    owner = null
    expect(await h.lookup()).toMatchObject({ state: 'terminal', terminalStatus: 'completed' })
  })

  it('keeps accepted authority across native rewind and cannot recreate an executed turn', async () => {
    const h = await harness()
    const accepted = await h.turns.enqueueTurn(input, options)
    await h.turns.startNextQueuedTurn(threadId)
    await h.turns.finishTurn({ threadId, turnId: accepted.turnId, status: 'completed' })
    await h.turns.rewindThread({ threadId, turnId: accepted.turnId })
    expect((await h.threadStore.get(threadId))?.turns).toHaveLength(0)
    expect(await h.lookup(h.restart())).toMatchObject({ state: 'terminal', terminalStatus: 'completed', turnId: accepted.turnId })
    expect(await h.turns.enqueueTurn(input, options)).toMatchObject({ turnId: accepted.turnId })
    expect(await h.turns.startTurn(input)).toMatchObject({ turnId: accepted.turnId })
    expect((await h.threadStore.get(threadId))?.turns).toHaveLength(0)
    await expect(h.turns.startTurn({ threadId, request: { ...request, prompt: 'new body under old id' } })).rejects.toThrow(/different native follow-up/)
  })

  it('retains terminal receipts when an old snapshot restores a queued native turn', async () => {
    const h = await harness()
    const accepted = await h.turns.enqueueTurn(input, options)
    const snapshot = structuredClone((await h.threadStore.get(threadId))!)
    await h.turns.startNextQueuedTurn(threadId)
    await h.turns.finishTurn({ threadId, turnId: accepted.turnId, status: 'completed' })
    const { nativeFollowUpRequests: _receipt, ...oldSnapshot } = snapshot
    await h.threadStore.upsert(oldSnapshot as ThreadRecord)
    expect(await h.lookup()).toMatchObject({ state: 'terminal', terminalStatus: 'completed' })
    await expect(h.turns.startNextQueuedTurn(threadId)).rejects.toThrow(/not executable/)
    expect(h.turns.isTurnExecutionActive(accepted.turnId)).toBe(false)
  })
})
