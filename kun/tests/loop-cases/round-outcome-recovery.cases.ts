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
import { OUTPUT_TRUNCATION_MAX_RECOVERY_STEPS } from '../../src/loop/continuation-instructions.js'
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

  it('continues truncated output within a bounded window before warning visibly', async () => {
    const h = harness()
    const round = input(completed({ stopReason: 'length' }))

    for (let step = 0; step < OUTPUT_TRUNCATION_MAX_RECOVERY_STEPS; step += 1) {
      await expect(h.coordinator.resolve(round)).resolves.toBe('continue')
    }
    await expect(h.coordinator.resolve(round)).resolves.toBe('stop')
    expect(h.eventDrafts.map((event) => event.code)).toEqual([
      'output_truncated_continuation',
      'output_truncated_continuation',
      'output_truncated_continuation',
      'output_truncated'
    ])
    expect(h.effects.slice(-2)).toEqual(['event:error', 'item:error'])
  })

  it('resets the truncation recovery window when the turn dispatches tools again', async () => {
    const h = harness()
    await expect(h.coordinator.resolve(input(completed({ stopReason: 'length' }))))
      .resolves.toBe('continue')
    expect(h.coordinator.outputTruncationRecoverySteps(turnId)).toBe(1)

    const call = {
      callId: 'call_read',
      toolName: 'read',
      toolKind: 'tool_call' as const,
      arguments: { path: 'a.ts' }
    }
    await expect(h.coordinator.resolve(input(completed({ toolCalls: [call] }))))
      .resolves.toBe('continue')
    expect(h.coordinator.outputTruncationRecoverySteps(turnId)).toBe(0)
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

  it('recovers the Chinese investigation status after ordinary tool failures', async () => {
    const h = harness()
    const failures = [
      failedToolResult('grep_page_context'),
      failedToolResult('grep_stream_manager'),
      failedToolResult('grep_context')
    ]
    const progress = input(completed({
      text: '我来调查页面上下文从前端到后端的完整链路。先定位关键符号。'
    }), {
      prepared: prepared({ history: failures })
    })

    await expect(h.coordinator.resolve(progress)).resolves.toBe('continue')
    expect(h.coordinator.postToolFailureRecoverySteps(turnId)).toBe(1)
    expect(h.eventDrafts.at(-1)).toMatchObject({
      code: 'post_tool_failure_continuation'
    })
  })

  it('forces a final-answer recovery round and then fails visibly when progress repeats', async () => {
    const h = harness()
    const failed = failedToolResult('bash')
    const progress = input(completed({ text: '我准备尝试其他命令' }), {
      prepared: prepared({ history: [failed] })
    })

    await expect(h.coordinator.resolve(progress)).resolves.toBe('continue')
    await expect(h.coordinator.resolve(progress)).resolves.toBe('continue')
    expect(h.coordinator.postToolFailureRecoverySteps(turnId)).toBe(2)
    await expect(h.coordinator.resolve(progress)).resolves.toBe('failed')
    expect(h.failures).toEqual([
      expect.objectContaining({ code: 'post_tool_failure_recovery_exhausted' })
    ])
    expect(h.effects).toEqual([
      'event:error',
      'event:error',
      'event:error',
      'item:error'
    ])
  })

  it('resets the recovery counter only after a successful ordinary tool result', async () => {
    const h = harness({ ordinaryResults: [{ output: { text: 'ok' }, isError: false }] })
    const failed = failedToolResult('read')
    const progress = input(completed({ text: 'Let me check the result' }), {
      prepared: prepared({ history: [failed] })
    })

    await expect(h.coordinator.resolve(progress)).resolves.toBe('continue')
    expect(h.coordinator.postToolFailureRecoverySteps(turnId)).toBe(1)

    const call = {
      callId: 'call_read_2',
      toolName: 'read',
      toolKind: 'tool_call' as const,
      arguments: { path: 'b.ts' }
    }
    await expect(h.coordinator.resolve(input(completed({ toolCalls: [call] }), {
      prepared: prepared({ history: [failed] })
    }))).resolves.toBe('continue')
    expect(h.coordinator.postToolFailureRecoverySteps(turnId)).toBe(0)
  })

  it('spends the final-answer recovery stage when the retry tool also fails', async () => {
    const h = harness({ ordinaryResults: [{ output: { error: 'retry failed' }, isError: true }] })
    const failed = failedToolResult('grep')
    const progress = input(completed({ text: '我来调查调用链。' }), {
      prepared: prepared({ history: [failed] })
    })
    await expect(h.coordinator.resolve(progress)).resolves.toBe('continue')
    const call = {
      callId: 'call_grep_retry',
      toolName: 'grep',
      toolKind: 'tool_call' as const,
      arguments: { pattern: 'needle' }
    }
    await expect(h.coordinator.resolve(input(completed({ toolCalls: [call] }), {
      prepared: prepared({ history: [failed] })
    }))).resolves.toBe('continue')
    expect(h.coordinator.postToolFailureRecoverySteps(turnId)).toBe(2)
    await expect(h.coordinator.resolve(progress)).resolves.toBe('failed')
    expect(h.failures.at(-1)).toMatchObject({ code: 'post_tool_failure_recovery_exhausted' })
  })

  it('accepts a clear final answer after a tool failure without recovery', async () => {
    const h = harness()
    const failed = failedToolResult('bash')
    const finalAnswer = input(completed({
      text: 'The command failed because the file is missing; the task cannot continue until you restore it.'
    }), {
      prepared: prepared({ history: [failed] })
    })

    await expect(h.coordinator.resolve(finalAnswer)).resolves.toBe('stop')
    expect(h.coordinator.postToolFailureRecoverySteps(turnId)).toBe(0)
    expect(h.effects).toEqual([])
  })

  it('does not recover when a user-directed question follows a tool failure', async () => {
    const h = harness()
    const failed = failedToolResult('bash')
    const question = input(completed({ text: '这个方案可以吗？需要你确认一下。' }), {
      prepared: prepared({ history: [failed] })
    })

    await expect(h.coordinator.resolve(question)).resolves.toBe('stop')
    expect(h.coordinator.postToolFailureRecoverySteps(turnId)).toBe(0)
  })

  it('ignores failed gated tools (create_plan) in the ordinary recovery window', async () => {
    const h = harness()
    const failed = failedToolResult(CREATE_PLAN_TOOL_NAME)
    const progress = input(completed({ text: 'I will continue without the plan tool.' }), {
      prepared: prepared({ history: [failed] })
    })

    await expect(h.coordinator.resolve(progress)).resolves.toBe('stop')
    expect(h.coordinator.postToolFailureRecoverySteps(turnId)).toBe(0)
  })

  it('does not enter ordinary recovery on plan or graph turns', async () => {
    const failed = failedToolResult('write')

    const planTurn = harness()
    await expect(planTurn.coordinator.resolve(input(completed({ text: '接下来我会完善方案' }), {
      prepared: prepared({ history: [failed], planTurnActive: true })
    }))).resolves.toBe('stop')
    expect(planTurn.coordinator.postToolFailureRecoverySteps(turnId)).toBe(0)

    const graphTurn = harness()
    await expect(graphTurn.coordinator.resolve(input(completed({ text: '接下来我会继续' }), {
      prepared: prepared({ history: [failed], orchestration: 'graph' })
    }))).resolves.toBe('stop')
    expect(graphTurn.coordinator.postToolFailureRecoverySteps(turnId)).toBe(0)
  })

  it('does not recover after a successful tool result', async () => {
    const h = harness()
    const succeeded = makeToolResultItem({
      id: 'item_read_ok',
      threadId,
      turnId,
      callId: 'call_read_ok',
      toolName: 'read',
      output: { text: 'ok' },
      isError: false
    })
    const progress = input(completed({ text: '接下来我会继续' }), {
      prepared: prepared({ history: [succeeded] })
    })

    await expect(h.coordinator.resolve(progress)).resolves.toBe('stop')
    expect(h.coordinator.postToolFailureRecoverySteps(turnId)).toBe(0)
  })

  it('clears post-tool-failure recovery state with clearTurn', async () => {
    const h = harness()
    const failed = failedToolResult('read')
    await h.coordinator.resolve(input(completed({ text: '接下来我会继续' }), {
      prepared: prepared({ history: [failed] })
    }))
    expect(h.coordinator.postToolFailureRecoverySteps(turnId)).toBe(1)
    h.coordinator.clearTurn(turnId)
    expect(h.coordinator.postToolFailureRecoverySteps(turnId)).toBe(0)
  })
})
