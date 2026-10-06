import type { ProviderAuthProfile, ProviderHeaderProfile, ProviderRequestPurpose } from '../contracts/provider-configuration.js'

const authNames = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'api-key', 'x-goog-api-key'])
export class ProviderSecretScopeError extends Error {
  constructor() { super('Provider credentials are not approved for this host and request purpose'); this.name = 'ProviderSecretScopeError' }
}

/** A host approval is exact, including its port. Public services never receive supplier secrets. */
export function assertProviderSecretScope(scope: ProviderAuthProfile['scope'] | undefined,
  requestUrl: string, purpose: ProviderRequestPurpose, fallbackUrls: readonly string[]): void {
  if (purpose === 'public-metadata') throw new ProviderSecretScopeError()
  const url = new URL(requestUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ProviderSecretScopeError()
  const allowedHosts = scope?.hosts ?? fallbackUrls.map((value) => new URL(value).host)
  if (!allowedHosts.includes(url.host) || (scope && !scope.purposes.includes(purpose))) throw new ProviderSecretScopeError()
}

export function providerAuthenticationHeaders(input: {
  apiKey: string; protocol?: string; authProfile?: ProviderAuthProfile;
  requestUrl: string; purpose: ProviderRequestPurpose; fallbackUrls: readonly string[]
}): Record<string, string> {
  if (!input.apiKey) return {}
  assertProviderSecretScope(input.authProfile?.scope, input.requestUrl, input.purpose, input.fallbackUrls)
  if (input.authProfile?.mode === 'header') return { [input.authProfile.headerName!]: `${input.authProfile.prefix}${input.apiKey}` }
  return input.protocol === 'messages'
    ? { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${input.apiKey}` }
}

/** Values stay encrypted in the credential store. A header profile only scopes their use. */
export function scopedProviderHeaders(input: {
  headers: Record<string, string>; headerProfile?: ProviderHeaderProfile; authProfile?: ProviderAuthProfile;
  requestUrl: string; purpose: ProviderRequestPurpose; fallbackUrls: readonly string[]
}): Record<string, string> {
  if (!Object.keys(input.headers).length) return {}
  assertProviderSecretScope(input.headerProfile?.scope, input.requestUrl, input.purpose, input.fallbackUrls)
  // Legacy imported headers retain their old behavior until an explicit profile is configured.
  if (input.authProfile && Object.keys(input.headers).some((name) => authNames.has(name.toLowerCase()) ||
    name.toLowerCase() === input.authProfile?.headerName?.toLowerCase())) {
    throw new Error('Authentication headers must be configured through the auth profile')
  }
  return { ...input.headers }
}

export function protectInferenceHeaders(input: {
  headers: Record<string, string>; apiKey: string; protocol: string; authProfile?: ProviderAuthProfile;
  headerProfile?: ProviderHeaderProfile; userHeaderNames?: readonly string[]; requestUrl: string; fallbackUrls: readonly string[];
}): Record<string, string> {
  if (!input.authProfile && !input.headerProfile) return input.headers
  if (input.authProfile) assertProviderSecretScope(input.authProfile.scope, input.requestUrl, 'inference', input.fallbackUrls)
  if (input.headerProfile && (input.userHeaderNames ?? Object.keys(input.headers)).length) assertProviderSecretScope(input.headerProfile.scope, input.requestUrl, 'inference', input.fallbackUrls)
  const auth = providerAuthenticationHeaders({ ...input, purpose: 'inference' })
  if (!input.authProfile) return input.headers
  const out = Object.fromEntries(Object.entries(input.headers).filter(([name]) => !authNames.has(name.toLowerCase()) &&
    name.toLowerCase() !== input.authProfile?.headerName?.toLowerCase()))
  return { ...out, ...auth }
}

/** OAuth bodies stay within immutable adapter issuers and the connection's explicit grant. */
export function scopedProviderOAuthFetch(fetcher: typeof fetch, authProfile?: ProviderAuthProfile): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
    if (url.protocol !== 'https:' || !['auth.openai.com', 'auth.x.ai'].includes(url.host)) throw new ProviderSecretScopeError()
    const request = typeof input === 'object' && !(input instanceof URL) ? input : undefined
    const publicMetadata = (init?.method ?? request?.method ?? 'GET') === 'GET' && !init?.body && !request?.body && [...new Headers(init?.headers ?? request?.headers).keys()].every((name) => ['accept', 'user-agent'].includes(name))
    if (!publicMetadata) assertProviderSecretScope(authProfile?.scope, url.toString(), 'oauth', ['https://auth.openai.com', 'https://auth.x.ai'])
    return fetcher(input, { ...init, redirect: 'error' })
  }
}

export function scopedProviderProtectedHeaders(input: {
  headers: Record<string, string>; authProfile?: ProviderAuthProfile; requestUrl: string;
  purpose: ProviderRequestPurpose; fallbackUrls: readonly string[]
}): Record<string, string> {
  if (!Object.keys(input.headers).length) return {}
  assertProviderSecretScope(input.authProfile?.scope, input.requestUrl, input.purpose, input.fallbackUrls)
  return Object.fromEntries(Object.entries(input.headers).filter(([name]) => !input.authProfile ||
    !authNames.has(name.toLowerCase()) && name.toLowerCase() !== input.authProfile.headerName?.toLowerCase()))
}
