import { GatewayBudgetError } from '../../services/gateway-token-budget.js'
import { randomUUID } from 'node:crypto'
import type { ModelAttemptInput, ModelAttemptLease } from '../../ports/model-attempt.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ModelFailureMetadata } from '../../contracts/model-route-pool.js'

/** Observes each physical attempt before route precommit buffering can discard its usage. */
export async function* observeModelAttempts(request: ModelRequest,
  stream: (request: ModelRequest) => AsyncIterable<ModelStreamChunk>): AsyncIterable<ModelStreamChunk> {
  if (!request.attemptObserver) { yield* stream(request); return }
  let dispatched = false
  let lease: ModelAttemptLease | undefined, usage: UsageSnapshot | undefined
  const finish = async () => { const current = lease; lease = undefined; await current?.finish(usage, dispatched); usage = undefined; dispatched = false }
  try {
    const observed = { ...request, onWireDispatch: () => { dispatched = true; request.onWireDispatch?.() }, beforeWireDispatch: async (input: ModelAttemptInput) => {
      await finish()
      await request.beforeWireDispatch?.(input)
      lease = await request.attemptObserver!.begin({ ...input, requestId: request.requestId,
        attemptId: randomUUID(), deadlineAt: request.deadlineAt })
    } }
    for await (const chunk of stream(observed)) {
      if (chunk.kind === 'usage') usage = chunk.usage
      // Settlement precedes terminal output, including when consumers stop at completed.
      if (chunk.kind === 'completed' || chunk.kind === 'error') await finish()
      yield chunk
    }
  } catch (error) {
    if (!(error instanceof GatewayBudgetError)) throw error
    yield budgetRefusalChunk(error)
  } finally { await finish() }
}

/**
 * A local budget refusal as a terminal chunk. It is marked as local admission
 * so the gateway can answer with a plain 429 before any stream starts, and
 * carries the window end so that answer says when to retry.
 */
export function budgetRefusalChunk(error: GatewayBudgetError): { kind: 'error'; code: string; message: string; failure: ModelFailureMetadata } {
  // Callers can read the window, remaining allowance and reset time from GET /v1/kun/limit.
  const limited = error.code === 'token_budget_exceeded' || error.code === 'cost_limit_exceeded'
  const resetAt = limited && error.resetsAt !== undefined ? new Date(error.resetsAt).toISOString() : undefined
  return { kind: 'error', code: error.code, message: limited ? `${error.message}${resetAt ? ` It resets at ${resetAt}.` : ''} See GET /v1/kun/limit for this key's limits.` : error.message,
    failure: { category: 'request', reason: 'request', localAdmission: true, httpStatus: limited ? 429
      : error.code === 'token_budget_unbounded' ? 400 : 503, ...(resetAt ? { resetAt } : {}), failoverAllowed: false } }
}
