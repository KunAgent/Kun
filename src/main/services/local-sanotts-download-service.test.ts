import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const assetDownload = vi.hoisted(() => ({
  impl: null as null | ((request: { url: string; targetPath: string; metadata?: { path: string; content: Record<string, unknown> } }) => Promise<void>)
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn(() => 'test')
  }
}))

vi.mock('./local-sanotts-assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./local-sanotts-assets')>()
  return {
    ...actual,
    downloadVerifiedAsset: (request: Parameters<typeof actual.downloadVerifiedAsset>[0]) =>
      assetDownload.impl ? assetDownload.impl(request) : actual.downloadVerifiedAsset(request)
  }
})

import { app } from 'electron'
import {
  LOCAL_SANOTTS_DOWNLOAD_SOURCES,
  LOCAL_SANOTTS_RUNTIME_FILES,
  localSanottsRuntimeFileUrl,
  localSanottsVoiceFileUrl
} from '../../shared/local-sanotts'
import { LOCAL_SANOTTS_VOICES } from '../../shared/local-sanotts-voices'
import {
  cancelLocalSanottsRuntime,
  checkLocalSanottsDownloadSources,
  deleteLocalSanottsRuntime,
  downloadLocalSanottsRuntime,
  downloadLocalSanottsVoice,
  getLocalSanottsReadiness,
  getLocalSanottsRuntimeStatus,
  getLocalSanottsVoiceStatus,
  listDownloadedLocalSanottsVoices,
  setLocalSanottsProgressEmitter
} from './local-sanotts-download-service'
import { localSanottsRuntimeFilePath, localSanottsVoiceFilePath } from './local-sanotts-assets'

const originalFetch = globalThis.fetch

function bodyResponse(payload: Buffer): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(payload.byteLength) }),
    body: Readable.toWeb(Readable.from([payload])),
    arrayBuffer: async () => payload
  } as unknown as Response
}

