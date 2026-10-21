import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import type { BrowserUseMode } from '../../shared/browser-use'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.internal'
])
const BLOCKED_PUBLIC_METADATA_IPS = new Set([
  '168.63.129.16',
  '169.254.169.254'
])
// Fake-IP ranges handed out by TUN-mode proxy clients (Clash, sing-box, Surge,
// Mihomo) instead of real answers. 198.18.0.0/15 is the IETF benchmarking
// block and fc00::/18 sits in the unassigned half of the ULA prefix, so no
// real private network answers there; a TUN that returned it will also route it.
const FAKE_IP_RANGES: ReadonlyArray<[ipaddr.IPv4 | ipaddr.IPv6, number]> = [
  [ipaddr.parse('198.18.0.0'), 15],
  [ipaddr.parse('fc00::'), 18]
]

export type BrowserUseResolvedAddress = {
  address: string
  family: 4 | 6
}

export type BrowserUseDnsResolver = (
  hostname: string
) => Promise<readonly BrowserUseResolvedAddress[]>

export type BrowserUseNetworkTarget = {
  url: URL
  hostname: string
  port: number
  addresses: readonly BrowserUseResolvedAddress[]
}

export type BrowserUseNetworkPolicyOptions = {
  mode: BrowserUseMode
  exactLocalOrigin?: string
  resolve?: BrowserUseDnsResolver
  dnsTimeoutMs?: number
}

export class BrowserUseNetworkPolicyError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'BrowserUseNetworkPolicyError'
  }
}

export function sanitizeBrowserUseUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return `${url.origin}${url.pathname.slice(0, 1024)}`
  } catch {
    return '<invalid-url>'
  }
}

export function normalizeBrowserUseOrigin(rawUrl: string, mode: BrowserUseMode): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new BrowserUseNetworkPolicyError('invalid_url', 'Browser Use requires a valid absolute URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BrowserUseNetworkPolicyError(
      'unsupported_scheme',
      'Browser Use permits only HTTP and HTTPS top-level origins.'
    )
  }
  if (url.username || url.password) {
    throw new BrowserUseNetworkPolicyError(
      'embedded_credentials',
      'Browser Use URLs cannot contain credentials.'
    )
  }
  const hostname = normalizedHostname(url.hostname)
  if (isBlockedMetadataHostname(hostname)) {
    throw new BrowserUseNetworkPolicyError('metadata_blocked', 'Cloud metadata destinations are blocked.')
  }
  if (mode === 'local-development') {
    if (!LOOPBACK_HOSTS.has(hostname)) {
      throw new BrowserUseNetworkPolicyError(
        'local_origin_required',
        'Local-development Browser Use requires localhost, 127.0.0.1, or ::1.'
      )
    }
  } else if (LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.local')) {
    throw new BrowserUseNetworkPolicyError(
      'non_public_destination',
      'Public Browser Use cannot access loopback or local-network names.'
    )
  }
  return url.origin
}

export const BROWSER_USE_DNS_TIMEOUT_MS = 10_000

