import type { Turn } from '../contracts/turns.js'
import type { ToolResultTurnItem } from '../contracts/items.js'
import { GraphPlanningDraftV1Schema } from '../contracts/graph-planning.js'
import { makeErrorItem, makeToolCallItem } from '../domain/item.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ToolCallLike, ToolProviderKind } from '../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import { CREATE_PLAN_TOOL_NAME } from '../adapters/tool/create-plan-tool.js'
import { GRAPH_DEFINE_PLAN_TOOL_NAME } from '../adapters/tool/graph-define-plan-tool.js'
import {
  DESIGN_SVG_ANIMATE_TOOL_NAME,
  DESIGN_SVG_EDIT_TOOL_NAME,
  DESIGN_SVG_VALIDATE_TOOL_NAME
} from '../adapters/tool/design-svg-tool.js'
import {
  EMPTY_POST_TOOL_MAX_RECOVERY_STEPS,
  GOAL_NO_TOOL_REPEAT_MAX_RECOVERY_STEPS,
  isRepeatedNoToolAssistantText,
  latestUserMessageText
} from './continuation-instructions.js'
import type { ModelRoundStreamResult } from './model-round-engine.js'
import { isPlanClarifyingQuestion } from './plan-mode.js'
import {
  svgArtifactCompletionState,
  type SvgArtifactCompletionState
} from './svg-artifact-completion.js'
import type {
  ModelRoundOutcome,
  PreparedTurnContext,
  ToolDispatchInput,
  ToolDispatchOutcome,
  TurnExecutionFailure
} from './turn-execution-types.js'

const MAX_SVG_COMPLETION_RECOVERY_STEPS = 3
/** Extra model rounds allowed after a tool-storm all_suppressed outcome (#1081). */
export const MAX_TOOL_STORM_RECOVERY_ROUNDS = 1
export const TOOL_STORM_NO_FINAL_RESPONSE_CODE = 'tool_storm_no_final_response'
export const GRAPH_CREATE_RUN_TOOL_NAME = 'graph_create_run'
export const MAX_GRAPH_CREATE_RUN_ATTEMPTS = 3
/** @deprecated Use MAX_GRAPH_CREATE_RUN_ATTEMPTS for the total request cap. */
export const MAX_GRAPH_CREATE_RUN_RECOVERY_STEPS = MAX_GRAPH_CREATE_RUN_ATTEMPTS - 1

export type GraphCreateRunRecoveryReason = 'missing' | 'invalid' | 'mismatch'

type GraphCreateRunRecoveryState = Readonly<{
  steps: number
  reason: GraphCreateRunRecoveryReason
}>

export type RoundToolProviderMetadata = Readonly<{
  providerId?: string
  providerKind?: ToolProviderKind
}>

export type RoundOutcomeInput = Readonly<{
  threadId: string
  turnId: string
  streamed: ModelRoundStreamResult
  /** Hard transport and dispatch constraint from ModelRequest. */
  requiredToolName?: string
  /** Soft workflow completion expectation (currently Plan create_plan). */
  softRequiredToolName?: string
  turn: Turn
  prepared: PreparedTurnContext
  modelProviderId?: string
  modelReasoningEffort?: string
  sourceResultBudgetTokens?: number
  toolProviderMetadata: ReadonlyMap<string, RoundToolProviderMetadata>
  toolKinds: ReadonlyMap<string, ToolCallLike['toolKind'] | undefined>
  toolProviderKinds: ReadonlyMap<string, ToolProviderKind | undefined>
  svgCompletion: SvgArtifactCompletionState | null
}>

export type RoundOutcomeCoordinatorDeps = {
  sessionStore: Pick<SessionStore, 'loadItems'>
  turns: Pick<TurnService, 'applyItem' | 'updateItem' | 'getTurn' | 'updateTurnMetadata'>
  events: Pick<RuntimeEventRecorder, 'record'>
  ids: Pick<IdGenerator, 'next'>
  dispatchToolCalls: (input: ToolDispatchInput) => Promise<ToolDispatchOutcome>
  rememberFailure: (turnId: string, failure: TurnExecutionFailure) => void
  hasTurnMadeProgress: (turnId: string) => boolean
  suppressGoalResume: (turnId: string) => void
}

/**
 * Converts one completed model stream into the next loop action. It owns the
 * bounded post-stream recovery windows, but not request construction, model
 * streaming, tool execution, or terminal turn settlement.
 */
export class RoundOutcomeCoordinator {
  private readonly lastNoToolTextByTurn = new Map<string, string>()
  private readonly goalNoToolRecoveryStepsByTurn = new Map<string, number>()
  private readonly emptyPostToolRecoveryStepsByTurn = new Map<string, number>()
  private readonly svgCompletionRecoveryStepsByTurn = new Map<string, number>()
  private readonly graphCreateRunRecoveryByTurn = new Map<string, GraphCreateRunRecoveryState>()
  private readonly graphPlanNoToolRecoveryByTurn = new Map<string, number>()
  /** Recovery model rounds issued after all_suppressed in this turn (#1081). */
  private readonly toolStormRecoveryRoundsByTurn = new Map<string, number>()

