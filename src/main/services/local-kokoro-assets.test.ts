import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/kun-kokoro-assets-test'),
    getVersion: vi.fn(() => '9.9.9')
  }
}))

import {
  downloadVerifiedAsset,
  localKokoroBaseDir,
  localKokoroModelPath,
  localKokoroUserAgent,
  localKokoroVoicePath,
  readAssetSize
} from './local-kokoro-assets'

const originalFetch = globalThis.fetch

function streamResponse(payload: Buffer, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-length': String(payload.byteLength) }),
    body: Readable.toWeb(Readable.from([payload]))
  } as unknown as Response
}

describe('local-kokoro-assets', () => {
  let rootDir = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'kun-kokoro-assets-'))
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('keeps Kokoro assets under the speech model directory', () => {
    expect(localKokoroBaseDir().endsWith(join('models', 'speech', 'kokoro'))).toBe(true)
    expect(localKokoroModelPath('kokoro-82m-int8')).toContain('model_quantized.onnx')
    expect(localKokoroVoicePath('af_heart')).toContain(join('voices', 'af_heart.bin'))
  })

  it('identifies itself with the app version', () => {
    expect(localKokoroUserAgent()).toBe('Kun/9.9.9 local-kokoro')
  })

  it('publishes a verified asset and reports byte progress', async () => {
    const payload = Buffer.from('kokoro-weights-payload')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    globalThis.fetch = vi.fn(async () => streamResponse(payload)) as unknown as typeof fetch
    const targetPath = join(rootDir, 'nested', 'model.onnx')
    const progress: Array<[number, number | undefined]> = []

    await downloadVerifiedAsset({
      url: 'https://example.invalid/model.onnx',
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
    const payload = Buffer.from('voice-style-vectors')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    globalThis.fetch = vi.fn(async () => streamResponse(payload)) as unknown as typeof fetch
    const targetPath = join(rootDir, 'voice.bin')
    const metadataPath = join(rootDir, 'voice.json')

    await downloadVerifiedAsset({
      url: 'https://example.invalid/voice.bin',
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
    const targetPath = join(rootDir, 'bad.onnx')

    await expect(downloadVerifiedAsset({
      url: 'https://example.invalid/bad.onnx',
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
      url: 'https://example.invalid/huge.onnx',
      targetPath: join(rootDir, 'huge.onnx'),
      sizeBytes: 64,
      maxBytes: 32,
      sha256: '0'.repeat(64),
      controller: new AbortController()
    })).rejects.toThrow(/larger than the/)
  })

  it('surfaces a non-2xx response as a failed download', async () => {
    globalThis.fetch = vi.fn(async () => streamResponse(Buffer.alloc(0), 404)) as unknown as typeof fetch

    await expect(downloadVerifiedAsset({
      url: 'https://example.invalid/missing.onnx',
      targetPath: join(rootDir, 'missing.onnx'),
      sizeBytes: 1,
      maxBytes: 1024,
      sha256: '0'.repeat(64),
      controller: new AbortController()
    })).rejects.toThrow(/HTTP 404/)
  })
})
