import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronNet = vi.hoisted(() => ({ fetch: undefined as typeof fetch | undefined }))
vi.mock('electron', () => ({
  app: { getPath: () => '/unused', getVersion: () => 'test' },
  net: electronNet
}))
vi.mock('./local-sanotts-asset-integrity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./local-sanotts-asset-integrity')>()
  return { ...actual, fileSha256: vi.fn(actual.fileSha256) }
})

import { fileSha256 } from './local-sanotts-asset-integrity'
import {
  downloadVerifiedAsset,
  SANOTTS_CONNECT_TIMEOUT_MS,
  SANOTTS_STALL_TIMEOUT_MS,
  sanottsFetch,
  type SanottsAssetDownload
} from './local-sanotts-assets'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

// Capture only the downloader's deadlines; the loopback server and real fetch
// keep their real timers. Each test fires a deadline after the matching I/O event.
function captureTimeouts(): Map<number, () => void> {
  const timers = new Map<number, () => void>()
  const original = globalThis.setTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]
  ) => {
    if (delay === SANOTTS_CONNECT_TIMEOUT_MS || delay === SANOTTS_STALL_TIMEOUT_MS) {
      timers.set(delay, () => callback(...args))
    }
    return original(callback, delay, ...args)
  }) as typeof setTimeout)
  return timers
}

