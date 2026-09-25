import { describe, expect, it, vi } from 'vitest'
import type { TurnItem } from '../../src/contracts/items.js'
import { makeToolCallItem, makeToolResultItem } from '../../src/domain/item.js'
import { createTurnRecord } from '../../src/domain/turn.js'
import { SequentialIdGenerator } from '../../src/ports/id-generator.js'
import type { ToolHostContext } from '../../src/ports/tool-host.js'
import type { RuntimeEventRecorder } from '../../src/services/runtime-event-recorder.js'
import type { TurnService } from '../../src/services/turn-service.js'
import { CREATE_PLAN_TOOL_NAME } from '../../src/adapters/tool/create-plan-tool.js'
import { GRAPH_DEFINE_PLAN_TOOL_NAME } from '../../src/adapters/tool/graph-define-plan-tool.js'
import type { ModelRoundStreamResult } from '../../src/loop/model-round-engine.js'
import {
  GRAPH_CREATE_RUN_TOOL_NAME,
  MAX_GRAPH_CREATE_RUN_RECOVERY_STEPS,
  RoundOutcomeCoordinator,
  type RoundOutcomeInput
} from '../../src/loop/round-outcome-coordinator.js'
import { svgArtifactCompletionState } from '../../src/loop/svg-artifact-completion.js'
import type {
  PreparedTurnContext,
  ToolDispatchInput,
  ToolDispatchOutcome
} from '../../src/loop/turn-execution-types.js'

export const threadId = 'thread_round_outcome'
export const turnId = 'turn_round_outcome'

export function completed(input: {
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

export function prepared(overrides: Partial<PreparedTurnContext> = {}): PreparedTurnContext {
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
    memoryDirectives: [],
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

export function failedToolResult(toolName: string): TurnItem {
  return makeToolResultItem({
    id: `item_${toolName}_result`,
    threadId,
    turnId,
    callId: `call_${toolName}`,
    toolName,
    output: { error: 'simulated failure' },
    isError: true
  })
}

export function harness(options: {
  madeProgress?: boolean
  latestItems?: TurnItem[]
  graphResults?: Array<{ output: unknown; isError: boolean }>
  ordinaryResults?: Array<{ output: unknown; isError: boolean }>
  dispatchOutcomes?: ToolDispatchOutcome[]
} = {}) {
  const effects: string[] = []
  const items: TurnItem[] = []
  const sessionItems = [...(options.latestItems ?? [])]
  const graphResults = [...(options.graphResults ?? [])]
  const ordinaryResults = [...(options.ordinaryResults ?? [])]
  const dispatchOutcomes = [...(options.dispatchOutcomes ?? [])]
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
  const dispatchToolCalls = vi.fn(async (input: ToolDispatchInput) => {
    effects.push('dispatch')
    dispatches.push(input)
    for (const call of input.calls) {
      const result = (
        call.toolName === GRAPH_CREATE_RUN_TOOL_NAME ||
        call.toolName === GRAPH_DEFINE_PLAN_TOOL_NAME
      ) ? graphResults.shift() : ordinaryResults.shift()
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
    return dispatchOutcomes.shift() ?? 'continue'
  })
  const suppressToolCalls = vi.fn(async () => undefined)
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
    suppressToolCalls,
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
    dispatchToolCalls,
    suppressToolCalls
  }
}

export function input(
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
