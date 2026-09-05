import { createServer, type Server } from 'node:http'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  materializeProxyRequestBody,
  fetchWithOptionalProxy,
  disposeProxyAgents,
  cachedProxyAgentCountForTests
} from './proxy-fetch'

async function collectStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function startCaptureServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    req.on('error', () => {})
    res.on('error', () => {})
    req.resume()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    port,
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

describe('proxy fetch request bodies', () => {
  it('materializes FormData as a stream with a multipart boundary and complete fields', async () => {
    const form = new FormData()
    form.append('chat_id', '123456')
    form.append('document', new Blob(['hello proxy'], { type: 'text/plain' }), 'note.txt')

    const materialized = await materializeProxyRequestBody(form)

    expect(materialized.buffer).toBeNull()
    expect(materialized.stream).not.toBeNull()
    expect(materialized.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    const text = (await collectStream(materialized.stream!)).toString()
    expect(text).toContain('name="chat_id"')
    expect(text).toContain('123456')
    expect(text).toContain('filename="note.txt"')
    expect(text).toContain('hello proxy')
  })

  it('preserves Blob content type and bytes via a stream', async () => {
    const materialized = await materializeProxyRequestBody(
      new Blob(['telegram'], { type: 'application/octet-stream' })
    )

    expect(materialized.buffer).toBeNull()
    expect(materialized.headers).toEqual({
      'content-type': 'application/octet-stream',
      'content-length': '8'
    })
    expect((await collectStream(materialized.stream!)).toString()).toBe('telegram')
  })

  it('keeps string and Buffer bodies on the in-memory path', async () => {
    const stringBody = await materializeProxyRequestBody('plain')
    expect(stringBody.buffer?.toString()).toBe('plain')
    expect(stringBody.stream).toBeNull()

    const bufferBody = await materializeProxyRequestBody(new Uint8Array([1, 2, 3]))
    expect(bufferBody.buffer).toEqual(Buffer.from([1, 2, 3]))
    expect(bufferBody.stream).toBeNull()
  })
})

describe('proxy fetch agent caching', () => {
  it('reuses one ProxyAgent per proxy URL and disposes on demand', async () => {
    const { port, close } = await startCaptureServer()
    try {
      const proxyUrl = `http://127.0.0.1:${port}`
      await (await fetchWithOptionalProxy('http://example.test/a', undefined, proxyUrl)).text()
      await (await fetchWithOptionalProxy('http://example.test/b', undefined, proxyUrl)).text()
      expect(cachedProxyAgentCountForTests()).toBe(1)

      disposeProxyAgents()
      expect(cachedProxyAgentCountForTests()).toBe(0)
    } finally {
      await close()
    }
  })

  it('rejects a pre-aborted signal without creating or caching a ProxyAgent', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      fetchWithOptionalProxy('http://example.test/aborted', { signal: controller.signal }, 'http://127.0.0.1:9999')
    ).rejects.toThrow('The operation was aborted.')
    expect(cachedProxyAgentCountForTests()).toBe(0)
  })
})
