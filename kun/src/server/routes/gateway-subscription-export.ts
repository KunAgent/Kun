import type { ModelConnectionSnapshot } from '../../contracts/model-connections.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Experimental, opt-in export of a ChatGPT subscription connection through
 * the gateway. Subscription access is a native entitlement, so it is never
 * exported by default; the user must name the connection in gateway
 * settings after reading the risk notice. Only the ChatGPT preset qualifies:
 * Claude subscriptions run through the official Agent SDK and are never
 * projected as a model API.
 */
const EXPERIMENTAL_SUBSCRIPTION_PRESETS = new Set(['codex'])

export function experimentalSubscriptionEligible(provider: ModelConnectionSnapshot['providers'][number]): boolean {
  return provider.kind === 'http' && (provider.authType === 'oauth' || provider.authType === 'subscription') &&
    EXPERIMENTAL_SUBSCRIPTION_PRESETS.has(provider.presetSource ?? provider.id)
}

/** The snapshot the gateway authorizes against: opted-in subscriptions appear as ready API connections. */
export function gatewayExportSnapshot(snapshot: ModelConnectionSnapshot, optedIn: readonly string[]): ModelConnectionSnapshot {
  if (!optedIn.length) return snapshot
  const allowed = new Set(optedIn)
  return { ...snapshot, providers: snapshot.providers.map((provider) =>
    allowed.has(provider.id) && experimentalSubscriptionEligible(provider) && provider.credentialStatus === 'ready' && provider.enabled !== false
      ? { ...provider, authType: 'api-key' as const } : provider) }
}

export async function gatewaySnapshot(runtime: ServerRuntime): Promise<ModelConnectionSnapshot | undefined> {
  const snapshot = await runtime.modelConnections?.snapshot()
  return snapshot ? gatewayExportSnapshot(snapshot, runtime.modelGateway?.experimentalSubscriptionExports?.() ?? []) : undefined
}
