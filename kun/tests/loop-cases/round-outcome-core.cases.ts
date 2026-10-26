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
import {
  completed,
  failedToolResult,
  harness,
  input,
  prepared,
  threadId,
  turnId
} from './round-outcome-support.cases.js'

describe('RoundOutcomeCoordinator', () => {
  it('passes aborted and failed stream outcomes through without dispatching', async () => {
    const h = harness()
    await expect(h.coordinator.resolve(input({ kind: 'aborted' }))).resolves.toBe('aborted')
    await expect(h.coordinator.resolve(input({ kind: 'failed' }))).resolves.toBe('failed')
    expect(h.dispatchToolCalls).not.toHaveBeenCalled()
    expect(h.effects).toEqual([])
  })

  it('continues after the first all-suppressed round and keeps the budget after a different tool executes', async () => {
    const h = harness({ dispatchOutcomes: ['all_suppressed', 'continue'] })
    const repeatedCall = {
      callId: 'call_repeated',
      toolName: 'read',
      arguments: { path: 'same.ts' }
    }
    const alternateCall = {
      callId: 'call_alternate',
      toolName: 'grep',
      arguments: { pattern: 'different' }
    }

    await expect(h.coordinator.resolve(input(completed({ toolCalls: [repeatedCall] }))))
      .resolves.toBe('continue')
    expect(h.coordinator.toolSuppressionRecoverySteps(turnId)).toBe(1)

    await expect(h.coordinator.resolve(input(completed({ toolCalls: [alternateCall] }))))
      .resolves.toBe('continue')
    expect(h.coordinator.toolSuppressionRecoverySteps(turnId)).toBe(1)
  })

  it('terminates an active goal on the tools-disabled suppression final answer', async () => {
    const h = harness({ dispatchOutcomes: ['all_suppressed', 'all_suppressed'] })
    const repeatedCall = {
      callId: 'call_repeated',
      toolName: 'read',
      arguments: { path: 'same.ts' }
    }

    await h.coordinator.resolve(input(completed({ toolCalls: [repeatedCall] })))
    await h.coordinator.resolve(input(completed({
      toolCalls: [{ ...repeatedCall, callId: 'call_repeated_again' }]
    })))
    expect(h.coordinator.toolSuppressionRecoverySteps(turnId)).toBe(2)

    await expect(h.coordinator.resolve(input(completed({ text: 'Here is the final answer.' }), {
      toolCallsDisabled: true,
      prepared: prepared({ activeGoalInstruction: 'Continue the active goal.' })
    })))
      .resolves.toBe('stop')
    expect(h.coordinator.toolSuppressionRecoverySteps(turnId)).toBe(0)
    expect(h.failures).toEqual([])
    expect(h.suppressGoalResume).toHaveBeenCalledWith(turnId)
  })

  it('fails with tool_loop_suppressed when final-answer recovery is still empty', async () => {
    const h = harness({ dispatchOutcomes: ['all_suppressed', 'all_suppressed'] })
    const repeatedCall = {
      callId: 'call_repeated',
      toolName: 'read',
      arguments: { path: 'same.ts' }
    }

    await h.coordinator.resolve(input(completed({ toolCalls: [repeatedCall] })))
    await h.coordinator.resolve(input(completed({
      toolCalls: [{ ...repeatedCall, callId: 'call_repeated_again' }]
    })))

    await expect(h.coordinator.resolve(input(completed())))
      .resolves.toBe('failed')
    expect(h.failures).toEqual([
      expect.objectContaining({ code: 'tool_loop_suppressed' })
    ])
    expect(h.eventDrafts).toContainEqual(
      expect.objectContaining({ kind: 'error', code: 'tool_loop_suppressed' })
    )
    expect(h.items).toContainEqual(
      expect.objectContaining({ kind: 'error', code: 'tool_loop_suppressed' })
    )
    expect(h.suppressGoalResume).toHaveBeenCalledWith(turnId)
  })

  it('suppresses provider-emitted tool calls during final-answer recovery', async () => {
    const h = harness({ dispatchOutcomes: ['all_suppressed', 'all_suppressed'] })
    const repeatedCall = {
      callId: 'call_repeated',
      toolName: 'read',
      arguments: { path: 'same.ts' }
    }

    await h.coordinator.resolve(input(completed({ toolCalls: [repeatedCall] })))
    await h.coordinator.resolve(input(completed({
      toolCalls: [{ ...repeatedCall, callId: 'call_repeated_again' }]
    })))
    await expect(h.coordinator.resolve(input(completed({
      toolCalls: [{ ...repeatedCall, callId: 'call_provider_violation' }]
    }), { toolCallsDisabled: true }))).resolves.toBe('failed')

    expect(h.suppressToolCalls).toHaveBeenCalledTimes(1)
    expect(h.dispatchToolCalls).toHaveBeenCalledTimes(2)
    expect(h.failures).toEqual([
      expect.objectContaining({ code: 'tool_loop_suppressed' })
    ])
  })

  it('keeps hard required-tool recovery authoritative and clears suppression state at terminal cleanup', async () => {
    const h = harness({ dispatchOutcomes: ['all_suppressed', 'all_suppressed'] })
    const requiredCall = {
      callId: 'call_required',
      toolName: 'required_tool',
      arguments: {}
    }
    const round = (callId: string) => input(completed({
      toolCalls: [{ ...requiredCall, callId }]
    }), { requiredToolName: 'required_tool' })

    await expect(h.coordinator.resolve(round('call_required_1'))).resolves.toBe('continue')
    await expect(h.coordinator.resolve(round('call_required_2'))).resolves.toBe('continue')
    await expect(h.coordinator.resolve(input(completed(), {
      requiredToolName: 'required_tool'
    }))).resolves.toBe('failed')

    expect(h.failures.at(-1)).toMatchObject({ code: 'required_tool_missing' })
    h.coordinator.clearTurn(turnId)
    expect(h.coordinator.toolSuppressionRecoverySteps(turnId)).toBe(0)
  })

  it('leaves dedicated SVG suppression under the SVG completion gate', async () => {
    const h = harness({ dispatchOutcomes: ['all_suppressed'] })
    const svgState = svgArtifactCompletionState([], turnId)

    await expect(h.coordinator.resolve(input(completed({
      toolCalls: [{
        callId: 'call_svg_edit',
        toolName: 'design_svg_edit',
        arguments: { operations: [] }
      }]
    }), {
      prepared: prepared({ dedicatedSvgTurn: true }),
      svgCompletion: svgState
    }))).resolves.toBe('continue')

    expect(h.coordinator.toolSuppressionRecoverySteps(turnId)).toBe(0)
    expect(h.eventDrafts.at(-1)).toMatchObject({ code: 'required_svg_mutation_missing' })
  })

  it('leaves required Graph creation suppression under the Graph gate', async () => {
    const h = harness({ dispatchOutcomes: ['all_suppressed'] })

    await expect(h.coordinator.resolve(input(completed({
      toolCalls: [{
        callId: 'call_graph_create',
        toolName: GRAPH_CREATE_RUN_TOOL_NAME,
        arguments: {}
      }]
    }), {
      requiredToolName: GRAPH_CREATE_RUN_TOOL_NAME,
      prepared: prepared({ orchestration: 'graph' })
    }))).resolves.toBe('failed')

    expect(h.coordinator.toolSuppressionRecoverySteps(turnId)).toBe(0)
    expect(h.failures.at(-1)).toMatchObject({ code: 'graph_create_run_failed' })
  })

  it('ends a plan turn on prose without writing it through create_plan', async () => {
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
      prepared: prepared({
        mode: 'plan',
        planTurnActive: true,
        activePlanContext: planContext
      }),
      toolProviderMetadata: new Map([[
        CREATE_PLAN_TOOL_NAME,
        { providerId: 'provider_tool', providerKind: 'built-in' }
      ]]),
      toolKinds: new Map([[CREATE_PLAN_TOOL_NAME, 'file_change']]),
      toolProviderKinds: new Map([[CREATE_PLAN_TOOL_NAME, 'built-in']])
    }))

    expect(outcome).toBe('stop')
    expect(h.effects).toEqual([])
    expect(h.dispatches).toEqual([])
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
})
