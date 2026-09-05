type RegistryProxyDocument = {
  proxy: { enabled: boolean; url: string }
}

type RegistryProxyProfile = {
  id: string
  kind: string
  useProxy: boolean
}

export function upgradeRegistryProxyRouting(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const document = value as Record<string, unknown>
  if (document.proxyRoutingVersion === 1) return value
  const proxy = document.proxy && typeof document.proxy === 'object'
    ? document.proxy as Record<string, unknown>
    : undefined
  const inheritProxy = proxy?.enabled === true
  const profiles = document.profiles && typeof document.profiles === 'object' &&
    !Array.isArray(document.profiles)
    ? Object.fromEntries(Object.entries(document.profiles as Record<string, unknown>).map(
      ([id, profile]) => [id, profile && typeof profile === 'object' && !Array.isArray(profile)
        ? {
            ...profile as Record<string, unknown>,
            useProxy: typeof (profile as Record<string, unknown>).useProxy === 'boolean'
              ? (profile as Record<string, unknown>).useProxy
              : inheritProxy
          }
        : profile]
    ))
    : document.profiles
  return { ...document, proxyRoutingVersion: 1, profiles }
}

export class ProviderProxyConfigurationError extends Error {
  readonly code = 'provider_proxy_invalid'

  constructor(readonly providerId: string) {
    super(`Provider ${providerId} selected the app proxy, but the proxy configuration is invalid.`)
    this.name = 'ProviderProxyConfigurationError'
  }
}

export function profileSupportsAppProxy(profile: Pick<RegistryProxyProfile, 'kind'>): boolean {
  return profile.kind !== 'agent-sdk' &&
    profile.kind !== 'antigravity-cli' &&
    profile.kind !== 'cursor-sdk'
}

export function resolveRegistryProfileProxyUrl(
  document: RegistryProxyDocument,
  profile: RegistryProxyProfile
): string {
  if (!profileSupportsAppProxy(profile) || !profile.useProxy || !document.proxy.enabled) return ''
  const url = normalizeRegistryProxyUrl(document.proxy.url)
  if (!url) throw new ProviderProxyConfigurationError(profile.id)
  return url
}

function normalizeRegistryProxyUrl(value: string): string {
  try {
    const parsed = new URL(value.trim())
    const protocol = parsed.protocol.replace(/:$/u, '').toLowerCase()
    if (!['http', 'https', 'socks', 'socks4', 'socks4a', 'socks5', 'socks5h'].includes(protocol)) {
      return ''
    }
    return parsed.hostname ? parsed.toString() : ''
  } catch {
    return ''
  }
}