  constructor(private readonly deps: RoundOutcomeCoordinatorDeps) {}

  goalNoToolRecoverySteps(turnId: string): number {
    return this.goalNoToolRecoveryStepsByTurn.get(turnId) ?? 0
  }

  hasEmptyPostToolRecovery(turnId: string): boolean {
    return (this.emptyPostToolRecoveryStepsByTurn.get(turnId) ?? 0) > 0
  }

  emptyPostToolRecoverySteps(turnId: string): number {
    return this.emptyPostToolRecoveryStepsByTurn.get(turnId) ?? 0
  }

  toolStormRecoveryRounds(turnId: string): number {
    return this.toolStormRecoveryRoundsByTurn.get(turnId) ?? 0
  }

  graphCreateRunRecoverySteps(turnId: string): number {
    return this.graphCreateRunRecoveryByTurn.get(turnId)?.steps ?? 0
  }

  graphCreateRunRecoveryReason(turnId: string): GraphCreateRunRecoveryReason | undefined {
    return this.graphCreateRunRecoveryByTurn.get(turnId)?.reason
  }

  graphPlanNoToolRecoverySteps(turnId: string): number {
    return this.graphPlanNoToolRecoveryByTurn.get(turnId) ?? 0
  }

  clearTurn(turnId: string): void {
    this.lastNoToolTextByTurn.delete(turnId)
    this.goalNoToolRecoveryStepsByTurn.delete(turnId)
    this.emptyPostToolRecoveryStepsByTurn.delete(turnId)
    this.svgCompletionRecoveryStepsByTurn.delete(turnId)
    this.graphCreateRunRecoveryByTurn.delete(turnId)
    this.graphPlanNoToolRecoveryByTurn.delete(turnId)
    this.toolStormRecoveryRoundsByTurn.delete(turnId)
  }

