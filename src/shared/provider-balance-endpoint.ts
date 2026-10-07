/**
 * A balance endpoint the user names for a provider. The provider's API key is
 * sent there, so it must be HTTPS on the provider's own host, or on one other
 * host the user confirmed by name; changing the URL's host voids that
 * confirmation. The runtime applies the same rule before every request.
 */
export type ProviderBalanceEndpoint = {
  /** HTTPS URL; a `#/json/pointer` fragment picks the value. */
  balanceUrl?: string
  /** Unit shown when the response names no currency (`USD`, `credits`). */
  balanceUnit?: string
  /** Header carrying the key instead of `Authorization: Bearer`. */
  balanceKeyHeader?: string
  /** The other host the user confirmed to receive the key. */
  balanceHost?: string
}

export const BALANCE_UNIT_PATTERN = /^[\p{L}\p{Sc}][\p{L}\p{N}\p{Sc} ._-]{0,15}$/u
export const BALANCE_KEY_HEADER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
// Headers a request already sets or that would change where or how it is sent.
const RESERVED_KEY_HEADERS = new Set(['authorization', 'host', 'accept', 'content-length', 'content-type', 'cookie',
  'connection', 'transfer-encoding', 'user-agent', 'proxy-authorization', 'origin', 'referer'])

export function validBalanceKeyHeader(value: string): boolean {
  return BALANCE_KEY_HEADER_PATTERN.test(value) && !RESERVED_KEY_HEADERS.has(value.toLowerCase())
}

/** The URL when it can carry a key at all (HTTPS, no embedded credentials). */
export function balanceEndpointUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) return undefined
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && !url.username && !url.password ? url : undefined
  } catch {
    return undefined
  }
}

export function providerHost(baseUrl: string): string | undefined {
  try { return new URL(baseUrl).host } catch { return undefined }
}

/** Keeps only settings the runtime would honor; an unconfirmed other host drops the whole endpoint. */
export function normalizeProviderBalanceEndpoint(input: Record<string, unknown> | undefined, baseUrl: string): ProviderBalanceEndpoint {
  const url = balanceEndpointUrl(input?.balanceUrl)
  if (!url) return {}
  const own = url.host === providerHost(baseUrl)
  const confirmed = typeof input?.balanceHost === 'string' && input.balanceHost.trim().toLowerCase() === url.host
  if (!own && !confirmed) return {}
  const unit = typeof input?.balanceUnit === 'string' ? input.balanceUnit.trim() : ''
  const header = typeof input?.balanceKeyHeader === 'string' ? input.balanceKeyHeader.trim() : ''
  return {
    balanceUrl: url.toString(),
    ...(BALANCE_UNIT_PATTERN.test(unit) ? { balanceUnit: unit } : {}),
    ...(header && validBalanceKeyHeader(header) ? { balanceKeyHeader: header } : {}),
    ...(!own ? { balanceHost: url.host } : {})
  }
}
