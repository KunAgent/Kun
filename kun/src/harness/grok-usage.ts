import type { AcpUsage } from '../runtime/acp/acp-usage-types.js'

/**
 * Grok Build answers `session/prompt` with `{ stopReason, _meta }` and no standard
 * `usage`. The turn's usage is `_meta.usage`: totals across every model call of
 * the prompt, in ACP's convention (`inputTokens` includes cache reads,
 * `totalTokens` is input plus output, reasoning tokens are part of the output).
 * The flat `_meta.inputTokens` copies beside it are not used because their
 * `totalTokens` differs from the nested one.
 *
 * `costUsdTicks` (1e-10 USD) is deliberately not forwarded: a Grok login is a
 * subscription, so the figure is list value rather than a charge.
 */
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined

export function grokPromptResultUsage(meta: Record<string, unknown>): AcpUsage | undefined {
  const reported = meta.usage
  if (!reported || typeof reported !== 'object' || Array.isArray(reported)) return undefined
  const usage = reported as Record<string, unknown>
  const inputTokens = count(usage.inputTokens)
  const outputTokens = count(usage.outputTokens)
  if ((inputTokens ?? 0) + (outputTokens ?? 0) <= 0) return undefined
  const totalTokens = count(usage.totalTokens)
  const cachedReadTokens = count(usage.cachedReadTokens)
  const cachedWriteTokens = count(usage.cacheCreationTokens)
  const thoughtTokens = count(usage.reasoningTokens)
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cachedReadTokens ? { cachedReadTokens } : {}),
    ...(cachedWriteTokens ? { cachedWriteTokens } : {}),
    ...(thoughtTokens ? { thoughtTokens } : {})
  }
}
