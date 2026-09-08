import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildServiceManagerRouter, ServiceManagerState } from '../manager/service-manager.js'
import { ManagerSharedDataStore } from '../manager/shared-data-store.js'
import { ManagerRemoteSessionStore, ManagerRemoteThreadStore } from '../manager/remote-data-stores.js'
import { ManagerThreadExecutionLeaseClient } from '../manager/manager-thread-execution-lease-client.js'
import type { ServiceManagerConnection } from '../manager/manager-client.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import { QueuedTurnDispatcher } from '../server/queued-turn-dispatcher.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { AgentLoop } from '../loop/agent-loop.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { makeUserItem } from '../domain/item.js'
import { resumeQueuedTurns } from '../server/routes/turns.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'
import { UsageService } from './usage-service.js'
import type { ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { runWithTurnMutationFence } from '../manager/turn-mutation-context.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-queue-manager-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const shared = await ManagerSharedDataStore.create(dir)
  cleanups.push(() => shared.close())
  const state = new ServiceManagerState()
  const nowIso = () => new Date().toISOString()
  state.register({ flavor: 'production', instanceId: 'runtime-test', pid: process.pid,
    startedAt: nowIso(), host: '127.0.0.1', port: 19002, baseUrl: 'http://127.0.0.1:19002', runtimeToken: 'test' })
  const server = await startNodeHttpServer({ host: '127.0.0.1', port: 0, router: buildServiceManagerRouter({
    managerToken: 'test', instanceId: 'manager-test', startedAt: nowIso(), state, sharedData: shared
  }) })
  cleanups.push(() => server.close())
  const manager = { discovery: { baseUrl: `http://127.0.0.1:${server.port}`, managerToken: 'test' } } as ServiceManagerConnection
  const leases = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-test')
  cleanups.push(() => leases.shutdown())
  const threadStore = new ManagerRemoteThreadStore(manager)
  const sessionStore = new ManagerRemoteSessionStore(manager)
  const eventBus = new InMemoryEventBus(), inflight = new InflightTracker(), steering = new SteeringQueue()
  const compactor = new ContextCompactor(), ids = new SequentialIdGenerator(), usage = new UsageService()
  const events = new RuntimeEventRecorder({ eventBus, sessionStore,
    allocateSeq: (id) => eventBus.allocateSeq(id), nowIso })
  const turns = new TurnService({ threadStore, sessionStore, events, inflight, steering, compactor, ids, nowIso,
    executionLeases: leases, maxConcurrentTurns: 1 })
  const seen: string[] = []
  const loop = new AgentLoop({ threadStore, sessionStore, events, inflight, steering, compactor, ids, nowIso, turns, usage,
    prefix: createImmutablePrefix({ systemPrompt: 'test' }), toolHost: new LocalToolHost({ tools: [] }),
    approvalGate: new InMemoryApprovalGate(), userInputGate: new InMemoryUserInputGate(),
    model: { provider: 'test', model: 'test', async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      const user = [...request.history].reverse().find((item) => item.kind === 'user_message')
      seen.push(user?.kind === 'user_message' ? user.text : '')
      yield { kind: 'assistant_text_delta', text: 'received' }
      yield { kind: 'completed', stopReason: 'stop' }
    } }
  })
  const dispatcher = new QueuedTurnDispatcher({ turns, threadStore, runTurn: (id, turn) => loop.runTurn(id, turn) })
  turns.setTurnQueuedHook((id) => dispatcher.requestDrain(id))
  turns.setTurnSettledHook((id, status) => dispatcher.onTurnSettled(id, status))
  // Optional until the implementation adds disposal for retry timers.
  cleanups.push(async () => {
    turns.setTurnQueuedHook(() => undefined)
    turns.setTurnSettledHook(() => undefined)
    await dispatcher.dispose()
    await turns.closeAdmissionForShutdown()
  })
  await threadStore.upsert(createThreadRecord({ id: 'thread-test', title: 'Queue', workspace: dir, model: 'test' }))
  return { dir, turns, shared, threadStore, sessionStore, leases, state, seen, loop, dispatcher, manager }
}

