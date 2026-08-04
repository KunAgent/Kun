import { describe, expect, it, vi } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { makeToolCallItem, makeToolResultItem } from '../domain/item.js'
import { createTurnRecord } from '../domain/turn.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import { CREATE_PLAN_TOOL_NAME } from '../adapters/tool/create-plan-tool.js'
import {
  DESIGN_SVG_EDIT_TOOL_NAME,
  DESIGN_SVG_VALIDATE_TOOL_NAME
} from '../adapters/tool/design-svg-tool.js'
import { GRAPH_DEFINE_PLAN_TOOL_NAME } from '../adapters/tool/graph-define-plan-tool.js'
import type { ModelRoundStreamResult } from './model-round-engine.js'
import {
  GRAPH_CREATE_RUN_TOOL_NAME,
  MAX_GRAPH_CREATE_RUN_RECOVERY_STEPS,
  RoundOutcomeCoordinator,
  type RoundOutcomeInput
} from './round-outcome-coordinator.js'
import { svgArtifactCompletionState } from './svg-artifact-completion.js'
import type {
  PreparedTurnContext,
  ToolDispatchInput,
  ToolDispatchOutcome
} from './turn-execution-types.js'

const threadId = 'thread_round_outcome'
const turnId = 'turn_round_outcome'

function completed(input: {
  text?: string
  stopReason?: 'stop' | 'tool_calls' | 'length' | 'error'
  toolCalls?: RoundOutcomeInput['streamed'] extends infer _Result ? ToolDispatchInput['calls'] : never
} = {}): ModelRoundStreamResult {
  const toolCalls = input.toolCalls ?? []
  return {
    kind: toolCalls.length > 0 ? 'tool_calls' : 'completed',
    snapshot: {
      text: input.text ?? '',
      reasoning: '',
      toolCalls,
      stopReason: input.stopReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop')
    }
  }
}

function prepared(overrides: Partial<PreparedTurnContext> = {}): PreparedTurnContext {
  return {
    threadId,
    turnId,
    workspace: '/workspace',
    orchestration: 'direct',
    model: 'test-model',
    mode: 'agent',
    clientSurface: 'api',
    dedicatedSvgTurn: false,
    planContextStale: false,
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    signal: new AbortController().signal,
    history: [],
    modelCapabilities: {
      id: 'test-model',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text']
    },
    attachments: { imageAttachments: [], textFallbacks: [], documents: [] },
    skillResolution: {
      activeSkillIds: [],
      activations: [],
      instructions: [],
      injectedBytes: 0
    },
    instructionResolution: { instruction: undefined, sources: [], injectedBytes: 0 },
    memories: [],
    activeGoalInstruction: null,
    goalRecoveryInstruction: null,
    activeTodoInstruction: null,
    planTurnActive: false,
    userInputDisabled: false,
    toolDiscoveryContext: {} as ToolHostContext,
    tools: [],
    ...overrides
  }
}

