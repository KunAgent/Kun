import { createHash } from 'node:crypto'
import type { ProviderQuotaFetch, ProviderQuotaProbeProfile } from './provider-subscription-quota-service.js'
import type { ProviderQuotaProbeKind } from './provider-quota-service-core.js'
import { assertProviderSecretScope } from './provider-request-security.js'

const hosts: Record<ProviderQuotaProbeKind, string[]> = {
  deepseek: ['api.deepseek.com'], openrouter: ['openrouter.ai'], 'moonshot-cn': ['api.moonshot.cn'],
  'moonshot-global': ['api.moonshot.ai'], zai: ['api.z.ai'], bigmodel: ['open.bigmodel.cn'],
  'minimax-global': ['api.minimax.io', 'api.minimaxi.com'], 'minimax-cn': ['api.minimaxi.com'],
  'kimi-code': ['api.kimi.com'], openai: ['api.openai.com'], 'claude-subscription': ['api.anthropic.com'],
  'codex-subscription': ['chatgpt.com', 'auth.openai.com'], 'grok-subscription': ['grok.com', 'auth.x.ai'],
  'cursor-subscription': ['cursor.com', 'www.cursor.com', 'api2.cursor.sh'],
  'antigravity-subscription': ['cloudcode-pa.googleapis.com', 'oauth2.googleapis.com'],
  'gemini-cli-subscription': ['cloudcode-pa.googleapis.com', 'oauth2.googleapis.com'], 'opencode-go-local': ['opencode.ai'],
  'siliconflow-cn': ['api.siliconflow.cn'], 'siliconflow-global': ['api.siliconflow.com'],
  'stepfun-cn': ['api.stepfun.com'], 'stepfun-global': ['api.stepfun.ai'], aihubmix: ['aihubmix.com'],
  // A new-api relay or a user-named balance endpoint is asked on the provider's own host, which already receives its key.
  'new-api': [],
  'custom-balance': []
}

function quotaHosts(provider: ProviderQuotaProbeProfile, kind: ProviderQuotaProbeKind): string[] {
  if (kind !== 'new-api' && kind !== 'custom-balance') return hosts[kind]
  try { return [new URL(provider.baseUrl ?? '').host] } catch { return [] }
}

/** Quota adapters own their fixed hosts; a profile may only narrow their credential purposes. */
export function scopedQuotaFetch(fetcher: ProviderQuotaFetch, provider: ProviderQuotaProbeProfile, kind: ProviderQuotaProbeKind): ProviderQuotaFetch {
  return async (url, init, proxyUrl) => {
    const destination = new URL(String(url))
    const allowed = quotaHosts(provider, kind)
    if (!allowed.includes(destination.host) || destination.protocol !== 'https:') throw new Error('Quota endpoint is outside the adapter credential scope')
    const refresh = typeof init?.body === 'string' && new URLSearchParams(init.body).has('refresh_token')
    const purpose = refresh ? 'oauth' : 'quota'
    const publicMetadata = !init?.body && [...new Headers(init?.headers).keys()].every((name) => ['accept', 'user-agent', 'if-none-match'].includes(name))
    if (!publicMetadata) assertProviderSecretScope(provider.authProfile?.scope, destination.toString(), purpose, allowed.map((host) => `https://${host}`))
    return fetcher(url, { ...init, redirect: 'error' }, proxyUrl)
  }
}

/** Credential bytes are never retained in the cache key, logs, or public quota records. */
export function providerQuotaIdentity(provider: ProviderQuotaProbeProfile): string {
  const headers = Object.fromEntries(Object.entries(provider.headers ?? {}).filter(([name]) => name.toLowerCase() !== 'session_id').sort(([a], [b]) => a.localeCompare(b)))
  return createHash('sha256').update(JSON.stringify({ id: provider.id, kind: provider.kind, presetId: provider.presetId,
    baseUrl: provider.baseUrl, balanceUrl: provider.balanceUrl, configured: provider.configured, key: provider.apiKey, credentialSourceId: provider.credentialSourceId,
    headers, authProfile: provider.authProfile, proxyUrl: provider.proxyUrl })).digest('hex')
}