describe('queue through a real Manager and remote stores', () => {
  it('delivers two busy inputs to the model in FIFO order without another wake', async () => {
    const h = await harness()
    const first = await h.turns.startTurn({ threadId: 'thread-test', request: { prompt: 'first' } })
    for (const prompt of ['hi', '你是']) {
      const queued = await h.turns.startTurn({ threadId: 'thread-test',
        request: { prompt, enqueueIfBusy: true, clientRequestId: prompt } })
      expect(queued.status).toBe('queued')
      expect((await h.sessionStore.loadEventsSince('thread-test', 0))
        .some((event) => event.kind === 'item_created' && event.turnId === queued.turnId)).toBe(false)
    }
    await h.loop.runTurn('thread-test', first.turnId)
    await vi.waitFor(async () => {
      expect((await h.threadStore.get('thread-test'))?.turns.map((turn) => turn.status))
        .toEqual(['completed', 'completed', 'completed'])
    }, { timeout: 10000 })
    expect(h.seen).toEqual(['first', 'hi', '你是'])
    expect((await h.sessionStore.loadItems('thread-test')).filter((item) => item.kind === 'user_message'))
      .toHaveLength(3)
  })

  it('rolls back exactly the pending input when its user-item write fails', async () => {
    const h = await harness()
    const first = await h.turns.startTurn({ threadId: 'thread-test', request: { prompt: 'first' } })
    vi.spyOn(h.sessionStore, 'appendItem').mockRejectedValueOnce(new Error('injected append failure'))
    await expect(h.turns.startTurn({ threadId: 'thread-test',
      request: { prompt: 'hi', enqueueIfBusy: true, clientRequestId: 'req-hi' } })).rejects.toThrow()
    expect((await h.threadStore.get('thread-test'))?.turns).toHaveLength(1)
    const retried = await h.turns.startTurn({ threadId: 'thread-test',
      request: { prompt: 'hi', enqueueIfBusy: true, clientRequestId: 'req-hi' } })
    expect(retried.status).toBe('queued')
    await h.loop.runTurn('thread-test', first.turnId)
    await vi.waitFor(async () => expect((await h.threadStore.get('thread-test'))?.turns
      .every((turn) => turn.status === 'completed')).toBe(true))
  })

  it('still rejects the previous turn generation after a successor acquires the thread', async () => {
    const h = await harness()
    const old = await h.leases.acquire('thread-test', 'old')
    await h.leases.release('thread-test', 'old')
    await h.leases.acquire('thread-test', 'new')
    await expect(runWithTurnMutationFence(old, () => h.sessionStore.appendItem('thread-test', {
      id: 'late-item', threadId: 'thread-test', turnId: 'old', kind: 'assistant_text',
      role: 'assistant', status: 'completed', createdAt: new Date().toISOString(), text: 'late'
    }))).rejects.toThrow(/stale_turn_fence/)
  })

  it.each(['metadata', 'user-after-write', 'commit-before-write'])('repairs failure at %s without an orphan', async (phase) => {
    const h = await harness()
    await h.turns.startTurn({ threadId: 'thread-test', request: { prompt: 'first' } })
    if (phase === 'metadata') vi.spyOn(h.threadStore, 'upsertIfRevision').mockRejectedValueOnce(new Error('metadata failure'))
    if (phase === 'user-after-write') {
      const append = h.sessionStore.appendItem.bind(h.sessionStore)
      vi.spyOn(h.sessionStore, 'appendItem').mockImplementationOnce(async (...args) => {
        await append(...args)
        throw new Error('lost append response')
      })
    }
    if (phase === 'commit-before-write') {
      const upsert = h.threadStore.upsert.bind(h.threadStore)
      let failed = false
      vi.spyOn(h.threadStore, 'upsert').mockImplementation(async (thread) => {
        if (!failed && thread.turns.some((turn) => turn.clientRequestId === 'retry' && turn.admissionCompletedAt)) {
          failed = true
          throw new Error('commit failed')
        }
        return upsert(thread)
      })
    }
    const request = { prompt: 'hi', enqueueIfBusy: true, clientRequestId: 'retry' }
    await expect(h.turns.startTurn({ threadId: 'thread-test', request }))
      .rejects.toMatchObject({ code: 'queue_admission_uncertain' })
    expect((await h.threadStore.get('thread-test'))?.turns).toHaveLength(1)
    const [a, b] = await Promise.all([
      h.turns.startTurn({ threadId: 'thread-test', request }),
      h.turns.startTurn({ threadId: 'thread-test', request })
    ])
    expect(a.turnId).toBe(b.turnId)
    expect((await h.threadStore.get('thread-test'))?.turns).toHaveLength(2)
    expect((await h.sessionStore.loadItems('thread-test')).filter((item) => item.kind === 'user_message')).toHaveLength(2)
  })

  it('recognizes a lost commit response and replays that exact admission', async () => {
    const h = await harness()
    await h.turns.startTurn({ threadId: 'thread-test', request: { prompt: 'first' } })
    const upsert = h.threadStore.upsert.bind(h.threadStore)
    let lost = false
    vi.spyOn(h.threadStore, 'upsert').mockImplementation(async (thread) => {
      const result = await upsert(thread)
      if (!lost && thread.turns.some((turn) => turn.clientRequestId === 'commit-lost' && turn.admissionCompletedAt)) {
        lost = true
        throw new Error('commit response lost')
      }
      return result
    })
    const request = { prompt: 'hi', enqueueIfBusy: true, clientRequestId: 'commit-lost' }
    const a = await h.turns.startTurn({ threadId: 'thread-test', request })
    const b = await h.turns.startTurn({ threadId: 'thread-test', request })
    expect(a.turnId).toBe(b.turnId)
    expect(a.status).toBe('queued')
    expect(b.status).toBe('queued')
    expect((await h.threadStore.get('thread-test'))?.turns).toHaveLength(2)
  })

  it.each([true, false])('repairs an existing pending admission by exact request id (user durable=%s)', async (hasUser) => {
    const h = await harness()
    await h.turns.startTurn({ threadId: 'thread-test', request: { prompt: 'first' } })
    const thread = (await h.threadStore.get('thread-test'))!
    await h.threadStore.upsert({ ...thread, turns: [...thread.turns, {
      ...createTurnRecord({ id: 'pending', threadId: 'thread-test', prompt: 'hi', clientRequestId: 'pending-request' }),
      status: 'queued', admissionPending: true
    }] })
    if (hasUser) await h.sessionStore.appendItem('thread-test', makeUserItem({
      id: 'item_pending_user', threadId: 'thread-test', turnId: 'pending', text: 'hi'
    }))
    const accepted = await h.turns.startTurn({ threadId: 'thread-test',
      request: { prompt: 'hi', clientRequestId: 'pending-request', enqueueIfBusy: true } })
    expect(accepted.status).toBe('queued')
    expect(accepted.turnId === 'pending').toBe(hasUser)
    const after = await h.threadStore.get('thread-test')
    expect(after?.turns).toHaveLength(2)
    expect(after?.turns.some((turn) => turn.admissionPending)).toBe(false)
  })

  it('Stop holds the queue after lease release and explicit resume drains every remaining input', async () => {
    const h = await harness()
    const first = await h.turns.startTurn({ threadId: 'thread-test', request: { prompt: 'first' } })
    for (const prompt of ['hi', 'next']) await h.turns.startTurn({ threadId: 'thread-test',
      request: { prompt, enqueueIfBusy: true, clientRequestId: prompt } })
    await h.turns.interruptTurn({ threadId: 'thread-test', turnId: first.turnId })
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(h.seen).toEqual([])
    expect((await h.threadStore.get('thread-test'))?.turns.map((turn) => turn.status))
      .toEqual(['aborted', 'queued', 'queued'])
    await resumeQueuedTurns(h.turns, 'thread-test', (id, turn) => { void h.loop.runTurn(id, turn) })
    await vi.waitFor(async () => expect((await h.threadStore.get('thread-test'))?.turns.map((turn) => turn.status))
      .toEqual(['aborted', 'completed', 'completed']), { timeout: 5000 })
    expect(h.seen).toEqual(['hi', 'next'])
  })

  it('a new Runtime repairs pending admissions against the surviving Manager', async () => {
    const h = await harness()
    await h.dispatcher.dispose()
    await h.leases.shutdown()
    h.state.unregister('production', 'runtime-test')
    h.state.register({ flavor: 'production', instanceId: 'restarted-runtime', pid: process.pid,
      startedAt: new Date().toISOString(), host: '127.0.0.1', port: 19003,
      baseUrl: 'http://127.0.0.1:19003', runtimeToken: 'test' })
    const thread = (await h.threadStore.get('thread-test'))!
    await h.threadStore.upsert({ ...thread, status: 'running',
      turns: ['missing', 'durable'].map((id) => ({
        ...createTurnRecord({ id, threadId: 'thread-test', prompt: id, clientRequestId: id }),
        status: 'queued' as const, admissionPending: true as const
      }))
    })
    await h.sessionStore.appendItem('thread-test', makeUserItem({
      id: 'item_durable_user', threadId: 'thread-test', turnId: 'durable', text: 'durable'
    }))
    const leases = new ManagerThreadExecutionLeaseClient(h.manager, 'production', 'restarted-runtime')
    cleanups.push(() => leases.shutdown())
    const restarted = new TurnService({ ...h.turns['deps'], executionLeases: leases,
      inflight: new InflightTracker(), steering: new SteeringQueue(), ids: new SequentialIdGenerator() })
    await restarted.reconcileOrphanedTurns()
    const recovered = await h.threadStore.get('thread-test')
    expect(recovered?.turns.map((turn) => turn.id)).toEqual(['durable'])
    expect(recovered?.turns[0].admissionPending).toBeUndefined()
    expect(await restarted.startNextQueuedTurn('thread-test')).toEqual({ turnId: 'durable' })
    await restarted.finishTurn({ threadId: 'thread-test', turnId: 'durable', status: 'completed' })
  })
})
