export type ProviderCapabilityCacheKey = {
  providerId: string
  accountId?: string
  baseUrl?: string
  endpointFormat?: string
  credentialVersion?: string
  providerVersion?: string
}

export type ProviderCapabilityCacheOptions = {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

const DEFAULT_TTL_MS = 5 * 60_000
const MAX_TTL_MS = 24 * 60 * 60_000
const DEFAULT_MAX_ENTRIES = 128
const MAX_CACHE_ENTRIES = 1024

function requiredPart(value: string): string {
  if (typeof value !== 'string') throw new TypeError('provider capability key part is invalid')
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f)) {
      throw new TypeError('provider capability key contains a control character')
    }
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > 256) throw new TypeError('provider capability key part is invalid')
  return normalized
}

function optionalPart(value: string | undefined): string | undefined {
  return value === undefined ? undefined : requiredPart(value)
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined || !value.trim()) return undefined
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError('provider capability baseUrl must be an absolute URL')
  }
  if (parsed.username || parsed.password) throw new TypeError('provider capability baseUrl must not contain credentials')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

export function createProviderCapabilityCacheKey(input: ProviderCapabilityCacheKey): string {
  const normalized = {
    providerId: requiredPart(input.providerId),
    accountId: optionalPart(input.accountId),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    endpointFormat: optionalPart(input.endpointFormat),
    credentialVersion: optionalPart(input.credentialVersion),
    providerVersion: optionalPart(input.providerVersion)
  }
  return JSON.stringify(normalized)
}

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  const candidate = value ?? fallback
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > max) {
    throw new TypeError('provider capability cache option is invalid')
  }
  return candidate
}

type CacheEntry<T> = {
  value: T
  expiresAt: number
  touchedAt: number
}

/**
 * Bounded in-memory capability cache. It intentionally has no persistence or
 * credential access; callers must include a credential/config version in the
 * key when a provider capability result depends on those inputs.
 */
export class ProviderCapabilityCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: ProviderCapabilityCacheOptions = {}) {
    this.ttlMs = boundedInteger(options.ttlMs, DEFAULT_TTL_MS, MAX_TTL_MS)
    this.maxEntries = boundedInteger(options.maxEntries, DEFAULT_MAX_ENTRIES, MAX_CACHE_ENTRIES)
    this.now = options.now ?? Date.now
  }

  get(key: ProviderCapabilityCacheKey): T | undefined {
    const cacheKey = createProviderCapabilityCacheKey(key)
    const entry = this.entries.get(cacheKey)
    if (!entry) return undefined
    const now = this.now()
    if (entry.expiresAt <= now) {
      this.entries.delete(cacheKey)
      return undefined
    }
    entry.touchedAt = now
    return entry.value
  }

  set(key: ProviderCapabilityCacheKey, value: T): void {
    const cacheKey = createProviderCapabilityCacheKey(key)
    const now = this.now()
    this.pruneExpired(now)
    this.entries.set(cacheKey, { value, expiresAt: now + this.ttlMs, touchedAt: now })
    while (this.entries.size > this.maxEntries) {
      const oldest = [...this.entries.entries()].sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0]
      if (!oldest) break
      this.entries.delete(oldest[0])
    }
  }

  invalidate(key: ProviderCapabilityCacheKey): boolean {
    return this.entries.delete(createProviderCapabilityCacheKey(key))
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    this.pruneExpired(this.now())
    return this.entries.size
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
  }
}