describe('sanoTTS real HTTP download lifecycle', () => {
  const payload = Buffer.from('verified-voice-model-bytes')
  const sha256 = createHash('sha256').update(payload).digest('hex')
  let rootDir = ''
  let baseUrl = ''
  let targetPath = ''
  let server: Server
  let handler: (request: IncomingMessage, response: ServerResponse) => void
  let requests: string[] = []

  const download = (overrides: Partial<SanottsAssetDownload> = {}): Promise<void> =>
    downloadVerifiedAsset({
      url: `${baseUrl}/asset`, targetPath, sizeBytes: payload.length,
      maxBytes: 1024, sha256, controller: new AbortController(), ...overrides
    })

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'kun-sanotts-http-'))
    targetPath = join(rootDir, 'front.bin')
    requests = []
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Length': payload.length })
      response.end(payload)
    }
    server = createServer((request, response) => {
      requests.push(request.url ?? '')
      handler(request, response)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test server address')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    electronNet.fetch = undefined
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(fileSha256).mockReset()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(rootDir, { recursive: true, force: true })
  })

  it('uses Electron net.fetch when available, preserving the request and signal', async () => {
    const response = new Response('ok')
    const transport = vi.fn(async () => response)
    electronNet.fetch = transport
    const controller = new AbortController()
    const init = { signal: controller.signal, headers: { Range: 'bytes=0-0' } }
    expect(await sanottsFetch(`${baseUrl}/probe`, init)).toBe(response)
    expect(transport).toHaveBeenCalledWith(`${baseUrl}/probe`, init)
    expect(requests).toEqual([])
  })

  it('does not silently fall back to Node fetch in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => sanottsFetch(`${baseUrl}/probe`)).toThrow('Electron network transport is unavailable')
    expect(requests).toEqual([])
  })

  it('disposes a response returned at the same time as explicit cancellation', async () => {
    const controller = new AbortController()
    const canceled = vi.fn()
    const reason = new Error('canceled before reading the response')
    electronNet.fetch = vi.fn(async () => {
      const response = new Response(new ReadableStream({ cancel: canceled }))
      controller.abort(reason)
      return response
    })
    await expect(download({ controller })).rejects.toBe(reason)
    expect(canceled).toHaveBeenCalledOnce()
    expect(existsSync(targetPath)).toBe(false)
    expect(existsSync(`${targetPath}.download`)).toBe(false)
  })

  it('follows redirects and verifies the final response before publishing', async () => {
    const serve = handler
    handler = (request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: '/asset' })
        response.end()
      } else serve(request, response)
    }
    await download({ url: `${baseUrl}/redirect` })
    expect(requests).toEqual(['/redirect', '/asset'])
    expect(await readFile(targetPath)).toEqual(payload)
    expect(existsSync(`${targetPath}.download`)).toBe(false)
  })

  it('reuses a verified file on retry and cleans stale partial bytes without a request', async () => {
    await download()
    await writeFile(`${targetPath}.download`, 'interrupted earlier attempt')
    const progress = vi.fn()
    const metadataPath = join(rootDir, 'runtime.json')
    await download({ onProgress: progress, metadata: { path: metadataPath, content: { verified: true } } })
    expect(requests).toEqual(['/asset'])
    expect(progress).toHaveBeenCalledWith(payload.length, payload.length, 0)
    expect(JSON.parse(await readFile(metadataPath, 'utf8'))).toEqual({ verified: true })
    expect(existsSync(`${targetPath}.download`)).toBe(false)
  })

  it('retries a failed checksum and replaces same-size corrupt existing bytes', async () => {
    const serve = handler
    handler = (request, response) => {
      if (requests.length === 1) response.end(Buffer.alloc(payload.length, 1))
      else serve(request, response)
    }
    await writeFile(targetPath, Buffer.alloc(payload.length, 2))
    await expect(download()).rejects.toThrow('checksum mismatch')
    expect(existsSync(`${targetPath}.download`)).toBe(false)
    expect(await readFile(targetPath)).toEqual(Buffer.alloc(payload.length, 2))
    await download()
    expect(requests).toEqual(['/asset', '/asset'])
    expect(await readFile(targetPath)).toEqual(payload)
  })

  it('rejects a truncated HTTP body without publishing it', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Length': payload.length, Connection: 'close' })
      response.end(payload.subarray(0, 3))
    }
    await expect(download()).rejects.toThrow()
    expect(existsSync(targetPath)).toBe(false)
    expect(existsSync(`${targetPath}.download`)).toBe(false)
  })

  it('enforces the streamed byte limit even without a content-length header', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'Transfer-Encoding': 'chunked' })
      response.end(payload)
    }
    await expect(download({ maxBytes: 16 })).rejects.toThrow('exceeded the local size limit')
    expect(existsSync(targetPath)).toBe(false)
    expect(existsSync(`${targetPath}.download`)).toBe(false)
  })

  it('distinguishes a headers timeout and leaves the caller able to retry', async () => {
    const timers = captureTimeouts()
    const connected = deferred()
    handler = () => connected.resolve()
    const controller = new AbortController()
    const result = download({ controller }).catch((error: unknown) => error)
    await connected.promise
    expect(timers.has(SANOTTS_CONNECT_TIMEOUT_MS)).toBe(true)
    timers.get(SANOTTS_CONNECT_TIMEOUT_MS)!()
    expect(await result).toMatchObject({ name: 'TimeoutError', message: expect.stringContaining('did not connect') })
    expect(controller.signal.aborted).toBe(false)
    expect(existsSync(`${targetPath}.download`)).toBe(false)
    handler = (_request, response) => response.end(payload)
    await download({ controller })
    expect(await readFile(targetPath)).toEqual(payload)
  })

  it('times out a stalled response body and removes partial output', async () => {
    const timers = captureTimeouts()
    const receivedBytes = deferred()
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Length': payload.length })
      response.write(payload.subarray(0, 3))
    }
    const controller = new AbortController()
    const result = download({ controller, onProgress: (bytes) => {
      if (bytes > 0) receivedBytes.resolve()
    } }).catch((error: unknown) => error)
    await receivedBytes.promise
    expect(timers.has(SANOTTS_STALL_TIMEOUT_MS)).toBe(true)
    timers.get(SANOTTS_STALL_TIMEOUT_MS)!()
    expect(await result).toMatchObject({ name: 'TimeoutError', message: expect.stringContaining('stalled') })
    expect(controller.signal.aborted).toBe(false)
    expect(existsSync(targetPath)).toBe(false)
    expect(existsSync(`${targetPath}.download`)).toBe(false)
  })

  it('preserves explicit cancellation while a body is streaming', async () => {
    const receivedBytes = deferred()
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Length': payload.length })
      response.write(payload.subarray(0, 3))
    }
    const controller = new AbortController()
    const reason = new Error('user canceled this download')
    const result = download({ controller, onProgress: (bytes) => {
      if (bytes > 0) receivedBytes.resolve()
    } }).catch((error: unknown) => error)
    await receivedBytes.promise
    controller.abort(reason)
    expect(await result).toBe(reason)
    expect(existsSync(targetPath)).toBe(false)
    expect(existsSync(`${targetPath}.download`)).toBe(false)
  })

  it('keeps cancellation active during checksum verification', async () => {
    const hashing = deferred()
    const controller = new AbortController()
    vi.mocked(fileSha256).mockImplementationOnce(async (_path, signal) => {
      hashing.resolve()
      await new Promise<void>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      })
      return sha256
    })
    const reason = new Error('cancel while hashing')
    const result = download({ controller }).catch((error: unknown) => error)
    await hashing.promise
    controller.abort(reason)
    expect(await result).toBe(reason)
    expect(existsSync(targetPath)).toBe(false)
    expect(existsSync(`${targetPath}.download`)).toBe(false)
  })

  it.each([404, 200])('disposes rejected HTTP %i response bodies', async (status) => {
    const closed = deferred()
    handler = (_request, response) => {
      response.once('close', closed.resolve)
      response.writeHead(status, { 'Content-Length': 2048 })
      response.write('unconsumed error or oversized body')
    }
    await expect(download()).rejects.toThrow(status === 404 ? 'HTTP 404' : 'larger than')
    await closed.promise
    expect(existsSync(targetPath)).toBe(false)
    expect(existsSync(`${targetPath}.download`)).toBe(false)
  })
})
