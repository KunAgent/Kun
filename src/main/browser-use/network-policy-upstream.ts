import { connect as netConnect, type Socket } from 'node:net'
import { BrowserUseNetworkPolicyError } from './network-policy-destination'

/** An HTTP forward proxy the desktop is configured to use for a destination. */
export type BrowserUseUpstreamProxy = {
  hostname: string
  port: number
  /** `host:port`, safe to show in errors because credentials are rejected. */
  label: string
}

const MAX_CONNECT_RESPONSE_BYTES = 8 * 1024

/**
 * Accepts only credential-free `http://host:port` proxies. SOCKS and HTTPS
 * proxies fall back to direct connections, as they did before upstream proxy
 * support existed.
 */
export function parseBrowserUseUpstreamProxy(raw: string): BrowserUseUpstreamProxy | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' || url.username || url.password || !url.hostname) return undefined
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) return undefined
  const port = url.port ? Number(url.port) : 80
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
  return { hostname, port, label: `${url.hostname}:${port}` }
}

/**
 * Opens an HTTP CONNECT tunnel to `hostname:port` through `proxy`. The proxy
 * resolves the destination itself, so callers must have vetted it already.
 */
export function connectThroughUpstreamProxy(
  proxy: BrowserUseUpstreamProxy,
  hostname: string,
  port: number,
  timeoutMs: number
): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const authority = `${hostname.includes(':') ? `[${hostname}]` : hostname}:${port}`
    const socket = netConnect({ host: proxy.hostname, port: proxy.port })
    let settled = false
    let buffered = Buffer.alloc(0)
    const finish = (outcome: { ok: true } | { ok: false; error: Error }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
      if (outcome.ok) resolve(socket)
      else {
        socket.destroy()
        reject(outcome.error)
      }
    }
    const fail = (code: string, message: string): void => finish({
      ok: false,
      error: new BrowserUseNetworkPolicyError(code, message)
    })
    const timer = setTimeout(() => fail(
      'upstream_proxy_timeout',
      `System proxy ${proxy.label} did not answer the CONNECT request in time.`
    ), timeoutMs)
    const onError = (error: NodeJS.ErrnoException): void => fail(
      'upstream_proxy_unreachable',
      `System proxy ${proxy.label} could not be reached${error.code ? ` (${error.code})` : ''}.`
    )
    const onClose = (): void => fail(
      'upstream_proxy_unreachable',
      `System proxy ${proxy.label} closed the connection before answering CONNECT.`
    )
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk])
      const headerEnd = buffered.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        if (buffered.byteLength > MAX_CONNECT_RESPONSE_BYTES) {
          fail('upstream_proxy_failed', `System proxy ${proxy.label} returned an oversized CONNECT response.`)
        }
        return
      }
      const statusLine = buffered.subarray(0, headerEnd).toString('latin1').split('\r\n')[0] ?? ''
      const status = /^HTTP\/1\.[01] (\d{3})/u.exec(statusLine)
      const code = status ? Number(status[1]) : NaN
      if (code < 200 || code > 299) {
        fail(
          'upstream_proxy_failed',
          `System proxy ${proxy.label} refused the tunnel${Number.isFinite(code) ? ` (HTTP ${code})` : ''}.`
        )
        return
      }
      const rest = buffered.subarray(headerEnd + 4)
      if (rest.byteLength > 0) socket.unshift(rest)
      finish({ ok: true })
    }
    socket.once('connect', () => {
      socket.write(
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Connection: keep-alive\r\n\r\n`
      )
    })
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}