  async resolve(input: RoundOutcomeInput): Promise<ModelRoundOutcome> {
    if (input.streamed.kind === 'aborted') return 'aborted'
    if (input.streamed.kind === 'failed') return 'failed'

    const streamSnapshot = input.streamed.snapshot
    const completedToolCalls = [...streamSnapshot.toolCalls]
    if (completedToolCalls.length === 0) {
      if (input.requiredToolName) {
        return this.resolveMissingRequiredTool(input)
      }
      if (input.svgCompletion && !input.svgCompletion.validationAfterMutation) {
        return this.recoverRequiredSvgCompletion(input, input.svgCompletion)
      }
      if (input.softRequiredToolName) {
        return this.resolveMissingSoftRequiredTool(input, streamSnapshot.text)
      }
      const assistantText = streamSnapshot.text.trim()
      // After a tool-storm recovery round, an empty stop is a failed turn (#1081).
      if (
        streamSnapshot.stopReason === 'stop' &&
        !assistantText &&
        (this.toolStormRecoveryRoundsByTurn.get(input.turnId) ?? 0) > 0
      ) {
        return this.failToolStormNoFinalResponse(
          input,
          'Tool-loop recovery ended without a final assistant response after repeated tool calls were suppressed.'
        )
      }
      if (assistantText) {
        // A non-empty final answer closes the storm recovery window.
        this.toolStormRecoveryRoundsByTurn.delete(input.turnId)
      }
      const hasCurrentTurnFileChange = input.prepared.history.some(
        (item) =>
          item.turnId === input.turnId &&
          item.kind === 'tool_call' &&
          item.toolKind === 'file_change' &&
          item.toolName !== CREATE_PLAN_TOOL_NAME
      )
      if (
        streamSnapshot.stopReason === 'stop' &&
        !assistantText &&
        hasCurrentTurnFileChange
      ) {
        return this.resolveEmptyPostToolResponse(input)
      }
      if (streamSnapshot.stopReason === 'stop' && input.prepared.activeGoalInstruction) {
        return this.resolveGoalNoToolResponse(input, streamSnapshot.text)
      }
      if (streamSnapshot.stopReason === 'length') {
        await this.recordOutputTruncated(input)
        return 'stop'
      }
      return 'stop'
    }

    // Tool calls mean the turn is making progress again; reset the no-tool
    // repetition window so unrelated later status texts are not compared.
    this.lastNoToolTextByTurn.delete(input.turnId)
    this.goalNoToolRecoveryStepsByTurn.delete(input.turnId)
    this.emptyPostToolRecoveryStepsByTurn.delete(input.turnId)
    const dispatchableToolCalls = await this.suppressMismatchedRequiredToolCalls(
      input,
      completedToolCalls
    )
    if (input.requiredToolName && dispatchableToolCalls.length === 0) {
      if (input.requiredToolName === GRAPH_CREATE_RUN_TOOL_NAME) {
        return this.advanceGraphCreateRunRecovery(input, 'mismatch')
      }
      return this.failHardRequiredTool(input, 'required_tool_mismatch', [
        `Model called a tool other than the required \`${input.requiredToolName}\`.`,
        'The mismatched call was suppressed and was not executed.'
      ].join(' '))
    }
    const dispatched = await this.deps.dispatchToolCalls(
      this.toolDispatchInput(input, dispatchableToolCalls, true)
    )
    if (dispatched === 'aborted') return 'aborted'
    if (dispatched === 'budget_exhausted') return 'failed'
    const graphCreateCalls = dispatchableToolCalls.filter(
      (call) => call.toolName === GRAPH_CREATE_RUN_TOOL_NAME
    )
    if (input.requiredToolName === GRAPH_CREATE_RUN_TOOL_NAME && graphCreateCalls.length > 0) {
      return this.resolveDispatchedGraphCreate(input, graphCreateCalls)
    }
    const graphDefineCalls = dispatchableToolCalls.filter(
      (call) => call.toolName === GRAPH_DEFINE_PLAN_TOOL_NAME
    )
    if (graphDefineCalls.length > 0) {
      const callIds = new Set(graphDefineCalls.map((call) => call.callId))
      const latestItems = await this.deps.sessionStore.loadItems(input.threadId)
      const results = latestItems.filter((item): item is ToolResultTurnItem =>
        item.turnId === input.turnId &&
        item.kind === 'tool_result' &&
        item.toolName === GRAPH_DEFINE_PLAN_TOOL_NAME &&
        callIds.has(item.callId))
      const latestDraft = results
        .flatMap((result) => {
          if (!result.output || typeof result.output !== 'object') return []
          const parsed = GraphPlanningDraftV1Schema.safeParse(
            (result.output as Record<string, unknown>).draft
          )
          return parsed.success ? [parsed.data] : []
        })
        .sort((left, right) => right.revision - left.revision)[0]
      if (latestDraft) {
        await this.deps.turns.updateTurnMetadata(input.threadId, input.turnId, {
          graphPlanningLifecycle: {
            version: 1,
            draftId: latestDraft.id,
            reservedRunId: latestDraft.reservedRunId,
            state: latestDraft.status,
            draftRevision: latestDraft.revision
          }
        })
      }
      const paused = results.some((result) => {
        const output = result.output
        if (!output || typeof output !== 'object') return false
        const record = output as Record<string, unknown>
        const draft = record.draft
        const state = draft && typeof draft === 'object'
          ? (draft as Record<string, unknown>).status
          : undefined
        return record.retryable === false && state === 'needs_correction'
      })
      if (paused) return 'stop'
      const hostError = results.find((result) => {
        if (!result.output || typeof result.output !== 'object') return false
        const output = result.output as Record<string, unknown>
        const draft = output.draft
        const state = draft && typeof draft === 'object'
          ? (draft as Record<string, unknown>).status
          : undefined
        return output.code === 'graph_planning_host_error' || state === 'host_error'
      })
      if (hostError) {
        const output = hostError.output as Record<string, unknown>
        const message = typeof output.error === 'string'
          ? output.error
          : 'Graph planning stopped because the host could not persist or commit the draft.'
        this.deps.rememberFailure(input.turnId, {
          error: message,
          code: 'graph_planning_host_error',
          details: output,
          severity: 'error'
        })
        return 'failed'
      }
      if (results.some((result) => result.isError !== true)) {
        this.graphPlanNoToolRecoveryByTurn.delete(input.turnId)
      }
    }
    if (dispatched === 'all_suppressed') {
      return this.resolveAllSuppressed(input)
    }
    // At least one tool executed: storm recovery is no longer pending.
    this.toolStormRecoveryRoundsByTurn.delete(input.turnId)
    if (input.prepared.dedicatedSvgTurn && completedToolCalls.some((call) =>
      call.toolName === DESIGN_SVG_EDIT_TOOL_NAME ||
      call.toolName === DESIGN_SVG_ANIMATE_TOOL_NAME ||
      call.toolName === DESIGN_SVG_VALIDATE_TOOL_NAME
    )) {
      const latestItems = await this.deps.sessionStore.loadItems(input.threadId)
      const latestCompletion = svgArtifactCompletionState(latestItems, input.turnId)
      const progressed =
        latestCompletion.mutationRevision !== input.svgCompletion?.mutationRevision ||
        (!input.svgCompletion?.validationAfterMutation && latestCompletion.validationAfterMutation)
      if (!progressed) {
        return this.recoverRequiredSvgCompletion(input, latestCompletion)
      }
      this.svgCompletionRecoveryStepsByTurn.delete(input.turnId)
    }
    return 'continue'
  }

