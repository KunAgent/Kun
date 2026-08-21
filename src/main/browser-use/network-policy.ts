import { lookup as dnsLookup } from 'node:dns/promises'
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from 'node:http'
import {
  connect as netConnect,
  isIP,
  type Socket
} from 'node:net'
import type { Duplex } from 'node:stream'
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
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

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

export type BrowserUsePolicyProxyOptions = BrowserUseNetworkPolicyOptions & {
  maxConcurrentConnections?: number
  connectTimeoutMs?: number
  startTimeoutMs?: number
  onPolicyEvent?: (event: {
    outcome: 'allowed' | 'blocked'
    sanitizedUrl: string
    code?: string
  }) => void
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
      : classified.publicUnicast
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
  return {
    family,
    range,
    loopback: range === 'loopback',
    publicUnicast: range === 'unicast' && !metadataBlocked,
    normalized
  }
}
const PROXY_START_TIMEOUT_MS = 10_000

export class BrowserUsePolicyProxy {
  private server?: HttpServer
  private readonly sockets = new Set<Socket>()
  private activeConnections = 0
  constructor(private readonly options: BrowserUsePolicyProxyOptions) {}

  async start(): Promise<string> {
    if (this.server) throw new Error('Browser Use policy proxy is already running.')
    const server = createServer((request, response) => {
      void this.handleHttpRequest(request, response)
    })
    server.maxHeadersCount = 100
    server.headersTimeout = 10_000
    server.requestTimeout = 30_000
    server.on('connect', (request, client, head) => {
      void this.handleConnect(request, client, head)
    })
    server.on('upgrade', (request, client, head) => {
      void this.handleUpgrade(request, client, head)
    })
    server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.once('close', () => this.sockets.delete(socket))
    })
    server.on('clientError', (_error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    })
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        server.off('error', onError)
        if (error) reject(error)
        else resolve()
      }
      const onError = (error: Error): void => {
        server.close()
        for (const socket of this.sockets) socket.destroy()
        this.sockets.clear()
        finish(new BrowserUseNetworkPolicyError(
          'proxy_start_failed', 'Browser Use policy proxy failed to start.'
        ))
      }
      const timer = setTimeout(() => {
        server.close()
        for (const socket of this.sockets) socket.destroy()
        this.sockets.clear()
        finish(new BrowserUseNetworkPolicyError(
          'proxy_start_timeout', 'Browser Use policy proxy startup timed out.'
        ))
      }, this.options.startTimeoutMs ?? PROXY_START_TIMEOUT_MS)
      server.once('error', onError)
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => finish())
    })
    this.server = server
    const address = server.address()
    if (!address || typeof address === 'string') {
      await this.stop()
      throw new Error('Browser Use policy proxy did not bind a TCP port.')
    }
    return `http://127.0.0.1:${address.port}`
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    if (!this.enter()) {
      this.rejectResponse(response, 429, 'proxy_concurrency_exceeded')
      return
    }
    const release = once(() => this.leave())
    let upstream: ReturnType<typeof httpRequest> | undefined
    const abortUpstream = (): void => {
      if (upstream && !upstream.destroyed) upstream.destroy()
    }
    const abortDownstream = (): void => {
      if (!response.destroyed) response.destroy()
      abortUpstream()
      release()
    }
    request.once('aborted', abortDownstream)
    request.once('error', abortDownstream)
    response.once('finish', release)
    response.once('close', () => {
      abortUpstream()
      release()
    })
    response.once('error', abortDownstream)
    const rawUrl = request.url ?? ''
    try {
      const target = await resolveBrowserUseNetworkTarget(rawUrl, this.options)
      if (request.destroyed || response.destroyed) {
        release()
        return
      }
      if (target.url.protocol !== 'http:') {
        throw new BrowserUseNetworkPolicyError(
          'proxy_protocol_mismatch',
          'Encrypted destinations must use CONNECT.'
        )
      }
      this.policyEvent('allowed', target.url.href)
      let receivedUpstreamResponse = false
      const upstreamRequest = httpRequest({
        host: target.addresses[0]!.address,
        family: target.addresses[0]!.family,
        port: target.port,
        method: request.method,
        path: `${target.url.pathname}${target.url.search}`,
        headers: outboundHeaders(request.headers, target.url.host),
        timeout: this.options.connectTimeoutMs ?? 10_000
      }, (upstreamResponse) => {
        receivedUpstreamResponse = true
        upstreamResponse.once('aborted', abortDownstream)
        upstreamResponse.once('error', abortDownstream)
        upstreamResponse.once('close', () => {
          if (!upstreamResponse.complete) abortDownstream()
        })
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          outboundHeaders(upstreamResponse.headers)
        )
        upstreamResponse.pipe(response)
      })
      upstream = upstreamRequest
      upstreamRequest.once('timeout', () => {
        upstreamRequest.destroy(new Error('upstream timeout'))
      })
      upstreamRequest.once('error', () => {
        if (!response.headersSent) this.rejectResponse(response, 502, 'proxy_upstream_failed')
        else response.destroy()
        release()
      })
      upstreamRequest.once('close', () => {
        if (receivedUpstreamResponse) return
        if (!response.headersSent && !response.destroyed) {
          this.rejectResponse(response, 502, 'proxy_upstream_failed')
        }
        release()
      })
      request.pipe(upstreamRequest)
    } catch (error) {
      this.policyEvent('blocked', rawUrl, policyErrorCode(error))
      if (!response.destroyed) this.rejectResponse(response, 403, policyErrorCode(error))
      release()
    }
  }

  private async handleConnect(
    request: IncomingMessage,
    client: Duplex,
    head: Buffer
  ): Promise<void> {
    if (!this.enter()) {
      client.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n')
      return
    }
    const release = once(() => this.leave())
    let upstream: Socket | undefined
    const closeUpstream = (): void => {
      if (upstream && !upstream.destroyed) upstream.destroy()
      release()
    }
    const closeClient = (): void => {
      if (!client.destroyed) client.destroy()
      release()
    }
    client.once('close', closeUpstream)
    client.once('error', closeUpstream)
    const authority = request.url ?? ''
    try {
      const target = await resolveBrowserUseNetworkTarget(`https://${authority}`, this.options)
      if (client.destroyed) {
        release()
        return
      }
      upstream = await this.connectPinned(target)
      if (client.destroyed) {
        closeUpstream()
        return
      }
      upstream.once('close', closeClient)
      upstream.once('error', closeClient)
      this.policyEvent('allowed', target.url.href)
      client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Kun-Browser-Use\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    } catch (error) {
      this.policyEvent('blocked', `https://${authority}`, policyErrorCode(error))
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      release()
    }
  }

  private async handleUpgrade(
    request: IncomingMessage,
    client: Duplex,
    head: Buffer
  ): Promise<void> {
    if (!this.enter()) {
      client.destroy()
      return
    }
    const release = once(() => this.leave())
    let upstream: Socket | undefined
    const closeUpstream = (): void => {
      if (upstream && !upstream.destroyed) upstream.destroy()
      release()
    }
    const closeClient = (): void => {
      if (!client.destroyed) client.destroy()
      release()
    }
    client.once('close', closeUpstream)
    client.once('error', closeUpstream)
    const rawUrl = request.url ?? ''
    try {
      const target = await resolveBrowserUseNetworkTarget(rawUrl, this.options)
      if (client.destroyed) {
        release()
        return
      }
      if (target.url.protocol !== 'ws:') {
        throw new BrowserUseNetworkPolicyError(
          'proxy_protocol_mismatch',
          'Encrypted WebSockets must use CONNECT.'
        )
      }
      upstream = await this.connectPinned(target)
      if (client.destroyed) {
        closeUpstream()
        return
      }
      upstream.once('close', closeClient)
      upstream.once('error', closeClient)
      this.policyEvent('allowed', target.url.href)
      const headers = outboundHeaders(request.headers, target.url.host)
      headers.connection = 'Upgrade'
      headers.upgrade = request.headers.upgrade ?? 'websocket'
      const lines = [
        `${request.method ?? 'GET'} ${target.url.pathname}${target.url.search} HTTP/1.1`,
        ...Object.entries(headers).flatMap(([name, value]) =>
          Array.isArray(value)
            ? value.map((item) => `${name}: ${item}`)
            : value === undefined
              ? []
              : [`${name}: ${value}`]
        ),
        '',
        ''
      ]
      upstream.write(lines.join('\r\n'))
      if (head.length) upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    } catch (error) {
      this.policyEvent('blocked', rawUrl, policyErrorCode(error))
      client.destroy()
      release()
    }
  }

  private async connectPinned(target: BrowserUseNetworkTarget): Promise<Socket> {
    let lastError: unknown
    for (const address of target.addresses) {
      try {
        return await new Promise<Socket>((resolve, reject) => {
          const socket = netConnect({
            host: address.address,
            family: address.family,
            port: target.port
          })
          const timer = setTimeout(() => {
            socket.destroy()
            reject(new Error('Browser Use proxy connection timed out.'))
          }, this.options.connectTimeoutMs ?? 10_000)
          socket.once('connect', () => {
            clearTimeout(timer)
            resolve(socket)
          })
          socket.once('error', (error) => {
            clearTimeout(timer)
            reject(error)
          })
        })
      } catch (error) {
        lastError = error
      }
    }
    throw lastError ?? new Error('Browser Use proxy has no vetted destination address.')
  }

  private enter(): boolean {
    const max = this.options.maxConcurrentConnections ?? 32
    if (this.activeConnections >= max) return false
    this.activeConnections += 1
    return true
  }

  private leave(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1)
  }

  private rejectResponse(response: ServerResponse, status: number, code: string): void {
    if (response.headersSent) {
      response.destroy()
      return
    }
    response.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'close'
    })
    response.end(`Browser Use network policy blocked the request (${code}).`)
  }

  private policyEvent(
    outcome: 'allowed' | 'blocked',
    rawUrl: string,
    code?: string
  ): void {
    this.options.onPolicyEvent?.({
      outcome,
      sanitizedUrl: sanitizeBrowserUseUrl(rawUrl),
      ...(code ? { code } : {})
    })
  }
}

export function browserUseProxyConfiguration(proxyUrl: string): {
  mode: 'fixed_servers'
  proxyRules: string
  proxyBypassRules: string
} {
  const parsed = new URL(proxyUrl)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) {
    throw new Error('Browser Use requires a loopback HTTP policy proxy.')
  }
  return {
    mode: 'fixed_servers',
    proxyRules: `http=${parsed.host};https=${parsed.host};ws=${parsed.host};wss=${parsed.host}`,
    // Remove Chromium's implicit localhost bypass. The Browser Use partition
    // must never silently escape the policy proxy.
    proxyBypassRules: '<-loopback>'
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

function outboundHeaders(
  headers: IncomingHttpHeaders,
  host?: string
): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) result[name] = value
  }
  if (host) result.host = host
  return result
}

function policyErrorCode(error: unknown): string {
  return error instanceof BrowserUseNetworkPolicyError
    ? error.code
    : 'proxy_failed_closed'
}

function once(callback: () => void): () => void {
  let called = false
  return () => {
    if (called) return
    called = true
    callback()
  }
}
