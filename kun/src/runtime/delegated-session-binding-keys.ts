import { createHash } from 'node:crypto'
import type { DelegatedSessionRoute } from './delegated-session-binding.js'

/**
 * Stable identity of a route — keys provider-state dirs and parked entries.
 * Projects the route fields explicitly so a DelegatedSessionBinding (a
 * superset) hashes to the same key as the plain route.
 */
export function delegatedRouteKey(route: DelegatedSessionRoute): string {
  return sha256(stableStringify({
    providerKind: route.providerKind,
    providerId: route.providerId,
    credentialIdentity: route.credentialIdentity,
    workspace: route.workspace,
    model: route.model,
    capabilityFingerprint: route.capabilityFingerprint,
    continuationMode: route.continuationMode
  }))
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableStringify(record[key])}`
  ).join(',')}}`
}

export function threadKey(threadId: string): string {
  return sha256(threadId)
}