  /**
   * After every tool call in a step is storm-suppressed, allow a bounded
   * recovery model round so the model can answer without tools. Empty stop or
   * further all_suppressed after the budget fails the turn (#1081).
   */
  private async resolveAllSuppressed(input: RoundOutcomeInput): Promise<ModelRoundOutcome> {
    // Dedicated SVG workflow owns its own terminal: a completed mutation + later
    // validation is already a valid tool terminal and must stop without the
    // generic storm-recovery / tool_storm_no_final_response path (#1081).
    if (input.prepared.dedicatedSvgTurn) {
      const latestItems = await this.deps.sessionStore.loadItems(input.threadId)
      const latestCompletion = svgArtifactCompletionState(latestItems, input.turnId)
      if (!latestCompletion.validationAfterMutation) {
        return this.recoverRequiredSvgCompletion(input, latestCompletion)
      }
      return 'stop'
    }
    const recoveryRounds = this.toolStormRecoveryRoundsByTurn.get(input.turnId) ?? 0
    if (recoveryRounds < MAX_TOOL_STORM_RECOVERY_ROUNDS) {
      this.toolStormRecoveryRoundsByTurn.set(input.turnId, recoveryRounds + 1)
      return 'continue'
    }
    return this.failToolStormNoFinalResponse(
      input,
      'Repeated identical tool calls were suppressed and the model did not produce a final response after recovery.'
    )
  }

  private async failToolStormNoFinalResponse(
    input: RoundOutcomeInput,
    message: string
  ): Promise<ModelRoundOutcome> {
    this.deps.rememberFailure(input.turnId, {
      error: message,
      code: TOOL_STORM_NO_FINAL_RESPONSE_CODE,
      severity: 'error'
    })
    await this.deps.events.record({
      kind: 'error',
      threadId: input.threadId,
      turnId: input.turnId,
      message,
      code: TOOL_STORM_NO_FINAL_RESPONSE_CODE,
      severity: 'error'
    })
    await this.deps.turns.applyItem(
      input.threadId,
      makeErrorItem({
        id: this.deps.ids.next('item_error'),
        turnId: input.turnId,
        threadId: input.threadId,
        message,
        code: TOOL_STORM_NO_FINAL_RESPONSE_CODE,
        severity: 'error'
      })
    )
    return 'failed'
  }

  private async resolveMissingSoftRequiredTool(
    input: RoundOutcomeInput,
    assistantText: string
  ): Promise<ModelRoundOutcome> {
    if (input.softRequiredToolName === GRAPH_DEFINE_PLAN_TOOL_NAME) {
      if (assistantText.trim() && isPlanClarifyingQuestion(assistantText)) return 'stop'
      const attempts = this.graphPlanNoToolRecoveryByTurn.get(input.turnId) ?? 0
      if (attempts === 0) {
        this.graphPlanNoToolRecoveryByTurn.set(input.turnId, 1)
        return 'continue'
      }
      return 'stop'
    }
    if (input.softRequiredToolName === CREATE_PLAN_TOOL_NAME && assistantText.trim()) {
      // Ambiguous plan requests may legitimately require a user clarification;
      // do not turn that question into a bogus plan artifact.
      if (isPlanClarifyingQuestion(assistantText)) return 'stop'

      const callId = this.deps.ids.next('call_plan')
      const provider = input.toolProviderMetadata.get(CREATE_PLAN_TOOL_NAME)
      const toolKind = input.toolKinds.get(CREATE_PLAN_TOOL_NAME)
      const activePlanContext = input.prepared.activePlanContext
      const sourceRequest = activePlanContext?.sourceRequest ||
        latestUserMessageText(input.prepared.history, input.turnId) ||
        input.turn.prompt ||
        ''
      const argumentsForFallback: Record<string, unknown> = activePlanContext
        ? {
            markdown: assistantText.trim(),
            operation: activePlanContext.operation,
            plan_id: activePlanContext.planId,
            plan_relative_path: activePlanContext.relativePath,
            ...(sourceRequest ? { source_request: sourceRequest } : {}),
            ...(activePlanContext.title ? { title: activePlanContext.title } : {})
          }
        : {
            markdown: assistantText.trim(),
            operation: 'draft',
            ...(sourceRequest ? { source_request: sourceRequest } : {})
          }
      const call: ToolCallLike = {
        callId,
        toolName: CREATE_PLAN_TOOL_NAME,
        ...(provider?.providerId ? { providerId: provider.providerId } : {}),
        toolKind,
        arguments: argumentsForFallback
      }
      const itemId = `item_tool_${input.turnId}_${callId}`
      await this.deps.turns.applyItem(
        input.threadId,
        makeToolCallItem({
          id: itemId,
          turnId: input.turnId,
          threadId: input.threadId,
          callId,
          toolName: CREATE_PLAN_TOOL_NAME,
          toolKind,
          arguments: argumentsForFallback,
          summary: 'Materialized assistant plan text into the required Kun plan.'
        })
      )
      await this.deps.events.record({
        kind: 'tool_call_ready',
        threadId: input.threadId,
        turnId: input.turnId,
        itemId,
        callId,
        toolName: CREATE_PLAN_TOOL_NAME,
        readyCount: 1
      })
      const dispatched = await this.deps.dispatchToolCalls(
        this.toolDispatchInput(input, [call], false)
      )
      if (dispatched === 'aborted') return 'aborted'
      if (dispatched === 'budget_exhausted') return 'failed'
      if (dispatched === 'all_suppressed') return this.resolveAllSuppressed(input)
      return 'continue'
    }

    const message = `Model did not call the expected \`${input.softRequiredToolName}\` tool for this Plan-mode turn.`
    await this.deps.events.record({
      kind: 'error',
      threadId: input.threadId,
      turnId: input.turnId,
      message,
      code: 'required_tool_missing'
    })
    await this.deps.turns.applyItem(
      input.threadId,
      makeErrorItem({
        id: this.deps.ids.next('item_error'),
        turnId: input.turnId,
        threadId: input.threadId,
        message,
        code: 'required_tool_missing'
      })
    )
    return 'failed'
  }

