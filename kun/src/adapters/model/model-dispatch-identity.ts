import { createHash } from 'node:crypto'
import type { ModelClient } from '../../ports/model-client.js'

/**
 * Where a client sends requests and with which credential material, as a
 * digest. Settings apply, Registry catch-up and metadata refresh rebuild every
 * client even when nothing a request depends on changed; dispatch fences use
 * this identity so such a rebuild is not mistaken for a provider change. A
 * client without an identity only ever matches itself.
 */
const identities = new WeakMap<ModelClient, string>()

export function withDispatchIdentity<T extends ModelClient>(client: T, identity: unknown): T {
  identities.set(client, createHash('sha256').update(canonicalJson(identity)).digest('hex'))
  return client
}

/** True when `current` would send exactly where `pinned` would, with the same credential. */
export function sameDispatchTarget(current: ModelClient | undefined, pinned: ModelClient): boolean {
  if (current === pinned) return true
  const identity = current ? identities.get(current) : undefined
  return identity !== undefined && identity === identities.get(pinned)
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, (entry as Record<string, unknown>)[key]]))
  }) ?? 'null'
}
