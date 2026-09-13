import { lookup as dnsLookup } from 'node:dns/promises'
import type { LookupOptions } from 'node:dns'
import { isIP, type LookupFunction } from 'node:net'
import ipaddr from 'ipaddr.js'
import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit
} from 'undici'

export type BrokerResolvedAddress = {
  address: string
  family: 4 | 6
}

export type BrokerDnsResolver = (
  hostname: string
) => Promise<readonly BrokerResolvedAddress[]>

export type BrokeredNetworkMode = 'remote-https' | 'loopback-http' | 'remote-http'

export type BrokeredNetworkTarget = {
  hostname: string
  mode: BrokeredNetworkMode
  addresses: readonly BrokerResolvedAddress[]
}

export type SafeNetworkFetchOptions = {
  resolve?: BrokerDnsResolver
  /** Preview-only HTTP support: require public unicast and disable the loopback exception. */
  publicHttp?: boolean
}

const LOOPBACK_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const TRANSPORT_HEADERS = new Set([
  'connection',
  'host',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

/**
 * Production fetch for Extension-controlled destinations.
 *
 * It resolves and validates every address before creating a one-request
 * dispatcher. The dispatcher receives only a pinned lookup callback, so a DNS
 * answer cannot change between policy validation and socket connection. A
 * dedicated Agent also prevents reuse of an ambient/global connection or
 * proxy. Callers continue to own redirect policy and must re-enter this fetch
 * for every manually accepted target.
 */
export function createSafeNetworkFetch(options: SafeNetworkFetchOptions = {}): typeof fetch {
  const resolver = options.resolve ?? systemDnsResolver
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (request.redirect === 'follow') {
      throw new Error('Brokered requests must use manual or error redirect handling')
    }
    const target = await resolveBrokeredNetworkTarget(url, resolver, options.publicHttp)
    if (request.signal.aborted) throw request.signal.reason

    const headers = new Headers(request.headers)
    for (const name of TRANSPORT_HEADERS) {
      if (headers.has(name)) throw new Error(`Brokered requests cannot set transport header: ${name}`)
    }
    const body = request.body === null
      ? undefined
      : new Uint8Array(await request.arrayBuffer())
    const dispatcher = new Agent({
      connections: 1,
      pipelining: 0,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 250,
      connect: {
        lookup: createPinnedLookup(target.hostname, target.addresses)
      }
    })

    try {
      const response = await undiciFetch(url, {
        method: request.method,
        headers: Object.fromEntries(headers.entries()),
        ...(body === undefined ? {} : { body }),
        redirect: request.redirect,
        signal: request.signal,
        dispatcher
      } satisfies UndiciRequestInit)
      return response as unknown as Response
    } finally {
      // close() is graceful: it fences reuse immediately and finishes after
      // the caller consumes or cancels the returned response body.
      void dispatcher.close().catch(() => undefined)
    }
  }) as typeof fetch
}

export function normalizedBrokerHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase()
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

export function brokeredNetworkMode(url: URL, publicHttp = false): BrokeredNetworkMode {
  if (url.username || url.password) throw new Error('Brokered URLs must not contain credentials')
  const hostname = normalizedBrokerHostname(url)
  if (url.protocol === 'https:') return 'remote-https'
  if (url.protocol === 'http:' && publicHttp) return 'remote-http'
  if (url.protocol === 'http:' && LOOPBACK_HTTP_HOSTS.has(hostname)) return 'loopback-http'
  throw new Error('Brokered requests require HTTPS (explicit loopback HTTP is allowed)')
}

export function assertBrokeredNetworkUrl(url: URL): void {
  void brokeredNetworkMode(url)
}

