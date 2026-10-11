/**
 * The Agent SDK's `total_cost_usd` is a running total: a query that resumes a
 * session also reports the session's earlier spend (Claude Code v2.1.277+;
 * older versions restart at zero). Kun's usage ledger sums per-turn
 * increments, so convert each result to the spend added since the previous
 * result of the same session. With no previous total for a resumed session
 * (for example after an app restart) the increment is unknown and omitted
 * rather than counting the restored spend again.
 * https://code.claude.com/docs/en/agent-sdk/cost-tracking
 */
const SESSION_LIMIT = 256
const totals = new Map<string, number>()

export function sdkCostIncrement(
  sessionId: unknown,
  totalCostUsd: unknown,
  resumedQuery: boolean | undefined
): number | undefined {
  if (typeof totalCostUsd !== 'number' || !Number.isFinite(totalCostUsd) || totalCostUsd < 0) return undefined
  if (typeof sessionId !== 'string' || !sessionId) return resumedQuery ? undefined : totalCostUsd
  const previous = totals.get(sessionId)
  totals.delete(sessionId)
  if (totals.size >= SESSION_LIMIT) totals.delete(totals.keys().next().value!)
  totals.set(sessionId, totalCostUsd)
  if (previous === undefined) return resumedQuery ? undefined : totalCostUsd
  // A total below the previous one means the session's counter restarted.
  return totalCostUsd >= previous ? totalCostUsd - previous : totalCostUsd
}

/** Test hook. */
export function resetSdkSessionCosts(): void { totals.clear() }
