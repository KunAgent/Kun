import type { ToolResultTurnItem } from '../contracts/items.js'
import { makeErrorItem, makeToolCallItem } from '../domain/item.js'
import type { ToolCallLike } from '../ports/tool-host.js'
import { CREATE_PLAN_TOOL_NAME } from '../adapters/tool/create-plan-tool.js'
import { GRAPH_DEFINE_PLAN_TOOL_NAME } from '../adapters/tool/graph-define-plan-tool.js'
import { latestUserMessageText } from './continuation-instructions.js'
import { isPlanClarifyingQuestion } from './plan-mode.js'
import type {
  ModelRoundOutcome,
  ToolDispatchInput
} from './turn-execution-types.js'
import {
  GRAPH_CREATE_RUN_TOOL_NAME,
  MAX_GRAPH_CREATE_RUN_ATTEMPTS,
  RoundOutcomeState,
  type GraphCreateRunRecoveryReason,
  type RoundOutcomeInput
} from './round-outcome-state.js'

export abstract class RoundOutcomeRequiredToolPhase extends RoundOutcomeState {
  protected abstract advanceToolSuppressionRecovery(
    input: RoundOutcomeInput
  ): Promise<ModelRoundOutcome>

  protected abstract toolDispatchInput(
    input: RoundOutcomeInput,
    calls: ToolCallLike[],
    includeInteractiveFlags: boolean
  ): ToolDispatchInput

  protected async resolveMissingSoftRequiredTool(
    input: RoundOutcomeInput,
    assistantText: string
  ): Promise<ModelRoundOutcome> {
    if (isPptWorkflowCompletionTool(input.softRequiredToolName)) {
      const attempts = this.pptNoToolRecoveryByTurn.get(input.turnId) ?? 0
      if (attempts === 0) {
        this.pptNoToolRecoveryByTurn.set(input.turnId, 1)
        return 'continue'
      }
    }
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
      if (dispatched === 'all_suppressed') return this.advanceToolSuppressionRecovery(input)
      this.toolSuppressionRecoveryStepsByTurn.delete(input.turnId)
      return 'continue'
    }

    const message = isPptWorkflowCompletionTool(input.softRequiredToolName)
      ? `PPT child did not call the expected \`${input.softRequiredToolName}\` completion tool.`
      : `Model did not call the expected \`${input.softRequiredToolName}\` tool for this Plan-mode turn.`
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

  protected async resolveMissingRequiredTool(input: RoundOutcomeInput): Promise<ModelRoundOutcome> {
    if (input.requiredToolName === GRAPH_CREATE_RUN_TOOL_NAME) {
      return this.advanceGraphCreateRunRecovery(input, 'missing')
    }
    return this.failHardRequiredTool(
      input,
      'required_tool_missing',
      `Model did not call the required \`${input.requiredToolName}\` tool.`
    )
  }

  protected async resolveDispatchedGraphCreate(
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

  protected async advanceGraphCreateRunRecovery(
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

  protected async failGraphCreateRun(
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

  protected async suppressMismatchedRequiredToolCalls(
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

  protected async failHardRequiredTool(
    input: RoundOutcomeInput,
    code: 'required_tool_missing' | 'required_tool_mismatch' | 'im_final_missing',
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

  protected async graphGate(input: RoundOutcomeInput) {
    const current = await this.deps.turns.getTurn(input.threadId, input.turnId)
    const gate = current?.requiredToolGate
    return gate?.toolName === GRAPH_CREATE_RUN_TOOL_NAME ? gate : undefined
  }

  protected async recordGraphGate(
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
}

function isPptWorkflowCompletionTool(toolName: string | undefined): boolean {
  return toolName === 'ppt_create_direction_bundle' ||
    toolName === 'ppt_create_review_bundle' ||
    toolName === 'ppt_generate_previews' ||
    toolName === 'ppt_export'
}

export function graphCreateRunResultRetryable(output: unknown): boolean {
  return Boolean(
    output &&
    typeof output === 'object' &&
    !Array.isArray(output) &&
    (output as Record<string, unknown>).retryable === true
  )
}

export function graphCreateRunFailureMessage(output: unknown): string {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const error = (output as Record<string, unknown>).error
    if (typeof error === 'string' && error.trim()) {
      return `Graph turn could not start: ${error.trim().slice(0, 2_048)}`
    }
  }
  return 'Graph turn could not start because graph_create_run failed outside recoverable validation.'
}

export function graphCreateRunValidationSummary(output: unknown): string | undefined {
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

export function graphGateFailureSummary(
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

export function redactGraphGateSummary(value: string): string {
  return value
    .replace(/(?:sk|rk|api)[_-][A-Za-z0-9._-]{12,}/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_048)
}
