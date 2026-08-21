import type { ToolResultTurnItem } from '../contracts/items.js'
import { GraphPlanningDraftV1Schema } from '../contracts/graph-planning.js'
import { CREATE_PLAN_TOOL_NAME } from '../adapters/tool/create-plan-tool.js'
import { GRAPH_DEFINE_PLAN_TOOL_NAME } from '../adapters/tool/graph-define-plan-tool.js'
import {
  DESIGN_SVG_ANIMATE_TOOL_NAME,
  DESIGN_SVG_EDIT_TOOL_NAME,
  DESIGN_SVG_VALIDATE_TOOL_NAME
} from '../adapters/tool/design-svg-tool.js'
import { isPostToolFailureProgressText } from './continuation-instructions.js'
import { svgArtifactCompletionState } from './svg-artifact-completion.js'
import type { ModelRoundOutcome } from './turn-execution-types.js'
import { RoundOutcomeRecoveryPhase } from './round-outcome-recovery-phase.js'
import {
  GRAPH_CREATE_RUN_TOOL_NAME,
  CANVAS_RECEIPT_TIMEOUT_MS,
  type RoundOutcomeInput
} from './round-outcome-state.js'

export {
  GRAPH_CREATE_RUN_TOOL_NAME,
  MAX_GRAPH_CREATE_RUN_ATTEMPTS,
  MAX_GRAPH_CREATE_RUN_RECOVERY_STEPS,
  type GraphCreateRunRecoveryReason,
  type RoundOutcomeCoordinatorDeps,
  type RoundOutcomeInput,
  type RoundToolProviderMetadata
} from './round-outcome-state.js'

/**
 * Converts one completed model stream into the next loop action. It owns the
 * bounded post-stream recovery windows, but not request construction, model
 * streaming, tool execution, or terminal turn settlement.
 */
export class RoundOutcomeCoordinator extends RoundOutcomeRecoveryPhase {
  async resolve(input: RoundOutcomeInput): Promise<ModelRoundOutcome> {
    if (input.streamed.kind === 'aborted') return 'aborted'
    if (input.streamed.kind === 'context_overflow') return 'failed'
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
      const toolSuppressionRecoverySteps = this.toolSuppressionRecoverySteps(input.turnId)
      if (toolSuppressionRecoverySteps > 0 && !streamSnapshot.text.trim()) {
        return this.resolveEmptyToolSuppressionRecovery(input)
      }
      if (toolSuppressionRecoverySteps > 0 && !input.softRequiredToolName) {
        // A non-empty answer is the successful terminal outcome of suppression
        // recovery. Do not clear the phase and then fall through to active-goal
        // continuation: that would advertise tools again and let the same
        // suppressed calls restart an unbounded loop. Keep the goal itself
        // active, but require an explicit future turn to resume it.
        this.toolSuppressionRecoveryStepsByTurn.delete(input.turnId)
        if (input.prepared.activeGoalInstruction) {
          this.deps.suppressGoalResume(input.turnId)
        }
        return 'stop'
      }
      if (input.softRequiredToolName) {
        return this.resolveMissingSoftRequiredTool(input, streamSnapshot.text)
      }
      if (streamSnapshot.text.trim()) {
        this.toolSuppressionRecoveryStepsByTurn.delete(input.turnId)
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
        !streamSnapshot.text.trim() &&
        hasCurrentTurnFileChange
      ) {
        return this.resolveEmptyPostToolResponse(input)
      }
      if (streamSnapshot.stopReason === 'stop' && input.prepared.activeGoalInstruction) {
        return this.resolveGoalNoToolResponse(input, streamSnapshot.text)
      }
      if (
        streamSnapshot.stopReason === 'stop' &&
        streamSnapshot.text.trim() &&
        input.prepared.orchestration !== 'graph' &&
        !input.prepared.planTurnActive &&
        this.hasFailedOrdinaryToolResult(input) &&
        isPostToolFailureProgressText(streamSnapshot.text)
      ) {
        return this.advancePostToolFailureRecovery(input)
      }
      if (streamSnapshot.stopReason === 'length') {
        await this.recordOutputTruncated(input)
        return 'stop'
      }
      if (
        streamSnapshot.stopReason === 'stop' &&
        !streamSnapshot.text.trim() &&
        !streamSnapshot.reasoning.trim()
      ) {
        return this.failEmptyTerminalResponse(input)
      }
      return 'stop'
    }

    // Tool calls mean the turn is making progress again; reset the no-tool
    // repetition window so unrelated later status texts are not compared.
    this.lastNoToolTextByTurn.delete(input.turnId)
    this.goalNoToolRecoveryStepsByTurn.delete(input.turnId)
    this.emptyPostToolRecoveryStepsByTurn.delete(input.turnId)
    if (input.toolCallsDisabled) {
      const message =
        'Tool calls are disabled during final-answer recovery; the provider-emitted calls were not executed.'
      await this.deps.suppressToolCalls(
        this.toolDispatchInput(input, completedToolCalls, true),
        message
      )
      return this.failToolSuppressionRecovery(input.threadId, input.turnId)
    }
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
      if (input.prepared.dedicatedSvgTurn) {
        const latestItems = await this.deps.sessionStore.loadItems(input.threadId)
        const latestCompletion = svgArtifactCompletionState(latestItems, input.turnId)
        if (!latestCompletion.validationAfterMutation) {
          return this.recoverRequiredSvgCompletion(input, latestCompletion)
        }
      }
      return this.advanceToolSuppressionRecovery(input)
    }
    await this.updatePostToolFailureRecoveryAfterDispatch(input, dispatchableToolCalls)
    this.toolSuppressionRecoveryStepsByTurn.delete(input.turnId)
    if (this.deps.receipts) {
      // Two-phase design tools: block the next model request until the
      // renderer confirms the canvas applied (or the timeout finalizes the
      // result as `unverified`). The model then sees the real outcome.
      await this.deps.receipts.awaitTurnReceipts(
        input.threadId,
        input.turnId,
        CANVAS_RECEIPT_TIMEOUT_MS
      )
    }
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
}
