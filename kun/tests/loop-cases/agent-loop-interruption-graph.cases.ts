import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../../src/adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../../src/adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../../src/adapters/in-memory-thread-store.js'
import { LocalToolHost, echoTool, type LocalTool } from '../../src/adapters/tool/local-tool-host.js'
import { InMemoryArtifactStore } from '../../src/artifacts/artifact-store.js'
import { createImmutablePrefix } from '../../src/cache/immutable-prefix.js'
import { DEFAULT_GRAPH_RUNTIME_CONFIG } from '../../src/config/kun-config.js'
import { emptyUsageSnapshot } from '../../src/contracts/usage.js'
import { createThreadRecord } from '../../src/domain/thread.js'
import type { ApprovalRequest } from '../../src/domain/approval.js'
import { InflightTracker } from '../../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../../src/loop/steering-queue.js'
import { ContextCompactor } from '../../src/loop/context-compactor.js'
import { modelRequestContextText } from '../../src/loop/model-request-context.js'
import {
  AgentLoop,
  buildRuntimeContextInstruction,
  isStalePlanContext,
  resolvePlanModeToolSpecs,
  shouldInjectInitialRuntimeContext,
  svgArtifactCompletionState,
  turnHasUnverifiedSourceChanges
} from '../../src/loop/agent-loop.js'
import { SequentialIdGenerator } from '../../src/ports/id-generator.js'
import type { ModelClient, ModelRequest, ModelStreamChunk, ModelToolSpec } from '../../src/ports/model-client.js'
import type { UserInputGate, UserInputRequest, UserInputResolution } from '../../src/ports/user-input-gate.js'
import { GraphRuntimeComposition } from '../../src/server/graph-runtime-factory.js'
import { RuntimeEventRecorder } from '../../src/services/runtime-event-recorder.js'
import { TurnService } from '../../src/services/turn-service.js'
import { UsageService } from '../../src/services/usage-service.js'
import {
  AbortAwareModel,
  AllowApprovalGate,
  AlternatingGraphLeadToolModel,
  CapturingCompleteModel,
  FinalResponseGateModel,
  HangingGraphLeadModel,
  NoopUserInputGate,
  RecoverableGraphStreamModel,
  RepeatingToolModel,
  RoutedFailureModel,
  ScriptedGraphModel,
  ScriptedInvalidGraphModel,
  ScriptedSvgModel,
  TruncatedRawGraphPlanModel,
  svgGateTool,
  svgLoopHarness
} from './agent-loop-support.cases.js'

