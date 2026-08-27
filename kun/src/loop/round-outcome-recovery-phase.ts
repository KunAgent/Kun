import { makeErrorItem } from '../domain/item.js'
import type { ToolResultTurnItem } from '../contracts/items.js'
import type { ToolCallLike } from '../ports/tool-host.js'
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
  POST_TOOL_FAILURE_MAX_RECOVERY_STEPS,
  TOOL_SUPPRESSION_FINAL_ANSWER_RECOVERY_STEP,
  isRepeatedNoToolAssistantText,
  isUserDirectedNoToolText
} from './continuation-instructions.js'
import type { SvgArtifactCompletionState } from './svg-artifact-completion.js'
import type {
  ModelRoundOutcome,
  ToolDispatchInput
} from './turn-execution-types.js'
import { RoundOutcomeRequiredToolPhase } from './round-outcome-required-tool-phase.js'
import {
  GRAPH_CREATE_RUN_TOOL_NAME,
  MAX_SVG_COMPLETION_RECOVERY_STEPS,
  type RoundOutcomeInput
} from './round-outcome-state.js'

const POST_TOOL_FAILURE_EXCLUDED_TOOL_NAMES = new Set([
  CREATE_PLAN_TOOL_NAME,
  GRAPH_DEFINE_PLAN_TOOL_NAME,
  GRAPH_CREATE_RUN_TOOL_NAME,
  DESIGN_SVG_ANIMATE_TOOL_NAME,
  DESIGN_SVG_EDIT_TOOL_NAME,
  DESIGN_SVG_VALIDATE_TOOL_NAME
])

const MODEL_EMPTY_RESPONSE_CODE = 'model_empty_response'

export abstract class RoundOutcomeRecoveryPhase extends RoundOutcomeRequiredToolPhase {
  /**
   * Terminal safety net after every bounded recovery window declined to act.
   * A provider can end an otherwise successful stream (usage, `stop`) without
   * text, reasoning, tool calls, or generated output. Persisting that as a
   * completed turn leaves the conversation with a bare user bubble and no
   * replayable answer, so fail visibly instead. Recovery paths that need the
   * empty snapshot (post-tool, goal, required-tool) run before this net.
   */
  protected async failEmptyTerminalResponse(input: RoundOutcomeInput): Promise<ModelRoundOutcome> {
    const message =
      'Model provider completed without returning text, reasoning, a tool call, or generated output. ' +
      'Check provider/model availability and routing, then resend the message.'
    const route = input.prepared.actingModelRoute
    const details = {
      model: input.prepared.model,
      ...(input.modelProviderId ? { providerId: input.modelProviderId } : {}),
      ...(route ? { route } : {})
    }
    this.deps.rememberFailure(input.turnId, {
      error: message,
      code: MODEL_EMPTY_RESPONSE_CODE,
      details,
      severity: 'error'
    })
    await this.deps.events.record({
      kind: 'error',
      threadId: input.threadId,
      turnId: input.turnId,
      message,
      code: MODEL_EMPTY_RESPONSE_CODE,
      details,
      severity: 'error'
    })
    await this.deps.turns.applyItem(
      input.threadId,
      makeErrorItem({
        id: this.deps.ids.next('item_error'),
        turnId: input.turnId,
        threadId: input.threadId,
        message,
        code: MODEL_EMPTY_RESPONSE_CODE,
        details,
        severity: 'error'
      })
    )
    return 'failed'
  }