  private async resolveMissingRequiredTool(input: RoundOutcomeInput): Promise<ModelRoundOutcome> {
    if (input.requiredToolName === GRAPH_CREATE_RUN_TOOL_NAME) {
      return this.advanceGraphCreateRunRecovery(input, 'missing')
    }
    return this.failHardRequiredTool(
      input,
      'required_tool_missing',
      `Model did not call the required \`${input.requiredToolName}\` tool.`
    )
  }

  private async resolveDispatchedGraphCreate(
    input: RoundOutcomeInput,
    calls: readonly ToolCallLike[]
  ): Promise<ModelRoundOutcome> {
    const callIds = new Set(calls.map((call) => call.callId))
    const latestItems = await this.deps.sessionStore.loadItems(input.threadId)
    const results = latestItems.filter((item): item is ToolResultTurnItem =>
      item.turnId === input.turnId &&
      item.kind === 'tool_result' &&
      item.toolName === GRAPH_CREATE_RUN_TOOL_NAME &&
      callIds.has(item.callId))
    if (results.some((result) => result.isError !== true)) {
      this.graphCreateRunRecoveryByTurn.delete(input.turnId)
      const gate = await this.graphGate(input)
      await this.recordGraphGate(input, {
        attempt: gate?.attempt ?? 1,
        phase: 'succeeded'
      })
      await this.deps.turns.updateTurnMetadata(input.threadId, input.turnId, {
        requiredToolGate: null
      })
      return 'continue'
    }

    const retryable = results.length > 0 && results.every((result) =>
      graphCreateRunResultRetryable(result.output))
    if (retryable) {
      return this.advanceGraphCreateRunRecovery(
        input,
        'invalid',
        graphCreateRunValidationSummary(results[0]?.output)
      )
    }

    const firstFailure = results[0]?.output
    return this.failGraphCreateRun(
      input,
      'graph_create_run_failed',
      graphCreateRunFailureMessage(firstFailure),
      firstFailure
    )
  }

  private async advanceGraphCreateRunRecovery(
    input: RoundOutcomeInput,
    reason: GraphCreateRunRecoveryReason,
    failureSummary?: string
  ): Promise<ModelRoundOutcome> {
    const gate = await this.graphGate(input)
    const completedAttempt = gate?.attempt ?? Math.max(1, this.graphCreateRunRecoverySteps(input.turnId) + 1)
    const lastError = graphGateFailureSummary(reason, input, failureSummary ?? gate?.lastError)
    if (completedAttempt < MAX_GRAPH_CREATE_RUN_ATTEMPTS) {
      const nextAttempt = completedAttempt + 1
      this.graphCreateRunRecoveryByTurn.set(input.turnId, { steps: completedAttempt, reason })
      await this.recordGraphGate(input, {
        attempt: nextAttempt,
        phase: 'retrying',
        failureSummary: lastError
      })
      return 'continue'
    }
    return this.failGraphCreateRun(
      input,
      'graph_create_run_failed',
      [
        `Graph turn could not start after ${MAX_GRAPH_CREATE_RUN_ATTEMPTS} attempts to call`,
        `\`${GRAPH_CREATE_RUN_TOOL_NAME}\`.`,
        lastError
      ].join(' '),
      { reason, failureSummary: lastError }
    )
  }