function harness(options: {
  madeProgress?: boolean
  latestItems?: TurnItem[]
  graphResults?: Array<{ output: unknown; isError: boolean }>
} = {}) {
  const effects: string[] = []
  const items: TurnItem[] = []
  const sessionItems = [...(options.latestItems ?? [])]
  const graphResults = [...(options.graphResults ?? [])]
  let requiredToolGate: {
    toolName: string
    attempt: number
    maxAttempts: number
    phase: 'preparing' | 'retrying' | 'succeeded' | 'failed'
    lastError?: string
  } | undefined
  const eventDrafts: Array<{ kind?: string; code?: string; message?: string }> = []
  const dispatches: ToolDispatchInput[] = []
  const updatedItemPatches: Array<{ itemId: string; patch: unknown }> = []
  const failures: unknown[] = []
  const metadataPatches: unknown[] = []
  const suppressGoalResume = vi.fn()
  const dispatchToolCalls = vi.fn(async (input: ToolDispatchInput): Promise<ToolDispatchOutcome> => {
    effects.push('dispatch')
    dispatches.push(input)
    for (const call of input.calls) {
      if (
        call.toolName !== GRAPH_CREATE_RUN_TOOL_NAME &&
        call.toolName !== GRAPH_DEFINE_PLAN_TOOL_NAME
      ) continue
      const result = graphResults.shift()
      if (!result) continue
      sessionItems.push(makeToolResultItem({
        id: `item_${call.callId}`,
        threadId: input.threadId,
        turnId: input.turnId,
        callId: call.callId,
        toolName: call.toolName,
        output: result.output,
        isError: result.isError
      }))
    }
    return 'continue'
  })
  const turns = {
    applyItem: vi.fn(async (_threadId: string, item: TurnItem) => {
      effects.push(`item:${item.kind}`)
      items.push(item)
    }),
    updateItem: vi.fn(async (_threadId: string, itemId: string, patch: unknown) => {
      updatedItemPatches.push({ itemId, patch })
      return null
    }),
    getTurn: vi.fn(async () => requiredToolGate ? { requiredToolGate } : {}),
    updateTurnMetadata: vi.fn(async (
      _threadId: string,
      _turnId: string,
      patch: {
        requiredToolGate?: typeof requiredToolGate | null
        graphPlanningLifecycle?: unknown
      }
    ) => {
      metadataPatches.push(patch)
      requiredToolGate = patch.requiredToolGate === null
        ? undefined
        : patch.requiredToolGate ?? requiredToolGate
    })
  } as unknown as Pick<TurnService, 'applyItem' | 'updateItem' | 'getTurn' | 'updateTurnMetadata'>
  const events = {
    record: vi.fn(async (draft: { kind?: string; code?: string; message?: string }) => {
      effects.push(`event:${draft.kind}`)
      eventDrafts.push(draft)
      return draft
    })
  } as unknown as Pick<RuntimeEventRecorder, 'record'>
  const coordinator = new RoundOutcomeCoordinator({
    sessionStore: { loadItems: async () => sessionItems },
    turns,
    events,
    ids: new SequentialIdGenerator(),
    dispatchToolCalls,
    rememberFailure: (_turnId, failure) => failures.push(failure),
    hasTurnMadeProgress: () => options.madeProgress === true,
    suppressGoalResume
  })
  return {
    coordinator,
    effects,
    items,
    eventDrafts,
    dispatches,
    failures,
    metadataPatches,
    updatedItemPatches,
    sessionItems,
    suppressGoalResume,
    dispatchToolCalls
  }
}

function input(
  streamed: ModelRoundStreamResult,
  overrides: Partial<RoundOutcomeInput> = {}
): RoundOutcomeInput {
  return {
    threadId,
    turnId,
    streamed,
    turn: createTurnRecord({ id: turnId, threadId, prompt: 'original prompt', status: 'running' }),
    prepared: prepared(),
    toolProviderMetadata: new Map(),
    toolKinds: new Map(),
    toolProviderKinds: new Map(),
    svgCompletion: null,
    ...overrides
  }
}

