import type { Turn } from '../contracts/turns.js'
import { makeErrorItem, makeToolCallItem } from '../domain/item.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ToolCallLike, ToolProviderKind } from '../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import { CREATE_PLAN_TOOL_NAME } from '../adapters/tool/create-plan-tool.js'
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

export type RoundToolProviderMetadata = Readonly<{
  providerId?: string
  providerKind?: ToolProviderKind
}>

export type RoundOutcomeInput = Readonly<{
  threadId: string
  turnId: string
  streamed: ModelRoundStreamResult
  requiredToolName?: string
  turn: Turn
  prepared: PreparedTurnContext
  modelProviderId?: string
  toolProviderMetadata: ReadonlyMap<string, RoundToolProviderMetadata>
  toolKinds: ReadonlyMap<string, ToolCallLike['toolKind'] | undefined>
  toolProviderKinds: ReadonlyMap<string, ToolProviderKind | undefined>
  svgCompletion: SvgArtifactCompletionState | null
}>

export type RoundOutcomeCoordinatorDeps = {
  sessionStore: Pick<SessionStore, 'loadItems'>
  turns: Pick<TurnService, 'applyItem'>
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

  clearTurn(turnId: string): void {
    this.lastNoToolTextByTurn.delete(turnId)
    this.goalNoToolRecoveryStepsByTurn.delete(turnId)
    this.emptyPostToolRecoveryStepsByTurn.delete(turnId)
    this.svgCompletionRecoveryStepsByTurn.delete(turnId)
  }

  async resolve(input: RoundOutcomeInput): Promise<ModelRoundOutcome> {
    if (input.streamed.kind === 'aborted') return 'aborted'
    if (input.streamed.kind === 'failed') return 'failed'

    const streamSnapshot = input.streamed.snapshot
    const completedToolCalls = [...streamSnapshot.toolCalls]
    if (completedToolCalls.length === 0) {
      if (input.svgCompletion && !input.svgCompletion.validationAfterMutation) {
        return this.recoverRequiredSvgCompletion(input, input.svgCompletion)
      }
      if (input.requiredToolName) {
        return this.resolveMissingRequiredTool(input, streamSnapshot.text)
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
    const dispatched = await this.deps.dispatchToolCalls(
      this.toolDispatchInput(input, completedToolCalls, true)
    )
    if (dispatched === 'aborted') return 'aborted'
    if (dispatched === 'budget_exhausted') return 'failed'
    if (dispatched === 'all_suppressed') {
      if (input.prepared.dedicatedSvgTurn) {
        const latestItems = await this.deps.sessionStore.loadItems(input.threadId)
        const latestCompletion = svgArtifactCompletionState(latestItems, input.turnId)
        if (!latestCompletion.validationAfterMutation) {
          return this.recoverRequiredSvgCompletion(input, latestCompletion)
        }
      }
      return 'stop'
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

  private async resolveMissingRequiredTool(
    input: RoundOutcomeInput,
    assistantText: string
  ): Promise<ModelRoundOutcome> {
    if (input.requiredToolName === CREATE_PLAN_TOOL_NAME && assistantText.trim()) {
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
          summary: 'Materialized assistant plan text into the required GUI plan.'
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
      if (dispatched === 'all_suppressed') return 'stop'
      return 'continue'
    }

    const message = `Model did not call the required \`${input.requiredToolName}\` tool for this GUI plan turn.`
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
      threadMode: prepared.mode,
      activePlanContext: prepared.activePlanContext,
      guiDesignCanvas: input.turn.guiDesignCanvas === true,
      guiDesignMode: input.turn.guiDesignMode === true,
      guiDesignArtifact: input.turn.guiDesignArtifact,
      modelProviderId: input.modelProviderId,
      modelCapabilities: prepared.modelCapabilities,
      activeSkillIds: prepared.skillResolution.activeSkillIds,
      allowedToolNames: prepared.allowedToolNames,
      extensionToolCatalogEpoch: prepared.extensionToolCatalogEpoch,
      toolProviderKinds: input.toolProviderKinds,
      approvalPolicy: prepared.approvalPolicy,
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
