import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { ProxyAgent } from 'proxy-agent'

const MAX_CACHED_PROXY_AGENTS = 4
// Insertion order is used as a simple LRU: the oldest entry is evicted first
// once the cache exceeds its bound. Agents are disposed on shutdown (or
// eviction), closing their pooled sockets so keep-alive connections never
// leak. This cache is process-local: the Electron main process and a separate
// Kun Runtime process never share socket instances.
const proxyAgentCache = new Map<string, ProxyAgent>()

function getProxyAgent(normalizedProxyUrl: string): ProxyAgent {
  const cached = proxyAgentCache.get(normalizedProxyUrl)
  if (cached) {
    // Re-insert to mark this entry as most-recently-used.
    proxyAgentCache.delete(normalizedProxyUrl)
    proxyAgentCache.set(normalizedProxyUrl, cached)
    return cached
  }
  const agent = new ProxyAgent({
    getProxyForUrl: () => normalizedProxyUrl,
    keepAlive: true
  })
  proxyAgentCache.set(normalizedProxyUrl, agent)
  while (proxyAgentCache.size > MAX_CACHED_PROXY_AGENTS) {
    const oldestKey = proxyAgentCache.keys().next().value
    if (oldestKey === undefined) break
    const evicted = proxyAgentCache.get(oldestKey)
    proxyAgentCache.delete(oldestKey)
    evicted?.destroy()
  }
  return agent
}

export function disposeProxyAgents(): void {
  for (const agent of proxyAgentCache.values()) {
    try {
      agent.destroy()
    } catch {
      // A partially-closed agent must never block process shutdown.
    }
  }
  proxyAgentCache.clear()
}

export function cachedProxyAgentCountForTests(): number {
  return proxyAgentCache.size
}

export type ProxyTransportBody = {
  buffer: Buffer | null
  stream: Readable | null
}

/**
 * The single shared Node request lifecycle used by both the Electron main
 * process (`src/main/proxy-fetch.ts`) and the Kun Runtime
 * (`kun/src/adapters/model/proxy-fetch.ts`). Each caller keeps its own body
 * preparation, but agent caching, abort handling, error handling, and Promise
 * settlement are identical so the two entries never drift apart.
 *
 * A pre-aborted signal rejects immediately without creating an agent or a
 * request, so no listener (and no unhandled `error`) is ever produced. For a
 * request that aborts after creation, every listener is installed before any
 * `destroy` can fire, and a single `settled` guard ensures the Promise settles
 * exactly once.
 */
export function proxyTransportRequest(options: {
  url: URL
  method: string
  headers: Record<string, string>
  proxyUrl: string
  body: ProxyTransportBody
  signal?: AbortSignal
}): Promise<Response> {
  const { url, method, headers, proxyUrl, body, signal } = options

  if (signal?.aborted) {
    body.stream?.destroy()
    return Promise.reject(new Error('The operation was aborted.'))
  }

  return new Promise<Response>((resolve, reject) => {
    const agent = getProxyAgent(proxyUrl)
    let settled = false
    const settleReject = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }

    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      { method, headers, agent },
      (response) => {
        if (settled) {
          // A late response after an abort (or a body-stream failure) must be
          // drained, not surfaced as a second settlement.
          response.resume()
          return
        }
        settled = true
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(key, item)
          } else if (value !== undefined) {
            responseHeaders.set(key, String(value))
          }
        }
        const webBody = Readable.toWeb(response) as ReadableStream<Uint8Array>
        resolve(new Response(webBody, {
          status: response.statusCode ?? 0,
          statusText: response.statusMessage ?? '',
          headers: responseHeaders
        }))
      }
    )

    // Install every listener before any destroy can fire `error`, so an abort
    // (or a body stream error) can never surface as an unhandled event.
    const abort = (): void => {
      body.stream?.destroy()
      request.destroy(new Error('The operation was aborted.'))
      settleReject(new Error('The operation was aborted.'))
    }
    request.on('error', (error) => {
      body.stream?.destroy()
      settleReject(error)
    })
    request.on('close', () => signal?.removeEventListener('abort', abort))
    signal?.addEventListener('abort', abort, { once: true })

    if (body.stream) {
      body.stream.on('error', (error) => {
        request.destroy(error)
      })
      body.stream.pipe(request)
    } else if (body.buffer) {
      request.write(body.buffer)
      request.end()
    } else {
      request.end()
    }
  })
}