  protected async resolveEmptyPostToolResponse(input: RoundOutcomeInput): Promise<ModelRoundOutcome> {
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

  /**
   * Whether the latest ordinary tool result in this turn failed. A later
   * successful ordinary result resolves the recovery episode, even though the
   * durable history still retains the earlier failure for auditability.
   */
  protected hasFailedOrdinaryToolResult(input: RoundOutcomeInput): boolean {
    for (let index = input.prepared.history.length - 1; index >= 0; index -= 1) {
      const item = input.prepared.history[index]
      if (
        item?.turnId === input.turnId &&
        item.kind === 'tool_result' &&
        !POST_TOOL_FAILURE_EXCLUDED_TOOL_NAMES.has(item.toolName)
      ) return item.isError === true
    }
    return false
  }

  /**
   * A recovery-stage tool batch only resets the post-failure budget after an
   * ordinary tool actually succeeds. If every ordinary result failed, consume
   * the final-answer stage now so further failed retries cannot spin forever.
   */
  protected async updatePostToolFailureRecoveryAfterDispatch(
    input: RoundOutcomeInput,
    calls: readonly ToolCallLike[]
  ): Promise<void> {
    const recoverySteps = this.postToolFailureRecoverySteps(input.turnId)
    if (recoverySteps === 0) return
    const callIds = new Set(calls
      .filter((call) => !POST_TOOL_FAILURE_EXCLUDED_TOOL_NAMES.has(call.toolName))
      .map((call) => call.callId))
    if (callIds.size === 0) return
    const results = (await this.deps.sessionStore.loadItems(input.threadId)).filter(
      (item): item is ToolResultTurnItem =>
        item.turnId === input.turnId &&
        item.kind === 'tool_result' &&
        callIds.has(item.callId)
    )
    if (results.length === 0) return
    if (results.some((result) => result.isError !== true)) {
      this.postToolFailureRecoveryStepsByTurn.delete(input.turnId)
      return
    }
    this.postToolFailureRecoveryStepsByTurn.set(
      input.turnId,
      Math.min(POST_TOOL_FAILURE_MAX_RECOVERY_STEPS, recoverySteps + 1)
    )
  }

  /**
   * Bounded continuation when the model stops with a progress announcement
   * after an ordinary tool failure. The first recovery keeps tools so the
   * model can act; once the recovery budget is exhausted the turn fails
   * visibly instead of silently presenting the announcement as completion.
   */
  protected async advancePostToolFailureRecovery(
    input: RoundOutcomeInput
  ): Promise<ModelRoundOutcome> {
    const recoverySteps = (this.postToolFailureRecoveryStepsByTurn.get(input.turnId) ?? 0) + 1
    if (recoverySteps <= POST_TOOL_FAILURE_MAX_RECOVERY_STEPS) {
      this.postToolFailureRecoveryStepsByTurn.set(input.turnId, recoverySteps)
      await this.deps.events.record({
        kind: 'error',
        threadId: input.threadId,
        turnId: input.turnId,
        message:
          'Model stopped with a progress announcement after a tool failure; requesting continuation.',
        code: 'post_tool_failure_continuation',
        severity: 'warning'
      })
      return 'continue'
    }
    this.postToolFailureRecoveryStepsByTurn.delete(input.turnId)
    const message =
      'Model kept ending with progress announcements after a tool failure instead of continuing the task or providing a final answer.'
    this.deps.rememberFailure(input.turnId, {
      error: message,
      code: 'post_tool_failure_recovery_exhausted',
      severity: 'error'
    })
    await this.deps.events.record({
      kind: 'error',
      threadId: input.threadId,
      turnId: input.turnId,
      message,
      code: 'post_tool_failure_recovery_exhausted',
      severity: 'error'
    })
    await this.deps.turns.applyItem(
      input.threadId,
      makeErrorItem({
        id: this.deps.ids.next('item_error'),
        turnId: input.turnId,
        threadId: input.threadId,
        message,
        code: 'post_tool_failure_recovery_exhausted',
        severity: 'error'
      })
    )
    return 'failed'
  }

  protected async advanceToolSuppressionRecovery(
    input: RoundOutcomeInput
  ): Promise<ModelRoundOutcome> {
    const current = this.toolSuppressionRecoverySteps(input.turnId)
    if (current >= TOOL_SUPPRESSION_FINAL_ANSWER_RECOVERY_STEP) {
      return this.failToolSuppressionRecovery(input.threadId, input.turnId)
    }
    this.toolSuppressionRecoveryStepsByTurn.set(input.turnId, current + 1)
    return 'continue'
  }

  protected async resolveEmptyToolSuppressionRecovery(
    input: RoundOutcomeInput
  ): Promise<ModelRoundOutcome> {
    const current = this.toolSuppressionRecoverySteps(input.turnId)
    if (current < TOOL_SUPPRESSION_FINAL_ANSWER_RECOVERY_STEP) {
      this.toolSuppressionRecoveryStepsByTurn.set(
        input.turnId,
        TOOL_SUPPRESSION_FINAL_ANSWER_RECOVERY_STEP
      )
      return 'continue'
    }
    return this.failToolSuppressionRecovery(input.threadId, input.turnId)
  }

  async failToolSuppressionRecovery(threadId: string, turnId: string): Promise<'failed'> {
    const message =
      'Turn stopped because repeated tool calls were suppressed and the model still did not produce a final answer.'
    this.toolSuppressionRecoveryStepsByTurn.delete(turnId)
    this.deps.suppressGoalResume(turnId)
    this.deps.rememberFailure(turnId, {
      error: message,
      code: 'tool_loop_suppressed',
      severity: 'error'
    })
    await this.deps.events.record({
      kind: 'error',
      threadId,
      turnId,
      message,
      code: 'tool_loop_suppressed',
      severity: 'error'
    })
    await this.deps.turns.applyItem(
      threadId,
      makeErrorItem({
        id: this.deps.ids.next('item_error'),
        turnId,
        threadId,
        message,
        code: 'tool_loop_suppressed',
        severity: 'error'
      })
    )
    return 'failed'
  }

  protected async resolveGoalNoToolResponse(
    input: RoundOutcomeInput,
    assistantText: string
  ): Promise<ModelRoundOutcome> {
    // A user-directed question or explicit wait-for-user reply is a legitimate
    // terminal outcome, not repetition. Stop normally (goal stays active, but
    // resume waits for the user's answer) so the question is never swallowed
    // by another forced continuation round.
    if (isUserDirectedNoToolText(assistantText)) {
      this.lastNoToolTextByTurn.delete(input.turnId)
      this.goalNoToolRecoveryStepsByTurn.delete(input.turnId)
      this.deps.suppressGoalResume(input.turnId)
      return 'stop'
    }
    const previousText = this.lastNoToolTextByTurn.get(input.turnId)
    if (isRepeatedNoToolAssistantText(previousText, assistantText)) {
      const recoverySteps = (this.goalNoToolRecoveryStepsByTurn.get(input.turnId) ?? 0) + 1
      if (recoverySteps <= GOAL_NO_TOOL_REPEAT_MAX_RECOVERY_STEPS) {
        this.goalNoToolRecoveryStepsByTurn.set(input.turnId, recoverySteps)
        this.lastNoToolTextByTurn.set(input.turnId, assistantText)
        return 'continue'
      }
      const message =
        'Goal continuation stopped: the model kept repeating near-identical replies without calling tools or updating the goal. ' +
        'The goal is still active; send a message to continue it, or ask to change or clear the goal.'
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

  protected async recordOutputTruncated(input: RoundOutcomeInput): Promise<void> {
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

  protected async recoverRequiredSvgCompletion(
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

  protected toolDispatchInput(
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
      subagentResume: prepared.subagentResume,
      additionalWorkspaces: prepared.additionalWorkspaces,
      knowledgeBases: prepared.knowledgeBases,
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
      serviceTier: input.turn.serviceTier === 'priority' ? 'priority' : undefined,
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
