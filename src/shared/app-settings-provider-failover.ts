import type {
  ModelProviderEndpointsV1,
  ModelRouteHealthPolicyV1,
  ModelProviderFailoverAccountV1,
  ModelProviderFailoverTargetV1,
  ModelProviderFailoverV1,
  ModelProviderProfileV1,
  ModelProviderSettingsV1,
  ProviderAccountStrategy
} from './app-settings-types'
import { PROVIDER_ACCOUNT_STRATEGIES } from './app-settings-types'
import { normalizeModelProviderId } from './app-settings-provider-capabilities'
import { boundedNonNegativeInteger } from './app-settings-provider-profiles'

const MAX_PROVIDER_URL_LENGTH = 2_048

function normalizeEndpointUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_PROVIDER_URL_LENGTH) return undefined
  if (!/^https?:\/\//iu.test(trimmed)) return undefined
  return trimmed.replace(/\/+$/u, '')
}

export function normalizeModelProviderEndpoints(
  input: Partial<ModelProviderEndpointsV1> | null | undefined
): ModelProviderEndpointsV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const endpoints: ModelProviderEndpointsV1 = {}
  const chat = normalizeEndpointUrl(input.chat_completions)
  const responses = normalizeEndpointUrl(input.responses)
  const messages = normalizeEndpointUrl(input.messages)
  if (chat) endpoints.chat_completions = chat
  if (responses) endpoints.responses = responses
  if (messages) endpoints.messages = messages
  return Object.keys(endpoints).length > 0 ? endpoints : undefined
}

export function normalizeModelProviderCatalogSources(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  const sources = new Set<string>()
  for (const raw of input.slice(0, 8)) {
    if (typeof raw !== 'string') continue
    const key = raw.trim().toLowerCase()
    if (key && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(key)) sources.add(key)
  }
  return sources.size > 0 ? [...sources] : undefined
}

export function normalizeProviderIconId(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const id = input.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(id) ? id : undefined
}

/**
 * Loopback and private-network endpoints (LM Studio, vLLM, local Ollama)
 * legitimately serve without credentials, so the API-key requirement is
 * lifted for them. The key field stays editable — some local servers do
 * enforce a key.
 */
export function isLocalModelProviderBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/\.$/u, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1' || host === '[::1]') return true
  if (host === '0.0.0.0') return true
  const parts = host.split('.')
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/u.test(part))) {
    const [a, b] = parts.map(Number)
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  return false
}

export function normalizeProviderAccountStrategy(value: unknown): ProviderAccountStrategy {
  return PROVIDER_ACCOUNT_STRATEGIES.includes(value as ProviderAccountStrategy)
    ? value as ProviderAccountStrategy
    : 'smart'
}

function normalizeFailoverAccount(raw: unknown): ModelProviderFailoverAccountV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const providerId = normalizeModelProviderId((raw as ModelProviderFailoverAccountV1).providerId)
  if (!providerId) return null
  return { providerId, enabled: (raw as ModelProviderFailoverAccountV1).enabled !== false }
}

function normalizeFailoverTarget(raw: unknown): ModelProviderFailoverTargetV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as ModelProviderFailoverTargetV1
  const providerId = normalizeModelProviderId(entry.providerId)
  const modelId = typeof entry.modelId === 'string' ? entry.modelId.trim().slice(0, 512) : ''
  return providerId && modelId ? { providerId, modelId } : null
}

/**
 * Normalizes durable failover entries. Entries whose representative or members
 * are missing stay in settings (the UI can flag them); the executable
 * projection drops them so a stale reference never reaches the runtime.
 */
export function normalizeModelProviderFailover(
  input: readonly Partial<ModelProviderFailoverV1>[] | undefined
): ModelProviderFailoverV1[] {
  const out: ModelProviderFailoverV1[] = []
  const usedRepresentatives = new Set<string>()
  for (const raw of Array.isArray(input) ? input.slice(0, 100) : []) {
    const providerId = normalizeModelProviderId(raw?.providerId)
    if (!providerId || usedRepresentatives.has(providerId)) continue
    const members = new Set<string>([providerId])
    const accounts = (Array.isArray(raw?.accounts) ? raw.accounts : [])
      .slice(0, 20)
      .flatMap((entry: unknown) => {
        const account = normalizeFailoverAccount(entry)
        if (!account || members.has(account.providerId)) return []
        members.add(account.providerId)
        return [account]
      })
    const fallbackTargets = (Array.isArray(raw?.fallbackTargets) ? raw.fallbackTargets : [])
      .slice(0, 20)
      .flatMap((entry: unknown) => {
        const target = normalizeFailoverTarget(entry)
        return target && !members.has(target.providerId) ? [target] : []
      })
    usedRepresentatives.add(providerId)
    out.push({
      providerId,
      accounts,
      strategy: normalizeProviderAccountStrategy(raw?.strategy),
      fallbackTargets
    })
  }
  return out
}