async function resolveBrowserUseAddressWithDeadline(
  hostname: string,
  options: BrowserUseNetworkPolicyOptions
): Promise<readonly BrowserUseResolvedAddress[]> {
  let timer: NodeJS.Timeout | undefined
  const lookup = Promise.resolve()
    .then(() => (options.resolve ?? systemBrowserUseDnsResolver)(hostname))
  // A stalled getaddrinfo (for example behind an unresponsive VPN DNS) must
  // never hold the policy proxy's CONNECT decision open forever.
  lookup.catch(() => undefined)
  try {
    return await Promise.race([
      lookup,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new BrowserUseNetworkPolicyError(
          'dns_timeout',
          'Browser Use destination DNS resolution timed out.'
        )), options.dnsTimeoutMs ?? BROWSER_USE_DNS_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function resolveBrowserUseNetworkTarget(
  rawUrl: string | URL,
  options: BrowserUseNetworkPolicyOptions
): Promise<BrowserUseNetworkTarget> {
  const url = rawUrl instanceof URL ? new URL(rawUrl.href) : new URL(rawUrl)
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
    throw new BrowserUseNetworkPolicyError(
      'unsupported_scheme',
      'Browser Use network policy permits only HTTP, HTTPS, WS, and WSS.'
    )
  }
  if (url.username || url.password) {
    throw new BrowserUseNetworkPolicyError(
      'embedded_credentials',
      'Browser Use network destinations cannot contain credentials.'
    )
  }
  const hostname = normalizedHostname(url.hostname)
  if (isBlockedMetadataHostname(hostname)) {
    throw new BrowserUseNetworkPolicyError('metadata_blocked', 'Cloud metadata destinations are blocked.')
  }

  if (options.mode === 'local-development') {
    const exactLocalOrigin = options.exactLocalOrigin
    if (!exactLocalOrigin) {
      throw new BrowserUseNetworkPolicyError(
        'local_origin_unset',
        'Local-development Browser Use has no exact granted origin.'
      )
    }
    const comparableProtocol = url.protocol === 'ws:'
      ? 'http:'
      : url.protocol === 'wss:'
        ? 'https:'
        : url.protocol
    const comparable = new URL(url.href)
    comparable.protocol = comparableProtocol
    if (comparable.origin !== exactLocalOrigin) {
      throw new BrowserUseNetworkPolicyError(
        'local_origin_mismatch',
        'Local-development Browser Use cannot leave its exact granted origin.'
      )
    }
  } else if (LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.local')) {
    throw new BrowserUseNetworkPolicyError(
      'non_public_destination',
      'Public Browser Use cannot access loopback or local-network names.'
    )
  }

  const literalFamily = isIP(hostname)
  const rawAddresses = literalFamily === 0
    ? await resolveBrowserUseAddressWithDeadline(hostname, options)
    : [{ address: hostname, family: literalFamily as 4 | 6 }]
  if (rawAddresses.length === 0) {
    throw new BrowserUseNetworkPolicyError('dns_empty', 'Destination DNS returned no addresses.')
  }

  const addresses: BrowserUseResolvedAddress[] = []
  const seen = new Set<string>()
  for (const entry of rawAddresses) {
    const classified = classifyBrowserUseAddress(entry.address)
    if (entry.family !== classified.family) {
      throw new BrowserUseNetworkPolicyError(
        'dns_family_mismatch',
        'Destination DNS returned an address with a mismatched family.'
      )
    }
    const allowed = options.mode === 'local-development'
      ? classified.loopback
      : classified.publicUnicast || classified.fakeIp
    if (!allowed) {
      throw new BrowserUseNetworkPolicyError(
        'non_public_destination',
        `Destination resolved to a blocked ${classified.range} address.`
      )
    }
    const key = `${classified.family}:${classified.normalized}`
    if (!seen.has(key)) {
      seen.add(key)
      addresses.push({
        address: classified.normalized,
        family: classified.family
      })
    }
  }

  return {
    url,
    hostname,
    port: url.port
      ? Number(url.port)
      : url.protocol === 'https:' || url.protocol === 'wss:'
        ? 443
        : 80,
    addresses
  }
}

export function classifyBrowserUseAddress(address: string): {
  family: 4 | 6
  range: string
  loopback: boolean
  publicUnicast: boolean
  /** A TUN-mode proxy client's placeholder answer; see FAKE_IP_RANGES. */
  fakeIp: boolean
  normalized: string
} {
  if (!ipaddr.isValid(address)) {
    throw new BrowserUseNetworkPolicyError('invalid_ip', 'Destination DNS returned an invalid IP address.')
  }
  const parsed = ipaddr.parse(address)
  if ('zoneId' in parsed && parsed.zoneId) {
    throw new BrowserUseNetworkPolicyError('scoped_ipv6', 'Scoped IPv6 destinations are blocked.')
  }
  const effective = 'isIPv4MappedAddress' in parsed && parsed.isIPv4MappedAddress()
    ? parsed.toIPv4Address()
    : parsed
  const family = effective.kind() === 'ipv4' ? 4 : 6
  const range = effective.range()
  const normalized = effective.toNormalizedString()
  const metadataBlocked = BLOCKED_PUBLIC_METADATA_IPS.has(normalized)
  const fakeIp = FAKE_IP_RANGES.some(([prefix, bits]) =>
    prefix.kind() === effective.kind() && effective.match(prefix as never, bits)
  )
  return {
    family,
    range,
    loopback: range === 'loopback',
    publicUnicast: range === 'unicast' && !metadataBlocked,
    fakeIp,
    normalized
  }
}
async function systemBrowserUseDnsResolver(
  hostname: string
): Promise<readonly BrowserUseResolvedAddress[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true })
  return results.map((entry) => {
    if (entry.family !== 4 && entry.family !== 6) {
      throw new BrowserUseNetworkPolicyError(
        'dns_family_unsupported',
        'Destination DNS returned an unsupported address family.'
      )
    }
    return { address: entry.address, family: entry.family }
  })
}

function normalizedHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized
}

function isBlockedMetadataHostname(hostname: string): boolean {
  return BLOCKED_HOSTNAMES.has(hostname) || hostname.startsWith('metadata.')
}