export async function resolveBrokeredNetworkTarget(
  url: URL,
  resolver: BrokerDnsResolver = systemDnsResolver,
  publicHttp = false
): Promise<BrokeredNetworkTarget> {
  const mode = brokeredNetworkMode(url, publicHttp)
  const hostname = normalizedBrokerHostname(url)
  const literalFamily = isIP(hostname)
  const rawAddresses = literalFamily === 0
    ? await resolver(hostname)
    : [{ address: hostname, family: literalFamily as 4 | 6 }]
  if (rawAddresses.length === 0) throw new Error(`Brokered DNS returned no addresses for ${hostname}`)

  const addresses: BrokerResolvedAddress[] = []
  const seen = new Set<string>()
  for (const rawAddress of rawAddresses) {
    const address = normalizeResolvedAddress(rawAddress, hostname)
    const policy = classifyBrokerAddress(address.address)
    if (mode === 'loopback-http' ? !policy.loopback : !policy.publicUnicast) {
      throw new Error(
        `Brokered network target ${hostname} resolved to blocked ${policy.range} address ${address.address}`
      )
    }
    const key = `${address.family}:${address.address}`
    if (!seen.has(key)) {
      seen.add(key)
      addresses.push(address)
    }
  }
  if (addresses.length === 0) throw new Error(`Brokered DNS returned no usable addresses for ${hostname}`)
  return { hostname, mode, addresses }
}

export function classifyBrokerAddress(address: string): {
  family: 4 | 6
  range: string
  loopback: boolean
  publicUnicast: boolean
  normalized: string
} {
  if (!ipaddr.isValid(address)) throw new Error(`Brokered DNS returned an invalid IP address: ${address}`)
  const parsed = ipaddr.parse(address)
  if ('zoneId' in parsed && parsed.zoneId) {
    throw new Error(`Brokered DNS returned a scoped IPv6 address: ${address}`)
  }
  const family = parsed.kind() === 'ipv4' ? 4 : 6
  const effective = 'isIPv4MappedAddress' in parsed && parsed.isIPv4MappedAddress()
    ? parsed.toIPv4Address()
    : parsed
  const range = effective.range()
  return {
    family,
    range,
    loopback: range === 'loopback',
    publicUnicast: range === 'unicast',
    normalized: parsed.toNormalizedString()
  }
}

export function createPinnedLookup(
  expectedHostname: string,
  addresses: readonly BrokerResolvedAddress[]
): LookupFunction {
  const expected = normalizeLookupHostname(expectedHostname)
  const pinned = addresses.map((entry) => ({ ...entry }))
  return (hostname, options, callback) => {
    const actual = normalizeLookupHostname(hostname)
    if (actual !== expected) {
      queueMicrotask(() => callback(lookupError(
        `Pinned broker lookup refused unexpected host ${hostname}`,
        hostname
      ), '', 0))
      return
    }
    const family = numericLookupFamily(options)
    const eligible = family === 0 ? pinned : pinned.filter((entry) => entry.family === family)
    if (eligible.length === 0) {
      queueMicrotask(() => callback(lookupError(
        `Pinned broker lookup has no IPv${family} address for ${hostname}`,
        hostname
      ), '', family))
      return
    }
    queueMicrotask(() => {
      if (options.all) callback(null, eligible)
      else callback(null, eligible[0]!.address, eligible[0]!.family)
    })
  }
}

async function systemDnsResolver(hostname: string): Promise<readonly BrokerResolvedAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true })
  return addresses.map((entry) => {
    if (entry.family !== 4 && entry.family !== 6) {
      throw new Error(`Brokered DNS returned an unsupported address family for ${hostname}`)
    }
    return { address: entry.address, family: entry.family }
  })
}

function normalizeResolvedAddress(
  entry: BrokerResolvedAddress,
  hostname: string
): BrokerResolvedAddress {
  if (entry.family !== 4 && entry.family !== 6) {
    throw new Error(`Brokered DNS returned an unsupported address family for ${hostname}`)
  }
  const actualFamily = isIP(entry.address)
  if (actualFamily !== entry.family) {
    throw new Error(`Brokered DNS returned an invalid IPv${entry.family} address for ${hostname}`)
  }
  const classified = classifyBrokerAddress(entry.address)
  return { address: classified.normalized, family: entry.family }
}

function normalizeLookupHostname(hostname: string): string {
  const normalized = hostname.toLowerCase()
  return normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized
}

function numericLookupFamily(options: LookupOptions): 0 | 4 | 6 {
  if (options.family === 4 || options.family === 'IPv4') return 4
  if (options.family === 6 || options.family === 'IPv6') return 6
  return 0
}

function lookupError(message: string, hostname: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), {
    code: 'ENOTFOUND',
    syscall: 'getaddrinfo',
    hostname
  })
}
