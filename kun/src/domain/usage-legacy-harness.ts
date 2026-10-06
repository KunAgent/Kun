import { emptyUsageSnapshot, type UsageSnapshot } from '../contracts/usage.js'
import { diffUsage, hasUsage } from './usage.js'

/**
 * Index-only source tag for usage an external Agent reported before its usage
 * was folded into the thread ledger (kun/src/runtime/harness-usage-ledger.ts).
 * Those events carry raw per-call or per-turn values — or, for ACP, context
 * occupancy — instead of thread-cumulative snapshots. The stored values stay
 * untouched (the live counter is seeded from them); only their accounting
 * changes. Records expose them as `harness-reported`.
 */
export const LEGACY_HARNESS_USAGE_SOURCE = 'harness-legacy'

/** Turn id -> harness id for turns that ran on an external Agent. */
export type DelegatedTurnHarnesses = ReadonlyMap<string, string>

export function isLegacyHarnessUsage(
  event: { turnId?: string; source?: string },
  delegatedTurns: DelegatedTurnHarnesses
): boolean {
  return !event.source && Boolean(event.turnId && delegatedTurns.has(event.turnId))
}

function sameCounters(left: UsageSnapshot, right: UsageSnapshot): boolean {
  return left.promptTokens === right.promptTokens && left.completionTokens === right.completionTokens &&
    left.totalTokens === right.totalTokens && (left.cachedTokens ?? 0) === (right.cachedTokens ?? 0)
}

/**
 * Per-thread differential accounting over usage rows in sequence order.
 * Cumulative rows yield their growth since the previous row. A legacy
 * external-Agent row is its own increment when it reports output tokens:
 * ACP prompt results, Codex/Pi per-call reports, SDK query results and
 * Cursor turn reports all do, while ACP context-occupancy updates carry
 * none and are skipped. A repeated identical report is counted once.
 */
export class UsageDeltaFold {
  /** Raw value of the latest row: the base the live counter continues from. */
  previous: UsageSnapshot = emptyUsageSnapshot()
  private previousLegacy: UsageSnapshot | undefined

  next(usage: UsageSnapshot, legacy: boolean): UsageSnapshot | undefined {
    if (legacy) {
      const repeated = this.previousLegacy !== undefined && sameCounters(this.previousLegacy, usage)
      this.previousLegacy = usage
      this.previous = usage
      if (repeated || usage.completionTokens <= 0) return undefined
      const hits = usage.cacheHitTokens ?? usage.cachedTokens
      return {
        ...usage,
        turns: usage.turns > 0 ? usage.turns : 1,
        ...(hits !== undefined && usage.cacheMissTokens === undefined
          ? { cacheMissTokens: Math.max(0, usage.promptTokens - hits) } : {})
      }
    }
    this.previousLegacy = undefined
    const delta = diffUsage(usage, this.previous)
    this.previous = usage
    return hasUsage(delta) ? delta : undefined
  }
}
