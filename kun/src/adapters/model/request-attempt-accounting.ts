import { randomUUID } from 'node:crypto'
import { emptyUsageSnapshot, type UsageSnapshot } from '../../contracts/usage.js'
import type { AttemptUsageTotals, ModelAttemptAccounting } from '../../contracts/model-attempt-accounting.js'
import { addUsage } from '../../domain/usage.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

/** Response usage stays response-local; the accounting annotation includes abandoned physical attempts. */
export function accountModelRequest(request: ModelRequest,
  execute: (request: ModelRequest) => AsyncIterable<ModelStreamChunk>): AsyncIterable<ModelStreamChunk> {
  const requestId = request.requestId ?? request.trace?.roundId ?? randomUUID()
  if (request.attemptObserver) return execute({ ...request, requestId })
  return (async function* () {
    const attempts: ModelAttemptAccounting['attempts'] = []
    let lastUsage: Extract<ModelStreamChunk, { kind: 'usage' }> | undefined
    let accounted = false
    const observed: ModelRequest = { ...request, requestId, attemptObserver: { async begin(input) {
      if (attempts.length >= 16) throw new Error('Model request attempt ledger limit exceeded')
      const attempt: ModelAttemptAccounting['attempts'][number] = { attemptId: randomUUID(),
        providerId: input.providerId, modelId: input.model, dispatched: false, usageKnown: false }
      attempts.push(attempt)
      return { async finish(usage, dispatched = true) {
        attempt.dispatched = dispatched; attempt.usageKnown = dispatched && usage !== undefined
        if (attempt.usageKnown) attempt.usage = totals(usage!)
      } }
    } } }
    const annotation = (): ModelAttemptAccounting => {
      const known = attempts.flatMap((attempt) => attempt.usageKnown && attempt.usage ? [attempt.usage] : [])
      const sum = known.reduce<UsageSnapshot>((result, usage) => addUsage(result, { ...emptyUsageSnapshot(), ...usage }), emptyUsageSnapshot())
      return { requestId, attempts: structuredClone(attempts), totals: totals(sum), usageKnown: known.length > 0, responseUsageKnown: Boolean(lastUsage) }
    }
    for await (const chunk of execute(observed)) {
      if (chunk.kind === 'usage' && attempts.length) { lastUsage = chunk; continue }
      if ((chunk.kind === 'completed' || chunk.kind === 'error') && attempts.length && !accounted) {
        accounted = true
        yield { ...(lastUsage ?? { kind: 'usage' as const, usage: emptyUsageSnapshot() }),
          usage: { ...(lastUsage?.usage ?? emptyUsageSnapshot()), attemptAccounting: annotation() } }
      }
      yield chunk
    }
    if (attempts.length && !accounted) yield { kind: 'usage', usage: {
      ...(lastUsage?.usage ?? emptyUsageSnapshot()), attemptAccounting: annotation() } }
  })()
}

function totals(usage: UsageSnapshot): AttemptUsageTotals {
  const { promptTokens, completionTokens, totalTokens, cachedTokens, cacheHitTokens, cacheMissTokens,
    cacheWriteTokens, reasoningTokens, costUsd, costCny, costByCurrency, cacheSavingsUsd, cacheSavingsCny } = usage
  return { promptTokens, completionTokens, totalTokens, cachedTokens, cacheHitTokens, cacheMissTokens,
    cacheWriteTokens, reasoningTokens, costUsd, costCny, costByCurrency, cacheSavingsUsd, cacheSavingsCny }
}
