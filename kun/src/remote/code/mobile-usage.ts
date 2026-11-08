import type { UsageSnapshot } from '../../contracts/usage.js'
import type { MobileUsage } from '@kun/remote-protocol'

const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
/** Allowlisted counters only: never forward context prompts, active skills, providers or paths. */
export function mobileUsage(usage: UsageSnapshot | undefined, context: unknown): MobileUsage | undefined {
  const raw = context && typeof context === 'object' ? context as Record<string, unknown> : {}
  const used = count(raw.estimatedInputTokens), window = count(raw.contextWindowTokens)
  const recorded = Boolean(usage && (usage.turns > 0 || usage.totalTokens > 0))
  if (!recorded && used === undefined) return undefined
  return {
    ...(recorded ? { inputTokens: count(usage!.promptTokens), outputTokens: count(usage!.completionTokens), totalTokens: count(usage!.totalTokens) } : {}),
    ...(used !== undefined ? { context: { usedTokens: used,
      ...(raw.contextWindowKnown === true && window && window > 0 ? { windowTokens: window } : {}),
      source: raw.occupancySource === 'agent' ? 'agent' as const : 'estimate' as const } } : {})
  }
}
