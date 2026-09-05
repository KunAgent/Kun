import { Readable } from 'node:stream'
import {
  disposeProxyAgents,
  cachedProxyAgentCountForTests,
  proxyTransportRequest
} from './proxy-transport.js'

export { disposeProxyAgents, cachedProxyAgentCountForTests } from './proxy-transport.js'

export function createProxyFetch(proxyUrl: string): typeof fetch | null {
  const normalizedProxyUrl = proxyUrl.trim()
  if (!normalizedProxyUrl) return null
  return (input, init) => fetchViaProxy(input, init, normalizedProxyUrl)
}

async function fetchViaProxy(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] | undefined,
  proxyUrl: string
): Promise<Response> {
  const requestInput = new Request(input, init)
  const url = new URL(requestInput.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported proxied request protocol: ${url.protocol}`)
  }

  const headers = headersToRecord(requestInput.headers)
  // Stream the body instead of materialising it with arrayBuffer(). When the
  // caller has not set content-length, Node emits Transfer-Encoding: chunked.
  const bodyStream = requestInput.body
    // TypeScript 5.9 can resolve the DOM and Node Web Stream declarations as
    // distinct interfaces even though both are accepted by Node at runtime.
    ? Readable.fromWeb(requestInput.body as Parameters<typeof Readable.fromWeb>[0])
    : null

  return proxyTransportRequest({
    url,
    method: requestInput.method,
    headers,
    proxyUrl,
    body: { buffer: null, stream: bodyStream },
    signal: requestInput.signal
  })
}

function headersToRecord(
  headers: { forEach(callback: (value: string, key: string) => void): void } | undefined
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}
