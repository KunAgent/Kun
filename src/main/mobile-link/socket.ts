import WebSocket from 'ws'
import { ProxyAgent } from 'proxy-agent'
import type { Socket } from '@kun/remote-protocol'
import { electronProxyRuleUrl, electronSystemProxyRules } from '../electron-system-proxy'
function relayUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('INVALID_RELAY_URL') }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('INVALID_RELAY_URL')
  return url
}

/** Use Chromium's effective policy, including PAC and bypass rules, for Node WSS. */
export async function mobileSocketProxy(
  value: string,
  resolveRules: (url: string) => Promise<string> = electronSystemProxyRules
): Promise<string> {
  const url = relayUrl(value)
  // The upgrade is an HTTP(S) request; resolve the same HTTPS policy used by net.fetch.
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  let first: string
  try { first = (await resolveRules(url.href)).split(';')[0]?.trim() ?? '' }
  catch { throw new Error('PROXY_RESOLUTION_FAILED') }
  if (first.toUpperCase() === 'DIRECT') return ''
  const [kind = '', target = ''] = first.split(/\s+/, 2)
  const proxy = electronProxyRuleUrl(kind, target)
  // Do not silently bypass an unsupported/failed proxy policy with a direct connection.
  if (!proxy) throw new Error('PROXY_RESOLUTION_FAILED')
  return proxy
}

export class MobileLinkSockets {
  private agent: ProxyAgent
  private sockets = new Set<WebSocket>()
  private closed = false
  constructor(
    resolveRules: (url: string) => Promise<string> = electronSystemProxyRules,
    diagnostic: (code: string) => void = () => {}
  ) {
    const note = (code: string) => { try { diagnostic(code) } catch {} }
    this.agent = new ProxyAgent({
      keepAlive: true,
      getProxyForUrl: async (url) => {
        try {
          const proxy = await mobileSocketProxy(url, resolveRules)
          note(proxy ? 'WSS_PROXY' : 'WSS_DIRECT')
          return proxy
        } catch {
          note('WSS_PROXY_RESOLUTION_FAILED')
          throw new Error('PROXY_RESOLUTION_FAILED')
        }
      }
    })
  }
  open(url: string, headers: Record<string, string>): Socket {
    if (this.closed) throw new Error('SOCKET_FACTORY_CLOSED')
    relayUrl(url)
    const socket = new WebSocket(url, {
      agent: this.agent, headers, maxPayload: 262144,
      handshakeTimeout: 10000, perMessageDeflate: false
    })
    // RemoteClient removes its onerror callback when fencing an old transport.
    // ws can still emit an asynchronous abort error during a pending handshake.
    socket.on('error', () => {})
    socket.once('close', () => this.sockets.delete(socket))
    this.sockets.add(socket)
    return socket as unknown as Socket
  }
  dispose() {
    if (this.closed) return
    this.closed = true
    for (const socket of this.sockets) socket.terminate()
    this.sockets.clear()
    this.agent.destroy()
  }
}