  private async failGraphCreateRun(
    input: RoundOutcomeInput,
    code: 'graph_create_run_failed',
    message: string,
    details?: unknown
  ): Promise<'failed'> {
    const gate = await this.graphGate(input)
    const attempt = gate?.attempt ?? MAX_GRAPH_CREATE_RUN_ATTEMPTS
    const failureSummary = graphGateFailureSummary('invalid', input, message)
    await this.recordGraphGate(input, { attempt, phase: 'failed', failureSummary })
    this.graphCreateRunRecoveryByTurn.delete(input.turnId)
    this.deps.rememberFailure(input.turnId, {
      error: message,
      code,
      ...(details === undefined ? {} : { details }),
      severity: 'error'
    })
    return 'failed'
  }

  private async suppressMismatchedRequiredToolCalls(
    input: RoundOutcomeInput,
    calls: readonly ToolCallLike[]
  ): Promise<ToolCallLike[]> {
    const required = input.requiredToolName
    if (!required) return [...calls]
    const allowed: ToolCallLike[] = []
    for (const call of calls) {
      if (call.toolName === required) {
        allowed.push(call)
        continue
      }
      const message = [
        `Suppressed \`${call.toolName}\` because this response requires \`${required}\`.`,
        'No tool side effect was performed.'
      ].join(' ')
      await this.deps.turns.updateItem(input.threadId, `item_tool_${input.turnId}_${call.callId}`, {
        status: 'failed',
        summary: message
      })
      await this.deps.events.record({
        kind: 'error',
        threadId: input.threadId,
        turnId: input.turnId,
        message,
        code: 'required_tool_mismatch',
        details: { requiredToolName: required, receivedToolName: call.toolName },
        severity: 'warning'
      })
    }
    return allowed
  }

  private async failHardRequiredTool(
    input: RoundOutcomeInput,
    code: 'required_tool_missing' | 'required_tool_mismatch',
    message: string
  ): Promise<'failed'> {
    this.deps.rememberFailure(input.turnId, { error: message, code, severity: 'error' })
    await this.deps.events.record({
      kind: 'error', threadId: input.threadId, turnId: input.turnId, message, code, severity: 'error'
    })
    await this.deps.turns.applyItem(input.threadId, makeErrorItem({
      id: this.deps.ids.next('item_error'),
      turnId: input.turnId,
      threadId: input.threadId,
      message,
      code,
      severity: 'error'
    }))
    return 'failed'
  }

  private async graphGate(input: RoundOutcomeInput) {
    const current = await this.deps.turns.getTurn(input.threadId, input.turnId)
    const gate = current?.requiredToolGate
    return gate?.toolName === GRAPH_CREATE_RUN_TOOL_NAME ? gate : undefined
  }

  private async recordGraphGate(
    input: RoundOutcomeInput,
    gate: {
      attempt: number
      phase: 'preparing' | 'retrying' | 'succeeded' | 'failed'
      failureSummary?: string
    }
  ): Promise<void> {
    const failureSummary = gate.failureSummary?.trim().slice(0, 2_048)
    await this.deps.turns.updateTurnMetadata(input.threadId, input.turnId, {
      requiredToolGate: {
        toolName: GRAPH_CREATE_RUN_TOOL_NAME,
        attempt: Math.max(1, gate.attempt),
        maxAttempts: MAX_GRAPH_CREATE_RUN_ATTEMPTS,
        phase: gate.phase,
        ...(failureSummary ? { lastError: failureSummary } : {})
      }
    })
    await this.deps.events.record({
      kind: 'required_tool_gate',
      threadId: input.threadId,
      turnId: input.turnId,
      toolName: GRAPH_CREATE_RUN_TOOL_NAME,
      phase: gate.phase,
      attempt: Math.max(1, gate.attempt),
      maxAttempts: MAX_GRAPH_CREATE_RUN_ATTEMPTS,
      ...(failureSummary ? { failureSummary } : {})
    })
  }

  private async resolveEmptyPostToolResponse(input: RoundOutcomeInput): Promise<ModelRoundOutcome> {
    const recoverySteps = (this.emptyPostToolRecoveryStepsByTurn.get(input.turnId) ?? 0) + 1
    if (recoverySteps <= EMPTY_POST_TOOL_MAX_RECOVERY_STEPS) {
      this.emptyPostToolRecoveryStepsByTurn.set(input.turnId, recoverySteps)
      return 'continue'
    }

    const message =
      'Model stopped without a final answer after tool execution, including after continuation and final-answer recovery attempts.'
    this.deps.rememberFailure(input.turnId, {
      error: message,
      code: 'empty_post_tool_continuation',
      severity: 'error'
    })
    await this.deps.events.record({
      kind: 'error',
      threadId: input.threadId,
      turnId: input.turnId,
      message,
      code: 'empty_post_tool_continuation',
      severity: 'error'
    })
    await this.deps.turns.applyItem(
      input.threadId,
      makeErrorItem({
        id: this.deps.ids.next('item_error'),
        turnId: input.turnId,
        threadId: input.threadId,
        message,
        code: 'empty_post_tool_continuation',
        severity: 'error'
      })
    )
    return 'failed'
  }

