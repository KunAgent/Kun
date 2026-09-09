import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
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
  LOCAL_KOKORO_DEFAULT_MODEL_ID,
  LOCAL_KOKORO_DOWNLOAD_SOURCES,
  LOCAL_KOKORO_FP16_MODEL_ID,
  LOCAL_KOKORO_INT8_MODEL_ID,
  LOCAL_KOKORO_MODELS,
  localKokoroModelUrl,
  localKokoroVoiceUrl,
  recommendedLocalKokoroModelId
} from '../../shared/local-kokoro'
import { LOCAL_KOKORO_VOICES } from '../../shared/local-kokoro-voices'
import {
  checkLocalKokoroDownloadSources,
  deleteLocalKokoroModel,
  downloadLocalKokoroModel,
  downloadLocalKokoroVoice,
  getLocalKokoroModelStatus,
  getLocalKokoroReadiness,
  getLocalKokoroVoiceStatus,
  listDownloadedLocalKokoroVoices,
  listLocalKokoroModelStatuses,
  setLocalKokoroProgressEmitter
} from './local-kokoro-download-service'
import { localKokoroModelPath, localKokoroVoicePath } from './local-kokoro-assets'

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

describe('local-kokoro-download-service', () => {
  let rootDir = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'kun-local-kokoro-'))
    vi.mocked(app.getPath).mockReturnValue(rootDir)
    setLocalKokoroProgressEmitter(null)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    setLocalKokoroProgressEmitter(null)
    vi.restoreAllMocks()
  })

  it('publishes checksum metadata for every model and voice', () => {
    for (const model of LOCAL_KOKORO_MODELS) {
      expect(model.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(model.sizeBytes).toBeGreaterThan(0)
      expect(model.sizeBytes).toBeLessThanOrEqual(model.maxBytes)
    }
    expect(LOCAL_KOKORO_VOICES.length).toBeGreaterThan(0)
    for (const voice of LOCAL_KOKORO_VOICES) {
      expect(voice.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(voice.sizeBytes).toBe(522_240)
      expect(['en-us', 'en-gb']).toContain(voice.accent)
    }
  })

  it('builds mirror URLs for every download source', () => {
    const origins = LOCAL_KOKORO_DOWNLOAD_SOURCES.map((source) =>
      new URL(localKokoroModelUrl(LOCAL_KOKORO_DEFAULT_MODEL_ID, source.id)).origin
    )

    expect(origins).toEqual([
      'https://huggingface.co',
      'https://hf-mirror.com',
      'https://hf-cdn.sufy.com'
    ])
    expect(localKokoroVoiceUrl('af_heart', 'huggingface')).toContain('/voices/af_heart.bin')
  })

  it('reports every model as not downloaded on a clean profile', async () => {
    const statuses = await listLocalKokoroModelStatuses()

    expect(statuses).toHaveLength(LOCAL_KOKORO_MODELS.length)
    for (const status of statuses) expect(status.state).toBe('not_downloaded')
    expect(await listDownloadedLocalKokoroVoices()).toEqual([])
  })

  it('rejects a payload whose checksum does not match', async () => {
    const model = LOCAL_KOKORO_MODELS[0]
    const payload = Buffer.alloc(model.sizeBytes, 7)
    globalThis.fetch = vi.fn(async () => bodyResponse(payload)) as unknown as typeof fetch

    const result = await downloadLocalKokoroModel(model.id, 'huggingface')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('checksum mismatch')
    expect((await getLocalKokoroModelStatus(model.id)).state).toBe('not_downloaded')
  })

  it('rejects a payload whose length does not match', async () => {
    const model = LOCAL_KOKORO_MODELS[0]
    globalThis.fetch = vi.fn(async () => bodyResponse(Buffer.alloc(1024, 3))) as unknown as typeof fetch

    const result = await downloadLocalKokoroModel(model.id, 'huggingface')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('size mismatch')
  })

  it('reports an unreachable download source instead of throwing', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND registry')
    }) as unknown as typeof fetch

    const result = await checkLocalKokoroDownloadSources(LOCAL_KOKORO_DEFAULT_MODEL_ID)

    expect(result.sources).toHaveLength(LOCAL_KOKORO_DOWNLOAD_SOURCES.length)
    for (const source of result.sources) {
      expect(source.state).toBe('unavailable')
      expect(source.message).toContain('network connection was interrupted')
    }
  })

  it('treats an on-disk voice as ready and skips the network', async () => {
    const voice = LOCAL_KOKORO_VOICES[0]
    const payload = Buffer.alloc(voice.sizeBytes, 0)
    globalThis.fetch = vi.fn(async () => bodyResponse(payload)) as unknown as typeof fetch
    const path = localKokoroVoicePath(voice.id)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, payload)

    const status = await getLocalKokoroVoiceStatus(voice.id)

    expect(status.state).toBe('ready')
    expect(status.path).toBe(path)
    expect((await readFile(path)).byteLength).toBe(voice.sizeBytes)
    expect(await listDownloadedLocalKokoroVoices()).toContain(voice.id)

    await downloadLocalKokoroVoice(voice.id, 'huggingface')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('resolves readiness from the model and voice together', async () => {
    const model = LOCAL_KOKORO_MODELS[0]
    const voice = LOCAL_KOKORO_VOICES[0]

    const before = await getLocalKokoroReadiness(model.id, voice.id)
    expect(before.ready).toBe(false)
    expect(before.model.state).toBe('not_downloaded')

    await mkdir(dirname(localKokoroModelPath(model.id)), { recursive: true })
    await writeFile(localKokoroModelPath(model.id), Buffer.alloc(16, 1))
    await mkdir(dirname(localKokoroVoicePath(voice.id)), { recursive: true })
    await writeFile(localKokoroVoicePath(voice.id), Buffer.alloc(16, 1))

    const after = await getLocalKokoroReadiness(model.id, voice.id)
    expect(after.ready).toBe(true)
    expect(after.modelId).toBe(model.id)
    expect(after.voiceId).toBe(voice.id)
  })

  it('deletes a downloaded model and its receipt', async () => {
    const model = LOCAL_KOKORO_MODELS[0]
    await mkdir(dirname(localKokoroModelPath(model.id)), { recursive: true })
    await writeFile(localKokoroModelPath(model.id), Buffer.alloc(8, 1))
    expect((await getLocalKokoroModelStatus(model.id)).state).toBe('ready')

    const result = await deleteLocalKokoroModel(model.id)

    expect(result.ok).toBe(true)
    expect((await getLocalKokoroModelStatus(model.id)).state).toBe('not_downloaded')
  })
})

describe('recommendedLocalKokoroModelId', () => {
  it('prefers fp16 on arm64, where the quantized graph is the slower one', () => {
    expect(recommendedLocalKokoroModelId('arm64')).toBe(LOCAL_KOKORO_FP16_MODEL_ID)
  })

  it('keeps the smaller quantized model everywhere else', () => {
    expect(recommendedLocalKokoroModelId('x64')).toBe(LOCAL_KOKORO_INT8_MODEL_ID)
    expect(recommendedLocalKokoroModelId(undefined)).toBe(LOCAL_KOKORO_INT8_MODEL_ID)
  })

  it('marks exactly one tier as recommended for a host', () => {
    for (const arch of ['arm64', 'x64']) {
      const recommended = LOCAL_KOKORO_MODELS
        .filter((model) => model.id === recommendedLocalKokoroModelId(arch))
      expect(recommended).toHaveLength(1)
    }
  })
})
