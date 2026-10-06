import { randomUUID } from 'node:crypto'
import type { ModelAttemptObserver } from '../../ports/model-attempt.js'
import type { GatewayUsageRecorder } from '../../services/gateway-usage-service.js'
import { GatewayBudgetError } from '../../services/gateway-token-budget.js'
import type { GatewayAuth } from './model-gateway-core.js'
import type { ServerRuntime } from './server-runtime.js'

export function gatewayAttemptAccounting(runtime: ServerRuntime, auth: GatewayAuth,
  recorder: GatewayUsageRecorder | undefined, requestId: string): ModelAttemptObserver | undefined {
  if (auth.kind !== 'public') return undefined
  const policy = auth.policy?.tokenBudget ?? (auth.policy?.costAlert ? {
    ...auth.policy.costAlert, mode: 'soft' as const, tokens: Number.MAX_SAFE_INTEGER
  } : undefined)
  return { async begin(input) {
    const attemptId = input.attemptId ?? randomUUID()
    const budget = runtime.modelGateway?.budget
    if (policy) {
      if (!budget) throw new GatewayBudgetError('token_budget_unavailable', 'Gateway budget storage is unavailable.')
      try {
        await budget.reserve({ clientId: auth.client?.clientId ?? 'legacy', requestId, attemptId, policy,
          upperBound: input.inputUpperBound && input.maxOutputTokens ? input.inputUpperBound + input.maxOutputTokens : undefined,
          estimate: input.estimatedTokens })
      } catch (error) {
        if (error instanceof GatewayBudgetError) throw error
        throw new GatewayBudgetError('token_budget_unavailable', 'Gateway budget storage is unavailable.')
      }
    }
    let finished = false
    return { async finish(usage, dispatched = true) {
      if (finished) return
      finished = true
      if (dispatched) recorder?.observeAttempt?.({ attemptId, providerId: input.providerId, modelId: input.model, usage })
      if (policy && budget) {
        try { await budget.settle(attemptId, !dispatched ? 0 : usage ? usage.promptTokens + usage.completionTokens : undefined,
          !dispatched ? 0 : usage?.costUsd) }
        catch { throw new GatewayBudgetError('token_budget_unavailable', 'Gateway usage settlement is pending; its reservation remains held.') }
      }
    } }
  } }
}