describe('AgentLoop interruption', () => {
  it('aborts and parks a Graph Lead model step at the episode elapsed-time limit', async () => {
    vi.useFakeTimers()
    try {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const inflight = new InflightTracker()
      const steering = new SteeringQueue()
      const ids = new SequentialIdGenerator()
      const nowIso = () => '2026-07-30T00:00:00.000Z'
      const events = new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      })
      const model = new HangingGraphLeadModel()
      const turns = new TurnService({
        threadStore,
        sessionStore,
        events,
        inflight,
        steering,
        compactor: new ContextCompactor(),
        resolveGraphLeadRun: async () => ({
          runId: 'graph_run_elapsed_episode',
          lastEventSeq: 4,
          terminal: false,
          supervisionPending: true
        }),
        ids,
        nowIso
      })
      const loop = new AgentLoop({
        threadStore,
        sessionStore,
        approvalGate: new AllowApprovalGate(),
        userInputGate: new NoopUserInputGate(),
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
      const threadId = 'thr_graph_elapsed_lead_episode'
      await threadStore.upsert(createThreadRecord({
        id: threadId,
        title: 'Elapsed Graph Lead episode',
        workspace: '/tmp/workspace',
        model: model.model
      }))
      const started = await turns.startTurn({
        threadId,
        request: {
          prompt: 'Supervise without hanging forever.',
          model: model.model,
          orchestration: 'graph'
        }
      })
      await turns.resumeGraphLeadTurn({
        threadId,
        turnId: started.turnId,
        runId: 'graph_run_elapsed_episode',
        lastDeliveredSeq: 4,
        terminal: false
      })

      const finishTurn = turns.finishTurn.bind(turns)
      let finishTurnCalls = 0
      turns.finishTurn = async (input) => {
        finishTurnCalls += 1
        return finishTurn(input)
      }

      const run = loop.runTurn(threadId, started.turnId)
      await model.waitForStart()
      await vi.advanceTimersByTimeAsync(10 * 60_000)

      await expect(run).resolves.toBe('suspended_pending_supervision')
      expect(model.requests).toHaveLength(1)
      expect(model.requests[0]?.abortSignal.aborted).toBe(true)
      expect(finishTurnCalls).toBe(0)
      expect((await turns.getTurn(threadId, started.turnId))?.status).toBe('running')
      expect(turns.isTurnExecutionActive(started.turnId)).toBe(false)
      expect(eventBus.snapshotSince(threadId, 0).some((event) =>
        event.kind === 'turn_completed' ||
        event.kind === 'turn_failed' ||
        event.kind === 'error'
      )).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('parks and resumes the same Graph source turn after a committed stream read failure', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-30T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new RecoverableGraphStreamModel()
    let graphTerminal = false
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      resolveGraphLeadRun: async () => ({
        runId: 'graph_run_stream_recovery',
        lastEventSeq: graphTerminal ? 8 : 4,
        terminal: graphTerminal
      }),
      ids,
      nowIso
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new AllowApprovalGate(),
      userInputGate: new NoopUserInputGate(),
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
    const threadId = 'thr_graph_stream_recovery'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Graph stream recovery',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({
      threadId,
      request: {
        prompt: 'Keep supervising this Graph until it is complete.',
        model: model.model,
        orchestration: 'graph'
      }
    })

    const suspendGraphLeadTurn = turns.suspendGraphLeadTurn.bind(turns)
    let parkedTurn: Awaited<ReturnType<TurnService['getTurn']>> | undefined
    let parkedItems: Awaited<ReturnType<InMemorySessionStore['loadItems']>> = []
    let executionReleasedBeforeWake = false
    let turnFailedBeforeWake = false
    let racedContinuation: ReturnType<AgentLoop['runTurn']> | undefined
    turns.suspendGraphLeadTurn = async (input) => {
      const outcome = await suspendGraphLeadTurn(input)
      if (outcome !== 'suspended' || racedContinuation) return outcome
      parkedTurn = await turns.getTurn(threadId, started.turnId)
      parkedItems = await sessionStore.loadItems(threadId)
      executionReleasedBeforeWake = !turns.isTurnExecutionActive(started.turnId)
      turnFailedBeforeWake = eventBus.snapshotSince(threadId, 0)
        .some((event) => event.kind === 'turn_failed')

      // Reacquire the lease and invoke runTurn before the old suspended
      // promise has left AgentLoop.activeTurnRuns. The wake-up must chain a
      // fresh runner after that promise settles instead of losing the lease.
      graphTerminal = true
      await turns.resumeGraphLeadTurn({
        threadId,
        turnId: started.turnId,
        runId: 'graph_run_stream_recovery',
        lastDeliveredSeq: 8,
        terminal: true
      })
      await turns.steerTurn({
        threadId,
        turnId: started.turnId,
        text: 'Continue in Graph mode and deliver the final result.'
      })
      racedContinuation = loop.runTurn(threadId, started.turnId)
      return outcome
    }

    await expect(loop.runTurn(threadId, started.turnId)).resolves.toBe('suspended')
    expect(parkedTurn).toMatchObject({
      id: started.turnId,
      status: 'running',
      orchestration: 'graph',
      graphLeadLifecycle: {
        runId: 'graph_run_stream_recovery',
        state: 'supervising',
        // Parking a failed episode must not acknowledge events that were not
        // delivered through an explicit Graph Lead resume snapshot.
        lastDeliveredSeq: 0
      }
    })
    expect(executionReleasedBeforeWake).toBe(true)
    expect(parkedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'error',
        code: 'stream_disconnected',
        details: expect.objectContaining({
          rawCode: 'stream_read_error',
          rawMessage: 'model stream read failed: terminated'
        })
      })
    ]))
    expect(parkedItems.filter((item) =>
      item.kind === 'assistant_text' &&
      item.text === 'Partial Graph supervision update.'
    )).toHaveLength(1)
    expect(turnFailedBeforeWake).toBe(false)

    expect(racedContinuation).toBeDefined()
    await expect(racedContinuation!).resolves.toBe('completed')
    expect((await turns.getTurn(threadId, started.turnId))?.status).toBe('completed')
    expect(model.requests).toHaveLength(2)
    expect(modelRequestContextText(model.requests[1]!)).toContain('Graph Mode is active')
    expect(model.requests[1]?.history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'user_message',
        text: 'Continue in Graph mode and deliver the final result.'
      })
    ]))
  })

  it('parks the planning draft without a terminal error when the model cannot call tools', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-28T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new CapturingCompleteModel()
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      createGraphPlanningDraft: async () => ({
        version: 1,
        draftId: 'draft_unsupported',
        reservedRunId: 'run_unsupported',
        state: 'planning',
        draftRevision: 1
      }),
      transitionGraphPlanningDraft: async ({ action }) => ({
        version: 1,
        draftId: 'draft_unsupported',
        reservedRunId: 'run_unsupported',
        state: action === 'suspend' ? 'needs_correction' : 'planning',
        draftRevision: 2
      }),
      ids,
      nowIso
    })
    const graphTool = LocalToolHost.defineTool({
      name: 'graph_define_plan',
      description: 'Define and commit a validated Graph plan.',
      inputSchema: { type: 'object', additionalProperties: false },
      toolKind: 'tool_call',
      policy: 'auto',
      shouldAdvertise: (context) => context.orchestration === 'graph',
      execute: async () => ({ output: { run: { id: 'graph_run_unsupported' } } })
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new AllowApprovalGate(),
      userInputGate: new NoopUserInputGate(),
      model,
      toolHost: new LocalToolHost({ tools: [graphTool] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      ids,
      nowIso,
      modelCapabilities: (modelId) => ({
        id: modelId,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: false,
        messageParts: ['text']
      })
    })
    const threadId = 'thr_graph_unsupported'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Unsupported Graph mode',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({
      threadId,
      request: {
        prompt: 'Create a graph.',
        model: model.model,
        orchestration: 'graph'
      }
    })

    await expect(loop.runTurn(threadId, started.turnId)).resolves.toBe('suspended')
    expect(model.requests).toHaveLength(2)
    expect(model.requests.every((request) => request.requiredToolName === undefined)).toBe(true)
    expect(modelRequestContextText(model.requests[1]!)).toContain('did not call `graph_define_plan`')
    const turn = await turns.getTurn(threadId, started.turnId)
    expect(turn?.status).toBe('running')
    expect(turn?.graphPlanningLifecycle).toMatchObject({
      draftId: 'draft_unsupported',
      state: 'needs_correction'
    })
    const recorded = await sessionStore.loadEventsSince(threadId, 0)
    expect(recorded.some((event) => event.kind === 'error')).toBe(false)

    await turns.steerTurn({
      threadId,
      turnId: started.turnId,
      text: 'Continue the suspended Graph planning turn.'
    })
    expect(turns.isTurnExecutionActive(started.turnId)).toBe(true)
    expect(steering.peek(started.turnId)).toEqual([
      { text: 'Continue the suspended Graph planning turn.' }
    ])
    await turns.interruptTurn({ threadId, turnId: started.turnId })
  })

  it('recovers retryable invalid Graph creation through a single-tool correction round', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-27T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new ScriptedInvalidGraphModel()
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
    const graphTool = LocalToolHost.defineTool({
      name: 'graph_define_plan',
      description: 'Define and commit a validated Graph plan.',
      inputSchema: {
        type: 'object',
        properties: {
          plan: {
            type: 'object',
            properties: { valid: { type: 'boolean' } },
            required: ['valid'],
            additionalProperties: false
          }
        },
        required: ['plan'],
        additionalProperties: false
      },
      toolKind: 'tool_call',
      policy: 'auto',
      shouldAdvertise: (context) => context.orchestration === 'graph',
      execute: async (args) => {
        const plan = args.plan as { valid?: unknown } | undefined
        return plan?.valid === true
          ? { output: { run: { id: 'graph_run_1', status: 'running' } } }
          : {
              output: {
                code: 'graph_plan_invalid',
                error: 'plan.valid is required',
                issues: [{ path: ['plan', 'valid'], code: 'invalid_type', message: 'Required' }],
                retryable: true,
                draft: { status: 'repairing' }
              },
              isError: true
            }
      }
    })
    const graphControlTool = LocalToolHost.defineTool({
      name: 'graph_control_run',
      description: 'Control an existing GraphRun.',
      inputSchema: { type: 'object', additionalProperties: false },
      toolKind: 'tool_call',
      policy: 'auto',
      shouldAdvertise: (context) => context.orchestration === 'graph',
      execute: async () => ({ output: { ok: true } })
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new AllowApprovalGate(),
      userInputGate: new NoopUserInputGate(),
      model,
      toolHost: new LocalToolHost({ tools: [graphTool, graphControlTool] }),
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
    await threadStore.upsert(createThreadRecord({
      id: 'thr_invalid_graph_mode',
      title: 'Invalid Graph mode',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const graphTurn = await turns.startTurn({
      threadId: 'thr_invalid_graph_mode',
      request: {
        prompt: 'Implement and verify the feature.',
        model: model.model,
        orchestration: 'graph'
      }
    })

    await expect(loop.runTurn('thr_invalid_graph_mode', graphTurn.turnId))
      .resolves.toBe('completed')
    expect(model.requests).toHaveLength(3)
    expect(model.requests[1]?.requiredToolName).toBeUndefined()
    expect(model.requests[1]?.tools.map((tool) => tool.name)).toEqual(['graph_define_plan'])
    expect(modelRequestContextText(model.requests[1]!)).toContain('structured issues')
    expect(modelRequestContextText(model.requests[1]!)).toContain('repository-relative paths')
    expect(modelRequestContextText(model.requests[1]!)).toContain('actual next tool arguments')
    expect(modelRequestContextText(model.requests[1]!)).toContain('Explanatory prose')
    expect(model.requests[1]?.history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_result',
        toolName: 'graph_define_plan',
        isError: true,
        output: expect.objectContaining({ retryable: true })
      })
    ]))
    expect(model.requests[2]?.requiredToolName).toBeUndefined()
  })
})
