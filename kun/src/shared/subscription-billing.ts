export type SubscriptionBillingInput = {
  authType?: 'api-key' | 'oauth' | 'subscription'
  presetSource?: string
  providerId?: string
  baseUrl?: string
}

/**
 * Subscription status is configured identity, not a model-name heuristic.
 * The official Codex endpoint remains an intentionally strict legacy fallback.
 */
export function subscriptionBillingKind(
  input: SubscriptionBillingInput
): 'subscription' | undefined {
  if (input.authType === 'subscription') return 'subscription'
  if (input.authType === 'oauth' && normalize(input.presetSource) === 'codex') {
    return 'subscription'
  }
  return isLegacyCodexEndpoint(input.baseUrl) ? 'subscription' : undefined
}

function isLegacyCodexEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false
  try {
    const url = new URL(baseUrl.trim())
    return url.protocol === 'https:' &&
      url.hostname === 'chatgpt.com' &&
      url.pathname.replace(/\/+$/u, '').startsWith('/backend-api/codex')
  } catch {
    return false
  }
}

function normalize(value?: string): string {
  return value?.trim().toLowerCase() ?? ''
}
