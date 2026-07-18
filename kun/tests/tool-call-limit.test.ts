import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { InMemoryApprovalGate } from '../src/adapters/in-memory-approval-gate.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../src/adapters/in-memory-thread-store.js'
import { InMemoryUserInputGate } from '../src/adapters/in-memory-user-input-gate.js'
import { LocalToolHost, echoTool } from '../src/adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../src/cache/immutable-prefix.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import { createThreadRecord } from '../src/domain/thread.js'
import { InflightTracker } from '../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../src/loop/steering-queue.js'
import { ContextCompactor } from '../src/loop/context-compactor.js'
import { AgentLoop } from '../src/loop/agent-loop.js'
import { SequentialIdGenerator } from '../src/ports/id-generator.js'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'
import { TurnService } from '../src/services/turn-service.js'
import { UsageService } from '../src/services/usage-service.js'
import type { AgentSdkRuntime } from '../src/runtime/agent-sdk/agent-sdk-runtime.js'

class BurstToolCallModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'burst-tool-call-model'

  async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    for (let index = 1; index <= 3; index += 1) {
      yield {
        kind: 'tool_call_complete',
        callId: `call_${index}`,
        toolName: 'echo',
        arguments: { text: `call ${index}` }
      }
    }
    yield { kind: 'completed', stopReason: 'tool_calls' }
  }
}

class DeadlineAwareModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'deadline-aware-model'
  abortObserved = false
  private resolveStarted: (() => void) | undefined
  private readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve
  })

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    yield* [] as ModelStreamChunk[]
    this.resolveStarted?.()
    if (!request.abortSignal.aborted) {
      await new Promise<void>((resolve) => {
        request.abortSignal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
    this.abortObserved = request.abortSignal.aborted
  }

  waitForStart(): Promise<void> {
    return this.started
  }
}

class DeadlineOwningSdkRuntime {
  abortObserved = false
  private resolveStarted: (() => void) | undefined
  private readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve
  })

  constructor(private readonly turns: TurnService) {}

  handlesProvider(providerId: string | undefined): boolean {
    return providerId === 'sdk-provider'
  }

  async runTurn(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<'failed' | 'aborted'> {
    this.resolveStarted?.()
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    this.abortObserved = signal.aborted
    const status = signal.aborted ? 'aborted' : 'failed'
    await this.turns.finishTurn({
      threadId,
      turnId,
      status,
      ...(status === 'failed' ? { error: 'SDK wall-time limit' } : {})
    })
    return status
  }

  waitForStart(): Promise<void> {
    return this.started
  }
}

describe('native model tool-call limit', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails a response before persisting or dispatching tool calls beyond its bound', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-12T00:00:00.000Z'
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
    const model = new BurstToolCallModel()
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new InMemoryApprovalGate(),
      userInputGate: new InMemoryUserInputGate(),
      model,
      toolHost: new LocalToolHost({ tools: [echoTool] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      ids,
      nowIso,
      turnLimits: { maxToolCallsPerStep: 2 }
    })
    const threadId = 'thr_tool_call_bound'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Tool call bound',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({ threadId, request: { prompt: 'burst tool calls' } })

    await expect(loop.runTurn(threadId, started.turnId)).resolves.toBe('failed')

    const thread = await threadStore.get(threadId)
    expect(thread).toMatchObject({ status: 'idle' })
    expect(thread?.turns[0]).toMatchObject({ status: 'failed' })
    expect(thread?.turns[0]?.items.filter((item) => item.kind === 'tool_call')).toHaveLength(2)
    const runtimeEvents = await sessionStore.loadEventsSince(threadId, 0)
    expect(runtimeEvents).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'tool_call_limit_exceeded'
    }))
  })

  it('actively aborts a stalled model stream at the wall-time deadline', async () => {
    vi.useFakeTimers()
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-12T00:00:00.000Z'
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
    const model = new DeadlineAwareModel()
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new InMemoryApprovalGate(),
      userInputGate: new InMemoryUserInputGate(),
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
      nowIso,
      turnLimits: { maxWallTimeMs: 50 }
    })
    const threadId = 'thr_wall_time_bound'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Wall time bound',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({ threadId, request: { prompt: 'wait forever' } })

    const run = loop.runTurn(threadId, started.turnId)
    await model.waitForStart()
    await vi.advanceTimersByTimeAsync(50)

    await expect(run).resolves.toBe('failed')
    expect(model.abortObserved).toBe(true)
    const thread = await threadStore.get(threadId)
    expect(thread?.turns[0]).toMatchObject({ status: 'failed', error: 'turn exceeded 50ms wall time' })
    const runtimeEvents = await sessionStore.loadEventsSince(threadId, 0)
    expect(runtimeEvents).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'turn_wall_time_limit'
    }))
  })

  it('allows an internal child loop to opt out of the wall-time deadline', async () => {
    vi.useFakeTimers()
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-12T00:00:00.000Z'
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
    const model = new DeadlineAwareModel()
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new InMemoryApprovalGate(),
      userInputGate: new InMemoryUserInputGate(),
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
      nowIso,
      turnLimits: { maxWallTimeMs: 50 },
      disableWallTimeLimit: true
    })
    const threadId = 'thr_unbounded_child'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Unbounded child',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({ threadId, request: { prompt: 'wait for cancellation' } })

    let settled = false
    const run = loop.runTurn(threadId, started.turnId).finally(() => {
      settled = true
    })
    await model.waitForStart()
    await vi.advanceTimersByTimeAsync(500)

    expect(settled).toBe(false)
    expect(model.abortObserved).toBe(false)

    await turns.interruptTurn({ threadId, turnId: started.turnId })
    await expect(run).resolves.toBe('aborted')
    expect(model.abortObserved).toBe(true)
    const runtimeEvents = await sessionStore.loadEventsSince(threadId, 0)
    expect(runtimeEvents).not.toContainEqual(expect.objectContaining({ code: 'turn_wall_time_limit' }))
  })

  it('leaves a delegated SDK runtime to classify its own wall-time deadline', async () => {
    vi.useFakeTimers()
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-12T00:00:00.000Z'
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
    const model = new BurstToolCallModel()
    const sdkRuntime = new DeadlineOwningSdkRuntime(turns)
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new InMemoryApprovalGate(),
      userInputGate: new InMemoryUserInputGate(),
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      sdkRuntime: sdkRuntime as unknown as AgentSdkRuntime,
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      ids,
      nowIso,
      turnLimits: { maxWallTimeMs: 50 }
    })
    const threadId = 'thr_sdk_wall_time_owner'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'SDK wall time owner',
      workspace: '/tmp/workspace',
      model: model.model,
      providerId: 'sdk-provider'
    }))
    const started = await turns.startTurn({ threadId, request: { prompt: 'wait forever' } })

    const run = loop.runTurn(threadId, started.turnId)
    await sdkRuntime.waitForStart()
    await vi.advanceTimersByTimeAsync(50)

    await expect(run).resolves.toBe('failed')
    expect(sdkRuntime.abortObserved).toBe(false)
    expect((await threadStore.get(threadId))?.turns[0]).toMatchObject({
      status: 'failed',
      error: 'SDK wall-time limit'
    })
  })
})