  private async resolveGoalNoToolResponse(
    input: RoundOutcomeInput,
    assistantText: string
  ): Promise<ModelRoundOutcome> {
    const previousText = this.lastNoToolTextByTurn.get(input.turnId)
    if (isRepeatedNoToolAssistantText(previousText, assistantText)) {
      const recoverySteps = (this.goalNoToolRecoveryStepsByTurn.get(input.turnId) ?? 0) + 1
      if (recoverySteps <= GOAL_NO_TOOL_REPEAT_MAX_RECOVERY_STEPS) {
        this.goalNoToolRecoveryStepsByTurn.set(input.turnId, recoverySteps)
        this.lastNoToolTextByTurn.set(input.turnId, assistantText)
        return 'continue'
      }
      const message =
        'Goal continuation stopped: the model kept repeating near-identical replies without calling tools or updating the goal.'
      await this.deps.turns.applyItem(
        input.threadId,
        makeErrorItem({
          id: this.deps.ids.next('item_error'),
          turnId: input.turnId,
          threadId: input.threadId,
          message,
          code: 'goal_repetition_stop',
          severity: 'warning'
        })
      )
      await this.deps.events.record({
        kind: 'error',
        threadId: input.threadId,
        turnId: input.turnId,
        message,
        code: 'goal_repetition_stop',
        severity: 'warning'
      })
      this.lastNoToolTextByTurn.delete(input.turnId)
      this.goalNoToolRecoveryStepsByTurn.delete(input.turnId)
      if (!this.deps.hasTurnMadeProgress(input.turnId)) {
        this.deps.suppressGoalResume(input.turnId)
      }
      return 'stop'
    }
    this.goalNoToolRecoveryStepsByTurn.delete(input.turnId)
    this.lastNoToolTextByTurn.set(input.turnId, assistantText)
    return 'continue'
  }

  private async recordOutputTruncated(input: RoundOutcomeInput): Promise<void> {
    const message =
      'The model reached its maximum output length and the response was truncated. ' +
      'Raise the model’s max output tokens, or ask it to continue or split the work into smaller steps.'
    await this.deps.events.record({
      kind: 'error',
      threadId: input.threadId,
      turnId: input.turnId,
      message,
      code: 'output_truncated',
      severity: 'warning'
    })
    await this.deps.turns.applyItem(
      input.threadId,
      makeErrorItem({
        id: this.deps.ids.next('item_error'),
        turnId: input.turnId,
        threadId: input.threadId,
        message,
        code: 'output_truncated',
        severity: 'warning'
      })
    )
  }

  private async recoverRequiredSvgCompletion(
    input: RoundOutcomeInput,
    state: SvgArtifactCompletionState
  ): Promise<ModelRoundOutcome> {
    const attempt = (this.svgCompletionRecoveryStepsByTurn.get(input.turnId) ?? 0) + 1
    this.svgCompletionRecoveryStepsByTurn.set(input.turnId, attempt)
    const exhausted = attempt >= MAX_SVG_COMPLETION_RECOVERY_STEPS
    const missingCode = state.mutationSucceeded
      ? 'required_svg_validation_missing'
      : 'required_svg_mutation_missing'
    const message = state.mutationSucceeded
      ? `The dedicated SVG artifact turn cannot finish until \`${DESIGN_SVG_VALIDATE_TOOL_NAME}\` succeeds after the last mutation.`
      : [
          'The dedicated SVG artifact turn cannot finish before a structured mutation succeeds.',
          `Call \`${DESIGN_SVG_EDIT_TOOL_NAME}\` or \`${DESIGN_SVG_ANIMATE_TOOL_NAME}\`, then finish with \`${DESIGN_SVG_VALIDATE_TOOL_NAME}\`.`
        ].join(' ')
    const finalMessage = exhausted ? `${message} Recovery attempts exhausted.` : message
    const code = exhausted ? 'svg_completion_gate_exhausted' : missingCode
    const severity = exhausted ? 'error' as const : 'warning' as const
    if (exhausted) {
      this.deps.rememberFailure(input.turnId, { error: finalMessage, code, severity })
    }
    await this.deps.events.record({
      kind: 'error',
      threadId: input.threadId,
      turnId: input.turnId,
      message: finalMessage,
      code,
      severity
    })
    await this.deps.turns.applyItem(
      input.threadId,
      makeErrorItem({
        id: this.deps.ids.next('item_error'),
        turnId: input.turnId,
        threadId: input.threadId,
        message: finalMessage,
        code,
        severity
      })
    )
    return exhausted ? 'failed' : 'continue'
  }

