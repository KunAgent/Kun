import type { ComposerSubscriptionQuotaQuery, ComposerSubscriptionQuotaResponse } from '../contracts/composer-subscription-quota.js'
import type { ProviderQuotaEntry } from '../contracts/provider-quota.js'
import type { ProviderQuotaProbeProfile } from './provider-subscription-quota-service.js'
import type { ProviderQuotaSourceSnapshot } from './provider-quota-service-core.js'
import { providerQuotaIdentity } from './provider-quota-security.js'
import { validClaudeToken } from './provider-subscription-quota-metrics.js'
import { parseStoredCodexOAuthCredentials } from './codex-oauth-credential-refresher.js'

export type NativeSubscriptionProfileResolver = (harnessId: 'claude-code' | 'codex') => Promise<ProviderQuotaProbeProfile | undefined>
type Selection = { profile: ProviderQuotaProbeProfile; supported: boolean }

/** The composer's exact billing route, with no model-name/preset-first account inference. */
export async function queryComposerSubscriptionQuota(query: ComposerSubscriptionQuotaQuery, deps: {
  loadSource: () => Promise<ProviderQuotaSourceSnapshot>
  native: NativeSubscriptionProfileResolver
  refresh: (profile: ProviderQuotaProbeProfile) => Promise<ProviderQuotaEntry>
  nowIso: () => string
  publicScopeKey: (identity: string) => string
}): Promise<ComposerSubscriptionQuotaResponse> {
  const empty = (): ComposerSubscriptionQuotaResponse => ({ entry: null, refreshedAt: deps.nowIso() })
  if (!['kun', 'claude-code', 'codex'].includes(query.harnessId) || query.gatewayBinding) return empty()
  const select = async (): Promise<Selection | undefined> => {
    const source = await deps.loadSource()
    const mode = query.credentialMode ?? (query.harnessId === 'kun' ? 'provider' : 'native-login')
    const native = mode === 'native-login'
    const id = query.providerId?.trim() ?? ''
    let profile: ProviderQuotaProbeProfile | undefined
    if (native && (!id || id === 'default')) {
      if ((query.harnessId !== 'claude-code' && query.harnessId !== 'codex') || query.accountId) return undefined
      // The SDK uses the runtime default token only when that default itself
      // is an agent-sdk route; otherwise it launches the system Claude login.
      const defaultProfile = source.profiles.find((item) => item.id === (source.defaultProviderId ?? 'default'))
      profile = query.harnessId === 'claude-code' && defaultProfile?.kind === 'agent-sdk'
        ? defaultProfile : await deps.native(query.harnessId)
    } else {
      if (!id || (native && query.harnessId === 'codex')) return undefined
      profile = source.profiles.find((item) => item.id === id)
      if (query.accountId && profile?.accountId !== query.accountId) return undefined
      if (native && profile?.kind !== 'agent-sdk') return undefined
    }
    // Legacy single-engine defaults predate preset metadata. Their SDK kind
    // and OAuth credential still identify the exact official account route.
    if (profile?.kind === 'agent-sdk' && !profile.presetId) profile = { ...profile, presetId: 'claude-subscription' }
    if (profile && (profile.presetId || profile.id) === 'codex') {
      const stored = parseStoredCodexOAuthCredentials(profile.apiKey)
      if (stored) {
        const headers = new Headers(profile.headers)
        if (!headers.has('chatgpt-account-id')) headers.set('chatgpt-account-id', stored.accountId)
        // This read follows the selected account exactly. Expired credentials
        // become missing rather than consulting an ambient/refresh-token cache.
        profile = { ...profile, apiKey: stored.accessToken, headers: Object.fromEntries(headers) }
      }
    }
    return profile ? { profile, supported: officialSubscriptionProfile(profile) } : undefined
  }
  // A credential/default route can change during a slow vendor request. Verify
  // it again before publishing; one bounded retry follows the new identity.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let selected: Selection | undefined
    try { selected = await select() } catch { return empty() }
    if (!selected) return empty()
    const { profile } = selected
    if (!selected.supported) return empty()
    const identity = providerQuotaIdentity(profile)
    if (profile.configured === false || !profile.apiKey.trim()) return {
      entry: { providerId: profile.id, providerName: profile.name, presetId: profile.presetId,
        status: 'missing_credentials', metrics: [] }, refreshedAt: deps.nowIso(), scopeKey: deps.publicScopeKey(identity)
    }
    const entry = await deps.refresh(profile)
    let current: Selection | undefined
    try { current = await select() } catch { return empty() }
    if (!current?.supported || providerQuotaIdentity(current.profile) !== identity) continue
    // Only official renewing subscription windows can reach this surface.
    const metrics = entry.metrics.filter((metric) => metric.unit === 'percent' &&
      typeof metric.usedPercent === 'number' && Number.isFinite(metric.usedPercent) &&
      metric.usedPercent >= 0 && metric.usedPercent <= 100)
    return { entry: { ...entry, metrics, localCost: undefined }, refreshedAt: entry.updatedAt ?? deps.nowIso(), scopeKey: deps.publicScopeKey(identity) }
  }
  return empty()
}

function officialSubscriptionProfile(profile: ProviderQuotaProbeProfile): boolean {
  const preset = profile.presetId || profile.id
  if (profile.authType === 'api-key' || profile.authType === 'none') return false
  if (profile.authProfile?.mode === 'header') return false
  if (preset === 'claude-subscription' && profile.kind === 'agent-sdk') {
    if (profile.baseUrl && !officialHost(profile.baseUrl, 'api.anthropic.com')) return false
    return !profile.apiKey.trim() || validClaudeToken(profile.apiKey)
  }
  if (preset === 'codex' && profile.kind === 'http' && officialHost(profile.baseUrl, 'chatgpt.com')) {
    return !/^sk-/i.test(profile.apiKey.trim())
  }
  return false
}

function officialHost(value: string | undefined, host: string): boolean {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && url.host === host && !url.username && !url.password }
  catch { return false }
}
