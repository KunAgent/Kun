import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/kun-sanotts-assets-test'),
    getVersion: vi.fn(() => '9.9.9')
  }
}))

import {
  downloadVerifiedAsset,
  localSanottsBaseDir,
  localSanottsRuntimeFilePath,
  localSanottsUserAgent,
  localSanottsVoiceFilePath,
  readAssetSize
} from './local-sanotts-assets'

const originalFetch = globalThis.fetch

function streamResponse(payload: Buffer, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-length': String(payload.byteLength) }),
    body: Readable.toWeb(Readable.from([payload]))
  } as unknown as Response
}

describe('local-sanotts-assets', () => {
  let rootDir = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'kun-sanotts-assets-'))
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    await rm(rootDir, { recursive: true, force: true }).catch(() => undefined)
  })

  it('keeps sanoTTS assets under the speech model directory', () => {
    expect(localSanottsBaseDir().endsWith(join('models', 'speech', 'sanotts'))).toBe(true)
    expect(localSanottsRuntimeFilePath('snt_g2p.wasm')).toContain(join('runtime', 'snt_g2p.wasm'))
    expect(localSanottsVoiceFilePath('amy', 'meta.json')).toContain(join('voices', 'amy', 'meta.json'))
  })

  it('identifies itself with the app version', () => {
    expect(localSanottsUserAgent()).toBe('Kun/9.9.9 local-sanotts')
  })

  it('publishes a verified asset and reports byte progress', async () => {
    const payload = Buffer.from('sanotts-runtime-payload')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    globalThis.fetch = vi.fn(async () => streamResponse(payload)) as unknown as typeof fetch
    const targetPath = join(rootDir, 'nested', 'snt_g2p.wasm')
    const progress: Array<[number, number | undefined]> = []

    await downloadVerifiedAsset({
      url: 'https://example.invalid/snt_g2p.wasm',
      targetPath,
      sizeBytes: payload.byteLength,
      maxBytes: 1024,
      sha256,
      controller: new AbortController(),
      onProgress: (downloaded, total) => progress.push([downloaded, total])
    })

    expect(await readFile(targetPath)).toEqual(payload)
    expect(await readAssetSize(targetPath)).toBe(payload.byteLength)
    expect(progress[0]).toEqual([0, payload.byteLength])
    expect(progress.at(-1)).toEqual([payload.byteLength, payload.byteLength])
    expect(existsSync(`${targetPath}.download`)).toBe(false)
  })

  it('writes the metadata receipt only after verification succeeds', async () => {
    const payload = Buffer.from('voice-weights')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    globalThis.fetch = vi.fn(async () => streamResponse(payload)) as unknown as typeof fetch
    const targetPath = join(rootDir, 'front.bin')
    const metadataPath = join(rootDir, 'runtime.json')

    await downloadVerifiedAsset({
      url: 'https://example.invalid/front.bin',
      targetPath,
      sizeBytes: payload.byteLength,
      maxBytes: 1024,
      sha256,
      controller: new AbortController(),
      metadata: { path: metadataPath, content: { downloadSource: 'huggingface' } }
    })

    expect(JSON.parse(await readFile(metadataPath, 'utf8'))).toEqual({
      downloadSource: 'huggingface'
    })
  })

  it('leaves no partial file behind when the checksum is wrong', async () => {
    const payload = Buffer.from('tampered')
    globalThis.fetch = vi.fn(async () => streamResponse(payload)) as unknown as typeof fetch
    const targetPath = join(rootDir, 'bad.wasm')

    await expect(downloadVerifiedAsset({
      url: 'https://example.invalid/bad.wasm',
      targetPath,
      sizeBytes: payload.byteLength,
      maxBytes: 1024,
      sha256: '0'.repeat(64),
      controller: new AbortController()
    })).rejects.toThrow(/checksum mismatch/)

    expect(existsSync(targetPath)).toBe(false)
    expect(existsSync(`${targetPath}.download`)).toBe(false)
    expect(await readAssetSize(targetPath)).toBeNull()
  })

  it('refuses a declared length above the size cap before streaming', async () => {
    const payload = Buffer.alloc(64, 1)
    globalThis.fetch = vi.fn(async () => streamResponse(payload)) as unknown as typeof fetch

    await expect(downloadVerifiedAsset({
      url: 'https://example.invalid/huge.wasm',
      targetPath: join(rootDir, 'huge.wasm'),
      sizeBytes: 64,
      maxBytes: 32,
      sha256: '0'.repeat(64),
      controller: new AbortController()
    })).rejects.toThrow(/larger than the/)
  })

  it('surfaces a non-2xx response as a failed download', async () => {
    globalThis.fetch = vi.fn(async () => streamResponse(Buffer.alloc(0), 404)) as unknown as typeof fetch

    await expect(downloadVerifiedAsset({
      url: 'https://example.invalid/missing.wasm',
      targetPath: join(rootDir, 'missing.wasm'),
      sizeBytes: 1,
      maxBytes: 1024,
      sha256: '0'.repeat(64),
      controller: new AbortController()
    })).rejects.toThrow(/HTTP 404/)
  })
})
