import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from 'node:http'
import { connect as netConnect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import {
  BrowserUseNetworkPolicyError,
  resolveBrowserUseNetworkTarget,
  sanitizeBrowserUseUrl,
  type BrowserUseNetworkPolicyOptions,
  type BrowserUseNetworkTarget
} from './network-policy-destination'
import {
  connectThroughUpstreamProxy,
  parseBrowserUseUpstreamProxy,
  type BrowserUseUpstreamProxy
} from './network-policy-upstream'

export {
  BROWSER_USE_DNS_TIMEOUT_MS,
  BrowserUseNetworkPolicyError,
  classifyBrowserUseAddress,
  normalizeBrowserUseOrigin,
  resolveBrowserUseNetworkTarget,
  sanitizeBrowserUseUrl,
  type BrowserUseDnsResolver,
  type BrowserUseNetworkPolicyOptions,
  type BrowserUseNetworkTarget,
  type BrowserUseResolvedAddress
} from './network-policy-destination'

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

/** Outcome of one vetted connection attempt, as surfaced to the audit log and the session. */
export type BrowserUsePolicyEvent = {
  outcome: 'allowed' | 'blocked' | 'failed'
  sanitizedUrl: string
  code?: string
  message?: string
}

export type BrowserUsePolicyProxyOptions = BrowserUseNetworkPolicyOptions & {
  maxConcurrentConnections?: number
  connectTimeoutMs?: number
  startTimeoutMs?: number
  /**
   * Returns the proxy URL the desktop would use for `url` (`''` for DIRECT).
   * Public-mode traffic then rides that proxy by hostname after the usual
   * destination vetting, so a system proxy configured on the host is honoured.
   */
  resolveUpstreamProxy?: (url: string) => Promise<string>
  onPolicyEvent?: (event: BrowserUsePolicyEvent) => void
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
      const upstreamProxy = await this.upstreamProxyFor(target)
      if (request.destroyed || response.destroyed) {
        release()
        return
      }
      this.policyEvent('allowed', target.url.href)
      let receivedUpstreamResponse = false
      const upstreamRequest = httpRequest({
        ...(upstreamProxy
          // A forward proxy takes the absolute URL and resolves the vetted
          // hostname itself; no connection is pinned to our DNS answer.
          ? {
              host: upstreamProxy.hostname,
              port: upstreamProxy.port,
              path: target.url.href
            }
          : {
              host: target.addresses[0]!.address,
              family: target.addresses[0]!.family,
              port: target.port,
              path: `${target.url.pathname}${target.url.search}`
            }),
        method: request.method,
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
      upstreamRequest.once('error', (error: NodeJS.ErrnoException) => {
        this.policyEvent('failed', target.url.href, 'proxy_upstream_failed', describeConnectFailure(
          error,
          upstreamProxy ? `System proxy ${upstreamProxy.label}` : 'The destination'
        ))
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
    let target: BrowserUseNetworkTarget | undefined
    try {
      target = await resolveBrowserUseNetworkTarget(`https://${authority}`, this.options)
      if (client.destroyed) {
        release()
        return
      }
      upstream = await this.connectVetted(target)
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
      // Vetting failures are policy blocks (403); a vetted destination that
      // could not be reached is a gateway failure (502) and says why.
      if (target) {
        this.policyEvent('failed', target.url.href, policyErrorCode(error), errorMessage(error))
        client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      } else {
        this.policyEvent('blocked', `https://${authority}`, policyErrorCode(error), errorMessage(error))
        client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      }
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
    let vetted: BrowserUseNetworkTarget | undefined
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
      vetted = target
      upstream = await this.connectVetted(target)
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
      this.policyEvent(
        vetted ? 'failed' : 'blocked',
        rawUrl,
        policyErrorCode(error),
        errorMessage(error)
      )
      client.destroy()
      release()
    }
  }

  /** Looks up the desktop proxy for a vetted public destination; local mode and lookup failures stay direct. */
  private async upstreamProxyFor(
    target: BrowserUseNetworkTarget
  ): Promise<BrowserUseUpstreamProxy | undefined> {
    if (this.options.mode === 'local-development' || !this.options.resolveUpstreamProxy) return undefined
    try {
      return parseBrowserUseUpstreamProxy(await this.options.resolveUpstreamProxy(target.url.href))
    } catch {
      return undefined
    }
  }

  private async connectVetted(target: BrowserUseNetworkTarget): Promise<Socket> {
    const upstreamProxy = await this.upstreamProxyFor(target)
    const timeoutMs = this.options.connectTimeoutMs ?? 10_000
    if (upstreamProxy) {
      return connectThroughUpstreamProxy(upstreamProxy, target.hostname, target.port, timeoutMs)
    }
    return this.connectPinned(target, timeoutMs)
  }

  private async connectPinned(target: BrowserUseNetworkTarget, timeoutMs: number): Promise<Socket> {
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
            reject(new BrowserUseNetworkPolicyError(
              'upstream_connect_timeout',
              'The destination did not accept a connection in time.'
            ))
          }, timeoutMs)
          socket.once('connect', () => {
            clearTimeout(timer)
            resolve(socket)
          })
          socket.once('error', (error: NodeJS.ErrnoException) => {
            clearTimeout(timer)
            reject(new BrowserUseNetworkPolicyError(
              'upstream_connect_failed',
              describeConnectFailure(error, 'The destination')
            ))
          })
        })
      } catch (error) {
        lastError = error
      }
    }
    throw lastError ?? new BrowserUseNetworkPolicyError(
      'upstream_connect_failed',
      'Browser Use proxy has no vetted destination address.'
    )
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
    outcome: BrowserUsePolicyEvent['outcome'],
    rawUrl: string,
    code?: string,
    message?: string
  ): void {
    this.options.onPolicyEvent?.({
      outcome,
      sanitizedUrl: sanitizeBrowserUseUrl(rawUrl),
      ...(code ? { code } : {}),
      ...(message ? { message: message.slice(0, 512) } : {})
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Names the failing hop and the socket error code without echoing addresses. */
function describeConnectFailure(error: NodeJS.ErrnoException, subject: string): string {
  const code = typeof error.code === 'string' ? error.code : ''
  if (code === 'ETIMEDOUT' || error.message === 'upstream timeout') {
    return `${subject} did not answer in time.`
  }
  return `${subject} refused or dropped the connection${code ? ` (${code})` : ''}.`
}

function once(callback: () => void): () => void {
  let called = false
  return () => {
    if (called) return
    called = true
    callback()
  }
}