/** Drops failover references that no longer resolve to a configured provider. */
export function projectExecutableProviderFailover(
  settings: Pick<ModelProviderSettingsV1, 'providers' | 'failover'>
): ModelProviderFailoverV1[] {
  const known = new Set(settings.providers.map((provider) => provider.id))
  return (settings.failover ?? []).flatMap((group) => {
    if (!known.has(group.providerId)) return []
    const accounts = group.accounts.filter((account) => known.has(account.providerId))
    const fallbackTargets = group.fallbackTargets.filter((target) =>
      known.has(target.providerId) &&
      settings.providers.some((provider) =>
        provider.id === target.providerId && provider.models.includes(target.modelId)
      )
    )
    if (accounts.length === 0 && fallbackTargets.length === 0) return []
    return [{ ...group, accounts, fallbackTargets }]
  })
}

/**
 * Wire shape consumed by Kun globals/config: every member (representative
 * first) carries its declared model list so the runtime can decide per
 * request whether the account serves the model. Members whose provider is
 * missing from settings are dropped by the executable projection.
 */
export function projectFailoverGroupsForRuntime(
  settings: Pick<ModelProviderSettingsV1, 'providers' | 'failover'>
): {
  providerId: string
  members: { providerId: string; enabled: boolean; models: string[] }[]
  strategy: ProviderAccountStrategy
  fallbackTargets: ModelProviderFailoverTargetV1[]
}[] {
  const providersById = new Map(settings.providers.map((provider) => [provider.id, provider]))
  return projectExecutableProviderFailover(settings).map((group) => ({
    providerId: group.providerId,
    members: [
      {
        providerId: group.providerId,
        enabled: true,
        models: [...(providersById.get(group.providerId)?.models ?? [])]
      },
      ...group.accounts.map((account) => ({
        providerId: account.providerId,
        enabled: account.enabled,
        models: [...(providersById.get(account.providerId)?.models ?? [])]
      }))
    ],
    strategy: group.strategy,
    fallbackTargets: group.fallbackTargets.map((target) => ({
      providerId: target.providerId,
      modelId: target.modelId
    }))
  }))
}

/** Finds the failover group that governs a provider id (representative or member). */
export function modelProviderFailoverGroup(
  settings: Pick<ModelProviderSettingsV1, 'failover'>,
  providerId: string
): ModelProviderFailoverV1 | undefined {
  const id = normalizeModelProviderId(providerId)
  return (settings.failover ?? []).find((group) =>
    group.providerId === id || group.accounts.some((account) => account.providerId === id)
  )
}

/** All provider ids governed by a failover group, representative first. */
export function modelProviderFailoverMemberIds(group: ModelProviderFailoverV1): string[] {
  return [group.providerId, ...group.accounts.map((account) => account.providerId)]
}

/**
 * The provider id a selector should show for `providerId`: group members are
 * represented by the group's representative so pickers show one row.
 */
export function modelProviderDisplayId(
  settings: Pick<ModelProviderSettingsV1, 'failover'>,
  providerId: string
): string {
  return modelProviderFailoverGroup(settings, providerId)?.providerId ?? providerId
}

/** Whether `providerId` participates in an enabled failover group. */
export function modelProviderInFailoverGroup(
  settings: Pick<ModelProviderSettingsV1, 'failover'>,
  providerId: string
): boolean {
  return modelProviderFailoverGroup(settings, providerId) !== undefined
}

/**
 * Removes failover entries that reference `providerId` — used when a provider
 * is deleted. The representative's group is dropped entirely; a member is
 * removed from its group, and the group is dropped when no members remain.
 */
export function modelProviderFailoverAfterRemoval(
  failover: readonly ModelProviderFailoverV1[] | undefined,
  removedProviderId: string
): ModelProviderFailoverV1[] {
  const removed = normalizeModelProviderId(removedProviderId)
  return (failover ?? []).flatMap((group) => {
    if (group.providerId === removed) return []
    const accounts = group.accounts.filter((account) => account.providerId !== removed)
    const fallbackTargets = group.fallbackTargets.filter((target) => target.providerId !== removed)
    if (accounts.length === 0 && fallbackTargets.length === 0) return []
    return [{ ...group, accounts, fallbackTargets }]
  })
}

const HEALTH_POLICY_EXTRA_KEYS = [
  'creditCooldownMs',
  'quotaCooldownMs',
  'authCooldownMs',
  'maxCooldownMs'
] as const

/**
 * Optional reason-specific cooldown overrides on a route pool's health
 * policy. Missing keys stay absent so kun defaults apply.
 */
export function normalizeRouteHealthPolicyExtras(
  raw: { healthPolicy?: Record<string, unknown> } | null | undefined
): Partial<ModelRouteHealthPolicyV1> {
  const extras: Partial<ModelRouteHealthPolicyV1> = {}
  for (const key of HEALTH_POLICY_EXTRA_KEYS) {
    const value = raw?.healthPolicy?.[key]
    if (value === undefined) continue
    extras[key] = Math.min(
      86_400_000,
      Math.max(
        1_000,
        boundedNonNegativeInteger(value, key === 'maxCooldownMs' ? 600_000 : 1_800_000, 86_400_000)
      )
    )
  }
  return extras
}