  private toolDispatchInput(
    input: RoundOutcomeInput,
    calls: ToolCallLike[],
    includeInteractiveFlags: boolean
  ): ToolDispatchInput {
    const prepared = input.prepared
    const base: ToolDispatchInput = {
      calls,
      threadId: input.threadId,
      turnId: input.turnId,
      workspace: prepared.workspace,
      ...(input.turn.workspaceCheckpointRequestId
        ? { workspaceCheckpointRequestId: input.turn.workspaceCheckpointRequestId }
        : {}),
      orchestration: prepared.orchestration,
      messageSource: prepared.messageSource,
      additionalWorkspaces: prepared.additionalWorkspaces,
      clientSurface: prepared.clientSurface,
      threadMode: prepared.mode,
      activePlanContext: prepared.activePlanContext,
      guiDesignCanvas: input.turn.guiDesignCanvas === true,
      guiDesignMode: input.turn.guiDesignMode === true,
      agentSurface: input.turn.agentSurface ?? 'code',
      guiDesignArtifact: input.turn.guiDesignArtifact,
      modelProviderId: input.modelProviderId,
      actingModelRoute: prepared.actingModelRoute,
      approvalIntent: input.turn.prompt,
      reasoningEffort: input.modelReasoningEffort,
      modelCapabilities: prepared.modelCapabilities,
      ...(input.sourceResultBudgetTokens !== undefined
        ? { sourceResultBudgetTokens: input.sourceResultBudgetTokens }
        : {}),
      activeSkillIds: prepared.skillResolution.activeSkillIds,
      allowedToolNames: prepared.allowedToolNames,
      extensionToolCatalogEpoch: prepared.extensionToolCatalogEpoch,
      toolProviderKinds: input.toolProviderKinds,
      approvalPolicy: prepared.approvalPolicy,
      approvalReviewer: prepared.approvalReviewer,
      sandboxMode: prepared.sandboxMode,
      signal: prepared.signal
    }
    if (!includeInteractiveFlags) return base
    return {
      ...base,
      userInputDisabled: prepared.userInputDisabled,
      imContext: input.turn.imContext === true
    }
  }
}

function graphCreateRunResultRetryable(output: unknown): boolean {
  return Boolean(
    output &&
    typeof output === 'object' &&
    !Array.isArray(output) &&
    (output as Record<string, unknown>).retryable === true
  )
}

function graphCreateRunFailureMessage(output: unknown): string {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const error = (output as Record<string, unknown>).error
    if (typeof error === 'string' && error.trim()) {
      return `Graph turn could not start: ${error.trim().slice(0, 2_048)}`
    }
  }
  return 'Graph turn could not start because graph_create_run failed outside recoverable validation.'
}

function graphCreateRunValidationSummary(output: unknown): string | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined
  const record = output as Record<string, unknown>
  const error = typeof record.error === 'string' ? record.error.trim() : ''
  const issues = Array.isArray(record.issues)
    ? record.issues
      .slice(0, 4)
      .map((issue) => {
        if (!issue || typeof issue !== 'object' || Array.isArray(issue)) return ''
        const value = issue as Record<string, unknown>
        const path = typeof value.path === 'string'
          ? value.path.trim()
          : Array.isArray(value.path)
            ? value.path.filter((part): part is string | number =>
              typeof part === 'string' || typeof part === 'number'
            ).join('.')
            : ''
        const message = typeof value.message === 'string' ? value.message.trim() : ''
        return [path, message].filter(Boolean).join(': ')
      })
      .filter(Boolean)
      .join('; ')
    : ''
  const summary = [error, issues].filter(Boolean).join(' — ')
  return summary ? redactGraphGateSummary(summary) : undefined
}

function graphGateFailureSummary(
  reason: GraphCreateRunRecoveryReason,
  input: RoundOutcomeInput,
  fallback?: string
): string {
  const supplied = fallback?.trim()
  if (supplied) return redactGraphGateSummary(supplied)
  if (reason === 'mismatch') {
    const received = input.streamed.kind === 'completed' || input.streamed.kind === 'tool_calls'
      ? input.streamed.snapshot.toolCalls.map((call) => call.toolName).filter(Boolean).join(', ')
      : ''
    return redactGraphGateSummary(received
      ? `Received a different tool call: ${received}.`
      : 'Received a different tool call.')
  }
  if (reason === 'invalid') return 'graph_create_run returned retryable validation errors.'
  return `The model did not call \`${GRAPH_CREATE_RUN_TOOL_NAME}\`.`
}

function redactGraphGateSummary(value: string): string {
  return value
    .replace(/(?:sk|rk|api)[_-][A-Za-z0-9._-]{12,}/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_048)
}
