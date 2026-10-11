import { z } from 'zod'

const credentialQueries = new Set(['key', 'apikey', 'xapikey', 'token', 'accesstoken', 'refreshtoken', 'idtoken',
  'bearertoken', 'secret', 'clientsecret', 'password', 'passwd', 'signature', 'auth', 'authorization',
  'credential', 'xamzsignature', 'xamzcredential', 'xgoogsignature', 'xgoogcredential'])
export function providerUrlHasCredentials(value: string): boolean {
  try {
    const url = new URL(value)
    return Boolean(url.username || url.password || [...url.searchParams.keys()].some((key) =>
      credentialQueries.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))))
  } catch { return false }
}
export const ProviderSafeUrlSchema = z.string().url().max(2_048).refine((value) => {
  const url = new URL(value)
  return ['http:', 'https:'].includes(url.protocol) && !url.hash && !providerUrlHasCredentials(value)
}, 'Provider URLs cannot contain credentials or fragments. Configure authentication through the protected credential input and auth profile.')

export class ProviderCredentialUrlError extends Error {
  constructor() {
    super('Provider configuration contains credentials in a URL. No configuration was published. Preserve the protected recovery source, remove URL credentials through controlled recovery, and configure authentication in the protected credential input and auth profile. The original URL is not shown.')
    this.name = 'ProviderCredentialUrlError'
  }
}

/** A legacy secret URL is never stripped or republished: doing so could change request semantics. */
export function assertProviderConfigurationUrls(value: unknown): void {
  const visit = (current: unknown, key = '', depth = 0) => {
    if (depth > 30) throw new Error('Provider configuration nesting exceeded its limit')
    if (typeof current === 'string') {
      if (['baseUrl', 'requestUrl', 'modelsUrl', 'url', 'chat_completions', 'responses', 'messages'].includes(key) &&
          providerUrlHasCredentials(current)) throw new ProviderCredentialUrlError()
      return
    }
    if (!current || typeof current !== 'object') return
    for (const [name, child] of Object.entries(current)) {
      // These maps have a separate protected migration; their field names are user HTTP header names.
      if (name === 'headers' || name === 'customHeaders') continue
      visit(child, Array.isArray(current) ? key : name, depth + 1)
    }
  }
  visit(value)
}
