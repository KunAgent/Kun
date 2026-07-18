import { describe, expect, it, vi } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { makeToolCallItem } from '../domain/item.js'
import { createTurnRecord } from '../domain/turn.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import { CREATE_PLAN_TOOL_NAME } from '../adapters/tool/create-plan-tool.js'
import type { ModelRoundStreamResult } from './model-round-engine.js'
import {
  RoundOutcomeCoordinator,
  type RoundOutcomeInput
} from './round-outcome-coordinator.js'
import { svgArtifactCompletionState } from './svg-artifact-completion.js'
import type { PreparedTurnContext, ToolDispatchInput } from './turn-execution-types.js'

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
    model: 'test-model',
    mode: 'agent',
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

function harness(options: { madeProgress?: boolean; latestItems?: TurnItem[] } = {}) {
  const effects: string[] = []
  const items: TurnItem[] = []
  const eventDrafts: Array<{ kind?: string; code?: string }> = []
  const dispatches: ToolDispatchInput[] = []
  const failures: unknown[] = []
  const suppressGoalResume = vi.fn()
  const dispatchToolCalls = vi.fn(async (input: ToolDispatchInput) => {
    effects.push('dispatch')
    dispatches.push(input)
    return 'continue' as const
  })
  const turns = {
    applyItem: vi.fn(async (_threadId: string, item: TurnItem) => {
      effects.push(`item:${item.kind}`)
      items.push(item)
    })
  } as Pick<TurnService, 'applyItem'>
  const events = {
    record: vi.fn(async (draft: { kind?: string; code?: string }) => {
      effects.push(`event:${draft.kind}`)
      eventDrafts.push(draft)
      return draft
    })
  } as unknown as Pick<RuntimeEventRecorder, 'record'>
  const coordinator = new RoundOutcomeCoordinator({
    sessionStore: { loadItems: async () => options.latestItems ?? [] },
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
      requiredToolName: CREATE_PLAN_TOOL_NAME,
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
