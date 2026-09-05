import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import type {
  ModelClient,
  ModelRequest,
  ModelStreamChunk
} from '../ports/model-client.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ThreadExecutionLeasePort } from '../ports/thread-execution-lease.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import { AgentLoop } from './agent-loop.js'
import { ContextCompactor } from './context-compactor.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'

class ShutdownAwareModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'shutdown-aware-model'
  private startedResolve?: () => void
  private readonly started = new Promise<void>((resolve) => {
    this.startedResolve = resolve
  })

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    yield* [] as ModelStreamChunk[]
    this.startedResolve?.()
    if (!request.abortSignal.aborted) {
      await new Promise<void>((resolve) => {
        request.abortSignal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
  }

  waitForStart(): Promise<void> {
    return this.started
  }
}

class ProseOnlyLeadModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'prose-only-lead'
  calls = 0

  async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.calls += 1
    yield {
      kind: 'assistant_text_delta',
      text: 'The worker result looks good and the task is complete.'
    }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

function executionLeaseHarness(): {
  executionLeases: ThreadExecutionLeasePort
  release: ReturnType<typeof vi.fn>
} {
  const release = vi.fn(async () => undefined)
  return {
    release,
    executionLeases: {
      acquire: vi.fn(async (threadId: string, turnId: string) => ({
        threadId,
        turnId,
        ownerFlavor: 'production' as const,
        ownerInstanceId: 'runtime-shutdown-test',
        fencingToken: 1,
        acquiredAt: '2026-08-12T08:09:45.000Z',
        expiresAt: '2026-08-12T08:10:15.000Z'
      })),
      release,
      owner: vi.fn(async () => null)
    }
  }
}

describe('AgentLoop host shutdown suspension', () => {
  it('parks an active Direct turn for restart recovery instead of recording user cancellation', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const leaseHarness = executionLeaseHarness()
    let nowMs = 1_000
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso: () => '2026-08-12T08:09:51.420Z'
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      executionLeases: leaseHarness.executionLeases,
      ids: new SequentialIdGenerator(),
      nowIso: () => '2026-08-12T08:09:51.420Z'
    })
    const model = new ShutdownAwareModel()
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: { request: async () => 'allow' } as never,
      userInputGate: {} as never,
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      ids: new SequentialIdGenerator(),
      nowIso: () => '2026-08-12T08:09:51.420Z',
      nowMs: () => nowMs
    })
    const threadId = 'thread_shutdown_direct'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Direct shutdown recovery',
      workspace: '/tmp/workspace',
      model: model.model,
      goal: {
        threadId,
        objective: 'Finish this task',
        status: 'active',
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: '2026-08-12T08:09:45.000Z',
        updatedAt: '2026-08-12T08:09:45.000Z'
      }
    }))
    const started = await turns.startTurn({
      threadId,
      request: { prompt: 'Finish this task.', model: model.model }
    })
    const run = loop.runTurn(threadId, started.turnId)
    await expect(Promise.race([
      model.waitForStart().then(() => 'started' as const),
      new Promise<'start_timeout'>((resolve) => setTimeout(() => resolve('start_timeout'), 500))
    ])).resolves.toBe('started')

    nowMs = 5_500
    await expect(turns.suspendActiveTurnsForShutdown()).resolves.toBe(1)
    expect(leaseHarness.release).not.toHaveBeenCalled()
    await expect(Promise.race([
      run,
      new Promise<'run_timeout'>((resolve) => setTimeout(() => resolve('run_timeout'), 500))
    ])).resolves.toBe('suspended')
    expect(await turns.getTurn(threadId, started.turnId)).toMatchObject({ status: 'running' })
    expect((await threadStore.get(threadId))?.goal?.timeUsedSeconds).toBe(4)
    expect(leaseHarness.release).not.toHaveBeenCalled()
    expect(eventBus.snapshotSince(threadId, 0).some((event) => event.kind === 'turn_aborted')).toBe(false)
  })

  it('parks an active Graph source turn instead of persisting user cancellation', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const leaseHarness = executionLeaseHarness()
    const nowIso = () => '2026-07-30T14:30:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      executionLeases: leaseHarness.executionLeases,
      resolveGraphLeadRun: async () => ({
        runId: 'run_completing',
        lastEventSeq: 425,
        terminal: false
      }),
      ids,
      nowIso
    })
    const model = new ShutdownAwareModel()
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: { request: async () => 'allow' } as never,
      userInputGate: {} as never,
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      ids,
      nowIso
    })
    const threadId = 'thread_shutdown_graph'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Graph shutdown recovery',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({
      threadId,
      request: {
        prompt: 'Finish the Graph.',
        model: model.model,
        orchestration: 'graph'
      }
    })

    const run = loop.runTurn(threadId, started.turnId)
    await model.waitForStart()
    await expect(turns.suspendActiveTurnsForShutdown()).resolves.toBe(1)
    expect(leaseHarness.release).not.toHaveBeenCalled()
    await expect(Promise.race([
      run,
      new Promise<'timed_out'>((resolve) =>
        setTimeout(() => resolve('timed_out'), 500))
    ])).resolves.toBe('suspended')

    expect(turns.isTurnExecutionActive(started.turnId)).toBe(false)
    expect(await turns.getTurn(threadId, started.turnId)).toMatchObject({
      status: 'running',
      orchestration: 'graph',
      graphLeadLifecycle: {
        runId: 'run_completing',
        state: 'supervising',
        lastDeliveredSeq: 0,
        suspendedAt: nowIso()
      }
    })
    expect(eventBus.snapshotSince(threadId, 0)
      .some((event) => event.kind === 'turn_aborted')).toBe(false)
    expect(leaseHarness.release).not.toHaveBeenCalled()
  })

  it('parks an uncommitted planning turn without fabricating needs_correction', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const transitionDraft = vi.fn(async () => {
      throw new Error('host shutdown must not mutate the planning draft')
    })
    const nowIso = () => '2026-07-30T14:31:00.000Z'
    const serviceOptions = {
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId: string) => eventBus.allocateSeq(threadId),
        nowIso
      }),
      inflight,
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      resolveGraphLeadRun: async () => null,
      resolveGraphPlanningDraft: async () => ({
        version: 1 as const,
        draftId: 'draft_planning',
        reservedRunId: 'run_reserved',
        state: 'planning' as const,
        draftRevision: 3
      }),
      transitionGraphPlanningDraft: transitionDraft,
      ids: new SequentialIdGenerator(),
      nowIso
    }
    const turns = new TurnService(serviceOptions)
    const threadId = 'thread_shutdown_planning'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Planning shutdown recovery',
      workspace: '/tmp/workspace',
      model: 'test-model'
    }))
    const started = await turns.startTurn({
      threadId,
      request: {
        prompt: 'Plan this Graph.',
        orchestration: 'graph'
      }
    })

    await turns.suspendActiveTurnsForShutdown()
    expect(transitionDraft).not.toHaveBeenCalled()
    expect(await turns.getTurn(threadId, started.turnId)).toMatchObject({
      status: 'running',
      graphPlanningLifecycle: {
        state: 'planning',
        draftRevision: 3,
        suspendedAt: nowIso()
      }
    })

    const restarted = new TurnService({
      ...serviceOptions,
      inflight: new InflightTracker(),
      steering: new SteeringQueue()
    })
    await restarted.reconcileOrphanedTurns()
    expect(transitionDraft).not.toHaveBeenCalled()
    expect(await restarted.getTurn(threadId, started.turnId)).toMatchObject({
      status: 'running',
      graphPlanningLifecycle: { state: 'planning' }
    })
  })

  it('durably cancels Graph ownership before explicit Stop persists the source abort', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-07-30T14:32:00.000Z'
    let releaseCancellation!: () => void
    let cancellationStarted!: () => void
    const cancellationStartedPromise = new Promise<void>((resolve) => {
      cancellationStarted = resolve
    })
    const cancellationReleasePromise = new Promise<void>((resolve) => {
      releaseCancellation = resolve
    })
    const cancelGraphSourceRuns = vi.fn(async () => {
      cancellationStarted()
      await cancellationReleasePromise
    })
    const cancelDraft = vi.fn(async () => null)
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      cancelGraphSourceRuns,
      transitionGraphPlanningDraft: cancelDraft,
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const threadId = 'thread_explicit_graph_stop'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Explicit Graph stop',
      workspace: '/tmp/workspace',
      model: 'test-model'
    }))
    const started = await turns.startTurn({
      threadId,
      request: {
        prompt: 'Stop this Graph.',
        orchestration: 'graph'
      }
    })

    let stopReturned = false
    const stopping = turns.interruptTurn({
      threadId,
      turnId: started.turnId
    }).then((result) => {
      stopReturned = true
      return result
    })
    await cancellationStartedPromise

    expect(stopReturned).toBe(false)
    expect((await turns.getTurn(threadId, started.turnId))?.status).toBe('running')
    releaseCancellation()
    await expect(stopping).resolves.toEqual({ status: 'aborted' })

    expect(cancelGraphSourceRuns).toHaveBeenCalledWith({
      threadId,
      sourceTurnId: started.turnId
    })
    expect(cancelDraft).toHaveBeenCalledWith({
      threadId,
      sourceTurnId: started.turnId,
      action: 'cancel'
    })
    expect((await turns.getTurn(threadId, started.turnId))?.status).toBe('aborted')
  })

  it('reminds a prose-only Lead once, then parks without swallowing supervision', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-30T14:33:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      resolveGraphLeadRun: async () => ({
        runId: 'run_awaiting_review',
        lastEventSeq: 99,
        terminal: false,
        supervisionPending: true
      }),
      ids,
      nowIso
    })
    const model = new ProseOnlyLeadModel()
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: { request: async () => 'allow' } as never,
      userInputGate: {} as never,
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      ids,
      nowIso
    })
    const threadId = 'thread_prose_only_review'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Prose-only Graph review',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({
      threadId,
      request: {
        prompt: 'Review the submitted Graph node.',
        model: model.model,
        orchestration: 'graph'
      }
    })

    await expect(loop.runTurn(threadId, started.turnId))
      .resolves.toBe('suspended_pending_supervision')

    expect(model.calls).toBe(2)
    expect(await turns.getTurn(threadId, started.turnId)).toMatchObject({
      status: 'running',
      graphLeadLifecycle: {
        runId: 'run_awaiting_review',
        lastDeliveredSeq: 0
      }
    })
    const steeringEvents = eventBus.snapshotSince(threadId, 0)
      .filter((event) => event.kind === 'turn_steered')
    expect(steeringEvents).toHaveLength(1)
    expect(JSON.stringify(steeringEvents)).toContain('graph_review_node')
  })

  it('launches goal and ordinary restart continuations through the host-tracked runner', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-08-30T12:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      ids,
      nowIso
    })
    const threadId = 'thread_restart_runner'
    const sourceTurnId = 'turn_interrupted'
    const ordinaryThreadId = 'thread_ordinary_restart_runner'
    const ordinarySourceTurnId = 'turn_ordinary_interrupted'
    await threadStore.upsert({
      ...createThreadRecord({
        id: threadId,
        title: 'Tracked restart continuation',
        workspace: '/tmp/workspace',
        model: 'test-model',
        goal: {
          threadId,
          objective: 'Finish after restart',
          status: 'active',
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      }),
      turns: [createTurnRecord({
        id: sourceTurnId,
        threadId,
        prompt: 'Interrupted work',
        status: 'failed'
      })]
    })
    await threadStore.upsert({
      ...createThreadRecord({
        id: ordinaryThreadId,
        title: 'Tracked ordinary restart continuation',
        workspace: '/tmp/workspace',
        model: 'test-model'
      }),
      turns: [createTurnRecord({
        id: ordinarySourceTurnId,
        threadId: ordinaryThreadId,
        prompt: 'Interrupted ordinary work',
        status: 'failed'
      })]
    })
    let settleRun!: () => void
    const runGate = new Promise<void>((resolve) => { settleRun = resolve })
    const hostTrackedRuns = new Set<Promise<'suspended'>>()
    const runContinuationTurn = vi.fn((_threadId: string, _turnId: string) => {
      const run = runGate.then(() => 'suspended' as const)
      hostTrackedRuns.add(run)
      void run.finally(() => hostTrackedRuns.delete(run))
      return run
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: { request: async () => 'allow' } as never,
      userInputGate: {} as never,
      model: new ProseOnlyLeadModel(),
      toolHost: new LocalToolHost({ tools: [] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      ids,
      nowIso,
      runContinuationTurn
    })

    await expect(loop.resumeInterruptedGoals([{
      threadId,
      turnId: sourceTurnId
    }])).resolves.toBe(1)
    await expect(loop.resumeInterruptedTurns([{
      threadId: ordinaryThreadId,
      turnId: ordinarySourceTurnId
    }])).resolves.toBe(1)
    await vi.waitFor(() => expect(runContinuationTurn).toHaveBeenCalledTimes(2))
    expect(hostTrackedRuns.size).toBe(2)

    settleRun()
    await vi.waitFor(() => expect(hostTrackedRuns.size).toBe(0))
  })

})
