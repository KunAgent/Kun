import { randomUUID } from 'node:crypto'

/**
 * Anthropic thinking over the local gateway.
 *
 * Request side: `thinking` and `output_config.effort` become the canonical
 * reasoning effort; replayed `thinking` text becomes reasoning history (the
 * DeepSeek family needs it back). Provider-private signatures are restored by
 * call id from the continuation store, so a client-held signature is never
 * forwarded upstream.
 *
 * Response side: reasoning deltas become a `thinking` block whose signature is
 * a gateway-scoped opaque token. Claude Code requires a non-empty signature
 * and echoes it back unchanged; the gateway ignores it on the next request.
 */
export const GATEWAY_THINKING_SIGNATURE_PREFIX = 'kungw1.'

export function gatewayThinkingSignature(): string {
  return `${GATEWAY_THINKING_SIGNATURE_PREFIX}${randomUUID().replace(/-/g, '')}`
}

const EFFORT_ALIASES: Record<string, string> = {
  low: 'low', medium: 'medium', high: 'high', xhigh: 'max', max: 'max', minimal: 'low'
}

/** Budget thresholds follow Claude Code's own effort → budget mapping, rounded to coarse levels. */
function effortFromBudget(budget: unknown): string {
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) return 'high'
  if (budget <= 4_096) return 'low'
  if (budget <= 16_384) return 'medium'
  if (budget <= 32_768) return 'high'
  return 'max'
}

/**
 * Returns the canonical reasoning effort for an Anthropic request, or
 * undefined to keep the route's default. Throws on shapes the gateway cannot
 * honor faithfully.
 */
export function anthropicReasoningEffort(thinking: Record<string, unknown> | undefined,
  outputConfig: Record<string, unknown> | undefined, present: { thinking: boolean; outputConfig: boolean }): string | undefined {
  if (present.outputConfig) {
    const extra = Object.keys(outputConfig ?? {}).filter((key) => key !== 'effort')
    if (extra.length) throw new Error(`Anthropic output_config.${extra[0]} is not supported by the local gateway`)
  }
  const requested = typeof outputConfig?.effort === 'string' ? outputConfig.effort.toLowerCase() : undefined
  if (requested !== undefined && !EFFORT_ALIASES[requested]) throw new Error(`Unsupported output_config.effort '${requested}'`)
  if (!present.thinking) return requested ? EFFORT_ALIASES[requested] : undefined
  const type = thinking?.type
  const allowed = type === 'enabled' ? ['type', 'budget_tokens', 'display'] : ['type', 'display']
  if (Object.keys(thinking ?? {}).some((key) => !allowed.includes(key))) {
    throw new Error('Unsupported Anthropic thinking fields for the local gateway')
  }
  if (type === 'disabled') return 'off'
  if (type === 'adaptive') return requested ? EFFORT_ALIASES[requested] : 'auto'
  if (type === 'enabled') return requested ? EFFORT_ALIASES[requested] : effortFromBudget(thinking?.budget_tokens)
  throw new Error(`Unsupported Anthropic thinking type '${String(type)}'`)
}
