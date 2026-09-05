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
  it('materializes a stable active-goal history item before the native model request', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-08-06T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new CapturingCompleteModel()
    const turns = new TurnService({
      threadStore, sessionStore, events, inflight, steering, compactor: new ContextCompactor(), ids, nowIso
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
    const threadId = 'thr_native_goal_context'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Native goal context',
      workspace: '/tmp/workspace',
      model: model.model,
      goal: {
        threadId,
        objective: 'Keep this goal as stable history.',
        status: 'active',
        tokenBudget: 321,
        tokensUsed: 19,
        timeUsedSeconds: 7,
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
    }))
    const started = await turns.startTurn({
      threadId,
      request: { prompt: 'Continue the goal.', model: model.model }
    })

    await expect(loop.runTurn(threadId, started.turnId)).resolves.toBe('completed')

    expect(model.requests.length).toBeGreaterThan(0)
    expect(model.requests[0]?.history.map((item) => item.kind)).toEqual([
      'user_message',
      'goal_context',
      'model_context'
    ])
    const goalContext = model.requests[0]?.history[1]
    expect(goalContext).toMatchObject({
      kind: 'goal_context',
      text: expect.stringContaining('Keep this goal as stable history.')
    })
    if (!goalContext || goalContext.kind !== 'goal_context') {
      throw new Error('expected goal context in model history')
    }
    expect(goalContext.text).not.toContain('Tokens used')
    expect(modelRequestContextText(model.requests[0]!)).not.toContain('active thread goal')
    expect(model.requests.every((request) =>
      request.history.filter((item) => item.kind === 'goal_context').length === 1
    )).toBe(true)
    expect((await threadStore.get(threadId))?.turns[0]?.items.some((item) => item.kind === 'goal_context'))
      .toBe(false)
  })

  it('continues after a final streamed response when steering was accepted mid-step', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-16T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new FinalResponseGateModel()
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
    const threadId = 'thr_mid_turn_guidance'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Mid-turn guidance',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({
      threadId,
      request: { prompt: 'start with the original request', model: model.model }
    })

    const run = loop.runTurn(threadId, started.turnId)
    await model.waitForFirstResponse()
    await turns.steerTurn({
      threadId,
      turnId: started.turnId,
      text: 'use the compact logo instead',
      displayText: 'Use the compact logo instead'
    })
    model.release()

    await expect(run).resolves.toBe('completed')
    expect(model.requests).toHaveLength(2)
    expect(model.requests[1]?.history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'user_message',
        text: 'use the compact logo instead',
        displayText: 'Use the compact logo instead'
      })
    ]))
    // Turn finalization clears transient queue state, including its seal.
    expect(steering.isSealed(started.turnId)).toBe(false)
  })

  it('injects the Design intent policy as a system mode instruction on canvas turns', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-10T00:00:00.000Z'
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
    const threadId = 'thr_design_mode'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Design mode test',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({
      threadId,
      request: {
        prompt: '做一套完整 CRM',
        model: model.model,
        guiDesignCanvas: true,
        guiDesignMode: true
      }
    })

    await expect(loop.runTurn(threadId, started.turnId)).resolves.toBe('completed')

    expect(model.requests).toHaveLength(1)
    const designContext = modelRequestContextText(model.requests[0]!)
    expect(designContext).toContain('SINGLE SCREEN')
    expect(designContext).toContain('COMPLETE MULTI-SCREEN EXPERIENCE')
    expect(designContext).toContain('MODIFY EXISTING DESIGN')
    expect(designContext).toContain('Kun append-only model context update')
    expect(designContext).toContain('kind="runtime-context" authority="runtime"')
    expect(designContext).toContain('Current opened project absolute path: `/tmp/workspace`')
  })

  it('keeps the source turn active until its GraphRun is terminal (#1031)', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-26T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new ScriptedGraphModel()
    let graphTerminal = false
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      resolveGraphLeadRun: async ({ threadId }) => threadId === 'thr_graph_mode'
        ? {
            runId: 'graph_run_1',
            lastEventSeq: graphTerminal ? 9 : 3,
            terminal: graphTerminal
          }
        : null,
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
      execute: async () => ({ output: { run: { id: 'graph_run_1', status: 'running' } } })
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
    const graphSuperviseTool = LocalToolHost.defineTool({
      name: 'graph_supervise_node',
      description: 'Inspect, wait for, or guide an active Graph worker.',
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
      toolHost: new LocalToolHost({
        tools: [graphTool, graphControlTool, graphSuperviseTool]
      }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      turnLimits: { maxSteps: 2, maxWallTimeMs: 60_000 },
      ids,
      nowIso
    })
    await threadStore.upsert(createThreadRecord({
      id: 'thr_graph_mode',
      title: 'Graph mode',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const graphTurn = await turns.startTurn({
      threadId: 'thr_graph_mode',
      request: {
        prompt: 'Implement and verify the feature.',
        model: model.model,
        orchestration: 'graph'
      }
    })

    await expect(loop.runTurn('thr_graph_mode', graphTurn.turnId)).resolves.toBe('suspended')
    expect((await turns.getTurn('thr_graph_mode', graphTurn.turnId))?.status).toBe('running')
    expect(turns.isTurnExecutionActive(graphTurn.turnId)).toBe(false)
    expect(eventBus.snapshotSince('thr_graph_mode', 0)
      .some((event) => event.kind === 'turn_completed')).toBe(false)
    expect(eventBus.snapshotSince('thr_graph_mode', 0)
      .some((event) => event.kind === 'error' && event.code === 'turn_step_limit')).toBe(false)
    expect(model.requests).toHaveLength(3)
    expect(model.requests[0]?.requiredToolName).toBeUndefined()
    expect(modelRequestContextText(model.requests[0]!)).toContain('Graph Mode is active')
    expect(modelRequestContextText(model.requests[0]!)).toContain(
      'You are the source Graph Lead: the original main agent'
    )
    expect(modelRequestContextText(model.requests[0]!)).toContain('## Required operating loop')
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(['graph_define_plan'])
    expect(model.requests[1]?.requiredToolName).toBeUndefined()
    expect(model.requests[1]?.tools.map((tool) => tool.name)).toEqual(['graph_define_plan'])
    expect(modelRequestContextText(model.requests[1]!)).toContain('did not call `graph_define_plan`')
    expect(model.requests[2]?.requiredToolName).toBeUndefined()
    expect(model.requests[2]?.tools.map((tool) => tool.name)).toEqual([
      'graph_control_run',
      'graph_define_plan',
      'graph_supervise_node'
    ])
    expect(modelRequestContextText(model.requests[2]!)).toContain(
      'You are the source Graph Lead: the original main agent'
    )
    expect(modelRequestContextText(model.requests[2]!)).toContain(
      'Use `graph_supervise_node overview`'
    )
    expect(modelRequestContextText(model.requests[2]!)).toContain(
      'Do not treat dispatch or one milestone as completion'
    )
    expect(model.requests[2]?.history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_result',
        toolName: 'graph_define_plan'
      })
    ]))

    graphTerminal = true
    await turns.resumeGraphLeadTurn({
      threadId: 'thr_graph_mode',
      turnId: graphTurn.turnId,
      runId: 'graph_run_1',
      lastDeliveredSeq: 9,
      terminal: true
    })
    await turns.steerTurn({
      threadId: 'thr_graph_mode',
      turnId: graphTurn.turnId,
      text: 'Present the persisted final Graph result.',
      messageSource: 'graph_runtime'
    })
    await expect(loop.runTurn('thr_graph_mode', graphTurn.turnId)).resolves.toBe('completed')
    expect((await turns.getTurn('thr_graph_mode', graphTurn.turnId))?.status).toBe('completed')
    expect(eventBus.snapshotSince('thr_graph_mode', 0)
      .some((event) => event.kind === 'turn_completed')).toBe(true)

    const directModel = new CapturingCompleteModel()
    const directLoop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new AllowApprovalGate(),
      userInputGate: new NoopUserInputGate(),
      model: directModel,
      toolHost: new LocalToolHost({ tools: [graphTool] }),
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
      id: 'thr_direct_mode',
      title: 'Direct mode',
      workspace: '/tmp/workspace',
      model: directModel.model
    }))
    const directTurn = await turns.startTurn({
      threadId: 'thr_direct_mode',
      request: {
        prompt: 'Answer directly.',
        model: directModel.model,
        orchestration: 'direct'
      }
    })
    await expect(directLoop.runTurn('thr_direct_mode', directTurn.turnId))
      .resolves.toBe('completed')
    expect(directModel.requests[0]?.requiredToolName).toBeUndefined()
    expect(directModel.requests[0]?.tools.map((tool) => tool.name))
      .not.toContain('graph_create_run')
  })

  it('parks a nonterminal Graph Lead episode after eight alternating tool steps', async () => {
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
    const model = new AlternatingGraphLeadToolModel()
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      resolveGraphLeadRun: async () => ({
        runId: 'graph_run_bounded_episode',
        lastEventSeq: 12,
        terminal: false,
        supervisionPending: true
      }),
      ids,
      nowIso
    })
    const graphToolSchema = {
      type: 'object',
      properties: {
        action: { type: 'string' },
        sequence: { type: 'number' }
      },
      required: ['action', 'sequence'],
      additionalProperties: false
    } as const
    const graphControlTool = LocalToolHost.defineTool({
      name: 'graph_control_run',
      description: 'Inspect a GraphRun.',
      inputSchema: graphToolSchema,
      toolKind: 'tool_call',
      policy: 'auto',
      shouldAdvertise: (context) => context.orchestration === 'graph',
      execute: async () => ({ output: { ok: true } })
    })
    const graphSuperviseTool = LocalToolHost.defineTool({
      name: 'graph_supervise_node',
      description: 'Inspect a Graph worker.',
      inputSchema: graphToolSchema,
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
      toolHost: new LocalToolHost({ tools: [graphControlTool, graphSuperviseTool] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      turnLimits: { maxSteps: 1, maxWallTimeMs: 60_000 },
      ids,
      nowIso
    })
    const threadId = 'thr_graph_bounded_lead_episode'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Bounded Graph Lead episode',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({
      threadId,
      request: {
        prompt: 'Supervise the durable GraphRun.',
        model: model.model,
        orchestration: 'graph'
      }
    })
    await turns.resumeGraphLeadTurn({
      threadId,
      turnId: started.turnId,
      runId: 'graph_run_bounded_episode',
      lastDeliveredSeq: 12,
      terminal: false
    })

    const suspendGraphLeadTurn = turns.suspendGraphLeadTurn.bind(turns)
    const suspensionInputs: Parameters<TurnService['suspendGraphLeadTurn']>[0][] = []
    turns.suspendGraphLeadTurn = async (input) => {
      suspensionInputs.push(input)
      return suspendGraphLeadTurn(input)
    }
    const finishTurn = turns.finishTurn.bind(turns)
    let finishTurnCalls = 0
    turns.finishTurn = async (input) => {
      finishTurnCalls += 1
      return finishTurn(input)
    }

    await expect(loop.runTurn(threadId, started.turnId))
      .resolves.toBe('suspended_pending_supervision')

    expect(model.requests).toHaveLength(8)
    expect(suspensionInputs).toEqual([
      {
        threadId,
        turnId: started.turnId,
        force: true,
        preserveDeliveryCursor: true,
        allowPendingSupervision: true
      }
    ])
    expect(finishTurnCalls).toBe(0)
    expect((await turns.getTurn(threadId, started.turnId))?.status).toBe('running')
    expect(turns.isTurnExecutionActive(started.turnId)).toBe(false)
    expect(eventBus.snapshotSince(threadId, 0).some((event) =>
      event.kind === 'turn_completed' ||
      event.kind === 'turn_failed' ||
      (event.kind === 'error' && event.code === 'turn_step_limit')
    )).toBe(false)
  })
})