describe('local-sanotts-download-service', () => {
  let rootDir = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'kun-local-sanotts-'))
    vi.mocked(app.getPath).mockReturnValue(rootDir)
    setLocalSanottsProgressEmitter(null)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    assetDownload.impl = null
    setLocalSanottsProgressEmitter(null)
    vi.restoreAllMocks()
  })

  it('publishes checksum metadata for every runtime file and voice', () => {
    for (const file of LOCAL_SANOTTS_RUNTIME_FILES) {
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(file.sizeBytes).toBeGreaterThan(0)
      expect(file.sizeBytes).toBeLessThanOrEqual(file.maxBytes)
    }
    expect(LOCAL_SANOTTS_VOICES.length).toBe(4)
    for (const voice of LOCAL_SANOTTS_VOICES) {
      expect(voice.files.length).toBeGreaterThan(0)
      for (const file of voice.files) {
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
      }
    }
  })

  it('builds mirror URLs for every download source', () => {
    const origins = LOCAL_SANOTTS_DOWNLOAD_SOURCES.map((source) =>
      new URL(localSanottsRuntimeFileUrl('snt_g2p.wasm', source.id)).origin
    )

    expect(origins).toEqual([
      'https://huggingface.co',
      'https://hf-mirror.com',
      'https://ampixa.github.io'
    ])
    expect(localSanottsVoiceFileUrl('amy', 'meta.json', 'huggingface')).toContain('/voices/amy/meta.json')
  })

  it('reports runtime and voices as not downloaded on a clean profile', async () => {
    expect((await getLocalSanottsRuntimeStatus()).state).toBe('not_downloaded')
    expect(await listDownloadedLocalSanottsVoices()).toEqual([])
  })

  it('rejects a payload whose checksum does not match', async () => {
    const file = LOCAL_SANOTTS_RUNTIME_FILES[0]
    const payload = Buffer.alloc(file.sizeBytes, 7)
    globalThis.fetch = vi.fn(async () => bodyResponse(payload)) as unknown as typeof fetch

    const result = await downloadLocalSanottsRuntime('huggingface')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('checksum mismatch')
    expect((await getLocalSanottsRuntimeStatus()).state).toBe('not_downloaded')
  })

  it('rejects a payload whose length does not match', async () => {
    globalThis.fetch = vi.fn(async () => bodyResponse(Buffer.alloc(1024, 3))) as unknown as typeof fetch

    const result = await downloadLocalSanottsRuntime('huggingface')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('size mismatch')
  })

  it('reports an unreachable download source instead of throwing', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND registry')
    }) as unknown as typeof fetch

    const result = await checkLocalSanottsDownloadSources()

    expect(result.sources).toHaveLength(LOCAL_SANOTTS_DOWNLOAD_SOURCES.length)
    for (const source of result.sources) {
      expect(source.state).toBe('unavailable')
      expect(source.message).toContain('network connection was interrupted')
    }
  })

  it('treats an on-disk voice as ready and skips the network', async () => {
    const voice = LOCAL_SANOTTS_VOICES[0]
    globalThis.fetch = vi.fn(async () => bodyResponse(Buffer.alloc(8, 1))) as unknown as typeof fetch
    for (const file of voice.files) {
      const path = localSanottsVoiceFilePath(voice.id, file.fileName)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, Buffer.alloc(8, 1))
    }

    const status = await getLocalSanottsVoiceStatus(voice.id)

    expect(status.state).toBe('ready')
    expect(await listDownloadedLocalSanottsVoices()).toContain(voice.id)

    await downloadLocalSanottsVoice(voice.id, 'huggingface')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('resolves readiness from the runtime and voice together', async () => {
    const voice = LOCAL_SANOTTS_VOICES[0]
    const before = await getLocalSanottsReadiness(voice.id)
    expect(before.ready).toBe(false)
    expect(before.runtime.state).toBe('not_downloaded')

    for (const file of LOCAL_SANOTTS_RUNTIME_FILES) {
      const path = localSanottsRuntimeFilePath(file.fileName)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, Buffer.alloc(8, 1))
    }
    for (const file of voice.files) {
      const path = localSanottsVoiceFilePath(voice.id, file.fileName)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, Buffer.alloc(8, 1))
    }

    const after = await getLocalSanottsReadiness(voice.id)
    expect(after.ready).toBe(true)
    expect(after.voiceId).toBe(voice.id)
  })

  it('deletes a downloaded runtime', async () => {
    const path = localSanottsRuntimeFilePath('snt_g2p.wasm')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.alloc(8, 1))
    for (const file of LOCAL_SANOTTS_RUNTIME_FILES) {
      await writeFile(localSanottsRuntimeFilePath(file.fileName), Buffer.alloc(8, 1))
    }
    expect((await getLocalSanottsRuntimeStatus()).state).toBe('ready')

    const result = await deleteLocalSanottsRuntime()

    expect(result.ok).toBe(true)
    expect((await getLocalSanottsRuntimeStatus()).state).toBe('not_downloaded')
  })

  it('falls through to the next source after a 404 and skips later ones', async () => {
    const seen: string[] = []
    assetDownload.impl = async (request) => {
      seen.push(request.url)
      if (request.url.includes('huggingface.co')) {
        throw new Error('failed to download sanoTTS asset: HTTP 404')
      }
      await mkdir(dirname(request.targetPath), { recursive: true })
      await writeFile(request.targetPath, Buffer.alloc(8, 1))
      if (request.metadata) {
        await writeFile(request.metadata.path, JSON.stringify(request.metadata.content, null, 2), 'utf8')
      }
    }

    const result = await downloadLocalSanottsRuntime('huggingface')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.status.state).toBe('ready')
    expect(seen.some((url) => url.includes('huggingface.co'))).toBe(true)
    expect(seen.some((url) => url.includes('hf-mirror.com'))).toBe(true)
    expect(seen.some((url) => url.includes('ampixa.github.io'))).toBe(false)
  })

  it('reports every source when they all fail', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      body: null
    })) as unknown as typeof fetch

    const result = await downloadLocalSanottsRuntime('huggingface')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('Hugging Face:')
      expect(result.message).toContain('HF-Mirror:')
      expect(result.message).toContain('GitHub Pages:')
      expect(result.message).toContain('HTTP 404')
    }
  })

  it('does not try the next source after cancel', async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input))
      await new Promise<never>((_, reject) => {
        const fail = (): void => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }
        if (init?.signal?.aborted) fail()
        else init?.signal?.addEventListener('abort', fail, { once: true })
      })
    }) as unknown as typeof fetch

    const pending = downloadLocalSanottsRuntime('huggingface')
    await vi.waitFor(() => expect(seen.length).toBe(1))
    await cancelLocalSanottsRuntime()
    const result = await pending

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.status.state).toBe('not_downloaded')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('huggingface.co')
  })

  it('stops after the preferred source succeeds', async () => {
    const seen: string[] = []
    assetDownload.impl = async (request) => {
      seen.push(request.url)
      await mkdir(dirname(request.targetPath), { recursive: true })
      await writeFile(request.targetPath, Buffer.alloc(8, 1))
      if (request.metadata) {
        await writeFile(request.metadata.path, JSON.stringify(request.metadata.content, null, 2), 'utf8')
      }
    }

    const result = await downloadLocalSanottsRuntime('huggingface')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.status.state).toBe('ready')
    expect(seen.length).toBe(LOCAL_SANOTTS_RUNTIME_FILES.length)
    expect(seen.every((url) => url.includes('huggingface.co'))).toBe(true)
  })
})
