import { GOOGLE_WORKSPACE_IDENTITY_SCOPES, GOOGLE_WORKSPACE_SCOPES, type GoogleWorkspaceStatus } from './types.js'

const allowedScopes = new Set<string>([...GOOGLE_WORKSPACE_SCOPES, ...GOOGLE_WORKSPACE_IDENTITY_SCOPES])
/** Positive allowlist: upstream auth status also contains credential paths, masked identifiers and errors. */
export function sanitizeGoogleWorkspaceAuth(raw: unknown): GoogleWorkspaceStatus['auth'] {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const scopes = Array.isArray(value.scopes)
    ? [...new Set(value.scopes.filter((scope): scope is string => typeof scope === 'string' && allowedScopes.has(scope)))]
    : []
  const hasCredentials = value.encrypted_credentials_exists === true || value.plain_credentials_exists === true
  const invalid = value.encryption_valid === false || value.token_valid === false || value.credentials_readable === false
  const state = value.token_valid === true && !invalid ? 'connected'
    : !value.client_config_exists && !hasCredentials ? 'setup_required'
      : invalid || hasCredentials ? 'error' : 'disconnected'
  return { state, scopes }
}
/** Only gws's fixed Google installed-application flow can cross into the OS browser. */
export function validateGoogleAuthorizationUrl(raw: string): string | undefined {
  if (raw.length > 16_384 || [...raw].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.port ||
        url.username || url.password || url.hash || !['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname)) return undefined
    const redirect = new URL(url.searchParams.get('redirect_uri') ?? '')
    if (redirect.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname) ||
        !redirect.port || redirect.username || redirect.password || redirect.search || redirect.hash ||
        redirect.pathname !== '/') return undefined
    if (url.searchParams.get('response_type') !== 'code') return undefined
    const scopes = (url.searchParams.get('scope') ?? '').split(' ').filter(Boolean)
    if (!GOOGLE_WORKSPACE_SCOPES.every(scope => scopes.includes(scope)) ||
        scopes.some(scope => !allowedScopes.has(scope))) return undefined
    if (!url.searchParams.get('client_id')?.endsWith('.apps.googleusercontent.com')) return undefined
    for (const key of ['scope', 'redirect_uri', 'response_type', 'client_id']) {
      if (url.searchParams.getAll(key).length !== 1) return undefined
    }
    return url.href
  } catch { return undefined }
}