describe('RoundOutcomeCoordinator', () => {
  it('passes aborted and failed stream outcomes through without dispatching', async () => {
    const h = harness()
    await expect(h.coordinator.resolve(input({ kind: 'aborted' }))).resolves.toBe('aborted')
    await expect(h.coordinator.resolve(input({ kind: 'failed' }))).resolves.toBe('failed')
    expect(h.dispatchToolCalls).not.toHaveBeenCalled()
    expect(h.effects).toEqual([])
  })

  it('materializes plan text before dispatch without adding interactive flags', async () => {
    const h = harness()
    const planContext = {
      operation: 'draft' as const,
      workspaceRoot: '/workspace',
      relativePath: '.kunsdd/plan/example.md',
      planId: 'example',
      sourceRequest: 'source request',
      title: 'Example'
    }
    const outcome = await h.coordinator.resolve(input(completed({ text: '# Plan\nDo it.' }), {
      softRequiredToolName: CREATE_PLAN_TOOL_NAME,
      prepared: prepared({
        mode: 'plan',
        planTurnActive: true,
        activePlanContext: planContext,
        userInputDisabled: true
      }),
      turn: createTurnRecord({
        id: turnId,
        threadId,
        prompt: 'plan it',
        status: 'running',
        imContext: true
      }),
      modelProviderId: 'provider_main',
      modelReasoningEffort: 'high',
      toolProviderMetadata: new Map([[
        CREATE_PLAN_TOOL_NAME,
        { providerId: 'provider_tool', providerKind: 'built-in' }
      ]]),
      toolKinds: new Map([[CREATE_PLAN_TOOL_NAME, 'file_change']]),
      toolProviderKinds: new Map([[CREATE_PLAN_TOOL_NAME, 'built-in']])
    }))

    expect(outcome).toBe('continue')
    expect(h.effects).toEqual(['item:tool_call', 'event:tool_call_ready', 'dispatch'])
    expect(h.items[0]).toMatchObject({
      kind: 'tool_call',
      toolName: CREATE_PLAN_TOOL_NAME,
      arguments: {
        markdown: '# Plan\nDo it.',
        plan_id: 'example',
        plan_relative_path: '.kunsdd/plan/example.md',
        source_request: 'source request'
      }
    })
    expect(h.dispatches[0]?.calls[0]).toMatchObject({ providerId: 'provider_tool', toolKind: 'file_change' })
    expect(h.dispatches[0]?.reasoningEffort).toBe('high')
    expect(Object.hasOwn(h.dispatches[0] ?? {}, 'userInputDisabled')).toBe(false)
    expect(Object.hasOwn(h.dispatches[0] ?? {}, 'imContext')).toBe(false)
  })

  it('records required-tool failure in event-then-item order', async () => {
    const h = harness()
    const outcome = await h.coordinator.resolve(input(completed(), {
      requiredToolName: CREATE_PLAN_TOOL_NAME
    }))

    expect(outcome).toBe('failed')
    expect(h.effects).toEqual(['event:error', 'item:error'])
    expect(h.eventDrafts[0]).toMatchObject({ code: 'required_tool_missing' })
    expect(h.items[0]).toMatchObject({ kind: 'error', code: 'required_tool_missing' })
  })

  it('continues once after all_suppressed then fails empty recovery stop (#1081)', async () => {
    const h = harness()
    h.dispatchToolCalls.mockResolvedValueOnce('all_suppressed')
    const toolRound = input(completed({
      toolCalls: [{
        callId: 'call_1',
        toolName: 'bash',
        toolKind: 'tool_call',
        arguments: { command: 'true' }
      }]
    }))

    await expect(h.coordinator.resolve(toolRound)).resolves.toBe('continue')
    expect(h.coordinator.toolStormRecoveryRounds(turnId)).toBe(1)
    expect(h.dispatchToolCalls).toHaveBeenCalledOnce()

    await expect(h.coordinator.resolve(input(completed({ text: '' })))).resolves.toBe('failed')
    expect(h.effects).toEqual(expect.arrayContaining(['event:error', 'item:error']))
    expect(h.items.some((item) =>
      item.kind === 'error' && item.code === 'tool_storm_no_final_response'
    )).toBe(true)
    expect(h.failures[0]).toMatchObject({ code: 'tool_storm_no_final_response' })
  })

  it('clears tool-storm recovery after a non-empty final answer', async () => {
    const h = harness()
    h.dispatchToolCalls.mockResolvedValueOnce('all_suppressed')
    await expect(h.coordinator.resolve(input(completed({
      toolCalls: [{
        callId: 'call_1',
        toolName: 'bash',
        toolKind: 'tool_call',
        arguments: { command: 'true' }
      }]
    })))).resolves.toBe('continue')
    expect(h.coordinator.toolStormRecoveryRounds(turnId)).toBe(1)

    await expect(h.coordinator.resolve(input(completed({
      text: 'Here is the answer without more tools.'
    })))).resolves.toBe('stop')
    expect(h.coordinator.toolStormRecoveryRounds(turnId)).toBe(0)
  })

  it('fails a second consecutive all_suppressed after the recovery budget', async () => {
    const h = harness()
    h.dispatchToolCalls.mockResolvedValue('all_suppressed')
    let callSeq = 0
    const toolRound = () => {
      callSeq += 1
      return input(completed({
        toolCalls: [{
          callId: `call_storm_${callSeq}`,
          toolName: 'bash',
          toolKind: 'tool_call',
          arguments: { command: 'true' }
        }]
      }))
    }

    await expect(h.coordinator.resolve(toolRound())).resolves.toBe('continue')
    await expect(h.coordinator.resolve(toolRound())).resolves.toBe('failed')
    expect(h.items.some((item) =>
      item.kind === 'error' && item.code === 'tool_storm_no_final_response'
    )).toBe(true)
  })

  it('stops validated dedicated SVG turns on all_suppressed without storm recovery', async () => {
    const revision = 'rev_svg_1'
    const mutation = makeToolResultItem({
      id: 'item_svg_edit',
      threadId,
      turnId,
      callId: 'call_svg_edit',
      toolName: DESIGN_SVG_EDIT_TOOL_NAME,
      output: { ok: true, revision }
    })
    const validation = makeToolResultItem({
      id: 'item_svg_validate',
      threadId,
      turnId,
      callId: 'call_svg_validate',
      toolName: DESIGN_SVG_VALIDATE_TOOL_NAME,
      output: { ok: true, revision }
    })
    const h = harness({ latestItems: [mutation, validation] })
    h.dispatchToolCalls.mockResolvedValueOnce('all_suppressed')
    const completion = svgArtifactCompletionState([mutation, validation], turnId)
    expect(completion.validationAfterMutation).toBe(true)

    await expect(h.coordinator.resolve(input(completed({
      toolCalls: [{
        callId: 'call_svg_storm',
        toolName: DESIGN_SVG_VALIDATE_TOOL_NAME,
        toolKind: 'tool_call',
        arguments: {}
      }]
    }), {
      prepared: prepared({ dedicatedSvgTurn: true, history: [mutation, validation] }),
      svgCompletion: completion
    }))).resolves.toBe('stop')

    expect(h.coordinator.toolStormRecoveryRounds(turnId)).toBe(0)
    expect(h.items.some((item) =>
      item.kind === 'error' && item.code === 'tool_storm_no_final_response'
    )).toBe(false)
    expect(h.failures).toEqual([])
  })

  it('uses SVG completion recovery when all_suppressed before mutation/validation', async () => {
    const h = harness()
    h.dispatchToolCalls.mockResolvedValue('all_suppressed')
    const incompleteRound = input(completed({
      toolCalls: [{
        callId: 'call_svg_inspect_storm',
        toolName: 'design_svg_inspect',
        toolKind: 'tool_call',
        arguments: {}
      }]
    }), {
      prepared: prepared({ dedicatedSvgTurn: true }),
      svgCompletion: svgArtifactCompletionState([], turnId)
    })

    await expect(h.coordinator.resolve(incompleteRound)).resolves.toBe('continue')
    expect(h.coordinator.toolStormRecoveryRounds(turnId)).toBe(0)
    expect(h.eventDrafts[0]).toMatchObject({ code: 'required_svg_mutation_missing' })

    const mutationOnly = makeToolResultItem({
      id: 'item_svg_edit_only',
      threadId,
      turnId,
      callId: 'call_svg_edit_only',
      toolName: DESIGN_SVG_EDIT_TOOL_NAME,
      output: { ok: true, revision: 'rev_svg_2' }
    })
    const h2 = harness({ latestItems: [mutationOnly] })
    h2.dispatchToolCalls.mockResolvedValueOnce('all_suppressed')
    await expect(h2.coordinator.resolve(input(completed({
      toolCalls: [{
        callId: 'call_svg_edit_storm',
        toolName: DESIGN_SVG_EDIT_TOOL_NAME,
        toolKind: 'tool_call',
        arguments: {}
      }]
    }), {
      prepared: prepared({ dedicatedSvgTurn: true, history: [mutationOnly] }),
      svgCompletion: svgArtifactCompletionState([mutationOnly], turnId)
    }))).resolves.toBe('continue')
    expect(h2.coordinator.toolStormRecoveryRounds(turnId)).toBe(0)
    expect(h2.eventDrafts[0]).toMatchObject({ code: 'required_svg_validation_missing' })
    expect(h2.items.some((item) =>
      item.kind === 'error' && item.code === 'tool_storm_no_final_response'
    )).toBe(false)
  })

  it('clears tool-storm recovery state on clearTurn', async () => {
    const h = harness()
    h.dispatchToolCalls.mockResolvedValueOnce('all_suppressed')
    await h.coordinator.resolve(input(completed({
      toolCalls: [{
        callId: 'call_1',
        toolName: 'bash',
        toolKind: 'tool_call',
        arguments: { command: 'true' }
      }]
    })))
    expect(h.coordinator.toolStormRecoveryRounds(turnId)).toBe(1)
    h.coordinator.clearTurn(turnId)
    expect(h.coordinator.toolStormRecoveryRounds(turnId)).toBe(0)
  })

  it('recovers a missing Graph creation call and clears recovery state only on success or cleanup', async () => {
    const h = harness({
      graphResults: [{ output: { run: { id: 'graph_run_1' } }, isError: false }]
    })
    const graphTurn = createTurnRecord({
      id: turnId,
      threadId,
      prompt: 'run this as a graph',
      status: 'running',
      orchestration: 'graph'
    })
    const missing = input(completed({ text: 'The graph could not be started.' }), {
      requiredToolName: GRAPH_CREATE_RUN_TOOL_NAME,
      turn: graphTurn,
      prepared: prepared({ orchestration: 'graph' })
    })

    await expect(h.coordinator.resolve(missing)).resolves.toBe('continue')
    expect(h.coordinator.graphCreateRunRecoverySteps(turnId)).toBe(1)
    expect(h.eventDrafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'required_tool_gate' })
    ]))

    const graphCall = {
      callId: 'call_graph_create',
      toolName: GRAPH_CREATE_RUN_TOOL_NAME,
      toolKind: 'tool_call' as const,
      arguments: {}
    }
    await expect(h.coordinator.resolve(input(completed({ toolCalls: [graphCall] }), {
      requiredToolName: GRAPH_CREATE_RUN_TOOL_NAME,
      turn: graphTurn,
      prepared: prepared({ orchestration: 'graph' })
    }))).resolves.toBe('continue')
    expect(h.coordinator.graphCreateRunRecoverySteps(turnId)).toBe(0)
    expect(h.coordinator.graphCreateRunRecoveryReason(turnId)).toBeUndefined()
    expect(h.dispatches[0]?.calls).toEqual([graphCall])

    await expect(h.coordinator.resolve(missing)).resolves.toBe('continue')
    expect(h.coordinator.graphCreateRunRecoverySteps(turnId)).toBe(1)
    h.coordinator.clearTurn(turnId)
    expect(h.coordinator.graphCreateRunRecoverySteps(turnId)).toBe(0)
  })

  it('synchronizes every graph_define_plan draft state onto the source turn', async () => {
    const cases = [
      {
        status: 'committed' as const,
        revision: 4,
        isError: false,
        outcome: 'continue',
        output: (draft: Record<string, unknown>) => ({ status: 'committed', draft })
      },
      {
        status: 'needs_correction' as const,
        revision: 3,
        isError: true,
        outcome: 'stop',
        output: (draft: Record<string, unknown>) => ({
          code: 'graph_plan_needs_correction',
          retryable: false,
          draft
        })
      },
      {
        status: 'host_error' as const,
        revision: 2,
        isError: true,
        outcome: 'failed',
        output: (draft: Record<string, unknown>) => ({
          code: 'graph_planning_host_error',
          retryable: false,
          error: 'storage failed',
          draft
        })
      }
    ]

    for (const testCase of cases) {
      const draft = {
        version: 1,
        id: `draft_${testCase.status}`,
        reservedRunId: `run_${testCase.status}`,
        threadId,
        sourceTurnId: turnId,
        projectId: 'project_1',
        goal: 'Run the work as a Graph.',
        revision: testCase.revision,
        status: testCase.status,
        issues: [],
        repairCount: testCase.status === 'needs_correction' ? 1 : 0,
        createdAt: '2026-07-30T00:00:00.000Z',
        updatedAt: '2026-07-30T00:00:01.000Z',
        ...(testCase.status === 'committed'
          ? { committedRunId: `run_${testCase.status}` }
          : {})
      }
      const h = harness({
        graphResults: [{
          output: testCase.output(draft),
          isError: testCase.isError
        }]
      })
      const graphCall = {
        callId: `call_${testCase.status}`,
        toolName: GRAPH_DEFINE_PLAN_TOOL_NAME,
        toolKind: 'tool_call' as const,
        arguments: { plan: { title: 'Test', tasks: [] } }
      }

      await expect(h.coordinator.resolve(input(completed({ toolCalls: [graphCall] }), {
        softRequiredToolName: GRAPH_DEFINE_PLAN_TOOL_NAME,
        turn: createTurnRecord({
          id: turnId,
          threadId,
          prompt: 'run graph',
          status: 'running',
          orchestration: 'graph'
        }),
        prepared: prepared({ orchestration: 'graph' })
      }))).resolves.toBe(testCase.outcome)
      expect(h.metadataPatches).toContainEqual({
        graphPlanningLifecycle: {
          version: 1,
          draftId: draft.id,
          reservedRunId: draft.reservedRunId,
          state: testCase.status,
          draftRevision: testCase.revision
        }
      })
    }
  })

  it('suppresses extra tools when a hard Graph tool call is present', async () => {
    const h = harness({
      graphResults: [{ output: { run: { id: 'graph_run_1' } }, isError: false }]
    })
    const graphTurn = createTurnRecord({
      id: turnId,
      threadId,
      prompt: 'run this as a graph',
      status: 'running',
      orchestration: 'graph'
    })
    const readCall = {
      callId: 'call_read', toolName: 'read', toolKind: 'tool_call' as const, arguments: { path: 'secret.txt' }
    }
    const graphCall = {
      callId: 'call_graph', toolName: GRAPH_CREATE_RUN_TOOL_NAME, toolKind: 'tool_call' as const, arguments: {}
    }

    await expect(h.coordinator.resolve(input(completed({ toolCalls: [readCall, graphCall] }), {
      requiredToolName: GRAPH_CREATE_RUN_TOOL_NAME,
      turn: graphTurn,
      prepared: prepared({ orchestration: 'graph' })
    }))).resolves.toBe('continue')

    expect(h.dispatches[0]?.calls).toEqual([graphCall])
    expect(h.updatedItemPatches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: `item_tool_${turnId}_call_read`,
        patch: expect.objectContaining({ status: 'failed', summary: expect.stringContaining('Suppressed') })
      })
    ]))
    expect(h.eventDrafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'required_tool_mismatch' })
    ]))
  })

  it('shares recovery across missing and retryable invalid Graph creation rounds', async () => {
    const h = harness({
      graphResults: [{
        output: {
          code: 'graph_create_run_schema_invalid',
          error: 'invalid graph arguments',
          retryable: true
        },
        isError: true
      }]
    })
    const graphTurn = createTurnRecord({
      id: turnId,
      threadId,
      prompt: 'run this as a graph',
      status: 'running',
      orchestration: 'graph'
    })
    const base = {
      requiredToolName: GRAPH_CREATE_RUN_TOOL_NAME,
      turn: graphTurn,
      prepared: prepared({ orchestration: 'graph' })
    }

    await expect(h.coordinator.resolve(input(completed({ text: 'No call.' }), base)))
      .resolves.toBe('continue')
    expect(h.coordinator.graphCreateRunRecoverySteps(turnId)).toBe(1)
    expect(h.coordinator.graphCreateRunRecoveryReason(turnId)).toBe('missing')

    await expect(h.coordinator.resolve(input(completed({
      toolCalls: [{
        callId: 'call_invalid',
        toolName: GRAPH_CREATE_RUN_TOOL_NAME,
        toolKind: 'tool_call',
        arguments: { plan: {} }
      }]
    }), base))).resolves.toBe('continue')
    expect(h.coordinator.graphCreateRunRecoverySteps(turnId)).toBe(2)
    expect(h.coordinator.graphCreateRunRecoveryReason(turnId)).toBe('invalid')

    await expect(h.coordinator.resolve(input(completed({ text: 'Still no call.' }), base)))
      .resolves.toBe('failed')
    expect(h.failures.at(-1)).toMatchObject({ code: 'graph_create_run_failed' })
  })

  it('bounds retryable invalid Graph creation and fails non-retryable errors immediately', async () => {
    const retryableResult = {
      output: {
        code: 'graph_create_run_validation_failed',
        error: 'invalid graph',
        retryable: true
      },
      isError: true
    }
    const h = harness({
      graphResults: [retryableResult, retryableResult, retryableResult]
    })
    const graphTurn = createTurnRecord({
      id: turnId,
      threadId,
      prompt: 'run this as a graph',
      status: 'running',
      orchestration: 'graph'
    })
    const base = {
      requiredToolName: GRAPH_CREATE_RUN_TOOL_NAME,
      turn: graphTurn,
      prepared: prepared({ orchestration: 'graph' })
    }
    const invalidRound = (callId: string) => input(completed({
      toolCalls: [{
        callId,
        toolName: GRAPH_CREATE_RUN_TOOL_NAME,
        toolKind: 'tool_call',
        arguments: { plan: {} }
      }]
    }), base)

    await expect(h.coordinator.resolve(invalidRound('call_invalid_1'))).resolves.toBe('continue')
    await expect(h.coordinator.resolve(invalidRound('call_invalid_2'))).resolves.toBe('continue')
    await expect(h.coordinator.resolve(invalidRound('call_invalid_3'))).resolves.toBe('failed')
    expect(h.failures.at(-1)).toMatchObject({
      code: 'graph_create_run_failed',
      error: expect.stringContaining('Graph turn could not start')
    })

    const nonRetryable = harness({
      graphResults: [{
        output: {
          code: 'graph_create_run_failed',
          error: 'workspace identity unavailable',
          retryable: false
        },
        isError: true
      }]
    })
    await expect(nonRetryable.coordinator.resolve(invalidRound('call_host_failure')))
      .resolves.toBe('failed')
    expect(nonRetryable.failures.at(-1)).toMatchObject({
      code: 'graph_create_run_failed',
      error: expect.stringContaining('workspace identity unavailable')
    })
    expect(nonRetryable.coordinator.graphCreateRunRecoverySteps(turnId)).toBe(0)
  })

  it('bounds legacy Graph creation recovery and leaves terminal error ownership to TurnService', async () => {
    const h = harness()
    const round = input(completed({ text: 'Unable to start.' }), {
      requiredToolName: GRAPH_CREATE_RUN_TOOL_NAME,
      turn: createTurnRecord({
        id: turnId,
        threadId,
        prompt: 'run this as a graph',
        status: 'running',
        orchestration: 'graph'
      }),
      prepared: prepared({ orchestration: 'graph' })
    })

    for (let step = 0; step < MAX_GRAPH_CREATE_RUN_RECOVERY_STEPS; step += 1) {
      await expect(h.coordinator.resolve(round)).resolves.toBe('continue')
    }
    await expect(h.coordinator.resolve(round)).resolves.toBe('failed')

    expect(h.effects.at(-1)).toBe('event:required_tool_gate')
    expect(h.effects).not.toContain('event:error')
    expect(h.effects).not.toContain('item:error')
    expect(h.failures.at(-1)).toMatchObject({
      code: 'graph_create_run_failed',
      error: expect.stringMatching(/Graph turn could not start.*graph_create_run/)
    })
    expect(h.failures.at(-1)).not.toMatchObject({
      error: expect.stringContaining('Plan-mode')
    })
  })

  it('allows continuation and final-answer recovery before failing in event-then-item order', async () => {
    const fileChange = makeToolCallItem({
      id: 'file_change',
      threadId,
      turnId,
      callId: 'file_change_call',
      toolName: 'write',
      toolKind: 'file_change',
      arguments: {}
    })
    const h = harness()
    const round = input(completed(), { prepared: prepared({ history: [fileChange] }) })

    await expect(h.coordinator.resolve(round)).resolves.toBe('continue')
    expect(h.coordinator.hasEmptyPostToolRecovery(turnId)).toBe(true)
    expect(h.coordinator.emptyPostToolRecoverySteps(turnId)).toBe(1)
    await expect(h.coordinator.resolve(round)).resolves.toBe('continue')
    expect(h.coordinator.emptyPostToolRecoverySteps(turnId)).toBe(2)
    await expect(h.coordinator.resolve(round)).resolves.toBe('failed')
    expect(h.failures).toEqual([
      expect.objectContaining({ code: 'empty_post_tool_continuation' })
    ])
    expect(h.effects).toEqual(['event:error', 'item:error'])
  })

  it('bounds repeated goal replies and suppresses resume only without progress', async () => {
    const h = harness()
    const round = input(completed({ text: 'I am continuing the active goal.' }), {
      prepared: prepared({ activeGoalInstruction: 'Keep working.' })
    })

    for (let index = 0; index < 4; index += 1) {
      await expect(h.coordinator.resolve(round)).resolves.toBe('continue')
    }
    await expect(h.coordinator.resolve(round)).resolves.toBe('stop')
    expect(h.suppressGoalResume).toHaveBeenCalledWith(turnId)
    expect(h.effects.slice(-2)).toEqual(['item:error', 'event:error'])
    expect(h.coordinator.goalNoToolRecoverySteps(turnId)).toBe(0)
  })

  it('records output truncation before its visible error item', async () => {
    const h = harness()
    await expect(h.coordinator.resolve(input(completed({ stopReason: 'length' }))))
      .resolves.toBe('stop')
    expect(h.effects).toEqual(['event:error', 'item:error'])
    expect(h.eventDrafts[0]).toMatchObject({ code: 'output_truncated' })
  })

  it('clears no-tool recovery state before regular tool dispatch and includes interactive flags', async () => {
    const fileChange = makeToolCallItem({
      id: 'file_change',
      threadId,
      turnId,
      callId: 'file_change_call',
      toolName: 'write',
      toolKind: 'file_change',
      arguments: {}
    })
    const h = harness()
    await h.coordinator.resolve(input(completed(), {
      prepared: prepared({ history: [fileChange] })
    }))
    const call = {
      callId: 'call_read',
      toolName: 'read',
      toolKind: 'tool_call' as const,
      arguments: { path: 'a.ts' }
    }
    const outcome = await h.coordinator.resolve(input(completed({ toolCalls: [call] }), {
      prepared: prepared({ userInputDisabled: true }),
      turn: createTurnRecord({
        id: turnId,
        threadId,
        prompt: 'read',
        status: 'running',
        imContext: true
      })
    }))

    expect(outcome).toBe('continue')
    expect(h.coordinator.hasEmptyPostToolRecovery(turnId)).toBe(false)
    expect(h.dispatches[0]).toMatchObject({ userInputDisabled: true, imContext: true })
  })

  it('fails the SVG completion gate after the bounded recovery window', async () => {
    const h = harness()
    const svgState = svgArtifactCompletionState([], turnId)
    const round = input(completed(), {
      prepared: prepared({ dedicatedSvgTurn: true }),
      svgCompletion: svgState
    })

    await expect(h.coordinator.resolve(round)).resolves.toBe('continue')
    await expect(h.coordinator.resolve(round)).resolves.toBe('continue')
    await expect(h.coordinator.resolve(round)).resolves.toBe('failed')
    expect(h.failures).toEqual([expect.objectContaining({ code: 'svg_completion_gate_exhausted' })])
    expect(h.eventDrafts.map((event) => event.code)).toEqual([
      'required_svg_mutation_missing',
      'required_svg_mutation_missing',
      'svg_completion_gate_exhausted'
    ])
  })
})
