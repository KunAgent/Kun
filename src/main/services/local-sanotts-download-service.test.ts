import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn(() => 'test')
  }
}))

import { app } from 'electron'
import {
  LOCAL_SANOTTS_DOWNLOAD_SOURCES,
  LOCAL_SANOTTS_RUNTIME_FILES,
  localSanottsRuntimeFileUrl,
  localSanottsVoiceFileUrl
} from '../../shared/local-sanotts'
import { LOCAL_SANOTTS_VOICES } from '../../shared/local-sanotts-voices'
import {
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
})
