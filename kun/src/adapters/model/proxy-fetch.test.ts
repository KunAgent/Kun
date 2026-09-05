import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createProxyFetch,
  disposeProxyAgents,
  cachedProxyAgentCountForTests
} from './proxy-fetch.js'

interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

async function startCaptureServer(): Promise<{
  port: number
  requests: CapturedRequest[]
  close: () => Promise<void>
}> {
  const requests: CapturedRequest[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('error', () => {})
    res.on('error', () => {})
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({
        url: req.url ?? '',
        method: req.method ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks)
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

afterEach(() => {
  disposeProxyAgents()
})

describe('proxy fetch agent caching', () => {
  it('reuses one ProxyAgent per normalized proxy URL', async () => {
    const { port, close } = await startCaptureServer()
    try {
      const proxied = createProxyFetch(`http://127.0.0.1:${port}`)!
      await (await proxied('http://example.test/a')).text()
      await (await proxied('http://example.test/b')).text()
      expect(cachedProxyAgentCountForTests()).toBe(1)
    } finally {
      await close()
    }
  })

  it('caches separate agents for different proxy URLs and rebuilds after dispose', async () => {
    const a = await startCaptureServer()
    const b = await startCaptureServer()
    try {
      const fetchA = createProxyFetch(`http://127.0.0.1:${a.port}`)!
      const fetchB = createProxyFetch(`http://127.0.0.1:${b.port}`)!
      await (await fetchA('http://example.test/1')).text()
      await (await fetchB('http://example.test/2')).text()
      expect(cachedProxyAgentCountForTests()).toBe(2)

      disposeProxyAgents()
      expect(cachedProxyAgentCountForTests()).toBe(0)

      await (await fetchA('http://example.test/3')).text()
      expect(cachedProxyAgentCountForTests()).toBe(1)
    } finally {
      await a.close()
      await b.close()
    }
  })

  it('evicts the oldest agent when more than the cache bound are created', async () => {
    const urls = [9991, 9992, 9993, 9994, 9995].map((p) => `http://127.0.0.1:${p}`)
    for (const url of urls) {
      const proxied = createProxyFetch(url)!
      await proxied('http://example.test/x').catch(() => {})
    }
    expect(cachedProxyAgentCountForTests()).toBe(4)
  })
})

describe('proxy fetch streaming bodies', () => {
  it('streams a ReadableStream body with chunked transfer-encoding and no forged content-length', async () => {
    const { port, requests, close } = await startCaptureServer()
    try {
      const proxied = createProxyFetch(`http://127.0.0.1:${port}`)!
      const payload = 'hello streaming proxy body'
      const encoder = new TextEncoder()
      const bodyStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(payload))
          controller.close()
        }
      })
      await (await proxied('http://example.test/stream', {
        method: 'POST',
        body: bodyStream,
        duplex: 'half'
      } as RequestInit & { duplex: 'half' })).text()

      expect(requests).toHaveLength(1)
      const captured = requests[0]
      expect(String(captured.headers['transfer-encoding'] ?? '')).toContain('chunked')
      expect(captured.headers['content-length']).toBeUndefined()
      expect(captured.body.toString()).toBe(payload)
    } finally {
      await close()
    }
  })

  it('passes through an explicit content-length on a streaming body', async () => {
    const { port, requests, close } = await startCaptureServer()
    try {
      const proxied = createProxyFetch(`http://127.0.0.1:${port}`)!
      const payload = 'sized payload'
      const encoder = new TextEncoder()
      const bytes = encoder.encode(payload)
      const bodyStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        }
      })
      await (await proxied('http://example.test/sized', {
        method: 'POST',
        body: bodyStream,
        duplex: 'half',
        headers: { 'content-length': String(bytes.length) }
      } as RequestInit & { duplex: 'half' })).text()

      expect(requests).toHaveLength(1)
      expect(requests[0].headers['content-length']).toBe(String(bytes.length))
      expect(requests[0].body.toString()).toBe(payload)
    } finally {
      await close()
    }
  })

  it('aborts a streaming body without hanging and destroys the stream', async () => {
    const { port, close } = await startCaptureServer()
    try {
      const proxied = createProxyFetch(`http://127.0.0.1:${port}`)!
      let cancelled = false
      const bodyStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
        },
        cancel() {
          cancelled = true
        }
      })
      const controller = new AbortController()
      const pending = proxied('http://example.test/abort', {
        method: 'POST',
        body: bodyStream,
        duplex: 'half',
        signal: controller.signal
      } as RequestInit & { duplex: 'half' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      controller.abort()
      await expect(pending).rejects.toThrow('The operation was aborted.')
      expect(cancelled).toBe(true)
    } finally {
      await close()
    }
  })
})

describe('proxy fetch pre-aborted signals', () => {
  it('rejects a pre-aborted signal without creating or caching a ProxyAgent', async () => {
    const controller = new AbortController()
    controller.abort()
    const proxied = createProxyFetch('http://127.0.0.1:9999')!
    await expect(
      proxied('http://example.test/aborted', { signal: controller.signal } as RequestInit)
    ).rejects.toThrow('The operation was aborted.')
    expect(cachedProxyAgentCountForTests()).toBe(0)
  })
})
