import type { TurnItem } from '../contracts/items.js'
import type { TurnClientSurface } from '../contracts/turns.js'
import type { ModelToolSpec } from '../ports/model-client.js'
import type { ModelRoundStreamResult } from './model-round-engine.js'
import type { ModelStepServiceDeps } from './model-step-service-types.js'
import type { ModelRoundOutcome } from './turn-execution-types.js'

type ContextOverflowResult = Extract<ModelRoundStreamResult, { kind: 'context_overflow' }>

export async function recoverModelContextOverflow(input: {
  deps: ModelStepServiceDeps
  streamed: ContextOverflowResult
  history: TurnItem[]
  model: string
  providerId?: string
  accountId?: string
  serviceTier?: 'priority'
  signal: AbortSignal
  threadId: string
  turnId: string
  clientSurface: TurnClientSurface
  toolSpecs: readonly ModelToolSpec[]
  requestOverheadTokens: number
  requestInputTokens: number
  outputBudgetTokens: number
  requestHardCapTokens: number
  retryAttempt: number
  retry: () => Promise<ModelRoundOutcome>
}): Promise<ModelRoundOutcome> {
  let recoveryDetail = ''
  if (input.retryAttempt === 0 && !input.streamed.partialOutput && !input.signal.aborted) {
    const compacted = await input.deps.historyCompaction.compactIfNeeded({
      items: input.history,
      model: input.model,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
      signal: input.signal,
      threadId: input.threadId,
      turnId: input.turnId,
      clientSurface: input.clientSurface,
      toolSpecs: input.toolSpecs,
      requestOverheadTokens: input.requestOverheadTokens,
      requestInputTokens: input.requestInputTokens,
      outputBudgetTokens: input.outputBudgetTokens,
      requestHardCapTokens: input.requestHardCapTokens,
      allowModelSummary: false,
      force: {
        reason: 'provider rejected the request because its context window was exceeded',
        keepRecent: 1
      }
    })
    if (input.signal.aborted) return 'aborted'
    if (compacted.compacted) {
      const reservation = await input.deps.budgetGate.reserveAdditionalModelRequest(
        input.threadId,
        input.turnId
      )
      if (reservation.allowed) {
        await input.deps.events.record({
          kind: 'model_request_retry',
          threadId: input.threadId,
          turnId: input.turnId,
          attempt: 2,
          maxAttempts: 2,
          delayMs: 0,
          reason: 'context_overflow'
        })
        return input.retry()
      }
      recoveryDetail = reservation.reason ?? 'model-request budget blocked the compacted retry'
    } else {
      recoveryDetail = 'forced compaction could not reclaim additional history'
    }
  } else if (input.streamed.partialOutput) {
    recoveryDetail = 'automatic retry was skipped because partial model output was already committed'
  } else {
    recoveryDetail = 'the single compacted retry also exceeded the provider context window'
  }

  const message = `${input.streamed.error.message}${recoveryDetail ? ` (${recoveryDetail})` : ''}. ` +
    "Check the selected model's configured contextWindowTokens, shorten the current input or attachments, " +
    'disable unused tools, or choose a larger-window model. Your saved conversation has not been deleted.'
  input.deps.rememberFailure(input.turnId, {
    error: message,
    code: input.streamed.error.code,
    severity: 'error'
  })
  await input.deps.events.record({
    kind: 'error',
    threadId: input.threadId,
    turnId: input.turnId,
    message,
    code: input.streamed.error.code,
    severity: 'error'
  })
  return 'failed'
}
